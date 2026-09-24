import { Timestamp } from 'firebase-admin/firestore';
export type CoverageGapWindow = {
    startMs: number;
    endMs: number;
    band?: string | null;
};
export declare function shiftStartMs(shift: Record<string, unknown>): number;
export declare function shiftEndMs(shift: Record<string, unknown>): number;
export declare function gapWindowFromTitularShift(titular: Record<string, unknown>): CoverageGapWindow | null;
export declare function gapWindowFromConvocatoria(conv: {
    startTime?: Timestamp;
    endTime?: Timestamp;
    shiftCode?: string;
}): CoverageGapWindow | null;
export declare function resolveOperationalBand(shift: Record<string, unknown>): string;
export declare function sourceShiftEligibleForCoverageGap(sourceShift: Record<string, unknown>, gap: CoverageGapWindow): boolean;
export declare function gapFromAbsenceLikeShift(absenceShift: Record<string, unknown>): CoverageGapWindow | null;
