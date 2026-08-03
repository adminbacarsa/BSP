import type { V2PositionDef } from './autoScheduleEngineV2';
import { is24hsRotationPosition } from './autoScheduleEngineV2';
import {
    cronogramRulesToEngineFlags,
    resolveCronogramPlanningRules,
} from './cronogramPlanningRules';

export function is24hsPosition(pos: V2PositionDef): boolean {
    return is24hsRotationPosition(pos);
}

/** Flags de motor según tipo de crono: puro 24hs, puro custom o mixto. */
export function resolveObjectiveScheduleFlags(positions: V2PositionDef[]): {
    headcountByPax: boolean;
    schedulePhasedRotativeFirst: boolean;
    preserveRotativeIntegrity: boolean;
    allowCustom24hsBackup: boolean;
    /** Puro 24hs | custom | mixto */
    cronogramKind: ReturnType<typeof resolveCronogramPlanningRules>['kind'];
    cronogramTypeLabel: string;
} {
    return cronogramRulesToEngineFlags(resolveCronogramPlanningRules(positions));
}

export { resolveCronogramPlanningRules, formatCronogramPlaybookForBrain } from './cronogramPlanningRules';

/** El ciclo 24d + flotante ya programa custom L–V en el mismo pipeline; no forzar V4 demand-driven. */
export function shouldBypassFixedBandFloater(_positions: V2PositionDef[]): boolean {
    return false;
}
