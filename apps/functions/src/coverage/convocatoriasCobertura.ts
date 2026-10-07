import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { venisBody } from '../attendance/arrivalNoticeWindow';
import { coberturaBody, formatHoraAr24 } from './coberturaPushText';
import { clampLateEtaMinutes } from '../attendance/lateAbsenceWindow';
import { guardFirstName } from '../common/pushGreeting';
import { markShiftAbsent } from '../attendance/markShiftAbsent';
import { skipAbsencePipelineForShift } from './coverageTraceShift';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  CandidateType,
  CASCADE_ORDER,
  nextCascadeStep,
  getUrgency,
  findEmployeeUid,
} from './eligibilityFilter';
import { escalarVacanteSinCobertura } from './escalarVacanteSinCobertura';
import { ObjectiveOperationCache, simulableShiftSkipReasonResolved } from '../common/simulableShift';
import { canalOrigenConvocatoria, logConvocatoriaEvento } from './convocatoriaEventos';
import { CASCADE_LOCK_MS, cascadeLockHeld, shouldAdvanceOnReject, toMillisLoose } from './cascadeGuards';
import { gapWindowFromTitularShift, shiftEndMs, shiftStartMs } from './coverageSourceShiftForGap';
import { uncoveredRemainderMs } from './partialSegment';
import {
  EVENT_COVERAGE_CASCADE_ORDER,
  OBJECTIVE_COVERAGE_WITH_EVENTUAL,
  eventoTieneFranjasEncadenadas,
  isEventoShift,
} from '../eventos/eventoCoverage';
import { loadEventualesParaHueco, registrarAsignacionEventualEnBatch } from '../eventos/eventualesParaHuecoServer';
import { resolverCoberturaRefEscRet } from './refEscDirecto';
import { CONVOCATORIA_TIMEOUT_MINUTES } from './convocatoriaTimeout';

// ─── Tipos ───────────────────────────────────────────────────────────────────

// ConvocatoriaType amplía CandidateType con LLEGADA_TARDE (pregunta al guardia tardío)
export type ConvocatoriaType = CandidateType | 'LLEGADA_TARDE';

export interface ConvocatoriaCoberturaDoc {
  empresaId: string;
  shiftId: string;           // vacante que se quiere cubrir
  objectiveId: string;
  objectiveName?: string;
  positionName?: string;
  clientId?: string;
  clientName?: string;
  shiftCode?: string;        // M/T/N/D12/N12
  startTime: Timestamp;
  endTime?: Timestamp;
  aptitudesRequeridas?: string[];
  /** Hueco de un servicio de evento con cupo por género: solo candidatos de ese grupo. */
  generoRequerido?: 'M' | 'F' | null;

  type: ConvocatoriaType;
  urgency: 'URGENTE' | 'INTERMEDIO' | 'NORMAL';
  cascadeStep: number;       // índice en CASCADE_ORDER (0-based)

  candidateEmployeeId: string;
  candidateEmployeeName: string;
  candidateUid?: string;
  /** CUIL de la bolsa cuando type es EVENTUAL. */
  bolsaCuil?: string;

  // Para EXTEND: el turno a extender (ya presente en obj)
  extendShiftId?: string;
  // Para ADVANCE: el próximo turno a adelantar
  advanceShiftId?: string;
  // Para FT: el turno franco del candidato que se convierte a FT
  ftShiftId?: string;
  /** Turno REF/ESC del candidato en el objetivo (redirección). */
  candidateShiftId?: string;

  // PENDING: esperando respuesta dentro del timeout
  // ESCALATED: timeout vencido, avanzamos al siguiente paso pero AÚN acepta respuesta
  // ACCEPTED / REJECTED / CANCELLED: estado final
  status: 'PENDING' | 'ESCALATED' | 'ACCEPTED' | 'REJECTED' | 'TIMEOUT' | 'CANCELLED';
  timeoutAt: Timestamp;

  createdAt: Timestamp;
  createdBy: string;
  createdByName?: string;
  respondedAt?: Timestamp;
  rejectionReason?: string;
  resolvedAt?: Timestamp;
}

// 3 min: tiempo de espera por paso antes de avanzar al siguiente.
// El paso anterior queda ESCALATED (sigue aceptando). El primero que confirma gana.
// Mismo plazo para la convocatoria de un eventual a un evento (`convocatoriaTimeout.ts`).
const TIMEOUT_MINUTES = CONVOCATORIA_TIMEOUT_MINUTES;

// ─── Helper: crear notificación interna (dispara FCM via trigger) ─────────────

export async function crearNotifConvocatoria(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
  override?: { body?: string },
) {
  const tz = 'America/Argentina/Buenos_Aires';
  const startDate =
    conv.startTime instanceof Timestamp
      ? conv.startTime.toDate()
      : null;
  const endDate =
    conv.endTime instanceof Timestamp
      ? conv.endTime.toDate()
      : null;
  // Siempre 24 h (h23): sin él, es-AR devuelve «05:00 p. m.» y el texto queda «16:00 a 05:00 p. m.».
  const horaInicio = startDate ? formatHoraAr24(startDate, tz) : '--:--';
  const horaFin = endDate ? formatHoraAr24(endDate, tz) : '';
  const lugar = [conv.clientName, conv.objectiveName, conv.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
  const codigo = String(conv.shiftCode || '').trim();

  const isLlegadaTarde = conv.type === 'LLEGADA_TARDE';
  const name = guardFirstName({ employeeName: conv.candidateEmployeeName });
  const title = isLlegadaTarde ? '¿Venís?' : '¿Nos das una mano?';
  const body = override?.body
    ? override.body
    : isLlegadaTarde
      ? venisBody(codigo, lugar, horaInicio, name)
      : coberturaBody({
          name,
          objectiveName: conv.objectiveName,
          positionName: conv.positionName,
          clientName: conv.clientName,
          horaInicio,
          horaFin,
        });

  await db.collection('user_notifications').add({
    uid: conv.candidateUid || null,
    employeeId: conv.candidateEmployeeId,
    type: 'CONVOCATORIA_COBERTURA',
    title,
    body,
    empresaId: conv.empresaId,
    convocatoriaId: conv.id,
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || null,
    positionName: conv.positionName || null,
    clientId: conv.clientId || null,
    clientName: conv.clientName || null,
    shiftCode: conv.shiftCode || null,
    startTime: conv.startTime || null,
    endTime: conv.endTime || null,
    read: false,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function nextInCoverageOrder(conv: { type: string; shiftCode?: string }): CandidateType | null {
  const order = isEventoShift({ code: conv.shiftCode })
    ? EVENT_COVERAGE_CASCADE_ORDER
    : OBJECTIVE_COVERAGE_WITH_EVENTUAL;
  const idx = (order as readonly string[]).indexOf(conv.type);
  if (idx >= 0) return (order[idx + 1] as CandidateType) || null;
  return nextCascadeStep(conv.type as CandidateType);
}

export async function convocarEventual(
  db: admin.firestore.Firestore,
  base: ConvocatoriaCoberturaDoc,
  createdBy: string,
): Promise<boolean> {
  const titularGeo = (await db.collection('turnos').doc(base.shiftId).get()).data() || {};
  const pool = await loadEventualesParaHueco(db, {
    empresaId: base.empresaId,
    startTime: base.startTime,
    endTime: base.endTime,
    lat: titularGeo.lat ?? titularGeo.latitude,
    lng: titularGeo.lng ?? titularGeo.longitude,
    // Cupo por género: si faltó una mujer, se reconvocan mujeres (el turno EV lleva `cupoGrupo`).
    generoRequerido: base.generoRequerido ?? titularGeo.cupoGrupo ?? null,
  });
  const excluir = new Set(
    (Array.isArray(titularGeo.excluirBolsaCuils) ? titularGeo.excluirBolsaCuils : [])
      .map((c: unknown) => String(c || '').replace(/\D/g, ''))
      .filter(Boolean),
  );
  const first = pool.find((p) => p.employeeId && !excluir.has(String(p.cuil || '').replace(/\D/g, '')));
  if (!first?.employeeId) return false;
  const order = isEventoShift({ code: base.shiftCode })
    ? EVENT_COVERAGE_CASCADE_ORDER
    : OBJECTIVE_COVERAGE_WITH_EVENTUAL;
  await crearConvocatoriaDoc(db, {
    empresaId: base.empresaId,
    shiftId: base.shiftId,
    objectiveId: base.objectiveId,
    objectiveName: base.objectiveName,
    positionName: base.positionName,
    clientId: base.clientId,
    clientName: base.clientName,
    shiftCode: base.shiftCode,
    startTime: base.startTime,
    endTime: base.endTime,
    aptitudesRequeridas: base.aptitudesRequeridas || [],
    type: 'EVENTUAL',
    cascadeStep: (order as readonly string[]).indexOf('EVENTUAL'),
    candidateEmployeeId: first.employeeId,
    candidateEmployeeName: first.employeeName,
    ...(first.uid ? { candidateUid: first.uid } : {}),
    bolsaCuil: first.cuil,
    createdBy,
  });
  return true;
}

// ─── Helper: avanzar cascada ──────────────────────────────────────────────────

async function avanzarCascada(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
  reason: 'REJECTED' | 'TIMEOUT',
): Promise<void> {
  // LLEGADA_TARDE no participa en la cascada de cobertura
  if (conv.type === 'LLEGADA_TARDE') return;
  const nextType = nextInCoverageOrder(conv);
  if (!nextType) {
    await escalarVacanteSinCobertura(db, {
      shiftId: conv.shiftId,
      empresaId: conv.empresaId,
      objectiveId: conv.objectiveId,
      objectiveName: conv.objectiveName || '',
      positionName: conv.positionName || '',
      message: `Cascada agotada para turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}. Sin candidatos disponibles.`,
      attemptRetention: true,
      source: 'CASCADE_EXHAUSTED',
    });
    return;
  }

  // FT: broadcast — buscar múltiples candidatos de franco en objetivo
  if (nextType === 'FT') {
    await dispararBroadcastFT(db, conv);
    return;
  }

  if (nextType === 'EVENTUAL') {
    const ok = await convocarEventual(db, conv, 'AUTO');
    if (!ok) await avanzarCascada(db, { ...conv, type: 'EVENTUAL' }, reason);
    return;
  }

  // Para otros pasos: buscar el mejor candidato disponible
  const candidate = await findBestCandidate(db, conv, nextType);
  if (!candidate) {
    // No hay candidato en este paso: saltar al siguiente
    const fakeConv = { ...conv, type: nextType };
    await avanzarCascada(db, fakeConv as any, reason);
    return;
  }

  // Obtener teléfono del candidato anterior para WhatsApp directo desde la novedad
  let candidatePhone: string | null = null;
  if (conv.candidateEmployeeId) {
    const empSnap = await db.collection('empleados').doc(conv.candidateEmployeeId).get();
    if (empSnap.exists) candidatePhone = empSnap.data()?.telefono || null;
  }

  // Novedad para ops: el candidato anterior no respondió / rechazó
  await db.collection('novedades').add({
    type: 'CONVOCATORIA_ESCALADA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    clientId: conv.clientId || null,
    empresaId: conv.empresaId,
    title: reason === 'REJECTED' ? 'Convocatoria rechazada' : 'Sin respuesta — escalando',
    message: `${conv.candidateEmployeeName} ${reason === 'REJECTED' ? 'rechazó' : 'no respondió'} — escalando a ${nextType} en ${conv.objectiveName || 'objetivo'}`,
    coverageType: conv.type,
    nextCoverageType: nextType,
    candidateEmployeeId: conv.candidateEmployeeId,
    candidateEmployeeName: conv.candidateEmployeeName,
    candidatePhone,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  const {
    extendShiftId: _prevExt,
    advanceShiftId: _prevAdv,
    candidateShiftId: _prevCand,
    ftShiftId: _prevFt,
    ...convRest
  } = conv as ConvocatoriaCoberturaDoc & {
    extendShiftId?: string;
    advanceShiftId?: string;
    candidateShiftId?: string;
    ftShiftId?: string;
  };
  await crearConvocatoriaDoc(db, {
    ...convRest,
    type: nextType,
    cascadeStep: CASCADE_ORDER.indexOf(nextType),
    candidateEmployeeId: candidate.id,
    candidateEmployeeName: candidate.name,
    ...(candidate.uid ? { candidateUid: candidate.uid } : {}),
    ...(candidate.extendShiftId ? { extendShiftId: candidate.extendShiftId } : {}),
    ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
    ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
    createdBy: 'AUTO',
  });
}

// ─── Helper: crear doc convocatoria + notificación ───────────────────────────

/** Firestore rechaza `undefined`. Se omiten esas claves; `null` se conserva. */
function withoutUndefined<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

export async function crearConvocatoriaDoc(
  db: admin.firestore.Firestore,
  data: Omit<ConvocatoriaCoberturaDoc, 'createdAt' | 'status' | 'timeoutAt' | 'urgency'> & {
    createdBy: string;
    createdByName?: string;
  },
  opts?: { now?: Timestamp },
): Promise<string> {
  const directaInput = {
    empresaId: data.empresaId,
    shiftId: data.shiftId,
    objectiveId: data.objectiveId,
    objectiveName: data.objectiveName,
    positionName: data.positionName,
    clientId: data.clientId,
    clientName: data.clientName,
    shiftCode: data.shiftCode,
    startTime: data.startTime,
    endTime: data.endTime,
    type: data.type,
    candidateEmployeeId: data.candidateEmployeeId,
    candidateEmployeeName: data.candidateEmployeeName,
    candidateShiftId: data.candidateShiftId,
    createdBy: data.createdBy,
  };
  const directa = await resolverCoberturaRefEscRet(db, directaInput, opts);
  if (directa) return `directa:${directa}`;

  const now = Timestamp.now();
  const timeoutAt = Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);

  const urgency = getUrgency(data.startTime);

  const docData = withoutUndefined({
    ...data,
    urgency,
    status: 'PENDING' as const,
    timeoutAt,
    createdAt: now,
  }) as ConvocatoriaCoberturaDoc;

  const ref = await db.collection('convocatorias_cobertura').add(docData);
  await crearNotifConvocatoria(db, { ...docData, id: ref.id });
  await logConvocatoriaEvento(db, ref.id, {
    type: 'CREADA',
    origin: canalOrigenConvocatoria(data.createdBy),
    createdBy: data.createdBy,
    at: now,
  });

  // Novedad para ops — trazabilidad en Bitácora
  const typeLabel: Record<string, string> = {
    RET: 'RET',
    REF: 'Refuerzo',
    ESC: 'Escuela',
    EXTEND: 'Extender jornada',
    ADVANCE: 'Adelantar turno',
    FT: 'Franco Trabajado',
    VOLANTE: 'Volante',
    SIN_TURNO: 'Sin turno',
    SIN_TURNO_CON_EXP: 'Sin turno (con exp.)',
  };
  await db.collection('novedades').add({
    type: 'CONVOCATORIA_ENVIADA',
    convocatoriaId: ref.id,
    shiftId: data.shiftId,
    objectiveId: data.objectiveId,
    objectiveName: data.objectiveName || '',
    clientId: data.clientId || null,
    empresaId: data.empresaId,
    title: 'Convocatoria enviada',
    message: `${typeLabel[data.type] || data.type} → ${data.candidateEmployeeName} — turno ${data.shiftCode || ''} en ${data.objectiveName || 'objetivo'}`,
    coverageType: data.type,
    candidateEmployeeId: data.candidateEmployeeId,
    candidateEmployeeName: data.candidateEmployeeName,
    status: 'unread',
    resolved: false,
    createdAt: now,
  });

  return ref.id;
}

// ─── Helper: encontrar mejor candidato para un paso ──────────────────────────

interface CandidateResult {
  id: string;
  name: string;
  uid?: string;
  extendShiftId?: string;
  advanceShiftId?: string;
  candidateShiftId?: string;
}

export async function findBestCandidate(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc,
  type: CandidateType,
): Promise<CandidateResult | null> {
  if (type === 'VOLANTE' || type === 'SIN_TURNO' || type === 'SIN_TURNO_CON_EXP' || type === 'EVENTUAL') return null;
  const { findBestCoverageCandidate } = await import('./coverageCandidatesServer');
  const found = await findBestCoverageCandidate(db, conv, type);
  if (!found) return null;
  const { row, uid } = found;
  const base: CandidateResult = { id: row.employeeId, name: row.employeeName, uid };
  if (type === 'EXTEND') return { ...base, extendShiftId: row.sourceShiftId };
  if (type === 'ADVANCE') return { ...base, advanceShiftId: row.sourceShiftId };
  return { ...base, candidateShiftId: row.sourceShiftId || undefined };
}

// ─── Helper: broadcast FT ─────────────────────────────────────────────────────

export async function dispararBroadcastFT(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc,
): Promise<void> {
  const { listFtCandidates } = await import('./coverageCandidatesServer');
  const rows = await listFtCandidates(db, conv, 5);
  if (rows.length === 0) return;
  await Promise.all(rows.map(({ row, uid }) => {
    const {
      extendShiftId: _extendShiftId,
      advanceShiftId: _advanceShiftId,
      candidateShiftId: _candidateShiftId,
      ftShiftId: _ftShiftId,
      ...rest
    } = conv as ConvocatoriaCoberturaDoc & {
      extendShiftId?: string;
      advanceShiftId?: string;
      candidateShiftId?: string;
      ftShiftId?: string;
    };
    return crearConvocatoriaDoc(db, {
      ...rest,
      type: 'FT',
      cascadeStep: CASCADE_ORDER.indexOf('FT'),
      candidateEmployeeId: row.employeeId,
      candidateEmployeeName: row.employeeName,
      candidateUid: uid,
      ftShiftId: row.sourceShiftId,
      createdBy: conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO' : 'AUTO',
    });
  }));
}

// ─── Helper: resolver cobertura cuando un guardia acepta ─────────────────────

function dualSiblingConvType(type: string): 'EXTEND' | 'ADVANCE' | null {
  const u = String(type || '').toUpperCase();
  if (u === 'EXTEND') return 'ADVANCE';
  if (u === 'ADVANCE') return 'EXTEND';
  return null;
}

async function extAdvSiblingAccepted(
  db: admin.firestore.Firestore,
  absenceShiftId: string,
  current: 'EXTEND' | 'ADVANCE',
): Promise<boolean> {
  const other = current === 'EXTEND' ? 'ADVANCE' : 'EXTEND';
  const snap = await db
    .collection('convocatorias_cobertura')
    .where('shiftId', '==', absenceShiftId)
    .where('type', '==', other)
    .where('status', '==', 'ACCEPTED')
    .limit(5)
    .get();
  if (snap.empty) return false;
  const { buildOpsCoverageDocId } = await import('./syncAusenciaCobertura');
  for (const d of snap.docs) {
    const employeeId = String(d.data().candidateEmployeeId || '').trim();
    if (!employeeId) continue;
    const ops = await db.collection('turnos').doc(buildOpsCoverageDocId(absenceShiftId, employeeId)).get();
    const data = ops.data();
    if (ops.exists && data?.coverageSuperseded !== true && data?.isDeleted !== true) return true;
  }
  return false;
}

async function hasActiveConvocatoriaForType(
  db: admin.firestore.Firestore,
  shiftId: string,
  convType: string,
): Promise<boolean> {
  const [pending, escalated] = await Promise.all([
    db.collection('convocatorias_cobertura')
      .where('shiftId', '==', shiftId)
      .where('type', '==', convType)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get(),
    db.collection('convocatorias_cobertura')
      .where('shiftId', '==', shiftId)
      .where('type', '==', convType)
      .where('status', '==', 'ESCALATED')
      .limit(1)
      .get(),
  ]);
  return !pending.empty || !escalated.empty;
}

/**
 * Titular PARTIAL (EXT 23–03 o ADV 03–07): ofrecer el tramo que falta.
 * RET/REF/ESC se buscan sobre el tramo. El FT se busca sobre el día del titular
 * (el franco de las 23:00 no cae en el día de las 03:00) y applyCoverage escribe solo el resto.
 * Devuelve true si quedó una convocatoria abierta para ese tramo.
 */
async function offerRemainderAfterPartial(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
  skipType?: string,
): Promise<boolean> {
  const titularSnap = await db.collection('turnos').doc(conv.shiftId).get();
  const titular = (titularSnap.data() || {}) as Record<string, unknown>;
  if (String(titular.coverageStatus || '').toUpperCase() !== 'PARTIAL') return false;
  const covId = String(titular.coverageDocId || '').trim();
  if (!covId) return false;
  const cov = (await db.collection('turnos').doc(covId).get()).data() as Record<string, unknown> | undefined;
  const gap = gapWindowFromTitularShift(titular);
  if (!cov || !gap) return false;
  const rem = uncoveredRemainderMs(gap.startMs, gap.endMs, shiftStartMs(cov), shiftEndMs(cov));
  if (!rem) return false;

  const skip = String(skipType || '').toUpperCase();
  const {
    extendShiftId: _extendShiftId,
    advanceShiftId: _advanceShiftId,
    candidateShiftId: _candidateShiftId,
    ftShiftId: _ftShiftId,
    id: _id,
    ...base
  } = conv as ConvocatoriaCoberturaDoc & {
    id: string;
    extendShiftId?: string;
    advanceShiftId?: string;
    candidateShiftId?: string;
    ftShiftId?: string;
  };
  const createdBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO' : 'AUTO';

  for (const type of ['RET', 'REF', 'ESC'] as const) {
    if (type === skip) continue;
    if (await hasActiveConvocatoriaForType(db, conv.shiftId, type)) return true;
    const candidate = await findBestCandidate(db, {
      ...conv,
      startTime: Timestamp.fromMillis(rem.startMs),
      endTime: Timestamp.fromMillis(rem.endMs),
    }, type);
    if (!candidate) continue;
    await crearConvocatoriaDoc(db, {
      ...base,
      startTime: Timestamp.fromMillis(rem.startMs),
      endTime: Timestamp.fromMillis(rem.endMs),
      type,
      cascadeStep: CASCADE_ORDER.indexOf(type),
      candidateEmployeeId: candidate.id,
      candidateEmployeeName: candidate.name,
      ...(candidate.uid ? { candidateUid: candidate.uid } : {}),
      ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
      createdBy,
    });
    return true;
  }

  if (skip === 'FT') return false;
  if (await hasActiveConvocatoriaForType(db, conv.shiftId, 'FT')) return true;
  const { listFtCandidates } = await import('./coverageCandidatesServer');
  const rows = await listFtCandidates(db, conv, 5);
  if (!rows.length) return false;
  await Promise.all(rows.map(({ row, uid }) => crearConvocatoriaDoc(db, {
    ...base,
    type: 'FT',
    cascadeStep: CASCADE_ORDER.indexOf('FT'),
    candidateEmployeeId: row.employeeId,
    candidateEmployeeName: row.employeeName,
    ...(uid ? { candidateUid: uid } : {}),
    ftShiftId: row.sourceShiftId,
    createdBy,
  })));
  return true;
}

/** Tras aceptar una pata EXT/ADV con titular PARTIAL: convocar la pata faltante si no hay activa. */
async function ensureMissingDualLegConvocatoria(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
): Promise<void> {
  const missing = dualSiblingConvType(conv.type);
  if (!missing) return;

  const titularSnap = await db.collection('turnos').doc(conv.shiftId).get();
  const st = String(titularSnap.data()?.coverageStatus || '').toUpperCase();
  if (st !== 'PARTIAL') return;

  const siblingAccepted = await extAdvSiblingAccepted(
    db,
    conv.shiftId,
    conv.type as 'EXTEND' | 'ADVANCE',
  );
  if (siblingAccepted) return;

  if (await hasActiveConvocatoriaForType(db, conv.shiftId, missing)) return;

  const candidate = await findBestCandidate(db, conv, missing);
  if (!candidate) {
    const offered = await offerRemainderAfterPartial(db, conv, missing);
    if (offered) return;
    await db.collection('novedades').add({
      type: 'VACANTE_PARCIAL',
      shiftId: conv.shiftId,
      objectiveId: conv.objectiveId,
      objectiveName: conv.objectiveName || '',
      empresaId: conv.empresaId,
      message: `Cobertura parcial: falta el tramo restante (${missing} / FT / RET) y no hay candidato en ${conv.objectiveName || 'objetivo'}.`,
      coverageType: missing,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  const {
    extendShiftId: _prevExt,
    advanceShiftId: _prevAdv,
    candidateShiftId: _prevCand,
    ...convWithoutLegIds
  } = conv;

  await crearConvocatoriaDoc(db, {
    ...convWithoutLegIds,
    type: missing,
    cascadeStep: CASCADE_ORDER.indexOf(missing),
    candidateEmployeeId: candidate.id,
    candidateEmployeeName: candidate.name,
    ...(candidate.uid ? { candidateUid: candidate.uid } : {}),
    ...(candidate.extendShiftId ? { extendShiftId: candidate.extendShiftId } : {}),
    ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
    ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
    createdBy: conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO' : 'AUTO',
  });
}

async function avanzarCascadaOrPartialVacante(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
  reason: 'REJECTED' | 'TIMEOUT',
): Promise<void> {
  if (reason === 'REJECTED' && !shouldAdvanceOnReject(conv.status)) {
    // El timeout ya escaló este paso; el rechazo tardío no dispara la cascada otra vez.
    console.log(`[avanzarCascada] skip ${conv.id}: ya ESCALATED, rechazo tardío no avanza`);
    return;
  }
  if (String(conv.createdBy || '').toUpperCase() === 'MODO_DEMO') {
    const inOp = await new ObjectiveOperationCache().isShiftInOperation(db, {
      empresaId: conv.empresaId,
      objectiveId: conv.objectiveId,
      startTime: conv.startTime,
    });
    if (!inOp) {
      console.log(`[avanzarCascada] skip Demo fuera de operación shift=${conv.shiftId}`);
      return;
    }
  }
  if (conv.type === 'EXTEND' || conv.type === 'ADVANCE') {
    const titularSnap = await db.collection('turnos').doc(conv.shiftId).get();
    const st = String(titularSnap.data()?.coverageStatus || '').toUpperCase();
    if (st === 'PARTIAL') {
      const offered = await offerRemainderAfterPartial(db, conv, conv.type);
      if (!offered) {
        await db.collection('novedades').add({
          type: 'VACANTE_PARCIAL',
          shiftId: conv.shiftId,
          objectiveId: conv.objectiveId,
          objectiveName: conv.objectiveName || '',
          empresaId: conv.empresaId,
          title: 'Cobertura parcial incompleta',
          message: `${conv.candidateEmployeeName} ${reason === 'REJECTED' ? 'rechazó' : 'no respondió'} la pata ${conv.type}. El tramo que falta no tiene RET, FT ni ADV.`,
          coverageType: conv.type,
          candidateEmployeeId: conv.candidateEmployeeId,
          candidateEmployeeName: conv.candidateEmployeeName,
          status: 'unread',
          resolved: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }
  }
  await avanzarCascada(db, conv, reason);
}

function convTypeToCoverageType(type: string): string {
  const u = String(type || '').toUpperCase();
  if (u === 'VOLANTE' || u.startsWith('SIN_TURNO')) return 'SIN_TURNO';
  return u;
}

export async function resolverCobertura(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
): Promise<{ ok: boolean; message?: string }> {
  const {
    syncAusenciaCoberturaGestionada,
    isTitularAlreadyCovered,
    applyCoverage,
    CoverageApplyError,
  } = await import('./syncAusenciaCobertura');

  const titularRef = db.collection('turnos').doc(conv.shiftId);
  const convRef = db.collection('convocatorias_cobertura').doc(conv.id);

  const claimAgeMs = (claimAt: unknown): number | null => {
    if (!claimAt) return null;
    const ts = claimAt as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === 'function') return Date.now() - ts.toMillis();
    if (typeof ts.seconds === 'number') return Date.now() - ts.seconds * 1000;
    return null;
  };

  const claim = await db.runTransaction(async (tx) => {
    const titularSnap = await tx.get(titularRef);
    const titularData = titularSnap.data() || {};
    const claimConv = String(titularData.coverageClaimConvocatoriaId || '').trim();
    if (isTitularAlreadyCovered(titularData)) {
      if (
        String(titularData.coverageConvocatoriaId || '') === conv.id
        || claimConv === conv.id
      ) {
        return { ok: true, already: true, titular: titularData, heldClaim: false };
      }
      tx.update(convRef, {
        status: 'CANCELLED',
        cancelReason: 'ALREADY_COVERED',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: false, already: true, titular: titularData, heldClaim: false };
    }
    if (claimConv && claimConv !== conv.id) {
      const age = claimAgeMs(titularData.coverageClaimAt);
      if (age !== null && age < 2 * 60 * 1000) {
        tx.update(convRef, {
          status: 'CANCELLED',
          cancelReason: 'CLAIM_HELD_BY_OTHER_CONVOCATORIA',
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { ok: false, already: true, titular: titularData, heldClaim: false };
      }
    }
    tx.update(titularRef, {
      coverageClaimConvocatoriaId: conv.id,
      coverageClaimAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, already: false, titular: titularData, heldClaim: true };
  });

  if (!claim.ok) {
    console.log(`[resolverCobertura] skip ${conv.id}: ausencia ${conv.shiftId} ya cubierta`);
    await logConvocatoriaEvento(db, conv.id, {
      type: 'RESULTADO',
      outcome: 'cancelada',
      reason: 'ALREADY_COVERED',
    });
    return { ok: false, message: 'El hueco ya fue cubierto.' };
  }

  const claimHeld = !!claim.heldClaim && !claim.already;
  const releaseClaim = async () => {
    if (!claimHeld) return;
    try {
      await titularRef.update({ coverageClaimConvocatoriaId: FieldValue.delete() });
    } catch (err) {
      console.warn('[resolverCobertura] release claim:', (err as Error).message);
    }
  };

  const { revalidateAcceptance } = await import('./coverageCandidatesServer');
  const check = await revalidateAcceptance(db, conv, 'accept');
  if (!check.ok) {
    const huecoCubierto = check.reason === 'HUECO_CUBIERTO';
    await convRef.update({
      status: huecoCubierto ? 'CANCELLED' : 'REJECTED',
      respondedAt: Timestamp.now(),
      rejectionReason: check.reason || 'NO_DISPONIBLE',
      rejectionMessage: check.message || 'No se puede tomar esta cobertura.',
      ...(huecoCubierto ? { cancelReason: 'ALREADY_COVERED', cancelledAt: FieldValue.serverTimestamp() } : {}),
    });
    await releaseClaim();
    await logConvocatoriaEvento(db, conv.id, {
      type: 'RESULTADO',
      outcome: huecoCubierto ? 'cancelada' : 'revalidacion_rechazada',
      reason: check.reason || 'NO_DISPONIBLE',
    });
    if (!huecoCubierto) await avanzarCascadaOrPartialVacante(db, conv, 'REJECTED');
    return { ok: false, message: check.message || 'No se puede tomar esta cobertura.' };
  }
  const acceptedAt = Timestamp.now();
  await convRef.update({
    status: 'ACCEPTED',
    respondedAt: acceptedAt,
    resolvedAt: acceptedAt,
  });

  const batch = db.batch();

  const resolvedBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO'
                   : conv.createdBy === 'AUTO' ? 'AUTO'
                   : 'OPERACIONES';

  const titularData = claim.titular as Record<string, unknown>;
  const empresaId = String(conv.empresaId || titularData.empresaId || '');

  let titularCloseMode: 'FULL' | 'PARTIAL' = 'FULL';
  let rrhhCoverageType = convTypeToCoverageType(String(conv.type));

  const {
    dualExtAdvSegmentTimestamps,
    titularAnchorFromShift,
    resolveCoverageBandCode: resolveBand,
    gapSpanFromShift,
  } = await import('./coverageExtAdvSegments');

  try {
    if (conv.type === 'EXTEND' && conv.extendShiftId) {
      const anchor = titularAnchorFromShift(titularData);
      const gapBand = resolveBand({ code: conv.shiftCode, startTime: conv.startTime });
      const seg = dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand, ...gapSpanFromShift(titularData) });
      const dualOk = await extAdvSiblingAccepted(db, conv.shiftId, 'EXTEND');
      titularCloseMode = dualOk ? 'FULL' : 'PARTIAL';
      rrhhCoverageType = dualOk ? 'RETENCION' : 'EXTEND';
      await applyCoverage(db, batch, {
        titularShiftId: conv.shiftId,
        titularShift: titularData,
        candidateEmployeeId: conv.candidateEmployeeId,
        candidateEmployeeName: conv.candidateEmployeeName,
        sourceShiftId: conv.extendShiftId,
        coverageType: 'EXTEND',
        resolvedBy: resolvedBy as 'OPERACIONES' | 'AUTO' | 'MODO_DEMO',
        empresaId,
        code: conv.shiftCode,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName,
        clientId: conv.clientId,
        convocatoriaId: conv.id,
        acceptedAt,
        titularCloseMode,
        covSegmentStart: seg.extCov.start,
        covSegmentEnd: seg.extCov.end,
        extensionEndTime: seg.extCov.end,
      });
    } else if (conv.type === 'ADVANCE' && conv.advanceShiftId) {
      const anchor = titularAnchorFromShift(titularData);
      const gapBand = resolveBand({ code: conv.shiftCode, startTime: conv.startTime });
      const seg = dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand, ...gapSpanFromShift(titularData) });
      const dualOk = await extAdvSiblingAccepted(db, conv.shiftId, 'ADVANCE');
      titularCloseMode = dualOk ? 'FULL' : 'PARTIAL';
      rrhhCoverageType = dualOk ? 'RETENCION' : 'ADVANCE';
      await applyCoverage(db, batch, {
        titularShiftId: conv.shiftId,
        titularShift: titularData,
        candidateEmployeeId: conv.candidateEmployeeId,
        candidateEmployeeName: conv.candidateEmployeeName,
        sourceShiftId: conv.advanceShiftId,
        coverageType: 'ADVANCE',
        resolvedBy: resolvedBy as 'OPERACIONES' | 'AUTO' | 'MODO_DEMO',
        empresaId,
        code: conv.shiftCode,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName,
        clientId: conv.clientId,
        convocatoriaId: conv.id,
        acceptedAt,
        titularCloseMode,
        covSegmentStart: seg.advCov.start,
        covSegmentEnd: seg.advCov.end,
        adjustedStartTime: seg.advCov.start,
      });
    } else {
      const sourceShiftId =
        conv.type === 'FT'
          ? conv.ftShiftId
          : conv.candidateShiftId;
      rrhhCoverageType = convTypeToCoverageType(String(conv.type));
      const covDocId = await applyCoverage(db, batch, {
        titularShiftId: conv.shiftId,
        titularShift: titularData,
        candidateEmployeeId: conv.candidateEmployeeId,
        candidateEmployeeName: conv.candidateEmployeeName,
        sourceShiftId: sourceShiftId || null,
        coverageType: rrhhCoverageType,
        resolvedBy: resolvedBy as 'OPERACIONES' | 'AUTO' | 'MODO_DEMO',
        empresaId,
        startTime: conv.startTime,
        endTime: conv.endTime,
        code: conv.type === 'FT' ? 'FT' : conv.shiftCode,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName,
        clientId: conv.clientId,
        convocatoriaId: conv.id,
        acceptedAt,
        titularCloseMode: 'FULL',
      });
      if (conv.type === 'EVENTUAL') {
        const startMs = conv.startTime instanceof Timestamp ? conv.startTime.toMillis() : 0;
        const endMs = conv.endTime instanceof Timestamp ? conv.endTime.toMillis() : 0;
        await registrarAsignacionEventualEnBatch(db, batch, {
          empresaId: conv.empresaId,
          cuil: String(conv.bolsaCuil || conv.candidateEmployeeId),
          employeeId: conv.candidateEmployeeId,
          employeeName: conv.candidateEmployeeName,
          startMs,
          endMs,
          shiftId: conv.shiftId,
          covDocId,
        });
      }
    }

    if (titularCloseMode === 'FULL') {
    await syncAusenciaCoberturaGestionada(
      db,
      {
        shiftId: conv.shiftId,
        coveredByEmployeeId: conv.candidateEmployeeId,
        coveredByEmployeeName: conv.candidateEmployeeName,
        coverageType: rrhhCoverageType,
        resolvedBy,
        empresaId: conv.empresaId || null,
      },
      batch,
    );
  }

  // PARTIAL conserva el resto (FT pendientes y la pata hermana). Solo FULL cancela lo que sigue abierto.
  const cancelledByFull: string[] = [];
  if (titularCloseMode === 'FULL') {
    const [pendingSnap, escalatedSnap] = await Promise.all([
      db.collection('convocatorias_cobertura').where('shiftId', '==', conv.shiftId).where('status', '==', 'PENDING').get(),
      db.collection('convocatorias_cobertura').where('shiftId', '==', conv.shiftId).where('status', '==', 'ESCALATED').get(),
    ]);
    for (const d of [...pendingSnap.docs, ...escalatedSnap.docs]) {
      if (d.id === conv.id) continue;
      cancelledByFull.push(d.id);
      batch.update(d.ref, {
        status: 'CANCELLED',
        cancelReason: 'FULL',
        cancelledAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // Novedad para ops — aparece en Bitácora
  const novedadRef = db.collection('novedades').doc();
  const typeLabel: Record<string, string> = {
    RET: 'RET activado',
    REF: 'Refuerzo (REF)',
    ESC: 'Escuela (ESC)',
    EXTEND: 'Jornada extendida',
    ADVANCE: 'Turno adelantado',
    FT: 'Franco Trabajado',
    EVENTUAL: 'Eventual',
    VOLANTE: 'Cobertura volante',
    SIN_TURNO: 'Guardia disponible',
    SIN_TURNO_CON_EXP: 'Guardia con experiencia',
  };
  batch.set(novedadRef, {
    type: 'COBERTURA_RESUELTA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    clientId: conv.clientId || null,
    empresaId: conv.empresaId,
    title: 'Cobertura resuelta',
    message: `${typeLabel[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
    description: `${typeLabel[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
    coverageType: conv.type,
    candidateEmployeeId: conv.candidateEmployeeId,
    candidateEmployeeName: conv.candidateEmployeeName,
    employeeId: conv.candidateEmployeeId,
    employeeName: conv.candidateEmployeeName,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

    await batch.commit();
    await logConvocatoriaEvento(db, conv.id, {
      type: 'RESULTADO',
      outcome: 'aplicada',
    });
    for (const cancelledId of cancelledByFull) {
      await logConvocatoriaEvento(db, cancelledId, {
        type: 'RESULTADO',
        outcome: 'cancelada',
        reason: 'FULL',
      });
    }

    if (
      titularCloseMode === 'PARTIAL'
      && (conv.type === 'EXTEND' || conv.type === 'ADVANCE')
    ) {
      await ensureMissingDualLegConvocatoria(db, conv);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof CoverageApplyError && e.code === 'ALREADY_COVERED') {
      console.warn(
        `[resolverCobertura] ALREADY_COVERED conv=${conv.id} shift=${conv.shiftId}: ${e.message}`,
      );
      const errBatch = db.batch();
      errBatch.update(convRef, {
        status: 'CANCELLED',
        cancelReason: 'ALREADY_COVERED',
        cancelledAt: FieldValue.serverTimestamp(),
      });
      await errBatch.commit();
      return { ok: false, message: 'El hueco ya fue cubierto.' };
    }
    console.error(`[resolverCobertura] error conv=${conv.id}:`, (e as Error).message);
    throw e;
  } finally {
    await releaseClaim();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: crearConvocatoriaCobertura
// Crea una convocatoria para un candidato específico y tipo de cobertura.
// Puede llamarse desde CoverageModal (manual) o desde la cascada automática.
// ═══════════════════════════════════════════════════════════════════════════════

export const crearConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const {
      shiftId,
      candidateEmployeeId,
      type,
      empresaId,
      advanceShiftId,
      extendShiftId,
      ftShiftId,
      candidateShiftId,
    } = data as {
      shiftId: string;
      candidateEmployeeId: string;
      type: CandidateType;
      empresaId: string;
      advanceShiftId?: string;
      extendShiftId?: string;
      ftShiftId?: string;
      candidateShiftId?: string;
    };

    if (!shiftId || !candidateEmployeeId || !type || !empresaId) {
      throw new functions.https.HttpsError('invalid-argument', 'shiftId, candidateEmployeeId, type y empresaId son requeridos.');
    }

    // Cargar turno vacante
    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    }
    const shift = shiftSnap.data()!;

    if (type === 'EVENTUAL') {
      const cuil = String((data as { bolsaCuil?: string }).bolsaCuil || candidateEmployeeId).trim();
      const bolsaSnap = await db.collection('eventuales_bolsa').doc(cuil).get();
      if (!bolsaSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Eventual no encontrado en la bolsa.');
      }
      const pool = await loadEventualesParaHueco(db, {
        empresaId,
        startTime: shift.startTime,
        endTime: shift.endTime,
        lat: shift.lat,
        lng: shift.lng,
        cupoGrupo: shift.cupoGrupo,
      });
      const hit = pool.find((p) => p.cuil === cuil || p.employeeId === candidateEmployeeId);
      if (!hit) {
        throw new functions.https.HttpsError('failed-precondition', 'El eventual no está disponible para este hueco (cruce, vigencia o empresa).');
      }
      const existingEv = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', shiftId)
        .where('candidateEmployeeId', '==', hit.employeeId)
        .where('status', '==', 'PENDING')
        .limit(1)
        .get();
      if (!existingEv.empty) {
        throw new functions.https.HttpsError('already-exists', 'Ya hay una convocatoria pendiente para este eventual y turno.');
      }
      const callerEv = await db.collection('system_users').doc(context.auth.uid).get();
      const callerEvName = callerEv.exists ? String(callerEv.data()?.displayName || callerEv.data()?.name || '') : '';
      const orderEv = isEventoShift(shift) ? EVENT_COVERAGE_CASCADE_ORDER : OBJECTIVE_COVERAGE_WITH_EVENTUAL;
      const convEv = await crearConvocatoriaDoc(db, {
        empresaId,
        shiftId,
        objectiveId: String(shift.objectiveId || ''),
        objectiveName: String(shift.objectiveName || ''),
        positionName: String(shift.positionName || ''),
        clientId: String(shift.clientId || ''),
        clientName: String(shift.clientName || ''),
        shiftCode: String(shift.code || ''),
        startTime: shift.startTime,
        endTime: shift.endTime,
        aptitudesRequeridas: [],
        type: 'EVENTUAL',
        cascadeStep: (orderEv as readonly string[]).indexOf('EVENTUAL'),
        candidateEmployeeId: hit.employeeId,
        candidateEmployeeName: hit.employeeName,
        ...(hit.uid ? { candidateUid: hit.uid } : {}),
        bolsaCuil: hit.cuil,
        createdBy: context.auth.uid,
        createdByName: callerEvName,
      });
      return { success: true, convocatoriaId: convEv };
    }

    // Cargar candidato
    const empSnap = await db.collection('empleados').doc(candidateEmployeeId).get();
    if (!empSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
    }
    const emp = empSnap.data()!;

    const { revalidateAcceptance } = await import('./coverageCandidatesServer');
    const check = await revalidateAcceptance(db, {
      empresaId,
      shiftId,
      objectiveId: String(shift.objectiveId || ''),
      clientId: String(shift.clientId || ''),
      positionName: String(shift.positionName || ''),
      shiftCode: String(shift.code || ''),
      startTime: shift.startTime,
      endTime: shift.endTime,
      type,
      candidateEmployeeId,
      extendShiftId,
      advanceShiftId,
      candidateShiftId,
      ftShiftId,
    }, 'select');
    if (!check.ok) {
      throw new functions.https.HttpsError('failed-precondition', check.message || 'Candidato no elegible.');
    }

    // Verificar que no haya ya una PENDING para este shiftId/candidato
    const existing = await db.collection('convocatorias_cobertura')
      .where('shiftId', '==', shiftId)
      .where('candidateEmployeeId', '==', candidateEmployeeId)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new functions.https.HttpsError('already-exists', 'Ya hay una convocatoria pendiente para este guardia y turno.');
    }

    const empName = `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || candidateEmployeeId;
    const uid = await findEmployeeUid(db, candidateEmployeeId, emp);

    const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
    const callerName = callerSnap.exists ? String(callerSnap.data()?.displayName || callerSnap.data()?.name || '') : '';

    const convId = await crearConvocatoriaDoc(db, {
      empresaId,
      shiftId,
      objectiveId: String(shift.objectiveId || ''),
      objectiveName: String(shift.objectiveName || ''),
      positionName: String(shift.positionName || ''),
      clientId: String(shift.clientId || ''),
      clientName: String(shift.clientName || ''),
      shiftCode: String(shift.code || ''),
      startTime: shift.startTime,
      endTime: shift.endTime,
      aptitudesRequeridas: [],
      type,
      cascadeStep: CASCADE_ORDER.indexOf(type),
      candidateEmployeeId,
      candidateEmployeeName: empName,
      candidateUid: uid || undefined,
      ...(advanceShiftId ? { advanceShiftId } : {}),
      ...(extendShiftId ? { extendShiftId } : {}),
      ...(ftShiftId ? { ftShiftId } : {}),
      ...(candidateShiftId ? { candidateShiftId } : {}),
      createdBy: context.auth.uid,
      createdByName: callerName,
    });

    if (convId.startsWith('directa:')) {
      return { success: true, aplicadaDirecta: true, covDocId: convId.slice('directa:'.length), convocatoriaId: null };
    }
    return { success: true, convocatoriaId: convId };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: responderConvocatoriaCobertura
// El guardia acepta o rechaza una convocatoria desde el portal.
// ═══════════════════════════════════════════════════════════════════════════════

export const responderConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const { convocatoriaId, response, rejectionReason, etaMinutes, responseChannel, deviceId, platform, appVersion, originCoords } = data as {
      convocatoriaId: string;
      response: 'ACCEPTED' | 'REJECTED';
      rejectionReason?: string;
      etaMinutes?: number;
      responseChannel?: string;
      deviceId?: string;
      platform?: string;
      appVersion?: string;
      originCoords?: { lat?: number; lng?: number; accuracy?: number };
    };
    const responseMeta = {
      ...(responseChannel ? { responseChannel } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(platform ? { platform } : {}),
      ...(appVersion ? { appVersion } : {}),
    };

    if (!convocatoriaId || !response) {
      throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId y response son requeridos.');
    }

    const convRef = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');
    }
    const conv = convSnap.data() as ConvocatoriaCoberturaDoc;

    // Acepta PENDING y ESCALATED — el paso anterior sigue activo incluso si ya avanzamos
    if (conv.status !== 'PENDING' && conv.status !== 'ESCALATED') {
      throw new functions.https.HttpsError('failed-precondition', `La convocatoria ya fue ${conv.status}.`);
    }

    // Verificar que quien responde es el candidato.
    // Preview SuperAdmin: solo si manda asEmployeeId igual al candidato (no otros roles).
    const uid = context.auth.uid;
    const empByUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    const empId = empByUid.empty ? uid : empByUid.docs[0].id;
    const asEmployeeId = String((data as { asEmployeeId?: string }).asEmployeeId || '').trim();
    const callerMatches =
      !conv.candidateUid || conv.candidateUid === uid || conv.candidateEmployeeId === empId;
    const { isEventualPreviewSuperAdmin, canRespondCoberturaAsPreview } = await import('../eventuales/eventualPreviewAuth');
    const token = context.auth.token as { role?: unknown; type?: unknown };
    const previewOk = canRespondCoberturaAsPreview({
      isSuperAdmin: isEventualPreviewSuperAdmin(token.role, token.type),
      asEmployeeId,
      candidateEmployeeId: conv.candidateEmployeeId,
    });

    if (!callerMatches && !previewOk) {
      throw new functions.https.HttpsError('permission-denied', 'No podés responder una convocatoria que no te pertenece.');
    }
    if (previewOk && !callerMatches) {
      (responseMeta as { previewRespondedBy?: string }).previewRespondedBy = uid;
    }

    const now = Timestamp.now();

    if (conv.type === 'LLEGADA_TARDE') {
      const shiftSnap = await db.collection('turnos').doc(conv.shiftId).get();
      const shiftData = (shiftSnap.data() || {}) as Record<string, unknown>;
      if (skipAbsencePipelineForShift(shiftData)) {
        return { success: true, skipped: 'trace_registration' };
      }
      const startMs = (shiftData.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (response === 'ACCEPTED') {
        await convRef.update({ status: 'ACCEPTED', respondedAt: now, resolvedAt: now, ...responseMeta });
        await logConvocatoriaEvento(db, convocatoriaId, {
          type: 'RESPUESTA',
          response: 'ACCEPTED',
          channel: responseChannel || 'PORTAL',
          deviceId,
          platform,
          appVersion,
          at: now,
        });
        const eta = clampLateEtaMinutes(etaMinutes);
        const etaAt = startMs > 0 ? Timestamp.fromMillis(startMs + eta * 60 * 1000) : now;
        await db.collection('turnos').doc(conv.shiftId).update({
          lateArrivalConfirmed: true,
          lateArrivalConfirmedAt: now,
          lateArrivalEtaMinutes: eta,
          lateArrivalEtaAt: etaAt,
        });
        const { applyLateReliefNoticeToOutgoing } = await import('../fichajes/relevoNotifications');
        await applyLateReliefNoticeToOutgoing(db, conv.shiftId, shiftData, etaAt).catch(() => {});
      } else {
        await convRef.update({ status: 'REJECTED', respondedAt: now, rejectionReason: rejectionReason || null, ...responseMeta });
        await logConvocatoriaEvento(db, convocatoriaId, {
          type: 'RESPUESTA',
          response: 'REJECTED',
          channel: responseChannel || 'PORTAL',
          deviceId,
          platform,
          appVersion,
          reason: rejectionReason || undefined,
          at: now,
        });
        await markShiftAbsent(db, conv.shiftId, {
          reason: 'LLEGADA_TARDE_RECHAZADA',
          by: context.auth.uid,
        });
      }
      return { success: true };
    }

    if (response === 'ACCEPTED') {
      await logConvocatoriaEvento(db, convocatoriaId, {
        type: 'RESPUESTA',
        response: 'ACCEPTED',
        channel: responseChannel || 'PORTAL',
        deviceId,
        platform,
        appVersion,
        at: now,
      });
      if (Object.keys(responseMeta).length > 0) await convRef.update(responseMeta);
      const result = await resolverCobertura(db, { ...conv, id: convocatoriaId });
      if (!result.ok) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          result.message || 'No se puede tomar esta cobertura.',
        );
      }
      if (conv.type !== 'EXTEND') {
        const { recordConvocadoAcceptEta } = await import('./convocadoAcceptEta');
        await recordConvocadoAcceptEta(db, convocatoriaId, { originCoords, now });
      }
    } else {
      await convRef.update({
        status: 'REJECTED',
        respondedAt: now,
        rejectionReason: rejectionReason || null,
        ...responseMeta,
      });
      await logConvocatoriaEvento(db, convocatoriaId, {
        type: 'RESPUESTA',
        response: 'REJECTED',
        channel: responseChannel || 'PORTAL',
        deviceId,
        platform,
        appVersion,
        reason: rejectionReason || undefined,
        at: now,
      });
      await db.collection('novedades').add({
        type: 'CONVOCATORIA_RECHAZADA',
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName || '',
        empresaId: conv.empresaId,
        message: `${conv.candidateEmployeeName} rechazó la convocatoria (${conv.type}). Avanzando cascada.`,
        resolved: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      await avanzarCascadaOrPartialVacante(db, { ...conv, id: convocatoriaId }, 'REJECTED');
    }

    return { success: true };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: cancelarConvocatoriaCobertura
// Operaciones cancela una convocatoria activa.
// ═══════════════════════════════════════════════════════════════════════════════

export const cancelarConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const { convocatoriaId } = data as { convocatoriaId: string };
    if (!convocatoriaId) throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId requerido.');

    const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');

    if (snap.data()?.status !== 'PENDING') {
      throw new functions.https.HttpsError('failed-precondition', 'Solo se pueden cancelar convocatorias PENDING.');
    }

    await ref.update({
      status: 'CANCELLED',
      cancelledAt: Timestamp.now(),
      cancelledBy: context.auth.uid,
    });

    return { success: true };
  });

// getCandidatosCobertura retirado: los candidatos salen de buildCoverageCandidates (ops-core).

// ─── MODO DEMO: arrancar cascada desde step 0 para un turno ausente ──────────

export interface ShiftDataForCascade {
  id: string;
  objectiveId: string;
  objectiveName?: string;
  positionName?: string;
  clientId?: string;
  clientName?: string;
  code?: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  empresaId: string;
}

export async function iniciarCascadaCobertura(
  db: admin.firestore.Firestore,
  shift: ShiftDataForCascade,
  createdBy = 'AUTO',
): Promise<void> {
  if (String(createdBy || '').toUpperCase() === 'MODO_DEMO') {
    const inOp = await new ObjectiveOperationCache().isShiftInOperation(db, {
      empresaId: shift.empresaId,
      objectiveId: shift.objectiveId,
      startTime: shift.startTime,
    });
    if (!inOp) {
      console.log(`[iniciarCascadaCobertura] skip Demo fuera de operación ${shift.id}`);
      return;
    }
  }

  const { isTitularAlreadyCovered, isActiveOpsCoverageDoc } = await import('./syncAusenciaCobertura');

  // Idempotencia: si el titular ya está cubierto, no reabrir cascada (modo demo incluido).
  const titularRef = db.collection('turnos').doc(shift.id);
  const titularSnap = await titularRef.get();
  const titularData = (titularSnap.data() || {}) as Record<string, unknown>;
  if (isTitularAlreadyCovered(titularData)) {
    console.log(`[iniciarCascadaCobertura] skip ${shift.id}: ya cubierta`);
    return;
  }

  // Una cascada por hueco: trigger, callable y cron pueden llegar en el mismo segundo.
  if (titularSnap.exists) {
    const locked = await db.runTransaction(async (tx) => {
      const cur = (await tx.get(titularRef)).data() || {};
      const nowMs = Date.now();
      if (cascadeLockHeld(toMillisLoose(cur.cascadeLockAt), nowMs)) return false;
      tx.update(titularRef, { cascadeLockAt: Timestamp.fromMillis(nowMs), cascadeLockBy: createdBy });
      return true;
    });
    if (!locked) {
      console.log(`[iniciarCascadaCobertura] skip ${shift.id}: cascada ya iniciada hace < ${CASCADE_LOCK_MS / 1000}s`);
      return;
    }
  }

  const priorCov = await db.collection('turnos')
    .where('absenceShiftId', '==', shift.id)
    .limit(20)
    .get();
  if (priorCov.docs.some((d) => isActiveOpsCoverageDoc(d.data()))) {
    console.log(`[iniciarCascadaCobertura] skip ${shift.id}: ya hay OPERATIONS_COVERAGE activa`);
    return;
  }

  // Si ya hay una convocatoria activa para este turno, no crear otra
  const existing = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(1)
    .get();
  if (!existing.empty) return;

  const baseConvData: ConvocatoriaCoberturaDoc = {
    empresaId: shift.empresaId,
    shiftId: shift.id,
    objectiveId: String(shift.objectiveId || ''),
    objectiveName: String(shift.objectiveName || ''),
    positionName: String(shift.positionName || ''),
    clientId: String(shift.clientId || ''),
    clientName: String(shift.clientName || ''),
    shiftCode: String(shift.code || ''),
    startTime: shift.startTime,
    endTime: shift.endTime,
    aptitudesRequeridas: [],
    type: 'RET',
    urgency: getUrgency(shift.startTime),
    cascadeStep: 0,
    candidateEmployeeId: '',
    candidateEmployeeName: '',
    status: 'PENDING',
    timeoutAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    createdBy,
  };

  const eventGap = isEventoShift(titularData);
  const order = (eventGap ? EVENT_COVERAGE_CASCADE_ORDER : OBJECTIVE_COVERAGE_WITH_EVENTUAL) as readonly CandidateType[];
  // Cupo por género del servicio: la cascada respeta el grupo del ausente (eventuales y nómina).
  const cupoGrupo = String(titularData.cupoGrupo || '').toUpperCase();
  if (eventGap && (cupoGrupo === 'M' || cupoGrupo === 'F')) baseConvData.generoRequerido = cupoGrupo;

  // Iterar la cascada desde el primer paso hasta encontrar candidato
  for (const type of order) {
    if (type === 'EVENTUAL') {
      const ok = await convocarEventual(db, { ...baseConvData, shiftCode: String(shift.code || titularData.code || '') }, createdBy);
      if (ok) return;
      continue;
    }
    if (type === 'FT') {
      await dispararBroadcastFT(db, baseConvData);
      return;
    }
    const candidate = await findBestCandidate(db, baseConvData, type);
    if (!candidate) continue;

    await crearConvocatoriaDoc(db, {
      ...baseConvData,
      type,
      cascadeStep: order.indexOf(type),
      candidateEmployeeId: candidate.id,
      candidateEmployeeName: candidate.name,
      ...(candidate.uid ? { candidateUid: candidate.uid } : {}),
      ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
      ...(candidate.extendShiftId ? { extendShiftId: candidate.extendShiftId } : {}),
      ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
      createdBy,
    });
    return;
  }

  await escalarVacanteSinCobertura(db, {
    shiftId: shift.id,
    empresaId: shift.empresaId,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName || '',
    positionName: shift.positionName || '',
    message: eventGap
      ? `Hueco de evento sin candidatos (${shift.code || 'EV'}) en ${shift.objectiveName || 'objetivo'} (${createdBy}).`
      : `Sin candidatos para turno ${shift.code || ''} en ${shift.objectiveName || 'objetivo'} (${createdBy}).`,
    attemptRetention: !(eventGap && !eventoTieneFranjasEncadenadas(titularData)),
    source: 'INICIAR_CASCADA',
  });
}

// ─── MODO DEMO: simular respuestas de guardias a convocatorias ────────────────

export async function simularRespuestasConvocatorias(
  db: admin.firestore.Firestore,
  empresaId: string,
  opCache: ObjectiveOperationCache = new ObjectiveOperationCache(),
): Promise<number> {
  const THINK_TIME_MS = 90 * 1000; // guardia "piensa" 90 s antes de responder
  const now = Timestamp.now();
  const cutoffMs = now.toMillis() - THINK_TIME_MS;

  const snap = await db.collection('convocatorias_cobertura')
    .where('empresaId', '==', empresaId)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(50)
    .get();

  let respondidas = 0;
  for (const convDoc of snap.docs) {
    const conv = convDoc.data() as ConvocatoriaCoberturaDoc;
    const createdMs = conv.createdAt instanceof Timestamp ? conv.createdAt.toMillis() : 0;
    if (createdMs > cutoffMs) continue; // aún en el tiempo de "pensado"

    // Mismo filtro que el resto del Demo: no se simula nada sobre licencias, francos ni trazas EXT/ADV.
    const titularData = conv.shiftId
      ? (await db.collection('turnos').doc(conv.shiftId).get()).data()
      : null;
    const skipSim = await simulableShiftSkipReasonResolved(
      db,
      titularData as Record<string, unknown> | null,
      opCache,
    );
    if (skipSim) {
      console.log(`[simularRespuestasConvocatorias] skip ${convDoc.id}: titular ${conv.shiftId} ${skipSim}`);
      continue;
    }

    // Determinístico por id: chars % 10 → 0-7 acepta (80%), 8-9 rechaza (20%)
    const hashVal = convDoc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
    const accept = hashVal <= 7;

    try {
      if (accept) {
        await convDoc.ref.update({ status: 'ACCEPTED', respondedAt: now, respondedBy: 'MODO_DEMO', responseChannel: 'DEMO' });
        await logConvocatoriaEvento(db, convDoc.id, { type: 'RESPUESTA', response: 'ACCEPTED', channel: 'DEMO', at: now });
        await resolverCobertura(db, { ...conv, id: convDoc.id });
      } else {
        await convDoc.ref.update({ status: 'REJECTED', respondedAt: now, rejectionReason: 'MODO_DEMO_AUTO', respondedBy: 'MODO_DEMO', responseChannel: 'DEMO' });
        await logConvocatoriaEvento(db, convDoc.id, { type: 'RESPUESTA', response: 'REJECTED', channel: 'DEMO', reason: 'MODO_DEMO_AUTO', at: now });
        await avanzarCascadaOrPartialVacante(db, { ...conv, id: convDoc.id }, 'REJECTED');
      }
      respondidas++;
    } catch (e) {
      console.warn('[simularRespuestasConvocatorias]', convDoc.id, (e as Error)?.message);
    }
  }
  return respondidas;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER: checkConvocatoriaTimeouts
// Cada 5 min: detecta convocatorias PENDING vencidas y avanza la cascada.
// ═══════════════════════════════════════════════════════════════════════════════

export const checkConvocatoriaTimeouts = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const db = admin.firestore();
    const now = Timestamp.now();

    // Convocatorias de eventuales a eventos (`solicitudes_evento` con `venceAt`): vencen con el mismo plazo.
    try {
      const { vencerConvocatoriasEventualesEvento } = await import('../eventuales/planificacionEventuales');
      const vencidas = await vencerConvocatoriasEventualesEvento(now);
      if (vencidas) console.log(`[checkConvocatoriaTimeouts] ${vencidas} convocatoria/s de eventual a evento vencida/s`);
    } catch (e) {
      console.error('[checkConvocatoriaTimeouts] eventos eventuales:', (e as Error).message);
    }

    try {
      const { vencerConsultasDisponibilidad } = await import('../eventuales/consultaDisponibilidad');
      const consultas = await vencerConsultasDisponibilidad(now);
      if (consultas) console.log(`[checkConvocatoriaTimeouts] ${consultas} consulta/s de disponibilidad vencida/s`);
    } catch (e) {
      console.error('[checkConvocatoriaTimeouts] consultas disponibilidad:', (e as Error).message);
    }

    try {
      const { vencerAnulacionesPendientes } = await import('../eventuales/eventualNoSePresento');
      const pasadas = await vencerAnulacionesPendientes(db, Date.now());
      if (pasadas) console.log(`[checkConvocatoriaTimeouts] ${pasadas} anulación/es de alta pasada/s a baja`);
    } catch (e) {
      console.error('[checkConvocatoriaTimeouts] anulación de alta:', (e as Error).message);
    }

    const timedOut = await db.collection('convocatorias_cobertura')
      .where('status', '==', 'PENDING')
      .where('timeoutAt', '<=', now)
      .limit(50)
      .get();

    if (timedOut.empty) return;

    for (const d of timedOut.docs) {
      const conv = d.data() as ConvocatoriaCoberturaDoc;
      try {
        if (conv.type === 'LLEGADA_TARDE') {
          await d.ref.update({ status: 'TIMEOUT', escalatedAt: now });
          await logConvocatoriaEvento(db, d.id, { type: 'RESPUESTA', response: 'TIMEOUT', channel: 'TIMEOUT', at: now });
          const sh = (await db.collection('turnos').doc(conv.shiftId).get()).data();
          // Ya fichó o avisó demora: la ventana la resuelve detectarAusencias (ETA / T+30), no este timeout.
          const alreadyHandled = !!(sh?.isPresent || sh?.isCompleted || sh?.lateArrivalAt || sh?.lateArrivalConfirmed);
          // Sin respuesta al ¿Venís? no es ausencia todavía: el AA sin aviso es a T+30 (detectarAusencias BLOQUE 2).
          const startMs = (sh?.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
          const pastNoNoticeDeadline = startMs > 0 && now.toMillis() >= startMs + 30 * 60 * 1000;
          if (!alreadyHandled && pastNoNoticeDeadline && !skipAbsencePipelineForShift(sh as Record<string, unknown>)) {
            await markShiftAbsent(db, conv.shiftId, {
              reason: 'LLEGADA_TARDE_TIMEOUT',
              by: 'SYSTEM_SCHEDULER',
            });
          }
          console.log(`[checkConvocatoriaTimeouts] LLEGADA_TARDE timeout ${conv.shiftId}`);
        } else {
          // Cascada regular: ESCALATED sigue activa, avanzar al siguiente paso
          await d.ref.update({ status: 'ESCALATED', escalatedAt: now });
          await logConvocatoriaEvento(db, d.id, { type: 'RESPUESTA', response: 'TIMEOUT', channel: 'TIMEOUT', at: now });
          await avanzarCascadaOrPartialVacante(db, { ...conv, id: d.id }, 'TIMEOUT');
        }
      } catch (e) {
        console.error(`[checkConvocatoriaTimeouts] Error en ${d.id}:`, (e as Error).message);
      }
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER EXPORTADO: crearConvocatoriaLlegadaTarde
// Pregunta al guardia tardío si viene antes de marcarlo ausente.
// Lo llama detectarAusencias BLOQUE 1 cuando detecta T+0 sin check-in.
// ═══════════════════════════════════════════════════════════════════════════════

export async function crearConvocatoriaLlegadaTarde(
  db: admin.firestore.Firestore,
  shift: {
    id: string;
    empresaId: string;
    objectiveId: string;
    objectiveName: string;
    positionName?: string;
    clientId: string;
    clientName?: string;
    shiftCode: string;
    startTime: Timestamp;
    endTime?: Timestamp;
    employeeId: string;
    employeeName: string;
    employeeUid?: string;
  },
  opts?: {
    /** Texto del push (el aviso manual del CC: «Te esperan en …, ¿venís?»). */
    body?: string;
    /** `AUTO` (cron) o uid del operador que lo manda a mano. */
    createdBy?: string;
    /** Si ya hay una LLEGADA_TARDE pendiente, vuelve a mandar el push en vez de no hacer nada. */
    resendIfPending?: boolean;
  },
): Promise<{ convocatoriaId: string; resent: boolean } | null> {
  // Idempotencia: no crear segunda convocatoria LLEGADA_TARDE para el mismo turno
  const existing = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('type', '==', 'LLEGADA_TARDE')
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(1)
    .get();
  if (!existing.empty) {
    if (!opts?.resendIfPending) return null;
    const prev = existing.docs[0];
    const prevData = prev.data() as ConvocatoriaCoberturaDoc;
    await crearNotifConvocatoria(db, { ...prevData, id: prev.id }, { body: opts.body });
    await logConvocatoriaEvento(db, prev.id, {
      type: 'PUSH',
      at: Timestamp.now(),
      origin: 'CC',
      createdBy: opts.createdBy || 'AUTO',
      reason: 'AVISO_MANUAL_CC',
    }).catch(() => {});
    return { convocatoriaId: prev.id, resent: true };
  }

  const now = Timestamp.now();
  const timeoutAt = Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);

  const convRef = db.collection('convocatorias_cobertura').doc();
  const convData: ConvocatoriaCoberturaDoc = {
    empresaId: shift.empresaId,
    shiftId: shift.id,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName,
    positionName: shift.positionName || '',
    clientId: shift.clientId,
    clientName: shift.clientName || '',
    shiftCode: shift.shiftCode,
    startTime: shift.startTime,
    endTime: shift.endTime,
    type: 'LLEGADA_TARDE',
    urgency: getUrgency(shift.startTime),
    cascadeStep: -1,
    candidateEmployeeId: shift.employeeId,
    candidateEmployeeName: shift.employeeName,
    candidateUid: shift.employeeUid,
    aptitudesRequeridas: [],
    status: 'PENDING',
    timeoutAt,
    createdAt: now,
    createdBy: opts?.createdBy || 'AUTO',
  };

  await convRef.set(convData);
  await crearNotifConvocatoria(db, { ...convData, id: convRef.id }, { body: opts?.body });
  console.log(`[crearConvocatoriaLlegadaTarde] Enviada a ${shift.employeeName} para turno ${shift.id}`);
  return { convocatoriaId: convRef.id, resent: false };
}

export const responderRecordatorioConvocado = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticación.');
  const payload = (data || {}) as {
    convocatoriaId?: string;
    action?: 'ON_WAY' | 'PROBLEM';
    etaMinutes?: number;
    note?: string;
  };
  if (!payload.convocatoriaId || (payload.action !== 'ON_WAY' && payload.action !== 'PROBLEM')) {
    throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId y action (ON_WAY|PROBLEM) son obligatorios.');
  }
  const { responderRecordatorioConvocadoShift } = await import('./convocadoAcceptEta');
  const out = await responderRecordatorioConvocadoShift(admin.firestore(), {
    convocatoriaId: payload.convocatoriaId,
    action: payload.action,
    etaMinutes: payload.etaMinutes,
    note: payload.note,
    operatorUid: context.auth.uid,
  });
  if (!out.success) throw new functions.https.HttpsError('failed-precondition', out.reason || 'No se pudo responder.');
  return { ok: true };
});
