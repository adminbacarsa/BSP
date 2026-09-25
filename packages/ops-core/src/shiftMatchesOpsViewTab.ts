import { isActionableOpsVacancy, isVacancyDescubierto } from './vacancyOps';

/** Turno enriquecido mínimo para filtros de pestaña CC. */
export type OpsViewTabShift = Record<string, unknown> & {
  isUnassigned?: boolean;
  isReportedToPlanning?: boolean;
  isPassiveRetStandby?: boolean;
  isFranco?: boolean;
  isImminent?: boolean;
  isRetention?: boolean;
  isPendingRetention?: boolean;
  isEarlyStart?: boolean;
  isAwaitingCoverageCheckIn?: boolean;
  isPlannedExtensionImminent?: boolean;
  isPlannedLiberationRet?: boolean;
  isRRHHUrgent?: boolean;
  isLateNotified?: boolean;
  isLateUnnotified?: boolean;
  isPotentialAbsence?: boolean;
  isAbsent?: boolean;
  isFuture?: boolean;
  isRRHHPlanned?: boolean;
  isPresent?: boolean;
  isCompleted?: boolean;
  isPendingClose?: boolean;
  hasRRHHNovedad?: boolean;
  origin?: string;
  isReten?: boolean;
  code?: string;
  shiftDateObj?: Date;
  endDateObj?: Date;
};

export function shiftMatchesOpsViewTab(s: OpsViewTabShift, viewTab: string, now: Date = new Date()): boolean {
  switch (viewTab) {
    case 'TODOS':
      if (s.isUnassigned && (s.isReportedToPlanning || isVacancyDescubierto(s, now))) return false;
      if (s.isPassiveRetStandby) return false;
      return !s.isFranco;
    case 'PRIORIDAD':
      return (
        (s.isImminent
          || s.isRetention
          || s.isPendingRetention
          || s.isEarlyStart
          || s.isAwaitingCoverageCheckIn
          || s.isPlannedExtensionImminent
          || s.isPlannedLiberationRet
          || s.isRRHHUrgent)
        && !s.isFranco
        && !s.isPassiveRetStandby
      );
    case 'NO_LLEGO':
      return (
        (s.isLateNotified || s.isLateUnnotified || s.isPotentialAbsence)
        && !s.isFranco
        && !s.isAbsent
        && !s.isEarlyStart
        && !s.isAwaitingCoverageCheckIn
        && !s.hasRRHHNovedad
        && !s.isPassiveRetStandby
      );
    case 'PLAN':
      return (
        (s.isFuture || s.isRRHHPlanned)
        && !s.isFranco
        && !s.isUnassigned
        && !s.isEarlyStart
        && !s.isAwaitingCoverageCheckIn
        && !s.isPlannedLiberationRet
        && !s.isPassiveRetStandby
      );
    case 'ACTIVOS':
      return s.isPresent && !s.isCompleted && !s.isRetention && !s.isPendingRetention && !s.isPendingClose;
    case 'RETENIDOS':
      return !!s.isRetention;
    case 'VACANTES':
      return isActionableOpsVacancy(s, now);
    case 'AUSENTES':
      if (s.isRetention || s.origin === 'RETEN' || s.isReten || String(s.code || '').toUpperCase() === 'RET') {
        return false;
      }
      return !!(s.isAbsent || s.isPotentialAbsence);
    case 'FRANCOS':
      return !!s.isFranco;
    default:
      return !s.isFranco;
  }
}
