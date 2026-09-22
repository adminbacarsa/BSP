const FRANCO_REST_CODES = new Set(['F', 'FF', 'FP']);

const getShiftStartDate = (sh: any): Date | null => {
  if (!sh) return null;
  if (sh.shiftDateObj instanceof Date) return sh.shiftDateObj;
  const raw = sh.startTime ?? sh.shiftDateObj;
  if (!raw) return null;
  try {
    if (raw.toDate) return raw.toDate();
    if (raw.seconds) return new Date(raw.seconds * 1000);
    return new Date(raw);
  } catch {
    return null;
  }
};

export const isCoverageSameDay = (shiftLike: any, now: Date): boolean => {
  const d = getShiftStartDate(shiftLike);
  if (!d || Number.isNaN(d.getTime())) return false;
  return d.toLocaleDateString('en-CA') === now.toLocaleDateString('en-CA');
};

const isVirtualVacancyRow = (sh: any): boolean => {
  if (sh.isVirtual !== true) return false;
  const id = String(sh.id || '');
  if (id.startsWith('V124_') || id.startsWith('SLA_GAP')) return true;
  const eid = String(sh.employeeId || '').trim();
  return !eid || eid === 'VACANTE' || sh.isUnassigned === true;
};

const isDraftOrDeleted = (sh: any): boolean =>
  sh?.draft === true || sh?.isDeleted === true;

/** Franco de descanso (F/FF/FP), no FT ni convocado. */
export const isRestFrancoShiftRow = (sh: any): boolean => {
  if (!sh || sh.isFrancoTrabajado) return false;
  const code = String(sh.code || sh.type || '').toUpperCase();
  if (FRANCO_REST_CODES.has(code)) return true;
  if (sh.isFrancoCompensatorio) return true;
  if (sh.isFranco || sh.objectiveName === 'FRANCO') return true;
  return false;
};

const addEmployeeIdsFromShift = (sh: any, out: Set<string>) => {
  const eid = String(sh.employeeId || '').trim();
  if (eid && eid !== 'VACANTE') out.add(eid);
  const parent = String(sh.parentEmpleadoId || '').trim();
  if (parent && parent !== 'VACANTE') out.add(parent);
};

/**
 * Empleados con al menos una celda/turno hoy (malla o Firestore crudo):
 * M/T/N, F/FF/FP, RET, ESC, V/L, etc. Usar rawShifts + processedData.
 */
export function buildEmployeesAssignedToday(
  rawShifts: any[] | undefined,
  processedData: any[] | undefined,
  now: Date,
): Set<string> {
  const out = new Set<string>();
  const consider = (sh: any) => {
    if (isDraftOrDeleted(sh)) return;
    if (!isCoverageSameDay(sh, now)) return;
    if (isVirtualVacancyRow(sh)) return;
    if (sh.status === 'COVERED') {
      const eid = String(sh.employeeId || '').trim();
      if (!eid || eid === 'VACANTE') return;
    }
    addEmployeeIdsFromShift(sh, out);
  };
  for (const sh of rawShifts ?? []) consider(sh);
  for (const sh of processedData ?? []) consider(sh);
  return out;
}

/** Filas de franco hoy (processed + raw no duplicadas por employeeId). */
export function collectFrancoShiftRowsToday(
  rawShifts: any[] | undefined,
  processedData: any[] | undefined,
  now: Date,
): any[] {
  const byEmp = new Map<string, any>();
  const ingest = (sh: any) => {
    if (isDraftOrDeleted(sh)) return;
    if (!isCoverageSameDay(sh, now)) return;
    if (isVirtualVacancyRow(sh)) return;
    if (!isRestFrancoShiftRow(sh)) return;
    if (sh.isFrancoTrabajado) return;
    const code = String(sh.code || sh.type || '').toUpperCase();
    if (code === 'FT') return;
    const eid = String(sh.employeeId || '').trim();
    if (!eid || eid === 'VACANTE') return;
    if (!byEmp.has(eid)) byEmp.set(eid, sh);
  };
  for (const sh of processedData ?? []) ingest(sh);
  for (const sh of rawShifts ?? []) ingest(sh);
  return [...byEmp.values()];
}
