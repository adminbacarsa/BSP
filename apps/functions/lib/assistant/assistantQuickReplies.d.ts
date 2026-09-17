export declare const QUICK_REPLIES_MARKER_RE: RegExp;
export declare function parseQuickReplyLabel(line: string): string | null;
export declare function extractQuickRepliesFromText(content: string): string[];
export declare function attachQuickRepliesMarker(reply: string, replies?: string[]): string;
export declare const MODULE_HELP_MENUS: Record<string, {
    intro: string;
    options: string[];
}>;
export declare function buildModuleHelpMenuReply(moduleKey: string | null | undefined): string | null;
