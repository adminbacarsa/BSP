/**
 * Eventual que no va a un evento.
 *  - Aviso («No puedo asistir», hasta el inicio): cancela la aceptación, el anexo queda sin efecto
 *    y la cascada del evento convoca al siguiente.
 *  - Falta sin aviso (T+30, `markShiftAbsent`): AA, no se paga, aviso a RRHH y la misma cascada.
 * ARCA: si el AT no se subió se saca del lote; si ya se subió, anulación de incorporaciones
 * dentro del plazo de la RG 2988/2010 art. 9, o baja el día de inicio si venció.
 * El puntaje no se calcula: solo queda el evento de desempeño.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { planEventualAusente } from '../eventos/eventoCoverage';

const AR_OFFSET = '-03:00';

function ymdAr(ms: number): string {
  return new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
}

function hmAr(ms: number): string {
  const d = new Date(ms - 3 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function txtBajaNoPresentacion(
  db: admin.firestore.Firestore,
  input: {
    empresaId: string;
    empresa: Record<string, unknown>;
    contrato: Record<string, unknown>;
    cuil: string;
    bolsa: Record<string, unknown>;
    fechaInicio: string;
    fechaBaja: string;
    revista: string;
  },
): Promise<{ txt: string | null; advertencias: string[]; enviable: boolean; bruto: number }> {
  const { lineaMovimientoArca, brutoParaTxt } = await import('../eventuales-shared/arcaTxt.mjs') as {
    lineaMovimientoArca: (i: Record<string, unknown>) => { linea: string; advertencias: string[]; enviable: boolean };
    brutoParaTxt: (i: Record<string, unknown>) => { ok: boolean; bruto: number };
  };
  const escalas = await db.collection('escalas_salariales').where('status', '==', 'ACTIVE').get();
  const calc = brutoParaTxt({ contrato: input.contrato, escalas: escalas.docs.map((d) => d.data()) });
  const advertencias = calc.ok ? [] : ['RETRIBUCION_PENDIENTE'];
  const linea = lineaMovimientoArca({
    contrato: { ...input.contrato, fechaAlta: input.contrato.fechaAlta || input.fechaInicio },
    cuil: input.cuil,
    bruto: calc.ok ? calc.bruto : 0,
    obraSocial: input.bolsa.obraSocialRnos || '',
    empresa: input.empresa,
    movimiento: 'BT',
    revista: input.revista,
    fechaBaja: input.fechaBaja,
  });
  return {
    txt: linea.linea,
    advertencias: [...linea.advertencias, ...advertencias],
    enviable: linea.enviable && advertencias.length === 0,
    bruto: calc.ok ? calc.bruto : 0,
  };
}

/**
 * Anulaciones de incorporaciones todavía sin subir cuya ventana ya venció pasan a baja.
 * La decide `convertirAnulacionVencida`. La corre el scheduler y también el encolado.
 */
export async function vencerAnulacionesPendientes(db: admin.firestore.Firestore, ahoraMs = Date.now()): Promise<number> {
  const { convertirAnulacionVencida, revistaDesistimientoDe } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
    convertirAnulacionVencida: (envio: Record<string, unknown>, opts: Record<string, unknown>) => { convertir: boolean; patch?: Record<string, unknown> };
    revistaDesistimientoDe: (cfg: unknown) => string;
  };
  const { arcaEventualesDe } = await import('../eventuales-shared/arcaTxt.mjs') as {
    arcaEventualesDe: (e: unknown) => unknown;
  };
  const [snap, ferSnap] = await Promise.all([
    db.collection('arca_envios').where('tipo', '==', 'ANULACION').limit(40).get(),
    db.collection('feriados').get(),
  ]);
  const feriados = ferSnap.docs.map((d) => d.data());
  let n = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.estado !== 'PENDIENTE' || data.quitadoDelLote === true) continue;
    const empresaId = String(data.empresaId || '');
    const empresaSnap = empresaId ? await db.collection('empresas').doc(empresaId).get() : null;
    const empresa = { id: empresaId, ...(empresaSnap?.data() || {}) };
    const revista = revistaDesistimientoDe(arcaEventualesDe(empresa));
    const conv = convertirAnulacionVencida(data, { ahoraMs, feriados, revistaDesistimiento: revista });
    if (!conv.convertir || !conv.patch) continue;
    const contratoId = Array.isArray(data.contratoIds) ? String(data.contratoIds[0] || '') : '';
    const contratoSnap = contratoId ? await db.collection('contratos_eventuales').doc(contratoId).get() : null;
    const cuil = String(data.bolsaCuil || '').replace(/\D/g, '');
    const bolsaSnap = cuil ? await db.collection('eventuales_bolsa').doc(cuil).get() : null;
    const fechaInicio = String(conv.patch.fechaBaja || data.fechaInicio || data.fechaAlta || '');
    const baja = await txtBajaNoPresentacion(db, {
      empresaId,
      empresa,
      contrato: contratoSnap?.data() || {},
      cuil,
      bolsa: bolsaSnap?.data() || {},
      fechaInicio,
      fechaBaja: fechaInicio,
      revista,
    });
    const { regenerarTxt: _drop, ...patch } = conv.patch;
    void _drop;
    await doc.ref.update({ ...patch, ...baja, updatedAt: FieldValue.serverTimestamp() });
    n += 1;
  }
  return n;
}

export async function aplicarEventualNoSePresento(
  db: admin.firestore.Firestore,
  opts: { shiftId?: string; solicitudId?: string; aviso: boolean; actorUid: string; ahoraMs?: number },
): Promise<{ ok: true; already?: boolean; arca: string | null; desempeno: string; reconvocado: boolean }> {
  const ahoraMs = opts.ahoraMs || Date.now();
  const solicitudRef = opts.solicitudId ? db.collection('solicitudes_evento').doc(opts.solicitudId) : null;
  let solicitudSnap = solicitudRef ? await solicitudRef.get() : null;
  let shiftId = String(opts.shiftId || '').trim();
  if (!shiftId && solicitudSnap?.exists) {
    const sol = solicitudSnap.data() || {};
    shiftId = String(sol.turnoId || (Array.isArray(sol.turnoIds) ? sol.turnoIds[0] : '') || '');
  }
  if (!shiftId) throw new Error('SIN_TURNO');
  const shiftRef = db.collection('turnos').doc(shiftId);
  const shiftSnap = await shiftRef.get();
  if (!shiftSnap.exists) throw new Error('SIN_TURNO');
  const shift = shiftSnap.data() || {};
  if (!solicitudSnap?.exists) {
    const porTurno = await db.collection('solicitudes_evento').where('turnoId', '==', shiftId).limit(1).get();
    solicitudSnap = porTurno.docs[0] || null;
  }
  const sol = solicitudSnap?.exists ? solicitudSnap.data() || {} : {};
  if (shift.eventualNoSePresentoAt) {
    return { ok: true, already: true, arca: String(shift.eventualArcaAccion || '') || null, desempeno: String(shift.eventualDesempeno || ''), reconvocado: false };
  }

  const cuil = String(sol.bolsaCuil || shift.bolsaCuil || '').replace(/\D/g, '');
  const empresaId = String(shift.empresaId || sol.empresaId || '');
  const inicioMs = (shift.startTime as { toMillis?: () => number })?.toMillis?.() || 0;
  if (opts.aviso && inicioMs && ahoraMs >= inicioMs) {
    throw new functions.https.HttpsError('failed-precondition', 'El servicio ya empezó. Si no llegás, queda como falta.');
  }
  const contratoId = String(sol.contratoId || shift.eventualContratoId || '');
  const enviosSnap = contratoId
    ? await db.collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get()
    : null;
  const ats = (enviosSnap?.docs || []).filter((d) => d.data().tipo === 'AT' && d.data().quitadoDelLote !== true);
  const atSubido = ats.some((d) => ['SUBIENDO', 'CONFIRMADO'].includes(String(d.data().estado || '')));
  const empresaSnap = empresaId ? await db.collection('empresas').doc(empresaId).get() : null;
  const { arcaEventualesDe } = await import('../eventuales-shared/arcaTxt.mjs') as {
    arcaEventualesDe: (e: unknown) => { situacionRevistaDesistimiento?: string; situacionRevistaNoInicio?: string };
    lineaMovimientoArca: (i: Record<string, unknown>) => { linea: string; advertencias: string[]; enviable: boolean };
  };
  const { plazoAnulacionAlta, convertirAnulacionVencida, revistaDesistimientoDe } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
    plazoAnulacionAlta: (i: Record<string, unknown>) => { puedeAnular: boolean; venceMs: number; avisoFeriados: string | null };
    convertirAnulacionVencida: (envio: Record<string, unknown>, opts: Record<string, unknown>) => { convertir: boolean; patch?: Record<string, unknown> };
    revistaDesistimientoDe: (cfg: unknown) => string;
  };
  const cfg = arcaEventualesDe({ id: empresaId, ...(empresaSnap?.data() || {}) });
  const feriadosSnap = await db.collection('feriados').get();
  const feriados = feriadosSnap.docs.map((d) => d.data());
  const fechaInicio = String(shift.scheduleDate || sol.jornada?.fecha || (inicioMs ? ymdAr(inicioMs) : ''));
  const horaInicio = String(sol.jornada?.horaInicio || (inicioMs ? hmAr(inicioMs) : '08:00'));
  const plazo = plazoAnulacionAlta({ fechaInicio, horaInicio, ahoraMs, feriados });
  if (plazo.avisoFeriados) console.warn(`[eventualNoSePresento] ${plazo.avisoFeriados}`);
  const revista = revistaDesistimientoDe(cfg);
  const plan = planEventualAusente({
    isEventual: true,
    employeeId: String(shift.employeeId || sol.empleadoId || ''),
    empresaAltaId: empresaId,
    eventoId: String(shift.eventoId || sol.eventoId || ''),
    shiftId,
    punched: shift.isPresent === true,
    aviso: opts.aviso,
    atSubido,
    inicioMs,
    ahoraMs,
    fechaInicio,
    puedeAnular: plazo.puedeAnular,
    revistaDesistimiento: revista,
  });
  if (!plan) throw new Error('NO_ES_EVENTUAL');

  const bolsa = cuil ? (await db.collection('eventuales_bolsa').doc(cuil).get()).data() || {} : {};
  const contratoSnap = contratoId ? await db.collection('contratos_eventuales').doc(contratoId).get() : null;
  const contrato = contratoSnap?.data() || {};
  let envioId: string | null = null;

  if (plan.arca.accion === 'CANCELAR_AT') {
    for (const at of ats) {
      if (['SUBIENDO', 'CONFIRMADO'].includes(String(at.data().estado || ''))) continue;
      await at.ref.update({
        quitadoDelLote: true,
        quitadoMotivo: 'NO_SE_PRESENTO',
        canceladoMotivo: opts.aviso ? 'NO_PUEDE_ASISTIR' : 'FALTA_SIN_AVISO',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  } else if (plan.arca.tipo) {
    const pendientes = (enviosSnap?.docs || []).filter((d) => d.data().tipo === 'ANULACION' && d.data().estado === 'PENDIENTE' && d.data().quitadoDelLote !== true);
    let convertida = false;
    for (const pend of pendientes) {
      const conv = convertirAnulacionVencida(pend.data(), { ahoraMs, feriados, revistaDesistimiento: revista });
      if (!conv.convertir || !conv.patch) continue;
      const baja = await txtBajaNoPresentacion(db, {
        empresaId, empresa: { id: empresaId, ...(empresaSnap?.data() || {}) }, contrato, cuil, bolsa,
        fechaInicio, fechaBaja: String(conv.patch.fechaBaja || fechaInicio), revista,
      });
      const { regenerarTxt: _drop, ...patch } = conv.patch;
      void _drop;
      await pend.ref.update({ ...patch, ...baja, updatedAt: FieldValue.serverTimestamp() });
      envioId = pend.id;
      convertida = true;
    }
    const ya = convertida
      ? { id: envioId }
      : (enviosSnap?.docs || []).find((d) => d.data().tipo === plan.arca.tipo && d.data().estado === 'PENDIENTE');
    if (!ya) {
      const ref = db.collection('arca_envios').doc();
      if (plan.arca.accion === 'ANULACION') {
        await ref.set({
          empresaId,
          contratoIds: contratoId ? [contratoId] : [],
          bolsaCuil: cuil,
          tipo: 'ANULACION',
          movimiento: null,
          modulo: plan.arca.modulo,
          lote: 'ANULACION',
          canal: 'URGENTE',
          estado: 'PENDIENTE',
          txt: null,
          advertencias: plazo.avisoFeriados ? [plazo.avisoFeriados] : [],
          enviable: true,
          bruto: 0,
          fechaAlta: fechaInicio,
          fechaInicio,
          horaInicio,
          fechaBaja: null,
          venceAnulacionMs: plazo.venceMs,
          avisoFeriados: plazo.avisoFeriados,
          motivo: null,
          revista: null,
          constanciaInterna: plan.arca.constanciaInterna,
          confirmarConContador: false,
          origen: null,
          nroTransaccion: null,
          quitadoDelLote: false,
          intentos: [],
          createdAt: FieldValue.serverTimestamp(),
          createdBy: opts.actorUid,
        });
      } else {
        const baja = await txtBajaNoPresentacion(db, {
          empresaId, empresa: { id: empresaId, ...(empresaSnap?.data() || {}) }, contrato, cuil, bolsa,
          fechaInicio, fechaBaja: plan.arca.fechaBaja || fechaInicio, revista: plan.arca.revista || revista,
        });
        await ref.set({
          empresaId,
          contratoIds: contratoId ? [contratoId] : [],
          bolsaCuil: cuil,
          tipo: plan.arca.tipo,
          movimiento: 'BT',
          lote: 'BT',
          canal: 'URGENTE',
          estado: 'PENDIENTE',
          ...baja,
          fechaAlta: fechaInicio,
          fechaInicio,
          horaInicio,
          fechaBaja: plan.arca.fechaBaja || fechaInicio,
          motivo: plan.arca.motivo,
          revista: plan.arca.revista,
          constanciaInterna: plan.arca.constanciaInterna,
          confirmarConContador: false,
          avisoFeriados: plazo.avisoFeriados,
          origen: null,
          nroTransaccion: null,
          quitadoDelLote: false,
          intentos: [],
          createdAt: FieldValue.serverTimestamp(),
          createdBy: opts.actorUid,
        });
      }
      envioId = ref.id;
    } else if (!convertida) {
      envioId = ya.id;
    }
  }

  if (contratoSnap?.exists) {
    const jornadas = ((contrato.jornadas || []) as { fecha?: string; horaInicio?: string }[])
      .filter((j) => !(j.fecha === fechaInicio && (!sol.jornada?.horaInicio || j.horaInicio === sol.jornada.horaInicio)));
    const cierra = jornadas.length === 0;
    await contratoSnap.ref.set({
      ...(cierra ? {
        estado: plan.arca.accion === 'BAJA' ? 'FINALIZADO' : 'ANULADO',
        fechaBaja: plan.arca.fechaBaja || fechaInicio,
        jornadas: [],
        cierre: { motivo: plan.arca.tipo || 'CANCELAR_AT', at: new Date(ahoraMs).toISOString(), actorUid: opts.actorUid },
      } : { jornadas }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (cierra) {
      const { propagarAltaEnTurnos } = await import('../arca/altaArcaDenorm');
      await propagarAltaEnTurnos(db, { contratoIds: [contratoId], encender: false });
    }
  }

  if (solicitudSnap?.exists) {
    await solicitudSnap.ref.update({
      ...(opts.aviso ? { status: 'cancelada', canceladaAt: FieldValue.serverTimestamp(), canceladaMotivo: 'NO_PUEDE_ASISTIR' } : { noSePresento: true, noSePresentoAt: FieldValue.serverTimestamp() }),
      anexoEstado: 'SIN_EFECTO',
      anexoMensaje: 'Sin efecto: el eventual no va a prestar el servicio.',
      arcaNoSePresento: plan.arca.tipo || 'CANCELADO',
    });
  }
  if (contratoId) {
    await db.collection('anexo_codigos').doc(contratoId).set({ sinEfecto: true, sinEfectoAt: FieldValue.serverTimestamp() }, { merge: true });
    const anexos = await db.collection('anexos_eventuales').where('contratoId', '==', contratoId).get();
    for (const anexo of anexos.docs) {
      await anexo.ref.set({ sinEfecto: true, sinEfectoAt: FieldValue.serverTimestamp(), sinEfectoMotivo: plan.desempeno }, { merge: true });
    }
  }

  const empleadoId = String(sol.empleadoId || shift.employeeId || '');
  await shiftRef.update({
    noSePresento: true,
    pagaJornada: false,
    eventualNoSePresentoAt: FieldValue.serverTimestamp(),
    eventualNoSePresentoMotivo: opts.aviso ? 'NO_PUEDE_ASISTIR' : 'FALTA_SIN_AVISO',
    eventualArcaAccion: plan.arca.accion,
    eventualDesempeno: plan.desempeno,
    ...(cuil ? { excluirBolsaCuils: FieldValue.arrayUnion(cuil) } : {}),
    ...(opts.aviso ? {
      employeeId: 'VACANTE',
      employeeName: 'VACANTE',
      esEventual: false,
      bolsaCuil: FieldValue.delete(),
      isUnassigned: true,
      isAbsent: false,
      status: 'VACANTE',
      comments: 'El eventual avisó que no puede asistir',
    } : {}),
  });

  await db.collection('guardia_desempeno_eventos').doc(`${plan.desempeno}_${shiftId}_${cuil || 'x'}`).set({
    empleadoId,
    bolsaCuil: cuil || null,
    tipo: plan.desempeno,
    fecha: fechaInicio,
    turnoId: shiftId,
    eventoId: plan.eventoId || null,
    empresaId,
    solicitudId: solicitudSnap?.id || null,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (!opts.aviso) {
    await db.collection('novedades').add({
      type: 'AUSENCIA_EVENTUAL',
      status: 'PENDIENTE',
      empresaId,
      shiftId,
      eventoId: plan.eventoId || null,
      eventoNombre: shift.eventoNombre || sol.eventoNombre || null,
      servicioNombre: shift.servicioNombre || sol.servicioNombre || null,
      employeeId: empleadoId || null,
      employeeName: String(shift.employeeName || sol.empleadoNombre || ''),
      bolsaCuil: cuil || null,
      description: `${shift.employeeName || sol.empleadoNombre || 'Eventual'} faltó sin avisar a ${shift.eventoNombre || 'el evento'}. No se paga la jornada. ARCA: ${plan.arca.tipo || 'alta cancelada'}.`,
      createdAt: Timestamp.now(),
      source: opts.actorUid,
    });
  }

  let reconvocado = false;
  try {
    const fresco = (await shiftRef.get()).data() || {};
    const { iniciarCascadaCobertura } = await import('../coverage/convocatoriasCobertura');
    await iniciarCascadaCobertura(db, {
      id: shiftId,
      empresaId,
      objectiveId: String(fresco.objectiveId || ''),
      objectiveName: String(fresco.objectiveName || ''),
      positionName: String(fresco.positionName || ''),
      clientId: String(fresco.clientId || ''),
      clientName: String(fresco.clientName || ''),
      code: String(fresco.code || 'EV'),
      startTime: fresco.startTime,
      endTime: fresco.endTime,
    }, opts.aviso ? 'EVENTUAL_NO_PUEDE' : 'EVENTUAL_AUSENTE');
    reconvocado = true;
  } catch (err) {
    console.warn('[eventualNoSePresento] cascada:', (err as Error)?.message);
  }

  await db.collection('audit_logs').add({
    action: opts.aviso ? 'EVENTUAL_NO_PUEDE_ASISTIR' : 'EVENTUAL_FALTA_SIN_AVISO',
    module: 'EVENTUALES',
    actorUid: opts.actorUid,
    empresaId,
    bolsaCuil: cuil || null,
    details: `${opts.aviso ? 'Avisó que no va' : 'Faltó sin avisar'}. ARCA ${plan.arca.accion}. Desempeño ${plan.desempeno}.`,
    turnoId: shiftId,
    solicitudId: solicitudSnap?.id || null,
    envioId,
    timestamp: FieldValue.serverTimestamp(),
  });

  return { ok: true, arca: plan.arca.tipo || 'CANCELADO', desempeno: plan.desempeno, reconvocado };
}
