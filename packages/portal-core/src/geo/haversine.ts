const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Misma tolerancia que el portal web: 80 metros */
export const CHECK_IN_MAX_DISTANCE_KM = 0.08;

export function isWithinCheckInRadius(
  userLat: number,
  userLng: number,
  objectiveLat: number,
  objectiveLng: number,
  maxKm: number = CHECK_IN_MAX_DISTANCE_KM,
): boolean {
  return haversineKm(userLat, userLng, objectiveLat, objectiveLng) <= maxKm;
}
