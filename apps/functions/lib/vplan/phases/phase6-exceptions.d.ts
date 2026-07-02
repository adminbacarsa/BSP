import type { VplanScheduleDraft } from '../vplan.types';
export declare function applyVplanAbsenceExceptions(opts: {
    draft: VplanScheduleDraft;
    absences: Record<string, Set<string>>;
    enabled: boolean;
}): {
    draft: VplanScheduleDraft;
    patchedDays: number;
};
