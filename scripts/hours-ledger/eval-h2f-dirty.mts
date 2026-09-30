/**
 * H2f: un turno ensucia solo su objetivo-mes, y un libro con motor viejo entra al recálculo.
 * npx tsx scripts/hours-ledger/eval-h2f-dirty.mts
 */
import {
  LEDGER_ENGINE_VERSION,
  dirtyMarksForAbsence,
  dirtyMarksForObjectives,
  dirtyMarksForPlanif,
  dirtyMarksForTurno,
  hotPeriodKeys,
  ledgerDirtyDocId,
  objectivesNeedingEngine,
  staleEnginePlan,
} from '../../apps/functions/src/hoursLedger/ledgerDirtyPlan.ts';

function fail(msg: string): never {
  throw new Error(msg);
}

const turno = dirtyMarksForTurno(undefined, {
  empresaId: 'pruebas_sa',
  objectiveId: 'OBJ1',
  startTime: '2026-09-16T13:00:00.000Z',
  realStartTime: '2026-09-16T13:05:00.000Z',
});
if (turno.length !== 1) fail(`un turno debe marcar 1, marcó ${turno.length}`);
if (ledgerDirtyDocId(turno[0].empresaId, turno[0].objectiveId, turno[0].periodKey) !== 'pruebas_sa_OBJ1_2026-09') {
  fail(`id ${ledgerDirtyDocId(turno[0].empresaId, turno[0].objectiveId, turno[0].periodKey)}`);
}

const fichada = dirtyMarksForTurno(
  { empresaId: 'pruebas_sa', objectiveId: 'OBJ1', startTime: '2026-09-16T13:00:00.000Z' },
  { empresaId: 'pruebas_sa', objectiveId: 'OBJ1', startTime: '2026-09-16T13:00:00.000Z', realStartTime: '2026-09-16T13:20:00.000Z' },
);
if (fichada.length !== 1 || fichada[0].periodKey !== '2026-09' || fichada[0].objectiveId !== 'OBJ1') {
  fail('la fichada no puede ensuciar otro objetivo ni otro mes');
}

const moved = dirtyMarksForTurno(
  { empresaId: 'pruebas_sa', objectiveId: 'OBJ1', startTime: '2026-09-16T13:00:00.000Z' },
  { empresaId: 'pruebas_sa', objectiveId: 'OBJ2', startTime: '2026-10-02T13:00:00.000Z' },
);
if (moved.length !== 2) fail('mover el turno tiene que marcar origen y destino');

const hot = ['2026-07', '2026-08', '2026-09'];
const sla = dirtyMarksForObjectives(undefined, { empresaId: 'e', objectiveId: 'OBJ1' }, hot);
if (sla.length !== 3 || sla.some((m) => m.objectiveId !== 'OBJ1')) fail('el SLA ensucia solo ese objetivo en la ventana hot');

const client = dirtyMarksForObjectives(
  { empresaId: 'e', objetivos: [{ id: 'A' }] },
  { empresaId: 'e', objetivos: [{ id: 'A' }, { id: 'B' }] },
  hot,
);
const clientIds = [...new Set(client.map((m) => m.objectiveId))].sort();
if (clientIds.join(',') !== 'A,B' || client.length !== 6) fail(`cliente ${clientIds} n=${client.length}`);

const plan = dirtyMarksForPlanif('OBJ1_2026_9', {
  empresaId: 'e', objectiveId: 'OBJ1', year: 2026, month: 9, publishedAt: null,
});
if (plan.length !== 1 || plan[0].periodKey !== '2026-09') fail('despublicar marca ese objetivo-mes');

const aus = dirtyMarksForAbsence({ empresaId: 'e', objectiveId: 'OBJ1', fecha: '2026-09-04' });
if (aus.length !== 1 || aus[0].periodKey !== '2026-09') fail('la ausencia marca el mes de la fecha');
const ausStart = dirtyMarksForAbsence({ empresaId: 'e', objectiveId: 'OBJ1', startDate: '2026-09-04' });
if (ausStart.length !== 1 || ausStart[0].periodKey !== '2026-09') fail('startDate (el campo real de ausencias) marca el mes');
const ausSpan = dirtyMarksForAbsence({ empresaId: 'e', objectiveId: 'OBJ1', startDate: '2026-08-26', endDate: '2026-09-09' });
if (ausSpan.map((m) => m.periodKey).join(',') !== '2026-08,2026-09') fail(`ausencia que cruza mes ${ausSpan.map((m) => m.periodKey)}`);
if (dirtyMarksForAbsence({ empresaId: 'e', startDate: '2026-09-04' }).length !== 0) fail('sin objectiveId no ensucia');

const rows = [
  { level: 'objetivo', objectiveId: 'VIEJO', engineVersion: 0, periodKey: '2026-09' },
  { level: 'objetivo', objectiveId: 'OK', engineVersion: LEDGER_ENGINE_VERSION, periodKey: '2026-09' },
  { level: 'empresa', objectiveId: '', engineVersion: 0, periodKey: '2026-09' },
  { level: 'objetivo', objectiveId: 'FRIO', engineVersion: 0, periodKey: '2024-01' },
];
const hotNow = hotPeriodKeys(new Date('2026-09-29T15:00:00.000Z'));
if (hotNow.length !== 3 || hotNow[2] !== '2026-09') fail(`ventana hot ${hotNow.join(',')}`);
const stale = objectivesNeedingEngine(rows.filter((r) => hotNow.includes(r.periodKey)));
if (stale.join(',') !== 'VIEJO') fail(`versión vieja: ${stale.join(',')}`);
if (stale.includes('FRIO') || stale.includes('OK')) fail('la ventana hot no recalcula el mes frío ni la versión actual');

// Mes hot sin libro (bacarsa julio/agosto): se encola entero una sola vez por versión.
const sinLibro = staleEnginePlan([], undefined);
if (!sinLibro || sinLibro.objectiveIds !== undefined) fail('un mes hot sin libro se encola entero');
if (staleEnginePlan([], { status: 'DONE', engineVersion: LEDGER_ENGINE_VERSION }) !== null) fail('job DONE de esta versión no se repite');
if (staleEnginePlan([], { status: 'RUNNING', engineVersion: LEDGER_ENGINE_VERSION }) !== null) fail('job corriendo no se repite');
if (staleEnginePlan([], { status: 'DONE' }) === null) fail('job viejo sin engineVersion no alcanza');
if (staleEnginePlan([], { status: 'ERROR', engineVersion: LEDGER_ENGINE_VERSION }) === null) fail('job con error se reintenta');
const conLibro = staleEnginePlan(rows.filter((r) => r.periodKey === '2026-09'), { status: 'DONE', engineVersion: LEDGER_ENGINE_VERSION });
if (!conLibro || conLibro.objectiveIds?.join(',') !== 'VIEJO') fail('con libro solo van los objetivos de versión vieja');
if (staleEnginePlan([{ level: 'objetivo', objectiveId: 'OK', engineVersion: LEDGER_ENGINE_VERSION }], undefined) !== null) fail('libro al día no se encola');

console.log('H2F_DIRTY_OK');
