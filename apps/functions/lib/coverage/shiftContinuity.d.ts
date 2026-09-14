export type ContinuityDecision = {
    action: 'RETAIN';
    reason: string;
} | {
    action: 'AUTO_CLOSE';
    reason: string;
};
export declare function hasTuraOrExtension(shift: Record<string, any>): boolean;
export declare function employeeHasPosteriorShift(params: {
    employeeId: string;
    objectiveId: string;
    currentShiftId: string;
    currentEndMs: number;
    dayShifts: Array<Record<string, any> & {
        id: string;
    }>;
}): boolean;
export declare function decideShiftCloseOrRetain(params: {
    shift: Record<string, any>;
    requiresContinuousCoverage24h: boolean;
    hasPosteriorShift: boolean;
}): ContinuityDecision;
export declare function vacancyCoverageLabel(params: {
    titularName?: string | null;
    shiftCode?: string | null;
    positionName?: string | null;
    objectiveName?: string | null;
    timeRange?: string | null;
}): string;
export declare function isPassiveStandbyCode(code: unknown): boolean;
export declare function hasCoverageLedgerWithoutRealCode(shift: Record<string, any>): boolean;
export declare function buildReassignPassiveToVacancyFields(vacancy: Record<string, any>, opts: {
    coverageType: string;
    resolvedBy?: string;
    previousCode?: string;
    previousPositionName?: string | null;
    coverageEventId?: string;
}): Record<string, unknown>;
export declare function toTimestampMs(t: unknown): number;
