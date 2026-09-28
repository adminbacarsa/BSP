/**
 * Subconjunto usado por planningScheduledHours (coalesce completo vive en positionCoverageUnits web2).
 */

export const PLANNING_NON_BILLABLE_CODES = new Set([
  'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'REF', 'ESC', 'SUS', 'SGS', 'EV',
]);

export function normalizePlanningPositionName(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');
}
