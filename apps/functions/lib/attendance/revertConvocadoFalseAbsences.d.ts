import { type Firestore } from 'firebase-admin/firestore';
export type RevertConvocadoFalseResult = {
    dryRun: boolean;
    scanned: number;
    reverted: number;
    rows: Array<{
        opsCovId: string;
        titularId: string;
        action: string;
    }>;
};
export declare function revertConvocadoFalseAbsencesRun(db: Firestore, opts: {
    empresaId: string;
    dryRun?: boolean;
}): Promise<RevertConvocadoFalseResult>;
