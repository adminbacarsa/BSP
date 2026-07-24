export declare function normalizeBackupRole(role: unknown): string;
export declare function isSuperAdminBackupRole(role: unknown): boolean;
export declare function isAdminBackupRole(role: unknown): boolean;
export declare function resolveBackupCaller(uid: string, tokenRoleRaw: unknown): Promise<{
    isPanelUser: boolean;
    isSuper: boolean;
    profileEmpresa: string;
    sysRole: string;
}>;
export declare function assertBackupCallableAllowed(auth: {
    uid: string;
    token?: {
        [key: string]: any;
    };
} | undefined): Promise<void>;
