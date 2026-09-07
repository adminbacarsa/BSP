/**
 * Smoke — capacidad 200 + informe mes COSP.
 * Ejecutar desde apps/web2: npm run eval:service-capacity-viability
 */
import './eval-bootstrap-env';
import {
  buildServiceCapacityViability,
  vacationCalendarDaysBySeniority,
  yearsSeniorityAt,
} from '../src/lib/servicios/serviceCapacityViability';
import { buildServiceObjectiveMonthReport } from '../src/lib/servicios/serviceObjectiveMonthReport';
import { WorkScheme } from '../src/lib/servicios/serviceMarginOptimizer';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK:', msg);
}

const service = {
  objectiveId: 'obj1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  excludedDates: [] as string[],
  positions: [
    {
      id: 'p1',
      name: 'Puesto 1',
      quantity: 1,
      coverageType: '24hs' as const,
      activeDays: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
      allowedShiftTypes: [
        { code: 'M', name: 'Mañana', startTime: '06:00', endTime: '14:00', hours: 8 },
        { code: 'T', name: 'Tarde', startTime: '14:00', endTime: '22:00', hours: 8 },
        { code: 'N', name: 'Noche', startTime: '22:00', endTime: '06:00', hours: 8 },
      ],
    },
  ],
};

assert(vacationCalendarDaysBySeniority(3) === 14, 'vacaciones <5 años = 14');
assert(vacationCalendarDaysBySeniority(7) === 21, 'vacaciones 5–10 = 21');
assert(vacationCalendarDaysBySeniority(12) === 28, 'vacaciones 10–20 = 28');
assert(yearsSeniorityAt(new Date(2016, 0, 1), new Date(2026, 7, 31)) === 10, 'antigüedad 10 años');

const emps = [
  {
    id: 'e1',
    name: 'Guardia A',
    status: 'ACTIVE',
    preferredObjectiveId: 'obj1',
    startDate: '2016-01-01',
    planificacionDotacion: { obj1: { shiftCode: 'M', positionName: 'Puesto 1' } },
  },
  {
    id: 'e2',
    name: 'Guardia B',
    status: 'ACTIVE',
    preferredObjectiveId: 'obj1',
    startDate: '2022-06-01',
    planificacionDotacion: { obj1: { shiftCode: 'N', positionName: 'Puesto 1' } },
  },
];

const cap = buildServiceCapacityViability({
  service,
  employees: emps,
  year: 2026,
  month: 7,
});

assert(cap.plantilla === 2, `plantilla=2 got ${cap.plantilla}`);
assert(cap.slaHsMonth > 0, `slaHsMonth>0 got ${cap.slaHsMonth}`);
assert(cap.guards[0].scheme === WorkScheme.SixTwo, 'esquema 6x2 para M/N');
assert(cap.guards.every((g) => g.netHs <= 200), 'neta ≤ 200');
assert(cap.horasPerdidas === Math.max(0, cap.gapHs), 'horasPerdidas = max(0, gap)');
assert(cap.guards.every((g) => g.vacationHsMonth === 0), 'sin V en mes → VAC mes 0');
assert(cap.guards.every((g) => g.vacationDaysPending === g.vacationDaysYear), 'sin tomadas → pend = derecho');
assert(cap.ausentismo.modo === 'sin_indice', 'sin historial → sin_indice');
console.log('  SLA', cap.slaHsMonth, 'neta', cap.capacityNetHs, 'ratio', cap.ratioPct);

// V autorizadas en el mes restan capacidad real
{
  const withVac = buildServiceCapacityViability({
    service,
    employees: [emps[0]],
    year: 2026,
    month: 7,
    ausenciasVac: [
      {
        employeeId: 'e1',
        type: 'Vacaciones',
        status: 'Autorizada',
        startDate: '2026-08-10',
        endDate: '2026-08-16',
      },
    ],
  });
  const g = withVac.guards[0];
  assert(g.vacationDaysInMonth === 7, `VAC mes 7d got ${g.vacationDaysInMonth}`);
  assert(g.vacationDaysTakenYtd === 7, `tomadas YTD 7 got ${g.vacationDaysTakenYtd}`);
  assert(g.vacationDaysPending === g.vacationDaysYear - 7, 'pend = der - tom');
  assert(g.vacationHsMonth === 7 * 8, `VAC hs ${g.vacationHsMonth}`);
}

// preferredObjectiveId = id del documento SLA (como en Planificación)
{
  const bySlaId = buildServiceCapacityViability({
    service: { ...service, id: 'sla-doc-1' },
    employees: [
      {
        id: 'e3',
        name: 'Guardia SLA-id',
        status: 'ACTIVE',
        preferredObjectiveId: 'sla-doc-1',
        startDate: '2020-01-01',
        planificacionDotacion: { 'sla-doc-1': { shiftCode: 'T' } },
      },
    ],
    year: 2026,
    month: 7,
  });
  assert(bySlaId.plantilla === 1, 'preferredObjectiveId=SLA id cuenta en plantilla');
  assert(bySlaId.capacityNetHs > 0, 'capacidad > 0 con preferido por SLA id');
}

const turnos = [
  {
    id: 't1',
    objectiveId: 'obj1',
    employeeId: 'e1',
    employeeName: 'Guardia A',
    code: 'M',
    scheduleDate: '2026-08-01',
    startTime: '2026-08-01T06:00:00',
    hours: 8,
  },
  {
    id: 't2',
    objectiveId: 'obj1',
    employeeId: 'e2',
    employeeName: 'Guardia B',
    code: 'N',
    scheduleDate: '2026-08-01',
    startTime: '2026-08-01T22:00:00',
    hours: 8,
    isPresent: true,
    isCompleted: true,
    realStartTime: '2026-08-01T22:05:00',
    realEndTime: '2026-08-02T06:05:00',
  },
];

const rep = buildServiceObjectiveMonthReport({
  service,
  turnos,
  employees: emps,
  year: 2026,
  month: 7,
});

assert(rep.planHs >= 8, `planHs>=8 got ${rep.planHs}`);
assert(rep.realHs >= 8, `realHs>=8 got ${rep.realHs}`);
assert(rep.calendario.length === 31, 'calendario agosto 31 días');
assert(rep.guardias.length >= 1, 'hay guardias en informe');
console.log('  plan', rep.planHs, 'real', rep.realHs, 'desvíos', rep.diasIncompletos);

console.log('\nAll service capacity / month report smokes passed.');
