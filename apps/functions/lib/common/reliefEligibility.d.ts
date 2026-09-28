export declare const NON_RELIEF_EXTRA_CODES: ReadonlySet<string>;
export type ReliefIneligibleReason = 'SIN_TURNO' | 'DRAFT' | 'VIRTUAL' | 'OPS_COV_TRACE' | 'LICENCIA' | 'FRANCO' | 'EXTRA_NO_RELEVA';
export declare function reliefShiftCode(shift: Record<string, unknown> | null | undefined): string;
export declare function reliefIneligibleReason(shift: Record<string, unknown> | null | undefined): ReliefIneligibleReason | null;
export declare function isReliefEligibleShift(shift: Record<string, unknown> | null | undefined): boolean;
export declare function isExtraNonReliefShift(shift: Record<string, unknown> | null | undefined): boolean;
