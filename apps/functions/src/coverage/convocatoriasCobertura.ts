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
  RET_RADIUS_KM_PRIMARY,
  RET_RADIUS_KM_EXPANDED,
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
import {
  buildReassignPassiveToVacancyFields,
  vacancyCoverageLabel,
} from './shiftContinuity';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function empCoords(emp: Record<string, any>): { lat: number; lng: number } | null {
  const lat = Number(emp.lat ?? emp.location?.lat);
  const lng = Number(emp.lng ?? emp.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function knowledgeScore(emp: Record<string, any>, objectiveId: string): number {
  if (emp.preferredObjectiveId === objectiveId) return 3;
  if ((emp.experienciaObjetivos || {})[objectiveId]) return 2;
  if ((emp.volante || []).includes(objectiveId)) return 1;
  return 0;
}

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
  positionName?: string;
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
  respondedBy?: string;
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
  CROSS_POS: 'Otro puesto (mismo objetivo)',
  EXTEND: 'Extensión de jornada',
  ADVANCE: 'Adelanto de turno',
  INTERCAMBIO: 'Intercambio de banda',
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
    const vacPos = String(conv.positionName || '').trim().toLowerCase();
    const active = await db.collection('turnos')
      .where('objectiveId', '==', conv.objectiveId)
      .where('empresaId', '==', conv.empresaId)
      .where('isPresent', '==', true)
      .where('isCompleted', '==', false)
      .limit(20)
      .get();

    const samePos: CandidateResult[] = [];
    const otherPos: CandidateResult[] = [];
    for (const d of active.docs) {
      const t = d.data();
      if (d.id === conv.shiftId) continue;
      // Ext+Adel: mismo objetivo, cualquier puesto (mismo puesto primero).
      const code = String(t.code || '').toUpperCase();
      if (code !== 'M' && code !== 'T' && code !== 'N') continue;
      const empSnap = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      if (!checkEligibility(emp, ctx, 'EXTEND').eligible) continue;
      const row: CandidateResult = {
        id: t.employeeId,
        name: t.employeeName || '',
        uid: emp.uid,
        convocatoriaType: 'EXTEND',
        extendShiftId: d.id,
      };
      const isSame = vacPos && String(t.positionName || '').trim().toLowerCase() === vacPos;
      (isSame ? samePos : otherPos).push(row);
    }
    for (const c of [...samePos, ...otherPos]) {
      if (out.length >= limit) break;
      out.push(c);
    }
    return out;
  }

  if (type === 'ADVANCE') {
    const vacPos = String(conv.positionName || '').trim().toLowerCase();
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

    const samePos: CandidateResult[] = [];
    const otherPos: CandidateResult[] = [];
    for (const d of next.docs) {
      const t = d.data();
      if (!t.employeeId || t.employeeId === 'VACANTE' || d.id === conv.shiftId) continue;
      if (t.isPresent || t.isAbsent || t.isUnassigned || t.isFranco) continue;
      const empSnap = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      if (!checkEligibility(emp, ctx, 'ADVANCE').eligible) continue;
      const row: CandidateResult = {
        id: t.employeeId,
        name: t.employeeName || '',
        uid: emp.uid,
        convocatoriaType: 'ADVANCE',
        advanceShiftId: d.id,
      };
      const isSame = vacPos && String(t.positionName || '').trim().toLowerCase() === vacPos;
      (isSame ? samePos : otherPos).push(row);
    }
    for (const c of [...samePos, ...otherPos]) {
      if (out.length >= limit) break;
      out.push(c);
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
  /** RET de toda la empresa (radio + conocimiento filtran). */
  const retShiftByEmp = new Map<string, string>();
  const escShiftByEmp = new Map<string, string>();
  /** Turnos posteriores mismo objetivo (intercambio). */
  const posteriorShifts: Array<{ id: string; employeeId: string; employeeName?: string; startMs: number }> = [];
  const vacantStartMs = conv.startTime?.toMillis?.() ?? Date.now();

  for (const d of allTodaySnap.docs) {
    const t = d.data();
    if (!t.employeeId || t.employeeId === 'VACANTE') continue;
    const code = String(t.code || '').toUpperCase();
    if (['F', 'FF', 'FP'].includes(code)) {
      francoShiftByEmp.set(t.employeeId, d.id);
    } else if (code === 'RET') {
      retShiftByEmp.set(t.employeeId, d.id);
    } else if ((code === 'ESC' || code === 'REF') && t.objectiveId === conv.objectiveId) {
      escShiftByEmp.set(t.employeeId, d.id);
    } else if (code !== 'FT') {
      busyEmpIds.add(t.employeeId);
    }
    if (
      t.objectiveId === conv.objectiveId
      && d.id !== conv.shiftId
      && t.employeeId
      && !t.isFranco
      && !t.isAbsent
      && !t.isUnassigned
      && !['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'SUS', 'RET', 'ESC', 'REF'].includes(code)
    ) {
      const startMs = t.startTime?.toMillis?.() ?? 0;
      if (startMs > vacantStartMs + 30 * 60 * 1000) {
        posteriorShifts.push({
          id: d.id,
          employeeId: t.employeeId,
          employeeName: t.employeeName,
          startMs,
        });
      }
    }
  }

  // Coordenadas del objetivo (clients.objetivos) para radio RET
  let objLat: number | null = null;
  let objLng: number | null = null;
  if (conv.clientId && conv.objectiveId) {
    try {
      const clientSnap = await db.collection('clients').doc(conv.clientId).get();
      const objs = clientSnap.data()?.objetivos || [];
      const obj = objs.find((o: any) => o.id === conv.objectiveId || o.objectiveId === conv.objectiveId);
      if (obj) {
        const lat = Number(obj.lat ?? obj.latitude ?? obj.location?.lat);
        const lng = Number(obj.lng ?? obj.longitude ?? obj.location?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          objLat = lat;
          objLng = lng;
        }
      }
    } catch { /* ignore */ }
  }

  const alreadyConvocadoIds = await loadAlreadyConvocadoIds(db, conv.empresaId, conv.shiftId);

  if (type === 'INTERCAMBIO') {
    for (const ps of posteriorShifts) {
      if (out.length >= limit) break;
      if (alreadyConvocadoIds.has(ps.employeeId)) continue;
      const empSnap = await db.collection('empleados').doc(ps.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      if (!checkEligibility(emp, ctx, 'INTERCAMBIO').eligible) continue;
      const uid = await findEmployeeUid(db, ps.employeeId, emp);
      out.push({
        id: ps.employeeId,
        name: ps.employeeName || `${emp.lastName || ''} ${emp.firstName || ''}`.trim(),
        uid: uid || undefined,
        convocatoriaType: 'INTERCAMBIO',
        sourceShiftId: ps.id,
      });
    }
    return out;
  }

  if (type === 'RET') {
    type RetCand = CandidateResult & { score: number; dist: number };
    const pool: RetCand[] = [];
    for (const empDoc of empSnap.docs) {
      const emp = empDoc.data();
      const empId = empDoc.id;
      if (!retShiftByEmp.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      const coords = empCoords(emp);
      let dist = Infinity;
      if (objLat != null && objLng != null && coords) {
        dist = haversineKm(objLat, objLng, coords.lat, coords.lng);
      }
      // Sin geo: no filtrar por distancia (permitir)
      const withinPrimary = !Number.isFinite(dist) || dist <= RET_RADIUS_KM_PRIMARY;
      const withinExpanded = !Number.isFinite(dist) || dist <= RET_RADIUS_KM_EXPANDED;
      if (!withinExpanded) continue;
      const maxKm = withinPrimary ? RET_RADIUS_KM_PRIMARY : RET_RADIUS_KM_EXPANDED;
      if (!checkEligibility(emp, ctx, 'RET', Number.isFinite(dist) ? dist : undefined, maxKm).eligible) continue;
      const uid = await findEmployeeUid(db, empId, emp);
      pool.push({
        id: empId,
        name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId,
        uid: uid || undefined,
        convocatoriaType: 'RET',
        sourceShiftId: retShiftByEmp.get(empId),
        score: knowledgeScore(emp, conv.objectiveId),
        dist: Number.isFinite(dist) ? dist : 999,
      });
    }
    pool.sort((a, b) => b.score - a.score || a.dist - b.dist);
    for (const c of pool.slice(0, limit)) {
      out.push({
        id: c.id,
        name: c.name,
        uid: c.uid,
        convocatoriaType: c.convocatoriaType,
        sourceShiftId: c.sourceShiftId,
      });
    }
    return out;
  }

  // Presente en otro puesto del mismo objetivo → redirección (no EXT).
  if (type === 'CROSS_POS') {
    const vacPos = String(conv.positionName || '').trim().toLowerCase();
    const workCodes = new Set(['M', 'T', 'N', 'D12', 'N12', 'M1', 'T1', 'N1', 'RET', 'ESC', 'REF']);
    const active = await db.collection('turnos')
      .where('objectiveId', '==', conv.objectiveId)
      .where('empresaId', '==', conv.empresaId)
      .where('isPresent', '==', true)
      .where('isCompleted', '==', false)
      .limit(30)
      .get();
    for (const d of active.docs) {
      if (out.length >= limit) break;
      const t = d.data();
      if (d.id === conv.shiftId) continue;
      if (!t.employeeId || t.employeeId === 'VACANTE' || alreadyConvocadoIds.has(t.employeeId)) continue;
      if (t.isAbsent || t.isFranco || t.isUnassigned) continue;
      if (vacPos && String(t.positionName || '').trim().toLowerCase() === vacPos) continue;
      const code = String(t.code || '').toUpperCase();
      if (!workCodes.has(code)) continue;
      const empSnapOne = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnapOne.exists) continue;
      const emp = empSnapOne.data()!;
      const uid = await findEmployeeUid(db, t.employeeId, emp);
      out.push({
        id: t.employeeId,
        name: t.employeeName || `${emp.lastName || ''} ${emp.firstName || ''}`.trim(),
        uid: uid || undefined,
        convocatoriaType: 'CROSS_POS',
        sourceShiftId: d.id,
      });
    }
    return out;
  }

  for (const empDoc of empSnap.docs) {
    if (out.length >= limit) break;
    const emp = empDoc.data();
    const empId = empDoc.id;
    const name = `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId;

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
  if (step === 'CROSS_POS') return findCandidatesForConvType(db, conv, 'CROSS_POS', BROADCAST_LIMIT);
  if (step === 'INTERCAMBIO') return findCandidatesForConvType(db, conv, 'INTERCAMBIO', BROADCAST_LIMIT);
  if (step === 'FT') return findCandidatesForConvType(db, conv, 'FT', BROADCAST_LIMIT);
  return [];
}

/** RET obligado: asigna al mejor candidato sin esperar aceptación; notif solo lectura. */
async function assignRetForced(
  db: admin.firestore.Firestore,
  baseConv: ConvocatoriaCoberturaDoc,
  candidate: CandidateResult,
  createdBy: string,
): Promise<void> {
  const now = Timestamp.now();
  const convRef = db.collection('convocatorias_cobertura').doc();
  const convDoc: ConvocatoriaCoberturaDoc = {
    ...baseConv,
    type: 'RET',
    cascadeStepKey: 'RET',
    cascadeStep: CASCADE_ORDER.indexOf('RET'),
    candidateEmployeeId: candidate.id,
    candidateEmployeeName: candidate.name,
    candidateUid: candidate.uid,
    sourceShiftId: candidate.sourceShiftId,
    status: 'ACCEPTED',
    timeoutAt: now,
    createdAt: now,
    createdBy,
    respondedAt: now,
    respondedBy: 'RET_FORZADO',
  };
  await convRef.set(convDoc);
  await resolverCobertura(db, { ...convDoc, id: convRef.id });

  if (candidate.uid || candidate.id) {
    await db.collection('user_notifications').add({
      uid: candidate.uid || null,
      employeeId: candidate.id,
      type: 'COBERTURA_ASIGNADA',
      title: 'RET asignado a cobertura',
      body: `Tu RET se convirtió en turno real en ${baseConv.objectiveName || 'el puesto'} (${baseConv.shiftCode || ''}). Presentate al puesto.`,
      empresaId: baseConv.empresaId,
      convocatoriaId: convRef.id,
      shiftId: baseConv.shiftId,
      objectiveId: baseConv.objectiveId,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

/** CROSS_POS: presente en otro puesto del mismo objetivo → redirección forzada. */
async function assignCrossPosForced(
  db: admin.firestore.Firestore,
  baseConv: ConvocatoriaCoberturaDoc,
  candidate: CandidateResult,
  createdBy: string,
): Promise<void> {
  const now = Timestamp.now();
  const convRef = db.collection('convocatorias_cobertura').doc();
  const convDoc: ConvocatoriaCoberturaDoc = {
    ...baseConv,
    type: 'CROSS_POS',
    cascadeStepKey: 'CROSS_POS',
    cascadeStep: CASCADE_ORDER.indexOf('CROSS_POS'),
    candidateEmployeeId: candidate.id,
    candidateEmployeeName: candidate.name,
    candidateUid: candidate.uid,
    sourceShiftId: candidate.sourceShiftId,
    status: 'ACCEPTED',
    timeoutAt: now,
    createdAt: now,
    createdBy,
    respondedAt: now,
    respondedBy: 'CROSS_POS_FORZADO',
  };
  await convRef.set(convDoc);
  await resolverCobertura(db, { ...convDoc, id: convRef.id });

  if (candidate.uid || candidate.id) {
    await db.collection('user_notifications').add({
      uid: candidate.uid || null,
      employeeId: candidate.id,
      type: 'COBERTURA_ASIGNADA',
      title: 'Redirección a otro puesto',
      body: `Pasás a cubrir ${baseConv.positionName || 'el puesto'} en ${baseConv.objectiveName || ''} (${baseConv.shiftCode || ''}). Tu puesto anterior queda vacante.`,
      empresaId: baseConv.empresaId,
      convocatoriaId: convRef.id,
      shiftId: baseConv.shiftId,
      objectiveId: baseConv.objectiveId,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
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

  // RET obligado: no pregunta — asigna al mejor (ya ordenado por conocimiento/radio)
  if (step === 'RET') {
    await assignRetForced(db, baseConv, candidates[0], createdBy);
    await db.collection('novedades').add({
      type: 'COBERTURA_RESUELTA',
      shiftId: baseConv.shiftId,
      objectiveId: baseConv.objectiveId,
      objectiveName: baseConv.objectiveName || '',
      empresaId: baseConv.empresaId,
      title: 'RET forzado asignado',
      message: `${candidates[0].name} (RET) → turno real. Sin aceptación (obligado).`,
      cascadeStepKey: step,
      status: 'pending',
      resolved: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  }

  if (step === 'CROSS_POS') {
    await assignCrossPosForced(db, baseConv, candidates[0], createdBy);
    await db.collection('novedades').add({
      type: 'COBERTURA_RESUELTA',
      shiftId: baseConv.shiftId,
      objectiveId: baseConv.objectiveId,
      objectiveName: baseConv.objectiveName || '',
      empresaId: baseConv.empresaId,
      title: 'Otro puesto redirigido',
      message: `${candidates[0].name} → ${baseConv.positionName || 'puesto'} (mismo objetivo). Liberó su puesto.`,
      cascadeStepKey: step,
      status: 'pending',
      resolved: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  }

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

/** Vacante / turno ausente ya tiene ganador de cobertura (first-wins). */
function isShiftAlreadyCovered(data: Record<string, any> | undefined | null): boolean {
  if (!data) return false;
  const st = String(data.status || '').toUpperCase();
  if (st === 'COVERED') return true;
  if (data.operacionallyCovered === true) return true;
  if (data.coveredByEmployeeId && data.coverageEventId) return true;
  if (data.coveredByEmployeeName && data.coverageEventId && st === 'COVERED') return true;
  return false;
}

/**
 * Claim atómico PENDING|ESCALATED → ACCEPTED.
 * Devuelve false si otro ya ganó o la convocatoria ya no está abierta.
 */
async function claimConvocatoriaAccept(
  db: admin.firestore.Firestore,
  convocatoriaId: string,
  respondedBy: string,
): Promise<boolean> {
  const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('NOT_FOUND');
      const st = String(snap.data()?.status || '');
      if (st !== 'PENDING' && st !== 'ESCALATED') throw new Error('ALREADY_CLAIMED');
      tx.update(ref, {
        status: 'ACCEPTED',
        respondedAt: Timestamp.now(),
        resolvedAt: Timestamp.now(),
        respondedBy,
      });
    });
    return true;
  } catch (e: any) {
    if (e?.message === 'ALREADY_CLAIMED' || e?.message === 'NOT_FOUND') return false;
    throw e;
  }
}

async function resolverCobertura(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
): Promise<'OK' | 'ALREADY_COVERED' | 'SKIPPED'> {
  const vacantSnap = await db.collection('turnos').doc(conv.shiftId).get();
  const vacantData = vacantSnap.exists ? { id: vacantSnap.id, ...vacantSnap.data() } : { id: conv.shiftId };

  // First-wins: no materializar un 2º cubridor si el hueco ya está cubierto
  if (isShiftAlreadyCovered(vacantData as any)) {
    // EXT/ADV parcial: permitir la otra mitad del dual
    const isDualHalf =
      (conv.type === 'EXTEND' && !(vacantData as any).coverageDualExtBy)
      || (conv.type === 'ADVANCE' && !(vacantData as any).coverageDualAdvBy);
    const dualComplete = !!(vacantData as any).coverageDualExtBy && !!(vacantData as any).coverageDualAdvBy;
    if (!isDualHalf || dualComplete || String((vacantData as any).status || '').toUpperCase() === 'COVERED') {
      await db.collection('convocatorias_cobertura').doc(conv.id).set({
        status: 'CANCELLED',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'VACANTE_YA_CUBIERTA',
      }, { merge: true });
      return 'ALREADY_COVERED';
    }
  }

  // EXT duplicado / ADV duplicado
  if (conv.type === 'EXTEND' && (vacantData as any).coverageDualExtBy) {
    await db.collection('convocatorias_cobertura').doc(conv.id).set({
      status: 'CANCELLED',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: 'EXT_YA_ASIGNADO',
    }, { merge: true });
    return 'SKIPPED';
  }
  if (conv.type === 'ADVANCE' && (vacantData as any).coverageDualAdvBy) {
    await db.collection('convocatorias_cobertura').doc(conv.id).set({
      status: 'CANCELLED',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: 'ADV_YA_ASIGNADO',
    }, { merge: true });
    return 'SKIPPED';
  }

  const batch = db.batch();

  const resolvedBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO'
    : conv.createdBy === 'AUTO' ? 'AUTO'
      : 'OPERACIONES';

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
    const extendSnap = await shiftRef.get();
    const extendData = extendSnap.data() || {};
    const vacPos = String((vacantData as any).positionName || conv.positionName || '').trim();
    const srcPos = String(extendData.positionName || '').trim();
    const crossPos = !!(vacPos && srcPos && vacPos.toLowerCase() !== srcPos.toLowerCase());
    const newCode = String(conv.shiftCode || 'M').toUpperCase().startsWith('N') ? 'N12' : 'D12';
    batch.update(shiftRef, {
      code: newCode,
      isExtended: true,
      isRetention: true,
      extendedBy: 'CONVOCATORIA',
      extendedAt: FieldValue.serverTimestamp(),
      resolvedBy,
      ...(crossPos
        ? {
          coversPositionName: vacPos,
          coverageSegmentRole: 'EXTENSION',
        }
        : {}),
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
    const nextSnap = await nextRef.get();
    const nextData = nextSnap.data() || {};
    const vacPosAdv = String((vacantData as any).positionName || conv.positionName || '').trim();
    const srcPosAdv = String(nextData.positionName || '').trim();
    const crossPosAdv = !!(vacPosAdv && srcPosAdv && vacPosAdv.toLowerCase() !== srcPosAdv.toLowerCase());
    // Dual reloj: no pisar plannedStartTime; adjustedStart = llegada/adelanto para liquidación/ops
    const plannedStart = nextData.plannedStartTime || nextData.startTime || null;
    batch.update(nextRef, {
      adjustedStartTime: conv.startTime,
      isAdvanced: true,
      isEarlyStart: true,
      advancedBy: 'CONVOCATORIA',
      advancedAt: FieldValue.serverTimestamp(),
      // Ops muestra el adelanto en startTime; prefactura/plan del puesto vacante no se toca
      startTime: conv.startTime,
      plannedStartTime: plannedStart,
      resolvedBy,
      ...(crossPosAdv
        ? {
          coversPositionName: vacPosAdv,
          coverageSegmentRole: 'EARLY_START',
        }
        : {}),
      ...(resolvedBy === 'MODO_DEMO' ? { modoDemoAt: FieldValue.serverTimestamp() } : {}),
      ...covererLedgerFields({
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        coverageType: 'ADVANCE',
      }),
    });
    const extDone = !!(vacantData as any).coverageDualExtBy;
    const vacLabel = vacancyCoverageLabel({
      titularName: titular.titularEmployeeName,
      shiftCode: conv.shiftCode,
      objectiveName: conv.objectiveName,
    });
    batch.update(vacantRef, {
      coverageDualAdvBy: conv.candidateEmployeeId,
      coverageDualAdvName: conv.candidateEmployeeName,
      coverageDualAdvShiftId: conv.advanceShiftId,
      coverageEventId,
      vacancyLabel: vacLabel,
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
  } else if (conv.type === 'RET' || conv.type === 'ESC' || conv.type === 'INTERCAMBIO') {
    const sourceId = conv.sourceShiftId;
    const vacLabel = vacancyCoverageLabel({
      titularName: titular.titularEmployeeName,
      shiftCode: conv.shiftCode || (vacantData as any).code,
      positionName: (vacantData as any).positionName,
      objectiveName: conv.objectiveName,
    });
    if (sourceId) {
      const prevCode = conv.type === 'INTERCAMBIO'
        ? String((await db.collection('turnos').doc(sourceId).get()).data()?.code || 'M')
        : conv.type;
      batch.update(db.collection('turnos').doc(sourceId), {
        ...buildReassignPassiveToVacancyFields(
          {
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName,
            clientId: conv.clientId,
            clientName: conv.clientName,
            positionName: (vacantData as any).positionName,
            code: conv.shiftCode || (vacantData as any).code,
            startTime: conv.startTime || (vacantData as any).startTime,
            endTime: conv.endTime || (vacantData as any).endTime,
          },
          {
            coverageType: conv.type,
            resolvedBy,
            previousCode: prevCode,
            coverageEventId,
          },
        ),
        vacancyLabel: vacLabel,
        ...(resolvedBy === 'MODO_DEMO' ? { modoDemoAt: FieldValue.serverTimestamp() } : {}),
        ...covererLedgerFields({
          ...ledgerBase,
          vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
          coverageType: conv.type,
        }),
      });
    }
    applyCoverageLedgerToBatch(batch, db, {
      ...ledgerBase,
      vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
      covererShiftId: sourceId || null,
      coverageType: conv.type,
      markVacancyCovered: true,
      vacancyExtra: { ...ledgerBase.vacancyExtra, vacancyLabel: vacLabel, coveredByEmployeeName: conv.candidateEmployeeName },
    });
    await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
  } else if (conv.type === 'CROSS_POS') {
    const sourceId = conv.sourceShiftId;
    const vacLabel = vacancyCoverageLabel({
      titularName: titular.titularEmployeeName,
      shiftCode: conv.shiftCode || (vacantData as any).code,
      positionName: (vacantData as any).positionName,
      objectiveName: conv.objectiveName,
    });
    if (sourceId) {
      const srcSnap = await db.collection('turnos').doc(sourceId).get();
      const src = srcSnap.data() || {};
      const prevCode = String(src.code || 'M').toUpperCase();
      const prevPos = String(src.positionName || '').trim();
      const wasPresent = src.isPresent === true;
      const freedRef = db.collection('turnos').doc();
      batch.set(freedRef, {
        empresaId: conv.empresaId,
        employeeId: 'VACANTE',
        employeeName: `VACANTE (redir. ${(conv.candidateEmployeeName || '').split(',')[0] || 'guardia'})`,
        isUnassigned: true,
        clientId: src.clientId || conv.clientId || null,
        clientName: src.clientName || conv.clientName || null,
        objectiveId: src.objectiveId || conv.objectiveId,
        objectiveName: src.objectiveName || conv.objectiveName || '',
        positionName: prevPos || src.positionName || null,
        code: prevCode,
        startTime: src.startTime || null,
        endTime: src.endTime || null,
        plannedStartTime: src.plannedStartTime || src.startTime || null,
        plannedEndTime: src.plannedEndTime || src.endTime || null,
        status: 'UNCOVERED',
        origin: 'VACANTE_POR_REDIRECCION',
        causedByShiftId: sourceId,
        causedByEmployeeId: conv.candidateEmployeeId,
        causedByEmployeeName: conv.candidateEmployeeName,
        vacancyLabel: `Vacante por redirección · ${prevPos || 'puesto'} → ${(vacantData as any).positionName || 'hueco'}`,
        coverageEventId,
        createdAt: FieldValue.serverTimestamp(),
        reportedBy: resolvedBy,
      });
      batch.update(db.collection('turnos').doc(sourceId), {
        ...buildReassignPassiveToVacancyFields(
          {
            objectiveId: conv.objectiveId,
            objectiveName: conv.objectiveName,
            clientId: conv.clientId,
            clientName: conv.clientName,
            positionName: (vacantData as any).positionName,
            code: conv.shiftCode || (vacantData as any).code,
            startTime: conv.startTime || (vacantData as any).startTime,
            endTime: conv.endTime || (vacantData as any).endTime,
          },
          {
            coverageType: 'CROSS_POSITION',
            resolvedBy,
            previousCode: prevCode,
            previousPositionName: prevPos || null,
            coverageEventId,
          },
        ),
        isPresent: wasPresent,
        status: wasPresent ? 'PRESENT' : 'PENDING',
        vacatedShiftId: freedRef.id,
        vacancyLabel: vacLabel,
        ...(resolvedBy === 'MODO_DEMO' ? { modoDemoAt: FieldValue.serverTimestamp() } : {}),
        ...covererLedgerFields({
          ...ledgerBase,
          vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
          coverageType: 'CROSS_POSITION',
        }),
      });
      applyCoverageLedgerToBatch(batch, db, {
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        covererShiftId: sourceId,
        coverageType: 'CROSS_POSITION',
        markVacancyCovered: true,
        vacancyExtra: { ...ledgerBase.vacancyExtra, vacancyLabel: vacLabel, coveredByEmployeeName: conv.candidateEmployeeName },
      });
    }
    await cancelSiblingConvocatorias(batch, db, conv.shiftId, conv.id);
  } else if (conv.type === 'FT') {
    if (conv.ftShiftId) {
      const ftRef = db.collection('turnos').doc(conv.ftShiftId);
      const vacLabel = vacancyCoverageLabel({
        titularName: titular.titularEmployeeName,
        shiftCode: conv.shiftCode,
        objectiveName: conv.objectiveName,
      });
      // Dual reloj: planned = banda del hueco; no marcar presente hasta fichada real
      batch.update(ftRef, {
        code: 'FT',
        isFranco: false,
        isFrancoTrabajado: true,
        startTime: conv.startTime,
        endTime: conv.endTime || null,
        plannedStartTime: conv.startTime,
        plannedEndTime: conv.endTime || null,
        resolvedBy,
        coveredShiftId: conv.shiftId,
        vacancyLabel: vacLabel,
        assignedAt: FieldValue.serverTimestamp(),
        francoTrabajadoAt: FieldValue.serverTimestamp(),
        francoObjectiveId: conv.objectiveId,
        francoObjectiveName: conv.objectiveName || null,
        ...(resolvedBy === 'MODO_DEMO' ? { modoDemoAt: FieldValue.serverTimestamp() } : {}),
        ...covererLedgerFields({
          ...ledgerBase,
          vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
          coverageType: 'FT',
        }),
      });
      applyCoverageLedgerToBatch(batch, db, {
        ...ledgerBase,
        vacancyShiftId: titular.vacancyShiftId || conv.shiftId,
        covererShiftId: conv.ftShiftId,
        coverageType: 'FT',
        markVacancyCovered: true,
        vacancyExtra: { ...ledgerBase.vacancyExtra, vacancyLabel: vacLabel },
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
  return 'OK';
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
      const claimed = await claimConvocatoriaAccept(db, convocatoriaId, uid);
      if (!claimed) {
        throw new functions.https.HttpsError('failed-precondition', 'La convocatoria ya fue respondida o cancelada.');
      }
      const result = await resolverCobertura(db, { ...conv, id: convocatoriaId, status: 'ACCEPTED' });
      if (result === 'ALREADY_COVERED') {
        return { success: true, alreadyCovered: true };
      }
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
  positionName?: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  empresaId: string;
}

export async function iniciarCascadaCobertura(
  db: admin.firestore.Firestore,
  shift: ShiftDataForCascade,
  createdBy = 'AUTO',
): Promise<void> {
  const vacantSnap = await db.collection('turnos').doc(shift.id).get();
  if (vacantSnap.exists && isShiftAlreadyCovered(vacantSnap.data() as any)) return;

  // Solo PENDING bloquea reinicio; ESCALATED solo no impide nueva cascada si quedó colgada
  const existing = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('status', '==', 'PENDING')
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
    positionName: String(shift.positionName || ''),
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

// ─── MODO DEMO: simular respuestas (first-wins por shiftId) ───────────────────

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

  // Una sola aceptación por hueco: ordenar por cascadeStep ASC, createdAt ASC
  const byShift = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();
  for (const convDoc of snap.docs) {
    const conv = convDoc.data() as ConvocatoriaCoberturaDoc;
    if (conv.type === 'LLEGADA_TARDE') continue;
    const createdMs = conv.createdAt instanceof Timestamp ? conv.createdAt.toMillis() : 0;
    if (createdMs > cutoffMs) continue;
    const list = byShift.get(conv.shiftId) || [];
    list.push(convDoc);
    byShift.set(conv.shiftId, list);
  }

  let respondidas = 0;
  for (const [shiftId, docs] of byShift) {
    docs.sort((a, b) => {
      const ca = a.data() as ConvocatoriaCoberturaDoc;
      const cb = b.data() as ConvocatoriaCoberturaDoc;
      const sa = Number(ca.cascadeStep ?? 99);
      const sb = Number(cb.cascadeStep ?? 99);
      if (sa !== sb) return sa - sb;
      const ta = ca.createdAt instanceof Timestamp ? ca.createdAt.toMillis() : 0;
      const tb = cb.createdAt instanceof Timestamp ? cb.createdAt.toMillis() : 0;
      return ta - tb;
    });

    // Releer vacante: si ya está cubierta, cancelar todas y seguir
    const vacantFresh = await db.collection('turnos').doc(shiftId).get();
    if (vacantFresh.exists && isShiftAlreadyCovered(vacantFresh.data() as any)) {
      const batch = db.batch();
      for (const d of docs) {
        batch.update(d.ref, { status: 'CANCELLED', cancelledAt: FieldValue.serverTimestamp(), cancelReason: 'VACANTE_YA_CUBIERTA' });
      }
      await batch.commit();
      continue;
    }

    let won = false;
    for (const convDoc of docs) {
      const conv = convDoc.data() as ConvocatoriaCoberturaDoc;

      // Tras un ganador: cancelar el resto del snapshot (hermanas)
      if (won) {
        const live = await convDoc.ref.get();
        const st = String(live.data()?.status || '');
        if (st === 'PENDING' || st === 'ESCALATED') {
          await convDoc.ref.update({
            status: 'CANCELLED',
            cancelledAt: FieldValue.serverTimestamp(),
            cancelReason: 'FIRST_WINS_DEMO',
          });
        }
        continue;
      }

      // Releer: puede haber sido cancelada por un accept previo
      const live = await convDoc.ref.get();
      const liveSt = String(live.data()?.status || '');
      if (liveSt !== 'PENDING' && liveSt !== 'ESCALATED') continue;

      // Demo: ~90% acepta la primera candidata viable; si rechaza, probar la siguiente
      const hashVal = convDoc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
      const accept = hashVal <= 8;

      try {
        if (accept) {
          const claimed = await claimConvocatoriaAccept(db, convDoc.id, 'MODO_DEMO');
          if (!claimed) continue;
          const result = await resolverCobertura(db, {
            ...conv,
            id: convDoc.id,
            createdBy: 'MODO_DEMO',
            status: 'ACCEPTED',
          });
          if (result === 'OK') {
            won = true;
            respondidas++;
          }
          // ALREADY_COVERED / SKIPPED → seguir buscando no (hueco ya cerrado)
          if (result === 'ALREADY_COVERED') {
            won = true;
          }
        } else {
          await convDoc.ref.update({
            status: 'REJECTED',
            respondedAt: now,
            rejectionReason: 'MODO_DEMO_AUTO',
            respondedBy: 'MODO_DEMO',
          });
          await maybeAvanzarCascada(db, { ...conv, id: convDoc.id }, 'REJECTED');
          respondidas++;
        }
      } catch (e) {
        console.warn('[simularRespuestasConvocatorias]', convDoc.id, (e as Error)?.message);
      }
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
