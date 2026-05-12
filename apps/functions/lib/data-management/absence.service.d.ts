import { WorkloadService } from '../scheduling/workload.service';
import { IAbsence, IAbsencePayload } from '../common/interfaces/absence.interface';
export declare class AbsenceService {
    private readonly workloadService;
    private getDb;
    private readonly absencesCollection;
    private readonly shiftsCollection;
    constructor(workloadService: WorkloadService);
    private toDate;
    createAbsence(payload: IAbsencePayload): Promise<IAbsence & {
        impactedShiftsCount: number;
    }>;
}
