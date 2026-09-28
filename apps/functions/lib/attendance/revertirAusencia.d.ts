import { type Firestore } from 'firebase-admin/firestore';
export declare const REVERT_ABSENCE_WINDOW_MS: number;
export type RevertirAusenciaInput = {
    shiftId: string;
    cancelCoverage?: boolean;
    operatorUid?: string;
};
export declare function revertirAusenciaShift(db: Firestore, input: RevertirAusenciaInput): Promise<{
    success: boolean;
    reason?: string;
}>;
