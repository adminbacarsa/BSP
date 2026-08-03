export * from '@cosp/portal-types';
export { createPortalFirebase, validateFirebaseConfig } from './firebase/createPortalFirebase';
export type { PortalFirebase } from './firebase/createPortalFirebase';
export { createPortalCallables } from './callables';
export type { PortalCallables } from './callables';
export { PORTAL_CALLABLES } from './callables/names';
export type { PortalCallableName } from './callables/names';
export { resolveEmpDocId, resolveEmpDocIdWithRetry } from './empleado/resolveEmpDocId';
export { toDate, formatDateAr, formatTimeAr } from './utils/dates';
export { haversineKm, isWithinCheckInRadius, CHECK_IN_MAX_DISTANCE_KM } from './geo/haversine';
export { loadObjectivesMap, getObjectiveForShift } from './objectives/loadObjectivesMap';
export {
  PENDING_CHECKINS_STORAGE_KEY,
  buildCheckInPayload,
  flushPendingCheckins,
  getCheckInTiming,
  parsePendingCheckins,
  validateCheckInDistance,
} from './checkIn/portalCheckIn';
export type {
  PendingCheckInItem,
  PortalCheckInCoords,
  CheckInTiming,
  CheckInTimingOptions,
} from './checkIn/portalCheckIn';
export {
  resolveCheckInUiStatus,
  isShiftPresent,
  isCheckInRequestRejected,
} from './checkIn/checkInUiStatus';
export type { CheckInUiStatus, CheckInUiStatusView } from './checkIn/checkInUiStatus';
export {
  ABSENCE_TYPE_OPTIONS,
  absenceSubmitToastMessage,
  absenceSubmitToastMessageForType,
  absenceTypeEmployeeLabel,
  absenceTypeEmployeeHint,
  classifyAbsenceForEmployee,
  dateKeyLocal,
  filterAbsenceTypesForFeatures,
} from './absences/employeeAbsence';
export type { AbsenceType, AbsenceCase, ClassifiedAbsence } from './absences/employeeAbsence';
