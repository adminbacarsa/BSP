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
  shiftStartMs,
  filterTurnosInRange,
  splitRangeByDays,
} from '../src/lib/analisis/analisisQueries';
import {
  buildInformeAnalitico,
  buildInformeSeries,
  chooseInformeSeriesBucket,
  estimarCostoInforme,
  iterateInformeBuckets,
} from '../src/lib/analisis/analisisInforme';
import {
  CCT_HS_MENSUAL,
  buildAnalisisUniverso,
  cctBolsaHsPerGuard,
} from '../src/lib/analisis/analisisUniverso';
import {
  CCT_HS_TECHO_MENSUAL,
  buildBolsaRealista,
  cctTechoHsPerGuard,
  threeMonthLookback,
} from '../src/lib/analisis/analisisBolsa';

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

const julChunks = splitRangeByDays(
  { startMs: new Date(2026, 6, 1).getTime(), endMs: new Date(2026, 6, 31, 23, 59, 59, 999).getTime() },
  7,
);
assert(julChunks.length === 5, `julio en ventanas de 7 días = 5 (got ${julChunks.length})`);
assert(julChunks[0].startMs === new Date(2026, 6, 1).getTime(), 'primer chunk = 1 jul');
assert(julChunks[julChunks.length - 1].endMs === new Date(2026, 6, 31, 23, 59, 59, 999).getTime(), 'último chunk cierra el 31');

const julClock = shiftStartMs({ date: '2026-07-15', startTime: '07:00' });
assert(!!julClock && new Date(julClock).getDate() === 15 && new Date(julClock).getMonth() === 6, 'shiftStartMs date+HH:mm');
assert(shiftStartMs({ startTime: { _seconds: 1784160000 } }) === 1784160000 * 1000, 'shiftStartMs _seconds');
const sliced = filterTurnosInRange(
  [{ id: 'a', date: '2026-07-10', startTime: '23:00' }, { id: 'b', date: '2026-08-01', startTime: '07:00' }],
  new Date(2026, 6, 1),
  new Date(2026, 6, 31, 23, 59, 59, 999),
);
assert(sliced.length === 1 && sliced[0].id === 'a', 'filterTurnosInRange usa date si startTime es hora');

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
assert(inf.bolsaInicial === 2000, 'informe sin bolsa = techo 10×200 (no 192)');
assert(inf.bolsaModo === 'sin_indice', 'sin objeto bolsa → sin índice');
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

assert(CCT_HS_MENSUAL === 192, 'jornada mensual = 192');
assert(cctBolsaHsPerGuard('month', 31) === 192, 'jornada mes = 192 (alias histórico, no es techo 200)');
assert(cctBolsaHsPerGuard('quarter', 90) === 576, 'bolsa trimestre = 576');
assert(cctBolsaHsPerGuard('year', 365) === 2304, 'bolsa año = 2304');
assert(cctBolsaHsPerGuard('day', 1) === Math.round(192 / 30), 'bolsa día = prorrateo 192/30');

assert(CCT_HS_TECHO_MENSUAL === 200, 'techo vigilador = 200 (no el promedio)');
assert(cctTechoHsPerGuard('month', 31) === 200, 'techo mes = 200');
const lb = threeMonthLookback(new Date(2026, 7, 1));
assert(lb.start.getMonth() === 4 && lb.end.getMonth() === 6, 'lookback de ago = may–jul');
assert(lb.label.includes('May') && lb.label.includes('Jul'), `label lookback ${lb.label}`);
const plantel10 = Array.from({ length: 10 }, (_, i) => ({ id: `be${i + 1}`, name: `G${i + 1}` }));
const bolsaIdx = buildBolsaRealista({
  employees: plantel10,
  ausencias: [{
    id: 'bolsa-vac',
    employeeId: 'be1',
    employeeName: 'G1',
    type: 'Vacaciones',
    absenceType: 'V',
    startDate: '2026-05-01',
    endDate: '2026-07-14',
    status: 'Autorizada',
  }],
  turnosLookback: [],
  periodMode: 'month',
  periodDays: 31,
  periodStart: new Date(2026, 7, 1),
});
assert(bolsaIdx.techoBruto === 2000, `techo 10×200 = 2000 (got ${bolsaIdx.techoBruto})`);
assert(bolsaIdx.hsAusenciaLookback === 600, `75 días × 8h = 600 (got ${bolsaIdx.hsAusenciaLookback})`);
assert(bolsaIdx.indicePct === 10, `índice 600/6000 = 10% (got ${bolsaIdx.indicePct})`);
assert(bolsaIdx.hsEfectivasGuardia === 180, `200 × 0.9 = 180 (got ${bolsaIdx.hsEfectivasGuardia})`);
assert(bolsaIdx.bolsaInicial === 1800, `10 × 180 = 1800, no 2000 (got ${bolsaIdx.bolsaInicial})`);
assert(bolsaIdx.modo === 'con_indice', 'con historial 3m el modo es con_indice');

const bolsaSin = buildBolsaRealista({
  employees: plantel10,
  ausencias: [],
  turnosLookback: [],
  periodMode: 'month',
  periodDays: 31,
  periodStart: new Date(2026, 7, 1),
});
assert(bolsaSin.tieneHistorial === false && bolsaSin.modo === 'sin_indice', 'sin ausencias 3m → sin índice');
assert(bolsaSin.bolsaInicial === 2000 && bolsaSin.indicePct === 0, `sin índice se muestra el techo 2000, no un promedio (got ${bolsaSin.bolsaInicial})`);

const uni = buildAnalisisUniverso({
  vigenteServices: [{
    clientId: 'c1',
    clientName: 'Cliente Uno',
    objectiveId: 'o1',
    objectiveName: 'Objetivo Uno',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    positions: [{
      id: 'p1',
      name: 'Acceso',
      coverageType: '24hs',
      quantity: 2,
      activeDays: ['D', 'L', 'M', 'X', 'J', 'V', 'S'],
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
        { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8 },
      ],
    }],
  }],
  employees: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 1, 23, 59, 59, 999),
});
assert(uni.clientes === 1, 'universo 1 cliente');
assert(uni.objetivos === 1, 'universo 1 objetivo');
assert(uni.puestos === 2, `universo 2 pax (got ${uni.puestos})`);
assert(uni.slotsPeriodo === 6, `universo 3 bandas × 2 pax = 6 slots (got ${uni.slotsPeriodo})`);
assert(uni.picoSimultaneo === 2, `pico 2 en simultáneo M/T/N no se solapan (got ${uni.picoSimultaneo})`);
assert(uni.hsVendidas === 48, `universo 6×8 = 48 hs (got ${uni.hsVendidas})`);
assert(uni.plantel === 3, 'universo plantel 3');
assert(uni.slotsByBand.M === 2 && uni.slotsByBand.N === 2, 'universo slots por banda');

const uni12 = buildAnalisisUniverso({
  vigenteServices: [{
    clientId: 'c2',
    objectiveId: 'o2',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    positions: [{
      id: 'p2',
      name: 'Noche',
      coverageType: '12hs_nocturno',
      quantity: 1,
      activeDays: ['L', 'M', 'X', 'J', 'V'],
      allowedShiftTypes: [],
    }],
  }],
  employees: [{ id: 'e1' }],
  periodStart: new Date(2026, 7, 3), // lunes
  periodEnd: new Date(2026, 7, 3, 23, 59, 59, 999),
});
assert(uni12.slotsPeriodo === 1 && uni12.hsVendidas === 12, `N12 lunes = 1 slot 12 hs (slots=${uni12.slotsPeriodo} hs=${uni12.hsVendidas})`);

void (async () => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'AIzaSyEvalOnlyNotARealKey00000000000';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'demo';
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'demo.firebaseapp.com';
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= '1:1:web:1';
  const { buildAnalisisFinanciera, finConsumoHours, rollAnalisisFinanciera, resolveLeaveObjective, homeObjectiveByEmployee } = await import('../src/lib/analisis/analisisFinanciera');
const finSrv = {
  clientId: 'cli-a',
  clientName: 'Cliente A',
  objectiveId: 'obj-a',
  objectiveName: 'Objetivo A',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  positions: [{
    id: 'p-a',
    name: 'Acceso',
    coverageType: 'custom',
    quantity: 1,
    activeDays: ['L'],
    allowedShiftTypes: [{ code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 }],
  }],
};
const finTurnos = [
  {
    id: 'ft-plan',
    employeeId: 'g1',
    employeeName: 'Guardia Uno',
    clientId: 'cli-a',
    clientName: 'Cliente A',
    objectiveId: 'obj-a',
    objectiveName: 'Objetivo A',
    code: 'M',
    hours: 8,
    isPresent: true,
    startTime: { seconds: new Date(2026, 7, 3, 7, 0).getTime() / 1000 },
    endTime: { seconds: new Date(2026, 7, 3, 15, 0).getTime() / 1000 },
  },
  {
    id: 'ft-franco',
    employeeId: 'g2',
    employeeName: 'Guardia Dos',
    clientId: 'cli-a',
    clientName: 'Cliente A',
    objectiveId: 'obj-a',
    objectiveName: 'Objetivo A',
    code: 'FT',
    isFrancoTrabajado: true,
    hours: 8,
    startTime: { seconds: new Date(2026, 7, 3, 15, 0).getTime() / 1000 },
    endTime: { seconds: new Date(2026, 7, 3, 23, 0).getTime() / 1000 },
  },
];
const finAus = buildAusenciasStats({
  ausencias: [{
    id: 'fin-vac',
    employeeId: 'g1',
    employeeName: 'Guardia Uno',
    type: 'Vacaciones',
    absenceType: 'V',
    startDate: '2026-08-03',
    endDate: '2026-08-03',
    status: 'Autorizada',
    objectiveId: 'obj-a',
  }],
  turnos: finTurnos,
  employees: [{ id: 'g1' }, { id: 'g2' }],
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  capHsPerGuardPeriod: 192,
});
const finBases = buildAnalisisFinanciera({
  turnos: finTurnos,
  ausenciasStats: finAus,
  vigenteServices: [finSrv],
  periodStart: new Date(2026, 7, 3),
  periodEnd: new Date(2026, 7, 3, 23, 59, 59, 999),
  objectiveAliases: { 'obj-a': { canonicalId: 'obj-a', name: 'Objetivo A', clientId: 'cli-a' } },
  slaExclusionCtx: null,
});
assert(finBases.length === 1, `financiera 1 objetivo (got ${finBases.length})`);
assert(finBases[0].hsPlan === 8, `financiera plan 8 (got ${finBases[0].hsPlan})`);
assert(finBases[0].hsReal === 8, `financiera real 8 (got ${finBases[0].hsReal})`);
assert(finBases[0].hsFt === 8, `financiera FT 8 (got ${finBases[0].hsFt})`);
assert(finBases[0].novedades.vac === 8, `financiera vac 8 (got ${finBases[0].novedades.vac})`);
assert(finConsumoHours(finBases[0], 'planned') === 24, `consumo plan = 8+8FT+8V (got ${finConsumoHours(finBases[0], 'planned')})`);
assert(finConsumoHours(finBases[0], 'real') === 24, `consumo real = 8+8FT+8V (got ${finConsumoHours(finBases[0], 'real')})`);
const finRoll = rollAnalisisFinanciera(finBases, 'planned');
assert(finRoll.clientes === 1 && finRoll.objetivos === 1, 'financiera rollup 1 cliente');
assert(finRoll.hsConsumo === 24, `empresa consumo 24 (got ${finRoll.hsConsumo})`);
assert(finRoll.guardias === 2, `2 guardias tocaron el objetivo (got ${finRoll.guardias})`);
assert(finRoll.hsConsumoPorGuardia === 12, `12 hs/guardia (got ${finRoll.hsConsumoPorGuardia})`);
assert(
  finRoll.clients[0].rows[0].hsSlaPorGuardia === Math.round((finRoll.clients[0].rows[0].slaHours / 2) * 10) / 10,
  `SLA/guardia = sla/2 (got ${finRoll.clients[0].rows[0].hsSlaPorGuardia} sla=${finRoll.clients[0].rows[0].slaHours})`,
);

const homeMap = homeObjectiveByEmployee(finTurnos, { 'obj-a': { canonicalId: 'obj-a', name: 'Objetivo A', clientId: 'cli-a' } });
assert(homeMap.get('g1') === 'obj-a', 'home de g1 = obj-a');
const vacSinOid = buildAusenciasStats({
  ausencias: [{
    id: 'vac-home',
    employeeId: 'g1',
    employeeName: 'Guardia Uno',
    type: 'Vacaciones',
    absenceType: 'V',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
    status: 'Autorizada',
  }],
  turnos: finTurnos,
  employees: [{ id: 'g1' }, { id: 'g2' }],
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  capHsPerGuardPeriod: 192,
});
const finHome = buildAnalisisFinanciera({
  turnos: finTurnos,
  ausenciasStats: vacSinOid,
  vigenteServices: [finSrv],
  periodStart: new Date(2026, 7, 3),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  objectiveAliases: { 'obj-a': { canonicalId: 'obj-a', name: 'Objetivo A', clientId: 'cli-a' } },
  slaExclusionCtx: null,
});
assert((finHome.find((r) => r.id === 'obj-a')?.novedades.vac || 0) >= 8, 'vacaciones sin oid van al home de malla');

const vacHuerfana = buildAusenciasStats({
  ausencias: [{
    id: 'vac-none',
    employeeId: 'g9',
    employeeName: 'Sin Malla',
    type: 'Vacaciones',
    absenceType: 'V',
    startDate: '2026-08-20',
    endDate: '2026-08-20',
    status: 'Autorizada',
  }],
  turnos: [],
  employees: [{ id: 'g9' }],
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  capHsPerGuardPeriod: 192,
});
const resolvedNone = resolveLeaveObjective(
  vacHuerfana!.detalle[0],
  new Map(),
  new Map(),
  [],
  [],
  {},
);
assert(resolvedNone.source === 'sin_objetivo' && resolvedNone.oid === 'SIN_OBJETIVO', 'sin malla no se inventa puesto');
const finHuerfana = buildAnalisisFinanciera({
  turnos: [],
  ausenciasStats: vacHuerfana,
  vigenteServices: [finSrv],
  periodStart: new Date(2026, 7, 3),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  objectiveAliases: { 'obj-a': { canonicalId: 'obj-a', name: 'Objetivo A', clientId: 'cli-a' } },
  slaExclusionCtx: null,
});
const rowHuerfana = finHuerfana.find((r) => r.id === 'SIN_OBJETIVO');
assert(!!rowHuerfana && rowHuerfana.novedades.vac === 8, 'hs de licencia huérfana no se tiran: van a SIN_OBJETIVO');

const histTurnos = [{
  id: 'hist-jul',
  employeeId: 'g3',
  employeeName: 'Guardia Tres',
  objectiveId: 'obj-b',
  code: 'M',
  hours: 8,
  startTime: { seconds: new Date(2026, 6, 10, 7, 0).getTime() / 1000 },
  endTime: { seconds: new Date(2026, 6, 10, 15, 0).getTime() / 1000 },
}];
const vacHist = buildAusenciasStats({
  ausencias: [{
    id: 'vac-hist',
    employeeId: 'g3',
    employeeName: 'Guardia Tres',
    type: 'Vacaciones',
    absenceType: 'V',
    startDate: '2026-08-01',
    endDate: '2026-08-01',
    status: 'Autorizada',
  }],
  turnos: [],
  employees: [{ id: 'g3' }],
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  capHsPerGuardPeriod: 192,
});
const finHist = buildAnalisisFinanciera({
  turnos: [],
  ausenciasStats: vacHist,
  vigenteServices: [{
    ...finSrv,
    objectiveId: 'obj-b',
    objectiveName: 'Objetivo B',
    clientId: 'cli-b',
    clientName: 'Cliente B',
  }],
  periodStart: new Date(2026, 7, 1),
  periodEnd: new Date(2026, 7, 31, 23, 59, 59, 999),
  objectiveAliases: { 'obj-b': { canonicalId: 'obj-b', name: 'Objetivo B', clientId: 'cli-b' } },
  slaExclusionCtx: null,
  turnosHistorial: histTurnos,
});
assert((finHist.find((r) => r.id === 'obj-b')?.novedades.vac || 0) === 8, 'vacaciones sin oid usan último puesto del historial 3m');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nanalisis queries: all ok');
})();
