export declare const HEADS_UP_BEFORE_MS: number;
export declare const VENIS_GRACE_MS: number;
export type ArrivalNoticeKind = 'HEADS_UP' | 'VENIS';
export declare function classifyArrivalNotice(startMs: number, nowMs: number): ArrivalNoticeKind | null;
export declare function lugarAviso(parts: {
    clientName?: unknown;
    objectiveName?: unknown;
    positionName?: unknown;
}): string;
export declare function headsUpBody(hora: string, lugar: string): string;
export declare function venisBody(codigo: string, lugar: string, hora: string): string;
