export { isOperationalOriginShift } from './operationalOrigin';
export { isPassiveRetStandbyShift } from './passiveRetShift';
export {
  computeOpsLateArrivalMonitorState,
  hasLateArrivalNotice,
  readLateEtaMinutes,
  resolveLateArrivalEtaAtMs,
  resolveLateAbsenceDeadlineMs,
  formatLateEtaLabelAR,
  opsLateArrivalBadgeLabel,
} from './opsLateArrivalMonitor';
export type { OpsLateArrivalMonitorInput, OpsLateArrivalMonitorState } from './opsLateArrivalMonitor';
export {
  isOpsCoverageHoursOnSourceDoc,
  isActiveOpsCoverageDoc,
  computePlannedOperativelyCovered,
} from './coverageSemantics';
export {
  VACANCY_DESCUBIERTO_RATIO,
  getVacancyElapsedRatio,
  isVacancyDescubierto,
  isActionableOpsVacancy,
} from './vacancyOps';
export {
  SLA_BAND_COVER_ALIGN_MS,
  plannedShiftCoversSlaBand,
  isGapSiblingVacancyDoc,
  isCanonicalGapTitular,
  buildSlaUnplannedGapDocId,
} from './gapVacancy';
export {
  NON_RELIEF_EXTRA_CODES,
  reliefShiftCode,
  reliefIneligibleReason,
  isReliefEligibleShift,
  isExtraNonReliefShift,
} from './reliefEligibility';
export type { ReliefIneligibleReason } from './reliefEligibility';
export {
  SHIFT_SERIES_ALIGN_MS,
  parseShiftSeries,
  isRecognizedSeriesCode,
  nextSeriesCode,
  prevSeriesCode,
  seriesCodeOf,
  seriesHandoffKind,
  seriesBoundMs,
  reliefPositionsMatch,
  relieverFor,
  outgoingFor,
  keepsNextBandSlot,
} from './shiftSeries';
export type { SeriesShift, SeriesHandoffKind, SeriesPickOpts } from './shiftSeries';
export {
  CONVOCADO_ETA_SPEED_KMH,
  CONVOCADO_ETA_WAIT_MIN,
  CONVOCADO_SAME_SITE_ETA_MIN,
  CONVOCADO_DELAY_GRACE_MIN,
  haversineKm,
  busEtaMinutes,
  convocadoTravelEta,
  convocadoReminderAtMs,
} from './convocadoEta';
export { opsShiftCodeBadge, opsShiftCodeRangeLabel } from './shiftCodeBadge';
export type { ShiftCodeBadge, ShiftCodeBadgeTone } from './shiftCodeBadge';
export {
  RETENTION_HARD_CAP_MS,
  formatHmAR,
  formatRetentionDuration,
  buildRetentionWaitInfo,
  formatRetentionLine,
} from './retentionDisplay';
export type { RetentionWaitInfo, RetentionRelieverStatus } from './retentionDisplay';
export { seriesReliefChoiceNotice } from './seriesReliefNotice';
export type { SeriesReliefNotice } from './seriesReliefNotice';
export { classifyOpsShift } from './classifyOpsShift';
export type { ClassifyOpsShiftInput, ClassifyOpsShiftResult } from './classifyOpsShift';
export { shiftMatchesOpsViewTab } from './shiftMatchesOpsViewTab';
export type { OpsViewTabShift } from './shiftMatchesOpsViewTab';
export {
  EVENT_COVERAGE_CASCADE_ORDER,
  OBJECTIVE_COVERAGE_WITH_EVENTUAL,
  isEventoShift,
  eventoTieneFranjasEncadenadas,
  eventualesParaHueco,
  bloqueoCruceEventual,
  planEventualAusente,
} from './eventoCoverage';
export type { EventualCandidato, EventualAusentePlan, EventualesHuecoInput, EventualBolsaRow } from './eventoCoverage';
export {
  COVERAGE_CASCADE_ORDER,
  COVERAGE_LEGACY_CANDIDATE_TYPES,
  COVERAGE_JOIN_TOLERANCE_MS,
  COVERAGE_HARD_CAP_MS,
  COVERAGE_LICENSE_CODES,
  COVERAGE_REJECT_LABEL,
  coverageRejectMessage,
  coverageWizardStepKeys,
  dualSegmentBounds,
  buildCoverageCandidates,
  pickBestCandidate,
  acceptanceStillValid,
} from './coverageCandidates';
export type {
  CoverageCascadeType,
  CoverageWizardStepKey,
  CoverageRejectReason,
  CoverageShiftView,
  CoverageAbsenceView,
  CoverageEmployeeView,
  CoverageEngagementView,
  CoverageGapView,
  BuildCoverageCandidatesInput,
  CoverageCandidateRow,
  CoverageCandidateSet,
  AcceptanceCheck,
} from './coverageCandidates';
export {
  APP_MODE_DEFS,
  STAFF_APP_MODULE_KEYS,
  canAccessMode,
  fullSuperAdminModules,
  normalizeStaffProfile,
  pickDefaultMode,
  resolveVisibleModes,
} from './staffAppModes';
export type {
  AppModeDef,
  AppModeId,
  SesionOperadorAction,
  SesionOperadorRequest,
  SesionOperadorResponse,
  StaffEmpresa,
  StaffProfile,
  WriteOrigin,
} from './staffAppModes';
