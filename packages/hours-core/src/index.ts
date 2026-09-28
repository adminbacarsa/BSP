export {
  calcTurnoHoursContrib,
  monthKeyFromDate,
  type TurnoHoursContrib,
} from './motors/server/turnoHoursCalc';

export {
  accumulatePayrollTurnoContribution,
  tsToDate as payrollTsToDate,
  dateKeyAR,
  getNightDuration as payrollGetNightDuration,
  clampStart as payrollClampStart,
  clampEnd as payrollClampEnd,
  personaClampStart,
  personaClampEnd,
  type PayrollTurnoAccumCtx,
  type PayrollTurnoContribution,
  type PersonaHoursBreakdown,
} from './motors/server/payrollTurnoAccumulator';

/** Motores F0 congelados (paridad / delta). No usar en consumidores F1. */
export {
  calculateLiquidationHoursStats as calculateLiquidationHoursStatsF0,
  liquidacion200FromWorkedHours as liquidacion200FromWorkedHoursF0,
} from './motors/legacy/reportesLiquidationF0';

export {
  accumulatePayrollTurnoContribution as accumulatePayrollTurnoContributionF0,
} from './motors/legacy/payrollTurnoAccumulatorF0';

export {
  calcTurnoHoursContrib as calcTurnoHoursContribF0,
} from './motors/legacy/turnoHoursCalcF0';

export {
  coalescePlannedCellBillableHours as coalescePlannedCellBillableHoursF0,
} from './motors/legacy/planningTurnoCoalesceF0';

export {
  fichadaHoursForShift,
  fichadaDurationHours,
  isShiftFichado,
  isShiftAbsent,
  isFichadaWorkingShiftCode,
  fichadaAnchorDate,
  FICHADA_SHIFT_HOURS,
} from './motors/crm/fichadaHours';

export {
  toDateSafe,
  getDateKeyInTimezone,
  resolveTurnoScheduleDateKey,
} from './motors/crm/crmDateUtils';

export {
  calcPlanningBillableShiftHours,
  calcPlanificadorShiftHours,
  calcPlanningSlaReconciliationHours,
  planningShiftBillableBreakdown,
  shiftCoverageExtensionExtraHours,
  hoursBetweenClockTimes,
  isOperationalOriginShift,
  isPlanningScheduledCoverageShift,
  isPlanificadorPlannedHoursShift,
} from './motors/planning/planningScheduledHours';

export {
  coalescePlannedTurnosForCell,
  coalescePlannedCellBillableHours,
} from './motors/planning/planningTurnoCoalesce';

export {
  PLANNING_NON_BILLABLE_CODES,
  normalizePlanningPositionName,
} from './motors/planning/positionCoverageUnits';

export {
  RET_STANDBY_REFERENCE_HOURS,
  SHIFT_HOURS_LOOKUP as PLANNING_SHIFT_HOURS_LOOKUP,
} from './motors/planning/constants';

export { isOpsCoverageHoursOnSourceDoc } from './motors/planning/coverageSemantics';

export {
  isSinCoberturaShift,
  isProformaVacancyShift,
  isProformaVacancyEmployee,
} from './motors/planning/proformaVacancy';

export {
  deploymentShiftHours,
  isDeploymentOrPoolShift,
  isRegularLiquidationWorkShift,
  deploymentRoleFromCode,
  DEPLOYMENT_BAND_HOURS,
} from './motors/planning/deploymentRoles';

export { coverageHoursFromShift } from './motors/analisis/coverageHoursFromShift';

export {
  calculateLiquidationHoursStats,
  liquidationBillableHoursForShift,
  collapseShiftsByEmployeeDayForLiquidation,
  propagateFrancoTrabajadoFlags,
  isFrancoTrabajadoShift,
  resolveLiquidationWorkedHours,
  liquidacion200FromWorkedHours,
  prepareShiftsForEmployeeLiquidation,
  resolveShiftDurationHours,
  shouldBillShiftToObjective,
  shiftCalendarDateKey as personaShiftDateKey,
  isShiftEligibleForReports,
  PAID_LEAVE_CODES,
  type ReportPublishFilter,
} from './motors/liquidation/reportesLiquidation';

export {
  buildPersonaBook,
  computePersonaEmployeeLiquidation,
  personaEmployeeDisplayName,
  personaCalendarDateStr,
  buildPersonaPublishStatusMap,
  personaStatsToPayrollFigures,
  sumPersonaAjustesHoras,
  type PersonaBook,
  type PersonaBookEmployee,
  type PersonaBookInput,
  type PersonaLiquidationStats,
  type PersonaPayrollFigures,
} from './persona/personaBook';

export { arYmd, arYearMonth, arMinutesOfDay, withArClock, ymdAddDays } from './time/ar';

export {
  isHoursCoreEnabled,
  HOURS_CORE_FLAG_FIELD,
} from './flag';
