import { Timestamp } from 'firebase-admin/firestore';
export type VacancySplitTimes = {
    gap: {
        from: string;
        to: string;
    };
    ext: {
        from: string;
        to: string;
    };
    adel: {
        from: string;
        to: string;
    };
};
export declare function defaultSplitTimesCct(band: string): VacancySplitTimes;
export declare function hhmmPairToTimestamps(anchor: Date, fromHm: string, toHm: string): {
    start: Timestamp;
    end: Timestamp;
};
export declare function resolveCoverageBandCode(opts: {
    code?: string | null;
    startTime?: unknown;
}): string;
export declare function dualExtAdvSegmentTimestamps(opts: {
    titularAnchor: Date;
    gapBand: string;
}): {
    extCov: {
        start: Timestamp;
        end: Timestamp;
        extensionEndHm: string;
    };
    advCov: {
        start: Timestamp;
        end: Timestamp;
        adjustedStartHm: string;
    };
};
export declare function titularAnchorFromShift(titular: Record<string, unknown>): Date;
export declare function extensionEndTimestamp(anchor: Date, hm: string): Timestamp;
export declare function adjustedStartTimestamp(anchor: Date, hm: string): Timestamp;
