/** Radio CCT / convocatoria (backend eligibilityFilter: 15 km). */
export const COVERAGE_RADIUS_PRIMARY_KM = 15;
/** Segunda vista manual cuando no hay nadie ≤15 km. */
export const COVERAGE_RADIUS_EXTENDED_KM = 30;
/** Estimación urbana auto (km/h) — traslado al objetivo. */
export const COVERAGE_AUTO_SPEED_KMH = 30;

export type CoverageGeoFields = {
  distanceKm: number | null;
  etaMinutes: number | null;
  hasGeo: boolean;
};

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number | null {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return null;
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLon / 2)
    * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Minutos aprox. en auto (referencia operativa, no Google Directions). */
export function estimateAutoTravelMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  return Math.max(1, Math.round((distanceKm / COVERAGE_AUTO_SPEED_KMH) * 60));
}

export function resolveObjectiveCoords(absenceShift: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
} {
  const lat = Number(absenceShift.lat ?? absenceShift.objectiveLat);
  const lng = Number(absenceShift.lng ?? absenceShift.objectiveLng);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

export function coverageGeoForEmployee(
  absenceShift: Record<string, unknown>,
  employee: Record<string, unknown> | undefined,
  shiftRow?: Record<string, unknown>,
): CoverageGeoFields {
  const { lat: oLat, lng: oLng } = resolveObjectiveCoords(absenceShift);
  if (oLat == null || oLng == null) {
    return { distanceKm: null, etaMinutes: null, hasGeo: false };
  }

  const sameObjective =
    shiftRow
    && String(shiftRow.objectiveId || '') === String(absenceShift.objectiveId || '')
    && shiftRow.isPresent === true
    && shiftRow.isCompleted !== true;

  if (sameObjective) {
    return { distanceKm: 0, etaMinutes: 0, hasGeo: true };
  }

  const lat = Number(employee?.lat);
  const lng = Number(employee?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { distanceKm: null, etaMinutes: null, hasGeo: false };
  }

  const km = haversineKm(lat, lng, oLat, oLng);
  if (km == null) {
    return { distanceKm: null, etaMinutes: null, hasGeo: false };
  }
  return {
    distanceKm: km,
    etaMinutes: estimateAutoTravelMinutes(km),
    hasGeo: true,
  };
}

export function withinCoverageRadius(
  geo: CoverageGeoFields,
  maxKm: number,
): boolean {
  if (geo.distanceKm == null) return true;
  return geo.distanceKm <= maxKm;
}

export function sortByDistanceAsc<T extends CoverageGeoFields>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const da = a.distanceKm ?? 99999;
    const db = b.distanceKm ?? 99999;
    return da - db;
  });
}

export function filterByCoverageRadius<T extends CoverageGeoFields>(
  list: T[],
  maxKm: number,
): T[] {
  return list.filter((c) => withinCoverageRadius(c, maxKm));
}

export function countBeyondPrimaryWithinExtended<T extends CoverageGeoFields>(
  list: T[],
): number {
  return list.filter(
    (c) =>
      c.distanceKm != null
      && c.distanceKm > COVERAGE_RADIUS_PRIMARY_KM
      && c.distanceKm <= COVERAGE_RADIUS_EXTENDED_KM,
  ).length;
}

export function formatCoverageDistanceLine(geo: CoverageGeoFields): string {
  if (!geo.hasGeo || geo.distanceKm == null) return 'Sin ubicación GPS en legajo';
  if (geo.distanceKm < 0.05) return 'En objetivo (presente)';
  const km = geo.distanceKm.toFixed(1);
  const min = geo.etaMinutes ?? estimateAutoTravelMinutes(geo.distanceKm);
  return `${km} km · ~${min} min en auto`;
}
