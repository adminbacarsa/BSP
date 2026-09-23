import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { loadPositionHasContinuity } from '../coverage/positionHasContinuity';
export type AutoCompleteContext = {
    isEnabled: (empresaId: unknown) => boolean;
    shiftEmpresaId: (shift: FirebaseFirestore.DocumentData) => string;
    sameTenantShift: (a: FirebaseFirestore.DocumentData, b: FirebaseFirestore.DocumentData) => boolean;
    getEmployeeTokens: (db: Firestore, employeeId: string) => Promise<string[]>;
};
export type AutoCompletePassResult = {
    completed: number;
    alertedNoRelief: number;
};
export declare function runAutoCompletarTurnosPass(db: Firestore, ctx: AutoCompleteContext, now?: Timestamp): Promise<AutoCompletePassResult>;
export { loadPositionHasContinuity };
