import type { Firestore } from 'firebase-admin/firestore';
export declare const LICENSE_SHIFT_CODES: ReadonlySet<string>;
export declare const FRANCO_SHIFT_CODES: ReadonlySet<string>;
export type SimulableSkipReason = 'LICENCIA' | 'FRANCO' | 'DRAFT' | 'VIRTUAL' | 'OPS_COV_TRACE' | 'FRANCO_ORIGEN' | 'FUERA_OPERACION';
export type SimulableShiftOpts = {
    inOperation?: boolean;
};
export declare function shiftGridCode(data: Record<string, unknown> | null | undefined): string;
export declare function isLicenseShiftCode(code: unknown): boolean;
export declare function isFrancoShiftCode(code: unknown): boolean;
export declare function isLicenseShift(data: Record<string, unknown> | null | undefined): boolean;
export declare function simulableShiftSkipReason(data: Record<string, unknown> | null | undefined, opts?: SimulableShiftOpts): SimulableSkipReason | null;
export declare function isSimulableShift(data: Record<string, unknown> | null | undefined, opts?: SimulableShiftOpts): boolean;
export declare function contractCalendarYmd(value: unknown): string;
export declare function shiftStartMs(data: Record<string, unknown> | null | undefined): number;
export declare class ObjectiveOperationCache {
    private slasByEmpresa;
    private clientsByEmpresa;
    private monthCache;
    isShiftInOperation(db: Firestore, shift: Record<string, unknown> | null | undefined): Promise<boolean>;
    private monthEntry;
    private isPlanPublished;
    private loadSlas;
    private loadClients;
}
export declare function simulableShiftSkipReasonResolved(db: Firestore, data: Record<string, unknown> | null | undefined, cache?: ObjectiveOperationCache): Promise<SimulableSkipReason | null>;
