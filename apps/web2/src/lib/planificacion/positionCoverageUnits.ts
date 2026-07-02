/**
 * Cobertura por puesto/día: 1 pax cerrado = esquema SLA completo (M+T+N, M+T, EN, etc.).
 * Usado en pie de grilla y modal de planificación.
 */

import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';

export const PLANNING_NON_BILLABLE_CODES = new Set([
    'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'REF', 'ESC',
]);

const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

export type PlanningShiftSlice = {
    code?: string;
    positionName?: string;
    objectiveId?: string;
    isDeleted?: boolean;
    coveragePackageId?: string;
    coverageSegmentRole?: string;
    coversPositionName?: string;
    coversEmployeeId?: string;
    coversBandCode?: string;
    coverageStatus?: string;
    isExtended?: boolean;
    isEarlyStart?: boolean;
};

/** Paquete ext+adel completo → 1 banda SLA cerrada en el puesto cubierto. */
export function assessSplitPackageStatus(rows: PlanningShiftSlice[]): 'COVERED' | 'PARTIAL' | 'NONE' {
    if (!rows.length) return 'NONE';
    const hasExt = rows.some(r => r.coverageSegmentRole === 'EXTENSION' || (!!r.isExtended && !!r.coversPositionName));
    const hasAdel = rows.some(r => r.coverageSegmentRole === 'EARLY_START' || (!!r.isEarlyStart && !!r.coversPositionName));
    if (!hasExt || !hasAdel) return 'PARTIAL';
    const explicit = rows.find(r => r.coverageStatus === 'COVERED' || r.coverageStatus === 'PARTIAL')?.coverageStatus;
    if (explicit === 'COVERED') return 'COVERED';
    if (explicit === 'PARTIAL') return 'PARTIAL';
    return 'COVERED';
}

function normBandCode(code: unknown): string {
    return String(code || '').toUpperCase();
}

function resolveSplitBandCode(
    rows: PlanningShiftSlice[],
    resolveOriginalShift?: (employeeId: string) => PlanningShiftSlice | null | undefined,
): string | null {
    const withBand = rows.find(r => r.coversBandCode);
    if (withBand?.coversBandCode) return normBandCode(withBand.coversBandCode);

    const targetRow = rows.find(r => r.coverageSegmentRole === 'TARGET');
    const coversEmp = targetRow?.coversEmployeeId
        || rows.find(r => r.coversEmployeeId)?.coversEmployeeId;
    if (coversEmp && resolveOriginalShift) {
        const original = resolveOriginalShift(coversEmp);
        const origCode = normBandCode(original?.code);
        if (origCode && !ABSENCE_CODES.has(origCode) && !PLANNING_NON_BILLABLE_CODES.has(origCode)) {
            return origCode;
        }
    }

    if (targetRow) {
        const tc = normBandCode(targetRow.code);
        if (tc && !ABSENCE_CODES.has(tc) && !PLANNING_NON_BILLABLE_CODES.has(tc)) return tc;
    }

    return null;
}

/**
 * Créditos de banda por puesto cuando ext+adel cierran un hueco (½+½ = 1 puesto).
 * La ext/adel suman en su turno base (M, N…) pero no en el puesto/banda ausente (ej. MM).
 */
export function collectSplitBandCreditsForDay(
    employeesList: Array<{ id: string }>,
    dateStr: string,
    resolveShift: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined,
    options: {
        selectedObjective: string;
        isPendingChange?: (empId: string, dateStr: string) => boolean;
        resolveOriginalShift?: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined;
    },
): Record<string, Record<string, number>> {
    const packages = new Map<string, PlanningShiftSlice[]>();

    for (const emp of employeesList) {
        const shift = resolveShift(emp.id, dateStr);
        if (!shift || shift.isDeleted) continue;
        const pkgId = shift.coveragePackageId;
        const isSplitSegment = !!pkgId
            || ((shift.isExtended || shift.isEarlyStart) && !!shift.coversPositionName);
        if (!isSplitSegment) continue;
        if (!(shift.objectiveId === options.selectedObjective || options.isPendingChange?.(emp.id, dateStr))) continue;

        const key = pkgId || `legacy_${shift.coversEmployeeId || 'x'}_${shift.coversPositionName}_${dateStr}`;
        const list = packages.get(key) || [];
        list.push(shift);
        packages.set(key, list);
    }

    const credits: Record<string, Record<string, number>> = {};

    for (const rows of packages.values()) {
        if (assessSplitPackageStatus(rows) !== 'COVERED') continue;

        const extRow = rows.find(r => r.coverageSegmentRole === 'EXTENSION')
            || rows.find(r => r.isExtended && r.coversPositionName);
        const posName = extRow?.coversPositionName
            || rows.find(r => r.coverageSegmentRole === 'TARGET')?.positionName;
        if (!posName) continue;

        const bandCode = resolveSplitBandCode(
            rows,
            options.resolveOriginalShift
                ? (empId) => options.resolveOriginalShift!(empId, dateStr)
                : undefined,
        );
        if (!bandCode) continue;

        if (!credits[posName]) credits[posName] = {};
        credits[posName][bandCode] = (credits[posName][bandCode] || 0) + 1;
    }

    return credits;
}

export function mergeBandCreditsIntoCodeCounts(
    byPos: Record<string, Record<string, number>>,
    credits: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [posName, counts] of Object.entries(byPos)) {
        result[posName] = { ...counts };
    }
    for (const [posName, bands] of Object.entries(credits)) {
        if (!result[posName]) result[posName] = {};
        for (const [code, n] of Object.entries(bands)) {
            result[posName][code] = (result[posName][code] || 0) + n;
        }
    }
    return result;
}

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
        /** Turnos guardados (sin pending) para resolver banda original del titular en V/L. */
        existingShiftsMap?: Record<string, PlanningShiftSlice | null | undefined>;
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

    const splitCredits = collectSplitBandCreditsForDay(
        employeesList,
        dateStr,
        (empId, ds) => resolveShift(empId, ds),
        {
            selectedObjective: options.selectedObjective,
            isPendingChange: options.isPendingChange,
            resolveOriginalShift: options.existingShiftsMap
                ? (empId, ds) => options.existingShiftsMap![`${empId}_${ds}`] ?? null
                : undefined,
        },
    );

    return mergeBandCreditsIntoCodeCounts(byPos, splitCredits);
}
