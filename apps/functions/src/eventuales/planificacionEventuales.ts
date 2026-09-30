/**
 * Eventuales en Planificación y Eventos.
 *
 *  - listarCandidatosEventuales: bolsa filtrada para un hueco (empresa del objetivo, sin cruce 12 h en el grupo).
 *  - asignarEventualPlanificacion: legajo EVENTUAL en la empresa + turnos (o solo legajo si la grilla los guarda).
 *  - sustituirEventualPlanificacion: pasa los turnos futuros del titular al sustituto (baja/alta automáticas).
 *  - onTurnoEventualWrite: cada turno `esEventual` recalcula el contrato de (empresa, CUIL, mes).
 *
 * Reglas puras en apps/web2/src/lib/eventuales/planificacion.mjs. El contrato queda BORRADOR mientras
 * los turnos son `draft`; al publicar (draft:false) pasa a CONFIRMADO y nace el envío AT.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];
const AR_OFFSET = '-03:00';

type Jornada = { fecha: string; horaInicio: string; horaFin: string; horas: number; empresaId?: string | null };
type TurnoIn = { fecha: string; code: string; horaInicio: string; horaFin: string; horas: number; name?: string; positionName?: string };

type LibPlanificacion = {
  evaluarCandidato: (i: Record<string, unknown>) => Record<string, unknown> & { elegible: boolean; motivo: string | null; motivoCodigo: string | null };
  ordenarCandidatos: (l: unknown[]) => Record<string, unknown>[];
  jornadasDeTurnos: (t: unknown[]) => (Jornada & { objectiveId?: string | null; turnoId?: string | null })[];
  planContratoDesdeTurnos: (i: Record<string, unknown>) => {
    accion: 'SIN_CAMBIOS' | 'CREAR' | 'ACTUALIZAR' | 'CERRAR';
    contrato: Record<string, unknown> | null;
    envios: Record<string, unknown>[];
    patchesEnvios: { id: string; patch: Record<string, unknown> }[];
  };
  contratoIdDe: (e: string, c: string, p: string) => string;
  periodoDe: (f: string) => string;
};

function db() {
  return admin.firestore();
}

async function lib(): Promise<LibPlanificacion> {
  return await import('../../../web2/src/lib/eventuales/planificacion.mjs') as unknown as LibPlanificacion;
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

async function otrasJornadasDe(cuil: string, jornadas: Jornada[], excluirTurnoIds: Set<string> = new Set()) {
  const { jornadasDeTurnos } = await lib();
  const fechas = jornadas.map((j) => j.fecha).sort();
  const turnos = (await turnosDelCuil(cuil, sumarDias(fechas[0], -2), sumarDias(fechas[fechas.length - 1], 2)))
    .filter((t) => !excluirTurnoIds.has(t.id));
  return jornadasDeTurnos(turnos).map((j) => ({ ...j, empresaId: j.empresaId || 'grupo' }));
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
      if (String(doc.data()?.status || '').toLowerCase() === 'inactivo') await doc.ref.update({ status: 'activo', reactivadoAt: admin.firestore.FieldValue.serverTimestamp() });
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

async function txtDe(empresaId: string, contrato: Record<string, unknown>, cuil: string, bolsa: Record<string, unknown>, tipo: 'AT' | 'BT') {
  try {
    const { lineasCargaMasiva, brutoParaTxt } = await import('../../../web2/src/lib/eventuales/arcaTxt.mjs') as {
      lineasCargaMasiva: (i: Record<string, unknown>) => { lineas: string[]; advertencias: string[]; enviable: boolean };
      brutoParaTxt: (i: Record<string, unknown>) => { ok: boolean; codigo?: string; bruto: number };
    };
    const empresa = { id: empresaId, ...((await db().collection('empresas').doc(empresaId).get()).data() || {}) };
    const escalasSnap = await db().collection('escalas_salariales').where('status', '==', 'ACTIVE').get();
    const bruto = brutoParaTxt({ contrato, escalas: escalasSnap.docs.map((d) => d.data()) });
    const out = lineasCargaMasiva({ contrato, cuil, bruto: bruto.bruto, obraSocial: bolsa.obraSocialRnos || '', empresa });
    const advertencias = [...out.advertencias];
    if (!bruto.ok) advertencias.push('RETRIBUCION_PENDIENTE');
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
  const { planContratoDesdeTurnos, contratoIdDe } = await lib();
  const contratoId = contratoIdDe(empresaId, cuil, periodo);
  const bolsaSnap = await db().collection('eventuales_bolsa').doc(cuil).get();
  const bolsa = { cuil, ...(bolsaSnap.data() || {}) } as Record<string, unknown> & { cuil: string };
  const turnos = (await turnosDelCuil(cuil, `${periodo}-01`, `${periodo}-31`)).filter((t) => String(t.empresaId || '') === empresaId);
  const contratoRef = db().collection('contratos_eventuales').doc(contratoId);
  const [contratoSnap, enviosSnap] = await Promise.all([
    contratoRef.get(),
    db().collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get(),
  ]);
  const contratoActual = contratoSnap.exists ? { id: contratoSnap.id, ...contratoSnap.data() } : null;
  const enviosActuales = enviosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const legajo = ((bolsa.legajos || []) as { empresaId?: string; employeeId?: string }[]).find((l) => l.empresaId === empresaId);
  const employeeId = legajo?.employeeId || (turnos[0]?.employeeId as string | undefined) || null;

  const plan = planContratoDesdeTurnos({ empresaId, bolsa, employeeId, turnos, contratoActual, enviosActuales, ahoraMs: Date.now() });
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
    const txt = tipo === 'AT' || tipo === 'BT' ? await txtDe(empresaId, plan.contrato || {}, cuil, bolsa, tipo) : { txt: null, advertencias: ['MOVIMIENTO_A_CONFIRMAR_CON_CONTADOR'], enviable: false, bruto: 0 };
    batch.set(db().collection('arca_envios').doc(), {
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
  const enviosLuego = (await db().collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
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
  const alta = envios.find((e) => e.tipo === 'AT' && e.estado === 'CONFIRMADO' && !e.quitadoDelLote);
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
  const { evaluarCandidato, ordenarCandidatos } = await lib();
  const empresaId = String(data?.empresaId || '');
  const jornadas = ((data?.jornadas || []) as Partial<Jornada>[]).filter(validarJornada).map((j) => ({ ...j, horas: Number(j.horas) || 0 }));
  if (!empresaId || !jornadas.length) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o jornadas.');
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, data?.objectiveId ? String(data.objectiveId) : null, data?.objetivoGeo);
  const hoy = hoyAr();
  const excluir = new Set<string>(((data?.excluirTurnoIds || []) as unknown[]).map(String));
  const snap = await db().collection('eventuales_bolsa').where('empresasHabilitadas', 'array-contains', empresaId).get();
  const candidatos = [];
  for (const d of snap.docs) {
    const bolsa = { cuil: d.id, ...d.data() } as Record<string, unknown> & { cuil: string };
    if (bolsa.disponibilidad === 'NO_DISPONIBLE') continue;
    const otrasJornadas = await otrasJornadasDe(bolsa.cuil, jornadas, excluir);
    candidatos.push(evaluarCandidato({ bolsa, empresaId, jornadas, otrasJornadas, hoy, objetivoGeo }));
  }
  const lista = ordenarCandidatos(candidatos).map((c) => {
    const { legajos, ...resto } = c as Record<string, unknown> & { legajos?: { empresaId?: string; employeeId?: string }[] };
    return { ...resto, employeeId: (legajos || []).find((l) => l.empresaId === empresaId)?.employeeId || null } as Record<string, unknown>;
  });
  return { candidatos: lista, total: lista.length, elegibles: lista.filter((c) => c.elegible === true).length };
});

/**
 * modo 'LEGAJO': solo asegura el legajo EVENTUAL y devuelve employeeId (la grilla guarda los turnos y los estampa).
 * modo 'TURNOS' (default): escribe los turnos (draft según cronograma; eventos siempre publicados) y sincroniza el contrato.
 */
export const asignarEventualPlanificacion = functions.https.onCall(async (data, context) => {
  const auth = await exigirConvocar(context);
  const { evaluarCandidato, periodoDe } = await lib();
  const empresaId = String(data?.empresaId || '');
  const cuil = String(data?.cuil || '');
  const modo = data?.modo === 'LEGAJO' ? 'LEGAJO' : 'TURNOS';
  const turnosIn = ((data?.turnos || []) as Partial<TurnoIn>[]).filter(validarJornada) as TurnoIn[];
  if (!empresaId || !cuil) throw new functions.https.HttpsError('invalid-argument', 'Faltan empresa o CUIL.');
  if (!turnosIn.length) throw new functions.https.HttpsError('invalid-argument', 'No hay turnos para asignar.');
  const bolsa = await bolsaDe(cuil);
  const jornadas: Jornada[] = turnosIn.map((t) => ({ fecha: t.fecha, horaInicio: t.horaInicio, horaFin: t.horaFin, horas: Number(t.horas) || 0 }));
  const otrasJornadas = await otrasJornadasDe(cuil, jornadas);
  const objectiveId = data?.objectiveId ? String(data.objectiveId) : null;
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, objectiveId, data?.objetivoGeo);
  const evaluacion = evaluarCandidato({ bolsa, empresaId, jornadas, otrasJornadas, hoy: hoyAr(), objetivoGeo });
  if (!evaluacion.elegible) throw new functions.https.HttpsError('failed-precondition', evaluacion.motivo || evaluacion.motivoCodigo || 'NO_ELEGIBLE');

  const employeeId = await asegurarLegajo(bolsa, empresaId, auth.uid);
  if (modo === 'LEGAJO') {
    await auditar('EVENTUAL_LEGAJO_PLANIFICACION', auth.uid, empresaId, cuil, `${bolsa.nombre}: legajo ${employeeId} listo para la grilla (${jornadas.length} turno/s).`, { employeeId, objectiveId });
    return { ok: true, employeeId, nombre: bolsa.nombre };
  }

  const evento = data?.evento as { eventoId?: string; eventoNombre?: string; servicioId?: string; servicioNombre?: string } | null;
  const publicadoPorFecha = new Map<string, boolean>();
  const batch = db().batch();
  const turnoIds: string[] = [];
  for (const t of turnosIn) {
    let draft = false;
    if (!evento && objectiveId) {
      const clave = t.fecha.slice(0, 7);
      if (!publicadoPorFecha.has(clave)) publicadoPorFecha.set(clave, await cronogramaPublicado(objectiveId, t.fecha));
      draft = !publicadoPorFecha.get(clave);
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
      clientId: data?.clientId || null,
      clientName: data?.clientName || null,
      objectiveId,
      objectiveName: data?.objectiveName || null,
      positionName: t.positionName || data?.positionName || (evento ? evento.servicioNombre || 'Evento' : 'General'),
      code: evento ? 'EV' : String(t.code || 'M').toUpperCase(),
      type: t.name || (evento ? 'Evento' : String(t.code || 'M').toUpperCase()),
      hours: Number(t.horas) || 0,
      startTime: start,
      endTime: end,
      scheduleDate: t.fecha,
      isFranco: false,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft,
      ...(evento ? { origin: 'EVENTO', eventoId: evento.eventoId || null, eventoNombre: evento.eventoNombre || null, servicioId: evento.servicioId || null, servicioNombre: evento.servicioNombre || null } : {}),
      ...(data?.cubreA?.employeeName ? { comments: `Cubriendo a ${String(data.cubreA.employeeName)}`, coversEmployeeId: data.cubreA.employeeId || null } : { comments: 'Eventual (bolsa)' }),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      actorName: auth.token.email || auth.uid,
      createdBy: 'PLANIFICADOR_EVENTUALES',
    });
    turnoIds.push(ref.id);
  }
  for (const shiftId of ((data?.cubreA?.shiftIds || []) as unknown[]).map(String).filter(Boolean)) {
    batch.update(db().collection('turnos').doc(shiftId), { coveredBy: bolsa.nombre, coveredByEmployeeId: employeeId, coveredByEventual: true });
  }
  await batch.commit();

  const periodos = [...new Set(turnosIn.map((t) => periodoDe(t.fecha)))];
  const contratos = [];
  for (const periodo of periodos) contratos.push(await sincronizarContratoEventual(empresaId, cuil, periodo, auth.uid));
  await auditar('EVENTUAL_ASIGNADO_PLANIFICACION', auth.uid, empresaId, cuil, `${bolsa.nombre} asignado a ${data?.objectiveName || objectiveId || evento?.eventoNombre || '—'}: ${turnosIn.length} turno/s (${turnosIn.map((t) => `${t.fecha} ${t.code || 'EV'}`).join(', ')}).`, { employeeId, objectiveId, turnoIds });
  return { ok: true, employeeId, turnoIds, contratos };
});

/** Los turnos del titular desde `desdeFecha` (objetivo opcional) pasan al sustituto. Contratos de ambos se recalculan. */
export const sustituirEventualPlanificacion = functions.https.onCall(async (data, context) => {
  const auth = await exigirConvocar(context);
  const { evaluarCandidato, jornadasDeTurnos, periodoDe } = await lib();
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
  const otrasJornadas = await otrasJornadasDe(cuilSustituto, jornadas);
  const objetivoGeo = await objetivoGeoDe(empresaId, data?.clientId ? String(data.clientId) : null, objectiveId, data?.objetivoGeo);
  const evaluacion = evaluarCandidato({ bolsa: sustituto, empresaId, jornadas, otrasJornadas, hoy: hoyAr(), objetivoGeo });
  if (!evaluacion.elegible) throw new functions.https.HttpsError('failed-precondition', evaluacion.motivo || evaluacion.motivoCodigo || 'NO_ELEGIBLE');

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
