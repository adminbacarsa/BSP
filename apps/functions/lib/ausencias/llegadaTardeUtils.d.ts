import * as admin from 'firebase-admin';
export declare function checkLlegadaTardeReiterada(db: admin.firestore.Firestore, employeeId: string, employeeName: string, empresaId: string | null, absenceDate: string): Promise<void>;
