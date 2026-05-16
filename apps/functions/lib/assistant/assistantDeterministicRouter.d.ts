import { type AssistantToolContext } from './assistantDataTools';
export type AssistantRecentMessage = {
    role: 'user' | 'assistant';
    content: string;
};
export declare function tryDeterministicDataReply(lastUser: string, toolCtx: AssistantToolContext, toolsEnabled: boolean, moduleKey: string | null | undefined, pathname: string, recentMessages?: AssistantRecentMessage[]): Promise<string | null>;
