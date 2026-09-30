import * as admin from 'firebase-admin';
import { type EventualCandidato } from './eventoCoverage';
export declare function loadEventualesParaHueco(db: admin.firestore.Firestore, shift: {
    empresaId?: string;
    startTime?: unknown;
    endTime?: unknown;
    lat?: unknown;
    lng?: unknown;
    latitude?: unknown;
    longitude?: unknown;
}): Promise<EventualCandidato[]>;
export declare function registrarAsignacionEventualEnBatch(db: admin.firestore.Firestore, batch: admin.firestore.WriteBatch, opts: {
    empresaId: string;
    cuil: string;
    employeeId: string;
    employeeName: string;
    startMs: number;
    endMs: number;
    shiftId: string;
    covDocId: string;
}): Promise<void>;
