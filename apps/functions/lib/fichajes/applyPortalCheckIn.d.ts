import type { PortalCheckInInput, PortalCheckInResult } from './fichajesTypes';
export declare function processPortalCheckIn(db: FirebaseFirestore.Firestore, input: PortalCheckInInput): Promise<PortalCheckInResult>;
