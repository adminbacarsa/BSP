import { Timestamp, type Firestore } from 'firebase-admin/firestore';
export declare function formatHmArgentina(ms: number): string;
export declare function notifyTurnoFinalizadoRelevo(db: FirebaseFirestore.Firestore, params: {
    outEmpId: string;
    outDocId: string;
    incomingName: string;
    objectiveName: string;
    empresaId: string | null;
}): Promise<void>;
export declare function notifyRetencionAvisoRelevoTarde(db: FirebaseFirestore.Firestore, params: {
    outEmpId: string;
    outDocId: string;
    incomingName: string;
    objectiveName: string;
    etaAtMs: number;
    empresaId: string | null;
}): Promise<void>;
export declare function applyLateReliefNoticeToOutgoing(db: Firestore, incomingShiftId: string, shiftData: Record<string, unknown>, etaAt: Timestamp): Promise<boolean>;
