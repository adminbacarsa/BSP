/**
 * Cobertura por puesto/día: 1 pax cerrado = esquema SLA completo (M+T+N, M+T, EN, etc.).
 * Usado en pie de grilla y modal de planificación.
 */

import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';

export const PLANNING_NON_BILLABLE_CODES = new Set([
    'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET',
]);

const SHIFT_HOURS_LOOKUP: Record<string, number> = {
    M: 8, T: 8, N: 8, D12: 12, N12: 12, EN: 9, RO: 10,
};

export interface PositionCoverageUnitResult {
    closed: number;
    required: number;
    schemeLabel: string;
}

export interface DayCoverageTotals {
    closed: number;
    required: number;
    positions: Array<{ positionName: string } & PositionCoverageUnitResult>;
}

/** 1 puesto cerrado = cada banda del esquema SLA cubierta (min de conteos por código). */
export function closedUnitsFromBandScheme(
    codeCounts: Record<string, number>,
    bandCodes: string[],
): number {
    const codes = bandCodes
        .map(c => String(c || '').toUpperCase())
        .filter(c => c && !PLANNING_NON_BILLABLE_CODES.has(c));
    if (codes.length === 0) return 0;
    return Math.min(...codes.map(c => codeCounts[c] || 0));
}

export function shiftBandHours(s: { hours?: unknown; code?: unknown }): number {
    const h = Number(s.hours);
    if (h > 0) return h;
    const code = String(s.code || '').toUpperCase();
    return SHIFT_HOURS_LOOKUP[code] ?? 8;
}

/** Etiqueta del esquema SLA del puesto para un día (ej. M+T+N, D12+N12, M+T). */
export function positionSchemeLabelForDay(
    pos: { coverageType?: string; shifts?: Array<{ code?: string; hours?: number }> },
    dayLetter: string,
    cycles?: string[],
): string {
    const coverageType = String(pos?.coverageType || 'custom').toLowerCase();
    const allShifts = Array.isArray(pos?.shifts) ? pos.shifts : [];
    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') {
        const bands8 = [...new Set(
            allShifts.filter(s => shiftBandHours(s) < 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
        )];
        const bands12 = [...new Set(
            allShifts.filter(s => shiftBandHours(s) >= 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
        )];
        const p8 = bands8.join('+');
        const p12 = bands12.join('+');
        if (p8 && p12) return `${p8} o ${p12}`;
        if (p8) return p8;
        if (p12) return p12;
        return 'M+T+N o D12+N12';
    }
    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles);
    const codes = eff.map(s => String(s.code || '').toUpperCase()).filter(Boolean);
    if (codes.length > 0) return codes.join('+');
    const fallback = allShifts.map(s => String(s.code || '').toUpperCase()).filter(Boolean);
    return fallback.length > 0 ? fallback.join('+') : 'SLA';
}

export function countPositionClosedUnitsFromShifts(
    pos: {
        positionName?: string;
        qty?: number;
        coverageType?: string;
        shifts?: Array<{ code?: string; hours?: number }>;
        activeDays?: string[];
    },
    dayLetter: string,
    codeCounts: Record<string, number>,
    cycles?: string[],
    isActiveOnDay = true,
): PositionCoverageUnitResult {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const schemeLabel = positionSchemeLabelForDay(pos, dayLetter, cycles);
    if (!isActiveOnDay) return { closed: 0, required: 0, schemeLabel };

    const coverageType = String(pos?.coverageType || 'custom').toLowerCase();
    const allShifts = Array.isArray(pos?.shifts) ? pos.shifts : [];

    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') {
        const bands8 = [...new Set(
            allShifts.filter(s => shiftBandHours(s) < 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
        )];
        const bands12 = [...new Set(
            allShifts.filter(s => shiftBandHours(s) >= 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
        )];
        let closed = 0;
        if (bands8.length > 0) {
            closed = Math.min(qty, closedUnitsFromBandScheme(codeCounts, bands8));
        } else if (bands12.length === 0) {
            closed = Math.min(qty, closedUnitsFromBandScheme(codeCounts, ['M', 'T', 'N']));
        }
        if (closed < qty && bands12.length >= 2) {
            closed += Math.min(qty - closed, closedUnitsFromBandScheme(codeCounts, bands12));
        } else if (closed < qty && bands8.length === 0 && bands12.length === 0) {
            closed += Math.min(qty - closed, closedUnitsFromBandScheme(codeCounts, ['D12', 'N12']));
        }
        return { closed, required: qty, schemeLabel };
    }

    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles);
    let bandCodes = eff.map(s => String(s.code || '').toUpperCase()).filter(Boolean);
    if (bandCodes.length === 0) {
        bandCodes = allShifts.map(s => String(s.code || '').toUpperCase()).filter(Boolean);
    }
    const closed = Math.min(qty, closedUnitsFromBandScheme(codeCounts, bandCodes));
    return { closed, required: qty, schemeLabel };
}

export function sumDayCoverageFromCodeCounts(
    positions: Array<{
        positionName?: string;
        qty?: number;
        coverageType?: string;
        shifts?: Array<{ code?: string; hours?: number }>;
        activeDays?: string[];
    }>,
    dayLetter: string,
    codeCountsByPosition: Record<string, Record<string, number>>,
    cycles?: string[],
    isPosActiveOnDay?: (pos: { activeDays?: string[] }, dayLetter: string) => boolean,
): DayCoverageTotals {
    const checkActive = isPosActiveOnDay ?? ((pos, letter) => {
        const days = pos.activeDays;
        if (!days || days.length === 0) return true;
        return days.includes(letter);
    });

    const result: DayCoverageTotals = { closed: 0, required: 0, positions: [] };
    for (const pos of positions) {
        const posName = String(pos.positionName || 'General');
        const active = checkActive(pos, dayLetter);
        const units = countPositionClosedUnitsFromShifts(
            pos,
            dayLetter,
            codeCountsByPosition[posName] || {},
            cycles,
            active,
        );
        result.positions.push({ positionName: posName, ...units });
        result.closed += units.closed;
        result.required += units.required;
    }
    return result;
}

/** Conteos M/T/N… por positionName para un día (desde grilla o asignaciones). */
export function buildCodeCountsByPositionForDay(
    positions: Array<{ positionName?: string }>,
    dateStr: string,
    employeesList: Array<{ id: string }>,
    resolveShift: (empId: string, dateStr: string) => {
        code?: string;
        positionName?: string;
        objectiveId?: string;
        isDeleted?: boolean;
    } | null | undefined,
    options: {
        selectedObjective: string;
        dominantPositionName: string;
        isPendingChange: (empId: string, dateStr: string) => boolean;
    },
): Record<string, Record<string, number>> {
    const byPos: Record<string, Record<string, number>> = {};
    for (const pos of positions) {
        const name = String(pos.positionName || 'General');
        byPos[name] = {};
    }

    employeesList.forEach(emp => {
        const key = `${emp.id}_${dateStr}`;
        const raw = resolveShift(emp.id, dateStr);
        if (!raw || raw.isDeleted) return;
        if (!(raw.objectiveId === options.selectedObjective || options.isPendingChange(emp.id, dateStr))) return;
        const code = String(raw.code || '').toUpperCase();
        if (PLANNING_NON_BILLABLE_CODES.has(code)) return;
        const shiftPos = raw.positionName || options.dominantPositionName || 'General';
        if (!byPos[shiftPos]) byPos[shiftPos] = {};
        byPos[shiftPos][code] = (byPos[shiftPos][code] || 0) + 1;
    });

    return byPos;
}
