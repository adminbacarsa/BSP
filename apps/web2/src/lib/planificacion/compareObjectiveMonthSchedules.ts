/**
 * Comparación de cobertura y nomenclatura entre dos meses del mismo objetivo.
 * Usa la misma lógica que el diagnóstico de cobertura en planificación.
 */

import type { PlanningShiftCell } from './planningCoverageWisdom';
import {
    analyzeObjectiveCoverageGaps,
    type ObjectiveCoverageGapReport,
} from './coverageGapAnalysis';
import { effectiveShiftsForPositionDay } from './autoScheduleEngineV2';
import type { V2PositionDef } from './autoScheduleEngineV2';
import { PLANNING_NON_BILLABLE_CODES } from './positionCoverageUnits';

export interface MonthScheduleCoverageInput {
    objectiveId: string;
    positions: V2PositionDef[];
    days: Array<{ dateStr: string; dayLetter: string }>;
    cells: PlanningShiftCell[];
    cycles?: string[];
    isPosActiveOnDay?: (pos: V2PositionDef, dayLetter: string) => boolean;
}

export interface NomenclatureViolation {
    dateStr: string;
    employeeId: string;
    positionName: string;
    code: string;
    reason: string;
}

export interface MonthCoverageSummary {
    objectiveId: string;
    closed: number;
    required: number;
    daysFull: number;
    daysPartial: number;
    daysEmpty: number;
    gapReport: ObjectiveCoverageGapReport;
    nomenclatureViolations: NomenclatureViolation[];
}

function dayLetterFromDateStr(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00`);
    const map = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
    return map[d.getDay()];
}

export function buildCodeCountsByDayFromCells(
    cells: PlanningShiftCell[],
    objectiveId: string,
): Record<string, Record<string, Record<string, number>>> {
    const byDay: Record<string, Record<string, Record<string, number>>> = {};
    for (const cell of cells) {
        if (cell.objectiveId !== objectiveId) continue;
        const dateStr = cell.dateStr;
        const code = String(cell.code || '').toUpperCase().trim();
        if (!code || PLANNING_NON_BILLABLE_CODES.has(code)) continue;
        const pos = String(cell.positionName || '').trim() || 'General';
        if (!byDay[dateStr]) byDay[dateStr] = {};
        if (!byDay[dateStr][pos]) byDay[dateStr][pos] = {};
        byDay[dateStr][pos][code] = (byDay[dateStr][pos][code] || 0) + 1;
    }
    return byDay;
}

function allowedCodesForPositionOnDay(
    pos: V2PositionDef,
    dayLetter: string,
    cycles?: string[],
    dateStr?: string,
): Set<string> {
    const eff = effectiveShiftsForPositionDay(pos, dayLetter, cycles, dateStr);
    const codes = eff.map((s) => String(s.code || '').toUpperCase()).filter(Boolean);
    if (codes.length === 0) {
        (pos.shifts || []).forEach((s) => {
            const c = String(s.code || '').toUpperCase();
            if (c) codes.push(c);
        });
    }
    return new Set(codes);
}

export function findNomenclatureViolations(
    positions: V2PositionDef[],
    cells: PlanningShiftCell[],
    objectiveId: string,
    cycles?: string[],
): NomenclatureViolation[] {
    const posByName = new Map(positions.map((p) => [p.positionName, p]));
    const out: NomenclatureViolation[] = [];

    for (const cell of cells) {
        if (cell.objectiveId !== objectiveId) continue;
        const code = String(cell.code || '').toUpperCase().trim();
        if (!code || PLANNING_NON_BILLABLE_CODES.has(code)) continue;

        const posName = String(cell.positionName || '').trim();
        if (!posName) {
            out.push({
                dateStr: cell.dateStr,
                employeeId: cell.employeeId,
                positionName: '',
                code,
                reason: 'Turno de trabajo sin positionName (no se puede validar puesto+turno SLA)',
            });
            continue;
        }

        const pos = posByName.get(posName);
        if (!pos) {
            out.push({
                dateStr: cell.dateStr,
                employeeId: cell.employeeId,
                positionName: posName,
                code,
                reason: `Puesto «${posName}» no está en el SLA vigente`,
            });
            continue;
        }

        const dayLetter = dayLetterFromDateStr(cell.dateStr);
        const allowed = allowedCodesForPositionOnDay(pos, dayLetter, cycles, cell.dateStr);
        if (allowed.size > 0 && !allowed.has(code)) {
            const allowedList = [...allowed].sort().join(', ');
            out.push({
                dateStr: cell.dateStr,
                employeeId: cell.employeeId,
                positionName: posName,
                code,
                reason: `Código «${code}» no habilitado en «${posName}» ese día (válidos: ${allowedList})`,
            });
        }
    }

    return out;
}

export function summarizeMonthScheduleCoverage(input: MonthScheduleCoverageInput): MonthCoverageSummary {
    const codeCountsByDay = buildCodeCountsByDayFromCells(input.cells, input.objectiveId);
    const gapReport = analyzeObjectiveCoverageGaps(
        input.positions,
        input.days,
        codeCountsByDay,
        input.cycles,
        input.isPosActiveOnDay,
    );
    const nomenclatureViolations = findNomenclatureViolations(
        input.positions,
        input.cells,
        input.objectiveId,
        input.cycles,
    );

    return {
        objectiveId: input.objectiveId,
        closed: gapReport.closed,
        required: gapReport.required,
        daysFull: gapReport.daysFull,
        daysPartial: gapReport.daysPartial,
        daysEmpty: gapReport.daysEmpty,
        gapReport,
        nomenclatureViolations,
    };
}

export interface CompareObjectiveMonthsResult {
    reference: MonthCoverageSummary;
    compare: MonthCoverageSummary;
    /** Días donde el mes comparado tiene menos unidades cerradas que la referencia. */
    daysWorseThanReference: Array<{
        dateStr: string;
        refClosed: number;
        refRequired: number;
        cmpClosed: number;
        cmpRequired: number;
    }>;
    /** Días con huecos solo en el mes comparado. */
    daysWithGapsInCompareOnly: Array<{
        dateStr: string;
        closed: number;
        required: number;
        missing: number;
    }>;
}

export function compareObjectiveMonthSchedules(
    reference: MonthScheduleCoverageInput,
    compare: MonthScheduleCoverageInput,
): CompareObjectiveMonthsResult {
    const refSum = summarizeMonthScheduleCoverage(reference);
    const cmpSum = summarizeMonthScheduleCoverage(compare);

    const daysWorseThanReference: CompareObjectiveMonthsResult['daysWorseThanReference'] = [];
    const daysWithGapsInCompareOnly: CompareObjectiveMonthsResult['daysWithGapsInCompareOnly'] = [];

    for (const day of compare.days) {
        const ds = day.dateStr;
        const refDay = refSum.gapReport.byDay[ds];
        const cmpDay = cmpSum.gapReport.byDay[ds];
        if (!cmpDay) continue;

        if (refDay && cmpDay.closed < refDay.closed && cmpDay.required > 0) {
            daysWorseThanReference.push({
                dateStr: ds,
                refClosed: refDay.closed,
                refRequired: refDay.required,
                cmpClosed: cmpDay.closed,
                cmpRequired: cmpDay.required,
            });
        }

        if (cmpDay.required > 0 && !cmpDay.isFull) {
            daysWithGapsInCompareOnly.push({
                dateStr: ds,
                closed: cmpDay.closed,
                required: cmpDay.required,
                missing: cmpDay.required - cmpDay.closed,
            });
        }
    }

    return {
        reference: refSum,
        compare: cmpSum,
        daysWorseThanReference,
        daysWithGapsInCompareOnly,
    };
}

export function formatCompareObjectiveMonthsReport(
    result: CompareObjectiveMonthsResult,
    labels?: { reference?: string; compare?: string },
): string {
    const refLabel = labels?.reference ?? 'Referencia';
    const cmpLabel = labels?.compare ?? 'Comparado';
    const lines: string[] = [];

    lines.push(`=== ${refLabel} ===`);
    lines.push(
        `Cobertura: ${result.reference.closed}/${result.reference.required} unidades · `
        + `días OK ${result.reference.daysFull} · parcial ${result.reference.daysPartial} · vacío ${result.reference.daysEmpty}`,
    );
    lines.push(`Nomenclatura inválida: ${result.reference.nomenclatureViolations.length} celda(s)`);

    lines.push(`=== ${cmpLabel} ===`);
    lines.push(
        `Cobertura: ${result.compare.closed}/${result.compare.required} unidades · `
        + `días OK ${result.compare.daysFull} · parcial ${result.compare.daysPartial} · vacío ${result.compare.daysEmpty}`,
    );
    lines.push(`Nomenclatura inválida: ${result.compare.nomenclatureViolations.length} celda(s)`);

    if (result.daysWithGapsInCompareOnly.length > 0) {
        lines.push(`--- Huecos en ${cmpLabel} (${result.daysWithGapsInCompareOnly.length} días) ---`);
        for (const d of result.daysWithGapsInCompareOnly.slice(0, 15)) {
            lines.push(`  ${d.dateStr}: ${d.closed}/${d.required} (faltan ${d.missing})`);
        }
        if (result.daysWithGapsInCompareOnly.length > 15) {
            lines.push(`  … +${result.daysWithGapsInCompareOnly.length - 15} días más`);
        }
    }

    if (result.compare.nomenclatureViolations.length > 0) {
        lines.push(`--- Nomenclatura inválida en ${cmpLabel} (muestra) ---`);
        for (const v of result.compare.nomenclatureViolations.slice(0, 12)) {
            lines.push(`  ${v.dateStr} ${v.positionName || '?'} code=${v.code}: ${v.reason}`);
        }
    }

    const worst = result.compare.gapReport.worstDays;
    if (worst?.length) {
        lines.push('--- Peores días (comparado) ---');
        for (const w of worst.slice(0, 8)) {
            lines.push(`  ${w.dateStr}: ${w.closed}/${w.required}`);
        }
    }

    return lines.join('\n');
}
