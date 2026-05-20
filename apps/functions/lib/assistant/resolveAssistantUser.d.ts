export type AssistantPersona = 'SYSTEM' | 'EMPLOYEE' | 'CLIENT';
export interface ResolvedAssistantUser {
    persona: AssistantPersona;
    roleName?: string | null;
    empresaId: string;
    readableModuleKeys: string[];
    canUseAssistant: boolean;
    isSuperAdmin: boolean;
    summaryLabel: string;
}
export type ResolveAssistantUserOptions = {
    tokenRole?: string;
};
export declare function resolveAssistantUser(uid: string, opts?: ResolveAssistantUserOptions): Promise<ResolvedAssistantUser | null>;
export declare function empresaAllowed(claimedEmpresaId: string | undefined, profile: ResolvedAssistantUser): boolean;
