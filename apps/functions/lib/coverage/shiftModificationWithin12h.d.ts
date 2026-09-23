import * as admin from 'firebase-admin';
export declare function handlePublishedShiftModifiedWithin12h(db: admin.firestore.Firestore, before: Record<string, unknown>, after: Record<string, unknown>, turnoId: string): Promise<{
    notified: boolean;
    orphanCoverage: boolean;
}>;
