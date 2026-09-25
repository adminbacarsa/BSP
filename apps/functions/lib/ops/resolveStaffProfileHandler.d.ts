import type { Firestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { type StaffAppModuleKey } from './staffPermissions';
export type ResolveStaffProfileResponse = {
    isGuard: boolean;
    employeeId?: string;
    isStaff: boolean;
    isSuperAdmin: boolean;
    empresas: {
        id: string;
        name: string;
    }[];
    modules: Record<StaffAppModuleKey, string[]>;
};
export declare function resolveStaffProfileForUid(db: Firestore, uid: string, tokenRole?: unknown): Promise<ResolveStaffProfileResponse>;
export declare const resolveStaffProfileCallable: functions.HttpsFunction & functions.Runnable<any>;
