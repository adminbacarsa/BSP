/**
 * Política de cobertura COSP — equilibrio día × puesto × banda.
 *
 * Complementa `verifyScheduleCoverage` (solo detecta faltantes) con:
 *  · huecos (have < qty)
 *  · sobrecobertura (have > qty)
 *  · reparación: excedentes en RET/F si duplican banda ya cubierta
 *
 * Reglas alineadas con `ABSENCE_COVERAGE_PRIORITY_STEPS` en planningCoveragePolicy.ts.
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { effectiveShiftsForPositionDay, isCustomCoverPosition, positionIsActiveOn } from './autoScheduleEngineV2';
import { isModo12Day } from './objectiveCoverageDemand';
import type { SurplusAbsentSubstitutionAction } from './surplusAbsentSubstitution';

const NON_BILLABLE = new Set(['F', 'FF', 'FP', 'FT', 'RET']);
const ABSENCE_CODES = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);
const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export type CoverageSlotKey = {
    dateStr: string;
    positionName: string;
    shiftCode: string;
    dayLetter: string;
    qtyRequired: number;
};

export type CoverageSlotImbalance = CoverageSlotKey & {
    qtyAssigned: number;
    delta: number;
    kind: 'under' | 'over';
    assigneeEmpIds: string[];
};

export type CoveragePolicyBalanceReport = {
    ok: boolean;
    totalSlots: number;
    balancedSlots: number;
    underCoverage: CoverageSlotImbalance[];
    overCoverage: CoverageSlotImbalance[];
    underSlotCount: number;
    overSlotCount: number;
    summary: string;
};

export type UncoveredSlotDayEntry = { positionName: string; code: string; missing: number };

/** Deriva huecos SLA por día desde el balance post-proceso (fuente de verdad en grilla). */
export function buildUncoveredSlotsByDayFromBalance(
    report: CoveragePolicyBalanceReport,
): Record<string, UncoveredSlotDayEntry[]> {
    const acc = new Map<string, Map<string, UncoveredSlotDayEntry>>();

    for (const u of report.underCoverage) {
        const missing = Math.abs(u.delta);
        if (missing <= 0) continue;
        if (!acc.has(u.dateStr)) acc.set(u.dateStr, new Map());
        const dayMap = acc.get(u.dateStr)!;
        const key = `${u.positionName}__${u.shiftCode}`;
        const prev = dayMap.get(key);
        if (prev) {
            prev.missing += missing;
        } else {
            dayMap.set(key, {
                positionName: u.positionName,
                code: u.shiftCode,
                missing,
            });
        }
    }

    const out: Record<string, UncoveredSlotDayEntry[]> = {};
    for (const [dateStr, dayMap] of acc.entries()) {
        out[dateStr] = [...dayMap.values()];
    }
    return out;
}

export function uncoveredSlotCountFromBalance(report: CoveragePolicyBalanceReport): number {
    return report.underSlotCount;
}

function normBand(code: string): string {
    const c = String(code || '').toUpperCase();
    if (c === 'D12') return 'M';
    if (c === 'N12') return 'N';
    return c;
}

function slotKey(dateStr: string, positionName: string, shiftCode: string): string {
    return `${dateStr}__${positionName}__${shiftCode}`;
}

function buildDemandSlots(ctx: V2EngineContext): CoverageSlotKey[] {
    const slots: CoverageSlotKey[] = [];
    ctx.daysInMonth.forEach((d) => {
        const dateStr = ctx.getDateKey(d);
        const dayLetter = ctx.getDayLetter(dateStr) || DAY_LETTERS[d.getDay()];
        ctx.positions.forEach((pos) => {
            if (pos.excludedDates?.includes(dateStr)) return;
            if (!positionIsActiveOn(pos, dayLetter, dateStr)) return;
            const qty = Number(pos.qty) || 0;
            if (!qty) return;
            const modo12Day = !isCustomCoverPosition(pos) && isModo12Day(dateStr, ctx);
            let eff = modo12Day
                ? (pos.shifts || []).filter((sh) => {
                    const code = String(sh.code || '').toUpperCase();
                    return code === 'D12' || code === 'N12';
                })
                : effectiveShiftsForPositionDay(pos, dayLetter, ctx.autoCycles, dateStr);
            if (modo12Day && eff.length === 0) {
                eff = [
                    { code: 'D12', name: 'Diurno 12h', hours: 12 },
                    { code: 'N12', name: 'Nocturno 12h', hours: 12 },
                ];
            }
            eff.forEach((sh) => {
                const code = String(sh.code || '').toUpperCase();
                if (!code || NON_BILLABLE.has(code) || ABSENCE_CODES.has(code)) return;
                slots.push({
                    dateStr,
                    positionName: pos.positionName,
                    shiftCode: code,
                    dayLetter,
                    qtyRequired: qty,
                });
            });
        });
    });
    return slots;
}

function indexBillableAssignments(
    assignments: V2Assignment[],
    inferModo12T: boolean,
    ctx: V2EngineContext,
): Map<string, string[]> {
    const bySlot = new Map<string, string[]>();

    const push = (dateStr: string, positionName: string, shiftCode: string, empId: string) => {
        const k = slotKey(dateStr, positionName, shiftCode);
        const list = bySlot.get(k) ?? [];
        if (!list.includes(empId)) list.push(empId);
        bySlot.set(k, list);
    };

    assignments.forEach((a) => {
        const c = String(a.code || '').toUpperCase();
        if (!c || NON_BILLABLE.has(c) || ABSENCE_CODES.has(c)) return;
        if (!a.positionName) return;
        push(a.dateStr, a.positionName, c, a.empId);
        const normalized = normBand(c);
        if (normalized !== c) {
            push(a.dateStr, a.positionName, normalized, a.empId);
        }
    });

    if (inferModo12T) {
        const ext12Count: Record<string, number> = {};
        assignments.forEach((a) => {
            const c = String(a.code || '').toUpperCase();
            if (!a.positionName || (c !== 'D12' && c !== 'N12')) return;
            const k = `${a.dateStr}__${a.positionName}__${c}`;
            ext12Count[k] = (ext12Count[k] || 0) + 1;
        });
        ctx.positions.forEach((pos) => {
            const pqty = Math.max(1, Number(pos.qty) || 1);
            ctx.daysInMonth.forEach((d) => {
                const dateStr = ctx.getDateKey(d);
                const kT = slotKey(dateStr, pos.positionName, 'T');
                const d12Have = ext12Count[`${dateStr}__${pos.positionName}__D12`] ?? 0;
                const n12Have = ext12Count[`${dateStr}__${pos.positionName}__N12`] ?? 0;
                const tList = bySlot.get(kT) ?? [];
                const tHave = tList.length;
                const hybridPairs = Math.min(d12Have, n12Have);
                if (hybridPairs > 0 && hybridPairs < pqty && tHave < pqty) {
                    const tInfer = Math.min(hybridPairs, pqty - tHave);
                    for (let i = 0; i < tInfer; i++) {
                        push(dateStr, pos.positionName, 'T', `__inferred_t_${i}`);
                    }
                } else if (d12Have >= pqty && n12Have >= pqty && tHave === 0) {
                    for (let i = 0; i < pqty; i++) {
                        push(dateStr, pos.positionName, 'T', `__inferred_t_${i}`);
                    }
                }
            });
        });
    }

    return bySlot;
}

export function analyzeCoveragePolicyBalance(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    options?: { inferModo12TCoverage?: boolean },
): CoveragePolicyBalanceReport {
    const inferModo12T = options?.inferModo12TCoverage !== false;
    const demand = buildDemandSlots(ctx);
    const bySlot = indexBillableAssignments(assignments, inferModo12T, ctx);

    const underCoverage: CoverageSlotImbalance[] = [];
    const overCoverage: CoverageSlotImbalance[] = [];
    let balancedSlots = 0;

    for (const slot of demand) {
        const k = slotKey(slot.dateStr, slot.positionName, slot.shiftCode);
        const assignees = (bySlot.get(k) ?? []).filter((id) => !id.startsWith('__inferred_'));
        const qtyAssigned = assignees.length;
        const delta = qtyAssigned - slot.qtyRequired;

        if (delta < 0) {
            underCoverage.push({
                ...slot,
                qtyAssigned,
                delta,
                kind: 'under',
                assigneeEmpIds: assignees,
            });
        } else if (delta > 0) {
            overCoverage.push({
                ...slot,
                qtyAssigned,
                delta,
                kind: 'over',
                assigneeEmpIds: assignees,
            });
        } else {
            balancedSlots += 1;
        }
    }

    const underSlotCount = underCoverage.reduce((s, u) => s + Math.abs(u.delta), 0);
    const overSlotCount = overCoverage.reduce((s, o) => s + o.delta, 0);
    const ok = underSlotCount === 0 && overSlotCount === 0;

    let summary: string;
    if (ok) {
        summary = `Cobertura equilibrada: ${balancedSlots}/${demand.length} slots día×puesto×banda OK.`;
    } else {
        const parts: string[] = [];
        if (underSlotCount > 0) parts.push(`${underSlotCount} banda(s) con falta`);
        if (overSlotCount > 0) parts.push(`${overSlotCount} banda(s) con sobrecobertura`);
        summary = parts.join(' · ');
    }

    return {
        ok,
        totalSlots: demand.length,
        balancedSlots,
        underCoverage,
        overCoverage,
        underSlotCount,
        overSlotCount,
        summary,
    };
}

export type CoverageBalanceRepairAction = {
    dateStr: string;
    empId: string;
    positionName: string;
    band: string;
    fromCode: string;
    toCode: string;
    reason: 'surplus_overstaff_demote';
};

/**
 * Repara sobrecobertura: si un slot tiene más asignados que qty, los excedentes del pool
 * pasan a RET/F. Solo afecta legajos del pool excedente.
 */
export function repairCoverageOverstaffFromSurplus(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    surplusPool: string[];
    substitutionActions?: SurplusAbsentSubstitutionAction[];
    inferModo12TCoverage?: boolean;
}): { assignments: V2Assignment[]; actions: CoverageBalanceRepairAction[]; report: CoveragePolicyBalanceReport } {
    const result = params.assignments.map((a) => ({ ...a }));
    const surplusSet = new Set(params.surplusPool);
    const actions: CoverageBalanceRepairAction[] = [];

    const reportBefore = analyzeCoveragePolicyBalance(params.ctx, result, {
        inferModo12TCoverage: params.inferModo12TCoverage,
    });

    for (const over of reportBefore.overCoverage) {
        const excess = over.delta;
        if (excess <= 0) continue;

        const candidates = over.assigneeEmpIds
            .map((empId) => {
                const a = result.find((x) =>
                    x.empId === empId
                    && x.dateStr === over.dateStr
                    && x.positionName === over.positionName
                    && normBand(String(x.code || '')) === normBand(over.shiftCode),
                );
                if (!a) return null;
                return { empId, assignment: a };
            })
            .filter((x): x is NonNullable<typeof x> => x != null);

        let removed = 0;
        for (const cand of candidates) {
            if (removed >= excess) break;
            if (!surplusSet.has(cand.empId)) continue;

            const fromCode = String(cand.assignment.code || '').toUpperCase();
            const idx = result.indexOf(cand.assignment);
            if (idx >= 0) result.splice(idx, 1);

            actions.push({
                dateStr: over.dateStr,
                empId: cand.empId,
                positionName: over.positionName,
                band: over.shiftCode,
                fromCode,
                toCode: '—',
                reason: 'surplus_overstaff_demote',
            });
            removed += 1;
        }
    }

    const report = analyzeCoveragePolicyBalance(params.ctx, result, {
        inferModo12TCoverage: params.inferModo12TCoverage,
    });

    return { assignments: result, actions, report };
}

export function coveragePolicyBalanceLabelEs(report: CoveragePolicyBalanceReport): string {
    if (report.ok) return report.summary;
    const underDays = new Set(report.underCoverage.map((u) => u.dateStr)).size;
    const overDays = new Set(report.overCoverage.map((o) => o.dateStr)).size;
    return `${report.summary} (${underDays} día(s) con falta · ${overDays} día(s) con exceso)`;
}

const SHIFT_META: Record<string, { name: string; hours: number; startTime: string }> = {
    M: { name: 'Mañana', hours: 8, startTime: '07:00' },
    T: { name: 'Tarde', hours: 8, startTime: '15:00' },
    N: { name: 'Noche', hours: 8, startTime: '23:00' },
};

function countBandAtPosition(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
    excludeEmpId?: string,
): number {
    const norm = normBand(band);
    return assignments.filter((a) => {
        if (a.dateStr !== dateStr || a.positionName !== positionName) return false;
        if (excludeEmpId && a.empId === excludeEmpId) return false;
        const c = String(a.code || '').toUpperCase();
        if ((a.hours ?? 0) <= 0) return false;
        return normBand(c) === norm;
    }).length;
}

function tryReassignSurplusToGap(
    assignments: V2Assignment[],
    empId: string,
    gap: CoverageSlotImbalance,
    qtyRequired: number,
): boolean {
    const existing = assignments.find((a) => a.empId === empId && a.dateStr === gap.dateStr);
    if (!existing || !existing.positionName) return false;
    const fromBand = String(existing.code || '').toUpperCase();
    if (NON_BILLABLE.has(fromBand) || (existing.hours ?? 0) <= 0) return false;

    const remainAtSource = countBandAtPosition(
        assignments,
        gap.dateStr,
        existing.positionName,
        fromBand,
        empId,
    );
    if (remainAtSource < qtyRequired) return false;

    const meta = SHIFT_META[gap.shiftCode.toUpperCase()] ?? { name: gap.shiftCode, hours: 8, startTime: '07:00' };
    existing.code = gap.shiftCode.toUpperCase();
    existing.name = meta.name;
    existing.hours = meta.hours;
    existing.startTime = meta.startTime;
    existing.positionName = gap.positionName;
    existing.isFranco = false;
    existing.isReten = false;
    return true;
}

function empHasBillableShift(assignments: V2Assignment[], empId: string, dateStr: string): boolean {
    return assignments.some((a) => {
        if (a.empId !== empId || a.dateStr !== dateStr) return false;
        const c = String(a.code || '').toUpperCase();
        return !NON_BILLABLE.has(c) && !ABSENCE_CODES.has(c) && (a.hours ?? 0) > 0;
    });
}

export type CoverageGapFillAction = {
    dateStr: string;
    empId: string;
    positionName: string;
    band: string;
    reason: 'surplus_gap_fill';
};

/**
 * Cierra huecos SLA con excedentes: solo bandas con have < qty, sin duplicar cobertura.
 */
export function fillCoverageGapsFromSurplusPool(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    surplusPool: string[];
    stats?: { positionGroups?: Record<string, string[]> };
    inferModo12TCoverage?: boolean;
    /** Si se indica, solo cierra huecos de ese puesto. */
    positionFilter?: string;
}): { assignments: V2Assignment[]; actions: CoverageGapFillAction[]; report: CoveragePolicyBalanceReport } {
    const result = params.assignments.map((a) => ({ ...a }));
    const actions: CoverageGapFillAction[] = [];

    const titularPos: Record<string, string> = {};
    if (params.stats?.positionGroups) {
        for (const [posName, ids] of Object.entries(params.stats.positionGroups)) {
            for (const id of ids) titularPos[id] = posName;
        }
    }

    const gapHasAbsentTitular = (gap: CoverageSlotImbalance): boolean => {
        for (const [empId, dateMap] of Object.entries(params.ctx.absences ?? {})) {
            if (titularPos[empId] !== gap.positionName) continue;
            if (!dateMap.has(gap.dateStr)) continue;
            const code = String(dateMap.get(gap.dateStr) || '').toUpperCase();
            if (['V', 'L', 'E'].includes(code)) return true;
        }
        return false;
    };

    const bandPriority = (band: string): number => {
        const b = band.toUpperCase();
        if (b === 'T') return 0;
        if (b === 'M') return 1;
        if (b === 'N') return 2;
        return 3;
    };

    let report = analyzeCoveragePolicyBalance(params.ctx, result, {
        inferModo12TCoverage: params.inferModo12TCoverage,
    });

    const positionFilter = params.positionFilter?.trim();

    const sortedGaps = [...report.underCoverage]
        .filter((g) => !positionFilter || g.positionName === positionFilter)
        .sort((a, b) => {
        const absA = gapHasAbsentTitular(a) ? 0 : 1;
        const absB = gapHasAbsentTitular(b) ? 0 : 1;
        if (absA !== absB) return absA - absB;
        if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
        return bandPriority(a.shiftCode) - bandPriority(b.shiftCode);
    });

    for (const gap of sortedGaps) {
        const need = Math.abs(gap.delta);
        if (need <= 0) continue;

        const band = gap.shiftCode.toUpperCase();
        const meta = SHIFT_META[band] ?? { name: band, hours: 8, startTime: '07:00' };
        let filled = 0;

        const titularsOfPos = new Set(params.stats?.positionGroups?.[gap.positionName] ?? []);
        const candidateOrder = [
            ...params.surplusPool.filter((id) => titularsOfPos.has(id)),
            ...params.surplusPool.filter((id) => !titularsOfPos.has(id)),
        ];

        for (const empId of candidateOrder) {
            if (filled >= need) break;
            if (params.ctx.absences[empId]?.has(gap.dateStr)) continue;

            const posDef = params.ctx.positions.find((p) => p.positionName === gap.positionName);
            const qtyRequired = Math.max(1, Number(posDef?.qty) || 1);

            if (empHasBillableShift(result, empId, gap.dateStr)) {
                if (!tryReassignSurplusToGap(result, empId, gap, qtyRequired)) continue;
                actions.push({
                    dateStr: gap.dateStr,
                    empId,
                    positionName: gap.positionName,
                    band,
                    reason: 'surplus_gap_fill',
                });
                filled += 1;
                report = analyzeCoveragePolicyBalance(params.ctx, result, {
                    inferModo12TCoverage: params.inferModo12TCoverage,
                });
                continue;
            }

            const existing = result.find((a) => a.empId === empId && a.dateStr === gap.dateStr);
            if (existing) {
                existing.code = band;
                existing.name = meta.name;
                existing.hours = meta.hours;
                existing.startTime = meta.startTime;
                existing.positionName = gap.positionName;
                existing.isFranco = false;
                existing.isReten = false;
            } else {
                result.push({
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

            actions.push({
                dateStr: gap.dateStr,
                empId,
                positionName: gap.positionName,
                band,
                reason: 'surplus_gap_fill',
            });
            filled += 1;

            report = analyzeCoveragePolicyBalance(params.ctx, result, {
                inferModo12TCoverage: params.inferModo12TCoverage,
            });
        }
    }

    report = analyzeCoveragePolicyBalance(params.ctx, result, {
        inferModo12TCoverage: params.inferModo12TCoverage,
    });

    return { assignments: result, actions, report };
}
