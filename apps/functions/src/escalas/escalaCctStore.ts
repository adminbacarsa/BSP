/**
 * Escritura de `escalas_cct` (propuestas y aprobadas) y aviso a RRHH/Eventuales.
 * Lo usan la callable `extraerEscalaCct422`, el job diario y `gestionarEscalaCct`.
 * Nunca toca `escalas_salariales` acá: eso lo hace solo la aprobación.
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { CCT_422, sha256Hex, type PropuestaEscala422 } from './escalaCct422Core';

export const NOVEDAD_ESCALA_PROPUESTA = 'ESCALA_CCT_PROPUESTA';
export const NOVEDAD_ESCALA_APROBADA = 'ESCALA_CCT_APROBADA';

export function escalaCctDocId(p: { vigenciaDesde: string | null; documentoHash: string }): string {
  return `${CCT_422}_${p.vigenciaDesde || 'sin-vigencia'}_${String(p.documentoHash || '').slice(0, 8)}`;
}

export interface GuardarPropuestaMeta {
  uid: string;
  email?: string | null;
  empresaId?: string | null;
  modelo?: string | null;
  origen: 'CALLABLE_EXTRAER' | 'JOB_DIARIO' | 'SEED' | 'IMPORT';
}

/** Idempotente por hash del documento: la misma disposición no genera dos propuestas. */
export async function guardarPropuestaEscala(
  db: Firestore,
  propuesta: PropuestaEscala422,
  meta: GuardarPropuestaMeta,
): Promise<{ docId: string; yaExistia: boolean }> {
  const docId = escalaCctDocId(propuesta);
  const ref = db.collection('escalas_cct').doc(docId);
  const existente = await ref.get();
  if (existente.exists) return { docId, yaExistia: true };
  const empresaId = meta.empresaId && String(meta.empresaId).trim() ? String(meta.empresaId).trim() : null;
  await ref.set({
    ...propuesta,
    estado: 'PROPUESTA',
    modelo: meta.modelo || null,
    empresaId,
    origen: meta.origen,
    version: null,
    historial: [],
    creadoPor: meta.uid,
    creadoPorEmail: meta.email || null,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoPor: null,
    aprobadoEn: null,
    payloadHash: sha256Hex(JSON.stringify(propuesta.tramos)),
  });
  await db.collection('audit_logs').add({
    action: 'ESCALA_CCT_PROPUESTA',
    collection: 'escalas_cct',
    docId,
    empresaId,
    userId: meta.uid,
    userEmail: meta.email || null,
    details: {
      cct: propuesta.cct, extraccion: propuesta.extraccion, origen: meta.origen,
      vigenciaDesde: propuesta.vigenciaDesde, vigenciaHasta: propuesta.vigenciaHasta,
      confianzaGlobal: propuesta.confianzaGlobal, advertencias: propuesta.advertencias.length,
    },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { docId, yaExistia: false };
}

function rotulo(p: { fuente?: { disposicion?: string | null; acuerdoNro?: string | null }; vigenciaDesde?: string | null; vigenciaHasta?: string | null }): string {
  const disp = p.fuente?.disposicion ? `Disp. ${String(p.fuente.disposicion).replace(/^DI-(\d{4})-(\d+)-.*$/, '$2/$1')}` : null;
  const partes = [disp, p.fuente?.acuerdoNro ? `Acuerdo ${p.fuente.acuerdoNro}` : null].filter(Boolean);
  const f = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '?');
  return `${partes.length ? partes.join(' · ') : 'CCT 422/05'} · vigencia ${f(p.vigenciaDesde)} → ${f(p.vigenciaHasta)}`;
}

/**
 * Novedad por empresa (una, idempotente por doc) + push a quien tenga el aviso configurado;
 * sin configuración, al rol EVENTUALES. Si falla el push, la novedad queda igual.
 */
export async function avisarEscalaCct(
  db: Firestore,
  tipo: typeof NOVEDAD_ESCALA_PROPUESTA | typeof NOVEDAD_ESCALA_APROBADA,
  docId: string,
  propuesta: Record<string, unknown>,
  opts: { empresaId?: string | null; detalle?: string } = {},
): Promise<{ novedades: number }> {
  const empresas = opts.empresaId
    ? [opts.empresaId]
    : (await db.collection('empresas').get()).docs.filter((d) => d.data()?.status !== 'INACTIVE').map((d) => d.id);
  const texto = rotulo(propuesta as never);
  const description = tipo === NOVEDAD_ESCALA_PROPUESTA
    ? `Escala salarial CCT 422/05 nueva: ${texto}. Revisala en Eventuales → Escala salarial y aprobala para que la use el anexo.${opts.detalle ? ` ${opts.detalle}` : ''}`
    : `Escala salarial CCT 422/05 aprobada: ${texto}. Los anexos nuevos ya la usan.${opts.detalle ? ` ${opts.detalle}` : ''}`;
  let novedades = 0;
  for (const empresaId of empresas) {
    const ref = db.collection('novedades').doc(`escala_${tipo === NOVEDAD_ESCALA_PROPUESTA ? 'prop' : 'aprob'}_${empresaId}_${docId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180));
    const prev = await ref.get();
    if (prev.exists) continue;
    await ref.set({
      type: tipo,
      status: 'PENDIENTE',
      empresaId,
      description,
      informational: tipo === NOVEDAD_ESCALA_APROBADA,
      escalaCctId: docId,
      link: '/admin/rrhh/eventuales/escala/',
      source: 'ESCALAS_CCT',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    novedades += 1;
    if (tipo === NOVEDAD_ESCALA_PROPUESTA) {
      await pushEventuales(db, empresaId, description).catch((e) => console.warn('[escalas_cct] push:', (e as Error)?.message));
    }
  }
  return { novedades };
}

async function pushEventuales(db: Firestore, empresaId: string, body: string): Promise<void> {
  const { resolverAvisos } = await import('../eventuales-shared/avisos.mjs') as {
    resolverAvisos: (input: Record<string, unknown>) => { pushes: { token: string }[] };
  };
  const empresa = await db.collection('empresas').doc(empresaId).get();
  const avisos = (empresa.data()?.avisos || {}) as Record<string, unknown>;
  const configured = Array.isArray(avisos[NOVEDAD_ESCALA_PROPUESTA]) && (avisos[NOVEDAD_ESCALA_PROPUESTA] as unknown[]).length > 0;
  const efectivos = configured
    ? avisos
    : { ...avisos, [NOVEDAD_ESCALA_PROPUESTA]: [{ tipo: 'ROL', rolDestino: 'EVENTUALES', canales: { push: true, mail: false, whatsapp: false } }] };
  const usersSnap = await db.collection('system_users').where('empresaId', '==', empresaId).get();
  const usuarios = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  const roleIds = [...new Set(usuarios.map((u) => String((u as { role?: string }).role || '')).filter(Boolean))];
  const roleSnaps = roleIds.length ? await db.getAll(...roleIds.map((id) => db.collection('roles').doc(id))) : [];
  const roles = roleSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));
  const tokens: { uid: string; token: string }[] = [];
  const uids = usuarios.map((u) => u.uid);
  for (let i = 0; i < uids.length; i += 10) {
    const slice = uids.slice(i, i + 10);
    if (!slice.length) continue;
    const tok = await db.collection('device_tokens').where('uid', 'in', slice).get();
    tok.docs.forEach((d) => {
      const token = d.data()?.token;
      if (typeof token === 'string' && token.length > 10) tokens.push({ uid: String(d.data()?.uid || ''), token });
    });
  }
  const resuelto = resolverAvisos({ avisos: efectivos, tipo: NOVEDAD_ESCALA_PROPUESTA, usuarios, roles, tokens });
  const pushTokens = [...new Set((resuelto.pushes || []).map((p) => p.token).filter(Boolean))];
  if (!pushTokens.length) return;
  await admin.messaging().sendEachForMulticast({
    tokens: pushTokens,
    notification: { title: 'Escala salarial nueva', body },
    data: { type: NOVEDAD_ESCALA_PROPUESTA, empresaId, link: '/admin/rrhh/eventuales/escala/' },
  });
}
