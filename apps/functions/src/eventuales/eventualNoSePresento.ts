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
): Promise<{ txt: string | null; advertencias: string[]; enviable: boolean; bruto: number; sinDevengamiento: boolean; devengaArt: boolean; observacionesInternas: string }> {
  const { lineaMovimientoArca } = await import('../eventuales-shared/arcaTxt.mjs') as {
    lineaMovimientoArca: (i: Record<string, unknown>) => { linea: string; advertencias: string[]; enviable: boolean };
  };
  const { OBSERVACION_INTERNA_NO_PRESENTACION } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
    OBSERVACION_INTERNA_NO_PRESENTACION: string;
  };
  const linea = lineaMovimientoArca({
    contrato: { ...input.contrato, fechaAlta: input.contrato.fechaAlta || input.fechaInicio },
    cuil: input.cuil,
    bruto: 0,
    obraSocial: input.bolsa.obraSocialRnos || '',
    empresa: input.empresa,
    movimiento: 'BT',
    revista: input.revista,
    fechaBaja: input.fechaBaja,
  });
  return {
    txt: linea.linea,
    advertencias: linea.advertencias,
    enviable: linea.enviable,
    bruto: 0,
    sinDevengamiento: true,
    devengaArt: false,
    observacionesInternas: OBSERVACION_INTERNA_NO_PRESENTACION,
  };
}

/**
 * Deja en el envío y en el legajo la observación del contador, y adjunta la constancia
 * (novedad + audit). Idempotente: si el doc ya existe no lo pisa.
 */
export async function anotarNoPresentacion(
  db: admin.firestore.Firestore,
  opts: {
    envioId: string;
    empresaId: string;
    cuil: string;
    empleadoId?: string;
    shiftId?: string;
    actorUid: string;
    novedadId?: string | null;
    auditId?: string | null;
  },
): Promise<{ novedadId: string; auditId: string }> {
  const { OBSERVACION_INTERNA_NO_PRESENTACION, observacionesConInasistencia } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
    OBSERVACION_INTERNA_NO_PRESENTACION: string;
    observacionesConInasistencia: (actual: unknown) => string;
  };
  const frase = OBSERVACION_INTERNA_NO_PRESENTACION;
  const novedadId = opts.novedadId || `cert_inasistencia_${opts.envioId}`;
  const auditId = opts.auditId || `constancia_inasistencia_${opts.envioId}`;
  const novRef = db.collection('novedades').doc(novedadId);
  if (!(await novRef.get()).exists) {
    await novRef.set({
      type: 'CERTIFICADO_INASISTENCIA',
      status: 'PENDIENTE',
      empresaId: opts.empresaId,
      shiftId: opts.shiftId || null,
      employeeId: opts.empleadoId || null,
      bolsaCuil: opts.cuil || null,
      envioId: opts.envioId,
      description: frase,
      createdAt: FieldValue.serverTimestamp(),
      source: opts.actorUid,
    });
  }
  const audRef = db.collection('audit_logs').doc(auditId);
  if (!(await audRef.get()).exists) {
    await audRef.set({
      action: 'CONSTANCIA_INASISTENCIA',
      module: 'EVENTUALES',
      actorUid: opts.actorUid,
      empresaId: opts.empresaId,
      bolsaCuil: opts.cuil || null,
      envioId: opts.envioId,
      turnoId: opts.shiftId || null,
      details: frase,
      timestamp: FieldValue.serverTimestamp(),
    });
  }
  await db.collection('arca_envios').doc(opts.envioId).set({
    observacionesInternas: frase,
    constanciaInasistencia: { novedadId, auditId, texto: frase },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const legajos: admin.firestore.DocumentReference[] = [];
  if (opts.empleadoId) legajos.push(db.collection('empleados').doc(opts.empleadoId));
  if (opts.cuil) {
    const porCuil = await db.collection('empleados').where('cuil', '==', opts.cuil).limit(15).get();
    for (const doc of porCuil.docs) legajos.push(doc.ref);
  }
  const vistos = new Set<string>();
  for (const ref of legajos) {
    if (vistos.has(ref.path)) continue;
    vistos.add(ref.path);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    if (opts.empresaId && data.empresaId && String(data.empresaId) !== opts.empresaId && ref.id !== opts.empleadoId) continue;
    const observacionesInternas = observacionesConInasistencia(data.observacionesInternas);
    if (observacionesInternas === String(data.observacionesInternas || '').trim()) continue;
    await ref.set({ observacionesInternas, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { novedadId, auditId };
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
    const previa = (data.constanciaInasistencia || {}) as { novedadId?: string; auditId?: string };
    await anotarNoPresentacion(db, {
      envioId: doc.id,
      empresaId,
      cuil,
      empleadoId: String((contratoSnap?.data() || {}).employeeId || ''),
      actorUid: 'VENTANA_VENCIDA',
      novedadId: previa.novedadId || null,
      auditId: previa.auditId || null,
    });
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
          enviable: false,
          carga: 'MANUAL_WEB',
          bruto: 0,
          nroTransaccionAlta: String(ats.find((d) => d.data().estado === 'CONFIRMADO')?.data().nroTransaccion || ''),
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
      await anexo.ref.set({
        sinEfecto: true,
        sinEfectoAt: FieldValue.serverTimestamp(),
        sinEfectoMotivo: plan.desempeno,
        sinDevengamiento: true,
        devengaArt: false,
        brutoAnulado: anexo.data().bruto ?? null,
        bruto: 0,
      }, { merge: true });
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

  let novedadId: string | null = null;
  if (!opts.aviso) {
    const novRef = await db.collection('novedades').add({
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
      envioId: envioId || null,
    });
    novedadId = novRef.id;
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

  const auditRef = await db.collection('audit_logs').add({
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
  if (envioId && (plan.arca.accion === 'ANULACION' || plan.arca.accion === 'BAJA')) {
    await anotarNoPresentacion(db, {
      envioId,
      empresaId,
      cuil,
      empleadoId,
      shiftId,
      actorUid: opts.actorUid,
      novedadId,
      auditId: auditRef.id,
    });
  }

  return { ok: true, arca: plan.arca.tipo || 'CANCELADO', desempeno: plan.desempeno, reconvocado };
}

export type DeshacerNoSePresentoResult = {
  ok: true;
  nada?: boolean;
  arca: 'AT_REENCOLADO' | 'AT_YA_CONFIRMADO' | 'SIN_AT' | 'ARCA_REVISAR';
  desempeno: 'LLEGADA_TARDE_SIN_AVISO' | null;
  novedadesCerradas: number;
};

/**
 * El operador revirtió la ausencia del eventual (llegó dentro de la ventana): se deshace lo que
 * `aplicarEventualNoSePresento` hizo por la falta sin aviso. Vuelve a pagarse la jornada, el AT
 * quitado del lote vuelve como URGENTE (si ya se lo anuló o dio de baja en ARCA no se puede
 * deshacer solo: queda aviso para RRHH), la falta en desempeño se reemplaza por llegada tarde
 * y la novedad AUSENCIA_EVENTUAL se cierra con la nota de reversión.
 */
export async function deshacerEventualNoSePresento(
  db: admin.firestore.Firestore,
  opts: { shiftId: string; actorUid: string; lateMinutes?: number; ahoraMs?: number },
): Promise<DeshacerNoSePresentoResult> {
  const ahoraMs = opts.ahoraMs || Date.now();
  const shiftRef = db.collection('turnos').doc(opts.shiftId);
  const shiftSnap = await shiftRef.get();
  if (!shiftSnap.exists) throw new Error('SIN_TURNO');
  const shift = shiftSnap.data() || {};
  if (!shift.eventualNoSePresentoAt) return { ok: true, nada: true, arca: 'SIN_AT', desempeno: null, novedadesCerradas: 0 };

  const cuil = String(shift.bolsaCuil || '').replace(/\D/g, '');
  const empresaId = String(shift.empresaId || '');
  const porTurno = await db.collection('solicitudes_evento').where('turnoId', '==', opts.shiftId).limit(1).get();
  const solSnap = porTurno.docs[0] || null;
  const sol = solSnap?.data() || {};
  const contratoId = String(sol.contratoId || shift.eventualContratoId || '');
  const lateMinutes = Math.max(0, Math.round(Number(opts.lateMinutes) || 0));
  const hora = hmAr(ahoraMs);
  const nota = `Ausencia revertida por el operador: ingresó ${hora}${lateMinutes > 0 ? ` (${lateMinutes} min tarde)` : ''}.`;

  let arca: DeshacerNoSePresentoResult['arca'] = 'SIN_AT';
  const avisosArca: string[] = [];
  if (contratoId) {
    const envios = await db.collection('arca_envios').where('contratoIds', 'array-contains', contratoId).get();
    const ats = envios.docs.filter((d) => d.data().tipo === 'AT');
    const bajas = envios.docs.filter((d) => ['ANULACION', 'BAJA_NO_PRESENTACION'].includes(String(d.data().tipo || '')));
    for (const baja of bajas) {
      const data = baja.data();
      if (data.quitadoDelLote === true) continue;
      if (['SUBIENDO', 'CONFIRMADO'].includes(String(data.estado || ''))) {
        avisosArca.push(`${data.tipo} ${data.estado}`);
        continue;
      }
      await baja.ref.update({
        quitadoDelLote: true,
        quitadoMotivo: 'AUSENCIA_REVERTIDA',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const confirmado = ats.find((d) => d.data().estado === 'CONFIRMADO');
    if (confirmado) {
      arca = 'AT_YA_CONFIRMADO';
    } else {
      const quitado = ats.find((d) => d.data().quitadoDelLote === true && d.data().quitadoMotivo === 'NO_SE_PRESENTO');
      const vivo = ats.find((d) => d.data().quitadoDelLote !== true && ['PENDIENTE', 'ERROR', 'MANUAL'].includes(String(d.data().estado || '')));
      if (vivo) {
        await vivo.ref.update({ canal: 'URGENTE', urgentePorReversion: true, updatedAt: FieldValue.serverTimestamp() });
        arca = 'AT_REENCOLADO';
      } else if (quitado) {
        await quitado.ref.update({
          quitadoDelLote: false,
          quitadoMotivo: FieldValue.delete(),
          canceladoMotivo: FieldValue.delete(),
          canal: 'URGENTE',
          estado: 'PENDIENTE',
          urgentePorReversion: true,
          reencoladoAt: FieldValue.serverTimestamp(),
          reencoladoMotivo: 'AUSENCIA_REVERTIDA',
          updatedAt: FieldValue.serverTimestamp(),
        });
        arca = 'AT_REENCOLADO';
      }
    }
    if (avisosArca.length) arca = 'ARCA_REVISAR';

    const contratoSnap = await db.collection('contratos_eventuales').doc(contratoId).get();
    if (contratoSnap.exists) {
      const contrato = contratoSnap.data() || {};
      const inicioMs = (shift.startTime as { toMillis?: () => number })?.toMillis?.() || 0;
      const finMs = (shift.endTime as { toMillis?: () => number })?.toMillis?.() || 0;
      const jornada = sol.jornada || {
        fecha: String(shift.scheduleDate || (inicioMs ? ymdAr(inicioMs) : '')),
        horaInicio: inicioMs ? hmAr(inicioMs) : '08:00',
        horaFin: finMs ? hmAr(finMs) : '16:00',
        horas: Number(shift.hours) || 0,
      };
      const jornadas = ((contrato.jornadas || []) as { fecha?: string; horaInicio?: string }[]).filter(Boolean);
      const yaEsta = jornadas.some((j) => j.fecha === jornada.fecha && j.horaInicio === jornada.horaInicio);
      const nuevas = yaEsta ? jornadas : [...jornadas, jornada];
      const fechaBaja = nuevas.map((j) => String(j.fecha || '')).sort().pop() || jornada.fecha;
      await contratoSnap.ref.set({
        estado: 'CONFIRMADO',
        status: 'ACTIVE',
        jornadas: nuevas,
        fechaBaja,
        cierre: FieldValue.delete(),
        reabiertoAt: FieldValue.serverTimestamp(),
        reabiertoMotivo: 'AUSENCIA_REVERTIDA',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (arca === 'AT_YA_CONFIRMADO') {
        const { propagarAltaEnTurnos } = await import('../arca/altaArcaDenorm');
        const nro = confirmado ? String(confirmado.data().nroTransaccion || '') : '';
        await propagarAltaEnTurnos(db, { contratoIds: [contratoId], nroTransaccion: nro || null, encender: true });
      }
    }
    await db.collection('anexo_codigos').doc(contratoId).set({ sinEfecto: false, sinEfectoAt: FieldValue.delete(), reactivadoAt: FieldValue.serverTimestamp() }, { merge: true });
    const anexos = await db.collection('anexos_eventuales').where('contratoId', '==', contratoId).get();
    for (const anexo of anexos.docs) {
      await anexo.ref.set({ sinEfecto: false, sinEfectoAt: FieldValue.delete(), sinEfectoMotivo: FieldValue.delete(), reactivadoAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    if (solSnap) {
      // El doc del anexo nace al firmar: si existe, está firmado.
      const firmado = anexos.size > 0 || !!sol.anexoId || !!sol.anexoFirmadoAt;
      const anexoEstado = firmado ? 'FIRMADO' : (sol.exigirMarco === false ? 'NO_EXIGIDO' : 'PENDIENTE');
      await solSnap.ref.update({
        noSePresento: false,
        noSePresentoAt: FieldValue.delete(),
        noSePresentoRevertidoAt: FieldValue.serverTimestamp(),
        anexoEstado,
        anexoMensaje: FieldValue.delete(),
        arcaNoSePresento: FieldValue.delete(),
      });
    }
  }

  await shiftRef.update({
    noSePresento: FieldValue.delete(),
    pagaJornada: true,
    eventualNoSePresentoAt: FieldValue.delete(),
    eventualNoSePresentoMotivo: FieldValue.delete(),
    eventualArcaAccion: FieldValue.delete(),
    eventualDesempeno: FieldValue.delete(),
    eventualNoSePresentoRevertidoAt: FieldValue.serverTimestamp(),
    eventualNoSePresentoRevertidoPor: opts.actorUid,
    eventualArcaReversion: arca,
    ...(cuil ? { excluirBolsaCuils: FieldValue.arrayRemove(cuil) } : {}),
  });

  const desempenoId = `FALTA_SIN_AVISO_${opts.shiftId}_${cuil || 'x'}`;
  await db.collection('guardia_desempeno_eventos').doc(desempenoId).delete();
  let desempeno: DeshacerNoSePresentoResult['desempeno'] = null;
  if (lateMinutes > 5) {
    desempeno = 'LLEGADA_TARDE_SIN_AVISO';
    await db.collection('guardia_desempeno_eventos').doc(`LLEGADA_TARDE_SIN_AVISO_${opts.shiftId}_${cuil || 'x'}`).set({
      empleadoId: String(shift.employeeId || ''),
      bolsaCuil: cuil || null,
      tipo: 'LLEGADA_TARDE_SIN_AVISO',
      fecha: String(shift.scheduleDate || ''),
      turnoId: opts.shiftId,
      eventoId: shift.eventoId || null,
      empresaId,
      esEventual: true,
      lateMinutes,
      revertidaDesdeFalta: true,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const novs = await db.collection('novedades').where('shiftId', '==', opts.shiftId).where('type', '==', 'AUSENCIA_EVENTUAL').get();
  for (const nov of novs.docs) {
    await nov.ref.update({
      status: 'ATENDIDA',
      resolved: true,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: opts.actorUid,
      reversionNota: nota,
      description: `${String(nov.data().description || '')} ${nota}`.trim(),
    });
  }
  if (arca === 'ARCA_REVISAR') {
    await db.collection('novedades').add({
      type: 'ARCA_REVISAR',
      status: 'PENDIENTE',
      empresaId,
      shiftId: opts.shiftId,
      eventoId: shift.eventoId || null,
      employeeId: shift.employeeId || null,
      employeeName: String(shift.employeeName || ''),
      bolsaCuil: cuil || null,
      description: `${shift.employeeName || 'Eventual'} llegó y se revirtió la ausencia, pero en ARCA ya se procesó ${avisosArca.join(', ')}. Revisar el alta a mano.`,
      createdAt: Timestamp.now(),
      source: opts.actorUid,
    });
  }

  await db.collection('audit_logs').add({
    action: 'EVENTUAL_AUSENCIA_REVERTIDA',
    module: 'EVENTUALES',
    actorUid: opts.actorUid,
    empresaId,
    bolsaCuil: cuil || null,
    details: `${nota} Se paga la jornada. ARCA ${arca}. Desempeño: ${desempeno || 'sin falta'}.`,
    turnoId: opts.shiftId,
    solicitudId: solSnap?.id || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  return { ok: true, arca, desempeno, novedadesCerradas: novs.size };
}
