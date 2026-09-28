import * as admin from 'firebase-admin';
export declare function runModoDemoForEmpresa(db: admin.firestore.Firestore, empresaId: string): Promise<{
    presencias: number;
    ausenciasDemo: number;
    convRespuestas: number;
}>;
