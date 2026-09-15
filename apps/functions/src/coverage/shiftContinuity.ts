/**
 * Espejo Admin SDK de apps/web2/src/lib/operaciones/shiftContinuity.ts
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type ContinuityDecision =
  | { action: 'RETAIN'; reason: string }
  | { action: 'AUTO_CLOSE'; reason: string };

export function hasTuraOrExtension(shift: Record<string, any>): boolean {
  if (shift.isExtended === true) return true;
  if (shift.retentionEndTime) return true;
  const code = String(shift.code || '').toUpperCase();
  if (code === 'D12' || code === 'N12' || code === 'TURA') return true;
  if (String(shift.extendedBy || '') === 'CONVOCATORIA' || String(shift.extendedBy || '') === 'TURA') return true;
  return false;
}

export function employeeHasPosteriorShift(params: {
  employeeId: string;
  objectiveId: string;
  currentShiftId: string;
  currentEndMs: number;
  dayShifts: Array<Record<string, any> & { id: string }>;
}): boolean {
  const { employeeId, objectiveId, currentShiftId, currentEndMs, dayShifts } = params;
  if (!employeeId || !objectiveId || !currentEndMs) return false;
  const skipCodes = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'AA', 'PG', 'SUS']);

  for (const s of dayShifts) {
    if (s.id === currentShiftId) continue;
    if (String(s.employeeId || '') !== employeeId) continue;
    if (String(s.objectiveId || '') !== objectiveId) continue;
    if (s.isFranco) continue;
    const code = String(s.code || '').toUpperCase();
    if (skipCodes.has(code)) continue;
    const startMs = s.startTime?.toMillis?.() ?? (s.startTime?.seconds ? s.startTime.seconds * 1000 : 0);
    if (startMs > currentEndMs - 5 * 60 * 1000) return true;
  }
  return false;
}

export function decideShiftCloseOrRetain(params: {
  shift: Record<string, any>;
  requiresContinuousCoverage24h: boolean;
  hasPosteriorShift: boolean;
}): ContinuityDecision {
  const { shift, requiresContinuousCoverage24h, hasPosteriorShift } = params;
  if (requiresContinuousCoverage24h) {
    return { action: 'RETAIN', reason: 'CONTINUIDAD_24HS' };
  }
  if (hasPosteriorShift) {
    return { action: 'RETAIN', reason: 'TURNO_POSTERIOR_MISMO_OBJETIVO' };
  }
  if (hasTuraOrExtension(shift)) {
    return { action: 'RETAIN', reason: 'EXTENSION_TURA_ACTIVA' };
  }
  return { action: 'AUTO_CLOSE', reason: 'SIN_POSTERIOR_NI_EXTENSION' };
}

export function vacancyCoverageLabel(params: {
  titularName?: string | null;
  shiftCode?: string | null;
  positionName?: string | null;
  objectiveName?: string | null;
  timeRange?: string | null;
}): string {
  const who = String(params.titularName || '').trim() || 'titular';
  const code = String(params.shiftCode || '').trim().toUpperCase() || '—';
  const pos = String(params.positionName || '').trim();
  const obj = String(params.objectiveName || '').trim();
  const tr = String(params.timeRange || '').trim();
  return [
    `Vacante por ausencia de ${who}`,
    `turno ${code}`,
    pos ? `puesto ${pos}` : '',
    obj || '',
    tr || '',
  ].filter(Boolean).join(' · ');
}

/** Solo RET = stand-by pasivo: no ficha hasta convertirse al turno real del hueco. */
export function isPassiveStandbyCode(code: unknown): boolean {
  return String(code || '').toUpperCase() === 'RET';
}

/** RET / ESC / REF se pueden redirigir al hueco (comodines de cascada). */
export function isCoverageRedirectableCode(code: unknown): boolean {
  const c = String(code || '').toUpperCase();
  return c === 'RET' || c === 'ESC' || c === 'REF';
}

/** ¿Ya hay ledger de cobertura aunque el `code` siga siendo RET/ESC/REF (dato inconsistente)? */
export function hasCoverageLedgerWithoutRealCode(shift: Record<string, any>): boolean {
  if (!isCoverageRedirectableCode(shift?.code)) return false;
  if (String(shift?.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return true;
  if (shift?.coversAbsenceEmployeeName || shift?.absenceEmployeeName) return true;
  if (shift?.absenceShiftId || shift?.coveredShiftId) return true;
  if (shift?.coverageEventId && shift?.previousPassiveCode) return true;
  return false;
}

export function buildReassignPassiveToVacancyFields(
  vacancy: Record<string, any>,
  opts: {
    coverageType: string;
    resolvedBy?: string;
    previousCode?: string;
    previousPositionName?: string | null;
    coverageEventId?: string;
  },
): Record<string, unknown> {
  const prev = String(opts.previousCode || opts.coverageType).toUpperCase();
  const gapPos = vacancy.positionName || null;
  return {
    code: String(vacancy.code || vacancy.shiftCode || 'M').toUpperCase(),
    objectiveId: vacancy.objectiveId || null,
    objectiveName: vacancy.objectiveName || null,
    clientId: vacancy.clientId || null,
    clientName: vacancy.clientName || null,
    positionName: gapPos,
    startTime: vacancy.startTime || null,
    endTime: vacancy.endTime || null,
    plannedStartTime: vacancy.startTime || null,
    plannedEndTime: vacancy.endTime || null,
    isReten: false,
    isFranco: false,
    origin: 'OPERATIONS_COVERAGE',
    coverageType: opts.coverageType,
    previousPassiveCode: prev,
    ...(opts.previousPositionName
      ? {
          previousPositionName: opts.previousPositionName,
          homePositionName: opts.previousPositionName,
          coversPositionName: gapPos,
        }
      : {}),
    reassignedFromPassiveAt: FieldValue.serverTimestamp(),
    resolvedBy: opts.resolvedBy || 'AUTO',
    ...(opts.coverageEventId ? { coverageEventId: opts.coverageEventId } : {}),
  };
}

export function toTimestampMs(t: unknown): number {
  if (!t) return 0;
  if (t instanceof Timestamp) return t.toMillis();
  if (typeof (t as any).toMillis === 'function') return (t as any).toMillis();
  if (typeof (t as any).seconds === 'number') return (t as any).seconds * 1000;
  return 0;
}
