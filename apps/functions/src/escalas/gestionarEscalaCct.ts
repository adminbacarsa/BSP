/**
 * Callable `gestionarEscalaCct` — módulo Eventuales, escala salarial del anexo.
 *   editar     { docId, cambios[], motivo }   PROPUESTA: edita en el lugar y suma `historial`.
 *                                            APROBADA: no se toca; nace una PROPUESTA derivada (`derivadaDe`) con el cambio.
 *   aprobar    { docId, motivo? }             PROPUESTA → APROBADA (version n+1), las aprobadas que solapan → REEMPLAZADA,
 *                                            y escribe `escalas_salariales` ACTIVE por categoría × mes (lo que lee remuneracion.mjs).
 *   rechazar   { docId, motivo }              PROPUESTA → RECHAZADA.
 *   importar   { propuesta, empresaId? }      Guarda una propuesta ya extraída (JSON del extractor) como PROPUESTA.
 * Permiso: SuperAdmin o EVENTUALES `update`. Todo con `audit_logs`.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { esPropuesta } from './escalaCct422Core';
import { avisarEscalaCct, guardarPropuestaEscala, NOVEDAD_ESCALA_APROBADA, NOVEDAD_ESCALA_PROPUESTA } from './escalaCctStore';

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

type Lib = {
  aplicarCambios: (escala: Record<string, unknown>, cambios: unknown[], meta: Record<string, unknown>) => { ok: boolean; codigo?: string; escala?: Record<string, any>; historialItem?: Record<string, unknown> };
  escalasSalarialesDesdeAprobada: (escala: Record<string, unknown>, meta: Record<string, unknown>) => (Record<string, unknown> & { id: string })[];
  validarParaAprobar: (escala: Record<string, unknown>) => { ok: boolean; codigo?: string; mes?: string };
  aprobadasSolapadas: (aprobadas: Record<string, unknown>[], nueva: Record<string, unknown>) => (Record<string, unknown> & { id: string })[];
  diffEscalas: (a: Record<string, unknown> | null, b: Record<string, unknown>) => unknown[];
};

async function lib(): Promise<Lib> {
  return import('../eventuales-shared/escalaCct.mjs') as unknown as Promise<Lib>;
}

function db() {
  return admin.firestore();
}

export interface Actor { uid: string; email: string | null; superAdmin: boolean }

export async function exigirEventualesUpdate(context: functions.https.CallableContext): Promise<Actor> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const uid = context.auth.uid;
  const email = (context.auth.token?.email as string | undefined) || null;
  const claimRole = String(context.auth.token?.role || '');
  if (SUPER.includes(claimRole)) return { uid, email, superAdmin: true };
  const sys = await db().collection('system_users').doc(uid).get();
  const roleId = String(sys.data()?.role || claimRole || '');
  if (SUPER.includes(roleId)) return { uid, email, superAdmin: true };
  if (roleId) {
    const rol = await db().collection('roles').doc(roleId).get();
    const acciones = (rol.data()?.permissions?.EVENTUALES || []) as string[];
    if (acciones.includes('update')) return { uid, email, superAdmin: false };
  }
  throw new functions.https.HttpsError('permission-denied', 'Necesitás permiso de Eventuales (editar) para la escala salarial.');
}

async function auditar(action: string, actor: Actor, docId: string, details: Record<string, unknown>) {
  await db().collection('audit_logs').add({
    action, collection: 'escalas_cct', docId, userId: actor.uid, userEmail: actor.email, details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function limpiarParaFirestore<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

async function leerEscala(docId: string) {
  if (!docId) throw new functions.https.HttpsError('invalid-argument', 'Falta docId.');
  const snap = await db().collection('escalas_cct').doc(docId).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'La escala no existe.');
  return { ref: snap.ref, data: { id: snap.id, ...(snap.data() || {}) } as Record<string, any> };
}

// ── editar ────────────────────────────────────────────────────────────────────

export async function editarEscala(actor: Actor, data: Record<string, unknown>, ahora = new Date()) {
  const m = await lib();
  const { ref, data: escala } = await leerEscala(String(data.docId || ''));
  if (!['PROPUESTA', 'APROBADA'].includes(String(escala.estado))) {
    throw new functions.https.HttpsError('failed-precondition', `Una escala ${escala.estado} no se edita.`);
  }
  const r = m.aplicarCambios(escala, (data.cambios as unknown[]) || [], { motivo: data.motivo, uid: actor.uid, email: actor.email, ahora: ahora.toISOString() });
  if (!r.ok || !r.escala) throw new functions.https.HttpsError('invalid-argument', r.codigo || 'CAMBIO_INVALIDO');
  const { id: _id, ...sinId } = r.escala;
  void _id;

  if (escala.estado === 'PROPUESTA') {
    await ref.set(limpiarParaFirestore({
      ...sinId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    }), { merge: false });
    await auditar('ESCALA_CCT_EDITADA', actor, ref.id, { motivo: data.motivo, cambios: r.historialItem?.cambios });
    return { ok: true, docId: ref.id, derivada: false, cambios: (r.historialItem?.cambios as unknown[])?.length || 0 };
  }

  // Aprobada: queda intacta; la corrección nace como propuesta derivada y rige recién al aprobarla.
  const nuevoId = `${ref.id}_rev${ahora.getTime().toString(36)}`;
  const nuevoRef = db().collection('escalas_cct').doc(nuevoId);
  await nuevoRef.set(limpiarParaFirestore({
    ...sinId,
    estado: 'PROPUESTA',
    version: null,
    derivadaDe: ref.id,
    derivadaDeVersion: escala.version ?? null,
    origen: 'CORRECCION_RRHH',
    creadoPor: actor.uid,
    creadoPorEmail: actor.email,
    creadoEn: ahora.toISOString(),
    aprobadoPor: null,
    aprobadoEn: null,
    reemplazaA: null,
    reemplazadaPor: null,
    updatedAt: ahora.toISOString(),
    updatedBy: actor.uid,
  }));
  await auditar('ESCALA_CCT_CORRECCION_PROPUESTA', actor, nuevoId, { derivadaDe: ref.id, motivo: data.motivo, cambios: r.historialItem?.cambios });
  return { ok: true, docId: nuevoId, derivada: true, cambios: (r.historialItem?.cambios as unknown[])?.length || 0 };
}

// ── aprobar ───────────────────────────────────────────────────────────────────

export async function aprobarEscala(actor: Actor, data: Record<string, unknown>, ahora = new Date()) {
  const m = await lib();
  const { ref, data: escala } = await leerEscala(String(data.docId || ''));
  const v = m.validarParaAprobar(escala);
  if (!v.ok) throw new functions.https.HttpsError('failed-precondition', `${v.codigo}${v.mes ? ` (${v.mes})` : ''}`);

  const aprobadasSnap = await db().collection('escalas_cct').where('cct', '==', escala.cct).where('estado', '==', 'APROBADA').get();
  const aprobadas = aprobadasSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Record<string, unknown> & { id: string })[];
  const version = aprobadas.reduce((n, e) => Math.max(n, Number(e.version) || 0), 0) + 1;
  const solapadas = m.aprobadasSolapadas(aprobadas, escala);
  const anterior = solapadas.sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))[0] || null;
  const diff = m.diffEscalas(anterior, escala);
  const docs = m.escalasSalarialesDesdeAprobada(escala, { escalaCctId: ref.id, version, uid: actor.uid, ahora: ahora.toISOString() });
  if (!docs.length) throw new functions.https.HttpsError('failed-precondition', 'La escala no genera ninguna fila para el cálculo.');

  const batch = db().batch();
  batch.update(ref, {
    estado: 'APROBADA',
    version,
    aprobadoPor: actor.uid,
    aprobadoPorEmail: actor.email,
    aprobadoEn: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoMotivo: String(data.motivo || '').slice(0, 500) || null,
    reemplazaA: anterior?.id || null,
    diffContraAnterior: limpiarParaFirestore(diff).slice(0, 500),
    escalasSalarialesIds: docs.map((d) => d.id),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
  });
  for (const s of solapadas) {
    batch.update(db().collection('escalas_cct').doc(s.id), {
      estado: 'REEMPLAZADA', reemplazadaPor: ref.id, reemplazadaEn: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  // escalas_salariales: las filas nuevas ACTIVE; las ACTIVE viejas de la misma categoría que solapan pasan a REEMPLAZADA.
  const activasSnap = await db().collection('escalas_salariales').where('status', '==', 'ACTIVE').where('convenio', '==', escala.cct).get();
  const nuevosIds = new Set(docs.map((d) => d.id));
  const desde = String(escala.vigenciaDesde || '').slice(0, 10);
  const hasta = String(escala.vigenciaHasta || '9999-12-31').slice(0, 10);
  let batch2 = db().batch();
  let n = 0;
  const commitSiHaceFalta = async () => { if (n >= 400) { await batch2.commit(); batch2 = db().batch(); n = 0; } };
  for (const d of activasSnap.docs) {
    if (nuevosIds.has(d.id)) continue;
    const e = d.data();
    const ed = String(e.vigenciaDesde || '').slice(0, 10);
    const eh = String(e.vigenciaHasta || '9999-12-31').slice(0, 10);
    const mismaCategoria = docs.some((x) => x.categoria === e.categoria);
    if (!mismaCategoria || !(ed <= hasta && eh >= desde)) continue;
    batch2.update(d.ref, { status: 'REEMPLAZADA', reemplazadaPor: ref.id, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    n += 1; await commitSiHaceFalta();
  }
  for (const d of docs) {
    const { id, ...resto } = d;
    batch2.set(db().collection('escalas_salariales').doc(id), limpiarParaFirestore({ ...resto, updatedAt: ahora.toISOString() }));
    n += 1; await commitSiHaceFalta();
  }
  if (n > 0) await batch2.commit();

  await auditar('ESCALA_CCT_APROBADA', actor, ref.id, { version, reemplazaA: anterior?.id || null, reemplazadas: solapadas.map((s) => s.id), filas: docs.length, diffs: diff.length, motivo: data.motivo || null });
  await avisarEscalaCct(db(), NOVEDAD_ESCALA_APROBADA, ref.id, escala, { empresaId: (escala.empresaId as string) || null, detalle: `Versión ${version}.` })
    .catch((e) => console.warn('[gestionarEscalaCct] aviso:', (e as Error)?.message));
  return { ok: true, docId: ref.id, version, reemplazaA: anterior?.id || null, filas: docs.length, diffs: diff.length };
}

// ── rechazar ──────────────────────────────────────────────────────────────────

export async function rechazarEscala(actor: Actor, data: Record<string, unknown>) {
  const { ref, data: escala } = await leerEscala(String(data.docId || ''));
  if (escala.estado !== 'PROPUESTA') throw new functions.https.HttpsError('failed-precondition', 'Solo se rechaza una propuesta.');
  const motivo = String(data.motivo || '').trim();
  if (motivo.length < 3) throw new functions.https.HttpsError('invalid-argument', 'MOTIVO_REQUERIDO');
  await ref.update({
    estado: 'RECHAZADA', rechazadoPor: actor.uid, rechazadoPorEmail: actor.email, rechazadoEn: admin.firestore.FieldValue.serverTimestamp(), rechazoMotivo: motivo.slice(0, 500),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor.uid,
  });
  await auditar('ESCALA_CCT_RECHAZADA', actor, ref.id, { motivo });
  return { ok: true, docId: ref.id };
}

// ── importar ──────────────────────────────────────────────────────────────────

export async function importarPropuesta(actor: Actor, data: Record<string, unknown>) {
  const propuesta = data.propuesta as Record<string, unknown> | undefined;
  if (!propuesta || !esPropuesta(propuesta as never) || !Array.isArray(propuesta.tramos) || !propuesta.documentoHash) {
    throw new functions.https.HttpsError('invalid-argument', 'La propuesta no tiene el formato del extractor.');
  }
  const r = await guardarPropuestaEscala(db(), propuesta as never, {
    uid: actor.uid, email: actor.email, empresaId: (data.empresaId as string) || null, origen: 'IMPORT',
  });
  if (!r.yaExistia) {
    await avisarEscalaCct(db(), NOVEDAD_ESCALA_PROPUESTA, r.docId, propuesta, { empresaId: (data.empresaId as string) || null, detalle: 'Importada manualmente; pendiente de aprobación.' })
      .catch((e) => console.warn('[escalas] aviso import:', (e as Error)?.message));
  }
  return { ok: true, docId: r.docId, yaExistia: r.yaExistia };
}

// ── callable ──────────────────────────────────────────────────────────────────

export async function gestionarEscalaCctHandler(data: Record<string, unknown>, context: functions.https.CallableContext) {
  const actor = await exigirEventualesUpdate(context);
  const accion = String(data?.accion || '');
  if (accion === 'editar') return editarEscala(actor, data);
  if (accion === 'aprobar') return aprobarEscala(actor, data);
  if (accion === 'rechazar') return rechazarEscala(actor, data);
  if (accion === 'importar') return importarPropuesta(actor, data);
  throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${accion}`);
}

export const gestionarEscalaCct = functions.https.onCall(gestionarEscalaCctHandler);
