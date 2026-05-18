import { type AssistantToolContext } from './assistantDataTools';
export type AssistantRecentMessage = {
    role: 'user' | 'assistant';
    content: string;
};
export type ClienteObjetivoPar = {
    cliente: string;
    objetivo: string;
    texto: string;
};
export declare function looksLikeFalseEmptyTurnosReply(text: string): boolean;
export declare function shouldPrefetchMetricsSnapshot(lastUser: string, moduleKey: string | null | undefined, recentMessages?: AssistantRecentMessage[]): boolean;
export declare function shouldPrefetchOperationsMetricsInSnapshot(lastUser: string): boolean;
export declare function tryDeterministicDataReply(lastUser: string, toolCtx: AssistantToolContext, toolsEnabled: boolean, moduleKey: string | null | undefined, pathname: string, recentMessages?: AssistantRecentMessage[]): Promise<string | null>;
