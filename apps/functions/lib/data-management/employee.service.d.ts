import { IEmployee } from '../common/interfaces/employee.interface';
import { WorkloadService } from '../scheduling/workload.service';
export declare class EmployeeService {
    private readonly workloadService;
    private getDb;
    private getAuth;
    constructor(workloadService: WorkloadService);
    findAllEmployees(clientId?: string): Promise<IEmployee[]>;
    getEmployeeWorkload(uid: string, month: number, year: number): Promise<any>;
    updateEmployee(uid: string, data: Partial<IEmployee>): Promise<void>;
    deleteEmployee(uid: string): Promise<void>;
    importEmployees(rows: any[], adminUid: string): Promise<{
        success: number;
        errors: any[];
    }>;
}
