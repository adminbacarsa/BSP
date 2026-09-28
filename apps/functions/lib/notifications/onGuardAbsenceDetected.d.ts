import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
export declare function stampTitularAbsenceVacancyMark(db: admin.firestore.Firestore, turnoId: string): Promise<'STAMPED' | 'SKIPPED'>;
export declare const onGuardAbsenceDetected: functions.CloudFunction<functions.Change<functions.firestore.QueryDocumentSnapshot>>;
