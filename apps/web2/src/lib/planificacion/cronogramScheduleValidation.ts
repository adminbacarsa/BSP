/**
 * Validación post-generación según reglas del tipo de crono.
 */

import type { V2Assignment, V2EngineContext } from './autoScheduleEngineV2';
import { is24hsRotationPosition, isCustomCoverPosition } from './autoScheduleEngineV2';
import { customCoverBandsForDay, customCoverDailyPax } from './customCoverCycle';
import { buildObjectiveScheduleProfile } from './objectiveServiceModel';
import { findPositionAssignmentViolations } from './positionAssignmentPolicy';
import {
    resolveCronogramPlanningRules,
    type CronogramPlanningRules,
} from './cronogramPlanningRules';

export interface CronogramValidationIssue {
    code:
        | 'position_assignment'
        | 'custom_slot_gap'
        | 'rotative_band_mismatch'
        | 'mixed_cross_pool';
    severity: 'error' | 'warning';
    message: string;
    dateStr?: string;
    positionName?: string;
    empId?: string;
}

const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'MA', 'ME', 'RO', 'RON', 'REF', 'ESC']);

function isWorkAssignment(a: V2Assignment): boolean {
    const code = String(a.code || '').toUpperCase();
    if (!code || code === 'RET' || code === 'F' || code === 'FF' || code === 'FP') return false;
    return (a.hours ?? 0) > 0 || WORK_CODES.has(code);
}

/** Cupos custom sin cubrir por día (suma asignaciones vs demanda SLA). */
export function findCustomConcurrentSlotGaps(
    ctx: Pick<V2EngineContext, 'positions' | 'getDayLetter' | 'autoCycles'>,
    assignments: V2Assignment[],
): CronogramValidationIssue[] {
    const issues: CronogramValidationIssue[] = [];
    const customPositions = ctx.positions.filter(isCustomCoverPosition);
    if (customPositions.length === 0) return issues;

    const byDayPosCode = new Map<string, number>();
    for (const a of assignments) {
        if (!isWorkAssignment(a)) continue;
        const pos = customPositions.find((p) => p.positionName === a.positionName);
        if (!pos) continue;
        const code = String(a.code || '').toUpperCase();
        const k = `${a.dateStr}|${a.positionName}|${code}`;
        byDayPosCode.set(k, (byDayPosCode.get(k) ?? 0) + 1);
    }

    const dates = [...new Set(assignments.map((a) => a.dateStr))].sort();
    for (const dateStr of dates) {
        const dayLetter = ctx.getDayLetter(dateStr);
        for (const pos of customPositions) {
            const bands = customCoverBandsForDay(pos, dayLetter, ctx.autoCycles, dateStr);
            if (bands.length === 0) continue;
            const qty = customCoverDailyPax(pos);
            for (const code of bands) {
                const codeUp = String(code).toUpperCase();
                const need = qty;
                const k = `${dateStr}|${pos.positionName}|${codeUp}`;
                const have = byDayPosCode.get(k) ?? 0;
                if (have < need) {
                    issues.push({
                        code: 'custom_slot_gap',
                        severity: 'error',
                        dateStr,
                        positionName: pos.positionName,
                        message:
                            `${dateStr} «${pos.positionName}» ${codeUp}: ${have}/${need} cupo(s) cubiertos.`,
                    });
                }
            }
        }
    }
    return issues;
}

/** En mixto: legajo de grupo 24hs con turno en puesto custom el mismo día (cruce de pools). */
export function findMixedCrossPoolViolations(
    ctx: Pick<V2EngineContext, 'positions'>,
    assignments: V2Assignment[],
    phase24PositionNames: Set<string>,
): CronogramValidationIssue[] {
    const issues: CronogramValidationIssue[] = [];
    const customNames = new Set(
        ctx.positions.filter(isCustomCoverPosition).map((p) => p.positionName),
    );
    if (customNames.size === 0 || phase24PositionNames.size === 0) return issues;

    const emp24Days = new Map<string, Set<string>>();
    for (const a of assignments) {
        if (!isWorkAssignment(a)) continue;
        if (!phase24PositionNames.has(a.positionName)) continue;
        if (!emp24Days.has(a.empId)) emp24Days.set(a.empId, new Set());
        emp24Days.get(a.empId)!.add(a.dateStr);
    }

    for (const a of assignments) {
        if (!isWorkAssignment(a)) continue;
        if (!customNames.has(a.positionName)) continue;
        const days24 = emp24Days.get(a.empId);
        if (days24?.has(a.dateStr)) {
            issues.push({
                code: 'mixed_cross_pool',
                severity: 'error',
                empId: a.empId,
                dateStr: a.dateStr,
                positionName: a.positionName,
                message:
                    `Mixto: ${a.empId} tiene servicio 24hs y custom el ${a.dateStr} (pools no deben cruzarse).`,
            });
        }
    }
    return issues;
}

export function validateScheduleAgainstCronogramRules(
    ctx: V2EngineContext,
    assignments: V2Assignment[],
    rules?: CronogramPlanningRules,
): CronogramValidationIssue[] {
    const r = rules ?? ctx.cronogramRules ?? resolveCronogramPlanningRules(ctx.positions);
    const issues: CronogramValidationIssue[] = [];

    if (r.validation.positionAssignments) {
        for (const v of findPositionAssignmentViolations(ctx, assignments)) {
            issues.push({
                code: 'position_assignment',
                severity: 'error',
                empId: v.empId,
                dateStr: v.dateStr,
                positionName: v.positionName,
                message:
                    `Cobertura dotación: ${v.empId} no puede ${v.code} en «${v.positionName}» (${v.dateStr}).`,
            });
        }
    }

    if (r.validation.customConcurrentSlots) {
        issues.push(...findCustomConcurrentSlotGaps(ctx, assignments));
    }

    if (r.validation.rotative24hsSequence && r.kind === '24hs_only') {
        const pos24 = ctx.positions.filter(is24hsRotationPosition);
        for (const a of assignments) {
            if (!isWorkAssignment(a)) continue;
            const pos = pos24.find((p) => p.positionName === a.positionName);
            if (!pos) continue;
            const code = String(a.code || '').toUpperCase();
            if (!['M', 'T', 'N'].includes(code)) continue;
        }
    }

    if (r.kind === 'mixed') {
        const profile = buildObjectiveScheduleProfile(ctx.positions);
        const names24 = new Set(profile.positions24hs.map((p) => p.positionName));
        issues.push(...findMixedCrossPoolViolations(ctx, assignments, names24));
    }

    return issues;
}
