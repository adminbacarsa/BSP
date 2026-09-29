import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { loadPositionHasContinuity } from '../coverage/positionHasContinuity';
export type AutoCompleteContext = {
    isEnabled: (empresaId: unknown) => boolean;
    shiftEmpresaId: (shift: FirebaseFirestore.DocumentData) => string;
    sameTenantShift: (a: FirebaseFirestore.DocumentData, b: FirebaseFirestore.DocumentData) => boolean;
    getEmployeeTokens: (db: Firestore, employeeId: string) => Promise<string[]>;
};
export type AutoCompleteActionKind = 'CLOSE' | 'RETAIN' | 'RETAIN_QUIET' | 'LINK_RELIEF' | 'WAIT';
export type AutoCompleteAction = {
    shiftId: string;
    kind: AutoCompleteActionKind;
    reason: string;
    empresaId: string;
    employeeName: string;
    objectiveName: string;
    positionName: string;
    code: string;
    startMs: number;
    endMs: number;
    workStartMs: number;
    wasRetention: boolean;
    realEndMs?: number;
    requiereRevision?: boolean;
    gapShiftId?: string | null;
    ccOff: boolean;
};
export type AutoCompletePassResult = {
    completed: number;
    alertedNoRelief: number;
    actions: AutoCompleteAction[];
};
export declare function isValidReliefForOutgoing(incoming: FirebaseFirestore.DocumentData, outgoingEndMs: number, outgoing?: FirebaseFirestore.DocumentData): boolean;
export declare function staleProgrammedReliefPatch(shift: FirebaseFirestore.DocumentData): Record<string, unknown>;
export declare function isReliefPresent(incoming: FirebaseFirestore.DocumentData): boolean;
export type AutoCompletarTurnosPassOpts = {
    onlyOutgoingShiftId?: string | null;
    dryRun?: boolean;
    empresaFilter?: (empresaId: string) => boolean;
};
export declare function runAutoCompletarTurnosPass(db: Firestore, ctx: AutoCompleteContext, now?: Timestamp, passOpts?: AutoCompletarTurnosPassOpts): Promise<AutoCompletePassResult>;
export { loadPositionHasContinuity };
