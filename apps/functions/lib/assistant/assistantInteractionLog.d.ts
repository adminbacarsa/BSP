export type AssistantLogOutcome = 'answered' | 'unsatisfied' | 'error';
export type AssistantInteractionLogInput = {
    empresaId: string;
    uid: string;
    userEmail?: string | null;
    question: string;
    reply?: string | null;
    moduleKey?: string | null;
    pathname?: string;
    outcome: AssistantLogOutcome;
    errorCode?: string | null;
    errorMessage?: string | null;
    durationMs?: number;
};
export declare function classifyAssistantOutcome(reply: string | null | undefined, hadError: boolean): AssistantLogOutcome;
export declare function writeAssistantInteractionLog(input: AssistantInteractionLogInput): Promise<void>;
export declare function extractLastUserQuestion(messages: Array<{
    role?: string;
    content?: string;
}>): string;
