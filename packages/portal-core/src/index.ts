export * from '@cosp/portal-types';
export { createPortalFirebase, validateFirebaseConfig } from './firebase/createPortalFirebase';
export type { PortalFirebase } from './firebase/createPortalFirebase';
export { createPortalCallables } from './callables';
export type { PortalCallables, ListarTurnosEventualResponse } from './callables';
export { PORTAL_CALLABLES } from './callables/names';
export type { PortalCallableName } from './callables/names';
export { resolveEmpDocId, resolveEmpDocIdWithRetry } from './empleado/resolveEmpDocId';
export { toDate, formatDateAr, formatTimeAr, formatDateTimeAr } from './utils/dates';
export { haversineKm, isWithinCheckInRadius, CHECK_IN_MAX_DISTANCE_KM } from './geo/haversine';
export {
  loadObjectivesMap,
  loadObjectivesMapDetailed,
  getObjectiveForShift,
  buildObjectivesMap,
  findEmbeddedObjective,
  firestoreObjectiveReader,
  resolveObjectiveLocationForShift,
  objectiveEntryFromDoc,
  objectiveEntryFromEmbedded,
  OBJECTIVE_LOCATION_LOAD_ERROR,
  OBJECTIVE_NOT_FOUND_MESSAGE,
} from './objectives/loadObjectivesMap';
export type {
  LoadObjectivesMapOptions,
  LoadObjectivesMapResult,
  ObjectiveDocLike,
  ObjectiveReader,
  ObjectiveLocationLookup,
  ShiftObjectiveRef,
} from './objectives/loadObjectivesMap';
export {
  PENDING_CHECKINS_STORAGE_KEY,
  buildCheckInPayload,
  flushPendingCheckins,
  getCheckInTiming,
  isOperationsCoverageShift,
  isConvocadoCoverageShift,
  isCoverageHoursOnSourceShift,
  parsePendingCheckins,
  validateCheckInDistance,
  resolveAdjustedStartTime,
  evaluateCheckInWindow,
  isCoverageHoursOnSourceDoc,
  isAltaArcaConfirmada,
  checkInRejectMessage,
  timestampLikeToMillis,
  ALTA_ARCA_PENDIENTE_MESSAGE,
} from './checkIn/portalCheckIn';
export type {
  PendingCheckInItem,
  PortalCheckInCoords,
  CheckInTiming,
  CheckInTimingOptions,
  CheckInWindowResult,
  CheckInWindowRejectCode,
} from './checkIn/portalCheckIn';
export {
  resolveCheckInUiStatus,
  presentArrivalCopy,
  isShiftPresent,
  isCheckInRequestRejected,
} from './checkIn/checkInUiStatus';
export type { CheckInUiStatus, CheckInUiStatusView } from './checkIn/checkInUiStatus';
export {
  CONVOCADO_ETA_OPTIONS,
  advanceStartLine,
  convocadoRecordatorioRoute,
  extendUntilLine,
  formatEnCaminoLine,
  isAdvanceDutyShift,
  isExtendedDutyShift,
  isRecordatorioPendiente,
  isConvocadoEta,
  mapsSearchUrl,
  parseConvocadoRecordatorioPush,
  resolveExpectedArrivalAt,
} from './checkIn/convocadoArrival';
export type { ConvocadoEtaMinutes, RecordatorioConvocadoLike } from './checkIn/convocadoArrival';
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
export {
  isEventoActivo,
  calcHorasEvento,
  calcHorasServicio,
  horarioBadgeServicio,
  servicioUbicacionLabel,
  serviciosDisponiblesPortal,
  portalEventosDateRange,
} from './eventos/eventoHelpers';
export {
  isEvShift,
  resolveEvShiftDisplay,
  eventosArrayToMap,
} from './eventos/evShiftDisplay';
export type { EvShiftDisplay } from './eventos/evShiftDisplay';
export {
  loadEventosByEmpresaRange,
  loadSolicitudesEventoByEmpleado,
  createSolicitudEventoGuardia,
  rejectConvocatoriaEvento,
  assignGuardToEvent,
  puedeNoAsistirEventual,
} from './eventos/eventoPortal';
export type { AssignGuardToEventParams } from './eventos/eventoPortal';
export {
  normalizePortalInboxItem,
  solicitudEventoStatusLabel,
  portalInboxDetailLines,
} from './notifications/inboxNormalize';
export type { PortalInboxNormalized } from './notifications/inboxNormalize';
export {
  isOperationalPortalShift,
  isShiftVisibleToEmployee,
  planificacionMonthLookupKey,
  shiftPlanificacionLookupKey,
} from './shifts/employeeShiftVisibility';
export type { EmployeeShiftVisibilityInput } from './shifts/employeeShiftVisibility';
export { isAbsentLikeShift, isActiveAbsenceRecord } from './shifts/isAbsentLikeShift';
export { isFrancoCoverageOriginDoc, isCalendarFrancoSpan } from './shifts/francoCoverageOrigin';
export {
  isEventualClaims,
  bolsaCuilFromClaims,
  todayKeyAr,
  contratoEstadoLabel,
  clasificarContratoEventual,
  acuseRecibido,
  puedeAcusarRecibo,
  horasContrato,
  periodoContratoLabel,
  formatBrutoArs,
  contratoVigenteParaCredencial,
  credencialContratoPublico,
  sinDatosSensibles,
  legajoParaEmpresa,
  empresaLabelDeTurno,
  turnoEsDelEventual,
} from './eventuales/eventualPortal';
export type {
  EventualLegajo,
  ContratoEventualPortal,
  ContratoEventualEstado,
  ContratoBucket,
  JornadaContrato,
  CredencialContratoPublica,
} from './eventuales/eventualPortal';
