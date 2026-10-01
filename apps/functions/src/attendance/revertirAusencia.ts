import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { releaseRetentionForAbsenceShift } from '../coverage/coverageRetention';
import {
  absenceVacancyClosePatch,
  buildRestoreSourceShiftAfterCoveragePatch,
  findOpenAbsenceVacancyDocs,
} from '../coverage/syncAusenciaCobertura';
import { isReliefEligibleShift } from '../common/reliefEligibility';
import { findPresentOutgoingAlignedToGapStart } from '../fichajes/relevoOutgoingMatch';
import { buildAutoClosePatch, clearRetentionOnReliefClose } from '../scheduling/shiftClose';

export const REVERT_ABSENCE_WINDOW_MS = 60 * 60 * 1000;

export type RevertirAusenciaInput = {
  shiftId: string;
  cancelCoverage?: boolean;
  operatorUid?: string;
};

export async function revertirAusenciaShift(
  db: Firestore,
  input: RevertirAusenciaInput,
): Promise<{ success: boolean; reason?: string }> {
  const shiftId = String(input.shiftId || '').trim();
  if (!shiftId) return { success: false, reason: 'INVALID_SHIFT' };

  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) return { success: false, reason: 'NOT_FOUND' };
  const shift = snap.data() as Record<string, unknown>;

  const startMs = (shift.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
  const nowMs = Date.now();
  if (startMs && nowMs > startMs + REVERT_ABSENCE_WINDOW_MS) {
    return { success: false, reason: 'PAST_T60' };
  }

  const activeCovSnap = await db
    .collection('turnos')
    .where('absenceShiftId', '==', shiftId)
    .where('origin', '==', 'OPERATIONS_COVERAGE')
    .limit(5)
    .get();
  const activeCov = activeCovSnap.docs.filter(
    (d) => d.data().coverageSuperseded !== true && String(d.data().status || '').toUpperCase() !== 'CANCELLED',
  );

  if (activeCov.length > 0 && input.cancelCoverage !== true) {
    return { success: false, reason: 'COVERAGE_IN_PROGRESS' };
  }

  const now = Timestamp.now();

  await ref.update({
    isAbsent: false,
    absenceType: FieldValue.delete(),
    absenceDetectedAt: FieldValue.delete(),
    absenceDetectedBy: FieldValue.delete(),
    status: 'PRESENT',
    isPresent: true,
    realStartTime: now,
    checkInTime: now,
    isLate: true,
    lateMinutes: startMs ? Math.max(0, Math.round((nowMs - startMs) / 60000)) : 0,
    absenceRevertedAt: now,
    absenceRevertedBy: input.operatorUid || 'OPERACIONES',
    presenciaSource: 'OPERATIONS',
  });

  // Misma serie que una fichada: el saliente cierra ya, en max(inicio planificado, ahora).
  if (isReliefEligibleShift(shift) && startMs > 0 && shift.objectiveId && shift.positionName) {
    const pick = await findPresentOutgoingAlignedToGapStart(db, {
      objectiveId: String(shift.objectiveId),
      positionName: shift.positionName,
      gapStartMs: startMs,
      excludeShiftIds: [shiftId],
      excludeEmployeeId: String(shift.employeeId || ''),
      // Ya no es ausente: releva como una fichada (FIFO, al que más tiempo lleva en el puesto,
      // aunque la retención lo haya vinculado a otra ausencia de la misma franja).
      incoming: { ...shift, isAbsent: false, status: 'PRESENT', isPresent: true, checkInTime: now, realStartTime: now },
    });
    if (pick) {
      const realEndMs = Math.max(startMs, nowMs);
      const patch = clearRetentionOnReliefClose(buildAutoClosePatch(pick.data, {
        realEndMs,
        reason: 'RELEVO_PRESENTE',
        now: Timestamp.fromMillis(nowMs),
        by: 'REVERTIR_AUSENCIA',
      }));
      await db.collection('turnos').doc(pick.id).update({
        ...patch,
        relievedBy: String(shift.employeeId || '') || null,
        relievedByName: String(shift.employeeName || 'relevo'),
        relievedAt: FieldValue.serverTimestamp(),
        autoRelevo: true,
        relievedEarly: false,
        relievedSource: 'OPERATIONS',
      });
      await ref.update({ relievedOutgoingShiftId: pick.id });
    }
  }

  const ausSnap = await db.collection('ausencias').where('shiftId', '==', shiftId).limit(5).get();
  for (const a of ausSnap.docs) {
    await a.ref.update({ status: 'Anulada', anuladaAt: FieldValue.serverTimestamp() });
  }

  const convSnap = await db
    .collection('convocatorias_cobertura')
    .where('shiftId', '==', shiftId)
    .limit(30)
    .get();
  for (const c of convSnap.docs) {
    const st = String(c.data().status || '');
    if (st === 'PENDING' || st === 'ESCALATED') {
      await c.ref.update({
        status: 'CANCELLED',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: input.operatorUid || 'REVERTIR_AUSENCIA',
      });
    }
  }

  await releaseRetentionForAbsenceShift(db, shiftId, 'REVERTIR_AUSENCIA');

  for (const vRef of await findOpenAbsenceVacancyDocs(db, shiftId)) {
    await vRef.update(absenceVacancyClosePatch('REVERTED', input.operatorUid || 'REVERTIR_AUSENCIA'));
  }

  if (input.cancelCoverage === true && activeCov.length) {
    for (const cov of activeCov) {
      await cov.ref.update({
        coverageSuperseded: true,
        status: 'CANCELLED',
        cancelledAt: FieldValue.serverTimestamp(),
      });
      const srcId = String(cov.data().sourceShiftId || '').trim();
      if (srcId) {
        const srcSnap = await db.collection('turnos').doc(srcId).get();
        if (srcSnap.exists) {
          await srcSnap.ref.update(
            buildRestoreSourceShiftAfterCoveragePatch(srcSnap.data() as Record<string, unknown>),
          );
        }
      }
    }
    await ref.update({
      operacionallyCovered: false,
      coverageStatus: FieldValue.delete(),
      coverageUsed: FieldValue.delete(),
    });
  }

  return { success: true };
}
