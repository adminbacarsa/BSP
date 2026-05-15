import { type AssistantToolContext } from './assistantDataTools';
export declare function tryDeterministicDataReply(lastUser: string, toolCtx: AssistantToolContext, toolsEnabled: boolean, moduleKey: string | null | undefined, pathname: string): Promise<string | null>;
