import * as functions from 'firebase-functions/v1';
export interface RunAutoScheduleInput {
    objectiveId: string;
    year: number;
    month: number;
    empresaId: string;
    options?: {
        cctCutoffDay?: number;
        budgetMode?: 'cct' | 'calendar';
    };
}
export interface RunAutoScheduleOutput {
    ok: boolean;
    error?: string;
    assignments: Array<{
        empId: string;
        dateStr: string;
        positionName: string;
        code: string;
        name: string;
        hours: number;
        startTime: string;
        endTime?: string;
        isFranco?: boolean;
    }>;
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
    coverage: {
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
    };
    staffingNeeds: Array<{
        positionName: string;
        qty: number;
        employeesNeeded: number;
        employeesAssigned: number;
        gap: number;
    }>;
    meta: {
        objectiveId: string;
        year: number;
        month: number;
        employeeCount: number;
        positionCount: number;
        generatedAt: string;
    };
}
export declare const runAutoScheduleHandler: (data: RunAutoScheduleInput, context: functions.https.CallableContext) => Promise<RunAutoScheduleOutput>;
export declare const runAutoSchedule: functions.HttpsFunction & functions.Runnable<any>;
