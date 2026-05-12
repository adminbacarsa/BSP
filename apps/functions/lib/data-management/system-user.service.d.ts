import { ISystemUser, SystemRole } from '../common/interfaces/system-user.interface';
export declare class SystemUserService {
    private getAuth;
    private getDb;
    createSystemUser(data: {
        email: string;
        password: string;
        displayName: string;
        role: SystemRole;
    }): Promise<ISystemUser>;
    findAll(): Promise<ISystemUser[]>;
    updateSystemUser(uid: string, data: Partial<ISystemUser>): Promise<void>;
    deleteSystemUser(uid: string): Promise<void>;
}
