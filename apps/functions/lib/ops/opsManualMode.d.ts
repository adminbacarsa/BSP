import type { Firestore } from 'firebase-admin/firestore';
export declare function isEmpresaManualMode(db: Firestore, empresaId: string): Promise<boolean>;
