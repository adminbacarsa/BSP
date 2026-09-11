import type { PortalCheckInInput, PortalCheckInResult } from './fichajesTypes';
import { registrarPresencia } from './registrarPresencia';
export declare function processPortalCheckIn(db: FirebaseFirestore.Firestore, input: PortalCheckInInput): Promise<PortalCheckInResult>;
export { registrarPresencia };
