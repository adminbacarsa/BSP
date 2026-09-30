export declare function completesPartialSegment(existingType: string, incomingType: string): boolean;
export declare function uncoveredRemainderMs(gapStart: number, gapEnd: number, coveredStart: number, coveredEnd: number): {
    startMs: number;
    endMs: number;
} | null;
