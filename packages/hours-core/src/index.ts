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
  type PayrollTurnoAccumCtx,
  type PayrollTurnoContribution,
} from './motors/server/payrollTurnoAccumulator';

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
  PAID_LEAVE_CODES,
} from './motors/liquidation/reportesLiquidation';
