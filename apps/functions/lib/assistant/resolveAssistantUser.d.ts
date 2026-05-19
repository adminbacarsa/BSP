export type AssistantPersona = 'SYSTEM' | 'EMPLOYEE' | 'CLIENT';
export interface ResolvedAssistantUser {
    persona: AssistantPersona;
    roleName?: string | null;
    empresaId: string;
    readableModuleKeys: string[];
    canUseAssistant: boolean;
    summaryLabel: string;
}
export declare function resolveAssistantUser(uid: string): Promise<ResolvedAssistantUser | null>;
export declare function empresaAllowed(claimedEmpresaId: string | undefined, profile: ResolvedAssistantUser): boolean;
