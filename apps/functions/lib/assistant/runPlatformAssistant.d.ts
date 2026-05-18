export interface AssistantChatMessageInput {
    role: 'user' | 'assistant';
    content: string;
}
export type ClientDeployPayload = {
    environment: 'emulator' | 'production';
    versionLabel: string;
    buildHash?: string;
    buildTime?: string;
    firebaseProjectId?: string;
};
export interface AssistantChatPayload {
    messages: AssistantChatMessageInput[];
    pathname?: string;
    moduleKey?: string | null;
    empresaId?: string;
    clientToday?: string;
    clientDeploy?: ClientDeployPayload | null;
}
export declare function runPlatformAssistant(uid: string, payload: AssistantChatPayload): Promise<{
    reply: string;
}>;
