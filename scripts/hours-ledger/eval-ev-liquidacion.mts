/**
 * EV liquida con la fichada, en el bucket Eventos, y no se suma dos veces con TURA.
 * Pantalla (useReportes), F0 y payrollApi (libro persona) dan el mismo total.
 *   npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-ev-liquidacion.mts
 */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'eval-hours-core';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'eval.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'eval-hours-core';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||= 'eval.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||= '0';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= '1:0:web:eval';

const { calculateLiquidationHoursStats: screenStats } = await import('../../apps/web2/src/hooks/useReportes.ts');
const {
  buildPersonaBook,
  calculateLiquidationHoursStats,
  calculateLiquidationHoursStatsF0,
  personaStatsToPayrollFigures,
  resolveShiftDurationHours,
} = await import('../../packages/hours-core/src/index.ts');

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function art(ymd: string, hhmm: string) {
  const d = new Date(`${ymd}T${hhmm}:00.000-03:00`);
  return { seconds: Math.floor(d.getTime() / 1000) };
}

const ev = {
  id: 'ev-noche',
  employeeId: 'E1',
  objectiveId: 'OBJ',
  code: 'EV',
  origin: 'EVENTO',
  status: 'completed',
  startTime: art('2026-09-10', '22:00'),
  endTime: art('2026-09-11', '06:00'),
  realStartTime: art('2026-09-10', '22:00'),
  realEndTime: art('2026-09-11', '06:00'),
};

const stats = calculateLiquidationHoursStats([ev], { '2026-09-10': true });
assert(Math.abs(stats.horasReales - 8) < 0.05, `pagadas ${stats.horasReales}`);
assert(Math.abs(stats.totalNocturnas - 8) < 0.05, `nocturnas ${stats.totalNocturnas}`);
assert(Math.abs(stats.plusFeriado - 8) < 0.05, `feriado ${stats.plusFeriado}`);
assert(stats.desglose.eventos === 8, `bucket ${stats.desglose.eventos}`);
assert(stats.desglose.plan === 0 && stats.desglose.tura === 0, 'no cae en plan ni TURA');
assert(resolveShiftDurationHours(ev, undefined, { forObjectiveBilling: true }) === 0, 'EV sigue fuera del SLA');

const screen = screenStats([ev], { '2026-09-10': true });
const f0 = calculateLiquidationHoursStatsF0([ev], { '2026-09-10': true });
assert(Math.abs(screen.horasReales - 8) < 0.05 && Math.abs(f0.horasReales - 8) < 0.05, 'pantalla y F0');
assert(screen.desglose.eventos === 8, `pantalla bucket ${screen.desglose.eventos}`);

const book = buildPersonaBook({
  turnos: [ev],
  ausencias: [],
  publishStatusMap: { OBJ_2026_9: true },
  rangeStartYmd: '2026-09-01',
  rangeEndYmd: '2026-09-30',
  empNameById: { E1: 'Guardia' },
  holidays: { '2026-09-10': true },
  usePlannedHours: false,
  publishFilter: 'published',
});
const entry = book.byEmployee.get('E1');
assert(!!entry, 'libro persona');
const figures = personaStatsToPayrollFigures(entry!, 0);
assert(Math.abs(figures.acumulado.hsReales - stats.horasReales) < 0.05, 'payrollApi = reportes');
assert(figures.desglose.eventos === 8 && Math.abs(figures.acumulado.nocturnas - 8) < 0.05, 'payrollApi eventos y nocturnas');

const tura = {
  ...ev,
  id: 'tura-dia',
  code: 'TURA',
  origin: '',
  startTime: art('2026-09-10', '10:00'),
  endTime: art('2026-09-10', '14:00'),
  realStartTime: art('2026-09-10', '10:00'),
  realEndTime: art('2026-09-10', '14:00'),
};
const both = calculateLiquidationHoursStats([ev, tura], {});
assert(Math.abs(both.horasReales - 12) < 0.05, `EV+TURA distintos ${both.horasReales}`);
assert(both.desglose.eventos === 8 && both.desglose.tura === 4, 'buckets separados');

const overlap = calculateLiquidationHoursStats([ev, { ...ev, id: 'tura-solape', code: 'TURA', origin: '' }], {});
assert(Math.abs(overlap.horasReales - 8) < 0.05, `solape no duplica ${overlap.horasReales}`);
assert(Math.abs(overlap.desglose.eventos + overlap.desglose.tura - 8) < 0.05, 'un solo bucket del solape');

const many = Array.from({ length: 26 }, (_, i) => {
  const day = String(i + 1).padStart(2, '0');
  const start = art(`2026-01-${day}`, '08:00');
  const end = art(`2026-01-${day}`, '16:00');
  return { ...ev, id: `ev-${i}`, startTime: start, endTime: end, realStartTime: start, realEndTime: end };
});
const cap = calculateLiquidationHoursStats(many, {});
assert(Math.abs(cap.horasReales - 208) < 0.05, `208 ${cap.horasReales}`);
assert(Math.abs(cap.horasSimples - 200) < 0.05 && Math.abs(cap.extra50 - 8) < 0.05, `50% ${cap.extra50}`);
assert(cap.desglose.eventos === 208, `eventos ${cap.desglose.eventos}`);

console.log('EV_LIQUIDACION_OK');
