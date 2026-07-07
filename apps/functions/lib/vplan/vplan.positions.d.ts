export interface VplanPositionDef {
    positionName: string;
    qty: number;
    coverageType: string;
    shifts: Array<{
        code: string;
        hours: number;
        startTime?: string;
        endTime?: string;
        days?: string[];
    }>;
    activeDays?: string[];
}
export declare function is24hsPosition(pos: VplanPositionDef): boolean;
export declare function isPositionActiveOnDay(pos: VplanPositionDef, dayLetter: string): boolean;
export declare function resolveActiveDays(pos: VplanPositionDef): string[] | undefined;
export declare function isVirtualEmployeeId(empId: string): boolean;
export declare function shiftsForCycle(pos: VplanPositionDef, cycle?: string): VplanPositionDef['shifts'];
export declare function positionDefForCycle(pos: VplanPositionDef, cycle?: string): VplanPositionDef;
export declare function positionsForCycle(positions: VplanPositionDef[], cycle?: string): VplanPositionDef[];
export declare function isCustomFixedShiftPosition(pos: VplanPositionDef): boolean;
export declare function primaryShiftCode(pos: VplanPositionDef): string;
export declare function shiftBandHours(shift: {
    code?: string;
    hours?: number;
}): number;
export declare function normalizeSlaPositions(rawPositions: unknown[]): VplanPositionDef[];
