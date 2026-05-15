export interface AssistantChatMessageInput {
    role: 'user' | 'assistant';
    content: string;
}
export interface AssistantChatPayload {
    messages: AssistantChatMessageInput[];
    pathname?: string;
    moduleKey?: string | null;
    empresaId?: string;
    clientToday?: string;
}
export declare function runPlatformAssistant(uid: string, payload: AssistantChatPayload): Promise<{
    reply: string;
}>;
