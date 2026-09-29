import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { ObjectiveOperationCache } from '../common/simulableShift';
import { isExtraNonReliefShift } from '../common/reliefEligibility';
import { skipAbsencePipelineForShift } from '../coverage/coverageTraceShift';
import { crearConvocatoriaLlegadaTarde } from '../coverage/convocatoriasCobertura';
import type { loadCentroControlState } from '../ops/centroControlGuard';
import {
  classifyArrivalNotice,
  headsUpBody,
  HEADS_UP_BEFORE_MS,
  lugarAviso,
  VENIS_GRACE_MS,
} from './arrivalNoticeWindow';

type CcState = Awaited<ReturnType<typeof loadCentroControlState>>;

const SKIP_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'A', 'E', 'AA', 'ART', 'PG', 'SGS', 'SUS']);
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'COMPLETED', 'INTERRUPTED', 'CANCELLED']);
const TZ = 'America/Argentina/Buenos_Aires';

function horaAr(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TZ,
  });
}

function eligibleShift(shift: Record<string, unknown>): boolean {
  if (shift.draft === true || shift.isPresent === true || shift.isCompleted === true || shift.isAbsent === true) {
    return false;
  }
  if (skipAbsencePipelineForShift(shift)) return false;
  if (shift.isFranco === true) return false;
  if (shift.isUnassigned === true) return false;
  const emp = String(shift.employeeId || '').trim();
  if (!emp || emp === 'VACANTE') return false;
  if (SKIP_CODES.has(String(shift.code || '').toUpperCase())) return false;
  if (SKIP_STATUSES.has(String(shift.status || '').toUpperCase())) return false;
  if (shift.lateArrivalAt || shift.lateArrivalConfirmed) return false;
  return true;
}

async function claimFlag(
  db: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  field: 'preStartArrivalNoticeAt' | 'earlyRetentionAlertAt',
  now: Timestamp,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    if (data[field]) return false;
    if (data.isPresent === true || data.isAbsent === true || data.isCompleted === true) return false;
    tx.update(ref, { [field]: now });
    return true;
  });
}

async function releaseFlag(
  ref: FirebaseFirestore.DocumentReference,
  field: 'preStartArrivalNoticeAt' | 'earlyRetentionAlertAt',
): Promise<void> {
  await ref.update({ [field]: FieldValue.delete() }).catch(() => {});
}

async function writeHeadsUp(
  db: Firestore,
  shiftId: string,
  shift: Record<string, unknown>,
  startMs: number,
): Promise<void> {
  const lugar = lugarAviso(shift);
  const hora = horaAr(startMs);
  const empSnap = await db.collection('empleados').doc(String(shift.employeeId)).get();
  const uid = empSnap.exists ? String(empSnap.data()?.uid || '') : '';
  await db.collection('user_notifications').add({
    uid: uid || null,
    employeeId: shift.employeeId,
    type: 'AVISO_TURNO_PROXIMO',
    title: '¿Estás llegando?',
    body: headsUpBody(hora, lugar),
    empresaId: shift.empresaId || null,
    shiftId,
    objectiveId: shift.objectiveId || null,
    objectiveName: shift.objectiveName || null,
    positionName: shift.positionName || null,
    clientName: shift.clientName || null,
    shiftCode: shift.code || null,
    startTime: shift.startTime || null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function alertOutgoing(
  db: Firestore,
  incoming: Record<string, unknown>,
): Promise<void> {
  if (isExtraNonReliefShift(incoming)) return;
  const empresaId = String(incoming.empresaId || '').trim();
  const objectiveId = String(incoming.objectiveId || '').trim();
  const posName = String(incoming.positionName || '').trim().toLowerCase();
  if (!empresaId || !objectiveId || !posName) return;

  const presentSnap = await db.collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('objectiveId', '==', objectiveId)
    .where('isPresent', '==', true)
    .get();

  const lugar = lugarAviso(incoming) || String(incoming.objectiveName || 'el puesto');
  for (const retDoc of presentSnap.docs) {
    const dat = retDoc.data() as Record<string, unknown>;
    if (dat.isCompleted === true) continue;
    if (isExtraNonReliefShift(dat)) continue;
    if (String(dat.positionName || '').trim().toLowerCase() !== posName) continue;
    if (dat.employeeId === incoming.employeeId) continue;
    if (dat.incomingLateAlertShiftId === incoming.id) continue;
    const empSnap = await db.collection('empleados').doc(String(dat.employeeId || '')).get();
    const uid = empSnap.exists ? String(empSnap.data()?.uid || '') : '';
    await db.collection('user_notifications').add({
      uid: uid || null,
      employeeId: dat.employeeId || null,
      type: 'AVISO_ENTRANTE_SIN_FICHAR',
      title: 'El entrante aún no llegó',
      body: `${incoming.employeeName || 'El guardia siguiente'} no marcó presencia en ${lugar}. Esperá aviso de Operaciones antes de retirarte.`,
      empresaId,
      shiftId: retDoc.id,
      relatedShiftId: incoming.id || null,
      objectiveId,
      objectiveName: incoming.objectiveName || null,
      positionName: incoming.positionName || null,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    await retDoc.ref.update({ incomingLateAlertShiftId: incoming.id || true }).catch(() => {});
  }
}

export async function runShiftArrivalNotices(
  db: Firestore,
  now: Timestamp,
  cc: CcState,
): Promise<number> {
  if (!cc.anyEnabled) return 0;
  const nowMs = now.toMillis();
  const cache = new ObjectiveOperationCache();
  let sent = 0;

  const headsUpSnap = await db.collection('turnos')
    .where('startTime', '>', Timestamp.fromMillis(nowMs))
    .where('startTime', '<=', Timestamp.fromMillis(nowMs + HEADS_UP_BEFORE_MS))
    .get();

  const venisSnap = await db.collection('turnos')
    .where('startTime', '>=', Timestamp.fromMillis(nowMs - VENIS_GRACE_MS))
    .where('startTime', '<=', now)
    .get();

  const pass = async (
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
    kind: 'HEADS_UP' | 'VENIS',
  ) => {
    for (const docSnap of docs) {
      const shift = docSnap.data() as Record<string, unknown>;
      const empresaId = String(shift.empresaId || '').trim();
      if (!cc.isEnabled(empresaId)) continue;
      if (cc.isDemo(empresaId)) continue;
      if (!eligibleShift(shift)) continue;
      const startMs = (shift.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (classifyArrivalNotice(startMs, nowMs) !== kind) continue;
      const flag = kind === 'HEADS_UP' ? 'preStartArrivalNoticeAt' : 'earlyRetentionAlertAt';
      if (shift[flag]) continue;
      if (!(await cache.isShiftInOperation(db, shift))) continue;

      const claimed = await claimFlag(db, docSnap.ref, flag, now);
      if (!claimed) continue;
      try {
        if (kind === 'HEADS_UP') {
          await writeHeadsUp(db, docSnap.id, shift, startMs);
        } else {
          const empSnap = await db.collection('empleados').doc(String(shift.employeeId)).get();
          const empUid = empSnap.exists ? String(empSnap.data()?.uid || '') : '';
          await crearConvocatoriaLlegadaTarde(db, {
            id: docSnap.id,
            empresaId,
            objectiveId: String(shift.objectiveId || ''),
            objectiveName: String(shift.objectiveName || ''),
            positionName: String(shift.positionName || ''),
            clientId: String(shift.clientId || ''),
            clientName: String(shift.clientName || ''),
            shiftCode: String(shift.code || '').toUpperCase(),
            startTime: shift.startTime as Timestamp,
            endTime: shift.endTime as Timestamp | undefined,
            employeeId: String(shift.employeeId),
            employeeName: String(shift.employeeName || ''),
            employeeUid: empUid || undefined,
          });
          await alertOutgoing(db, { ...shift, id: docSnap.id });
        }
        sent++;
      } catch (e) {
        console.warn(`[runShiftArrivalNotices] ${kind} ${docSnap.id}:`, (e as Error)?.message);
        await releaseFlag(docSnap.ref, flag);
      }
    }
  };

  await pass(headsUpSnap.docs, 'HEADS_UP');
  await pass(venisSnap.docs, 'VENIS');
  return sent;
}
