export type FichajeTipo = 'CHECK_IN' | 'CHECK_OUT';
export type FichajeStatus = 'PENDING' | 'APPLIED' | 'REJECTED';
export type FichajeSource = 'PORTAL_GPS' | 'MANUAL_RADIO' | 'MANUAL_PHONE' | 'OPERATIONS';

export interface PortalCheckInInput {
  shiftId: string;
  empId: string;
  coords?: { lat?: number; lng?: number } | null;
  recordedAt?: string | null;
  idempotencyKey?: string | null;
  source?: FichajeSource;
}

export interface PortalCheckInResult {
  success: boolean;
  fichajeId: string;
  alreadyApplied?: boolean;
}
