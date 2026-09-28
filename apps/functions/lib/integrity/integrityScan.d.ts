import * as admin from 'firebase-admin';
import { type IntegrityReportBody } from './integrityClassify';
export declare function runIntegrityScanForEmpresa(db: admin.firestore.Firestore, empresaId: string, now?: Date): Promise<IntegrityReportBody>;
export declare function persistIntegrityReport(db: admin.firestore.Firestore, report: IntegrityReportBody): Promise<{
    reportId: string;
    novedadCreated: boolean;
}>;
export declare function runNightlyIntegrity(db: admin.firestore.Firestore, now?: Date): Promise<{
    empresas: number;
    withFindings: number;
}>;
export declare const scheduledIntegrityScan: import("firebase-functions/v2/scheduler").ScheduleFunction;
