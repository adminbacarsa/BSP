export interface EnginePositionDef {
    positionName: string;
    qty?: number;
    shifts?: Array<{
        code: string;
        name?: string;
        hours?: number;
        startTime?: string;
        endTime?: string;
        days?: string[];
    }>;
    activeDays?: string[];
    coverageType?: string;
    excludedDates?: string[];
}
export interface EngineEmployeeDef {
    id: string;
    nombre?: string;
}
export interface EngineContext {
    positions: EnginePositionDef[];
    employees: EngineEmployeeDef[];
    daysInMonth: Date[];
    slaVendidas: number;
    autoCycles: string[];
    absences: Record<string, Set<string>>;
    defaultPositionByEmp?: Record<string, string>;
    defaultShiftByEmp?: Record<string, string>;
    prevMonthTrailingWorkDays?: Record<string, number>;
    prevMonthTrailingRestDays?: Record<string, number>;
    prevMonthLastShiftByEmp?: Record<string, string>;
    prevMonthLastWorkBandBeforeRest?: Record<string, string>;
    cctCutoffDay?: number;
    codeHoursHint?: Record<string, number>;
}
export interface EngineAssignment {
    empId: string;
    dateStr: string;
    positionName: string;
    code: string;
    name: string;
    hours: number;
    startTime: string;
    endTime?: string;
    isFranco?: boolean;
}
export interface EngineResult {
    assignments: EngineAssignment[];
    stats: {
        totalBillableHours: number;
        targetHours: number;
        slaHoursClosed: boolean;
        slaDeficitRemaining: number;
        employeeMonthlyHours: Record<string, number>;
        idleEmployeeIds: string[];
        positionGroups: Record<string, string[]>;
        openingSlotByEmp: Record<string, number>;
        primaryShiftByEmp: Record<string, string | null>;
    };
}
export declare function generateSchedule(ctx: EngineContext): EngineResult;
export interface CoverageReport {
    totalSlots: number;
    coveredSlots: number;
    uncoveredSlots: number;
    coverageRatio: number;
    slaHoursClosed: boolean;
    billableHours: number;
    slaVendidas: number;
    uncoveredByDay: Record<string, Array<{
        positionName: string;
        shiftCode: string;
        missing: number;
    }>>;
}
export declare function verifyCoverage(ctx: EngineContext, assignments: EngineAssignment[]): CoverageReport;
