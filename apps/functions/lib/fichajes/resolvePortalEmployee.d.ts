import type { auth } from 'firebase-admin';
type AuthContext = Pick<auth.DecodedIdToken, 'uid' | 'email'>;
export declare function resolvePortalEmployeeDocId(db: FirebaseFirestore.Firestore, token: AuthContext): Promise<string | null>;
export {};
