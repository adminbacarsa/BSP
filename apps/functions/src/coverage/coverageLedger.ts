/**
 * Ledger de cobertura (Admin SDK) — espejo de apps/web2/src/lib/operaciones/coverageLedger.ts
 * Un coverageEventId une vacante + titular ausente + cubridor.
 */
import { FieldValue, type WriteBatch } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';

export type CoverageLedgerInput = {
  vacancyShiftId?: string | null;
  titularShiftId?: string | null;
  covererShiftId?: string | null;
  covererEmployeeId: string;
  covererEmployeeName: string;
  titularEmployeeId?: string | null;
  titularEmployeeName?: string | null;
  coverageType: string;
  titularIsAbsence?: boolean;
  resolvedBy?: string;
  coverageEventId?: string | null;
  vacancyExtra?: Record<string, unknown>;
  covererExtra?: Record<string, unknown>;
  /** False cuando se reescribe el doc VACANTE con el empleado cubridor. */
  markVacancyCovered?: boolean;
  /** Conservar causedByShiftId al convertir vacante en turno del cubridor. */
  causedByShiftIdPreserve?: string | null;
};

const isVirtualShiftId = (id: unknown): boolean => {
  const s = String(id || '');
  return !s || s.startsWith('V124_') || s.startsWith('SLA_GAP');
};

export function newCoverageEventId(): string {
  try {
    return `cov_${randomUUID()}`;
  } catch {
    return `cov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function resolveTitularFromAbsenceOrVacancy(absenceShift: any & { id?: string }): {
  titularShiftId: string | null;
  titularEmployeeId: string | null;
  titularEmployeeName: string;
  vacancyShiftId: string | null;
} {
  const causedRaw =
    absenceShift?.causedByShiftId
    || absenceShift?.originRef // legacy INTERRUPTION
    || null;
  const caused = causedRaw && !isVirtualShiftId(causedRaw) ? String(causedRaw) : null;
  const originUp = String(absenceShift?.origin || '').toUpperCase();
  const isVac =
    absenceShift?.isUnassigned === true
    || absenceShift?.employeeId === 'VACANTE'
    || String(absenceShift?.employeeName || '').toUpperCase().startsWith('VACANTE')
    || originUp.startsWith('VACANTE_')
    || originUp === 'INTERRUPTION';

  const vacancyShiftId =
    isVac && absenceShift?.id && !isVirtualShiftId(absenceShift.id) && !absenceShift?.isVirtual
      ? String(absenceShift.id)
      : null;

  const titularShiftId =
    caused
    || (!isVac && absenceShift?.id && !isVirtualShiftId(absenceShift.id)
      ? String(absenceShift.id)
      : null);

  const titularEmployeeId =
    (absenceShift?.causedByEmployeeId && absenceShift.causedByEmployeeId !== 'VACANTE'
      ? String(absenceShift.causedByEmployeeId)
      : null)
    || (!isVac && absenceShift?.employeeId && absenceShift.employeeId !== 'VACANTE'
      ? String(absenceShift.employeeId)
      : null);

  const titularEmployeeName = String(
    absenceShift?.causedByEmployeeName
    || (!isVac
      && absenceShift?.employeeName
      && !String(absenceShift.employeeName).toUpperCase().startsWith('VACANTE')
      ? absenceShift.employeeName
      : '')
    || '',
  ).trim();

  return { titularShiftId, titularEmployeeId, titularEmployeeName, vacancyShiftId };
}

export function covererLedgerFields(
  input: CoverageLedgerInput & { coverageEventId: string },
): Record<string, unknown> {
  const titularName = String(input.titularEmployeeName || '').trim();
  return {
    coverageEventId: input.coverageEventId,
    coversEmployeeId: input.titularEmployeeId || null,
    coversAbsenceEmployeeName: titularName || null,
    absenceShiftId: input.vacancyShiftId || input.titularShiftId || null,
    causedByShiftId: input.titularShiftId || input.causedByShiftIdPreserve || null,
    coverageType: input.coverageType,
    resolvedBy: input.resolvedBy || 'AUTO',
    coveredAt: FieldValue.serverTimestamp(),
    comments: titularName
      ? `Cubriendo a ${titularName} (${input.coverageType})`
      : `Cobertura ${input.coverageType}`,
    ...(input.covererExtra || {}),
  };
}

export function coveredPartyLedgerFields(
  input: CoverageLedgerInput & { coverageEventId: string },
  kind: 'vacancy' | 'titular',
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    coverageEventId: input.coverageEventId,
    coveredByEmployeeId: input.covererEmployeeId,
    coveredByEmployeeName: input.covererEmployeeName,
    coverageType: input.coverageType,
    resolvedBy: input.resolvedBy || 'AUTO',
    coveredAt: FieldValue.serverTimestamp(),
    operacionallyCovered: true,
    ...(kind === 'vacancy' ? input.vacancyExtra || {} : {}),
  };
  if (kind === 'vacancy' && input.markVacancyCovered !== false) {
    base.status = 'COVERED';
  }
  return base;
}

export function applyCoverageLedgerToBatch(
  batch: WriteBatch,
  db: admin.firestore.Firestore,
  input: CoverageLedgerInput,
): string {
  const coverageEventId = input.coverageEventId || newCoverageEventId();
  const payload = { ...input, coverageEventId };

  if (input.vacancyShiftId && !isVirtualShiftId(input.vacancyShiftId)) {
    batch.update(
      db.collection('turnos').doc(input.vacancyShiftId),
      coveredPartyLedgerFields(payload, 'vacancy'),
    );
  }

  if (
    input.titularShiftId
    && !isVirtualShiftId(input.titularShiftId)
    && input.titularShiftId !== input.vacancyShiftId
  ) {
    batch.update(
      db.collection('turnos').doc(input.titularShiftId),
      coveredPartyLedgerFields(payload, 'titular'),
    );
  }

  if (input.covererShiftId && !isVirtualShiftId(input.covererShiftId)) {
    batch.update(
      db.collection('turnos').doc(input.covererShiftId),
      covererLedgerFields(payload),
    );
  }

  return coverageEventId;
}
