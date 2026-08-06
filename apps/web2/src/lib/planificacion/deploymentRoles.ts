/**
 * Roles de despliegue en planificación (no suman hs planificadas / cobertura SLA del objetivo):
 *
 * - **RET** (pool / guardia pasiva): stand-by en el objetivo. No suma hs planificadas.
 *   Liquidación: si ese día trabajó turno operativo (M/T/N…) liquida ese turno; si no fue
 *   usado, 8 hs una vez pasada la jornada del día.
 *
 * - **REF** (superposición): conocer el objetivo sin cubrir puesto SLA. Solo liquidación.
 *
 * - **ESC** (escuela): conocer cliente/objetivo sin sobrecargar turno. Solo liquidación.
 *
 * En **Análisis** sí se contabilizan turnos RET/REF/ESC para estadística operativa
 * (conteo y hs de referencia), separados de los KPIs de cobertura SLA.
 */

import { RET_STANDBY_REFERENCE_HOURS } from './constants';

export type DeploymentRole = 'REGULAR' | 'POOL' | 'SURPLUS' | 'TRAINING';
export type SurplusIntent = 'HORAS' | 'FORMACION';

export const DEPLOYMENT_SURPLUS_CODES = new Set(['REF', 'ESC']);
export const DEPLOYMENT_POOL_CODES = new Set(['RET']);

export const DEPLOYMENT_BAND_START: Record<string, string> = {
    M: '07:00',
    T: '15:00',
    N: '23:00',
    D12: '07:00',
    N12: '19:00',
};

export const DEPLOYMENT_BAND_HOURS: Record<string, number> = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12,
};

export const ESCUELA_TURNOS_PARA_CONOCIDO = 3;

export function isDeploymentSurplusCode(code: string | undefined | null): boolean {
    return DEPLOYMENT_SURPLUS_CODES.has(String(code || '').toUpperCase());
}

export function isDeploymentPoolCode(code: string | undefined | null): boolean {
    return DEPLOYMENT_POOL_CODES.has(String(code || '').toUpperCase());
}

export function deploymentRoleFromCode(code: string | undefined | null): DeploymentRole {
    const c = String(code || '').toUpperCase();
    if (c === 'RET') return 'POOL';
    if (c === 'REF') return 'SURPLUS';
    if (c === 'ESC') return 'TRAINING';
    return 'REGULAR';
}

export function normalizeDeploymentShiftCode(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase();
}

/** REF, ESC, RET y turnos marcados como despliegue / pool — no suman hs planificadas SLA. */
export function isDeploymentOrPoolShift(t: {
    code?: unknown;
    type?: unknown;
    isRefuerzo?: boolean;
    isEscuela?: boolean;
    isReten?: boolean;
    deploymentRole?: unknown;
} | null | undefined): boolean {
    if (!t) return false;
    const code = normalizeDeploymentShiftCode(t.code || t.type);
    if (isDeploymentPoolCode(code) || isDeploymentSurplusCode(code)) return true;
    if (code === 'RET' || code === 'REF' || code === 'ESC') return true;
    if (t.isRefuerzo === true || t.isEscuela === true || t.isReten === true) return true;
    const role = String(t.deploymentRole || deploymentRoleFromCode(code)).toUpperCase();
    return role === 'POOL' || role === 'SURPLUS' || role === 'TRAINING';
}

export function deploymentShiftHours(shift: {
    code?: unknown;
    hours?: unknown;
    deploymentBand?: unknown;
    isRefuerzo?: boolean;
    isEscuela?: boolean;
    isReten?: boolean;
    deploymentRole?: unknown;
} | null | undefined): number {
    if (!shift) return 0;
    const code = String(shift.code || '').toUpperCase();
    if (code === 'RET' || shift.isReten === true) return 0;
    if (isDeploymentSurplusCode(code) || shift.isRefuerzo === true || shift.isEscuela === true) {
        const band = String(shift.deploymentBand || 'M').toUpperCase();
        const h = Number(shift.hours);
        if (h > 0) return h;
        return DEPLOYMENT_BAND_HOURS[band] ?? 8;
    }
    return 0;
}

export type DeploymentStatKind = 'RET' | 'REF' | 'ESC';

/** Clasifica turno de despliegue para estadísticas (Análisis). */
export function deploymentStatKind(t: {
    code?: unknown;
    type?: unknown;
    isRefuerzo?: boolean;
    isEscuela?: boolean;
    isReten?: boolean;
    deploymentRole?: unknown;
} | null | undefined): DeploymentStatKind | null {
    if (!isDeploymentOrPoolShift(t)) return null;
    const code = normalizeDeploymentShiftCode(t?.code || t?.type);
    if (code === 'RET' || t?.isReten === true) return 'RET';
    if (code === 'ESC' || t?.isEscuela === true || String(t?.deploymentRole || '').toUpperCase() === 'TRAINING') {
        return 'ESC';
    }
    return 'REF';
}

/** Horas de referencia para estadística operativa (no cobertura SLA). */
export function resolveDeploymentStatHours(t: Parameters<typeof deploymentStatKind>[0]): number {
    const kind = deploymentStatKind(t);
    if (!kind) return 0;
    if (kind === 'RET') return RET_STANDBY_REFERENCE_HOURS;
    return deploymentShiftHours(t) || RET_STANDBY_REFERENCE_HOURS;
}

/** Turno operativo real (M/T/N…) que reemplaza el pago stand-by RET del mismo día. */
export function isRegularLiquidationWorkShift(t: {
    code?: unknown;
    type?: unknown;
    isRefuerzo?: boolean;
    isEscuela?: boolean;
    isReten?: boolean;
    deploymentRole?: unknown;
} | null | undefined): boolean {
    if (!t || String(t.type || '').toUpperCase() === 'NOVEDAD') return false;
    if (isDeploymentOrPoolShift(t)) return false;
    const code = normalizeDeploymentShiftCode(t.code || t.type);
    const nonWork = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
    return !nonWork.has(code);
}

/** Turnos que suman horas planificadas del empleado (CCT / totales del cronograma). */
export function shiftCountsForEmployeeCronoHours(shift: {
    code?: unknown;
    type?: unknown;
    hours?: unknown;
    deploymentBand?: unknown;
    isDeleted?: boolean;
    isRefuerzo?: boolean;
    isEscuela?: boolean;
    isReten?: boolean;
    deploymentRole?: unknown;
} | null | undefined): boolean {
    if (!shift || shift.isDeleted) return false;
    if (isDeploymentOrPoolShift(shift)) return false;
    const code = String(shift.code || '').toUpperCase();
    const nonWork = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
    return !nonWork.has(code);
}

export function buildDeploymentShiftConfig(
    intent: 'SURPLUS' | 'TRAINING',
    band: string,
    positionName: string,
): Record<string, unknown> {
    const b = String(band || 'M').toUpperCase();
    const code = intent === 'TRAINING' ? 'ESC' : 'REF';
    const hours = DEPLOYMENT_BAND_HOURS[b] ?? 8;
    return {
        code,
        name: intent === 'TRAINING' ? 'Escuela' : 'Refuerzo',
        hours,
        startTime: DEPLOYMENT_BAND_START[b] || '07:00',
        deploymentBand: b,
        deploymentRole: intent === 'TRAINING' ? 'TRAINING' : 'SURPLUS',
        surplusIntent: intent === 'TRAINING' ? 'FORMACION' : 'HORAS',
        countsForCoverage: false,
        isRefuerzo: true,
        isEscuela: intent === 'TRAINING',
        isReten: false,
        positionName,
    };
}

export function deploymentFieldsForFirestore(change: Record<string, unknown>): Record<string, unknown> {
    const code = String(change.code || '').toUpperCase();
    if (code === 'RET') {
        return {
            deploymentRole: 'POOL',
            countsForCoverage: false,
            // RET del cronograma planificado: no marcar isReten (eso es stand-by operativo origin RETEN).
            isReten: false,
            isRefuerzo: false,
            isEscuela: false,
        };
    }
    if (code === 'REF' || code === 'ESC') {
        return {
            deploymentRole: code === 'ESC' ? 'TRAINING' : 'SURPLUS',
            surplusIntent: code === 'ESC' ? 'FORMACION' : 'HORAS',
            deploymentBand: change.deploymentBand || 'M',
            countsForCoverage: false,
            isRefuerzo: true,
            isEscuela: code === 'ESC',
            isReten: false,
        };
    }
    return {
        deploymentRole: 'REGULAR',
        countsForCoverage: true,
        isRefuerzo: false,
        isEscuela: false,
        isReten: false,
    };
}

export function cellLabelForDeployment(code: string | undefined, deploymentBand?: string | null): string {
    const c = String(code || '').toUpperCase();
    if (c === 'REF' || c === 'ESC') {
        const band = deploymentBand ? String(deploymentBand).toUpperCase() : '';
        return band ? `${c}·${band}` : c;
    }
    return c;
}
