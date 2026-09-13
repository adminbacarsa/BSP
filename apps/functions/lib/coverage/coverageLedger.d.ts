import { type WriteBatch } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
export type CoverageLedgerInput = {
    vacancyShiftId?: string | null;
    titularShiftId?: string | null;
    covererShiftId?: string | null;
    covererEmployeeId: string;
    covererEmployeeName: string;
    titularEmployeeId?: string | null;
    titularEmployeeName?: string | null;
    coverageType: string;
    titularIsAbsence?: boolean;
    resolvedBy?: string;
    coverageEventId?: string | null;
    vacancyExtra?: Record<string, unknown>;
    covererExtra?: Record<string, unknown>;
    markVacancyCovered?: boolean;
    causedByShiftIdPreserve?: string | null;
};
export declare function newCoverageEventId(): string;
export declare function resolveTitularFromAbsenceOrVacancy(absenceShift: any & {
    id?: string;
}): {
    titularShiftId: string | null;
    titularEmployeeId: string | null;
    titularEmployeeName: string;
    vacancyShiftId: string | null;
};
export declare function covererLedgerFields(input: CoverageLedgerInput & {
    coverageEventId: string;
}): Record<string, unknown>;
export declare function coveredPartyLedgerFields(input: CoverageLedgerInput & {
    coverageEventId: string;
}, kind: 'vacancy' | 'titular'): Record<string, unknown>;
export declare function applyCoverageLedgerToBatch(batch: WriteBatch, db: admin.firestore.Firestore, input: CoverageLedgerInput): string;
