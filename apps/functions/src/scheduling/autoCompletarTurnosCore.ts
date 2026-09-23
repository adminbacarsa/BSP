import * as admin from 'firebase-admin';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  loadPositionHasContinuity,
  positionHasContinuityFromSlaDoc,
} from '../coverage/positionHasContinuity';
import { retainOutgoingForGap, totalShiftMs, RETENTION_MAX_TOTAL_MS } from '../coverage/coverageRetention';
import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';

const RELEVO_WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;
const RELEVO_ALIGN_MS = 30 * 60 * 1000;

export type AutoCompleteContext = {
  isEnabled: (empresaId: unknown) => boolean;
  shiftEmpresaId: (shift: FirebaseFirestore.DocumentData) => string;
  sameTenantShift: (
    a: FirebaseFirestore.DocumentData,
    b: FirebaseFirestore.DocumentData,
  ) => boolean;
  getEmployeeTokens: (db: Firestore, employeeId: string) => Promise<string[]>;
};

export type AutoCompletePassResult = {
  completed: number;
  alertedNoRelief: number;
};

function shiftEndMs(data: FirebaseFirestore.DocumentData): number {
  return data.endTime?.toMillis?.() ?? 0;
}

function shiftStartMs(data: FirebaseFirestore.DocumentData): number {
  return data.startTime?.toMillis?.() ?? 0;
}

function checkInMs(data: FirebaseFirestore.DocumentData): number {
  const real = data.realStartTime?.toMillis?.();
  if (real) return real;
  const ci = data.checkInTime?.toMillis?.();
  if (ci) return ci;
  const pres = data.presenciaAt?.toMillis?.();
  if (pres) return pres;
  return shiftStartMs(data);
}

/** Relevo válido: mismo puesto, start en [end−30m, end+2h], no compañero en curso (empezó antes de end−30m). */
export function isValidReliefForOutgoing(
  incoming: FirebaseFirestore.DocumentData,
  outgoingEndMs: number,
): boolean {
  const st = shiftStartMs(incoming);
  if (!st) return false;
  if (st < outgoingEndMs - RELEVO_ALIGN_MS) return false;
  if (st > outgoingEndMs + RELEVO_WINDOW_AFTER_MS) return false;
  return true;
}

export function isReliefPresent(incoming: FirebaseFirestore.DocumentData): boolean {
  if (incoming.isCompleted === true) return false;
  const st = String(incoming.status || '').toUpperCase();
  return st === 'PRESENT' && incoming.isPresent !== false;
}

function isReliefPending(incoming: FirebaseFirestore.DocumentData): boolean {
  if (!incoming.employeeId || incoming.employeeId === 'VACANTE') return false;
  if (incoming.isUnassigned === true) return false;
  const st = String(incoming.status || '').toUpperCase();
  return st === 'PENDING' || st === 'PLAN' || st === '' || !st;
}

function isReliefAbsent(incoming: FirebaseFirestore.DocumentData): boolean {
  return incoming.isAbsent === true || String(incoming.status || '').toUpperCase() === 'ABSENT';
}

function shiftEndDate(data: FirebaseFirestore.DocumentData): Date | null {
  const ms = shiftEndMs(data);
  return ms ? new Date(ms) : null;
}

export async function runAutoCompletarTurnosPass(
  db: Firestore,
  ctx: AutoCompleteContext,
  now: Timestamp = Timestamp.now(),
): Promise<AutoCompletePassResult> {
  const nowMs = now.toMillis();
  const cutoff = Timestamp.fromMillis(nowMs - 5 * 60 * 1000);

  const snap = await db
    .collection('turnos')
    .where('status', '==', 'PRESENT')
    .where('endTime', '<=', cutoff)
    .get();

  if (snap.empty) return { completed: 0, alertedNoRelief: 0 };

  const completeBatch = db.batch();
  let completed = 0;
  let alertedNoRelief = 0;

  const slaCache = new Map<string, FirebaseFirestore.DocumentData | null>();
  const reliefIncomingClaimed = new Set<string>();

  async function hasContinuity(shift: FirebaseFirestore.DocumentData): Promise<boolean> {
    const oid = String(shift.objectiveId || '');
    const end = shiftEndDate(shift);
    if (!oid || !end) return false;
    if (!slaCache.has(oid)) {
      const slaSnap = await db
        .collection('servicios_sla')
        .where('objectiveId', '==', oid)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      slaCache.set(oid, slaSnap.empty ? null : slaSnap.docs[0].data());
    }
    const sla = slaCache.get(oid);
    return positionHasContinuityFromSlaDoc(sla || undefined, shift.positionName || '', end);
  }

  const outgoingDocs = [...snap.docs].sort(
    (a, b) => checkInMs(a.data()) - checkInMs(b.data()),
  );

  for (const docSnap of outgoingDocs) {
    const shift = docSnap.data();
    if (!ctx.isEnabled(shift.empresaId)) continue;
    if (isOpsCoverageHoursOnSourceDoc(shift as Record<string, unknown>)) continue;
    if ((shift.status || '') === 'INTERRUPTED') continue;

    const endTimeMs = shiftEndMs(shift);
    if (!endTimeMs) continue;
    const continuous = await hasContinuity(shift);

    if (shift.isRetention === true) {
      const manualExtended =
        shift.manualRetentionType === 'extended' && Number(shift.manualRetentionHours || 0) > 0;
      if (manualExtended) {
        const extH = Number(shift.manualRetentionHours);
        const baseMs = shift.manualRetentionStartedAt?.toMillis?.() ?? endTimeMs;
        if (nowMs < baseMs + extH * 3600000) continue;
        completeBatch.update(docSnap.ref, {
          status: 'COMPLETED',
          isCompleted: true,
          isPresent: false,
          completedAt: now,
          completedBy: 'Sistema',
          completionReason: 'MANUAL_EXTENSION_ELAPSED',
        });
        completed++;
        continue;
      }

      const totalMs = totalShiftMs(shift as Record<string, unknown>, nowMs);
      if (totalMs >= RETENTION_MAX_TOTAL_MS) {
        if (!continuous) {
          completeBatch.update(docSnap.ref, {
            status: 'COMPLETED',
            isCompleted: true,
            isPresent: false,
            completedAt: now,
            completedBy: 'Sistema',
            completionReason: 'RETENCION_TOPE_12H',
          });
          completed++;
        } else {
          const existing = await db
            .collection('novedades')
            .where('shiftId', '==', docSnap.id)
            .where('type', '==', 'RETENCION_TOPE_12H')
            .limit(1)
            .get();
          if (existing.empty) {
            await db.collection('novedades').add({
              type: 'RETENCION_TOPE_12H',
              status: 'PENDIENTE',
              shiftId: docSnap.id,
              objectiveId: shift.objectiveId || null,
              objectiveName: shift.objectiveName || '',
              empresaId: ctx.shiftEmpresaId(shift) || null,
              employeeName: shift.employeeName || '',
              positionName: shift.positionName || '',
              description: `${shift.employeeName || 'Guardia'} superó 12 h en puesto con continuidad SLA — sigue retenido hasta relevo.`,
              createdAt: now,
              source: 'SYSTEM_SCHEDULER',
            });
          }
        }
      }
      continue;
    }

    const windowStart = Timestamp.fromMillis(endTimeMs - RELEVO_WINDOW_AFTER_MS);
    const windowEnd = Timestamp.fromMillis(endTimeMs + RELEVO_WINDOW_AFTER_MS);

    const relieveSnap = await db
      .collection('turnos')
      .where('objectiveId', '==', shift.objectiveId)
      .where('positionName', '==', shift.positionName)
      .where('startTime', '>=', windowStart)
      .where('startTime', '<=', windowEnd)
      .get();

    const relieveDocs = relieveSnap.docs.filter(
      (d) =>
        d.id !== docSnap.id
        && ctx.sameTenantShift(shift, d.data())
        && !isOpsCoverageHoursOnSourceDoc(d.data() as Record<string, unknown>),
    );

    const relievePresent = relieveDocs.find((d) => {
      if (reliefIncomingClaimed.has(d.id)) return false;
      const data = d.data();
      return isReliefPresent(data) && isValidReliefForOutgoing(data, endTimeMs);
    });

    const relievePending = relieveDocs.find((d) => {
      const data = d.data();
      return isReliefPending(data) && isValidReliefForOutgoing(data, endTimeMs);
    });

    const relieveAbsent = relieveDocs.find((d) => {
      const data = d.data();
      return isReliefAbsent(data) && isValidReliefForOutgoing(data, endTimeMs);
    });

    if (relievePresent) {
      reliefIncomingClaimed.add(relievePresent.id);
      const relData = relievePresent.data();
      const relCheckMs =
        relData.realStartTime?.toMillis?.() ??
        relData.checkInTime?.toMillis?.() ??
        nowMs;
      const closeMs = relCheckMs <= endTimeMs ? endTimeMs : relCheckMs;
      completeBatch.update(docSnap.ref, {
        status: 'COMPLETED',
        isCompleted: true,
        realEndTime: Timestamp.fromMillis(closeMs),
        autoCompletedAt: now,
        autoCompletedBy: 'SYSTEM_SCHEDULER',
        autoCloseReason: 'RELEVO_PRESENTE',
        completionReason: 'RELEVO_PRESENTE',
      });
      completed++;
    } else if (relievePending || relieveAbsent) {
      if (!continuous) {
        completeBatch.update(docSnap.ref, {
          status: 'COMPLETED',
          isCompleted: true,
          realEndTime: now,
          autoCompletedAt: now,
          autoCompletedBy: 'SYSTEM_SCHEDULER',
          autoCloseReason: 'SIN_CONTINUIDAD_SLA',
          completionReason: 'SIN_CONTINUIDAD_SLA',
        });
        completed++;
        continue;
      }
      if (relieveAbsent) {
        await retainOutgoingForGap(
          db,
          {
            ...relieveAbsent.data(),
            id: relieveAbsent.id,
          },
          { sendPush: true, reportedBy: 'AUTO' },
        );
      } else if (relievePending) {
        const pendingId = relievePending.id;
        const pendingData = relievePending.data();
        if (!shift.isRetention) {
          completeBatch.update(docSnap.ref, {
            isRetention: true,
            retentionReason: `RELEVO_NO_PRESENTADO: ${pendingData.employeeName || 'relevo'} no se presentó`,
            retentionAbsenceShiftId: pendingId,
            autoRetentionAt: Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
          });
        } else if (!shift.retentionAbsenceShiftId) {
          completeBatch.update(docSnap.ref, {
            retentionAbsenceShiftId: pendingId,
          });
        }
      }
      alertedNoRelief++;
    } else if (!continuous) {
      completeBatch.update(docSnap.ref, {
        status: 'COMPLETED',
        isCompleted: true,
        realEndTime: now,
        autoCompletedAt: now,
        autoCompletedBy: 'SYSTEM_SCHEDULER',
        autoCloseReason: 'SIN_CONTINUIDAD_SLA',
        completionReason: 'SIN_CONTINUIDAD_SLA',
      });
      completed++;
    } else {
      if (!shift.isRetention) {
        completeBatch.update(docSnap.ref, {
          isRetention: true,
          retentionReason: 'SIN_RELEVO_CONTINUIDAD',
          autoRetentionAt: Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
        });
      }
      alertedNoRelief++;
    }
  }

  await completeBatch.commit();
  return { completed, alertedNoRelief };
}

export { loadPositionHasContinuity };
