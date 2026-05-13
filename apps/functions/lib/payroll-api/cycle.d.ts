import * as admin from 'firebase-admin';
export declare const DEFAULT_CYCLE_START_DAY = 26;
export declare const DEFAULT_CYCLE_END_DAY = 25;
export type CycleRange = {
    cycleId: string;
    cycleStart: Date;
    cycleEnd: Date;
    cycleStartStr: string;
    cycleEndStr: string;
};
export declare const parseCycleId: (cycleId: string) => CycleRange | null;
export declare const listRecentCycles: (count?: number, ref?: Date) => CycleRange[];
export declare const toTs: (d: Date) => admin.firestore.Timestamp;
