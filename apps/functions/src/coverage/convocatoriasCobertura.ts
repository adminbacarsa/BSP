import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  checkEligibility,
  CandidateType,
  CascadeStepType,
  CASCADE_ORDER,
  BROADCAST_LIMIT,
  nextCascadeStep,
  toCascadeStep,
  cascadeStepIndex,
  getUrgency,
  findEmployeeUid,
} from './eligibilityFilter';
import {
  applyCoverageLedgerToBatch,
  covererLedgerFields,
  newCoverageEventId,
  resolveTitularFromAbsenceOrVacancy,
} from './coverageLedger';
import { assertCoverageOpsCallable } from './coverage-auth.util';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ConvocatoriaType = CandidateType | 'LLEGADA_TARDE';

export interface ConvocatoriaCoberturaDoc {
  empresaId: string;
  shiftId: string;
  objectiveId: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  shiftCode?: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  aptitudesRequeridas?: string[];

  type: ConvocatoriaType;
  /** Paso de la escalera CCT (alineado a protocolo manual). */
  cascadeStepKey?: CascadeStepType;
  urgency: 'URGENTE' | 'INTERMEDIO' | 'NORMAL';
  cascadeStep: number;

  candidateEmployeeId: string;
  candidateEmployeeName: string;
  candidateUid?: string;

  extendShiftId?: string;
  advanceShiftId?: string;
  ftShiftId?: string;
  /** Turno origen RET / ESC / REF a redirigir. */
  sourceShiftId?: string;

  status: 'PENDING' | 'ESCALATED' | 'ACCEPTED' | 'REJECTED' | 'TIMEOUT' | 'CANCELLED';
  timeoutAt: Timestamp;

  createdAt: Timestamp;
  createdBy: string;
  createdByName?: string;
  respondedAt?: Timestamp;
  rejectionReason?: string;
  resolvedAt?: Timestamp;
}

/** Timeout por paso antes de escalar (sigue aceptando en ESCALATED). */
const TIMEOUT_MINUTES = 3;

const TYPE_LABEL: Record<string, string> = {
  RET: 'Retención (RET)',
  ESC: 'Escuela / Refuerzo',
  VOLANTE: 'Cobertura volante',
  SIN_TURNO_CON_EXP: 'Cobertura disponible',
  EXTEND: 'Extensión de jornada',
  ADVANCE: 'Adelanto de turno',
  SIN_TURNO: 'Cobertura disponible',
  FT: 'Franco Trabajado (FT)',
  LLEGADA_TARDE: '¿Estás en camino?',
};

// ─── Notificación ─────────────────────────────────────────────────────────────

async function crearNotifConvocatoria(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
) {
  const urgencyLabel =
    conv.urgency === 'URGENTE' ? '⚡ URGENTE' : conv.urgency === 'INTERMEDIO' ? 'Intermedia' : 'Normal';

  const startDate =
    conv.startTime instanceof Timestamp
      ? conv.startTime.toDate().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
      : '--:--';

  const isLlegadaTarde = conv.type === 'LLEGADA_TARDE';
  const title = isLlegadaTarde ? '⏰ ¿Estás en camino?' : `[${urgencyLabel}] Cobertura requerida`;
  const body = isLlegadaTarde
    ? `Tu turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'el puesto'} comenzó a las ${startDate}. Confirmá si estás en camino en los próximos ${TIMEOUT_MINUTES} min.`
    : `${TYPE_LABEL[conv.type] || conv.type} en ${conv.objectiveName || 'el puesto'} — turno ${conv.shiftCode || ''} ${startDate}. Respondé en los próximos ${TIMEOUT_MINUTES} min.`;

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
    read: false,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── Crear convocatoria ───────────────────────────────────────────────────────

async function crearConvocatoriaDoc(
  db: admin.firestore.Firestore,
  data: Omit<ConvocatoriaCoberturaDoc, 'createdAt' | 'status' | 'timeoutAt' | 'urgency'> & {
    createdBy: string;
    createdByName?: string;
  },
): Promise<string> {
  const now = Timestamp.now();
  const timeoutAt = Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);
  const urgency = getUrgency(data.startTime);
  const cascadeStepKey = data.cascadeStepKey || toCascadeStep(data.type) || undefined;

  const docData: ConvocatoriaCoberturaDoc = {
    ...data,
    cascadeStepKey: cascadeStepKey as CascadeStepType | undefined,
    cascadeStep: cascadeStepKey ? CASCADE_ORDER.indexOf(cascadeStepKey) : cascadeStepIndex(data.type),
    urgency,
    status: 'PENDING',
    timeoutAt,
    createdAt: now,
  };

  const ref = await db.collection('convocatorias_cobertura').add(docData);
  await crearNotifConvocatoria(db, { ...docData, id: ref.id });

  await db.collection('novedades').add({
    type: 'CONVOCATORIA_ENVIADA',
    convocatoriaId: ref.id,
    shiftId: data.shiftId,
    objectiveId: data.objectiveId,
    objectiveName: data.objectiveName || '',
    clientId: data.clientId || null,
    empresaId: data.empresaId,
    title: 'Convocatoria enviada',
    message: `${TYPE_LABEL[data.type] || data.type} → ${data.candidateEmployeeName} — turno ${data.shiftCode || ''} en ${data.objectiveName || 'objetivo'}`,
    coverageType: data.type,
    cascadeStepKey: cascadeStepKey || null,
    candidateEmployeeId: data.candidateEmployeeId,
    candidateEmployeeName: data.candidateEmployeeName,
    status: 'unread',
    resolved: false,
    createdAt: now,
  });

  return ref.id;
}

// ─── Candidatos ───────────────────────────────────────────────────────────────

interface CandidateResult {
  id: string;
  name: string;
  uid?: string;
  convocatoriaType: CandidateType;
  extendShiftId?: string;
  advanceShiftId?: string;
  ftShiftId?: string;
  sourceShiftId?: string;
}

async function loadAlreadyConvocadoIds(
  db: admin.firestore.Firestore,
  empresaId: string,
  shiftId: string,
): Promise<Set<string>> {
  const activeConvSnap = await db.collection('convocatorias_cobertura')
    .where('empresaId', '==', empresaId)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .get();
  const ids = new Set<string>();
  for (const d of activeConvSnap.docs) {
    const c = d.data();
    if (c.shiftId !== shiftId && c.candidateEmployeeId) {
      ids.add(String(c.candidateEmployeeId));
    }
  }
  return ids;
}

async function findCandidatesForConvType(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc,
  type: CandidateType,
  limit = BROADCAST_LIMIT,
): Promise<CandidateResult[]> {
  const ctx = {
    objectiveId: conv.objectiveId,
    clientId: conv.clientId,
    aptitudesRequeridas: conv.aptitudesRequeridas || [],
  };
  const out: CandidateResult[] = [];

  if (type === 'EXTEND') {
    const active = await db.collection('turnos')
      .where('objectiveId', '==', conv.objectiveId)
      .where('empresaId', '==', conv.empresaId)
      .where('isPresent', '==', true)
      .where('isCompleted', '==', false)
      .limit(20)
      .get();

    for (const d of active.docs) {
      if (out.length >= limit) break;
      const t = d.data();
      if (d.id === conv.shiftId) continue;
      const code = String(t.code || '').toUpperCase();
      if (code !== 'M' && code !== 'T' && code !== 'N') continue;
      const empSnap = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      if (!checkEligibility(emp, ctx, 'EXTEND').eligible) continue;
      out.push({
        id: t.employeeId,
        name: t.employeeName || '',
        uid: emp.uid,
        convocatoriaType: 'EXTEND',
        extendShiftId: d.id,
      });
    }
    return out;
  }

  if (type === 'ADVANCE') {
    const now = Timestamp.now();
    const windowEnd = Timestamp.fromMillis(now.toMillis() + 12 * 3600 * 1000);
    const next = await db.collection('turnos')
      .where('objectiveId', '==', conv.objectiveId)
      .where('empresaId', '==', conv.empresaId)
      .where('startTime', '>', now)
      .where('startTime', '<=', windowEnd)
      .where('isCompleted', '==', false)
      .orderBy('startTime')
      .limit(20)
      .get();

    for (const d of next.docs) {
      if (out.length >= limit) break;
      const t = d.data();
      if (!t.employeeId || t.employeeId === 'VACANTE' || d.id === conv.shiftId) continue;
      if (t.isPresent || t.isAbsent || t.isUnassigned || t.isFranco) continue;
      const empSnap = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      if (!checkEligibility(emp, ctx, 'ADVANCE').eligible) continue;
      out.push({
        id: t.employeeId,
        name: t.employeeName || '',
        uid: emp.uid,
        convocatoriaType: 'ADVANCE',
        advanceShiftId: d.id,
      });
    }
    return out;
  }

  const empSnap = await db.collection('empleados')
    .where('empresaId', '==', conv.empresaId)
    .where('status', 'in', ['ACTIVE', 'active', 'activo', 'ACTIVO'])
    .limit(200)
    .get();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 0);

  const allTodaySnap = await db.collection('turnos')
    .where('empresaId', '==', conv.empresaId)
    .where('startTime', '>=', Timestamp.fromDate(todayStart))
    .where('startTime', '<=', Timestamp.fromDate(todayEnd))
    .limit(500)
    .get();

  const busyEmpIds = new Set<string>();
  const francoShiftByEmp = new Map<string, string>();
  const retShiftByEmp = new Map<string, string>();
  const escShiftByEmp = new Map<string, string>();

  for (const d of allTodaySnap.docs) {
    const t = d.data();
    if (!t.employeeId || t.employeeId === 'VACANTE') continue;
    const code = String(t.code || '').toUpperCase();
    if (['F', 'FF', 'FP'].includes(code)) {
      francoShiftByEmp.set(t.employeeId, d.id);
    } else if (code === 'RET' && t.objectiveId === conv.objectiveId) {
      retShiftByEmp.set(t.employeeId, d.id);
    } else if ((code === 'ESC' || code === 'REF') && t.objectiveId === conv.objectiveId) {
      escShiftByEmp.set(t.employeeId, d.id);
    } else if (code !== 'FT') {
      busyEmpIds.add(t.employeeId);
    }
  }

  const alreadyConvocadoIds = await loadAlreadyConvocadoIds(db, conv.empresaId, conv.shiftId);

  for (const empDoc of empSnap.docs) {
    if (out.length >= limit) break;
    const emp = empDoc.data();
    const empId = empDoc.id;
    const name = `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId;

    if (type === 'RET') {
      if (!retShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      if (!checkEligibility(emp, ctx, 'RET').eligible) continue;
      const uid = await findEmployeeUid(db, empId, emp);
      out.push({
        id: empId,
        name,
        uid: uid || undefined,
        convocatoriaType: 'RET',
        sourceShiftId: retShiftByEmp.get(empId),
      });
      continue;
    }

    if (type === 'ESC') {
      if (!escShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      if (!checkEligibility(emp, ctx, 'ESC').eligible) continue;
      const uid = await findEmployeeUid(db, empId, emp);
      out.push({
        id: empId,
        name,
        uid: uid || undefined,
        convocatoriaType: 'ESC',
        sourceShiftId: escShiftByEmp.get(empId),
      });
      continue;
    }

    if (type === 'FT') {
      if (!francoShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      if (!checkEligibility(emp, ctx, 'FT').eligible) continue;
      const uid = await findEmployeeUid(db, empId, emp);
      out.push({
        id: empId,
        name,
        uid: uid || undefined,
        convocatoriaType: 'FT',
        ftShiftId: francoShiftByEmp.get(empId),
      });
      continue;
    }

    // SIN_TURNO pool (incluye volante / con exp)
    if (type === 'SIN_TURNO' || type === 'VOLANTE' || type === 'SIN_TURNO_CON_EXP') {
      if (busyEmpIds.has(empId) || francoShiftByEmp.has(empId) || retShiftByEmp.has(empId) || escShiftByEmp.has(empId)) continue;
      if (alreadyConvocadoIds.has(empId)) continue;

      const isVolante = (emp.volante || []).includes(conv.objectiveId);
      const isTitular = emp.preferredObjectiveId === conv.objectiveId;
      const hasExp = !!(emp.experienciaObjetivos || {})[conv.objectiveId];
      let derived: CandidateType = 'SIN_TURNO';
      if (isVolante) derived = 'VOLANTE';
      else if (isTitular || hasExp) derived = 'SIN_TURNO_CON_EXP';

      if (type === 'VOLANTE' && derived !== 'VOLANTE') continue;
      if (type === 'SIN_TURNO_CON_EXP' && derived !== 'SIN_TURNO_CON_EXP') continue;

      if (!checkEligibility(emp, ctx, derived).eligible) continue;
      const uid = await findEmployeeUid(db, empId, emp);
      out.push({
        id: empId,
        name,
        uid: uid || undefined,
        convocatoriaType: derived,
      });
    }
  }

  return out;
}

async function findCandidatesForStep(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc,
  step: CascadeStepType,
): Promise<CandidateResult[]> {
  if (step === 'EXT_DUAL') {
    const [exts, advs] = await Promise.all([
      findCandidatesForConvType(db, conv, 'EXTEND', BROADCAST_LIMIT),
      findCandidatesForConvType(db, conv, 'ADVANCE', BROADCAST_LIMIT),
    ]);
    return [...exts, ...advs];
  }
  if (step === 'SIN_TURNO') {
    return findCandidatesForConvType(db, conv, 'SIN_TURNO', BROADCAST_LIMIT);
  }
  if (step === 'RET') return findCandidatesForConvType(db, conv, 'RET', BROADCAST_LIMIT);
  if (step === 'ESC') return findCandidatesForConvType(db, conv, 'ESC', BROADCAST_LIMIT);
  if (step === 'FT') return findCandidatesForConvType(db, conv, 'FT', BROADCAST_LIMIT);
  return [];
}

/** Dispara notificaciones en paralelo para un paso. Devuelve true si envió ≥1. */
async function dispararPasoCascada(
  db: admin.firestore.Firestore,
  baseConv: ConvocatoriaCoberturaDoc,
  step: CascadeStepType,
  createdBy: string,
): Promise<boolean> {
  const candidates = await findCandidatesForStep(db, baseConv, step);
  if (candidates.length === 0) return false;

  await Promise.all(
    candidates.map((c) =>
      crearConvocatoriaDoc(db, {
        ...baseConv,
        type: c.convocatoriaType,
        cascadeStepKey: step,
        cascadeStep: CASCADE_ORDER.indexOf(step),
        candidateEmployeeId: c.id,
        candidateEmployeeName: c.name,
        candidateUid: c.uid,
        ...(c.extendShiftId ? { extendShiftId: c.extendShiftId } : {}),
        ...(c.advanceShiftId ? { advanceShiftId: c.advanceShiftId } : {}),
        ...(c.ftShiftId ? { ftShiftId: c.ftShiftId } : {}),
        ...(c.sourceShiftId ? { sourceShiftId: c.sourceShiftId } : {}),
        createdBy,
      }),
    ),
  );

  await db.collection('novedades').add({
    type: 'CONVOCATORIA_PASO_ENVIADO',
    shiftId: baseConv.shiftId,
    objectiveId: baseConv.objectiveId,
    objectiveName: baseConv.objectiveName || '',
    empresaId: baseConv.empresaId,
    title: `Protocolo auto — paso ${step}`,
    message: `${candidates.length} convocatoria(s) en paralelo (${step}) — gana el primero que acepte.`,
    cascadeStepKey: step,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return true;
}

// ─── Avanzar cascada (solo si no quedan PENDING del mismo turno) ──────────────

async function maybeAvanzarCascada(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
  reason: 'REJECTED' | 'TIMEOUT',
): Promise<void> {
  if (conv.type === 'LLEGADA_TARDE') return;

  const pendingSnap = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', conv.shiftId)
    .where('status', '==', 'PENDING')
    .limit(1)
    .get();
  if (!pendingSnap.empty) return;

  const vacantSnap = await db.collection('turnos').doc(conv.shiftId).get();
  const vacant = vacantSnap.exists ? vacantSnap.data()! : {};
  if (String(vacant.status || '') === 'COVERED') return;

  const step = (conv.cascadeStepKey || toCascadeStep(conv.type)) as CascadeStepType | null;
  if (!step) return;

  // Ext dual ya completo (ambas mitades)
  if (step === 'EXT_DUAL') {
    if (vacant.coverageDualExtBy && vacant.coverageDualAdvBy) return;
  }

  const next = nextCascadeStep(step);
  if (!next) {
    await db.collection('novedades').add({
      type: 'VACANTE_SIN_COBERTURA',
      shiftId: conv.shiftId,
      objectiveId: conv.objectiveId,
      objectiveName: conv.objectiveName || '',
      empresaId: conv.empresaId,
      message: `Cascada de cobertura agotada para turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}. Sin candidatos disponibles.`,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  // Idempotencia: no re-disparar si ya hay PENDING del siguiente paso
  const nextIdx = CASCADE_ORDER.indexOf(next);
  const alreadyNext = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', conv.shiftId)
    .where('status', '==', 'PENDING')
    .limit(5)
    .get();
  if (alreadyNext.docs.some((d) => Number(d.data().cascadeStep) >= nextIdx)) return;

  let candidatePhone: string | null = null;
  if (conv.candidateEmployeeId) {
    const empSnap = await db.collection('empleados').doc(conv.candidateEmployeeId).get();
    if (empSnap.exists) candidatePhone = empSnap.data()?.telefono || null;
  }

  await db.collection('novedades').add({
    type: 'CONVOCATORIA_ESCALADA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    clientId: conv.clientId || null,
    empresaId: conv.empresaId,
    title: reason === 'REJECTED' ? 'Convocatoria rechazada' : 'Sin respuesta — escalando',
    message: `Paso ${step} agotado (${reason}) — escalando a ${next} en ${conv.objectiveName || 'objetivo'}`,
    coverageType: conv.type,
    nextCoverageType: next,
    cascadeStepKey: step,
    candidateEmployeeId: conv.candidateEmployeeId,
    candidateEmployeeName: conv.candidateEmployeeName,
    candidatePhone,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  const base: ConvocatoriaCoberturaDoc = {
    ...conv,
    candidateEmployeeId: '',
    candidateEmployeeName: '',
    candidateUid: undefined,
    extendShiftId: undefined,
    advanceShiftId: undefined,
    ftShiftId: undefined,
    sourceShiftId: undefined,
  };

  // Saltar pasos vacíos hasta encontrar candidatos
  let cursor: CascadeStepType | null = next;
  while (cursor) {
    const sent = await dispararPasoCascada(db, base, cursor, 'AUTO');
    if (sent) return;
    cursor = nextCascadeStep(cursor);
  }

  await db.collection('novedades').add({
    type: 'VACANTE_SIN_COBERTURA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    empresaId: conv.empresaId,
    message: `Cascada agotada (sin candidatos posteriores) para ${conv.objectiveName || 'objetivo'}.`,
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── Resolver cobertura ───────────────────────────────────────────────────────

async function cancelSiblingConvocatorias(
  batch: admin.firestore.WriteBatch,
  db: admin.firestore.Firestore,
  shiftId: string,
  exceptId: string,
  onlyTypes?: ConvocatoriaType[],
): Promise<void> {
  const [pendingSnap, escalatedSnap] = await Promise.all([
    db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).where('status', '==', 'PENDING').get(),
    db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).where('status', '==', 'ESCALATED').get(),
  ]);
  for (const d of [...pendingSnap.docs, ...escalatedSnap.docs]) {
    if (d.id === exceptId) continue;
    if (onlyTypes && !onlyTypes.includes(d.data().type)) continue;
    batch.update(d.ref, { status: 'CANCELLED', cancelledAt: FieldValue.serverTimestamp() });
  }
}

async function resolverCobertura(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
): Promise<void> {
  const batch = db.batch();

  const resolvedBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO'
    : conv.createdBy === 'AUTO' ? 'AUTO'
      : 'OPERACIONES';

  const vacantSnap = await db.collection('turnos').doc(conv.shiftId).get();
  const vacantData = vacantSnap.exists ? { id: vacantSnap.id, ...vacantSnap.data() } : { id: conv.shiftId };
  const titular = resolveTitularFromAbsenceOrVacancy(vacantData);
  const coverageEventId = (vacantData as any).coverageEventId || newCoverageEventId();
  const ledgerBase = {
    covererEmployeeId: conv.candidateEmployeeId,
    covererEmployeeName: conv.candidateEmployeeName,
    titularEmployeeId: titular.titularEmployeeId,
    titularEmployeeName: titular.titularEmployeeName,
    titularShiftId: titular.titularShiftId,
    titularIsAbsence: true,
    resolvedBy,
    coverageEventId,
    vacancyExtra: { coverageConvocatoriaId: conv.id, coverageResolvedAt: FieldValue.serverTimestamp() },
    covererExtra: { coverageConvocatoriaId: conv.id, assignedByConvocatoria: conv.id },
  };

  const vacantRef = db.collection('turnos').doc(conv.shiftId);

  if (conv.type === 'EXTEND' && conv.extendShiftId) {
    const shiftRef = db.collection('turnos').doc(conv.extendShiftId);
    const newCode = String(conv.shiftCode || 'M').toUpperCase().startsWith('N') ? 'N12' : 'D12';
    batch.update(shiftRef, {
      code: newCode,
      isExtended: true,
      isRetention: true,
      extendedBy: 'CONVOCATORIA',
      extendedAt: FieldValue.serverTimestamp(),
      resolvedBy,
      ...covererLedgerFields({
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        coverageType: 'EXTEND',
      }),
    });
    const advDone = !!(vacantData as any).coverageDualAdvBy;
    batch.update(vacantRef, {
      coverageDualExtBy: conv.candidateEmployeeId,
      coverageDualExtName: conv.candidateEmployeeName,
      coverageDualExtShiftId: conv.extendShiftId,
      coverageEventId,
      ...(advDone
        ? {
          status: 'COVERED',
          resolvedBy,
          coverageType: 'RETENCION',
          coveredAt: FieldValue.serverTimestamp(),
          coveredByEmployeeName: `${conv.candidateEmployeeName} ext + ${(vacantData as any).coverageDualAdvName || ''} adel`,
        }
        : {}),
    });
    if (advDone) {
      applyCoverageLedgerToBatch(batch, db, {
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        covererShiftId: conv.extendShiftId,
        coverageType: 'RETENCION',
        markVacancyCovered: true,
      });
      await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
    } else {
      await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id, ['EXTEND']);
    }
  } else if (conv.type === 'ADVANCE' && conv.advanceShiftId) {
    const nextRef = db.collection('turnos').doc(conv.advanceShiftId);
    batch.update(nextRef, {
      startTime: conv.startTime,
      adjustedStartTime: conv.startTime,
      isAdvanced: true,
      isEarlyStart: true,
      advancedBy: 'CONVOCATORIA',
      advancedAt: FieldValue.serverTimestamp(),
      resolvedBy,
      ...covererLedgerFields({
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        coverageType: 'ADVANCE',
      }),
    });
    const extDone = !!(vacantData as any).coverageDualExtBy;
    batch.update(vacantRef, {
      coverageDualAdvBy: conv.candidateEmployeeId,
      coverageDualAdvName: conv.candidateEmployeeName,
      coverageDualAdvShiftId: conv.advanceShiftId,
      coverageEventId,
      ...(extDone
        ? {
          status: 'COVERED',
          resolvedBy,
          coverageType: 'RETENCION',
          coveredAt: FieldValue.serverTimestamp(),
          coveredByEmployeeName: `${(vacantData as any).coverageDualExtName || ''} ext + ${conv.candidateEmployeeName} adel`,
        }
        : {}),
    });
    if (extDone) {
      applyCoverageLedgerToBatch(batch, db, {
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        covererShiftId: conv.advanceShiftId,
        coverageType: 'RETENCION',
        markVacancyCovered: true,
      });
      await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
    } else {
      await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id, ['ADVANCE']);
    }
  } else if (conv.type === 'RET' || conv.type === 'ESC') {
    const sourceId = conv.sourceShiftId;
    if (sourceId) {
      batch.update(db.collection('turnos').doc(sourceId), {
        coverageRedirectedTo: conv.objectiveId,
        coverageRedirectedAt: FieldValue.serverTimestamp(),
        resolvedBy,
      });
    }
    applyCoverageLedgerToBatch(batch, db, {
      ...ledgerBase,
      vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
      covererShiftId: sourceId || null,
      coverageType: conv.type,
      markVacancyCovered: true,
    });
    await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
  } else if (conv.type === 'FT') {
    if (conv.ftShiftId) {
      const ftRef = db.collection('turnos').doc(conv.ftShiftId);
      batch.update(ftRef, {
        code: 'FT',
        isFranco: false,
        isFrancoTrabajado: true,
        isPresent: true,
        presentAt: conv.startTime,
        realStartTime: conv.startTime,
        realEndTime: conv.endTime || null,
        resolvedBy,
        coveredShiftId: conv.shiftId,
        assignedAt: FieldValue.serverTimestamp(),
      });
      applyCoverageLedgerToBatch(batch, db, {
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        covererShiftId: conv.ftShiftId,
        coverageType: 'FT',
        markVacancyCovered: true,
      });
    }
    await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
  } else {
    // SIN_TURNO / VOLANTE / SIN_TURNO_CON_EXP — nuevo turno operativo (como protocolo manual)
    const newRef = db.collection('turnos').doc();
    batch.set(newRef, {
      empresaId: conv.empresaId,
      employeeId: conv.candidateEmployeeId,
      employeeName: conv.candidateEmployeeName,
      clientId: conv.clientId || null,
      clientName: conv.clientName || null,
      objectiveId: conv.objectiveId,
      objectiveName: conv.objectiveName || '',
      code: String(conv.shiftCode || 'M'),
      startTime: conv.startTime,
      endTime: conv.endTime || null,
      status: 'PENDING',
      origin: 'OPERATIONS_COVERAGE',
      resolvedBy,
      coverageType: conv.type,
      assignedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      ...covererLedgerFields({
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        coverageType: conv.type,
      }),
    });
    applyCoverageLedgerToBatch(batch, db, {
      ...ledgerBase,
      vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
      covererShiftId: newRef.id,
      coverageType: conv.type,
      markVacancyCovered: true,
    });
    await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
  }

  const novedadRef = db.collection('novedades').doc();
  batch.set(novedadRef, {
    type: 'COBERTURA_RESUELTA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    clientId: conv.clientId || null,
    empresaId: conv.empresaId,
    coverageEventId,
    title: 'Cobertura resuelta',
    message: `${TYPE_LABEL[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
    description: `${TYPE_LABEL[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
    coverageType: conv.type,
    candidateEmployeeId: conv.candidateEmployeeId,
    candidateEmployeeName: conv.candidateEmployeeName,
    employeeId: conv.candidateEmployeeId,
    employeeName: conv.candidateEmployeeName,
    coversAbsenceEmployeeName: titular.titularEmployeeName || null,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLES
// ═══════════════════════════════════════════════════════════════════════════════

export const crearConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const db = admin.firestore();

    const {
      shiftId,
      candidateEmployeeId,
      type,
      empresaId,
      advanceShiftId,
      extendShiftId,
      sourceShiftId,
      ftShiftId,
    } = data as {
      shiftId: string;
      candidateEmployeeId: string;
      type: CandidateType;
      empresaId: string;
      advanceShiftId?: string;
      extendShiftId?: string;
      sourceShiftId?: string;
      ftShiftId?: string;
    };

    if (!shiftId || !candidateEmployeeId || !type || !empresaId) {
      throw new functions.https.HttpsError('invalid-argument', 'shiftId, candidateEmployeeId, type y empresaId son requeridos.');
    }

    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    }
    const shift = shiftSnap.data()!;

    await assertCoverageOpsCallable(context, empresaId, shift);

    const empSnap = await db.collection('empleados').doc(candidateEmployeeId).get();
    if (!empSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
    }
    const emp = empSnap.data()!;

    const ctx = {
      objectiveId: String(shift.objectiveId || ''),
      clientId: String(shift.clientId || ''),
      aptitudesRequeridas: [],
    };
    const eligibility = checkEligibility(emp, ctx, type);
    if (!eligibility.eligible) {
      throw new functions.https.HttpsError('failed-precondition', `Candidato no elegible: ${eligibility.reason}`);
    }

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

    const callerSnap = await db.collection('system_users').doc(context.auth!.uid).get();
    const callerName = callerSnap.exists ? String(callerSnap.data()?.displayName || callerSnap.data()?.name || '') : '';
    const stepKey = toCascadeStep(type) || undefined;

    const convId = await crearConvocatoriaDoc(db, {
      empresaId,
      shiftId,
      objectiveId: String(shift.objectiveId || ''),
      objectiveName: String(shift.objectiveName || ''),
      clientId: String(shift.clientId || ''),
      clientName: String(shift.clientName || ''),
      shiftCode: String(shift.code || ''),
      startTime: shift.startTime,
      endTime: shift.endTime,
      aptitudesRequeridas: [],
      type,
      cascadeStepKey: stepKey,
      cascadeStep: stepKey ? CASCADE_ORDER.indexOf(stepKey) : cascadeStepIndex(type),
      candidateEmployeeId,
      candidateEmployeeName: empName,
      candidateUid: uid || undefined,
      ...(advanceShiftId ? { advanceShiftId } : {}),
      ...(extendShiftId ? { extendShiftId } : {}),
      ...(sourceShiftId ? { sourceShiftId } : {}),
      ...(ftShiftId ? { ftShiftId } : {}),
      createdBy: context.auth!.uid,
      createdByName: callerName,
    });

    return { success: true, convocatoriaId: convId };
  });

export const responderConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const { convocatoriaId, response, rejectionReason } = data as {
      convocatoriaId: string;
      response: 'ACCEPTED' | 'REJECTED';
      rejectionReason?: string;
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

    if (conv.status !== 'PENDING' && conv.status !== 'ESCALATED') {
      throw new functions.https.HttpsError('failed-precondition', `La convocatoria ya fue ${conv.status}.`);
    }

    const uid = context.auth.uid;
    const empByUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    const empId = empByUid.empty ? uid : empByUid.docs[0].id;

    if (conv.candidateUid && conv.candidateUid !== uid && conv.candidateEmployeeId !== empId) {
      throw new functions.https.HttpsError('permission-denied', 'No podés responder una convocatoria que no te pertenece.');
    }

    const now = Timestamp.now();

    if (conv.type === 'LLEGADA_TARDE') {
      if (response === 'ACCEPTED') {
        await convRef.update({ status: 'ACCEPTED', respondedAt: now, resolvedAt: now });
        await db.collection('turnos').doc(conv.shiftId).update({
          lateArrivalConfirmed: true,
          lateArrivalConfirmedAt: now,
        });
      } else {
        await convRef.update({ status: 'REJECTED', respondedAt: now, rejectionReason: rejectionReason || null });
        await db.collection('turnos').doc(conv.shiftId).update({
          isAbsent: true,
          status: 'ABSENT',
          absenceType: 'AA',
          absenceDetectedBy: 'LLEGADA_TARDE_RECHAZADA',
        });
      }
      return { success: true };
    }

    if (response === 'ACCEPTED') {
      await convRef.update({
        status: 'ACCEPTED',
        respondedAt: now,
        resolvedAt: now,
      });
      await resolverCobertura(db, { ...conv, id: convocatoriaId });
    } else {
      await convRef.update({
        status: 'REJECTED',
        respondedAt: now,
        rejectionReason: rejectionReason || null,
      });
      await db.collection('novedades').add({
        type: 'CONVOCATORIA_RECHAZADA',
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName || '',
        empresaId: conv.empresaId,
        message: `${conv.candidateEmployeeName} rechazó la convocatoria (${conv.type}).`,
        resolved: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      await maybeAvanzarCascada(db, { ...conv, id: convocatoriaId }, 'REJECTED');
    }

    return { success: true };
  });

export const cancelarConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .https.onCall(async (data, context) => {
    const db = admin.firestore();

    const { convocatoriaId } = data as { convocatoriaId: string };
    if (!convocatoriaId) throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId requerido.');

    const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');

    const convData = snap.data()!;
    await assertCoverageOpsCallable(context, String(convData.empresaId || ''), convData);

    if (convData.status !== 'PENDING') {
      throw new functions.https.HttpsError('failed-precondition', 'Solo se pueden cancelar convocatorias PENDING.');
    }

    await ref.update({
      status: 'CANCELLED',
      cancelledAt: Timestamp.now(),
      cancelledBy: context.auth!.uid,
    });

    return { success: true };
  });

export const getCandidatosCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const db = admin.firestore();

    const { shiftId, empresaId, type } = data as {
      shiftId: string;
      empresaId: string;
      type?: CandidateType;
    };

    if (!shiftId || !empresaId) {
      throw new functions.https.HttpsError('invalid-argument', 'shiftId y empresaId son requeridos.');
    }

    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    const shift = shiftSnap.data()!;

    await assertCoverageOpsCallable(context, empresaId, shift);

    const fakeConv: ConvocatoriaCoberturaDoc = {
      empresaId,
      shiftId,
      objectiveId: String(shift.objectiveId || ''),
      clientId: String(shift.clientId || ''),
      shiftCode: String(shift.code || ''),
      startTime: shift.startTime,
      endTime: shift.endTime,
      type: type || 'SIN_TURNO',
      urgency: 'NORMAL',
      cascadeStep: 0,
      candidateEmployeeId: '',
      candidateEmployeeName: '',
      status: 'PENDING',
      timeoutAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      createdBy: 'OPS',
      aptitudesRequeridas: [],
    };

    const step = type ? toCascadeStep(type) : null;
    const cands = step
      ? await findCandidatesForStep(db, fakeConv, step)
      : (
        await Promise.all(CASCADE_ORDER.map((s) => findCandidatesForStep(db, fakeConv, s)))
      ).flat();

    const results = cands.map((c) => ({
      employeeId: c.id,
      employeeName: c.name,
      candidateType: c.convocatoriaType,
      eligibility: { eligible: true as const },
      extendShiftId: c.extendShiftId,
      advanceShiftId: c.advanceShiftId,
      sourceShiftId: c.sourceShiftId,
      ftShiftId: c.ftShiftId,
    }));

    results.sort((a, b) => cascadeStepIndex(a.candidateType) - cascadeStepIndex(b.candidateType));

    return { candidates: results };
  });

// ─── Iniciar cascada (= protocolo CCT automático) ─────────────────────────────

export interface ShiftDataForCascade {
  id: string;
  objectiveId: string;
  objectiveName?: string;
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
    clientId: String(shift.clientId || ''),
    clientName: String(shift.clientName || ''),
    shiftCode: String(shift.code || ''),
    startTime: shift.startTime,
    endTime: shift.endTime,
    aptitudesRequeridas: [],
    type: 'SIN_TURNO',
    urgency: getUrgency(shift.startTime),
    cascadeStep: 0,
    cascadeStepKey: 'SIN_TURNO',
    candidateEmployeeId: '',
    candidateEmployeeName: '',
    status: 'PENDING',
    timeoutAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    createdBy,
  };

  for (const step of CASCADE_ORDER) {
    const sent = await dispararPasoCascada(db, baseConvData, step, createdBy);
    if (sent) return;
  }

  await db.collection('novedades').add({
    type: 'VACANTE_SIN_COBERTURA',
    shiftId: shift.id,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName || '',
    empresaId: shift.empresaId,
    message: `Sin candidatos para turno ${shift.code || ''} en ${shift.objectiveName || 'objetivo'}.`,
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── MODO DEMO: simular respuestas (no espera al guardia real) ────────────────

export async function simularRespuestasConvocatorias(
  db: admin.firestore.Firestore,
  empresaId: string,
): Promise<number> {
  /** Demo: notifica y “responde” solo — sin esperar al humano. Think-time corto. */
  const THINK_TIME_MS = 15 * 1000;
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
    if (conv.type === 'LLEGADA_TARDE') continue;
    const createdMs = conv.createdAt instanceof Timestamp ? conv.createdAt.toMillis() : 0;
    if (createdMs > cutoffMs) continue;

    // Demo: ~90% acepta para que la cascada avance de prueba
    const hashVal = convDoc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
    const accept = hashVal <= 8;

    try {
      if (accept) {
        await convDoc.ref.update({ status: 'ACCEPTED', respondedAt: now, respondedBy: 'MODO_DEMO' });
        await resolverCobertura(db, { ...conv, id: convDoc.id, createdBy: 'MODO_DEMO' });
      } else {
        await convDoc.ref.update({ status: 'REJECTED', respondedAt: now, rejectionReason: 'MODO_DEMO_AUTO', respondedBy: 'MODO_DEMO' });
        await maybeAvanzarCascada(db, { ...conv, id: convDoc.id }, 'REJECTED');
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
          await db.collection('turnos').doc(conv.shiftId).update({
            isAbsent: true,
            status: 'ABSENT',
            absenceType: 'AA',
            absenceDetectedBy: 'LLEGADA_TARDE_TIMEOUT',
          });
          console.log(`[checkConvocatoriaTimeouts] LLEGADA_TARDE timeout → isAbsent=true en ${conv.shiftId}`);
        } else {
          await d.ref.update({ status: 'ESCALATED', escalatedAt: now });
          await maybeAvanzarCascada(db, { ...conv, id: d.id }, 'TIMEOUT');
        }
      } catch (e) {
        console.error(`[checkConvocatoriaTimeouts] Error en ${d.id}:`, (e as Error).message);
      }
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// LLEGADA_TARDE
// ═══════════════════════════════════════════════════════════════════════════════

export async function crearConvocatoriaLlegadaTarde(
  db: admin.firestore.Firestore,
  shift: {
    id: string;
    empresaId: string;
    objectiveId: string;
    objectiveName: string;
    clientId: string;
    shiftCode: string;
    startTime: Timestamp;
    endTime?: Timestamp;
    employeeId: string;
    employeeName: string;
    employeeUid?: string;
  },
): Promise<void> {
  const existing = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('type', '==', 'LLEGADA_TARDE')
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(1)
    .get();
  if (!existing.empty) return;

  const now = Timestamp.now();
  const timeoutAt = Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);

  const convRef = db.collection('convocatorias_cobertura').doc();
  const convData: ConvocatoriaCoberturaDoc = {
    empresaId: shift.empresaId,
    shiftId: shift.id,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName,
    clientId: shift.clientId,
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
    createdBy: 'AUTO',
  };

  await convRef.set(convData);
  await crearNotifConvocatoria(db, { ...convData, id: convRef.id });
  console.log(`[crearConvocatoriaLlegadaTarde] Enviada a ${shift.employeeName} para turno ${shift.id}`);
}
