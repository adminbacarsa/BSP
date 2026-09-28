export declare const LICENSE_SHIFT_CODES: ReadonlySet<string>;
export declare const FRANCO_SHIFT_CODES: ReadonlySet<string>;
export type SimulableSkipReason = 'LICENCIA' | 'FRANCO' | 'DRAFT' | 'VIRTUAL' | 'OPS_COV_TRACE';
export declare function shiftGridCode(data: Record<string, unknown> | null | undefined): string;
export declare function isLicenseShiftCode(code: unknown): boolean;
export declare function isFrancoShiftCode(code: unknown): boolean;
export declare function isLicenseShift(data: Record<string, unknown> | null | undefined): boolean;
export declare function simulableShiftSkipReason(data: Record<string, unknown> | null | undefined): SimulableSkipReason | null;
export declare function isSimulableShift(data: Record<string, unknown> | null | undefined): boolean;
