import * as admin from 'firebase-admin';
export declare function isOperationalTurnoForCc(t: Record<string, unknown>): boolean;
export declare class CcObjectiveMonthGate {
    private publishCache;
    private slaByEmpresa;
    isTurnoInCcScope(db: admin.firestore.Firestore, t: Record<string, unknown>): Promise<boolean>;
    private isPlanPublished;
    private loadSlas;
    private hasActiveSlaForMonth;
}
