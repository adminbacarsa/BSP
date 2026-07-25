import type { V2PositionDef } from './autoScheduleEngineV2';
import { isCustomCoverPosition } from './autoScheduleEngineV2';

export function is24hsPosition(pos: V2PositionDef): boolean {
    const cov = String(pos.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
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
        preserveRotativeIntegrity: hasCustom && !isMixed,
        allowCustom24hsBackup: !isMixed,
    };
}

/** Mixto 24hs+custom: no usar fixedBandFloater (solo rota 24hs; custom queda MA/ME todos los días). */
export function shouldBypassFixedBandFloater(positions: V2PositionDef[]): boolean {
    return resolveObjectiveScheduleFlags(positions).schedulePhasedRotativeFirst;
}
