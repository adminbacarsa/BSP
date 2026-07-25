/**
 * Validaciones de convenio / descansos entre turnos.
 * La lógica vive en `restBetweenShifts.ts`; este archivo mantiene el import estable.
 */
export {
    checkRestBetweenShifts,
    checkRestBetweenShiftsDetail,
    describeShiftSchedule,
    getAgreementRestConfig,
    getShiftStartEndAbs,
    isWorkShift,
    resolveWorkShiftStartTime,
    workStreakHoursBackward,
    workStreakStatsBackward,
} from './restBetweenShifts';
export {
    buildGuardCapacityConfig,
    evaluateGuardCanTakeShift,
    evaluateRetAvailableForCoverage,
    guardCapacityRulesSummary,
    rankGuardCoverageCandidates,
    scanAssignmentsCapacityRisks,
    type GuardCapacityConfig,
    type GuardCapacityRisk,
    type GuardCapacityVerdict,
} from './guardCapacityEvaluator';
