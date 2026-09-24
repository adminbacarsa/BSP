import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export declare function detectPublishedSlaGapsForEmpresa(db: Firestore, empresaId: string, now?: Timestamp): Promise<number>;
export declare function runDetectPublishedSlaGaps(db: Firestore, opts: {
    isEnabled: (id: string) => boolean;
    isDemo: (id: string) => boolean;
}): Promise<number>;
