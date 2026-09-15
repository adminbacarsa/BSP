export declare const CROSS_OBJ_MAX_KM = 10;
export declare function normCoveragePositionName(p: unknown): string;
export declare function coverageHaversineKm(lat1: number | null | undefined, lon1: number | null | undefined, lat2: number | null | undefined, lon2: number | null | undefined): number;
export declare function countPresentInPositionDocs(docs: Array<{
    id: string;
    data: () => Record<string, any>;
}>, objectiveId: string, positionName: string, dayStartMs?: number): number;
export declare function canSparePresentFromDocs(docs: Array<{
    id: string;
    data: () => Record<string, any>;
}>, source: {
    objectiveId?: string;
    positionName?: string;
    startTime?: {
        seconds?: number;
    };
}): boolean;
export declare function isWithinCrossObjRadiusKm(distanceKm: number, maxKm?: number): boolean;
