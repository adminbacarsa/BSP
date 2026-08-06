/**
 * Plan de corrida — fase 1 del pipeline unificado (puro 24hs primero).
 */

import type { V2EngineContext, V2PositionDef } from './autoScheduleEngineV2';
import { is24hsRotationPosition, pickRepresentativeCycle } from './autoScheduleEngineV2';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { headcountPerPax24hs } from './objectiveHeadcount';

const BANDS_12H = new Set(['D12', 'N12']);

export type Planning24hsOperationalMode = 'mtn_8h' | 'd12_n12_structural';

export type PlanningRunPlan24hs = {
    kind: '24hs_only';
    cycleKey: string;
    positions: V2PositionDef[];
    operationalMode: Planning24hsOperationalMode;
    /** Legajos mínimos por puesto según modo (4 M/T/N o 3 D12+N12). */
    requiredByPosition: Record<string, number>;
    structuralHeadcount: number;
    /** Cupo teórico M/T/N (4×pax) — referencia cerebro. */
    mtnStructuralHeadcount: number;
    structuralModo12AllMonth: boolean;
    h12StructuralHeadcount: number;
};

/** 3 guardias por pax en esquema 12h (D12+N12, ciclo 4+2 sobre 12h). */
export function requiredRotationHeadcount12hContingency(pos: V2PositionDef): number {
    const qty = Math.max(1, Number(pos.qty) || 1);
    return qty * 3;
}

/** Cupo de rotación por puesto 24hs (7 días) en M/T/N 8h. */
export function requiredRotationHeadcountMtn8h(pos: V2PositionDef, cycleKey: string): number {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const codes = (pos.shifts || []).map((s) => String(s.code || '').toUpperCase());
    const only12h = codes.length > 0 && codes.every((c) => BANDS_12H.has(c));
    if (only12h) {
        return qty * 3;
    }
    return qty * headcountPerPax24hs(cycleKey);
}

/** @deprecated Usar requiredRotationHeadcountMtn8h o modo del plan. */
export function requiredRotationHeadcountFor24hsPosition(pos: V2PositionDef, cycleKey: string): number {
    return requiredRotationHeadcountMtn8h(pos, cycleKey);
}

export function isFullWeek24hsPosition(pos: V2PositionDef): boolean {
    if (!is24hsRotationPosition(pos)) return false;
    if (Array.isArray(pos.activeDays) && pos.activeDays.length > 0 && pos.activeDays.length < 7) {
        return false;
    }
    return true;
}

/**
 * Construye plan estructural solo para objetivos 100 % 24hs.
 * Custom / mixto → null (otros sprints).
 */
export function buildPlanningRunPlan24hs(ctx: V2EngineContext): PlanningRunPlan24hs | null {
    const profile = buildObjectiveScheduleProfile(ctx.positions);
    if (profile.kind !== '24hs_only') return null;

    const cycleKey = pickRepresentativeCycle(ctx.autoCycles ?? ['6+2']);
    const positions = ctx.positions.filter(isFullWeek24hsPosition);
    if (positions.length === 0) return null;

    const eligibleCount = ctx.employees.length;
    let mtnTotal = 0;
    let h12Total = 0;
    const mtnByPos: Record<string, number> = {};
    const h12ByPos: Record<string, number> = {};
    for (const pos of positions) {
        const mtn = requiredRotationHeadcountMtn8h(pos, cycleKey);
        const h12 = requiredRotationHeadcount12hContingency(pos);
        mtnByPos[pos.positionName] = mtn;
        h12ByPos[pos.positionName] = h12;
        mtnTotal += mtn;
        h12Total += h12;
    }

    let operationalMode: Planning24hsOperationalMode = 'mtn_8h';
    let requiredByPosition = { ...mtnByPos };
    let structuralHeadcount = mtnTotal;

    if (eligibleCount < mtnTotal) {
        if (eligibleCount >= h12Total) {
            operationalMode = 'd12_n12_structural';
            requiredByPosition = { ...h12ByPos };
            structuralHeadcount = h12Total;
        }
    }

    return {
        kind: '24hs_only',
        cycleKey,
        positions,
        operationalMode,
        requiredByPosition,
        structuralHeadcount,
        mtnStructuralHeadcount: mtnTotal,
        structuralModo12AllMonth: operationalMode === 'd12_n12_structural',
        h12StructuralHeadcount: h12Total,
    };
}
