/**
 * Columna del planificador: misma jornada, sobre publicado + borrador + pending.
 *   npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-planner-column.mts
 */
import { buildPlannerColumnHours } from '../../apps/web2/src/lib/planificacion/plannerColumnHours.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const oid = 'OBJ';
const other = 'OTRO';
const emp = 'E1';
const day = '2026-09-10';
const key = `${emp}_${day}`;
const m8 = {
  id: 'm8', employeeId: emp, objectiveId: oid, code: 'M', draft: false,
  startTime: '2026-09-10T13:00:00.000Z', endTime: '2026-09-10T21:00:00.000Z',
};

{
  const col = buildPlannerColumnHours({
    cellTurnosMap: { [key]: [m8] }, shiftsMap: { [key]: m8 }, pendingChanges: {},
    objectiveIds: [oid], groupMode: false, employeeIds: [emp],
  });
  assert(col.byEmployee[emp] === 8, `publicado ${col.byEmployee[emp]}`);
  assert(col.published.hours === 8 && col.working.hours === 8, 'sin cambios, columna = plan');
}

{
  const draft = { ...m8, id: 'draftM', draft: true };
  const col = buildPlannerColumnHours({
    cellTurnosMap: { [key]: [draft] }, shiftsMap: {}, pendingChanges: {},
    objectiveIds: [oid], groupMode: false, employeeIds: [emp],
  });
  assert(col.published.hours === 0, `borrador no entra al plan oficial ${col.published.hours}`);
  assert(col.byEmployee[emp] === 8 && col.working.hours === 8, `columna ve el borrador ${col.working.hours}`);
}

{
  const pending = {
    code: 'D12', name: 'Diurno 12h', hours: 12, startTime: '07:00', endTime: '19:00',
    isTemp: true, objectiveId: oid,
  };
  const col = buildPlannerColumnHours({
    cellTurnosMap: { [key]: [m8] }, shiftsMap: { [key]: m8 }, pendingChanges: { [key]: pending },
    objectiveIds: [oid], groupMode: false, employeeIds: [emp],
  });
  assert(col.published.hours === 8, 'el plan oficial ignora lo no guardado');
  assert(col.byEmployee[emp] === 12, `pending D12 ${col.byEmployee[emp]}`);
}

{
  const col = buildPlannerColumnHours({
    cellTurnosMap: { [key]: [m8] }, shiftsMap: {}, pendingChanges: { [key]: { isDeleted: true } },
    objectiveIds: [oid], groupMode: false, employeeIds: [emp],
  });
  assert(col.published.hours === 8 && col.byEmployee[emp] === 0, 'borrar sin guardar vacía la columna');
}

{
  const ft = {
    id: 'ft', employeeId: emp, objectiveId: oid, code: 'FT',
    startTime: '2026-09-08T03:00:00.000Z', endTime: '2026-09-09T02:59:59.000Z',
  };
  const col = buildPlannerColumnHours({
    cellTurnosMap: { [`${emp}_2026-09-08`]: [ft] }, shiftsMap: {}, pendingChanges: {},
    objectiveIds: [oid], groupMode: false, employeeIds: [emp],
  });
  assert(col.byEmployee[emp] === 8 && col.published.ftHours === 8, `FT día completo ${col.byEmployee[emp]}`);
}

{
  const a = { ...m8, id: 'a' };
  const b = { ...m8, id: 'b', employeeId: 'E2', objectiveId: other, startTime: '2026-09-11T13:00:00.000Z', endTime: '2026-09-11T21:00:00.000Z' };
  const k2 = 'E2_2026-09-11';
  const both = buildPlannerColumnHours({
    cellTurnosMap: { [key]: [a], [k2]: [b] }, shiftsMap: {}, pendingChanges: {},
    objectiveIds: [oid, other], groupMode: true, employeeIds: [emp, 'E2'],
  });
  assert(both.published.hours === 16, `grupo ${both.published.hours}`);
  const one = buildPlannerColumnHours({
    cellTurnosMap: { [key]: [a], [k2]: [b] }, shiftsMap: {}, pendingChanges: {},
    objectiveIds: [oid], groupMode: false, employeeIds: [emp, 'E2'],
  });
  assert(one.published.hours === 8 && (one.byEmployee.E2 || 0) === 0, 'sin grupo no suma el otro objetivo');
}

{
  const sin = {
    id: 'sin', employeeId: 'SIN_COBERTURA', objectiveId: oid, code: '',
    startTime: '2026-09-05T13:00:00.000Z', endTime: '2026-09-05T22:00:00.000Z',
  };
  const col = buildPlannerColumnHours({
    cellTurnosMap: { [`SIN_COBERTURA_2026-09-05`]: [sin], [key]: [m8] },
    shiftsMap: {}, pendingChanges: {},
    objectiveIds: [oid], groupMode: false, employeeIds: [emp],
  });
  assert(col.published.hours === 17 && col.byEmployee[emp] === 8, `filas 8 + fuera ${col.published.hours - 8}`);
  assert(col.published.uncodedHours === 9, `sin código ${col.published.uncodedHours}`);
}

console.log('PLANNER_COLUMN_OK');
