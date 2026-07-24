/**
 * Contingencia híbrida pax>1 sin RET: 1 rotación D12+N12 + 1 rotación M+T+N (24h + 24h).
 * Ej. pax=2 con 5 guardias: D12, N12, M, T, N — sin mezclar D12+D12+N12+M+T.
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { pickRepresentativeCycle } from './autoScheduleEngineV2';
import { countMissingBands8h } from './externalRetCoverage';
import { checkRestBetweenShifts, type AgreementRestConfig } from './restBetweenShifts';
import { SUVICO_POLICY } from './suvicoPolicy';

const WORK_8 = new Set(['M', 'T', 'N']);

const SHIFT_META: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
    M: { name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00' },
    T: { name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00' },
    N: { name: 'Noche', hours: 8, startTime: '23:00', endTime: '07:00' },
    D12: { name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00' },
    N12: { name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
};

export type HybridContingencyAction = {
    dateStr: string;
    positionName: string;
    d12EmpId: string;
    n12EmpId: string;
    modo8Assignments: Array<{ empId: string; band: string }>;
};

function makeRestCfg(ctx: V2EngineContext): AgreementRestConfig {
    const { cL } = pickRepresentativeCycle(ctx.autoCycles || []);
    return {
        minRestBetweenShiftsHours: SUVICO_POLICY.REST.DAILY_MIN_HOURS,
        longRestAfterWorkedHours: SUVICO_POLICY.REST.STREAK_HOURS_FOR_LONG_REST,
        minLongRestHours: SUVICO_POLICY.REST.WEEKLY_MIN_REST_AFTER_STREAK_HOURS,
        maxConsecutiveWorkDays: cL,
    };
}

function makeGetShift(
    assignments: V2Assignment[],
    absences: V2EngineContext['absences'],
): (empId: string, dateStr: string) => { code: string; startTime: string; hours: number } | null {
    const idx = new Map<string, V2Assignment>();
    assignments.forEach((a) => idx.set(`${a.empId}__${a.dateStr}`, a));
    return (empId, dateStr) => {
        const abs = absences[empId]?.get(dateStr);
        if (abs) return { code: abs, startTime: '00:00', hours: 0 };
        const a = idx.get(`${empId}__${dateStr}`);
        if (!a) return null;
        const c = String(a.code || '').toUpperCase();
        if (c === 'RET' || ['F', 'FF', 'FP', 'FT'].includes(c)) return { code: c, startTime: '00:00', hours: 0 };
        const meta = SHIFT_META[c];
        return {
            code: c,
            startTime: a.startTime || meta?.startTime || '07:00',
            hours: Number(a.hours) || meta?.hours || 8,
        };
    };
}

function canPromoteTo12(
    empId: string,
    dateStr: string,
    targetCode: 'D12' | 'N12',
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
): boolean {
    if (ctx.absences[empId]?.has(dateStr)) return false;
    const meta = SHIFT_META[targetCode];
    const violation = checkRestBetweenShifts({
        empId,
        targetDateStr: dateStr,
        proposed: { code: targetCode, startTime: meta.startTime, hours: meta.hours },
        getShift: makeGetShift(assignments, ctx.absences),
        cfg,
    });
    return violation === null;
}

function setAssignmentCode(
    assignments: V2Assignment[],
    empId: string,
    dateStr: string,
    code: string,
    positionName: string,
): void {
    const meta = SHIFT_META[code] || { name: code, hours: 8, startTime: '07:00', endTime: '15:00' };
    const existing = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
    if (existing) {
        existing.code = code;
        existing.name = meta.name;
        existing.hours = meta.hours;
        existing.startTime = meta.startTime;
        existing.endTime = meta.endTime;
        existing.isFranco = false;
        existing.isReten = false;
        existing.positionName = positionName;
        return;
    }
    assignments.push({
        empId,
        dateStr,
        positionName,
        code,
        name: meta.name,
        hours: meta.hours,
        startTime: meta.startTime,
        endTime: meta.endTime,
        isFranco: false,
        isReten: false,
    });
}

function workRowsAtPosition(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    exclude: Set<string>,
): V2Assignment[] {
    return assignments.filter((a) => {
        if (a.dateStr !== dateStr || a.positionName !== positionName) return false;
        if (exclude.has(a.empId)) return false;
        return WORK_8.has(String(a.code || '').toUpperCase());
    });
}

function pickD12N12Candidates(
    workRows: V2Assignment[],
    assignments: V2Assignment[],
    dateStr: string,
    ctx: V2EngineContext,
    cfg: AgreementRestConfig,
): { d12: V2Assignment; n12: V2Assignment } | null {
    const mRows = workRows.filter((a) => String(a.code).toUpperCase() === 'M');
    const nRows = workRows.filter((a) => String(a.code).toUpperCase() === 'N');

    const pairs: Array<{ d12: V2Assignment; n12: V2Assignment }> = [];
    for (const m of mRows) {
        for (const n of nRows) {
            if (m.empId !== n.empId) pairs.push({ d12: m, n12: n });
        }
    }
    for (const p of workRows) {
        for (const q of workRows) {
            if (p.empId !== q.empId && !pairs.some((x) => x.d12.empId === p.empId && x.n12.empId === q.empId)) {
                pairs.push({ d12: p, n12: q });
            }
        }
    }

    for (const pair of pairs) {
        if (
            canPromoteTo12(pair.d12.empId, dateStr, 'D12', assignments, ctx, cfg)
            && canPromoteTo12(pair.n12.empId, dateStr, 'N12', assignments, ctx, cfg)
        ) {
            return pair;
        }
    }

    return pairs[0] ?? null;
}

function assignModo8Triple(
    assignments: V2Assignment[],
    pool: V2Assignment[],
    dateStr: string,
    positionName: string,
): Array<{ empId: string; band: string }> | null {
    if (pool.length < 3) return null;
    const workers = pool.slice(0, 3);
    const bands = ['M', 'T', 'N'] as const;
    const used = new Set<string>();
    const out: Array<{ empId: string; band: string }> = [];

    for (const band of bands) {
        const match = workers.find(
            (w) => !used.has(w.empId) && String(w.code).toUpperCase() === band,
        );
        const pick = match || workers.find((w) => !used.has(w.empId));
        if (!pick) return null;
        used.add(pick.empId);
        setAssignmentCode(assignments, pick.empId, dateStr, band, positionName);
        out.push({ empId: pick.empId, band });
    }

    return out;
}

function hybridCoversPax(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    pax: number,
): boolean {
    let m = 0;
    let t = 0;
    let n = 0;
    let d12 = 0;
    let n12 = 0;
    for (const a of assignments) {
        if (a.dateStr !== dateStr || a.positionName !== positionName) continue;
        const c = String(a.code || '').toUpperCase();
        if (c === 'M') m++;
        else if (c === 'T') t++;
        else if (c === 'N') n++;
        else if (c === 'D12') d12++;
        else if (c === 'N12') n12++;
    }
    const pairs = Math.min(d12, n12);
    return m + pairs >= pax && t + pairs >= pax && n + pairs >= pax;
}

/**
 * Sin RET: reorganiza 5 guardias en D12+N12 (rotación 12h) + M+T+N (rotación 8h).
 */
export function tryApplyHybridPaxContingency(
    assignments: V2Assignment[],
    ctx: V2EngineContext,
    dateStr: string,
    positionName: string,
    excludeEmpIds: Set<string>,
): HybridContingencyAction | null {
    const pos = ctx.positions.find((p) => p.positionName === positionName);
    const pax = Math.max(1, Number(pos?.qty) || 1);
    if (pax < 2) return null;

    const missing = countMissingBands8h(assignments, ctx, dateStr, positionName);
    if (missing.length === 0 || missing.length >= 3) return null;

    const minWorkers = pax + 3;
    const workRows = workRowsAtPosition(assignments, dateStr, positionName, excludeEmpIds);
    if (workRows.length < minWorkers) return null;

    const cfg = makeRestCfg(ctx);
    const pair = pickD12N12Candidates(workRows, assignments, dateStr, ctx, cfg);
    if (!pair) return null;

    const usedIds = new Set([pair.d12.empId, pair.n12.empId]);
    const remaining = workRows.filter((a) => !usedIds.has(a.empId));
    const modo8Assignments = assignModo8Triple(assignments, remaining, dateStr, positionName);
    if (!modo8Assignments) return null;

    setAssignmentCode(assignments, pair.d12.empId, dateStr, 'D12', positionName);
    setAssignmentCode(assignments, pair.n12.empId, dateStr, 'N12', positionName);

    if (!hybridCoversPax(assignments, dateStr, positionName, pax)) return null;

    return {
        dateStr,
        positionName,
        d12EmpId: pair.d12.empId,
        n12EmpId: pair.n12.empId,
        modo8Assignments,
    };
}
