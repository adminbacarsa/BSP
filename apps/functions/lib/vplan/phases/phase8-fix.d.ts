import type { VplanFixerLogEntry, VplanScheduleDraft } from '../vplan.types';
export declare function runVplanDeterministicFixer(draft: VplanScheduleDraft): {
    draft: VplanScheduleDraft;
    log: VplanFixerLogEntry[];
};
