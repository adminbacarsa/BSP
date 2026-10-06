/**
 * Espejo de packages/ops-core/src/retShift.ts (Functions no importa el package).
 * RET planificado = retención pasiva. No depende de `isReten`.
 */

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function fold(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function boundMs(value: unknown): number {
  if (value == null || value === '') return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') {
    const o = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === 'function') {
      const t = o.toMillis();
      return Number.isFinite(t) ? t : 0;
    }
    const sec = o.seconds ?? o._seconds;
    if (typeof sec === 'number') return sec * 1000;
  }
  return 0;
}

/** Identidad del stand-by: código, flag viejo, puesto/tipo «Retén» o pool sin cobertura. */
export function isRetShift(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift) return false;
  if (upper(shift.code) === 'RET' || upper(shift.shiftCode) === 'RET' || upper(shift.type) === 'RET') return true;
  if (shift.isReten === true) return true;
  if (fold(shift.positionName) === 'reten' || fold(shift.type) === 'reten') return true;
  if (upper(shift.deploymentRole) === 'POOL' && shift.countsForCoverage === false) return true;
  return false;
}

/** start = end (p. ej. 00:00–00:00). No es una jornada: no hay llegada ni ausencia. */
export function isZeroDurationShift(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift) return false;
  const start = boundMs(shift.startTime) || boundMs(shift.shiftDateObj);
  const end = boundMs(shift.endTime) || boundMs(shift.endDateObj);
  return start > 0 && end > 0 && start === end;
}
