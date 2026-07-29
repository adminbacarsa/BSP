/**
 * Cobertura quirúrgica: RET stand-by del excedente cubre el turno M/T/N del titular ausente.
 * No entra en positionGroups ni en la rotación 6+2 — solo reemplazo puntual por día/banda.
 */

import type { V2Assignment, V2EngineContext, V2GenerateStats, V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverTitular } from './customCoverCycle';
import { computePositionRequiredHeadcount } from './objectiveHeadcount';
import { MODO12_ABSENCE_CODES } from './planningCoveragePolicy';
import {
    absenceRequiresCoverage,
    expectedBandForEmployee,
    isWorkBandCode,
} from './absenceFrancoUtils';

const SHIFT_META: Record<string, { name: string; hours: number; startTime: string }> = {
    M: { name: 'Mañana', hours: 8, startTime: '07:00' },
    T: { name: 'Tarde', hours: 8, startTime: '15:00' },
    N: { name: 'Noche', hours: 8, startTime: '23:00' },
};

export interface SurplusAbsentSubstitutionAction {
    dateStr: string;
    absentEmpId: string;
    surplusEmpId: string;
    positionName: string;
    band: string;
}

function rankSurplusCandidates(ids: string[], stats: V2GenerateStats): string[] {
    const idle = new Set(stats.idleEmployeeIds ?? []);
    const stranded = new Set(stats.strandedEmployeeIds ?? []);
    return [...ids].sort((a, b) => {
        const score = (id: string) => {
            if (idle.has(id)) return 0;
            if (stranded.has(id)) return 1;
            return 2;
        };
        const sa = score(a);
        const sb = score(b);
        if (sa !== sb) return sa - sb;
        return a.localeCompare(b);
    });
}

export interface BuildSurplusPoolOptions {
    defaultShiftByEmp?: Record<string, string>;
    defaultPositionByEmp?: Record<string, string>;
    absences?: Record<string, Map<string, string>>;
}

function plannedAbsenceDayCount(
    empId: string,
    absences?: Record<string, Map<string, string>>,
): number {
    const map = absences?.[empId];
    if (!map) return 0;
    let count = 0;
    for (const code of map.values()) {
        if (MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) count += 1;
    }
    return count;
}

function isRotationAnchorTitular(
    stats: V2GenerateStats,
    empId: string,
    poolOptions?: BuildSurplusPoolOptions,
): boolean {
    const defShift = String(poolOptions?.defaultShiftByEmp?.[empId] || '').toUpperCase();
    if (isWorkBandCode(defShift)) return true;

    const primary = stats.primaryShiftByEmp?.[empId];
    if (primary != null && isWorkBandCode(String(primary))) return true;

    if (
        stats.retFloaterEmpIds?.includes(empId)
        && plannedAbsenceDayCount(empId, poolOptions?.absences) >= 3
    ) {
        return true;
    }

    if (stats.openingSlotByEmp?.[empId] !== undefined && !stats.retFloaterEmpIds?.includes(empId)) {
        return true;
    }

    return false;
}

/**
 * Si un titular protegido ocupa slot de excedente (índice ≥ need−1), el guardia
 * estructural (need−1) pasa al pool — p. ej. FARIAS con V planificada y SOLIS en 4.º lugar.
 */
function addStructuralSurplusWhenProtectedAnchorInExcess(
    candidates: Set<string>,
    stats: V2GenerateStats,
    positions: V2PositionDef[],
    cycleKey: string,
    poolOptions?: BuildSurplusPoolOptions,
): void {
    if (!stats.positionGroups) return;

    for (const pos of positions) {
        const need = computePositionRequiredHeadcount(pos, cycleKey);
        const group = stats.positionGroups[pos.positionName] ?? [];
        if (group.length <= need) continue;

        const excessRegion = group.slice(need - 1);
        const hasProtectedInExcess = excessRegion.some((id) =>
            isRotationAnchorTitular(stats, id, poolOptions),
        );
        if (!hasProtectedInExcess) continue;

        for (const id of excessRegion) {
            if (!isRotationAnchorTitular(stats, id, poolOptions)) {
                candidates.add(id);
            }
        }
    }
}

/** Completa el pool hasta el tope plantilla (19−16=3) con excedentes estructurales no ancla. */
function fillSurplusPoolToCap(
    ranked: string[],
    cap: number,
    stats: V2GenerateStats,
    positions: V2PositionDef[],
    cycleKey: string,
    poolOptions?: BuildSurplusPoolOptions,
): string[] {
    if (cap <= 0) return [];
    if (ranked.length >= cap) return ranked.slice(0, cap);

    const rankedSet = new Set(ranked);
    const extras: string[] = [];

    for (const pos of positions) {
        const need = computePositionRequiredHeadcount(pos, cycleKey);
        const group = stats.positionGroups?.[pos.positionName] ?? [];
        for (let i = group.length - 1; i >= need; i--) {
            const id = group[i];
            if (rankedSet.has(id) || extras.includes(id)) continue;
            if (isRotationAnchorTitular(stats, id, poolOptions)) continue;
            extras.push(id);
            if (ranked.length + extras.length >= cap) break;
        }
        if (ranked.length + extras.length >= cap) break;
    }

    return rankSurplusCandidates([...ranked, ...extras], stats).slice(0, cap);
}

/**
 * Legajos excedentes globales (p. ej. 19 − plantilla 16 = 3).
 * Excluye titulares de cron con banda primaria (p. ej. FARIAS) aunque sean 5.º del puesto.
 */
export function buildSurplusEmployeePool(
    stats: V2GenerateStats,
    employeeIds: string[],
    positions?: V2PositionDef[],
    cycleKey: string = '6+2',
    plantillaTotal?: number,
    poolOptions?: BuildSurplusPoolOptions,
): string[] {
    const candidates = new Set<string>();

    for (const id of stats.idleEmployeeIds ?? []) {
        if (stats.openingSlotByEmp?.[id] !== undefined) continue;
        if (positions && isCustomCoverTitular(id, positions, stats.positionGroups)) continue;
        candidates.add(id);
    }
    for (const id of stats.strandedEmployeeIds ?? []) {
        candidates.add(id);
    }
    for (const id of stats.retFloaterEmpIds ?? []) {
        candidates.add(id);
    }

    if (positions && stats.positionGroups) {
        for (const pos of positions) {
            const need = computePositionRequiredHeadcount(pos, cycleKey);
            const group = stats.positionGroups[pos.positionName] ?? [];
            for (let i = need; i < group.length; i++) {
                candidates.add(group[i]);
            }
        }
    }

    const titulars = new Set<string>();
    for (const ids of Object.values(stats.positionGroups ?? {})) {
        for (const id of ids) titulars.add(id);
    }
    for (const id of employeeIds) {
        if (!titulars.has(id)) candidates.add(id);
    }

    if (positions) {
        addStructuralSurplusWhenProtectedAnchorInExcess(
            candidates,
            stats,
            positions,
            cycleKey,
            poolOptions,
        );
    }

    for (const id of [...candidates]) {
        if (isRotationAnchorTitular(stats, id, poolOptions)) candidates.delete(id);
    }

    let ranked = rankSurplusCandidates([...candidates], stats);
    if (plantillaTotal != null && plantillaTotal > 0) {
        const cap = Math.max(0, employeeIds.length - plantillaTotal);
        ranked = fillSurplusPoolToCap(ranked, cap, stats, positions ?? [], cycleKey, poolOptions);
    }
    return ranked;
}

function surplusHasBillableShift(
    assignments: V2Assignment[],
    empId: string,
    dateStr: string,
): boolean {
    const cell = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
    if (!cell) return false;
    const code = String(cell.code || '').toUpperCase();
    return isWorkBandCode(code) && (Number(cell.hours) || 0) > 0;
}

function buildTitularPositionMap(
    stats: V2GenerateStats,
): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [posName, ids] of Object.entries(stats.positionGroups ?? {})) {
        for (const id of ids) map[id] = posName;
    }
    return map;
}

function bandAssignmentCount(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
): number {
    const b = band.toUpperCase();
    const norm = b === 'D12' ? 'M' : b === 'N12' ? 'N' : b;
    const seen = new Set<string>();
    let count = 0;
    for (const a of assignments) {
        if (a.dateStr !== dateStr || a.positionName !== positionName) continue;
        const c = String(a.code || '').toUpperCase();
        const cn = c === 'D12' ? 'M' : c === 'N12' ? 'N' : c;
        if (cn !== norm || (a.hours ?? 0) <= 0) continue;
        const k = a.empId;
        if (seen.has(k)) continue;
        seen.add(k);
        count += 1;
    }
    return count;
}

function bandNeedsCover(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
    qtyRequired: number,
): boolean {
    return bandAssignmentCount(assignments, dateStr, positionName, band) < qtyRequired;
}

function absentBandNeedsSurplus(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
    absentEmpId: string,
    qtyRequired: number,
    titularPos: Record<string, string>,
): boolean {
    if (bandNeedsCover(assignments, dateStr, positionName, band, qtyRequired)) return true;
    const norm = band.toUpperCase();
    return assignments.some((a) => {
        if (a.dateStr !== dateStr || a.positionName !== positionName) return false;
        if ((a.hours ?? 0) <= 0) return false;
        if (a.empId === absentEmpId) return false;
        const c = String(a.code || '').toUpperCase();
        const cn = c === 'D12' ? 'M' : c === 'N12' ? 'N' : c;
        return cn === norm && titularPos[a.empId] === positionName;
    });
}

function releaseTitularAtAbsentBand(
    assignments: V2Assignment[],
    dateStr: string,
    positionName: string,
    band: string,
    absentEmpId: string,
    titularPos: Record<string, string>,
    openingSlotByEmp: Record<string, number> | undefined,
    ctx: V2EngineContext,
): void {
    const norm = band.toUpperCase();
    for (const a of assignments) {
        if (a.dateStr !== dateStr || a.positionName !== positionName) continue;
        if (a.empId === absentEmpId) continue;
        if (titularPos[a.empId] !== positionName) continue;
        const c = String(a.code || '').toUpperCase();
        const cn = c === 'D12' ? 'M' : c === 'N12' ? 'N' : c;
        if (cn !== norm || (a.hours ?? 0) <= 0) continue;
        const expected = expectedBandForEmployee(
            a.empId,
            dateStr,
            openingSlotByEmp,
            ctx.daysInMonth,
            ctx.getDateKey,
            ctx,
        );
        if (expected === 'F') {
            a.code = 'F';
            a.name = 'Franco';
            a.hours = 0;
            a.startTime = '00:00';
            a.positionName = '';
            a.isFranco = true;
            a.isReten = false;
            delete a.endTime;
        } else if (expected !== band) {
            a.positionName = '';
            a.code = 'RET';
            a.name = 'Retén';
            a.hours = 0;
            a.startTime = '00:00';
            a.isFranco = false;
            a.isReten = true;
            delete a.endTime;
        }
    }
}

function assignSubstitutionShift(
    assignments: V2Assignment[],
    empId: string,
    dateStr: string,
    band: string,
    positionName: string,
): void {
    const meta = SHIFT_META[band] ?? { name: band, hours: 8, startTime: '07:00' };
    const existing = assignments.find((a) => a.empId === empId && a.dateStr === dateStr);
    if (existing) {
        existing.code = band;
        existing.name = meta.name;
        existing.hours = meta.hours;
        existing.startTime = meta.startTime;
        existing.positionName = positionName;
        existing.isFranco = false;
        existing.isReten = false;
        return;
    }
    assignments.push({
        empId,
        dateStr,
        positionName,
        code: band,
        name: meta.name,
        hours: meta.hours,
        startTime: meta.startTime,
        isFranco: false,
        isReten: false,
    });
}

/**
 * Por cada titular ausente (V/L/E) en día laborable de su ciclo, asigna un RET del pool
 * excedente a la misma banda y puesto que habría trabajado el ausente.
 */
export function applySurplusRetAbsentSubstitution(params: {
    assignments: V2Assignment[];
    ctx: V2EngineContext;
    stats: V2GenerateStats;
    openingSlotByEmp?: Record<string, number>;
    /** Si se indica, solo cubre ausencias de ese puesto (sellado puesto a puesto). */
    positionFilter?: string;
    /** Compartido entre pasadas puesto a puesto para no doble-asignar el mismo excedente el mismo día. */
    usedSurplusByDay?: Map<string, Set<string>>;
    /** Orden SLA de puestos (Rondín → Playa → Hall → …); default ctx.positions. */
    positionOrder?: string[];
}): {
    assignments: V2Assignment[];
    actions: SurplusAbsentSubstitutionAction[];
    usedSurplusByDay: Map<string, Set<string>>;
} {
    const { ctx, stats, openingSlotByEmp } = params;
    const absences = ctx.absences ?? {};
    const surplusPool = stats.idleEmployeeIds?.length
        ? stats.idleEmployeeIds
        : buildSurplusEmployeePool(
            stats,
            ctx.employees.map((e) => e.id),
            ctx.positions,
            ctx.autoCycles?.[0] ?? '6+2',
            undefined,
            {
                defaultShiftByEmp: ctx.defaultShiftByEmp,
                defaultPositionByEmp: ctx.defaultPositionByEmp,
                absences: ctx.absences,
            },
        );
    if (surplusPool.length === 0) {
        return {
            assignments: params.assignments,
            actions: [],
            usedSurplusByDay: params.usedSurplusByDay ?? new Map(),
        };
    }

    const titularPos = buildTitularPositionMap(stats);
    const surplusSet = new Set(surplusPool);
    const result = params.assignments.map((a) => ({ ...a }));
    const actions: SurplusAbsentSubstitutionAction[] = [];
    const usedSurplusByDay = params.usedSurplusByDay ?? new Map<string, Set<string>>();

    type AbsenceCoverSlot = { absentEmpId: string; dateStr: string; positionName: string; band: string };
    const coverSlots: AbsenceCoverSlot[] = [];

    const positionOrder = params.positionOrder ?? ctx.positions.map((p) => p.positionName);
    const posRank = new Map(positionOrder.map((name, idx) => [name, idx]));

    for (const [absentEmpId, dateMap] of Object.entries(absences)) {
        if (surplusSet.has(absentEmpId)) continue;
        const positionName = titularPos[absentEmpId];
        if (!positionName) continue;

        for (const [dateStr, code] of dateMap.entries()) {
            if (!MODO12_ABSENCE_CODES.has(String(code || '').toUpperCase())) continue;
            if (!absenceRequiresCoverage(absentEmpId, dateStr, openingSlotByEmp, ctx)) continue;

            const band = expectedBandForEmployee(
                absentEmpId,
                dateStr,
                openingSlotByEmp,
                ctx.daysInMonth,
                ctx.getDateKey,
                ctx,
            );
            if (!band || !isWorkBandCode(band)) continue;

            const posDef = ctx.positions.find((p) => p.positionName === positionName);
            const qtyRequired = Math.max(1, Number(posDef?.qty) || 1);
            if (!absentBandNeedsSurplus(result, dateStr, positionName, band, absentEmpId, qtyRequired, titularPos)) {
                continue;
            }

            coverSlots.push({ absentEmpId, dateStr, positionName, band });
        }
    }

    coverSlots.sort((a, b) => {
        if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr);
        const ra = posRank.get(a.positionName) ?? 999;
        const rb = posRank.get(b.positionName) ?? 999;
        if (ra !== rb) return ra - rb;
        return a.band.localeCompare(b.band);
    });

    const positionFilter = params.positionFilter?.trim();

    for (const slot of coverSlots) {
        if (positionFilter && slot.positionName !== positionFilter) continue;

        const used = usedSurplusByDay.get(slot.dateStr) ?? new Set<string>();
        const surplusEmpId = surplusPool.find((id) =>
            !used.has(id)
            && !absences[id]?.has(slot.dateStr)
            && !surplusHasBillableShift(result, id, slot.dateStr),
        );
        if (!surplusEmpId) continue;

        releaseTitularAtAbsentBand(
            result,
            slot.dateStr,
            slot.positionName,
            slot.band,
            slot.absentEmpId,
            titularPos,
            openingSlotByEmp,
            ctx,
        );

        assignSubstitutionShift(result, surplusEmpId, slot.dateStr, slot.band, slot.positionName);
        used.add(surplusEmpId);
        usedSurplusByDay.set(slot.dateStr, used);
        actions.push({
            dateStr: slot.dateStr,
            absentEmpId: slot.absentEmpId,
            surplusEmpId,
            positionName: slot.positionName,
            band: slot.band,
        });
    }

    return { assignments: result, actions, usedSurplusByDay };
}
