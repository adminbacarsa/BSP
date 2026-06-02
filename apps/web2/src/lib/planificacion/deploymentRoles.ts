/**
 * RET (pool), REF (refuerzo desplegado) y ESC (escuela) — roles de despliegue en planificación.
 * REF y ESC no cuentan cobertura SLA ni horas planificadas (cobertura extra / formación sin puesto real).
 */

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

export function deploymentShiftHours(shift: {
    code?: unknown;
    hours?: unknown;
    deploymentBand?: unknown;
} | null | undefined): number {
    if (!shift) return 0;
    const code = String(shift.code || '').toUpperCase();
    if (code === 'RET') return 0;
    if (isDeploymentSurplusCode(code)) {
        const band = String(shift.deploymentBand || 'M').toUpperCase();
        const h = Number(shift.hours);
        if (h > 0) return h;
        return DEPLOYMENT_BAND_HOURS[band] ?? 8;
    }
    return 0;
}

/** Turnos que suman horas planificadas del empleado (CCT / totales del cronograma). */
export function shiftCountsForEmployeeCronoHours(shift: {
    code?: unknown;
    hours?: unknown;
    deploymentBand?: unknown;
    isDeleted?: boolean;
} | null | undefined): boolean {
    if (!shift || shift.isDeleted) return false;
    const code = String(shift.code || '').toUpperCase();
    if (isDeploymentSurplusCode(code)) return false;
    if (isDeploymentPoolCode(code)) return false;
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
            isReten: true,
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
