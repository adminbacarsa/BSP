import { type Firestore } from 'firebase-admin/firestore';
export type RevertirAusenciaInput = {
    shiftId: string;
    cancelCoverage?: boolean;
    operatorUid?: string;
};
export declare function revertirAusenciaShift(db: Firestore, input: RevertirAusenciaInput): Promise<{
    success: boolean;
    reason?: string;
}>;
