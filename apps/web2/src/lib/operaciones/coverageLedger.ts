/**
 * Ledger mínimo de cobertura Ops ↔ Plan ↔ RRHH.
 * Un coverageEventId une: vacante + turno titular ausente + turno del cubridor.
 */
import { doc, serverTimestamp, type WriteBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type CoverageLedgerInput = {
  /** Doc VACANTE_* real (no V124_/SLA_GAP virtual). */
  vacancyShiftId?: string | null;
  /** Turno del titular ausente (causedByShiftId o el propio ausente). */
  titularShiftId?: string | null;
  /** Turno del cubridor que se actualiza (RET/FT/redirigido). Null si se crea después. */
  covererShiftId?: string | null;
  covererEmployeeId: string;
  covererEmployeeName: string;
  titularEmployeeId?: string | null;
  titularEmployeeName?: string | null;
  coverageType: string;
  /** Mantener isAbsent en titular (no poner status COVERED en ausente). */
  titularIsAbsence?: boolean;
  resolvedBy?: string;
  /** Si ya hay eventId (reintento), reutilizarlo. */
  coverageEventId?: string | null;
};

const isVirtualShiftId = (id: unknown): boolean => {
  const s = String(id || '');
  return !s || s.startsWith('V124_') || s.startsWith('SLA_GAP');
};

export function newCoverageEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cov_${crypto.randomUUID()}`;
  }
  return `cov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Titular real detrás de una vacante por ausencia o del propio turno ausente. */
export function resolveTitularFromAbsenceOrVacancy(absenceShift: any): {
  titularShiftId: string | null;
  titularEmployeeId: string | null;
  titularEmployeeName: string;
  vacancyShiftId: string | null;
} {
  const caused = absenceShift?.causedByShiftId && !isVirtualShiftId(absenceShift.causedByShiftId)
    ? String(absenceShift.causedByShiftId)
    : null;
  const isVac =
    absenceShift?.isUnassigned === true
    || absenceShift?.employeeId === 'VACANTE'
    || String(absenceShift?.employeeName || '').toUpperCase().startsWith('VACANTE')
    || String(absenceShift?.origin || '').toUpperCase().startsWith('VACANTE_');

  const vacancyShiftId =
    isVac && absenceShift?.id && !isVirtualShiftId(absenceShift.id) && !absenceShift?.isVirtual
      ? String(absenceShift.id)
      : null;

  const titularShiftId = caused
    || (!isVac && absenceShift?.id && !isVirtualShiftId(absenceShift.id) ? String(absenceShift.id) : null);

  const titularEmployeeId =
    (absenceShift?.causedByEmployeeId && absenceShift.causedByEmployeeId !== 'VACANTE'
      ? String(absenceShift.causedByEmployeeId)
      : null)
    || (!isVac && absenceShift?.employeeId && absenceShift.employeeId !== 'VACANTE'
      ? String(absenceShift.employeeId)
      : null);

  const titularEmployeeName = String(
    absenceShift?.causedByEmployeeName
    || (!isVac && absenceShift?.employeeName && !String(absenceShift.employeeName).toUpperCase().startsWith('VACANTE')
      ? absenceShift.employeeName
      : '')
    || '',
  ).trim();

  return { titularShiftId, titularEmployeeId, titularEmployeeName, vacancyShiftId };
}

/** Campos a mergear en el turno del cubridor. */
export function covererLedgerFields(input: CoverageLedgerInput & { coverageEventId: string }): Record<string, unknown> {
  const titularName = String(input.titularEmployeeName || '').trim();
  return {
    coverageEventId: input.coverageEventId,
    coversEmployeeId: input.titularEmployeeId || null,
    coversAbsenceEmployeeName: titularName || null,
    absenceShiftId: input.vacancyShiftId || input.titularShiftId || null,
    causedByShiftId: input.titularShiftId || null,
    coverageType: input.coverageType,
    resolvedBy: input.resolvedBy || 'OPERACIONES',
    coveredAt: serverTimestamp(),
    comments: titularName
      ? `Cubriendo a ${titularName} (${input.coverageType})`
      : `Cobertura ${input.coverageType}`,
  };
}

/** Campos en vacante y/o titular ausente (lado “cubierto por”). */
export function coveredPartyLedgerFields(
  input: CoverageLedgerInput & { coverageEventId: string },
  kind: 'vacancy' | 'titular',
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    coverageEventId: input.coverageEventId,
    coveredByEmployeeId: input.covererEmployeeId,
    coveredByEmployeeName: input.covererEmployeeName,
    coverageType: input.coverageType,
    resolvedBy: input.resolvedBy || 'OPERACIONES',
    coveredAt: serverTimestamp(),
    operacionallyCovered: true,
  };
  if (kind === 'vacancy') {
    base.status = 'COVERED';
  } else if (!input.titularIsAbsence) {
    // titular no-ausencia (solo slot) puede marcarse COVERED; ausente conserva isAbsent
  }
  return base;
}

/**
 * Escribe el ledger en batch: vacante + titular + cubridor (si hay id).
 * Devuelve coverageEventId usado.
 */
export function applyCoverageLedgerToBatch(
  batch: WriteBatch,
  input: CoverageLedgerInput,
): string {
  const coverageEventId = input.coverageEventId || newCoverageEventId();
  const payload = { ...input, coverageEventId };

  if (input.vacancyShiftId && !isVirtualShiftId(input.vacancyShiftId)) {
    batch.update(doc(db, 'turnos', input.vacancyShiftId), coveredPartyLedgerFields(payload, 'vacancy'));
  }

  if (input.titularShiftId && !isVirtualShiftId(input.titularShiftId) && input.titularShiftId !== input.vacancyShiftId) {
    batch.update(doc(db, 'turnos', input.titularShiftId), coveredPartyLedgerFields(payload, 'titular'));
  }

  if (input.covererShiftId && !isVirtualShiftId(input.covererShiftId)) {
    batch.update(doc(db, 'turnos', input.covererShiftId), covererLedgerFields(payload));
  }

  return coverageEventId;
}
