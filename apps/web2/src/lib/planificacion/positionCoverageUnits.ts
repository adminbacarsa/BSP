/**
 * Cobertura por puesto/día: 1 pax cerrado = esquema SLA completo (M+T+N, M+T, EN, etc.).
 * Usado en pie de grilla y modal de planificación.
 */

import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import { acreditarExtEntrePuestos } from './extEntrePuestos';
import { esFranjaPropia } from './lecturaBandas';
import { resolveTitularVacancyWorkShift } from './vacancyCoverage';
import { paxBoostDeltaForDate } from '@/lib/servicios/paxBoostRanges';
import { diaAcreditacionCobertura, sumarDiasCalendario } from './coberturaDiaHueco';
import { correFeriado } from '@/lib/servicios/turnoFeriados';
import { puestoSalteaFeriado } from '@/lib/servicios/slaHoursCalculator';

export const PLANNING_NON_BILLABLE_CODES = new Set([
    'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET', 'REF', 'ESC', 'SUS', 'SGS', 'EV',
]);

const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

export type PlanningShiftSlice = {
    code?: string;
    positionName?: string;
    objectiveId?: string;
    isDeleted?: boolean;
    coveragePackageId?: string;
    coverageSegmentRole?: string;
    /** FULL_BAND = una persona cubre toda la banda faltante; SPLIT = ext+adel o aporte parcial. */
    coverageMode?: string;
    coversPositionName?: string;
    coversEmployeeId?: string;
    coversBandCode?: string;
    /** Día del hueco que cierra este tramo (puede ser distinto del día del turno). */
    coversDateStr?: string;
    /** Objetivo al que se acredita el cierre. Si falta, vale `objectiveId` del turno. */
    coversObjectiveId?: string;
    segmentFromTime?: string;
    segmentToTime?: string;
    startTime?: string;
    endTime?: string;
    coverageStatus?: string;
    coveredBy?: string;
    isExtended?: boolean;
    isEarlyStart?: boolean;
    extExtraHours?: number;
};

type ShiftRow = PlanningShiftSlice & { employeeId: string };

export type FilaAcreditada = { empId: string; diaTurno: string; shift: PlanningShiftSlice };

function pareceTramoDeCobertura(shift: PlanningShiftSlice): boolean {
    return !!shift.coveragePackageId
        || shift.isExtended === true
        || shift.isEarlyStart === true
        || !!shift.coversPositionName
        || !!String(shift.coveredBy || '').trim()
        || !!shift.coverageSegmentRole;
}

/**
 * Una pasada por empleado y fecha. Cada tramo queda en el día que acredita
 * (`coversDateStr` o el deducido), no se vuelve a buscar día-1/día/día+1 por celda.
 */
export function indexarFilasAcreditadas(
    employeesList: Array<{ id: string }>,
    fechas: string[],
    resolveShift: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined,
): Map<string, FilaAcreditada[]> {
    const map = new Map<string, FilaAcreditada[]>();
    for (const emp of employeesList) {
        for (const ds of fechas) {
            const shift = resolveShift(emp.id, ds);
            if (!shift || shift.isDeleted || !pareceTramoDeCobertura(shift)) continue;
            const dia = diaAcreditacionCobertura(shift, ds);
            const fila: FilaAcreditada = { empId: emp.id, diaTurno: ds, shift };
            const list = map.get(dia);
            if (list) list.push(fila);
            else map.set(dia, [fila]);
        }
    }
    return map;
}

export function fechasConBorde(dias: string[]): string[] {
    if (!dias.length) return [];
    const orden = [...dias].sort();
    return [...new Set([
        sumarDiasCalendario(orden[0], -1),
        ...orden,
        sumarDiasCalendario(orden[orden.length - 1], 1),
    ])];
}

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

    // Una sola persona cubre la banda completa (ej. M2 extendido cierra T2 de 6h).
    const fullBandCover = rows.some((r) => {
        const mode = String(r.coverageMode || '').toUpperCase();
        if (mode !== 'FULL_BAND') return false;
        if (!r.coversBandCode) return false;
        if (r.coverageStatus === 'PARTIAL') return false;
        return r.coverageStatus === 'COVERED' || !r.coverageStatus;
    });
    if (fullBandCover && (extLike.length > 0 || adelLike.length > 0)) {
        return 'COVERED';
    }

    // Compat: segmento único marcado COVERED + coversBandCode (sin exigir 2.º guardia).
    if ((extLike.length === 1 && adelLike.length === 0) || (adelLike.length === 1 && extLike.length === 0)) {
        const explicitSolo = rows.find((r) => r.coverageStatus === 'COVERED' && !!r.coversBandCode);
        if (explicitSolo && (hasBandMeta || hasPackage || String(explicitSolo.coverageMode || '').toUpperCase() === 'FULL_BAND')) {
            return 'COVERED';
        }
    }

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

    // Si el guardia es de otro puesto (ej. Refuerzo) y cubre FULL_BAND, también acreditar
    // su banda base en el puesto cubierto (M2+T2 necesita M2 y T2).
    const isFullBand = rows.some((r) => String(r.coverageMode || '').toUpperCase() === 'FULL_BAND');
    if (isFullBand) {
        const anchor = rows.find((r) => r.isExtended || r.isEarlyStart || r.coverageSegmentRole === 'EXTENSION' || r.coverageSegmentRole === 'EARLY_START') || rows[0];
        const homePos = normalizePlanningPositionName(anchor?.positionName || '');
        const coverPos = normalizePlanningPositionName(posName);
        if (homePos && coverPos && homePos !== coverPos) {
            const baseCode = normBandCode(anchor?.code);
            if (baseCode && baseCode !== bandCode && !PLANNING_NON_BILLABLE_CODES.has(baseCode) && !ABSENCE_CODES.has(baseCode)) {
                credits[posName][baseCode] = (credits[posName][baseCode] || 0) + 1;
            }
        }
    }

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
        filasAcreditadas?: FilaAcreditada[];
    },
    packagedEmpIds: Set<string>,
): Array<{ rows: ShiftRow[]; titularId?: string }> {
    const ext: ShiftRow[] = [];
    const adel: ShiftRow[] = [];
    const absentWithCover: ShiftRow[] = [];

    const tomar = (empId: string, ds: string, shift: PlanningShiftSlice) => {
        if (packagedEmpIds.has(empId)) return;
        if (!shift || shift.isDeleted) return;
        if (!shiftBelongsToObjective(shift, options.selectedObjective, options.isPendingChange?.(empId, ds))) return;
        const row: ShiftRow = { ...shift, employeeId: empId };
        const code = normBandCode(shift.code);
        if (shift.isExtended && !shift.isEarlyStart) ext.push(row);
        else if (shift.isEarlyStart && !shift.isExtended) adel.push(row);
        else if (ABSENCE_CODES.has(code) && String(shift.coveredBy || '').trim()) absentWithCover.push(row);
    };

    if (options.filasAcreditadas) {
        for (const fila of options.filasAcreditadas) tomar(fila.empId, fila.diaTurno, fila.shift);
    } else {
    const fechas = [sumarDiasCalendario(dateStr, -1), dateStr, sumarDiasCalendario(dateStr, 1)];
    for (const emp of employeesList) {
        for (const ds of fechas) {
        const shift = resolveShift(emp.id, ds);
        if (!shift) continue;
        if (diaAcreditacionCobertura(shift, ds) !== dateStr) continue;
        tomar(emp.id, ds, shift);
        }
    }
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
        filasAcreditadas?: FilaAcreditada[];
    },
    skipEmpIds: Set<string>,
): ShiftRow[][] {
    const extRows: ShiftRow[] = [];
    const tomar = (empId: string, ds: string, shift: PlanningShiftSlice) => {
        if (skipEmpIds.has(empId)) return;
        if (!shift || shift.isDeleted) return;
        if (!shiftBelongsToObjective(shift, options.selectedObjective, options.isPendingChange?.(empId, ds))) return;
        if (!shift.isExtended || shift.isEarlyStart) return;
        if (shift.coverageSegmentRole === 'EARLY_START') return;
        extRows.push({ ...shift, employeeId: empId });
    };
    if (options.filasAcreditadas) {
        for (const fila of options.filasAcreditadas) tomar(fila.empId, fila.diaTurno, fila.shift);
    } else {
    const fechas = [sumarDiasCalendario(dateStr, -1), dateStr, sumarDiasCalendario(dateStr, 1)];
    for (const emp of employeesList) {
        for (const ds of fechas) {
        const shift = resolveShift(emp.id, ds);
        if (!shift) continue;
        if (diaAcreditacionCobertura(shift, ds) !== dateStr) continue;
        tomar(emp.id, ds, shift);
        }
    }
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
        /** Si viene, no se recorre día-1/día/día+1: ya están en el día que acreditan. */
        filasAcreditadas?: FilaAcreditada[];
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

    const meter = (empId: string, ds: string, shift: PlanningShiftSlice) => {
        if (!shift || shift.isDeleted) return;
        const isSplitSegment = !!shift.coveragePackageId
            || shift.isExtended
            || shift.isEarlyStart
            || !!shift.coversPositionName;
        if (!isSplitSegment) return;
        if (!shiftBelongsToObjective(shift, options.selectedObjective, options.isPendingChange?.(empId, ds))) return;
        const pkgId = shift.coveragePackageId;
        const key = pkgId
            || `legacy_${shift.coversEmployeeId || 'pair'}_${shift.coversPositionName || shift.positionName || 'general'}_${dateStr}`;
        const list = packages.get(key) || [];
        list.push({ ...shift, employeeId: empId });
        packages.set(key, list);
    };
    if (options.filasAcreditadas) {
        for (const fila of options.filasAcreditadas) meter(fila.empId, fila.diaTurno, fila.shift);
    } else {
        const fechas = [sumarDiasCalendario(dateStr, -1), dateStr, sumarDiasCalendario(dateStr, 1)];
        for (const emp of employeesList) {
            for (const ds of fechas) {
                const shift = resolveShift(emp.id, ds);
                if (!shift) continue;
                if (diaAcreditacionCobertura(shift, ds) !== dateStr) continue;
                meter(emp.id, ds, shift);
            }
        }
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

/** Créditos Ext/Adel de todo el mes con una sola deducción de `coversDateStr` por turno. */
export function creditosSplitPorDia(
    employeesList: Array<{ id: string }>,
    dias: string[],
    resolveShift: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined,
    options: {
        selectedObjective: string;
        isPendingChange?: (empId: string, dateStr: string) => boolean;
        resolveOriginalShift?: (empId: string, dateStr: string) => PlanningShiftSlice | null | undefined;
        shiftsMap?: Record<string, PlanningShiftSlice | null | undefined>;
        pendingChanges?: Record<string, PlanningShiftSlice | null | undefined>;
    },
): Record<string, Record<string, Record<string, number>>> {
    const index = indexarFilasAcreditadas(employeesList, fechasConBorde(dias), resolveShift);
    const out: Record<string, Record<string, Record<string, number>>> = {};
    for (const dia of dias) {
        out[dia] = collectSplitBandCreditsForDay(employeesList, dia, resolveShift, {
            ...options,
            filasAcreditadas: index.get(dia) || [],
        });
    }
    return out;
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
    /** Puesto con PAX por turno (Museo MM×3 + ME×1): cuántos tiene y pide cada turno. */
    bandas?: Array<{ code: string; tiene: number; pide: number; desde?: string; hasta?: string }>;
    /** Personas de más en alguna franja (la celda muestra «4/4 +N»). */
    sobra?: number;
    sobraDetalle?: string[];
    /** Hueco de reloj que no tira la banda (ej. 06:00–07:00). */
    avisoHoras?: string;
    /** Horas que cubren lo vendido. Lo que pasa de la franja no se suma. */
    facturable?: number;
    vendidasHoras?: number;
    sobraHoras?: number;
}

export type TurnoRelojCobertura = {
    code?: string;
    positionName?: string;
    startTime?: string;
    endTime?: string;
    hours?: number;
    isExtended?: boolean;
    isEarlyStart?: boolean;
    segmentFromTime?: string;
    segmentToTime?: string;
    extExtraHours?: number;
    nombre?: string;
    /** Horas pedidas por el cliente: se facturan aparte y no tapan un hueco de la empresa. */
    isTura?: boolean;
};

const MINUTOS_DIA = 1440;
const TOLERANCIA_HUECO_MIN = 60;

function aMinuto(hm: string): number | null {
    const m = String(hm || '').match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function aHm(min: number): string {
    const v = ((min % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function horaCorta(hm: string): string {
    const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return hm;
    if (m[2] === '00') return String(Number(m[1]));
    return `${Number(m[1])}:${m[2]}`;
}

function horasDeMinutos(min: number): number {
    return Math.round((min / 60) * 10) / 10;
}

/** Ventana en minutos 0–2880. Si termina antes o igual, cruza la medianoche. */
function intervalosReloj(inicio: string, fin: string): Array<[number, number]> {
    const a = aMinuto(inicio);
    let b = aMinuto(fin);
    if (a == null || b == null || a === b) return [];
    if (b <= a) b += MINUTOS_DIA;
    return [[a, b]];
}

function finDesdeInicio(inicio: string, horas: number): string | null {
    const a = aMinuto(inicio);
    if (a == null || !(horas > 0)) return null;
    return aHm(a + Math.round(horas * 60));
}

function pintar(oferta: number[], tramos: Array<[number, number]>) {
    for (const [a, b] of tramos) {
        const desde = Math.max(0, a);
        const hasta = Math.min(oferta.length, b);
        for (let m = desde; m < hasta; m++) oferta[m] += 1;
    }
}

function presenciaTurno(t: TurnoRelojCobertura, ventanaDeCodigo: (code: string) => Array<[number, number]>): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const ini = String(t.startTime || '').slice(0, 5);
    const finExplicito = String(t.endTime || '').slice(0, 5);
    const fin = finExplicito || (ini ? finDesdeInicio(ini, Number(t.hours) || 0) || '' : '');
    if (ini && fin) out.push(...intervalosReloj(ini, fin));
    const segA = String(t.segmentFromTime || '').slice(0, 5);
    const segB = String(t.segmentToTime || '').slice(0, 5);
    if (segA && segB) out.push(...intervalosReloj(segA, segB));
    else if (t.isExtended && fin && Number(t.extExtraHours) > 0) {
        const hasta = finDesdeInicio(fin, Number(t.extExtraHours));
        if (hasta) out.push(...intervalosReloj(fin, hasta));
    } else if (t.isEarlyStart && ini && Number(t.extExtraHours) > 0) {
        const desdeMin = aMinuto(ini);
        if (desdeMin != null) {
            const desde = aHm(desdeMin - Math.round(Number(t.extExtraHours) * 60));
            out.push(...intervalosReloj(desde, ini));
        }
    }
    if (!out.length) out.push(...ventanaDeCodigo(String(t.code || '').toUpperCase()));
    return out;
}

function ventanasHueco(oferta: number[], desde: number, hasta: number, pide: number): Array<{ desde: string; hasta: string; min: number }> {
    const out: Array<{ desde: string; hasta: string; min: number }> = [];
    let abierta: number | null = null;
    for (let m = desde; m <= hasta; m++) {
        const falta = m < hasta && (oferta[m] || 0) < pide;
        if (falta && abierta == null) abierta = m;
        if (!falta && abierta != null) {
            out.push({ desde: aHm(abierta), hasta: aHm(m), min: m - abierta });
            abierta = null;
        }
    }
    return out;
}

type BandaPedida = { code: string; pide: number; desde: string; hasta: string; horas: number };

function bandasExplicitas(
    allShifts: Array<{ code?: string; hours?: number; quantity?: number; startTime?: string; endTime?: string }>,
    effectiveBandQty: (code: string, shiftQty?: number) => number,
    fullSkip: Set<string>,
): BandaPedida[] {
    const explicitas = allShifts.filter((s) => {
        const code = String(s.code || '').toUpperCase();
        return code && !fullSkip.has(code) && s.quantity != null && Number(s.quantity) > 0;
    });
    if (!explicitas.length) return [];
    const ocho = explicitas.filter((s) => shiftBandHours(s) < 12);
    const doce = explicitas.filter((s) => shiftBandHours(s) >= 12);
    const elegidas = ocho.length > 0 ? ocho : doce;
    const vistas = new Set<string>();
    const out: BandaPedida[] = [];
    for (const s of elegidas) {
        const code = String(s.code || '').toUpperCase();
        if (!code || vistas.has(code)) continue;
        vistas.add(code);
        const pide = effectiveBandQty(code, s.quantity);
        if (pide <= 0) continue;
        const desde = String(s.startTime || '').slice(0, 5);
        const hasta = String(s.endTime || '').slice(0, 5) || (desde ? finDesdeInicio(desde, shiftBandHours(s)) || '' : '');
        out.push({ code, pide, desde, hasta, horas: shiftBandHours(s) });
    }
    return out;
}

/** D12 suma a la M, N12 a la N y el par a la T. Sirve cuando el turno no trae horario. */
function acreditar12h(codeCounts: Record<string, number>): Record<string, number> {
    const d12 = codeCounts.D12 || 0;
    const n12 = codeCounts.N12 || 0;
    return {
        ...codeCounts,
        M: (codeCounts.M || 0) + d12,
        T: (codeCounts.T || 0) + Math.min(d12, n12),
        N: (codeCounts.N || 0) + n12,
    };
}

function cerrarPorCantidadDeBanda(
    posName: string,
    schemeLabel: string,
    bandas: BandaPedida[],
    codeCounts: Record<string, number>,
    turnos?: TurnoRelojCobertura[],
): PositionCoverageUnitResult {
    const porCodigo = new Map(bandas.map((b) => [b.code, b]));
    const ventanaDeCodigo = (code: string): Array<[number, number]> => {
        const b = porCodigo.get(code);
        if (b?.desde && b?.hasta) return intervalosReloj(b.desde, b.hasta);
        const fijas: Record<string, [string, string]> = {
            M: ['06:00', '14:00'], T: ['14:00', '22:00'], N: ['22:00', '06:00'],
            D12: ['06:00', '18:00'], N12: ['18:00', '06:00'],
        };
        const par = fijas[code];
        return par ? intervalosReloj(par[0], par[1]) : [];
    };
    const conReloj = (turnos || []).some((t) => String(t.startTime || '').includes(':'));
    if (conReloj && bandas.every((b) => b.desde && b.hasta)) {
        const oferta = new Array<number>(MINUTOS_DIA * 2).fill(0);
        for (const t of turnos || []) pintar(oferta, presenciaTurno(t, ventanaDeCodigo));
        let cubiertas = 0;
        let pedidas = 0;
        let sobranMin = 0;
        const estados: NonNullable<PositionCoverageUnitResult['bandas']> = [];
        const avisos: string[] = [];
        for (const b of bandas) {
            const tramo = intervalosReloj(b.desde, b.hasta)[0];
            if (!tramo) continue;
            const [desde, hasta] = tramo;
            const mins: number[] = [];
            for (let m = desde; m < hasta; m++) {
                const n = oferta[m] || 0;
                mins.push(n);
                pedidas += b.pide;
                cubiertas += Math.min(n, b.pide);
                sobranMin += Math.max(0, n - b.pide);
            }
            const tope = mins.length ? Math.max(...mins) : 0;
            let tiene = 0;
            for (let nivel = tope; nivel >= 0; nivel--) {
                const cortos = mins.filter((n) => n < nivel).length;
                if (cortos <= TOLERANCIA_HUECO_MIN) { tiene = nivel; break; }
            }
            estados.push({ code: b.code, tiene, pide: b.pide, desde: b.desde, hasta: b.hasta });
            if (tiene >= b.pide) {
                const huecos = ventanasHueco(oferta, desde, hasta, b.pide);
                const minHueco = huecos.reduce((s, h) => s + h.min, 0);
                if (minHueco > 0) {
                    const donde = huecos.slice(0, 2).map((h) => `${h.desde}–${h.hasta}`).join(', ');
                    avisos.push(`Falta ${horasDeMinutos(minHueco)} h en ${posName} (${donde})`);
                }
            }
        }
        const acred = acreditar12h(codeCounts);
        for (const estado of estados) {
            const relleno = Math.min(acred[estado.code] || 0, estado.pide);
            estado.tiene = Math.max(estado.tiene, relleno);
        }
        const sobraDetalle: string[] = [];
        let sobra = 0;
        for (const estado of estados) {
            if (estado.tiene <= estado.pide) continue;
            const n = estado.tiene - estado.pide;
            sobra += n;
            const rango = estado.desde && estado.hasta ? ` ${horaCorta(estado.desde)}–${horaCorta(estado.hasta)}` : '';
            sobraDetalle.push(`Sobra ${n} en ${posName}${rango} (${estado.code})`);
        }
        const allFull = estados.length > 0 && estados.every((b) => b.tiene >= b.pide);
        return {
            closed: allFull ? 1 : 0,
            required: 1,
            schemeLabel,
            bandas: estados,
            sobra,
            sobraDetalle,
            avisoHoras: avisos.join(' · '),
            facturable: horasDeMinutos(cubiertas),
            vendidasHoras: horasDeMinutos(pedidas),
            sobraHoras: horasDeMinutos(sobranMin),
        };
    }
    const acred = acreditar12h(codeCounts);
    const estados = bandas.map((b) => ({
        code: b.code,
        tiene: acred[b.code] || 0,
        pide: b.pide,
        desde: b.desde,
        hasta: b.hasta,
    }));
    const sobraDetalle: string[] = [];
    let sobra = 0;
    for (const b of estados) {
        if (b.tiene > b.pide) {
            const n = b.tiene - b.pide;
            sobra += n;
            const rango = b.desde && b.hasta ? ` ${horaCorta(b.desde)}–${horaCorta(b.hasta)}` : '';
            sobraDetalle.push(`Sobra ${n} en ${posName}${rango} (${b.code})`);
        }
    }
    const allFull = estados.length > 0 && estados.every((b) => b.tiene >= b.pide);
    return { closed: allFull ? 1 : 0, required: 1, schemeLabel, bandas: estados, sobra, sobraDetalle };
}

/** Suma de «Falta N h …» del reloj (hueco dentro de la tolerancia). */
export function horasFaltantesDeAviso(aviso: string): number {
    let total = 0;
    for (const m of String(aviso || '').matchAll(/Falta (\d+(?:\.\d+)?) h/g)) {
        total += Number(m[1]) || 0;
    }
    return Math.round(total * 10) / 10;
}

/** Marca corta del pie: «⚠1h». Vacía si el día no tiene hueco de reloj. */
export function marcaHorasFaltantes(aviso: string): string {
    const h = horasFaltantesDeAviso(aviso);
    if (!(h > 0)) return '';
    return `⚠${h}h`;
}

export function etiquetaCoberturaDia(closed: number, required: number, sobra = 0, avisoHoras = ''): string {
    const base = `${closed}/${required}`;
    const extra = sobra > 0 ? ` +${sobra}` : '';
    const marca = marcaHorasFaltantes(avisoHoras);
    return marca ? `${base}${extra} ${marca}` : `${base}${extra}`;
}

export function evaluarCoberturaDia(
    positions: Array<{
        positionName?: string;
        qty?: number;
        coverageType?: string;
        shifts?: Array<{ code?: string; hours?: number; quantity?: number; startTime?: string; endTime?: string }>;
        activeDays?: string[];
        trabajaFeriados?: boolean;
    }>,
    turnos: Array<TurnoRelojCobertura & { positionName?: string }>,
    dayLetter = 'J',
    dateStr?: string,
): {
    closed: number;
    required: number;
    sobra: number;
    etiqueta: string;
    sobraDetalle: string[];
    avisoHoras: string;
    positions: Array<{ positionName: string } & PositionCoverageUnitResult>;
} {
    const result = {
        closed: 0,
        required: 0,
        sobra: 0,
        etiqueta: '0/0',
        sobraDetalle: [] as string[],
        avisoHoras: '',
        positions: [] as Array<{ positionName: string } & PositionCoverageUnitResult>,
    };
    for (const pos of positions) {
        const posName = String(pos.positionName || 'General');
        const propios = turnos.filter((t) => normalizePlanningPositionName(t.positionName || '') === normalizePlanningPositionName(posName));
        const counts: Record<string, number> = {};
        for (const t of propios) {
            const code = String(t.code || '').toUpperCase();
            if (!code || PLANNING_NON_BILLABLE_CODES.has(code)) continue;
            counts[code] = (counts[code] || 0) + 1;
        }
        const units = countPositionClosedUnitsFromShifts(pos, dayLetter, counts, undefined, !puestoSalteaFeriado(pos, dateStr), dateStr, propios);
        result.positions.push({ positionName: posName, ...units });
        result.closed += units.closed;
        result.required += units.required;
        result.sobra += units.sobra || 0;
        if (units.sobraDetalle?.length) result.sobraDetalle.push(...units.sobraDetalle);
        if (units.avisoHoras) result.avisoHoras = [result.avisoHoras, units.avisoHoras].filter(Boolean).join(' · ');
    }
    aplicarExtDeOtrosPuestos(positions, turnos, result);
    result.etiqueta = etiquetaCoberturaDia(result.closed, result.required, result.sobra, result.avisoHoras);
    return result;
}

function aplicarExtDeOtrosPuestos(
    positions: Array<{ positionName?: string; shifts?: Array<{ code?: string; quantity?: number; startTime?: string; endTime?: string }> }>,
    turnos: Array<TurnoRelojCobertura & { positionName?: string }>,
    result: {
        closed: number;
        required: number;
        sobra: number;
        avisoHoras: string;
        positions: Array<{ positionName: string } & PositionCoverageUnitResult>;
    },
): void {
    const puestos = positions
        .map((pos) => ({
            positionName: String(pos.positionName || 'General'),
            franjas: (pos.shifts || [])
                .filter((s) => s.startTime && s.endTime)
                .map((s) => ({
                    code: s.code,
                    startTime: String(s.startTime),
                    endTime: String(s.endTime),
                    qty: s.quantity,
                })),
        }))
        .filter((p) => p.franjas.length);
    if (!puestos.length) return;
    const cruce = acreditarExtEntrePuestos(puestos, turnos.map((t) => ({
        positionName: t.positionName,
        nombre: t.nombre,
        code: t.code,
        startTime: t.startTime,
        endTime: t.endTime,
        hours: t.hours,
        isExtended: t.isExtended,
        isEarlyStart: t.isEarlyStart,
        segmentFromTime: t.segmentFromTime,
        segmentToTime: t.segmentToTime,
        extExtraHours: t.extExtraHours,
        isTura: t.isTura || String(t.code || '').toUpperCase() === 'TURA',
    })));
    const mismo = (a: string, b: string) => normalizePlanningPositionName(a) === normalizePlanningPositionName(b);
    for (const pos of result.positions) {
        const c = cruce.porPuesto.find((p) => mismo(p.positionName, pos.positionName));
        if (!c) continue;
        const yaCerrado = pos.required > 0 && pos.closed >= pos.required;
        if (!yaCerrado && c.textos.length) {
            const linea = c.textos.join(' · ');
            pos.avisoHoras = [pos.avisoHoras, linea].filter(Boolean).join(' · ');
            result.avisoHoras = [result.avisoHoras, linea].filter(Boolean).join(' · ');
        }
        if (c.cerrado && !yaCerrado && pos.required > 0) {
            pos.closed = pos.required;
            if (pos.vendidasHoras != null) pos.facturable = pos.vendidasHoras;
        }
        if (c.cedidasHoras > 0 && pos.sobraHoras) {
            pos.sobraHoras = Math.max(0, Math.round((pos.sobraHoras - c.cedidasHoras) * 10) / 10);
        }
    }
    result.closed = result.positions.reduce((s, p) => s + p.closed, 0);
    result.sobra = result.positions.reduce((s, p) => s + (p.sobra || 0), 0);
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
    const coverageType = esFranjaPropia(pos as any)
        ? 'custom'
        : String(pos?.coverageType || 'custom').toLowerCase();
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
        shifts?: Array<{ code?: string; hours?: number; quantity?: number; startTime?: string; endTime?: string }>;
        activeDays?: string[];
        excludedShiftDates?: Record<string, string[]>;
        excludedShiftPaxDates?: Record<string, Record<string, number>>;
        paxBoostRanges?: Array<{ from: string; to: string; delta: number }>;
    },
    dayLetter: string,
    codeCounts: Record<string, number>,
    cycles?: string[],
    isActiveOnDay = true,
    dateStr?: string,
    turnos?: TurnoRelojCobertura[],
): PositionCoverageUnitResult {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const schemeLabel = positionSchemeLabelForDay(pos, dayLetter, cycles, dateStr);
    if (!isActiveOnDay) return { closed: 0, required: 0, schemeLabel };

    const coverageType = esFranjaPropia(pos as any)
        ? 'custom'
        : String(pos?.coverageType || 'custom').toLowerCase();
    if (coverageType === 'encargado') {
        return { closed: 0, required: 0, schemeLabel: 'Encargado (sin cobertura)' };
    }
    if (coverageType === 'eventos') {
        return { closed: 0, required: 0, schemeLabel: 'Eventos (extras, sin cobertura)' };
    }
    const allShifts = Array.isArray(pos?.shifts) ? pos.shifts : [];
    const fullSkip = new Set(
        dateStr && pos.excludedShiftDates?.[dateStr]
            ? (pos.excludedShiftDates[dateStr] || []).map((c) => String(c || '').toUpperCase()).filter(Boolean)
            : [],
    );
    const paxCuts: Record<string, number> = {};
    if (dateStr && pos.excludedShiftPaxDates?.[dateStr]) {
        for (const [code, n] of Object.entries(pos.excludedShiftPaxDates[dateStr])) {
            const c = String(code || '').toUpperCase();
            const cut = Math.floor(Number(n) || 0);
            if (c && cut > 0) paxCuts[c] = cut;
        }
    }
    const hasPaxCuts = Object.keys(paxCuts).length > 0;

    const effectiveBandQty = (code: string, shiftQty?: number): number => {
        const c = String(code || '').toUpperCase();
        if (!c || fullSkip.has(c)) return 0;
        const base = (shiftQty != null && Number(shiftQty) > 0)
            ? Math.max(1, Math.floor(Number(shiftQty)))
            : qty;
        const boost = dateStr ? paxBoostDeltaForDate(pos, dateStr) : 0;
        return Math.max(0, base - (paxCuts[c] || 0) + boost);
    };

    const pedidas = bandasExplicitas(allShifts, effectiveBandQty, fullSkip);
    if (pedidas.length > 0) {
        return cerrarPorCantidadDeBanda(String(pos.positionName || 'General'), schemeLabel, pedidas, codeCounts, turnos);
    }

    if (coverageType === '24hs' || coverageType === '24' || coverageType === '24h') {
        const bands8 = [...new Set(
            allShifts.filter(s => shiftBandHours(s) < 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
        )].filter((c) => effectiveBandQty(c) > 0);
        const bands12 = [...new Set(
            allShifts.filter(s => shiftBandHours(s) >= 12).map(s => String(s.code || '').toUpperCase()).filter(Boolean),
        )].filter((c) => effectiveBandQty(c) > 0);
        // Con cortes de PAX asimétricos, cerrar = cada banda alcanza su qty efectiva.
        if (hasPaxCuts) {
            const bands = (bands8.length > 0 ? bands8 : bands12.length > 0 ? bands12 : ['M', 'T', 'N'])
                .map((code) => ({ code, need: effectiveBandQty(code) }))
                .filter((b) => b.need > 0);
            if (bands.length === 0) return { closed: 0, required: 0, schemeLabel };
            const allFull = bands.every((b) => (codeCounts[b.code] || 0) >= b.need);
            return { closed: allFull ? 1 : 0, required: 1, schemeLabel };
        }
        const d12 = codeCounts.D12 || 0;
        const n12 = codeCounts.N12 || 0;
        const pares12 = Math.min(d12, n12);
        // D12 cubre 07–19 (M + mitad de T) y N12 cubre 19–07 (mitad de T + N).
        // El mínimo de esas franjas es la cantidad de unidades de 24 h, sin reutilizar gente.
        const acred8: Record<string, number> = {
            ...codeCounts,
            M: (codeCounts.M || 0) + d12,
            N: (codeCounts.N || 0) + n12,
            T: (codeCounts.T || 0) + pares12,
        };
        let closed = 0;
        const bands8Medidos = bands8.length > 0
            ? bands8
            : (bands12.length === 0 ? ['M', 'T', 'N'].filter((c) => !fullSkip.has(c)) : []);
        if (bands8Medidos.length > 0) {
            closed = Math.min(qty, closedUnitsFromBandScheme(acred8, bands8Medidos));
        }
        // El par ya está dentro de acred8. Sumarlo de nuevo cuenta dos veces a las mismas personas
        // (Casino: D12+N12 + M + N daba 2/2 con la tarde 15–23 en una sola persona).
        const contoParEn8 = bands8Medidos.some((c) => c === 'M' || c === 'T' || c === 'N');
        const counts12 = contoParEn8
            ? { ...codeCounts, D12: Math.max(0, d12 - pares12), N12: Math.max(0, n12 - pares12) }
            : codeCounts;
        if (closed < qty && bands12.length >= 2) {
            closed += Math.min(qty - closed, closedUnitsFromBandScheme(counts12, bands12));
        } else if (closed < qty && bands8.length === 0 && bands12.length === 0) {
            closed += Math.min(qty - closed, closedUnitsFromBandScheme(counts12, ['D12', 'N12'].filter((c) => !fullSkip.has(c))));
        }
        return { closed, required: qty, schemeLabel };
    }

    const eff = effectiveShiftsForPositionDay(pos as any, dayLetter, cycles, dateStr);
    const effBands: Array<{ code: string; quantity?: number }> = (eff.length > 0 ? eff : allShifts.filter(s => {
        if (Array.isArray((s as any).specificDates) && (s as any).specificDates.length > 0) {
            return dateStr ? (s as any).specificDates.includes(dateStr) : false;
        }
        if (Array.isArray((s as any).days) && (s as any).days.length > 0) return (s as any).days.includes(dayLetter) || correFeriado(s, dateStr);
        return true;
    })).map(s => ({ code: String((s as any).code || '').toUpperCase(), quantity: (s as any).quantity }))
        .filter((b) => b.code && !fullSkip.has(b.code) && effectiveBandQty(b.code, b.quantity) > 0);
    const bandCodes = effBands.map(b => b.code).filter(Boolean);
    if (bandCodes.length === 0) {
        const fallback = allShifts.map(s => String(s.code || '').toUpperCase()).filter((c) => c && !fullSkip.has(c));
        const closed = Math.min(qty, closedUnitsFromBandScheme(codeCounts, fallback));
        return { closed, required: qty, schemeLabel };
    }
    // Custom con PAX por turno (o corte parcial de PAX): 1 unidad cerrada = todos los turnos en su PAX efectivo.
    const hasPerShiftPax = effBands.some(b => b.quantity != null && Number(b.quantity) > 0) || hasPaxCuts;
    if (hasPerShiftPax) {
        const bandas = effBands
            .map(b => ({ code: b.code, tiene: codeCounts[b.code] || 0, pide: effectiveBandQty(b.code, b.quantity) }))
            .filter(b => b.pide > 0);
        const allFull = bandas.every(b => b.tiene >= b.pide);
        return { closed: allFull ? 1 : 0, required: 1, schemeLabel, bandas };
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
/**
 * Turno M/T/N en un puesto cuyo servicio llama a esa franja con otro código (Tadicor: PLM, P5N, P2T):
 * cuenta como esa franja si es la única de la banda en el puesto. Si no, queda el código del turno.
 */
export function codigoFranjaDelPuesto(pos: { shifts?: Array<{ code?: string }> } | undefined, code: string): string {
    const c = String(code || '').toUpperCase();
    if (!pos?.shifts?.length || !['M', 'T', 'N'].includes(c)) return c;
    const codigos = pos.shifts.map((s) => String(s.code || '').toUpperCase().replace(/\s+/g, ''));
    if (codigos.includes(c)) return c;
    const deBanda = codigos.filter((x) => !/D12$|N12$/.test(x) && (x.match(/^(?:P\d+|PL)?([MTN])\d*$/) || [])[1] === c);
    return deBanda.length === 1 ? deBanda[0] : c;
}

export function buildCodeCountsByPositionForDay(
    positions: Array<{ positionName?: string; shifts?: Array<{ code?: string }> }>,
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
        /** Créditos ya armados para este día (índice del mes). */
        splitCredits?: Record<string, Record<string, number>>;
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
        const codeRaw = String(raw.code || '').toUpperCase();
        if (PLANNING_NON_BILLABLE_CODES.has(codeRaw)) return;
        const shiftPos = String(raw.positionName || '').trim() || 'sin puesto';
        const code = codigoFranjaDelPuesto(positions.find((p) => String(p.positionName || 'General') === shiftPos), codeRaw);
        if (!byPos[shiftPos]) byPos[shiftPos] = {};
        byPos[shiftPos][code] = (byPos[shiftPos][code] || 0) + 1;
    });

    const splitCredits = options.splitCredits || collectSplitBandCreditsForDay(
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
