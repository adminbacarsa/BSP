import type { VplanRunMode, VplanStrategy } from '../vplan.types';
export declare function buildVplanStrategy(opts: {
    mode: VplanRunMode;
    preferredCycle?: string;
    hasExistingAssignments: boolean;
    hasTrailing: boolean;
}): VplanStrategy;
