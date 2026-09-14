/**
 * Smoke: isAbsentLikeShift (sin cargar portal-core/index completo).
 * Desde apps/web2: npx tsx scripts/eval-absent-like-shift.ts
 */
import {
  isAbsentLikeShift,
  isActiveAbsenceRecord,
} from '../../../packages/portal-core/src/shifts/isAbsentLikeShift';
import { isShiftVisibleToEmployee } from '../../../packages/portal-core/src/shifts/employeeShiftVisibility';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const published = new Set(['obj1_2026_9']);

assert(isAbsentLikeShift({ isAbsent: true, code: 'M' }), 'isAbsent true');
assert(isAbsentLikeShift({ status: 'ABSENT', code: 'M' }), 'status ABSENT');
assert(isAbsentLikeShift({ absenceType: 'MANUAL_OPS', code: 'M' }), 'MANUAL_OPS');
assert(isAbsentLikeShift({ code: 'AA' }), 'code AA');
assert(isAbsentLikeShift({ code: 'V' }), 'code V');
assert(isAbsentLikeShift({ plannedNovedad: 'E' }), 'plannedNovedad E');
assert(isAbsentLikeShift({ operacionallyCovered: true, code: 'M' }), 'operacionallyCovered');
assert(isAbsentLikeShift({ coveredByEmployeeId: 'x', code: 'M' }), 'coveredBy');
assert(isAbsentLikeShift({ coverageStatus: 'COVERED', code: 'M' }), 'coverageStatus');
assert(!isAbsentLikeShift({ code: 'M', status: 'ASSIGNED' }), 'turno normal no ausente');

assert(isActiveAbsenceRecord({ status: 'Pendiente' }), 'Pendiente activa');
assert(isActiveAbsenceRecord({ status: 'GESTIONADA' }), 'GESTIONADA activa');
assert(!isActiveAbsenceRecord({ status: 'CANCELADA' }), 'CANCELADA no activa');
assert(!isActiveAbsenceRecord({ status: 'INACTIVE' }), 'INACTIVE no activa');

assert(
  !isShiftVisibleToEmployee(
    {
      code: 'M',
      isAbsent: true,
      objectiveId: 'obj1',
      startTime: '2026-09-14T07:00:00',
    },
    published,
  ),
  'ausente no visible como fichable',
);

assert(
  isShiftVisibleToEmployee(
    {
      code: 'M',
      status: 'ASSIGNED',
      objectiveId: 'obj1',
      startTime: '2026-09-14T07:00:00',
    },
    published,
  ),
  'turno publicado visible',
);

console.log('OK eval-absent-like-shift');
