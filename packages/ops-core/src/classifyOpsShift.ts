import { computeOpsLateArrivalMonitorState } from './opsLateArrivalMonitor';
import { isPassiveRetStandbyShift } from './passiveRetShift';
import { getVacancyElapsedRatio, VACANCY_DESCUBIERTO_RATIO } from './vacancyOps';

export type ClassifyOpsShiftInput = {
  shift: Record<string, unknown> & {
    shiftDateObj: Date;
    endDateObj?: Date;
    realStartTime?: { seconds?: number };
    checkInTime?: { seconds?: number };
    autoRetentionAt?: { seconds?: number };
    segmentFromTime?: string;
  };
  now: Date;
  isValidEmployee: boolean;
  isFranco: boolean;
  shiftCode: string;
  effectiveEndDateObj?: Date | null;
  parentEmpleadoId?: string;
  createDateFromTime?: (timeStr: string, baseDate: Date) => Date | null;
};

export type ClassifyOpsShiftResult = {
  isUnassigned: boolean;
  isPresent: boolean;
  isCompleted: boolean;
  isAbsent: boolean;
  isPotentialAbsence: boolean;
  isCoverageSourceUsed: boolean;
  coverageUsedLabel: string | null;
  isPassiveRetStandby: boolean;
  isReportedToPlanning: boolean;
  isOperationalVacancy: boolean;
  isSinCobertura: boolean;
  isDescubierto: boolean;
  isEarlyStart: boolean;
  isConvocado: boolean;
  isAwaitingCoverageCheckIn: boolean;
  isPlannedSplitSegment: boolean;
  isPlannedLiberationRet: boolean;
  isPlannedExtensionImminent: boolean;
  plannedOperativelyCovered: boolean;
  isRetention: boolean;
  isPendingRetention: boolean;
  isPendingClose: boolean;
  isRetentionByField: boolean;
  retentionMinutes: number;
  totalMinutesWorked: number;
  activeStartTime: Date | null;
  hasRRHHNovedad: boolean;
  isRRHHPlanned: boolean;
  isRRHHUrgent: boolean;
  rrhhAnticipacionMinutes: number | null;
  isLateNotified: boolean;
  isLateUnnotified: boolean;
  minutesRemainingLate: number | null;
  lateArrivalEtaMinutes: number | null;
  lateArrivalEtaLabel: string | null;
  isImminent: boolean;
  isFuture: boolean;
  countsForCoverage: boolean;
  minutesUntilStart: number;
  minutesPastStart: number;
  isRfzVacante: boolean;
  isTuraVacante: boolean;
  isResolvedByOps: boolean;
};

const defaultCreateDateFromTime = (timeStr: string, baseDate: Date): Date | null => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

export function classifyOpsShift(input: ClassifyOpsShiftInput): ClassifyOpsShiftResult {
  const { shift, now, isValidEmployee, isFranco, shiftCode, effectiveEndDateObj, parentEmpleadoId } = input;
  const createDateFromTime = input.createDateFromTime ?? defaultCreateDateFromTime;
  const currentTime = now;

  const isAbsent = !!shift.isAbsent;
  const isEarlyStartShift =
    shift.isEarlyStart === true
    || shift.isReten === true
    || shift.origin === 'RETEN'
    || shift.origin === 'OPERATIONS_COVERAGE';
  const shiftStartMs = shift.shiftDateObj ? shift.shiftDateObj.getTime() : 0;
  const withinWindow =
    !shiftStartMs
    || isEarlyStartShift
    || currentTime.getTime() + 4 * 60 * 60 * 1000 >= shiftStartMs;
  const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent && withinWindow;
  const isCompleted = !!shift.isCompleted;

  const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
  const isResolvedByOps = shift.origin === 'OPERATIONS_COVERAGE' || shift.resolvedBy === 'OPERACIONES';

  const isUnassigned = !isValidEmployee;
  const isCoverageSourceUsed =
    shift.coverageUsed === true && shift.isExtended !== true && shift.isEarlyStart !== true;
  const coverageUsedLabel = isCoverageSourceUsed
    ? `Usado: cubre a ${String(
        shift.coverageUsedCoversEmployeeName || shift.coversEmployeeName || 'titular',
      ).trim()}${shift.coverageUsedObjectiveName ? ` en ${shift.coverageUsedObjectiveName}` : ''}`
    : null;

  const isPassiveRetStandby = isPassiveRetStandbyShift({ ...shift, code: shiftCode });
  const isRfzVacante = shiftCode === 'RFZ' && isUnassigned;
  const isTuraVacante = shiftCode === 'TURA' && isUnassigned && !parentEmpleadoId;
  const isOperationalVacancy = isUnassigned && !isReportedToPlanning;
  const isSinCobertura = !!shift.isSinCobertura;

  const endForVacancy = effectiveEndDateObj || shift.endDateObj;
  const isDescubierto =
    isUnassigned
    && (isSinCobertura
      || (() => {
        const ratio = getVacancyElapsedRatio(
          { shiftDateObj: shift.shiftDateObj, endDateObj: endForVacancy },
          currentTime,
        );
        return ratio != null && ratio >= VACANCY_DESCUBIERTO_RATIO;
      })());

  const isEarlyStartScheduled = !!shift.isEarlyStart;
  const isPlannedSplitSegment =
    !!shift.coveragePackageId
    && (shift.coverageSegmentRole === 'EXTENSION' || shift.coverageSegmentRole === 'EARLY_START');
  const isPlannedLiberationRet =
    String(shift.code || '').toUpperCase() === 'RET'
    && (shift.coverageSegmentRole === 'LIBERATED' || !!shift.liberationReason);
  const plannedOperativelyCovered =
    !!shift.operacionallyCovered
    || (shift.coverageStatus === 'COVERED' && (shift.coverageSegmentRole === 'TARGET' || isAbsent))
    || (!!shift.coveredBy && shift.coverageStatus === 'COVERED' && (isAbsent || shift.coverageSegmentRole === 'TARGET'));

  const isEarlyStart =
    !isCoverageSourceUsed
    && isEarlyStartScheduled
    && !isPresent
    && !isCompleted
    && !isAbsent
    && !isUnassigned
    && !isFranco;
  const isConvocado =
    !isCoverageSourceUsed
    && !isPresent
    && !isCompleted
    && !isAbsent
    && !isUnassigned
    && !isFranco
    && (isEarlyStart
      || isPlannedLiberationRet
      || shift.origin === 'RETEN'
      || !!shift.isReten
      || shift.origin === 'OPERATIONS_COVERAGE');
  const extSegStart =
    shift.coverageSegmentRole === 'EXTENSION' && shift.segmentFromTime
      ? createDateFromTime(shift.segmentFromTime, shift.shiftDateObj)
      : null;
  const isPlannedExtensionImminent =
    !!shift.isExtended
    && shift.coverageSegmentRole === 'EXTENSION'
    && !!extSegStart
    && (extSegStart.getTime() - currentTime.getTime()) / 60000 <= 15;

  let minutesUntilStart = (shift.shiftDateObj.getTime() - currentTime.getTime()) / 60000;
  const isAwaitingCoverageCheckIn = isConvocado && minutesUntilStart <= 15;
  if (isAwaitingCoverageCheckIn) minutesUntilStart = Math.min(minutesUntilStart, 0);

  const shiftEnded = effectiveEndDateObj ? currentTime > effectiveEndDateObj : false;
  const isPendingClose = isPresent && !isCompleted && shift.isRetention !== true && !!shiftEnded;
  const isRetentionByField = isPresent && !isCompleted && shift.isRetention === true;
  const isPendingRetention = isPresent && !isCompleted && shift.isRetention === true && !shiftEnded;
  const isRetention = isRetentionByField;
  let retentionMinutes = 0;
  if (isRetentionByField && effectiveEndDateObj && shiftEnded) {
    retentionMinutes = Math.floor((currentTime.getTime() - effectiveEndDateObj.getTime()) / 60000);
  } else if (isRetentionByField && shift.autoRetentionAt?.seconds) {
    retentionMinutes = Math.floor((currentTime.getTime() - shift.autoRetentionAt.seconds * 1000) / 60000);
  }

  const checkInMs = shift.realStartTime?.seconds
    ? shift.realStartTime.seconds * 1000
    : shift.checkInTime?.seconds
      ? shift.checkInTime.seconds * 1000
      : (shift.shiftDateObj?.getTime?.() ?? 0);
  const totalMinutesWorked =
    checkInMs > 0 ? Math.floor((currentTime.getTime() - checkInMs) / 60000) : 0;
  const activeStartTime: Date | null = isPresent
    ? (shift.realStartTime?.seconds
      ? new Date(shift.realStartTime.seconds * 1000)
      : shift.shiftDateObj)
    : null;

  const hasRRHHNovedad =
    !!shift.hasNovedad && !!shift.absenceId && !shift.isFranco && shift.type !== 'NOVEDAD';
  const rrhhAnticipacionMinutes: number | null = (() => {
    if (!hasRRHHNovedad || !shift.absenceCreatedAt || !shift.shiftDateObj) return null;
    const createdAt = new Date(String(shift.absenceCreatedAt)).getTime();
    return Math.round((shift.shiftDateObj.getTime() - createdAt) / 60000);
  })();
  const isRRHHPlanned =
    hasRRHHNovedad && rrhhAnticipacionMinutes !== null && rrhhAnticipacionMinutes >= 720;
  const isRRHHUrgent =
    hasRRHHNovedad && rrhhAnticipacionMinutes !== null && rrhhAnticipacionMinutes < 720;

  const minutesPastStart = -minutesUntilStart;
  const lateEligible =
    !isCoverageSourceUsed
    && !isPassiveRetStandby
    && !isPresent
    && !isCompleted
    && !isAbsent
    && !isUnassigned
    && !isFranco
    && !hasRRHHNovedad;
  const startMs = shift.shiftDateObj?.getTime?.() ?? 0;
  const nowMs = currentTime.getTime();
  const lateMonitor = computeOpsLateArrivalMonitorState({
    shift,
    startMs,
    nowMs,
    eligible: lateEligible,
  });
  const {
    isLateNotified,
    isLateUnnotified,
    isPotentialAbsence,
    minutesRemainingLate,
    lateArrivalEtaMinutes,
    lateArrivalEtaLabel,
  } = lateMonitor;
  const isImminent =
    lateEligible && !isLateNotified && minutesUntilStart <= 15 && minutesUntilStart > -5;
  const isFuture =
    !isCoverageSourceUsed
    && !isPassiveRetStandby
    && !isPresent
    && !isCompleted
    && !isUnassigned
    && !isAbsent
    && !isFranco
    && !hasRRHHNovedad
    && minutesUntilStart > 15
    && !isLateNotified;

  const isAutoNotification = shift.origin === 'SLA_VIRTUAL';
  const countsForCoverage =
    !isCoverageSourceUsed
    && !isPassiveRetStandby
    && !isAutoNotification
    && ((isValidEmployee && !isAbsent && !isPotentialAbsence && !hasRRHHNovedad)
      || (isReportedToPlanning && !isValidEmployee)
      || (isPlannedSplitSegment && !isAbsent && !isPotentialAbsence));

  return {
    isUnassigned,
    isPresent,
    isCompleted,
    isAbsent,
    isPotentialAbsence,
    isCoverageSourceUsed,
    coverageUsedLabel,
    isPassiveRetStandby,
    isReportedToPlanning,
    isOperationalVacancy,
    isSinCobertura,
    isDescubierto,
    isEarlyStart,
    isConvocado,
    isAwaitingCoverageCheckIn,
    isPlannedSplitSegment,
    isPlannedLiberationRet,
    isPlannedExtensionImminent,
    plannedOperativelyCovered,
    isRetention,
    isPendingRetention,
    isPendingClose,
    isRetentionByField,
    retentionMinutes,
    totalMinutesWorked,
    activeStartTime,
    hasRRHHNovedad,
    isRRHHPlanned,
    isRRHHUrgent,
    rrhhAnticipacionMinutes,
    isLateNotified,
    isLateUnnotified,
    minutesRemainingLate,
    lateArrivalEtaMinutes,
    lateArrivalEtaLabel,
    isImminent,
    isFuture,
    countsForCoverage,
    minutesUntilStart,
    minutesPastStart,
    isRfzVacante,
    isTuraVacante,
    isResolvedByOps,
  };
}
