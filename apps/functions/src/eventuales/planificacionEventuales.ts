/**
 * Eventuales en Planificación y Eventos.
 *
 *  - listarCandidatosEventuales: bolsa filtrada para un hueco (empresa del objetivo, sin cruce 12 h en el grupo).
 *  - asignarEventualPlanificacion: legajo EVENTUAL en la empresa + turnos (o solo legajo si la grilla los guarda).
 *  - sustituirEventualPlanificacion: pasa los turnos futuros del titular al sustituto (baja/alta automáticas).
 *  - onTurnoEventualWrite: cada turno `esEventual` recalcula el contrato de (empresa, CUIL, mes).
 *
 * Candidatura: el ÚNICO motor es `eventualesParaHueco` (`eventos/eventoCoverage.ts`, espejo de
 * ops-core) vía `evaluarEventualesServer`; el mismo que usan el CC, la cascada y la convocatoria de
 * evento. Contrato: reglas puras en apps/web2/src/lib/eventuales/planificacion.mjs. El contrato queda
 * BORRADOR mientras los turnos son `draft`; al publicar (draft:false) pasa a CONFIRMADO y nace el envío AT.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { CONVOCATORIA_TIMEOUT_MINUTES } from '../coverage/convocatoriaTimeout';
import { escribirTurnoEvento } from '../eventos/turnoEvento';
import type { EventualBolsaRow, EventualCandidato, EventualTramo } from '../eventos/eventoCoverage';
import { evaluarEventualesServer } from '../eventos/eventualesParaHuecoServer';
import { reservarTopeHoras } from './topeHorasEventual';

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];
const AR_OFFSET = '-03:00';

type Jornada = { fecha: string; horaInicio: string; horaFin: string; horas: number; empresaId?: string | null };
type TurnoIn = { fecha: string; code: string; horaInicio: string; horaFin: string; horas: number; name?: string; positionName?: string };

type LibPlanificacion = {
  jornadasDeTurnos: (t: unknown[]) => (Jornada & { objectiveId?: string | null; turnoId?: string | null })[];
  planContratoDesdeTurnos: (i: Record<string, unknown>) => {
    accion: 'SIN_CAMBIOS' | 'CREAR' | 'ACTUALIZAR' | 'CERRAR';
    contrato: Record<string, unknown> | null;
    envios: Record<string, unknown>[];
    patchesEnvios: { id: string; patch: Record<string, unknown> }[];
  };
  contratoIdDe: (e: string, c: string, p: string) => string;
  arcaEnvioIdDe: (contratoId: string, envio: Record<string, unknown>, enviosActuales?: { id?: string }[]) => string;
  periodoDe: (f: string) => string;
};

function db() {
  return admin.firestore();
}

async function lib(): Promise<LibPlanificacion> {
  return await import('../eventuales-shared/planificacion.mjs') as unknown as LibPlanificacion;
}

async function permisosDe(uid: string, claimRole: string): Promise<{ super: boolean; acciones: string[] }> {
  if (SUPER.includes(claimRole)) return { super: true, acciones: [] };
  const sys = await db().collection('system_users').doc(uid).get();
  const roleId = String(sys.data()?.role || claimRole || '');
  if (SUPER.includes(roleId)) return { super: true, acciones: [] };
  if (!roleId) return { super: false, acciones: [] };
  const rol = await db().collection('roles').doc(roleId).get();
  return { super: false, acciones: (rol.data()?.permissions?.EVENTUALES || []) as string[] };
}

async function exigirConvocar(context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const permiso = await permisosDe(context.auth.uid, String(context.auth.token.role || ''));
  if (permiso.super || permiso.acciones.includes('convocar')) return context.auth;
  throw new functions.https.HttpsError('permission-denied', 'No tenés permiso para convocar eventuales.');
}

function hoyAr(): string {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

function tsAr(fecha: string, hhmm: string): admin.firestore.Timestamp {
  const [h, m] = hhmm.split(':').map(Number);
  return admin.firestore.Timestamp.fromDate(new Date(`${fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000${AR_OFFSET}`));
}

function validarJornada(j: Partial<Jornada>): j is Jornada {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(j?.fecha || ''))
    && /^\d{1,2}:\d{2}$/.test(String(j?.horaInicio || ''))
    && /^\d{1,2}:\d{2}$/.test(String(j?.horaFin || ''));
}

/** Turnos del CUIL en todo el grupo dentro de [desde, hasta] (fechas AR). */
async function turnosDelCuil(cuil: string, desde: string, hasta: string) {
  const snap = await db().collection('turnos')
    .where('bolsaCuil', '==', cuil)
    .where('scheduleDate', '>=', desde)
    .where('scheduleDate', '<=', hasta)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string }));
}

/** Jornada AR (fecha + HH:MM) → tramo en ms. Fin ≤ inicio = cruza la medianoche. */
function tramoDe(j: Jornada): EventualTramo {
  const startMs = tsAr(j.fecha, j.horaInicio).toMillis();
  let endMs = tsAr(j.fecha, j.horaFin).toMillis();
  if (endMs <= startMs) endMs += 24 * 3600000;
  return { startMs, endMs, fecha: j.fecha, ...(Number(j.horas) > 0 ? { horas: Number(j.horas) } : {}) };
}

/** Ventana de turnos ocupados: ±2 días alrededor de las jornadas (la misma de siempre en Planificación). */
function ventanaDe(jornadas: Jornada[]): { desde: string; hasta: string } {
  const fechas = jornadas.map((j) => j.fecha).sort();
  return { desde: sumarDias(fechas[0], -2), hasta: sumarDias(fechas[fechas.length - 1], 2) };
}

/**
 * Candidatos de Planificación con el motor único. `bolsa` acotada = evaluar una ficha (asignar,
 * convocar, aceptar, sustituir); sin `bolsa` = toda la bolsa DISPONIBLE (listar).
 */
async function candidatosEventuales(p: {
  empresaId: string;
  jornadas: Jornada[];
  objetivoGeo: { lat: number; lng: number } | null;
  bolsa?: EventualBolsaRow[];
  excluirTurnoIds?: Set<string>;
}): Promise<EventualCandidato[]> {
  return evaluarEventualesServer(db(), {
    empresaId: p.empresaId,
    tramos: p.jornadas.map(tramoDe),
    lat: p.objetivoGeo?.lat ?? null,
    lng: p.objetivoGeo?.lng ?? null,
    hoyYmd: hoyAr(),
    bolsa: p.bolsa,
    excluirTurnoIds: p.excluirTurnoIds,
    incluirNoElegibles: true,
    ventana: ventanaDe(p.jornadas),
  });
}

/** Evalúa una ficha para esas jornadas; lanza `failed-precondition` con el motivo si no es elegible. */
async function exigirElegible(bolsa: Record<string, unknown> & { cuil: string }, empresaId: string, jornadas: Jornada[], objetivoGeo: { lat: number; lng: number } | null): Promise<EventualCandidato> {
  const [evaluacion] = await candidatosEventuales({ empresaId, jornadas, objetivoGeo, bolsa: [bolsa as unknown as EventualBolsaRow] });
  if (!evaluacion) throw new functions.https.HttpsError('failed-precondition', 'NO_ELEGIBLE');
  if (!evaluacion.elegible) throw new functions.https.HttpsError('failed-precondition', evaluacion.motivo || evaluacion.motivoCodigo || 'NO_ELEGIBLE');
  return evaluacion;
}

/** Transacción del tope: no escribe el turno si estas jornadas pasan el cupo de horas de la empresa. */
async function exigirTope(empresaId: string, cuil: string, jornadas: Jornada[], excluirTurnoIds?: Set<string>) {
  const reserva = await reservarTopeHoras(db(), {
    empresaId,
    cuil,
    jornadas: jornadas.map((j) => {
      const [h, min] = String(j.horaInicio || '').split(':');
      const horaInicio = `${String(h || '0').padStart(2, '0')}:${String(min || '00').padStart(2, '0')}`;
      return { fecha: j.fecha, horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0 };
    }),
    excluirTurnoIds,
  });
  if (reserva.ok === false) throw new functions.https.HttpsError('failed-precondition', reserva.mensaje);
}

/** Forma que consumen `EventualesCandidatosPanel` (escritorio) y `PlanificacionMovil` (celular). */
function candidatoParaPanel(c: EventualCandidato, empresaId: string) {
  const legajo = (c.legajos || []).find((l) => String(l.empresaId || '') === empresaId && String(l.employeeId || '').trim());
  return {
    cuil: c.cuil,
    nombre: c.nombre,
    telefono: c.telefono,
    distanciaKm: c.distanciaKm,
    confiabilidad: c.confiabilidadInformada ? c.confiabilidad : null,
    vencimientos: c.vencimientos,
    alertas: c.alertas,
    elegible: c.elegible,
    motivoCodigo: c.motivoCodigo,
    motivo: c.motivo,
    ...(typeof c.puntaje === 'number' ? { puntaje: c.puntaje } : {}),
    ...(c.pruebasSinMarco ? { pruebasSinMarco: true } : {}),
    ...(c.horasMes ? { horasMes: c.horasMes } : {}),
    genero: c.genero || '',
    employeeId: legajo?.employeeId || null,
  };
}

async function objetivoGeoDe(empresaId: string, clientId: string | null, objectiveId: string | null, geoIn: unknown) {
  const g = geoIn as { lat?: unknown; lng?: unknown } | null;
  if (g && Number.isFinite(Number(g.lat)) && Number.isFinite(Number(g.lng)) && Number(g.lat) !== 0) return { lat: Number(g.lat), lng: Number(g.lng) };
  if (!objectiveId) return null;
  const snap = clientId
    ? [await db().collection('clients').doc(clientId).get()].filter((d) => d.exists)
    : (await db().collection('clients').where('empresaId', '==', empresaId).get()).docs;
  for (const d of snap) {
    const obj = ((d.data()?.objetivos || []) as Record<string, unknown>[]).find((o) => (o.id || o.name) === objectiveId);
    if (obj && Number.isFinite(Number(obj.lat)) && Number.isFinite(Number(obj.lng))) return { lat: Number(obj.lat), lng: Number(obj.lng) };
  }
  return null;
}

async function bolsaDe(cuil: string) {
  const snap = await db().collection('eventuales_bolsa').doc(cuil).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'El eventual no está en la bolsa.');
  return { cuil: snap.id, ...(snap.data() as Record<string, unknown>) } as Record<string, unknown> & { cuil: string };
}

function nombrePartes(nombre: string) {
  const [ap, nom] = String(nombre || '').split(',').map((s) => s.trim());
  return nom ? { lastName: ap, firstName: nom } : { lastName: '', firstName: ap || '' };
}

/** Legajo EVENTUAL del CUIL en la empresa. Lo crea si no existe y lo registra en la bolsa. */
async function asegurarLegajo(bolsa: Record<string, unknown> & { cuil: string }, empresaId: string, actorUid: string): Promise<string> {
  const legajos = (bolsa.legajos || []) as { empresaId?: string; employeeId?: string }[];
  const previo = legajos.find((l) => l.empresaId === empresaId && l.employeeId);
  if (previo?.employeeId) {
    const doc = await db().collection('empleados').doc(previo.employeeId).get();
    if (doc.exists) {
      const patch: Record<string, unknown> = {};
      if (String(doc.data()?.status || '').toLowerCase() === 'inactivo') Object.assign(patch, { status: 'activo', reactivadoAt: admin.firestore.FieldValue.serverTimestamp() });
      // El push de la convocatoria sale por `empleados.uid`: si el acceso a la app se creó después del legajo, se completa acá.
      if (bolsa.uid && !doc.data()?.uid) patch.uid = bolsa.uid;
      // Género de la ficha → legajo (cupo por género en eventos).
      if (bolsa.genero && !doc.data()?.genero) patch.genero = String(bolsa.genero);
      if (Object.keys(patch).length) await doc.ref.update(patch);
      return previo.employeeId;
    }
  }
  const existente = await db().collection('empleados').where('bolsaCuil', '==', bolsa.cuil).where('empresaId', '==', empresaId).limit(1).get();
  let employeeId: string;
  if (!existente.empty) {
    employeeId = existente.docs[0].id;
  } else {
    const geo = bolsa.domicilioGeo as { lat?: unknown; lon?: unknown } | null;
    const ref = db().collection('empleados').doc();
    await ref.set({
      empresaId,
      name: String(bolsa.nombre || ''),
      ...nombrePartes(String(bolsa.nombre || '')),
      cuil: bolsa.cuil,
      dni: bolsa.dni || '',
      genero: String(bolsa.genero || ''),
      phone: bolsa.telefono || '',
      email: bolsa.mail || '',
      address: bolsa.domicilio || '',
      lat: geo && Number.isFinite(Number(geo.lat)) ? Number(geo.lat) : null,
      lng: geo && Number.isFinite(Number(geo.lon)) ? Number(geo.lon) : null,
      modalidad: 'EVENTUAL',
      bolsaCuil: bolsa.cuil,
      status: 'activo',
      preferredObjectiveId: null,
      uid: bolsa.uid || null,
      obraSocialRnos: bolsa.obraSocialRnos || '',
      modalidadHistory: [{ modalidad: 'EVENTUAL', desde: hoyAr(), motivo: 'ALTA', setByUid: actorUid, setAt: new Date().toISOString() }],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'PLANIFICADOR_EVENTUALES',
    });
    employeeId = ref.id;
  }
  await db().collection('eventuales_bolsa').doc(bolsa.cuil).set({
    legajos: [...legajos.filter((l) => l.empresaId !== empresaId), { empresaId, employeeId, modalidad: 'EVENTUAL' }],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return employeeId;
}

async function cronogramaPublicado(objectiveId: string, fecha: string): Promise<boolean> {
  const [y, m] = fecha.split('-').map(Number);
  const snap = await db().collection('planificacion_estados').doc(`${objectiveId}_${y}_${m}`).get();
  return !!snap.data()?.publishedAt;
}

async function auditar(action: string, actorUid: string, empresaId: string, cuil: string, details: string, extra: Record<string, unknown> = {}) {
  await db().collection('audit_logs').add({
    action,
    module: 'PLANNING',
    actorUid,
    actorName: actorUid,
    empresaId,
    bolsaCuil: cuil,
    details,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });
}

// ── Contrato ──────────────────────────────────────────────────────────────────

async function txtBajaDesistimiento(empresaId: string, contrato: Record<string, unknown>, cuil: string, bolsa: Record<string, unknown>, envio: Record<string, unknown>) {
  try {
    const { lineaMovimientoArca } = await import('../eventuales-shared/arcaTxt.mjs') as {
      lineaMovimientoArca: (i: Record<string, unknown>) => { linea: string; advertencias: string[]; enviable: boolean };
    };
    const { OBSERVACION_INTERNA_NO_PRESENTACION } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
      OBSERVACION_INTERNA_NO_PRESENTACION: string;
    };
    const empresa = { id: empresaId, ...((await db().collection('empresas').doc(empresaId).get()).data() || {}) };
    const fechaBaja = String(envio.fechaBaja || envio.fechaInicio || contrato.fechaAlta || '');
    const out = lineaMovimientoArca({
      contrato: { ...contrato, fechaAlta: envio.fechaInicio || contrato.fechaAlta },
      cuil,
      bruto: 0,
      obraSocial: bolsa.obraSocialRnos || '',
      empresa,
      movimiento: 'BT',
      revista: envio.revista || '30',
      fechaBaja,
    });
    const advertencias = [...out.advertencias];
    if (envio.avisoFeriados) advertencias.push(String(envio.avisoFeriados));
    return {
      txt: out.linea,
      advertencias,
      enviable: out.enviable,
      bruto: 0,
      sinDevengamiento: true,
      devengaArt: false,
      observacionesInternas: OBSERVACION_INTERNA_NO_PRESENTACION,
    };
  } catch (e) {
    return { txt: null, advertencias: ['TXT_NO_GENERADO', (e as Error)?.message || ''], enviable: false, bruto: 0 };
  }
}

async function txtDe(empresaId: string, contrato: Record<string, unknown>, cuil: string, bolsa: Record<string, unknown>, tipo: 'AT' | 'BT') {
  try {
    const { lineasCargaMasiva, brutoParaTxt } = await import('../eventuales-shared/arcaTxt.mjs') as {
      lineasCargaMasiva: (i: Record<string, unknown>) => { lineas: string[]; advertencias: string[]; enviable: boolean };
      brutoParaTxt: (i: Record<string, unknown>) => { ok: boolean; codigo?: string; bruto: number };
    };
    const empresa = { id: empresaId, ...((await db().collection('empresas').doc(empresaId).get()).data() || {}) };
    const escalasSnap = await db().collection('escalas_salariales').where('status', '==', 'ACTIVE').get();
    const bruto = brutoParaTxt({ contrato, escalas: escalasSnap.docs.map((d) => d.data()) });
    const out = lineasCargaMasiva({ contrato, cuil, bruto: bruto.bruto, obraSocial: bolsa.obraSocialRnos || '', empresa });
    const advertencias = [...out.advertencias];
    if (!bruto.ok) advertencias.push('RETRIBUCION_PENDIENTE');
    if (tipo === 'AT') {
      try {
        const { advertenciaRelacionActivaEmpleador } = await import('../eventuales-shared/verificacionAlta.mjs') as {
          advertenciaRelacionActivaEmpleador: (i: Record<string, unknown>) => string | null;
        };
        const empSnap = await db().collection('empleados').where('cuil', '==', cuil).limit(20).get();
        const empSnap2 = empSnap.empty
          ? await db().collection('empleados').where('cuit', '==', cuil).limit(20).get()
          : empSnap;
        const empresasSnap = await db().collection('empresas').limit(80).get();
        const rel = advertenciaRelacionActivaEmpleador({
          cuil,
          empresaId,
          empresaCuit: (empresa as { cuit?: string }).cuit || '',
          empleados: empSnap2.docs.map((d) => ({ id: d.id, ...d.data() })),
          empresas: empresasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        });
        if (rel) advertencias.push(rel);
      } catch (e) {
        console.warn('[planificacionEventuales] advertencia relación activa', (e as Error)?.message || e);
      }
    }
    return {
      txt: tipo === 'AT' ? out.lineas[0] : out.lineas[1],
      advertencias,
      enviable: out.enviable && bruto.ok,
      bruto: bruto.bruto,
    };
  } catch (e) {
    return { txt: null, advertencias: ['TXT_NO_GENERADO', (e as Error)?.message || ''], enviable: false, bruto: 0 };
  }
}

/**
 * Recalcula el contrato (empresa, CUIL, mes) desde los turnos. Idempotente: si no hay cambios no escribe.
 * Único escritor de `contratos_eventuales` origen PLANIFICADOR y de sus `arca_envios`.
 */
export async function sincronizarContratoEventual(empresaId: string, cuil: string, periodo: string, actorUid = 'SYSTEM'): Promise<{ accion: string; contratoId: string; estado: string | null }> {
  const { planContratoDesdeTurnos, contratoIdDe, arcaEnvioIdDe } = await lib();
  const contratoId = contratoIdDe(empresaId, cuil, periodo);
  const bolsaSnap = await db().collection('eventuales_bolsa').doc(cuil).get();
  const bolsa = { cuil, ...(bolsaSnap.data() || {}) } as Record<string, unknown> & { cuil: string };
  const turnos = (await turnosDelCuil(cuil, `${periodo}-01`, `${periodo}-31`)).filter((t) => String(t.empresaId || '') === empresaId);
  const contratoRef = db().collection('contratos_eventuales').doc(contratoId);
  const { vencerAnulacionesPendientes } = await import('./eventualNoSePresento');
  await vencerAnulacionesPendientes(db(), Date.now());
  const [contratoSnap, enviosSnap] = await Promise.all([
    contratoRef.get(),
    db().collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get(),
  ]);
  const contratoActual = contratoSnap.exists ? { id: contratoSnap.id, ...contratoSnap.data() } : null;
  const enviosActuales = enviosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const legajo = ((bolsa.legajos || []) as { empresaId?: string; employeeId?: string }[]).find((l) => l.empresaId === empresaId);
  const employeeId = legajo?.employeeId || (turnos[0]?.employeeId as string | undefined) || null;

  const feriadosSnap = await db().collection('feriados').get();
  const empresaSnap = await db().collection('empresas').doc(empresaId).get();
  const plan = planContratoDesdeTurnos({
    empresaId, bolsa, employeeId, turnos, contratoActual, enviosActuales, ahoraMs: Date.now(),
    feriados: feriadosSnap.docs.map((d) => d.data()),
    arcaEventuales: (empresaSnap.data() || {}).arcaEventuales || null,
  });
  const estado = (plan.contrato?.estado as string | undefined) || null;
  if (plan.accion === 'SIN_CAMBIOS') {
    await marcarTurnosConContrato(turnos, contratoId, enviosActuales);
    return { accion: plan.accion, contratoId, estado };
  }

  const batch = db().batch();
  const { id: _omit, ...contratoDoc } = (plan.contrato || {}) as Record<string, unknown> & { id?: string };
  void _omit;
  batch.set(contratoRef, {
    ...contratoDoc,
    periodo,
    bolsaCuil: cuil,
    empresaId,
    createdAt: contratoActual ? (contratoActual as Record<string, unknown>).createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  }, { merge: true });
  for (const envio of plan.envios) {
    const tipo = String(envio.tipo);
    const txt = tipo === 'ANULACION'
      ? { txt: null, advertencias: envio.avisoFeriados ? [String(envio.avisoFeriados)] : [], enviable: false, bruto: 0, carga: 'MANUAL_WEB' }
      : tipo === 'BAJA_NO_PRESENTACION'
        ? await txtBajaDesistimiento(empresaId, plan.contrato || {}, cuil, bolsa, envio)
        : tipo === 'AT' || tipo === 'BT'
          ? await txtDe(empresaId, plan.contrato || {}, cuil, bolsa, tipo as 'AT' | 'BT')
          : { txt: null, advertencias: ['MOVIMIENTO_A_CONFIRMAR_CON_CONTADOR'], enviable: false, bruto: 0 };
    // Id determinístico: la callable y el trigger `onTurnoEventualWrite` corren a la vez y escriben el mismo doc.
    batch.set(db().collection('arca_envios').doc(arcaEnvioIdDe(contratoId, envio, enviosActuales)), {
      ...envio,
      contratoIds: [contratoId],
      bolsaCuil: cuil,
      txt: txt.txt,
      advertencias: txt.advertencias,
      enviable: txt.enviable,
      bruto: txt.bruto,
      origen: null,
      nroTransaccion: null,
      constanciaUrl: null,
      driveFileId: null,
      intentos: [],
      token: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'PLANIFICADOR_EVENTUALES',
    });
  }
  for (const { id, patch } of plan.patchesEnvios) {
    const { regenerarTxt, ...resto } = patch as Record<string, unknown> & { regenerarTxt?: boolean };
    const extra = regenerarTxt ? await txtDe(empresaId, plan.contrato || {}, cuil, bolsa, 'AT') : {};
    batch.update(db().collection('arca_envios').doc(id), { ...resto, ...extra, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  await batch.commit();
  const enviosLuego = (await db().collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get()).docs.map((d) => ({ id: d.id, ...d.data() })) as ({ id: string; tipo?: string; constanciaInasistencia?: unknown } & Record<string, unknown>)[];
  const { anotarNoPresentacion } = await import('./eventualNoSePresento');
  for (const envio of enviosLuego) {
    if (envio.tipo !== 'BAJA_NO_PRESENTACION' && envio.tipo !== 'ANULACION') continue;
    if (envio.constanciaInasistencia) continue;
    await anotarNoPresentacion(db(), {
      envioId: String(envio.id),
      empresaId,
      cuil,
      empleadoId: String(employeeId || ''),
      actorUid,
    });
  }
  await marcarTurnosConContrato(turnos, contratoId, enviosLuego);
  if (estado === 'ANULADO') {
    const { propagarAltaEnTurnos } = await import('../arca/altaArcaDenorm');
    await propagarAltaEnTurnos(db(), { contratoIds: [contratoId], encender: false });
  }
  await auditar('EVENTUAL_CONTRATO_' + plan.accion, actorUid, empresaId, cuil, `Contrato ${contratoId} → ${estado}. Envíos: ${plan.envios.map((e) => e.tipo).join(', ') || 'ninguno'}.`, { contratoId });
  return { accion: plan.accion, contratoId, estado };
}

/** Denormaliza en los turnos el contrato y si el alta ARCA ya está confirmada (gate de fichada). Solo escribe si cambia. */
async function marcarTurnosConContrato(turnos: (Record<string, unknown> & { id: string })[], contratoId: string, envios: Record<string, unknown>[]) {
  // Mismo criterio que propagarAltaEnTurnos: con el nro de ENVIADO ya ficha (la verificación sigue aparte).
  const alta = envios.find((e) => e.tipo === 'AT' && ['CONFIRMADO', 'ENVIADO', 'VERIFICAR'].includes(String(e.estado || '')) && !e.quitadoDelLote);
  const altaOk = !!alta;
  const nro = String(alta?.nroTransaccion || '').trim();
  const batch = db().batch();
  let n = 0;
  for (const t of turnos) {
    const mismoFlag = (t.eventualAltaArcaConfirmada === true) === altaOk;
    const mismoNro = !altaOk || String(t.nroTransaccion || '') === nro;
    if (t.eventualContratoId === contratoId && mismoFlag && mismoNro) continue;
    batch.update(db().collection('turnos').doc(t.id), {
      eventualContratoId: contratoId,
      eventualAltaArcaConfirmada: altaOk,
      ...(altaOk && nro ? { nroTransaccion: nro } : {}),
    });
    n += 1;
  }
  if (n) await batch.commit();
}

// ── Callables ─────────────────────────────────────────────────────────────────

export const listarCandidatosEventuales = functions.https.onCall(async (data, context) => {
  await exigirConvocar(context);
  const empresaId = String(data?.empresaId || '');
  const jornadas = ((data?.jornadas || []) as Partial<Jornada>[]).filter(validarJornada).map((j) => ({ ...j, horas: Number(j.horas) || 0 }));
  if (!empresaId || !jornadas.length) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o jornadas.');
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, data?.objectiveId ? String(data.objectiveId) : null, data?.objetivoGeo);
  const excluir = new Set<string>(((data?.excluirTurnoIds || []) as unknown[]).map(String));
  // Toda la bolsa DISPONIBLE pasa por el motor; la lista oculta a quien no está habilitado en la
  // empresa (antes ni se consultaba) y muestra el resto con su motivo (marco, vencimientos, cruce).
  const lista = (await candidatosEventuales({ empresaId, jornadas, objetivoGeo, excluirTurnoIds: excluir }))
    .filter((c) => c.motivoCodigo !== 'EMPRESA_NO_HABILITADA' && c.motivoCodigo !== 'NO_DISPONIBLE')
    .map((c) => candidatoParaPanel(c, empresaId));
  return { candidatos: lista, total: lista.length, elegibles: lista.filter((c) => c.elegible === true).length };
});

/**
 * modo 'LEGAJO': solo asegura el legajo EVENTUAL y devuelve employeeId (la grilla guarda los turnos y los estampa).
 * modo 'TURNOS' (default): escribe los turnos (draft según cronograma; eventos siempre publicados) y sincroniza el contrato.
 */
export const asignarEventualPlanificacion = functions.https.onCall(async (data, context) => {
  const auth = await exigirConvocar(context);
  const empresaId = String(data?.empresaId || '');
  const cuil = String(data?.cuil || '');
  const modo = data?.modo === 'LEGAJO' ? 'LEGAJO' : 'TURNOS';
  const turnosIn = ((data?.turnos || []) as Partial<TurnoIn>[]).filter(validarJornada) as TurnoIn[];
  if (!empresaId || !cuil) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o CUIL.');
  if (!turnosIn.length) throw new functions.https.HttpsError('invalid-argument', 'No hay turnos para asignar.');
  const bolsa = await bolsaDe(cuil);
  const jornadas: Jornada[] = turnosIn.map((t) => ({ fecha: t.fecha, horaInicio: t.horaInicio, horaFin: t.horaFin, horas: Number(t.horas) || 0 }));
  const objectiveId = data?.objectiveId ? String(data.objectiveId) : null;
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, objectiveId, data?.objetivoGeo);
  await exigirElegible(bolsa, empresaId, jornadas, objetivoGeo);
  await exigirTope(empresaId, cuil, jornadas);

  const employeeId = await asegurarLegajo(bolsa, empresaId, auth.uid);
  if (modo === 'LEGAJO') {
    await auditar('EVENTUAL_LEGAJO_PLANIFICACION', auth.uid, empresaId, cuil, `${bolsa.nombre}: legajo ${employeeId} listo para la grilla (${jornadas.length} turno/s).`, { employeeId, objectiveId });
    return { ok: true, employeeId, nombre: bolsa.nombre };
  }

  const evento = data?.evento as EventoRef | null;
  // Asignación directa a un servicio de evento: cuenta contra el cupo (por género) al momento.
  let extraTurno: Record<string, unknown> | undefined;
  if (evento?.eventoId && evento.servicioId) {
    const { reservarCupo, camposCupoTurno } = await import('../eventos/cupoEvento');
    const reserva = await reservarCupo(db(), { eventoId: String(evento.eventoId), servicioId: String(evento.servicioId), empleadoId: employeeId, bolsaCuil: cuil, esEventual: true });
    if (!reserva.ok) throw new functions.https.HttpsError('failed-precondition', reserva.mensaje, { codigo: reserva.motivo, grupo: reserva.grupo });
    extraTurno = camposCupoTurno(reserva);
  }
  const { turnoIds, contratos } = await escribirTurnosEventual({
    bolsa, empresaId, employeeId, turnosIn, evento, objectiveId,
    objectiveName: data?.objectiveName ? String(data.objectiveName) : null,
    clientId: data?.clientId ? String(data.clientId) : null,
    clientName: data?.clientName ? String(data.clientName) : null,
    positionName: data?.positionName ? String(data.positionName) : null,
    cubreA: (data?.cubreA as CubreA | null) || null,
    actorUid: auth.uid,
    actorName: String(auth.token.email || auth.uid),
    ...(extraTurno ? { extraTurno } : {}),
  });
  if (evento?.eventoId && evento.servicioId) {
    const { cerrarPendientesPorCupo } = await import('../eventos/cupoEvento');
    await cerrarPendientesPorCupo(db(), { eventoId: String(evento.eventoId), servicioId: String(evento.servicioId), actor: auth.uid });
  }
  await auditar('EVENTUAL_ASIGNADO_PLANIFICACION', auth.uid, empresaId, cuil, `${bolsa.nombre} asignado a ${data?.objectiveName || objectiveId || evento?.eventoNombre || '—'}: ${turnosIn.length} turno/s (${turnosIn.map((t) => `${t.fecha} ${t.code || 'EV'}`).join(', ')}).`, { employeeId, objectiveId, turnoIds });
  return { ok: true, employeeId, turnoIds, contratos };
});

type EventoRef = { eventoId?: string; eventoNombre?: string; servicioId?: string; servicioNombre?: string };
type CubreA = { employeeId?: string; employeeName?: string; shiftIds?: unknown[] };

/**
 * Escribe los turnos del eventual (draft según cronograma; eventos siempre publicados) y sincroniza
 * el contrato de cada mes. Único camino para Planificación y para la aceptación de un evento.
 */
async function escribirTurnosEventual(p: {
  bolsa: Record<string, unknown> & { cuil: string };
  empresaId: string;
  employeeId: string;
  turnosIn: TurnoIn[];
  evento: EventoRef | null;
  objectiveId: string | null;
  objectiveName: string | null;
  clientId: string | null;
  clientName: string | null;
  positionName: string | null;
  cubreA: CubreA | null;
  actorUid: string;
  actorName: string;
  extraTurno?: Record<string, unknown>;
}): Promise<{ turnoIds: string[]; contratos: { accion: string; contratoId: string; estado: string | null }[] }> {
  const { periodoDe } = await lib();
  const { camposTurnoDesdeSwitches } = await import('../eventuales-shared/pruebasSwitch.mjs') as { camposTurnoDesdeSwitches: (b: unknown) => Record<string, unknown> };
  const { bolsa, empresaId, employeeId, turnosIn, evento, objectiveId } = p;
  const cuil = bolsa.cuil;
  const publicadoPorFecha = new Map<string, boolean>();
  const batch = db().batch();
  let writes = 0;
  const turnoIds: string[] = [];
  for (const t of turnosIn) {
    let draft = false;
    if (!evento && objectiveId) {
      const clave = t.fecha.slice(0, 7);
      if (!publicadoPorFecha.has(clave)) publicadoPorFecha.set(clave, await cronogramaPublicado(objectiveId, t.fecha));
      draft = !publicadoPorFecha.get(clave);
    }
    if (evento) {
      const escrito = await escribirTurnoEvento(db(), {
        empresaId,
        employeeId,
        employeeName: bolsa.nombre,
        eventoId: evento.eventoId,
        eventoNombre: evento.eventoNombre,
        servicioId: evento.servicioId,
        servicioNombre: t.positionName || p.positionName || evento.servicioNombre || 'Evento',
        servicioFecha: t.fecha,
        horaInicio: t.horaInicio,
        horaFin: t.horaFin,
        horas: t.horas,
        clientId: p.clientId,
        clientName: p.clientName,
        extra: {
          esEventual: true,
          bolsaCuil: cuil,
          eventualAltaArcaConfirmada: false,
          ...camposTurnoDesdeSwitches(bolsa),
          ...(p.cubreA?.employeeName ? { comments: `Cubriendo a ${String(p.cubreA.employeeName)}`, coversEmployeeId: p.cubreA.employeeId || null } : { comments: 'Eventual (bolsa)' }),
          ...(p.extraTurno || {}),
          actorName: p.actorName,
          createdBy: 'PLANIFICADOR_EVENTUALES',
        },
      });
      turnoIds.push(escrito.turnoId);
      continue;
    }
    const start = tsAr(t.fecha, t.horaInicio);
    let end = tsAr(t.fecha, t.horaFin);
    if (end.toMillis() <= start.toMillis()) end = admin.firestore.Timestamp.fromMillis(end.toMillis() + 24 * 3600000);
    const ref = db().collection('turnos').doc();
    batch.set(ref, {
      empresaId,
      employeeId,
      employeeName: bolsa.nombre,
      esEventual: true,
      bolsaCuil: cuil,
      eventualAltaArcaConfirmada: false,
      ...camposTurnoDesdeSwitches(bolsa),
      clientId: p.clientId || null,
      clientName: p.clientName || null,
      objectiveId,
      objectiveName: p.objectiveName || null,
      positionName: t.positionName || p.positionName || 'General',
      code: String(t.code || 'M').toUpperCase(),
      type: t.name || String(t.code || 'M').toUpperCase(),
      hours: Number(t.horas) || 0,
      startTime: start,
      endTime: end,
      scheduleDate: t.fecha,
      isFranco: false,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft,
      ...(p.cubreA?.employeeName ? { comments: `Cubriendo a ${String(p.cubreA.employeeName)}`, coversEmployeeId: p.cubreA.employeeId || null } : { comments: 'Eventual (bolsa)' }),
      ...(p.extraTurno || {}),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      actorName: p.actorName,
      createdBy: 'PLANIFICADOR_EVENTUALES',
    });
    turnoIds.push(ref.id);
    writes += 1;
  }
  for (const shiftId of ((p.cubreA?.shiftIds || []) as unknown[]).map(String).filter(Boolean)) {
    batch.update(db().collection('turnos').doc(shiftId), { coveredBy: bolsa.nombre, coveredByEmployeeId: employeeId, coveredByEventual: true });
    writes += 1;
  }
  if (writes) await batch.commit();

  const periodos = [...new Set(turnosIn.map((t) => periodoDe(t.fecha)))];
  const contratos = [];
  for (const periodo of periodos) contratos.push(await sincronizarContratoEventual(empresaId, cuil, periodo, p.actorUid));
  return { turnoIds, contratos };
}

// ── Eventos: convocatoria → aceptación ────────────────────────────────────────

/** Mismo plazo que una convocatoria del CC: pasado, la solicitud vence y el lugar queda libre. */
export const EVENTO_EVENTUAL_TIMEOUT_MIN = CONVOCATORIA_TIMEOUT_MINUTES;

function jornadaDeSolicitud(sol: Record<string, unknown>): Jornada | null {
  const j = (sol.jornada || null) as Partial<Jornada> | null;
  if (j && validarJornada(j)) return { fecha: j.fecha, horaInicio: j.horaInicio, horaFin: j.horaFin, horas: Number(j.horas) || 0 };
  return null;
}

/**
 * Desde el evento (EventoDetailModal → Eventuales) se CONVOCA al eventual: nace la solicitud `convocado`
 * con `esEventual` y el push lo manda `onSolicitudEventoCreated`. No se crea turno, contrato ni AT
 * hasta que acepte en la app (`respondEventoConvocatoria` → `aceptarConvocatoriaEventualEvento`).
 */
export const convocarEventualEvento = functions.https.onCall(async (data, context) => {
  const auth = await exigirConvocar(context);
  const { exigeMarco, exigeAltaArca, etiquetasPruebas } = await import('../eventuales-shared/pruebasSwitch.mjs') as LibPruebas;
  const empresaId = String(data?.empresaId || '');
  const cuil = String(data?.cuil || '').replace(/\D/g, '');
  const evento = (data?.evento || null) as EventoRef | null;
  const jornadaIn = data?.jornada as Partial<Jornada> | undefined;
  if (!empresaId || !cuil) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o CUIL.');
  if (!evento?.eventoId || !evento.servicioId) throw new functions.https.HttpsError('invalid-argument', 'Falta el evento o el servicio.');
  if (!jornadaIn || !validarJornada(jornadaIn)) throw new functions.https.HttpsError('invalid-argument', 'Falta la jornada del servicio.');
  const jornada: Jornada = { fecha: jornadaIn.fecha, horaInicio: jornadaIn.horaInicio, horaFin: jornadaIn.horaFin, horas: Number(jornadaIn.horas) || 0 };

  const bolsa = await bolsaDe(cuil);
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, null, data?.objetivoGeo);
  await exigirElegible(bolsa, empresaId, [jornada], objetivoGeo);

  const employeeId = await asegurarLegajo(bolsa, empresaId, auth.uid);
  const abiertas = await db().collection('solicitudes_evento')
    .where('eventoId', '==', String(evento.eventoId))
    .where('servicioId', '==', String(evento.servicioId))
    .where('empleadoId', '==', employeeId)
    .get();
  const viva = abiertas.docs.find((d) => ['convocado', 'aprobada', 'pendiente'].includes(String(d.data().status || '')));
  if (viva) throw new functions.https.HttpsError('already-exists', `${bolsa.nombre} ya tiene una convocatoria ${String(viva.data().status)} en este servicio.`);

  // Cupo por género: la ficha sin género no entra a un servicio por género; un grupo ya lleno no recibe más convocatorias.
  const { libCupo, servicioDeEvento, ocupadosDeServicio } = await import('../eventos/cupoEvento');
  const cupoLib = await libCupo();
  const genero = cupoLib.normalizarGenero(bolsa.genero);
  const { servicio: servicioCupo } = await servicioDeEvento(db(), String(evento.eventoId), String(evento.servicioId));
  let cupoGrupo: string = 'TODOS';
  if (servicioCupo && cupoLib.estadoCupo(servicioCupo, []).cupo > 0) {
    const { ocupados } = await ocupadosDeServicio(db(), { eventoId: String(evento.eventoId), servicioId: String(evento.servicioId), excluirEmpleadoId: employeeId });
    const chequeo = cupoLib.puedeConfirmar(servicioCupo, ocupados, genero);
    if (!chequeo.ok) throw new functions.https.HttpsError('failed-precondition', chequeo.mensaje || chequeo.motivo || 'CUPO', { codigo: chequeo.motivo, grupo: chequeo.grupo });
    cupoGrupo = chequeo.grupo || 'TODOS';
  } else {
    cupoGrupo = cupoLib.grupoDeGenero(servicioCupo || {}, genero) || 'TODOS';
  }

  const venceAt = admin.firestore.Timestamp.fromMillis(Date.now() + EVENTO_EVENTUAL_TIMEOUT_MIN * 60000);
  const ref = db().collection('solicitudes_evento').doc();
  await ref.set({
    empresaId,
    eventoId: String(evento.eventoId),
    eventoNombre: String(evento.eventoNombre || ''),
    servicioId: String(evento.servicioId),
    servicioNombre: String(evento.servicioNombre || ''),
    servicioFecha: jornada.fecha,
    empleadoId: employeeId,
    empleadoNombre: String(bolsa.nombre || ''),
    tipo: 'admin_convoca',
    status: 'convocado',
    convocadoPor: auth.uid,
    esEventual: true,
    bolsaCuil: cuil,
    genero,
    cupoGrupo,
    jornada,
    clientId: data?.clientId ? String(data.clientId) : null,
    clientName: data?.clientName ? String(data.clientName) : null,
    positionName: data?.positionName ? String(data.positionName) : String(evento.servicioNombre || 'Evento'),
    exigirMarco: exigeMarco(bolsa),
    exigirAltaArca: exigeAltaArca(bolsa),
    pruebasSinMarco: !exigeMarco(bolsa),
    etiquetasPruebas: etiquetasPruebas(bolsa),
    anexoEstado: exigeMarco(bolsa) ? 'PENDIENTE_ACEPTACION' : 'NO_EXIGIDO',
    venceAt,
    timeoutMin: EVENTO_EVENTUAL_TIMEOUT_MIN,
    creadoAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await auditar('EVENTUAL_CONVOCADO_EVENTO', auth.uid, empresaId, cuil, `${bolsa.nombre} convocado a ${evento.eventoNombre || evento.eventoId} · ${evento.servicioNombre || ''} ${jornada.fecha} ${jornada.horaInicio}–${jornada.horaFin}. Vence en ${EVENTO_EVENTUAL_TIMEOUT_MIN} min.${exigeMarco(bolsa) ? '' : ' Pruebas: sin exigir marco.'}`, { employeeId, solicitudId: ref.id, eventoId: evento.eventoId });
  return { ok: true, solicitudId: ref.id, employeeId, venceAt: venceAt.toMillis(), pruebasSinMarco: !exigeMarco(bolsa) };
});

type LibPruebas = {
  exigeMarco: (b: unknown) => boolean;
  exigeAltaArca: (b: unknown) => boolean;
  etiquetasPruebas: (b: unknown) => string[];
  camposTurnoDesdeSwitches: (b: unknown) => Record<string, unknown>;
};

export type AceptacionEventual = {
  turnoIds: string[];
  contratoId: string | null;
  anexoEstado: 'PENDIENTE' | 'SIN_CANAL' | 'NO_EXIGIDO';
  anexoMensaje: string | null;
  arcaCanal: 'URGENTE' | 'LOTE' | 'CONFIRMADA' | null;
};

/**
 * El eventual aceptó desde la app. Recién acá: turno EV + contrato CONFIRMADO + AT (URGENTE si el
 * servicio empieza en < 24 h) + código del anexo (OTP por push/mail). Si no hay canal para el código,
 * la aceptación igual queda y el anexo figura «sin canal» para que RRHH lo resuelva.
 */
export async function aceptarConvocatoriaEventualEvento(
  solicitudId: string,
  sol: Record<string, unknown>,
  actor: { uid: string; email?: string | null },
  /** `cupoGrupo` / `genero` reservados por `reservarCupo` (se estampan en el turno EV). */
  camposCupo: Record<string, unknown> = {},
): Promise<AceptacionEventual> {
  const { exigeMarco } = await import('../eventuales-shared/pruebasSwitch.mjs') as LibPruebas;
  const cuil = String(sol.bolsaCuil || '').replace(/\D/g, '');
  const empresaId = String(sol.empresaId || '');
  if (!cuil || !empresaId) throw new functions.https.HttpsError('failed-precondition', 'La convocatoria no tiene eventual o empresa.');
  const venceMs = (sol.venceAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
  if (venceMs && Date.now() > venceMs) {
    await db().collection('solicitudes_evento').doc(solicitudId).update({
      status: 'vencida', vencidaAt: admin.firestore.FieldValue.serverTimestamp(), venceAt: admin.firestore.FieldValue.delete(),
    });
    throw new functions.https.HttpsError('failed-precondition', 'La convocatoria venció. Pedile al coordinador que te vuelva a convocar.');
  }
  const bolsa = await bolsaDe(cuil);
  const jornada = jornadaDeSolicitud(sol);
  if (!jornada) throw new functions.https.HttpsError('failed-precondition', 'La convocatoria no tiene horario.');
  await exigirElegible(bolsa, empresaId, [jornada], null);
  await exigirTope(empresaId, cuil, [jornada]);

  const employeeId = String(sol.empleadoId || '') || await asegurarLegajo(bolsa, empresaId, actor.uid);
  const evento: EventoRef = {
    eventoId: String(sol.eventoId || ''),
    eventoNombre: String(sol.eventoNombre || ''),
    servicioId: String(sol.servicioId || ''),
    servicioNombre: String(sol.servicioNombre || ''),
  };
  const { turnoIds, contratos } = await escribirTurnosEventual({
    bolsa, empresaId, employeeId,
    turnosIn: [{ ...jornada, code: 'EV', name: 'Evento', positionName: String(sol.positionName || evento.servicioNombre || 'Evento') }],
    evento,
    objectiveId: null,
    objectiveName: null,
    clientId: sol.clientId ? String(sol.clientId) : null,
    clientName: sol.clientName ? String(sol.clientName) : null,
    positionName: sol.positionName ? String(sol.positionName) : null,
    cubreA: null,
    actorUid: actor.uid,
    actorName: String(actor.email || actor.uid),
    extraTurno: { solicitudEventoId: solicitudId, convocadoAceptoAt: admin.firestore.FieldValue.serverTimestamp(), ...camposCupo },
  });
  const contratoId = contratos[0]?.contratoId || null;

  let arcaCanal: AceptacionEventual['arcaCanal'] = null;
  if (contratoId) {
    const envios = await db().collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get();
    const at = envios.docs.map((d) => d.data()).find((e) => e.tipo === 'AT' && !e.quitadoDelLote);
    if (at?.estado === 'CONFIRMADO') arcaCanal = 'CONFIRMADA';
    else if (at) {
      // Evento en menos de 24 h: el alta no espera al lote de las 18:00.
      const inicioMs = tsAr(jornada.fecha, jornada.horaInicio).toMillis();
      const urgente = inicioMs - Date.now() < 24 * 3600000;
      arcaCanal = urgente ? 'URGENTE' : (String(at.canal || 'LOTE') as 'URGENTE' | 'LOTE');
      if (urgente && at.canal !== 'URGENTE') {
        const atDoc = envios.docs.find((d) => d.data().tipo === 'AT' && !d.data().quitadoDelLote);
        if (atDoc) await atDoc.ref.update({ canal: 'URGENTE', urgentePorEvento: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }
  }

  let anexoEstado: AceptacionEventual['anexoEstado'] = 'NO_EXIGIDO';
  let anexoMensaje: string | null = null;
  if (exigeMarco(bolsa) && contratoId) {
    const { enviarCodigoAnexo } = await import('./marcoAnexoCall');
    const envio = await enviarCodigoAnexo({ contratoId, convocatoriaId: '', cuil, bolsa, uid: String(bolsa.uid || actor.uid || '') });
    anexoEstado = envio.ok ? 'PENDIENTE' : 'SIN_CANAL';
    anexoMensaje = envio.mensaje;
  }

  await db().collection('solicitudes_evento').doc(solicitudId).update({
    status: 'aprobada',
    respondidoAt: admin.firestore.FieldValue.serverTimestamp(),
    venceAt: admin.firestore.FieldValue.delete(),
    turnoIds,
    turnoId: turnoIds[0] || null,
    contratoId,
    anexoEstado,
    anexoMensaje,
    arcaCanal,
  });
  await auditar('EVENTUAL_ACEPTO_EVENTO', actor.uid, empresaId, cuil, `${bolsa.nombre} aceptó ${evento.eventoNombre || evento.eventoId}: turno EV ${jornada.fecha} ${jornada.horaInicio}–${jornada.horaFin}. Contrato ${contratoId || '—'}, AT ${arcaCanal || '—'}, anexo ${anexoEstado}.`, { employeeId, solicitudId, contratoId, turnoIds });
  return { turnoIds, contratoId, anexoEstado, anexoMensaje, arcaCanal };
}

/** Convocatorias de eventuales a eventos sin respuesta: vencen y el lugar queda libre. Lo corre `checkConvocatoriaTimeouts`. */
export async function vencerConvocatoriasEventualesEvento(now = admin.firestore.Timestamp.now()): Promise<number> {
  const snap = await db().collection('solicitudes_evento').where('venceAt', '<=', now).limit(50).get();
  let n = 0;
  for (const d of snap.docs) {
    const sol = d.data();
    if (String(sol.status || '') !== 'convocado') {
      await d.ref.update({ venceAt: admin.firestore.FieldValue.delete() });
      continue;
    }
    await d.ref.update({ status: 'vencida', vencidaAt: now, venceAt: admin.firestore.FieldValue.delete() });
    await auditar('EVENTUAL_CONVOCATORIA_VENCIDA', 'SYSTEM_SCHEDULER', String(sol.empresaId || ''), String(sol.bolsaCuil || ''), `${sol.empleadoNombre || ''} no respondió la convocatoria a ${sol.eventoNombre || sol.eventoId} en ${sol.timeoutMin || EVENTO_EVENTUAL_TIMEOUT_MIN} min.`, { solicitudId: d.id, eventoId: sol.eventoId || null });
    n += 1;
  }
  return n;
}

/** Los turnos del titular desde `desdeFecha` (objetivo opcional) pasan al sustituto. Contratos de ambos se recalculan. */
export const sustituirEventualPlanificacion = functions.https.onCall(async (data, context) => {
  const auth = await exigirConvocar(context);
  const { jornadasDeTurnos, periodoDe } = await lib();
  const empresaId = String(data?.empresaId || '');
  const cuilTitular = String(data?.cuilTitular || '');
  const cuilSustituto = String(data?.cuilSustituto || '');
  const desdeFecha = String(data?.desdeFecha || hoyAr());
  const objectiveId = data?.objectiveId ? String(data.objectiveId) : null;
  if (!empresaId || !cuilTitular || !cuilSustituto || !/^\d{4}-\d{2}-\d{2}$/.test(desdeFecha)) {
    throw new functions.https.HttpsError('invalid-argument', 'Faltan datos de la sustitución.');
  }
  if (cuilTitular === cuilSustituto) throw new functions.https.HttpsError('invalid-argument', 'El sustituto es la misma persona.');
  const [titular, sustituto] = await Promise.all([bolsaDe(cuilTitular), bolsaDe(cuilSustituto)]);
  const hastaFecha = data?.hastaFecha && /^\d{4}-\d{2}-\d{2}$/.test(String(data.hastaFecha)) ? String(data.hastaFecha) : `${desdeFecha.slice(0, 7)}-31`;
  const turnos = (await turnosDelCuil(cuilTitular, desdeFecha, hastaFecha))
    .filter((t) => String(t.empresaId || '') === empresaId && (!objectiveId || t.objectiveId === objectiveId) && t.isCompleted !== true && t.isPresent !== true);
  const jornadas = jornadasDeTurnos(turnos);
  if (!jornadas.length) throw new functions.https.HttpsError('failed-precondition', 'El titular no tiene turnos por sustituir en ese rango.');
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, objectiveId, data?.objetivoGeo);
  await exigirElegible(sustituto, empresaId, jornadas, objetivoGeo);
  await exigirTope(empresaId, cuilSustituto, jornadas, new Set(turnos.map((t) => t.id)));

  const employeeId = await asegurarLegajo(sustituto, empresaId, auth.uid);
  const batch = db().batch();
  const ahora = new Date().toISOString();
  for (const t of turnos) {
    batch.update(db().collection('turnos').doc(t.id), {
      employeeId,
      employeeName: sustituto.nombre,
      bolsaCuil: cuilSustituto,
      esEventual: true,
      eventualContratoId: null,
      eventualAltaArcaConfirmada: false,
      sustituyeA: { bolsaCuil: cuilTitular, employeeId: t.employeeId || null, employeeName: t.employeeName || titular.nombre, at: ahora, por: auth.uid },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  const periodos = [...new Set(jornadas.map((j) => periodoDe(j.fecha)))];
  const resultado = [];
  for (const periodo of periodos) {
    resultado.push({ periodo, titular: await sincronizarContratoEventual(empresaId, cuilTitular, periodo, auth.uid), sustituto: await sincronizarContratoEventual(empresaId, cuilSustituto, periodo, auth.uid) });
  }
  await auditar('EVENTUAL_SUSTITUIDO_PLANIFICACION', auth.uid, empresaId, cuilTitular, `${titular.nombre} → ${sustituto.nombre}: ${turnos.length} turno/s desde ${desdeFecha}${objectiveId ? ` en ${objectiveId}` : ''}.`, { sustitutoCuil: cuilSustituto, employeeId, objectiveId, turnoIds: turnos.map((t) => t.id) });
  return { ok: true, employeeId, turnoIds: turnos.map((t) => t.id), contratos: resultado };
});

// ── Trigger ───────────────────────────────────────────────────────────────────

function firmaContrato(t: Record<string, unknown> | null): string {
  if (!t) return '';
  const ms = (v: unknown) => (v as { toMillis?: () => number } | null)?.toMillis?.() ?? String(v ?? '');
  return [t.empresaId, t.bolsaCuil, t.employeeId, t.scheduleDate, t.code, t.draft === true, ms(t.startTime), ms(t.endTime), t.hours, t.isUnassigned === true].join('|');
}

/** Cada alta/cambio/baja de un turno de eventual recalcula el contrato (empresa, CUIL, mes). */
export const onTurnoEventualWrite = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('turnos/{turnoId}')
  .onWrite(async (change) => {
    const before = change.before.exists ? (change.before.data() as Record<string, unknown>) : null;
    const after = change.after.exists ? (change.after.data() as Record<string, unknown>) : null;
    if (!(before?.esEventual === true || after?.esEventual === true)) return;
    if (before && after && firmaContrato(before) === firmaContrato(after)) return;
    const { periodoDe } = await lib();
    const claves = new Set<string>();
    for (const t of [before, after]) {
      if (!t?.esEventual || !t.bolsaCuil || !t.empresaId || !t.scheduleDate) continue;
      claves.add(`${t.empresaId}|${t.bolsaCuil}|${periodoDe(String(t.scheduleDate))}`);
    }
    for (const clave of claves) {
      const [empresaId, cuil, periodo] = clave.split('|');
      try {
        await sincronizarContratoEventual(empresaId, cuil, periodo);
      } catch (e) {
        console.error('[onTurnoEventualWrite]', clave, (e as Error)?.message);
      }
    }
  });
