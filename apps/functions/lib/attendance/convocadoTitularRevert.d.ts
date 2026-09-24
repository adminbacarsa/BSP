import { type Firestore } from 'firebase-admin/firestore';
export declare function revertTitularAfterConvocadoNoLlego(db: Firestore, opsCov: Record<string, unknown> & {
    id: string;
}): Promise<boolean>;
export declare function cancelPendingConvocatoriasForTitular(db: Firestore, titularShiftId: string): Promise<number>;
