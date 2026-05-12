import { LaborAgreement } from '../interfaces/employee.interface';
export interface LaborRule {
    name: string;
    maxHoursWeekly?: number;
    maxHoursMonthly: number;
    overtimeThresholdDaily?: number;
    saturdayCutoffHour: number;
    nightShiftStart: number;
    nightShiftEnd: number;
}
export declare const LABOR_RULES: Record<LaborAgreement, LaborRule>;
