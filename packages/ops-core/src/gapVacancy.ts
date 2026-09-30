import { reliefPositionsMatch, seriesBoundMs, seriesCodeOf } from './shiftSeries';

/** Un planificado cubre la franja SLA si arranca a ±30 min, mismo puesto y misma serie. */
export const SLA_BAND_COVER_ALIGN_MS = 30 * 60 * 1000;

export function plannedShiftCoversSlaBand(
  shift: Record<string, unknown> | null | undefined,
  band: { positionName?: unknown; code?: unknown; startMs: number },
): boolean {
  if (!shift) return false;
  if (shift.draft === true || shift.isFranco === true) return false;
  if (shift.isAbsent === true || shift.isUnassigned === true) return false;
  const eid = String(shift.employeeId || '').trim();
  if (!eid || eid === 'VACANTE') return false;
  const pos = shift.coversPositionName || shift.positionName;
  if (!reliefPositionsMatch(pos, band.positionName)) return false;
  const shiftSeries = seriesCodeOf(shift);
  const bandSeries = seriesCodeOf({ code: band.code });
  if (!shiftSeries || !bandSeries || shiftSeries !== bandSeries) return false;
  const start = seriesBoundMs(shift, 'start');
  if (!start || !band.startMs) return false;
  return Math.abs(start - band.startMs) <= SLA_BAND_COVER_ALIGN_MS;
}

/** Docs hermanos de un hueco (no son la representación canónica). */
const SIBLING_ORIGINS = new Set([
  'VACANTE_POR_AUSENCIA',
  'SLA_VIRTUAL',
  'SLA_UNPLANNED_GAP',
]);

export function isGapSiblingVacancyDoc(s: {
  id?: string;
  origin?: unknown;
  status?: unknown;
  causedByShiftId?: unknown;
} | null | undefined): boolean {
  if (!s) return false;
  const st = String(s.status || '').toUpperCase();
  if (st === 'SUPERSEDED') return true;
  const origin = String(s.origin || '').toUpperCase();
  if (SIBLING_ORIGINS.has(origin)) return true;
  const id = String(s.id || '');
  if (id.startsWith('autodev_') || id.startsWith('autosinc_')) return true;
  return false;
}

/** Titular AA / recortado que representa el hueco (una sola fila). */
export function isCanonicalGapTitular(s: {
  isAbsent?: unknown;
  interrupted?: unknown;
  operacionallyCovered?: unknown;
  plannedOperativelyCovered?: unknown;
  coverageStatus?: unknown;
  isFranco?: unknown;
} | null | undefined): boolean {
  if (!s) return false;
  if (s.isFranco === true) return false;
  const covered =
    s.operacionallyCovered === true
    || s.plannedOperativelyCovered === true
    || String(s.coverageStatus || '').toUpperCase() === 'COVERED';
  if (covered) return false;
  if (s.isAbsent === true) return true;
  if (s.interrupted === true) return true;
  return false;
}

export function buildSlaUnplannedGapDocId(params: {
  empresaId: string;
  objectiveId: string;
  positionName: string;
  dayYmd: string;
  bandCode: string;
}): string {
  const normPos = String(params.positionName ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return `gap_${params.empresaId}_${params.objectiveId}_${normPos}_${params.dayYmd}_${String(params.bandCode || '').toUpperCase()}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
}
