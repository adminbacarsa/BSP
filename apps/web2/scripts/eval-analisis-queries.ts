/**
 * Smoke del motor puro de Análisis (rangos, ausencias, demanda).
 * Uso: npx tsx scripts/eval-analisis-queries.ts  (desde apps/web2)
 */
import {
  envelopingRange,
  gapsToFetch,
  isRangeCovered,
  mergeIntervals,
  categoryFromAbsenceCode,
  resolveAbsenceCode,
  buildAusenciasStats,
  topNPlusResto,
} from '../src/lib/analisis/analisisQueries';
import {
  buildInformeAnalitico,
  buildInformeSeries,
  chooseInformeSeriesBucket,
  estimarCostoInforme,
  iterateInformeBuckets,
} from '../src/lib/analisis/analisisInforme';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error('FAIL', msg);
  } else {
    console.log('ok  ', msg);
  }
}

const aug = envelopingRange(new Date(2026, 7, 14), new Date(2026, 7, 14, 23, 59, 59, 999));
assert(aug.start.getDate() === 1 && aug.end.getDate() === 31, 'envolvente de un día = mes calendario');

const year = envelopingRange(new Date(2026, 0, 1), new Date(2026, 11, 31, 23, 59, 59, 999));
assert(year.start.getMonth() === 0 && year.end.getMonth() === 11, 'envolvente anual');

const covered = mergeIntervals([
  { startMs: new Date(2026, 7, 1).getTime(), endMs: new Date(2026, 7, 31, 23, 59, 59, 999).getTime() },
]);
assert(
  isRangeCovered(covered, { startMs: new Date(2026, 7, 10).getTime(), endMs: new Date(2026, 7, 16).getTime() }),
  'día/semana dentro del mes ya cubierto',
);
assert(
  !isRangeCovered(covered, { startMs: new Date(2026, 0, 1).getTime(), endMs: new Date(2026, 11, 31).getTime() }),
  'año no cubierto si solo hay agosto',
);

const gaps = gapsToFetch(covered, {
  startMs: new Date(2026, 0, 1).getTime(),
  endMs: new Date(2026, 11, 31, 23, 59, 59, 999).getTime(),
});
assert(gaps.length === 2, `año vs agosto produce 2 huecos (got ${gaps.length})`);

assert(categoryFromAbsenceCode('V') === 'vac', 'V → vacaciones');
assert(categoryFromAbsenceCode('E') === 'enf', 'E → enfermedad');
assert(categoryFromAbsenceCode('A') === 'art', 'A → ART');
assert(categoryFromAbsenceCode('AA') === 'inj', 'AA → injustificada');
assert(categoryFromAbsenceCode('L') === 'otros', 'L → otros');
assert(resolveAbsenceCode({ type: 'VACATION' }) === 'V', 'legacy VACATION → V');
assert(resolveAbsenceCode({ type: 'SICK_LEAVE' }) === 'E', 'legacy SICK_LEAVE → E');
assert(resolveAbsenceCode({ absenceType: 'PG' }) === 'PG', 'absenceType PG');

const emp = [{ id: 'e1', name: 'Guardia Uno' }];
const stats = buildAusenciasStats({
  ausencias: [{
    id: 'a1',
    employeeId: 'e1',
    employeeName: 'Guardia Uno',
    type: 'Vacaciones',
    absenceType: 'V',
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    status: 'Autorizada',
    shiftId: 't1',
  }],
  turnos: [{
    id: 't1',
    employeeId: 'e1',
    startTime: { seconds: new Date(2026, 7, 10, 6, 0).getTime() / 1000 },
    endTime: { seconds: new Date(2026, 7, 10, 14, 0).getTime() / 1000 },
    hours: 8,
    code: 'M',
    objectiveId: 'obj1',
  }],
  employees: emp,
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  capHsPerGuardPeriod: 192,
});
assert(!!stats && stats.total === 1, '1 ausencia RRHH con shiftId');
assert(!!stats && stats.vacHs === 8, `hs por shiftId = 8 (got ${stats?.vacHs})`);
assert(!!stats && stats.detalle[0].source === 'rrhh', 'fuente rrhh');

const statsOp = buildAusenciasStats({
  ausencias: [],
  turnos: [{
    id: 't2',
    employeeId: 'e1',
    employeeName: 'Guardia Uno',
    isAbsent: true,
    startTime: { seconds: new Date(2026, 7, 12, 6, 0).getTime() / 1000 },
    endTime: { seconds: new Date(2026, 7, 12, 14, 0).getTime() / 1000 },
    hours: 8,
    code: 'M',
    objectiveId: 'obj1',
  }],
  employees: emp,
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  capHsPerGuardPeriod: 192,
});
assert(!!statsOp && statsOp.total === 1 && statsOp.injHs === 8, 'isAbsent operativo cuenta como AA 8h');

const plus = topNPlusResto(
  [{ name: 'A', v: 10 }, { name: 'B', v: 5 }, { name: 'C', v: 3 }],
  ['v'],
  2,
  'name',
);
assert(plus.length === 3 && plus[2].name === 'Resto' && plus[2].v === 3, 'top N + resto');

const inf = buildInformeAnalitico({
  plantel: 10,
  capHsPerGuardPeriod: 192,
  demandaTotals: {
    id: '_total', name: 'Total', client: '',
    slaHours: 1000, planHours: 920, extHours: 20, adelHours: 10, ftHours: 40, opsHours: 8,
    vacantHours: 30, absenceHours: 80, absenceCoveredHours: 40,
    resultante: 998, deltaSla: -2, deltaPlan: 78,
  },
  ausenciasStats: statsOp,
  turnos: [{
    id: 'w1', employeeId: 'e1', isPresent: true, hours: 8, code: 'M',
    startTime: { seconds: new Date(2026, 7, 5, 6).getTime() / 1000 },
    endTime: { seconds: new Date(2026, 7, 5, 14).getTime() / 1000 },
  }],
});
assert(inf.dotacionActiva === 10, 'informe dotación');
assert(inf.hsVendidas === 1000, 'informe vendidas');
assert(inf.hsRealizadas === 8, 'informe realizadas desde fichada');
assert(inf.bolsaInicial === 1920, 'informe bolsa 10×192');
assert(inf.conclusiones.length >= 1, 'informe genera conclusiones');
assert(estimarCostoInforme(inf, 0) === null, 'sin valor hora no estima $');
assert(!!estimarCostoInforme(inf, 5000), 'con valor hora estima $');

assert(chooseInformeSeriesBucket(1) === 'hour', '1 día → hora');
assert(chooseInformeSeriesBucket(31) === 'day', 'mes → día');
assert(chooseInformeSeriesBucket(200) === 'month', 'semestre/año → mes');
const days = iterateInformeBuckets(new Date(2026, 7, 1), new Date(2026, 7, 3, 23, 59, 59, 999), 'day');
assert(days.length === 3, `3 días de buckets (got ${days.length})`);
const serie = buildInformeSeries({
  turnos: [{
    id: 's1', employeeId: 'e1', isPresent: true, hours: 8, code: 'M',
    startTime: { seconds: new Date(2026, 7, 1, 6).getTime() / 1000 },
  }],
  buckets: days,
  bucket: 'day',
  slaByKey: { [days[0].key]: 12 },
});
assert(serie[0].Vendidas === 12 && serie[0].Plan === 8 && serie[0].Realizadas === 8, 'serie día 1 plan+real');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nanalisis queries: all ok');
