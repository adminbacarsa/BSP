import { type VplanPositionDef } from './vplan.positions';
export interface VplanEmployeeRecord {
    id: string;
    displayName: string;
    priorCctHours: number;
}
export interface VplanPlanningState {
    defaultPositionByEmp: Record<string, string>;
    defaultShiftByEmp: Record<string, string>;
    trailingWorkDays?: Record<string, number>;
    trailingRestDays?: Record<string, number>;
    lastShiftByEmp?: Record<string, string>;
    lastWorkBandBeforeRest?: Record<string, string>;
}
export interface VplanExistingAssignment {
    employeeId: string;
    dateStr: string;
    code: string;
    positionName: string;
    hours?: number;
}
export interface VplanPlanningSnapshot {
    empresaId: string;
    objectiveId: string;
    objectiveName?: string;
    slaId: string;
    slaVendidas: number;
    positions: VplanPositionDef[];
    employees: VplanEmployeeRecord[];
    absences: Record<string, Set<string>>;
    days: Array<{
        dateStr: string;
        dayLetter: string;
    }>;
    previousMonthStateKey?: string;
    planningState: VplanPlanningState;
    prevPlanningState: VplanPlanningState;
    existingAssignments: VplanExistingAssignment[];
}
export declare function loadVplanPlanningSnapshot(request: {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    employeeIds?: string[];
}): Promise<VplanPlanningSnapshot>;
