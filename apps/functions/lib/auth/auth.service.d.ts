import { IEmployee } from '../common/interfaces/employee.interface';
export declare class AuthService {
    private getAuth;
    private getDb;
    createEmployeeProfile(email: string, password: string, role: IEmployee['role'], name: string, profileData: {
        clientId: string;
        dni: string;
        fileNumber: string;
        address: string;
    }): Promise<IEmployee>;
}
