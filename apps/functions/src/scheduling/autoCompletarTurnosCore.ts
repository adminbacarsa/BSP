import * as admin from 'firebase-admin';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  loadPositionHasContinuity,
  positionHasContinuityFromSlaDoc,
} from '../coverage/positionHasContinuity';
import { retainOutgoingForGap, totalShiftMs, RETENTION_MAX_TOTAL_MS } from '../coverage/coverageRetention';

const RELIEF_WINDOW_MS = 2 * 60 * 60 * 1000;

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

function shiftEndDate(data: FirebaseFirestore.DocumentData): Date | null {
  const ms = data.endTime?.toMillis?.() ?? 0;
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
  const auditBatch = db.batch();
  let completed = 0;
  let alertedNoRelief = 0;

  const slaCache = new Map<string, FirebaseFirestore.DocumentData | null>();

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

  for (const docSnap of snap.docs) {
    const shift = docSnap.data();
    if (!ctx.isEnabled(shift.empresaId)) continue;
    if ((shift.status || '') === 'INTERRUPTED') continue;

    const endTimeMs: number = shift.endTime?.toMillis?.() ?? 0;
    if (!endTimeMs) continue;
    const endDate = new Date(endTimeMs);
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

    const windowStart = Timestamp.fromMillis(endTimeMs - RELIEF_WINDOW_MS);
    const windowEnd = Timestamp.fromMillis(endTimeMs + RELIEF_WINDOW_MS);

    const relieveSnap = await db
      .collection('turnos')
      .where('objectiveId', '==', shift.objectiveId)
      .where('positionName', '==', shift.positionName)
      .where('startTime', '>=', windowStart)
      .where('startTime', '<=', windowEnd)
      .get();

    const relieveDocs = relieveSnap.docs.filter(
      (d) => d.id !== docSnap.id && ctx.sameTenantShift(shift, d.data()),
    );

    const relievePresent = relieveDocs.find((d) => {
      const s = d.data().status || '';
      return s === 'PRESENT' || s === 'COMPLETED';
    });

    const relievePending = relieveDocs.find((d) => {
      const data = d.data();
      if (!data.employeeId || data.employeeId === 'VACANTE') return false;
      if (data.isUnassigned === true) return false;
      const s = data.status || '';
      return s === 'PENDING' || s === 'PLAN' || s === '' || !s;
    });

    const relieveAbsent = relieveDocs.find((d) => {
      const data = d.data();
      return data.isAbsent === true || data.status === 'ABSENT';
    });

    if (relievePresent) {
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
      } else if (!shift.isRetention) {
        completeBatch.update(docSnap.ref, {
          isRetention: true,
          retentionReason: `RELEVO_NO_PRESENTADO: ${relievePending?.data().employeeName || 'relevo'}`,
          autoRetentionAt: Timestamp.fromMillis(Math.max(nowMs, endTimeMs)),
        });
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
  await auditBatch.commit();
  return { completed, alertedNoRelief };
}

export { loadPositionHasContinuity };
