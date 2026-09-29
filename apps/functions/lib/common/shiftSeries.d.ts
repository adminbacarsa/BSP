export declare const SHIFT_SERIES_ALIGN_MS: number;
declare const EIGHT_BANDS: readonly ["M", "T", "N"];
export type SeriesShift = Record<string, unknown> & {
    id?: string;
    startMs?: number;
    endMs?: number;
    checkInMs?: number;
};
export type SeriesHandoffKind = 'SERIES' | 'FALLBACK' | 'REJECT';
export type SeriesPickOpts = {
    alignMs?: number;
    earliestIncomingMs?: number;
    latestIncomingMs?: number;
};
type ParsedSeries = {
    kind: '8';
    band: (typeof EIGHT_BANDS)[number];
    suffix: string;
} | {
    kind: '12';
    band: 'D12' | 'N12';
};
export declare function parseShiftSeries(code: unknown): ParsedSeries | null;
export declare function isRecognizedSeriesCode(code: unknown): boolean;
export declare function nextSeriesCode(code: unknown): string | null;
export declare function prevSeriesCode(code: unknown): string | null;
export declare function seriesCodeOf(shift: Record<string, unknown> | null | undefined): string;
export declare function seriesHandoffKind(outgoingCode: unknown, incomingCode: unknown): SeriesHandoffKind;
export declare function seriesBoundMs(shift: SeriesShift | null | undefined, kind: 'start' | 'end'): number;
export declare function reliefPositionsMatch(a: unknown, b: unknown): boolean;
export declare function relieverFor<T extends SeriesShift>(outgoing: T, candidates: readonly T[], opts?: SeriesPickOpts): T | null;
export declare function keepsNextBandSlot<T extends SeriesShift>(outgoing: T, siblings: readonly T[], slots: number): boolean;
export declare function outgoingFor<T extends SeriesShift>(incoming: T, candidates: readonly T[], opts?: SeriesPickOpts): T | null;
export {};
