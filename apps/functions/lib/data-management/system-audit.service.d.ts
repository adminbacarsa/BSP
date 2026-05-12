import * as admin from 'firebase-admin';
export type AuditModule = 'CLIENTS' | 'EMPLOYEES' | 'SYSTEM' | 'SCHEDULING' | 'ABSENCE' | 'OVERTIME';
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT' | 'PUBLISH' | 'APPROVE' | 'REJECT';
export interface ISystemLog {
    id: string;
    actorUid: string;
    actorName: string;
    action: AuditAction;
    module: AuditModule;
    details: string;
    metadata?: any;
    timestamp: admin.firestore.Timestamp;
    ip?: string;
}
export declare class SystemAuditService {
    private getDb;
    private readonly COLLECTION_NAME;
    logAction(actorUid: string, actorName: string, action: AuditAction, module: AuditModule, details: string, metadata?: any): Promise<void>;
    getLogs(limit?: number, moduleFilter?: string): Promise<ISystemLog[]>;
    getSystemStats(): Promise<{
        totalClients: number;
        activeEmployees: number;
        totalAuditLogs: number;
    }>;
}
