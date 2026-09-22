import * as admin from 'firebase-admin';
export type SyncAusenciaCoberturaParams = {
    shiftId: string;
    coveredByEmployeeId?: string | null;
    coveredByEmployeeName?: string | null;
    coverageType?: string | null;
    resolvedBy?: string;
    empresaId?: string | null;
};
export declare function syncAusenciaCoberturaGestionada(db: admin.firestore.Firestore, params: SyncAusenciaCoberturaParams, batch?: admin.firestore.WriteBatch): Promise<number>;
export declare function absentShiftCoveragePatch(opts: {
    coveredByEmployeeId?: string | null;
    coveredByEmployeeName?: string | null;
    coverageType?: string;
    isAbsence?: boolean;
    resolvedBy?: string;
}): Record<string, unknown>;
export declare function isTitularAlreadyCovered(data: Record<string, any> | undefined | null): boolean;
export declare function isActiveOpsCoverageDoc(data: Record<string, any> | undefined | null): boolean;
export declare function supersedeOpsCoveragesForAbsence(db: admin.firestore.Firestore, absenceShiftId: string, batch: admin.firestore.WriteBatch, opts?: {
    keepDocId?: string | null;
    supersededBy?: string | null;
}): Promise<number>;
export declare function opsCoverageLinkFields(titular: Record<string, any> | undefined | null, absenceShiftId: string): Record<string, unknown>;
