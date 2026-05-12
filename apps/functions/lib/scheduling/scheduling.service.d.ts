import * as admin from 'firebase-admin';
import { IShift } from '../common/interfaces/shift.interface';
import { ShiftOverlapService } from './shift-overlap.service';
import { WorkloadService } from './workload.service';
export declare class SchedulingService {
    private readonly overlapService;
    private readonly workloadService;
    private getDb;
    constructor(overlapService: ShiftOverlapService, workloadService: WorkloadService);
    private convertToDate;
    private checkAbsenceConflict;
    assignShift(shiftData: Partial<IShift> & {
        authorizeOvertime?: boolean;
    }, userAuth: admin.auth.DecodedIdToken): Promise<IShift>;
    updateShift(shiftId: string, updateData: Partial<IShift> & {
        authorizeOvertime?: boolean;
    }): Promise<void>;
    replicateDailyStructure(objectiveId: string, sourceDateStr: string, targetStartDateStr: string, targetEndDateStr: string, schedulerId: string, targetDays?: number[]): Promise<{
        created: number;
        skipped: number;
    }>;
    deleteShift(shiftId: string): Promise<void>;
}
