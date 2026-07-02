export interface VplanPositionDef {
    positionName: string;
    qty: number;
    coverageType: string;
    shifts: Array<{
        code: string;
        hours: number;
        startTime?: string;
        endTime?: string;
    }>;
    activeDays?: string[];
}
export declare function is24hsPosition(pos: VplanPositionDef): boolean;
export declare function isPositionActiveOnDay(pos: VplanPositionDef, dayLetter: string): boolean;
export declare function shiftBandHours(shift: {
    code?: string;
    hours?: number;
}): number;
export declare function normalizeSlaPositions(rawPositions: unknown[]): VplanPositionDef[];
