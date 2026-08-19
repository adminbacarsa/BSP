export type PortalPlatform = 'web' | 'ios' | 'android';

export type FirestoreTimestampLike =
  | Date
  | { toDate?: () => Date; seconds?: number; _seconds?: number }
  | string
  | number
  | null
  | undefined;

export type Shift = {
  id: string;
  startTime?: FirestoreTimestampLike;
  endTime?: FirestoreTimestampLike;
  objectiveId?: string;
  objectiveName?: string;
  clientName?: string;
  positionName?: string;
  code?: string;
  eventoId?: string;
  eventoNombre?: string;
  servicioId?: string;
  servicioNombre?: string;
  status?: string;
  isPresent?: boolean;
  isCompleted?: boolean;
  isAbsent?: boolean;
  isFranco?: boolean;
  checkInTime?: FirestoreTimestampLike;
  checkInRequestedAt?: FirestoreTimestampLike;
  checkInRequestStatus?: string;
  lateArrivalAt?: FirestoreTimestampLike;
};

export type PortalFeatures = {
  checkIn: boolean;
  reportAbsence: boolean;
  requestLicense: boolean;
  swapShifts: boolean;
  viewSchedule: boolean;
  viewEvents: boolean;
};

export const DEFAULT_PORTAL_FEATURES: PortalFeatures = {
  checkIn: true,
  reportAbsence: true,
  requestLicense: true,
  swapShifts: true,
  viewSchedule: true,
  viewEvents: true,
};

export * from './eventos';

export type ObjectiveLocation = {
  lat: number;
  lng: number;
  name: string;
  clientName?: string;
  address?: string;
  allowRemoteCheckIn?: boolean;
};

export type EmpleadoPortal = {
  id: string;
  uid?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  nombre?: string;
  dni?: string;
  cuil?: string;
  fileNumber?: string;
  legajo?: string;
  category?: string;
  photoUrl?: string;
  empresaId?: string;
  deviceId?: string | null;
  deviceInfo?: Record<string, string>;
  platform?: PortalPlatform;
};

export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type PortalCoreConfig = {
  firebase: FirebasePublicConfig;
  useEmulator: boolean;
  emulatorHost?: string;
  functionsRegion?: string;
};

export type ActivateAndSetPasswordRequest = {
  token: string;
  password: string;
  deviceId: string;
  deviceInfo: Record<string, string>;
  platform?: PortalPlatform;
};

export type ActivateAndSetPasswordResponse = {
  email: string;
  employeeId: string;
};

export type RequestCheckInRequest = {
  shiftId: string;
  coords: { lat: number; lng: number } | null;
  offline?: boolean;
  recordedAt?: string;
  idempotencyKey?: string;
  deviceId?: string;
  platform?: PortalPlatform;
};
