/**
 * Validaciones de convenio / descansos entre turnos.
 * La lógica vive en `restBetweenShifts.ts`; este archivo mantiene el import estable.
 */
export { checkRestBetweenShifts, getAgreementRestConfig, getShiftStartEndAbs, workStreakHoursBackward } from './restBetweenShifts';
