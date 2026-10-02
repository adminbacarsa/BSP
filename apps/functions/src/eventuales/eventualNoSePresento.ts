/**
 * Eventual que no va a un evento.
 *  - Aviso («No puedo asistir», hasta el inicio): cancela la aceptación, el anexo queda sin efecto
 *    y la cascada del evento convoca al siguiente.
 *  - Falta sin aviso (T+30, `markShiftAbsent`): AA, no se paga, aviso a RRHH y la misma cascada.
 * ARCA: si el AT no se subió se saca del lote; si ya se subió, anulación dentro del plazo o baja
 * el día de inicio (lote urgente). El puntaje no se calcula: solo queda el evento de desempeño.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { planEventualAusente } from '../eventos/eventoCoverage';

const AR_OFFSET = '-03:00';

function ymdAr(ms: number): string {
  return new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
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
  const { arcaEventualesDe, lineaMovimientoArca } = await import('../eventuales-shared/arcaTxt.mjs') as {
    arcaEventualesDe: (e: unknown) => { movimientoAnulacion?: string; anulacionAltaMaxHoras?: number; situacionRevistaNoInicio?: string };
    lineaMovimientoArca: (i: Record<string, unknown>) => { linea: string; advertencias: string[]; enviable: boolean };
  };
  const cfg = arcaEventualesDe({ id: empresaId, ...(empresaSnap?.data() || {}) });
  const fechaInicio = String(shift.scheduleDate || sol.jornada?.fecha || (inicioMs ? ymdAr(inicioMs) : ''));
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
    plazoAnulacionHoras: Number(cfg.anulacionAltaMaxHoras) || 24,
    movimientoAnulacion: cfg.movimientoAnulacion || 'NA',
    revistaNoInicio: cfg.situacionRevistaNoInicio || '30',
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
  } else if (plan.arca.tipo && plan.arca.movimiento) {
    const ya = (enviosSnap?.docs || []).find((d) => d.data().tipo === plan.arca.tipo && d.data().estado === 'PENDIENTE');
    if (!ya) {
      let bruto = plan.arca.bruto ?? 0;
      const advertenciasExtra: string[] = [];
      if (plan.arca.accion === 'BAJA') {
        const { brutoParaTxt } = await import('../eventuales-shared/arcaTxt.mjs') as {
          brutoParaTxt: (i: Record<string, unknown>) => { ok: boolean; bruto: number };
        };
        const escalas = await db.collection('escalas_salariales').where('status', '==', 'ACTIVE').get();
        const calc = brutoParaTxt({ contrato, escalas: escalas.docs.map((d) => d.data()) });
        bruto = calc.ok ? calc.bruto : 0;
        if (!calc.ok) advertenciasExtra.push('RETRIBUCION_PENDIENTE');
      }
      const linea = lineaMovimientoArca({
        contrato: { ...contrato, fechaAlta: contrato.fechaAlta || fechaInicio },
        cuil,
        bruto,
        obraSocial: bolsa.obraSocialRnos || '',
        empresa: { id: empresaId, ...(empresaSnap?.data() || {}) },
        movimiento: plan.arca.movimiento,
        revista: plan.arca.revista || (plan.arca.accion === 'ANULACION' ? '01' : cfg.situacionRevistaNoInicio || '30'),
        fechaBaja: plan.arca.fechaBaja || '',
      });
      const ref = db.collection('arca_envios').doc();
      await ref.set({
        empresaId,
        contratoIds: contratoId ? [contratoId] : [],
        bolsaCuil: cuil,
        tipo: plan.arca.tipo,
        movimiento: plan.arca.movimiento,
        lote: 'BT',
        canal: 'URGENTE',
        estado: 'PENDIENTE',
        txt: linea.linea,
        advertencias: [...linea.advertencias, ...advertenciasExtra],
        enviable: linea.enviable && advertenciasExtra.length === 0,
        bruto,
        fechaAlta: contrato.fechaAlta || fechaInicio,
        fechaBaja: plan.arca.fechaBaja || null,
        motivo: plan.arca.motivo,
        revista: plan.arca.revista,
        confirmarConContador: true,
        origen: null,
        nroTransaccion: null,
        quitadoDelLote: false,
        intentos: [],
        createdAt: FieldValue.serverTimestamp(),
        createdBy: opts.actorUid,
      });
      envioId = ref.id;
    } else {
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
