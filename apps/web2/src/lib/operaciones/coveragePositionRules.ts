/**
 * Reglas compartidas Ops/Planificación para redirección de puesto y traslado.
 * - Otro puesto (mismo obj): solo si quedan ≥2 presentes en el puesto origen (mismo turno).
 * - Traslado cross-objetivo: solo si distancia entre objetivos ≤ CROSS_OBJ_MAX_KM.
 */

export const CROSS_OBJ_MAX_KM = 10;

export function normCoveragePositionName(p: unknown): string {
  return String(p || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Distancia haversine en km. Sin coords → Infinity. */
export function coverageHaversineKm(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined,
): number {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const a = Number(lat1);
  const b = Number(lon1);
  const c = Number(lat2);
  const d = Number(lon2);
  if (![a, b, c, d].every((n) => Number.isFinite(n))) return Infinity;
  const R = 6371;
  const dLat = ((c - a) * Math.PI) / 180;
  const dLon = ((d - b) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export type PresentShiftSlice = {
  id?: string;
  employeeId?: string;
  objectiveId?: string;
  positionName?: string;
  isPresent?: boolean;
  isCompleted?: boolean;
  isAbsent?: boolean;
  isFranco?: boolean;
  isUnassigned?: boolean;
  shiftDateObj?: Date | { seconds?: number } | string | null;
  endDateObj?: Date | { seconds?: number } | string | null;
  startTime?: { seconds?: number } | Date | null;
  endTime?: { seconds?: number } | Date | null;
};

function toMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (v as { toDate: () => Date }).toDate().getTime();
    } catch {
      return 0;
    }
  }
  if (typeof (v as { seconds?: number }).seconds === 'number') {
    return (v as { seconds: number }).seconds * 1000;
  }
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Misma jornada calendario (AR aproximada por fecha local del start). */
function sameCalendarDay(a: unknown, b: unknown): boolean {
  const am = toMs(a);
  const bm = toMs(b);
  if (!am || !bm) return true; // sin fecha → no excluir por día
  const da = new Date(am);
  const db = new Date(bm);
  return (
    da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
  );
}

function isActivePresent(sh: PresentShiftSlice): boolean {
  if (!sh?.employeeId || sh.employeeId === 'VACANTE') return false;
  if (sh.isUnassigned || sh.isAbsent || sh.isFranco || sh.isCompleted) return false;
  return sh.isPresent === true;
}

/**
 * Cantidad de presentes en el mismo objetivo + puesto (mismo día del turno origen).
 * Incluye al propio candidato.
 */
export function countPresentInPosition(
  shifts: PresentShiftSlice[],
  objectiveId: string,
  positionName: string,
  dayAnchor?: unknown,
): number {
  const oid = String(objectiveId || '').trim();
  const pos = normCoveragePositionName(positionName);
  if (!oid || !pos) return 0;
  return shifts.filter((sh) => {
    if (!isActivePresent(sh)) return false;
    if (String(sh.objectiveId || '').trim() !== oid) return false;
    if (normCoveragePositionName(sh.positionName) !== pos) return false;
    if (dayAnchor != null) {
      const anchor = sh.shiftDateObj || sh.startTime;
      if (anchor && !sameCalendarDay(anchor, dayAnchor)) return false;
    }
    return true;
  }).length;
}

/**
 * Otro puesto / Traslado: se puede sacar a este presente sin dejar el puesto origen vacío.
 * Regla: ≥ 2 presentes en ese puesto el mismo día → al mover 1 queda ≥ 1.
 */
export function canSparePresentFromPosition(
  shifts: PresentShiftSlice[],
  sourceShift: PresentShiftSlice,
): boolean {
  const oid = String(sourceShift.objectiveId || '').trim();
  const pos = String(sourceShift.positionName || '').trim();
  if (!oid || !pos) return false;
  const day = sourceShift.shiftDateObj || sourceShift.startTime;
  return countPresentInPosition(shifts, oid, pos, day) >= 2;
}

export function isWithinCrossObjRadiusKm(distanceKm: number, maxKm = CROSS_OBJ_MAX_KM): boolean {
  return Number.isFinite(distanceKm) && distanceKm <= maxKm;
}
