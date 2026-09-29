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
import { outgoingFor } from '@cosp/ops-core';
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

function shiftBoundMs(shift: Record<string, unknown>, kind: 'start' | 'end'): number {
  const objKey = kind === 'start' ? 'shiftDateObj' : 'endDateObj';
  const rawKey = kind === 'start' ? 'startTime' : 'endTime';
  const obj = shift[objKey];
  if (obj instanceof Date && !Number.isNaN(obj.getTime())) return obj.getTime();
  const raw = shift[rawKey];
  if (!raw) return 0;
  const d = toDate(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Retenido = presente de la serie que TERMINA cuando empieza el hueco
 * (fin ±30 min, mismo puesto). Si el código no es serie, queda el horario.
 * Quien arranca a esa hora o está a mitad de turno no entra.
 */
export function pickRetentionShiftForGap(
  processedData: unknown[],
  absenceShift: Record<string, unknown>,
): RetentionPickResult {
  const objectiveId = String(absenceShift.objectiveId || '').trim();
  const gapStart = shiftBoundMs(absenceShift, 'start');
  if (!objectiveId || !gapStart) return null;
  const absentEmp = String(absenceShift.employeeId || '').trim();

  const rows = ((processedData || []) as Record<string, unknown>[]).filter((sh) => {
    if (!sh.isPresent || sh.isCompleted || sh.isAbsent) return false;
    if (String(sh.objectiveId || '').trim() !== objectiveId) return false;
    if (sh.isVirtual === true) return false;
    const eid = String(sh.employeeId || '').trim();
    if (!eid || eid === 'VACANTE' || (absentEmp && eid === absentEmp)) return false;
    return true;
  });
  if (!rows.length) return null;

  const winner = outgoingFor(
    { ...absenceShift, startMs: gapStart },
    rows.map((sh) => ({
      ...sh,
      id: String(sh.id || ''),
      startMs: shiftBoundMs(sh, 'start'),
      endMs: shiftBoundMs(sh, 'end'),
      checkInMs: checkInMsFromShift(sh),
    })),
  );
  const shiftId = String(winner?.id || '').trim();
  if (!winner || !shiftId) return null;

  return {
    shiftId,
    employeeId: String(winner.employeeId || '').trim(),
    employeeName: String(winner.employeeName || 'Guardia').trim(),
    checkInMs: checkInMsFromShift(winner),
  };
}

export type ApplyAutoRetentionResult = {
  applied: boolean;
  pick: RetentionPickResult;
  skippedReason?: string;
};

/**
 * Marca retención en el saliente que termina cuando empieza el hueco.
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
            description: `${pick.employeeName} retenido (saliente) por ausencia de ${absenceShift.employeeName || 'relevo'} hasta cobertura del hueco.`,
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
