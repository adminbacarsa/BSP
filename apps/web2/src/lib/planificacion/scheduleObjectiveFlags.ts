import type { V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition, is24hsRotationPosition } from './autoScheduleEngineV2';

export function is24hsPosition(pos: V2PositionDef): boolean {
    return is24hsRotationPosition(pos);
}

/** Flags de motor para objetivos con puestos custom (MA/ME) y/o mixtos 24hs+custom. */
export function resolveObjectiveScheduleFlags(positions: V2PositionDef[]): {
    headcountByPax: boolean;
    schedulePhasedRotativeFirst: boolean;
    preserveRotativeIntegrity: boolean;
    allowCustom24hsBackup: boolean;
} {
    const has24hs = positions.some(is24hsPosition);
    const hasCustom = positions.some(isCustomCoverPosition);
    const isMixed = has24hs && hasCustom;
    return {
        headcountByPax: hasCustom,
        schedulePhasedRotativeFirst: isMixed,
        /** Protege ciclo 24d / bandas fijas: el fixer y gap-fill del pool no deben mezclar M/T/N. */
        preserveRotativeIntegrity: has24hs,
        allowCustom24hsBackup: !isMixed,
    };
}

/** El ciclo 24d + flotante ya programa custom L–V en el mismo pipeline; no forzar V4 demand-driven. */
export function shouldBypassFixedBandFloater(_positions: V2PositionDef[]): boolean {
    return false;
}
