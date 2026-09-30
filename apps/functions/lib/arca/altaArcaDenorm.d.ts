import * as admin from 'firebase-admin';
export declare function propagarAltaEnTurnos(db: admin.firestore.Firestore, opts: {
    contratoIds: string[];
    nroTransaccion?: string | null;
    encender: boolean;
}): Promise<number>;
export declare function altaConfirmadaDelContrato(db: admin.firestore.Firestore, contratoId: string): Promise<{
    confirmada: boolean;
    nroTransaccion: string | null;
}>;
