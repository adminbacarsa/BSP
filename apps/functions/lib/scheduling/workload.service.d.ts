import { IEmployee } from '../common/interfaces/employee.interface';
import { IShift } from '../common/interfaces/shift.interface';
export declare class WorkloadService {
    private getDb;
    private toDate;
    private getCycleDates;
    validateAssignment(employeeId: string, shiftStart: Date, shiftEnd: Date, excludeShiftId?: string): Promise<any>;
    calculateShiftBreakdown(employee: IEmployee, start: Date, end: Date, excludeShiftId?: string): Promise<{
        totalDuration: number;
        weeklyTotal: number;
        breakdown: {
            normal: number;
            fifty: number;
            hundred: number;
            night: number;
        };
        agreementUsed: string;
    }>;
    private calculateSuvicoRules;
    private calculateStandardRules;
    checkShiftOverlap(employeeId: string, start: Date, end: Date, excludeShiftId?: string): Promise<IShift[]>;
    private checkAvailability;
    private checkMonthlyLimit;
    getWorkloadReport(employeeId: string, month: number, year: number): Promise<any>;
}
