import { isDeploymentSurplusCode } from '@/lib/planificacion/deploymentRoles';

export type PlanificacionDotacionEntry = { positionName: string; shiftCode?: string };
export type PlanificacionDotacionMap = Record<string, PlanificacionDotacionEntry>;

export const DOTACION_NEARBY_KM_DEFAULT = 10;
export const DOTACION_NEARBY_KM_MIN = 5;
export const DOTACION_NEARBY_KM_MAX = 100;
export const DOTACION_NEARBY_ROW_CAP = 40;
export const DOTACION_NEARBY_SCAN_CAP = 150;
export const ASSIGN_SEARCH_LIMIT = 50;
export const ROSTER_KM_PRESETS = [5, 10, 20, 40, 80] as const;
export const NEARBY_KM_STORAGE_KEY = 'planif_nearby_km';

export function buildDotacionMapsFromEmployees(employees: { id: string; planificacionDotacion?: PlanificacionDotacionMap }[]) {
    const pos: Record<string, string> = {};
    const shift: Record<string, string> = {};
    for (const e of employees) {
        const dot = e.planificacionDotacion;
        if (!dot) continue;
        for (const [objId, cfg] of Object.entries(dot)) {
            if (cfg?.positionName) pos[`${e.id}___${objId}`] = cfg.positionName;
            if (cfg?.shiftCode) shift[`${e.id}___${objId}`] = cfg.shiftCode;
        }
    }
    return { pos, shift };
}

export function clampNearbyKm(v: number): number {
    if (!Number.isFinite(v)) return DOTACION_NEARBY_KM_DEFAULT;
    return Math.min(DOTACION_NEARBY_KM_MAX, Math.max(DOTACION_NEARBY_KM_MIN, Math.round(v)));
}

export function readStoredNearbyKm(): number {
    if (typeof window === 'undefined') return DOTACION_NEARBY_KM_DEFAULT;
    try {
        const stored = parseInt(localStorage.getItem(NEARBY_KM_STORAGE_KEY) || '', 10);
        if (Number.isFinite(stored)) return clampNearbyKm(stored);
    } catch { /* ignore */ }
    return DOTACION_NEARBY_KM_DEFAULT;
}

export function formatKmLabel(km: number | null | undefined): string {
    if (km == null || !Number.isFinite(km) || km >= 9999) return '';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function employeeKmToObjective(
    emp: { lat?: number; lng?: number; latitude?: number; longitude?: number },
    objLat: number,
    objLng: number,
): number | null {
    const empLat = Number(emp.lat ?? emp.latitude ?? 0);
    const empLng = Number(emp.lng ?? emp.longitude ?? 0);
    if (!empLat || !empLng || !objLat || !objLng) return null;
    return haversineKm(empLat, empLng, objLat, objLng);
}

export function isEmpExcludedFromPlanningDotacion(
    emp: { planificacionDotacion?: PlanificacionDotacionMap },
    objectiveId: string | null | undefined,
): boolean {
    if (!objectiveId || !emp?.planificacionDotacion) return false;
    return isDeploymentSurplusCode(emp.planificacionDotacion[objectiveId]?.shiftCode);
}
