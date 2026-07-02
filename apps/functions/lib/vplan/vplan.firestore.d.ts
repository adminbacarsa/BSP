import { type VplanPositionDef } from './vplan.positions';
export interface VplanEmployeeRecord {
    id: string;
    displayName: string;
    priorCctHours: number;
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
}
export declare function loadVplanPlanningSnapshot(request: {
    empresaId: string;
    objectiveId: string;
    year: number;
    month: number;
    employeeIds?: string[];
}): Promise<VplanPlanningSnapshot>;
