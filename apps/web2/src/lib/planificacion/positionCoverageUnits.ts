/**
 * Cobertura por puesto/día: 1 pax cerrado = esquema SLA completo (M+T+N, M+T, EN, etc.).
 * Usado en pie de grilla y modal de planificación.
 */

import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import { resolveTitularVacancyWorkShift } from './vacancyCoverage';

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
    coveredBy?: string;
    isExtended?: boolean;
    isEarlyStart?: boolean;
};

type ShiftRow = PlanningShiftSlice & { employeeId: string };

/** True si el turno pertenece al objetivo. Pending sin objectiveId → se asume del activo (vista individual). */
function shiftBelongsToObjective(
    shift: { objectiveId?: string },
    selectedObjective: string,
    isPending?: boolean,
): boolean {
    if (shift.objectiveId) return String(shift.objectiveId) === String(selectedObjective);
    return !!isPending;
}

export function normalizePlanningPositionName(name: unknown): string {
    return String(name ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^puesto\s+/, '');
}

export function lookupSplitCreditsForPosition(
    credits: Record<string, Record<string, number>>,
    positionName: string,
): Record<string, number> {
    const target = normalizePlanningPositionName(positionName);
    for (const [posName, bands] of Object.entries(credits)) {
        if (normalizePlanningPositionName(posName) === target) return bands;
    }
    return {};
}

/** Paquete ext+adel completo → 1 banda SLA cerrada en el puesto cubierto. */
export function assessSplitPackageStatus(rows: PlanningShiftSlice[]): 'COVERED' | 'PARTIAL' | 'NONE' {
    if (!rows.length) return 'NONE';
    const extLike = rows.filter((r) =>
        r.coverageSegmentRole === 'EXTENSION' || (!!r.isExtended && !r.isEarlyStart));
    const adelLike = rows.filter((r) =>
        r.coverageSegmentRole === 'EARLY_START' || (!!r.isEarlyStart && !r.isExtended));
    const hasBandMeta = !!rows.find((r) => r.coversBandCode);
    const hasPackage = !!rows.find((r) => r.coveragePackageId);

    if (extLike.length >= 2 && adelLike.length === 0 && (hasBandMeta || hasPackage)) {
        const explicit = rows.find((r) => r.coverageStatus === 'COVERED' || r.coverageStatus === 'PARTIAL')?.coverageStatus;
        if (explicit === 'PARTIAL') return 'PARTIAL';
        return 'COVERED';
    }

    const hasExt = extLike.length > 0;
    const hasAdel = adelLike.length > 0;
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
    ctx?: {
        titularId?: string;
        dateStr?: string;
        shiftsMap?: Record<string, PlanningShiftSlice | null | undefined>;
        pendingChanges?: Record<string, PlanningShiftSlice | null | undefined>;
        resolveOriginalShift?: (employeeId: string) => PlanningShiftSlice | null | undefined;
    },
): string | null {
    const extOnly = rows.filter((r) => r.isExtended && !r.isEarlyStart);
    if (extOnly.length >= 2) {
        const inferred = inferDualExtensionTargetBand(rows as ShiftRow[]);
        if (inferred) return inferred;
    }

    const withBand = rows.find(r => r.coversBandCode);
    if (withBand?.coversBandCode) return normBandCode(withBand.coversBandCode);

    const targetRow = rows.find(r => r.coverageSegmentRole === 'TARGET');
    const coversEmp = ctx?.titularId
        || targetRow?.coversEmployeeId
        || rows.find(r => r.coversEmployeeId)?.coversEmployeeId;

    if (coversEmp && ctx?.dateStr && ctx?.shiftsMap) {
        const inferred = resolveTitularVacancyWorkShift(
            coversEmp,
            ctx.dateStr,
            ctx.shiftsMap,
            ctx.pendingChanges || {},
        );
        const inferredCode = normBandCode(inferred?.code);
        if (inferredCode && !ABSENCE_CODES.has(inferredCode) && !PLANNING_NON_BILLABLE_CODES.has(inferredCode)) {
            return inferredCode;
        }
    }

    if (coversEmp && ctx?.resolveOriginalShift) {
        const original = ctx.resolveOriginalShift(coversEmp);
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

function resolveSplitPositionName(rows: PlanningShiftSlice[], titularId?: string, ctx?: {
    dateStr?: string;
    shiftsMap?: Record<string, PlanningShiftSlice | null | undefined>;
    pendingChanges?: Record<string, PlanningShiftSlice | null | undefined>;
}): string | null {
    const extRow = rows.find(r => r.coverageSegmentRole === 'EXTENSION')
        || rows.find(r => r.isExtended);
    const fromMeta = extRow?.coversPositionName
        || rows.find(r => r.coversPositionName)?.coversPositionName
        || rows.find(r => r.coverageSegmentRole === 'TARGET')?.positionName;
    if (fromMeta) return String(fromMeta);

    if (titularId && ctx?.dateStr && ctx?.shiftsMap) {
        const inferred = resolveTitularVacancyWorkShift(
            titularId,
            ctx.dateStr,
            ctx.shiftsMap,
            ctx.pendingChanges || {},
        );
        if (inferred?.positionName) return inferred.positionName;
    }

    return extRow?.positionName
        || rows.find(r => r.isEarlyStart)?.positionName
        || null;
}

function creditSplitPackage(
    rows: ShiftRow[],
    credits: Record<string, Record<string, number>>,
    ctx: {
        titularId?: string;
        dateStr: string;
        shiftsMap?: Record<string, PlanningShiftSlice | null | undefined>;
        pendingChanges?: Record<string, PlanningShiftSlice | null | undefined>;
        resolveOriginalShift?: (employeeId: string) => PlanningShiftSlice | null | undefined;
    },
): string[] {
    if (assessSplitPackageStatus(rows) !== 'COVERED') return [];

    const posName = resolveSplitPositionName(rows, ctx.titularId, ctx);
    if (!posName) return [];

    const bandCode = resolveSplitBandCode(rows, ctx);
    if (!bandCode) return [];

    if (!credits[posName]) credits[posName] = {};
    credits[posName][bandCode] = (credits[posName][bandCode] || 0) + 1;
    return rows
        .filter(r => r.isExtended || r.isEarlyStart || r.coverageSegmentRole === 'EXTENSION' || r.coverageSegmentRole === 'EARLY_START')
        .map(r => r.employeeId);
}

function collectLegacyExtAdelPairs(
    employeesList: Array<{ id: string }>,
    dateStr: string,
    resolveShift: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined,
    options: {
        selectedObjective: string;
        isPendingChange?: (empId: string, dateStr: string) => boolean;
    },
    packagedEmpIds: Set<string>,
): Array<{ rows: ShiftRow[]; titularId?: string }> {
    const ext: ShiftRow[] = [];
    const adel: ShiftRow[] = [];
    const absentWithCover: ShiftRow[] = [];

    for (const emp of employeesList) {
        if (packagedEmpIds.has(emp.id)) continue;
        const shift = resolveShift(emp.id, dateStr);
        if (!shift || shift.isDeleted) continue;
        if (!shiftBelongsToObjective(shift, options.selectedObjective, options.isPendingChange?.(emp.id, dateStr))) continue;

        const row: ShiftRow = { ...shift, employeeId: emp.id };
        const code = normBandCode(shift.code);
        if (shift.isExtended && !shift.isEarlyStart) ext.push(row);
        else if (shift.isEarlyStart && !shift.isExtended) adel.push(row);
        else if (ABSENCE_CODES.has(code) && String(shift.coveredBy || '').trim()) absentWithCover.push(row);
    }

    const pairs: Array<{ rows: ShiftRow[]; titularId?: string }> = [];
    const usedExt = new Set<number>();
    const usedAdel = new Set<number>();

    for (let ei = 0; ei < ext.length; ei++) {
        const tid = ext[ei].coversEmployeeId;
        if (!tid) continue;
        const ai = adel.findIndex((a, j) => !usedAdel.has(j) && a.coversEmployeeId === tid);
        if (ai < 0) continue;
        pairs.push({ rows: [ext[ei], adel[ai]], titularId: tid });
        usedExt.add(ei);
        usedAdel.add(ai);
    }

    let absentIdx = 0;
    for (let ei = 0; ei < ext.length; ei++) {
        if (usedExt.has(ei)) continue;
        const ai = adel.findIndex((_, j) => !usedAdel.has(j));
        if (ai < 0) break;
        const titularId = ext[ei].coversEmployeeId
            || adel[ai].coversEmployeeId
            || absentWithCover[absentIdx++]?.employeeId;
        pairs.push({ rows: [ext[ei], adel[ai]], titularId });
        usedExt.add(ei);
        usedAdel.add(ai);
    }

    return pairs;
}

function inferDualExtensionTargetBand(rows: ShiftRow[]): string {
    const codes = new Set(
        rows.map((r) => normBandCode(r.code)).filter((c) => c && c !== 'F' && c !== 'V'),
    );
    if (codes.has('E1') && codes.has('E2') && !codes.has('E3')) return 'E3';
    return '';
}

function collectDualExtensionOrphanGroups(
    employeesList: Array<{ id: string }>,
    dateStr: string,
    resolveShift: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined,
    options: {
        selectedObjective: string;
        isPendingChange?: (empId: string, dateStr: string) => boolean;
    },
    skipEmpIds: Set<string>,
): ShiftRow[][] {
    const extRows: ShiftRow[] = [];
    for (const emp of employeesList) {
        if (skipEmpIds.has(emp.id)) continue;
        const shift = resolveShift(emp.id, dateStr);
        if (!shift || shift.isDeleted) continue;
        if (!shiftBelongsToObjective(shift, options.selectedObjective, options.isPendingChange?.(emp.id, dateStr))) continue;
        if (!shift.isExtended || shift.isEarlyStart) continue;
        if (shift.coverageSegmentRole === 'EARLY_START') continue;
        extRows.push({ ...shift, employeeId: emp.id });
    }

    const byPos = new Map<string, ShiftRow[]>();
    for (const row of extRows) {
        const pos = normalizePlanningPositionName(row.coversPositionName || row.positionName || '');
        if (!pos) continue;
        const list = byPos.get(pos) || [];
        list.push(row);
        byPos.set(pos, list);
    }

    const groups: ShiftRow[][] = [];
    for (const rows of byPos.values()) {
        if (rows.length < 2) continue;
        const inferredBand = inferDualExtensionTargetBand(rows);
        let band = inferredBand
            || rows.map((r) => normBandCode(r.coversBandCode)).find((b) => !!b)
            || '';
        if (!band) continue;
        const enriched = rows.map((r) => ({
            ...r,
            coversBandCode: band,
            coverageStatus: 'COVERED' as const,
        }));
        if (assessSplitPackageStatus(enriched) !== 'COVERED') continue;
        groups.push(enriched);
    }
    return groups;
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
        shiftsMap?: Record<string, PlanningShiftSlice | null | undefined>;
        pendingChanges?: Record<string, PlanningShiftSlice | null | undefined>;
    },
): Record<string, Record<string, number>> {
    const packages = new Map<string, ShiftRow[]>();
    const creditedEmpIds = new Set<string>();

    const bandCtx = {
        dateStr,
        shiftsMap: options.shiftsMap,
        pendingChanges: options.pendingChanges,
        resolveOriginalShift: options.resolveOriginalShift
            ? (empId: string) => options.resolveOriginalShift!(empId, dateStr)
            : undefined,
    };

    for (const emp of employeesList) {
        const shift = resolveShift(emp.id, dateStr);
        if (!shift || shift.isDeleted) continue;
        const isSplitSegment = !!shift.coveragePackageId
            || shift.isExtended
            || shift.isEarlyStart
            || !!shift.coversPositionName;
        if (!isSplitSegment) continue;
        if (!shiftBelongsToObjective(shift, options.selectedObjective, options.isPendingChange?.(emp.id, dateStr))) continue;

        const pkgId = shift.coveragePackageId;
        const key = pkgId
            || `legacy_${shift.coversEmployeeId || 'pair'}_${shift.coversPositionName || shift.positionName || 'general'}_${dateStr}`;
        const list = packages.get(key) || [];
        list.push({ ...shift, employeeId: emp.id });
        packages.set(key, list);
    }

    const credits: Record<string, Record<string, number>> = {};

    for (const rows of packages.values()) {
        const titularId = rows.find(r => r.coverageSegmentRole === 'TARGET')?.coversEmployeeId
            || rows.find(r => r.coversEmployeeId)?.coversEmployeeId;
        for (const empId of creditSplitPackage(rows, credits, { ...bandCtx, titularId })) {
            creditedEmpIds.add(empId);
        }
    }

    const legacyPairs = collectLegacyExtAdelPairs(
        employeesList,
        dateStr,
        resolveShift,
        options,
        creditedEmpIds,
    );
    for (const pair of legacyPairs) {
        for (const empId of creditSplitPackage(pair.rows, credits, { ...bandCtx, titularId: pair.titularId })) {
            creditedEmpIds.add(empId);
        }
    }

    const dualOrphans = collectDualExtensionOrphanGroups(
        employeesList,
        dateStr,
        resolveShift,
        options,
        creditedEmpIds,
    );
    for (const group of dualOrphans) {
        for (const empId of creditSplitPackage(group, credits, bandCtx)) {
            creditedEmpIds.add(empId);
        }
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

/**
 * Puesto 24hs con qty=1: no mezclar esquema 8h (M+T+N) con 12h (D12+N12) el mismo día.
 * Con qty>1 cada unidad puede usar un esquema distinto (ver countPositionClosedUnitsFromShifts).
 */
export function is24hsSinglePaxBandMixBlocked(
    pax: number,
    code: string,
    assigned: Array<{ code: string; hours: number }>,
    bandHours: number,
): boolean {
    if (pax !== 1) return false;
    const is8h = bandHours < 12;
    const a8 = assigned.filter((a) => a.hours < 12);
    const a12 = assigned.filter((a) => a.hours >= 12);
    const upper = String(code || '').toUpperCase();
    if (a8.length > 0 && a12.length > 0) return true;
    if (a8.length > 0 && !is8h) return true;
    if (a12.length > 0 && is8h) return true;
    if (assigned.some((a) => a.code === upper)) return true;
    return false;
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
    dateStr?: string,
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
    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles, dateStr);
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
    dateStr?: string,
): PositionCoverageUnitResult {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const schemeLabel = positionSchemeLabelForDay(pos, dayLetter, cycles, dateStr);
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

    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles, dateStr);
    const effBands: Array<{ code: string; quantity?: number }> = (eff.length > 0 ? eff : allShifts.filter(s => {
        if (Array.isArray((s as any).specificDates) && (s as any).specificDates.length > 0) {
            return dateStr ? (s as any).specificDates.includes(dateStr) : false;
        }
        if (Array.isArray((s as any).days) && (s as any).days.length > 0) return (s as any).days.includes(dayLetter);
        return true;
    })).map(s => ({ code: String((s as any).code || '').toUpperCase(), quantity: (s as any).quantity }));
    const bandCodes = effBands.map(b => b.code).filter(Boolean);
    if (bandCodes.length === 0) {
        const fallback = allShifts.map(s => String(s.code || '').toUpperCase()).filter(Boolean);
        const closed = Math.min(qty, closedUnitsFromBandScheme(codeCounts, fallback));
        return { closed, required: qty, schemeLabel };
    }
    // Custom con PAX por turno: 1 unidad cerrada = todos los turnos en su PAX individual.
    const hasPerShiftPax = effBands.some(b => b.quantity != null && Number(b.quantity) > 0);
    if (hasPerShiftPax) {
        const allFull = effBands.every(b => {
            const pax = (b.quantity != null && Number(b.quantity) > 0) ? Math.max(1, Math.floor(Number(b.quantity))) : qty;
            return (codeCounts[b.code] || 0) >= pax;
        });
        return { closed: allFull ? 1 : 0, required: 1, schemeLabel };
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
        pendingChangesMap?: Record<string, PlanningShiftSlice | null | undefined>;
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
        if (!shiftBelongsToObjective(raw, options.selectedObjective, options.isPendingChange(emp.id, dateStr))) return;
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
            shiftsMap: options.existingShiftsMap,
            pendingChanges: options.pendingChangesMap,
        },
    );

    return mergeBandCreditsIntoCodeCounts(byPos, splitCredits);
}
