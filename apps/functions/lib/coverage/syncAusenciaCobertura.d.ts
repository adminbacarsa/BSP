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
export type CoverageResolvedBy = 'OPERACIONES' | 'AUTO' | 'MODO_DEMO';
export declare class CoverageApplyError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare function absentShiftCoveragePatch(opts: {
    coveredByEmployeeId?: string | null;
    coveredByEmployeeName?: string | null;
    coverageType?: string;
    coverageDocId?: string | null;
    isAbsence?: boolean;
    resolvedBy?: string;
    titularStatus?: 'COVERED' | 'PARTIAL';
}): Record<string, unknown>;
export declare function isTitularAlreadyCovered(data: Record<string, any> | undefined | null): boolean;
export declare function buildOpsCoverageDocId(titularShiftId: string, employeeId: string): string;
export declare function clearSourceCoverageUsedPatch(): Record<string, unknown>;
export declare function sourceShiftCoverageUsedPatch(opts: {
    titularShiftId: string;
    coverageDocId: string;
    resolvedBy: CoverageResolvedBy;
    isRet: boolean;
}): Record<string, unknown>;
export declare function isActiveOpsCoverageDoc(data: Record<string, any> | undefined | null): boolean;
export declare function supersedeOpsCoveragesForAbsence(db: admin.firestore.Firestore, absenceShiftId: string, batch: admin.firestore.WriteBatch, opts?: {
    keepDocId?: string | null;
    supersededBy?: string | null;
    onlySupersedeCoverageType?: string | null;
}): Promise<number>;
export declare function opsCoverageLinkFields(titular: Record<string, any> | undefined | null, absenceShiftId: string): Record<string, unknown>;
export type ApplyCoverageParams = {
    titularShiftId: string;
    titularShift?: Record<string, unknown>;
    candidateEmployeeId: string;
    candidateEmployeeName: string;
    sourceShiftId?: string | null;
    coverageType: string;
    resolvedBy: CoverageResolvedBy;
    empresaId: string;
    startTime?: admin.firestore.Timestamp | null;
    endTime?: admin.firestore.Timestamp | null;
    code?: string;
    positionName?: string;
    objectiveId?: string;
    objectiveName?: string;
    clientId?: string;
    clientName?: string;
    titularCloseMode?: 'FULL' | 'PARTIAL' | 'NONE';
    convocatoriaId?: string;
    allowReplace?: boolean;
};
export declare function applyCoverage(db: admin.firestore.Firestore, batch: admin.firestore.WriteBatch, params: ApplyCoverageParams): Promise<string>;
