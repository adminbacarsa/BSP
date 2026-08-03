import * as admin from 'firebase-admin';
export type MigrateAbsenceCertificateResult = {
    ok: true;
    driveFileId: string;
    driveLink: string;
} | {
    ok: false;
    skipped: true;
    reason: string;
} | {
    ok: false;
    skipped: false;
    error: string;
};
export declare function storagePathFromFirebaseDownloadUrl(url: string): string | null;
export declare function migrateAbsenceCertificateToDrive(ausenciaId: string, data: admin.firestore.DocumentData): Promise<MigrateAbsenceCertificateResult>;
