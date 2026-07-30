/**
 * Cobertura de huecos SLA en puestos CUSTOM mediante guardias volante.
 * Prioridad COSP en objetivos mixtos: volante en RET → volante sin turno.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';
import { rankReplacementCandidates } from './coverageCandidateRank';
import {
    analyzeCoveragePolicyBalance,
    type CoveragePolicyBalanceReport,
    type CoverageSlotImbalance,
} from './coveragePolicyBalance';

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

export type VolanteCoverageAction = {
    dateStr: string;
    empId: string;
    positionName: string;
    band: string;
    reason: 'volante_ret' | 'volante_st';
};

function shiftMetaForGap(
    ctx: V2EngineContext,
    positionName: string,
    band: string,
): { name: string; hours: number; startTime: string } {
    const pos = ctx.positions.find((p) => p.positionName === positionName);
    const code = band.toUpperCase();
    const sh = pos?.shifts?.find((s) => String(s.code || '').toUpperCase() === code);
    if (sh) {
        return {
            name: String(sh.name || sh.code || code),
            hours: Number(sh.hours) || 8,
            startTime: String(sh.startTime || '07:00'),
        };
    }
    const defaults: Record<string, { name: string; hours: number; startTime: string }> = {
        M: { name: 'Mañana', hours: 8, startTime: '07:00' },
        T: { name: 'Tarde', hours: 8, startTime: '15:00' },
        N: { name: 'Noche', hours: 8, startTime: '23:00' },
    };
    return defaults[code] ?? { name: code, hours: 8, startTime: '07:00' };
}

/** Guardias con `volante[]` que incluye el objetivo actual y no son titulares del mismo. */
export function collectVolanteEmpIds(ctx: V2EngineContext): Set<string> {
    if (!ctx.objectiveId) return new Set();
    return new Set(
        ctx.employees
            .filter((e) =>
                e.preferredObjectiveId !== ctx.objectiveId
                && (e.volante || []).includes(ctx.objectiveId!),
            )
            .map((e) => e.id),
    );
}

function isVolanteRetCell(cell: V2Assignment | undefined): boolean {
    if (!cell) return false;
    const code = String(cell.code || '').toUpperCase();
    return code === 'RET' || cell.isReten === true;
}

function cellsForDay(
    assignments: V2Assignment[],
    empId: string,
    dateStr: string,
): V2Assignment[] {
    return assignments.filter((a) => a.empId === empId && a.dateStr === dateStr);
}

function pickVolanteCell(cells: V2Assignment[]): V2Assignment | undefined {
    if (cells.length === 0) return undefined;
    return cells.find((c) => isVolanteRetCell(c)) ?? cells[0];
}

function isVolanteRetOnDay(assignments: V2Assignment[], empId: string, dateStr: string): boolean {
    return cellsForDay(assignments, empId, dateStr).some((c) => isVolanteRetCell(c));
}

function isFreeForVolanteOnDay(assignments: V2Assignment[], empId: string, dateStr: string): boolean {
    const cells = cellsForDay(assignments, empId, dateStr);
    if (cells.length === 0) return true;
    return cells.every((c) => {
        const code = String(c.code || '').toUpperCase();
        if (ABSENCE_CODES.has(code)) return false;
        return NON_BILLABLE.has(code) && (Number(c.hours) || 0) === 0;
    });
}

function assignVolanteToGap(
    assignments: V2Assignment[],
    empId: string,
    gap: CoverageSlotImbalance,
    ctx: V2EngineContext,
): void {
    const band = gap.shiftCode.toUpperCase();
    const meta = shiftMetaForGap(ctx, gap.positionName, band);
    const dayCells = cellsForDay(assignments, empId, gap.dateStr);
    const existing = pickVolanteCell(dayCells);
    if (existing) {
        existing.code = band;
        existing.name = meta.name;
        existing.hours = meta.hours;
        existing.startTime = meta.startTime;
        existing.positionName = gap.positionName;
        existing.isFranco = false;
        existing.isReten = false;
        delete existing.endTime;
        for (const dup of dayCells) {
            if (dup === existing) continue;
            dup.code = 'F';
            dup.name = 'Franco';
            dup.hours = 0;
            dup.startTime = '00:00';
            dup.positionName = '';
            dup.isFranco = true;
            dup.isReten = false;
        }
        return;
    }
    assignments.push({
        empId,
        dateStr: gap.dateStr,
        positionName: gap.positionName,
        code: band,
        name: meta.name,
        hours: meta.hours,
        startTime: meta.startTime,
        isFranco: false,
        isReten: false,
    });
}

/**
 * Cierra huecos de puestos CUSTOM con volantes en RET (1.ª opción) o sin turno.
 */
export function fillCustomGapsFromVolantes(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    stats?: Pick<V2GenerateStats, 'positionGroups'>;
    positionFilter?: string;
    usedVolanteByDay?: Map<string, Set<string>>;
}): {
    assignments: V2Assignment[];
    actions: VolanteCoverageAction[];
    usedVolanteByDay: Map<string, Set<string>>;
    report: CoveragePolicyBalanceReport;
} {
    const result = params.assignments.map((a) => ({ ...a }));
    const actions: VolanteCoverageAction[] = [];
    const usedVolanteByDay = params.usedVolanteByDay ?? new Map<string, Set<string>>();
    const volanteSet = collectVolanteEmpIds(params.ctx);

    if (volanteSet.size === 0) {
        return {
            assignments: result,
            actions,
            usedVolanteByDay,
            report: analyzeCoveragePolicyBalance(params.ctx, result),
        };
    }

    const customPosNames = new Set(
        params.ctx.positions.filter(isCustomCoverPosition).map((p) => p.positionName),
    );
    if (customPosNames.size === 0) {
        return {
            assignments: result,
            actions,
            usedVolanteByDay,
            report: analyzeCoveragePolicyBalance(params.ctx, result),
        };
    }

    const positionFilter = params.positionFilter?.trim();
    let report = analyzeCoveragePolicyBalance(params.ctx, result);

    const sortedGaps = [...report.underCoverage]
        .filter((g) => customPosNames.has(g.positionName))
        .filter((g) => !positionFilter || g.positionName === positionFilter)
        .sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.positionName.localeCompare(b.positionName));

    const volanteRankedBase = rankReplacementCandidates([...volanteSet], params.ctx, {
        positionName: positionFilter || '',
        positionGroup: positionFilter
            ? (params.stats?.positionGroups?.[positionFilter] ?? [])
            : [],
    });

    for (const gap of sortedGaps) {
        const need = Math.abs(gap.delta);
        if (need <= 0) continue;

        const used = usedVolanteByDay.get(gap.dateStr) ?? new Set<string>();
        const volanteRanked = rankReplacementCandidates(volanteRankedBase, params.ctx, {
            positionName: gap.positionName,
            dateStr: gap.dateStr,
            positionGroup: params.stats?.positionGroups?.[gap.positionName] ?? [],
            shiftCode: gap.shiftCode,
        });

        let filled = 0;

        for (const empId of volanteRanked) {
            if (filled >= need) break;
            if (used.has(empId)) continue;
            if (params.ctx.absences[empId]?.has(gap.dateStr)) continue;

            const retAvailable = isVolanteRetOnDay(result, empId, gap.dateStr);
            const freeAvailable = isFreeForVolanteOnDay(result, empId, gap.dateStr);
            if (!retAvailable && !freeAvailable) continue;

            const reason: VolanteCoverageAction['reason'] = retAvailable
                ? 'volante_ret'
                : 'volante_st';

            assignVolanteToGap(result, empId, gap, params.ctx);
            used.add(empId);
            usedVolanteByDay.set(gap.dateStr, used);
            actions.push({
                dateStr: gap.dateStr,
                empId,
                positionName: gap.positionName,
                band: gap.shiftCode,
                reason,
            });
            filled += 1;
            report = analyzeCoveragePolicyBalance(params.ctx, result);
        }
    }

    report = analyzeCoveragePolicyBalance(params.ctx, result);
    return { assignments: result, actions, usedVolanteByDay, report };
}
