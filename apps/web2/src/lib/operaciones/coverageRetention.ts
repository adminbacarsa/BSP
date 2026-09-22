import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { opsPositionMatches } from '@/lib/operaciones/opsDualCoverageApply';
import { stampEmpresaId } from '@/lib/multiempresa';

const toDate = (d: unknown): Date => {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) {
    return new Date((d as { seconds: number }).seconds * 1000);
  }
  return new Date(d as string | number);
};

const checkInMsFromShift = (shift: Record<string, unknown>): number => {
  const real = shift.realStartTime as { seconds?: number } | undefined;
  if (real?.seconds) return real.seconds * 1000;
  const ci = shift.checkInTime as { seconds?: number } | undefined;
  if (ci?.seconds) return ci.seconds * 1000;
  const pres = shift.presenciaAt as { seconds?: number } | undefined;
  if (pres?.seconds) return pres.seconds * 1000;
  return 0;
};

export type RetentionPickResult = {
  shiftId: string;
  employeeId: string;
  employeeName: string;
  checkInMs: number;
} | null;

/** Presentes en el mismo objetivo y puesto del hueco; retiene al último en fichar. */
export function pickRetentionShiftForGap(
  processedData: unknown[],
  absenceShift: Record<string, unknown>,
): RetentionPickResult {
  const objectiveId = String(absenceShift.objectiveId || '').trim();
  const positionName = absenceShift.positionName;
  if (!objectiveId) return null;

  const rows = (processedData || []).filter((raw) => {
    const sh = raw as Record<string, unknown>;
    if (!sh.isPresent || sh.isCompleted || sh.isAbsent) return false;
    if (String(sh.objectiveId || '').trim() !== objectiveId) return false;
    if (!opsPositionMatches(sh.positionName, positionName)) return false;
    if (sh.isVirtual === true) return false;
    const eid = String(sh.employeeId || '').trim();
    if (!eid || eid === 'VACANTE') return false;
    if (eid === String(absenceShift.employeeId || '').trim()) return false;
    return true;
  }) as Record<string, unknown>[];

  if (!rows.length) return null;

  rows.sort((a, b) => checkInMsFromShift(b) - checkInMsFromShift(a));
  const top = rows[0];
  const shiftId = String(top.id || '').trim();
  if (!shiftId) return null;

  return {
    shiftId,
    employeeId: String(top.employeeId || '').trim(),
    employeeName: String(top.employeeName || 'Guardia').trim(),
    checkInMs: checkInMsFromShift(top),
  };
}

export type ApplyAutoRetentionResult = {
  applied: boolean;
  pick: RetentionPickResult;
  skippedReason?: string;
};

/**
 * Marca retención obligatoria en el guardia presente (último fichaje en el puesto).
 * Idempotente por par shiftId + absenceShiftId.
 */
export async function applyAutoRetentionForGap(
  db: Firestore,
  absenceShift: Record<string, unknown>,
  processedData: unknown[],
  empresaId: string,
): Promise<ApplyAutoRetentionResult> {
  const pick = pickRetentionShiftForGap(processedData, absenceShift);
  if (!pick) {
    return { applied: false, pick: null, skippedReason: 'NO_PRESENT_AT_POSITION' };
  }

  const absenceShiftId = String(absenceShift.id || '').trim();
  const gapEnd = toDate(absenceShift.endDateObj ?? absenceShift.endTime);

  const shiftRef = doc(db, 'turnos', pick.shiftId);
  const existingRetention = await getDocs(
    query(
      collection(db, 'turnos'),
      where('retentionAbsenceShiftId', '==', absenceShiftId),
      where('isRetention', '==', true),
      limit(5),
    ),
  );
  if (absenceShiftId && !existingRetention.empty) {
    const already = existingRetention.docs.find((d) => d.id === pick.shiftId);
    if (already) {
      return { applied: false, pick, skippedReason: 'ALREADY_RETAINED_FOR_ABSENCE' };
    }
  }

  const batch = writeBatch(db);
  batch.update(shiftRef, {
    isRetention: true,
    retentionReason: 'AUSENCIA_RELEVO',
    retentionKind: 'AUSENCIA_RELEVO',
    retentionAbsenceShiftId: absenceShiftId || null,
    autoRetentionAt: serverTimestamp(),
    retentionEndTime: Timestamp.fromDate(gapEnd),
  });

  if (absenceShiftId) {
    const novQ = query(
      collection(db, 'novedades'),
      where('absenceShiftId', '==', absenceShiftId),
      where('type', '==', 'RETENCION_AUSENCIA_RELEVO'),
      limit(1),
    );
    const novSnap = await getDocs(novQ);
    if (novSnap.empty) {
      const novRef = doc(collection(db, 'novedades'));
      batch.set(
        novRef,
        stampEmpresaId(
          {
            type: 'RETENCION_AUSENCIA_RELEVO',
            status: 'pending',
            title: 'Retención por ausencia de relevo',
            employeeId: pick.employeeId,
            employeeName: pick.employeeName,
            shiftId: pick.shiftId,
            absenceShiftId,
            objectiveId: absenceShift.objectiveId || null,
            objectiveName: absenceShift.objectiveName || '',
            positionName: absenceShift.positionName || '',
            description: `${pick.employeeName} retenido (último en puesto) por ausencia de ${absenceShift.employeeName || 'relevo'} hasta cobertura del hueco.`,
            createdAt: serverTimestamp(),
            reportedBy: 'OPERACIONES',
          },
          empresaId,
        ),
      );
    }
  }

  await batch.commit();
  return { applied: true, pick };
}
