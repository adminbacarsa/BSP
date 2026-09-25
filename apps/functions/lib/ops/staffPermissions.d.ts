import type { Firestore } from 'firebase-admin/firestore';
export declare const STAFF_APP_MODULE_KEYS: readonly ["OPERATIONS", "SUPERVISION", "RRHH", "PLANNING"];
export type StaffAppModuleKey = (typeof STAFF_APP_MODULE_KEYS)[number];
export declare function fullStaffModulePermissions(): Record<StaffAppModuleKey, string[]>;
export declare function moduleActionsFromRolePermissions(permissions: Record<string, unknown>, moduleKey: StaffAppModuleKey): string[];
export declare function buildStaffModulesPayload(permissions: Record<string, unknown>): Record<StaffAppModuleKey, string[]>;
export type ResolvedPanelUser = {
    isSuperAdmin: boolean;
    allEmpresas: boolean;
    empresaId: string;
    roleName: string;
    permissions: Record<string, string[]>;
    operatorName: string;
};
export declare function resolvePanelUserForUid(db: Firestore, uid: string, tokenRoleRaw?: unknown): Promise<ResolvedPanelUser | null>;
export declare function assertOperationsUpdatePermission(db: Firestore, uid: string, empresaId: string, tokenRoleRaw?: unknown): Promise<ResolvedPanelUser>;
