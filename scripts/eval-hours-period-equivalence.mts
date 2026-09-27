/**
 * Equivalencia de períodos: el mismo detalle por día no da el mismo total
 * en mes calendario (prefactura) y en ciclo CCT 26→25 (liquidación).
 *
 * calculateLiquidationHoursStats no recibe el ciclo: hay que filtrar los
 * turnos al rango antes de llamarla (Reportes arma dateRange 26→25).
 *
 *   npx tsx scripts/eval-hours-period-equivalence.mts
 * (desde la raíz del worktree, con tsx de apps/web2)
 */
import { calendarMonthRange, freezesBlockEachOther, liquidationCalendarDocSlices, sumDayHoursForLiquidation, sumDayHoursInRange } from '../apps/web2/src/lib/hoursPeriod.ts';
import { cctPayrollPeriodForClosingMonth } from '../apps/web2/src/lib/cctPayrollPeriod.ts';

const days = [
  { ymd: '2026-09-25', hours: 8 },
  { ymd: '2026-09-26', hours: 8 },
  { ymd: '2026-09-30', hours: 8 },
  { ymd: '2026-10-01', hours: 8 },
  { ymd: '2026-10-25', hours: 8 },
  { ymd: '2026-10-26', hours: 8 },
];

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(ok ? 'OK' : 'FALLA', `\t${label}\t${detail}`);
  if (!ok) failed++;
};

const calSep = calendarMonthRange(2026, 9);
const calOct = calendarMonthRange(2026, 10);
const cctOct = cctPayrollPeriodForClosingMonth(2026, 10);
const slices = liquidationCalendarDocSlices(2026, 10);

const sepCal = sumDayHoursInRange(days, calSep);
const octCal = sumDayHoursInRange(days, calOct);
const liqOct = sumDayHoursForLiquidation(days, 2026, 10);

check('calendario sep = 25+26+30 (24 h)', sepCal === 24, String(sepCal));
check('calendario oct = 01+25+26 (24 h)', octCal === 24, String(octCal));
check('CCT cierre oct = 26/09..25/10 (32 h)', liqOct === 32, String(liqOct));
check('26/09 está en prefactura sep y en liquidación oct', sepCal !== liqOct, `sep ${sepCal} vs cct ${liqOct}`);
check('rango CCT', cctOct.start === '2026-09-26' && cctOct.end === '2026-10-25', `${cctOct.start}..${cctOct.end}`);
check(
  'liquidación lee dos docs',
  slices.length === 2 && slices[0].docId === '2026-09' && slices[0].fromDay === 26 && slices[1].docId === '2026-10' && slices[1].toDay === 25,
  slices.map((s) => `${s.docId} ${s.fromDay}-${s.toDay}`).join(' + '),
);
check(
  'congelar liquidación oct no congela prefactura sep',
  freezesBlockEachOther(
    { kind: 'LIQUIDACION_CCT', cycleId: '2026-10' },
    { kind: 'CALENDARIO', monthId: '2026-09' },
  ) === false,
  'scopes distintos',
);
check(
  'el mismo cierre sí se bloquea a sí mismo',
  freezesBlockEachOther(
    { kind: 'LIQUIDACION_CCT', cycleId: '2026-10' },
    { kind: 'LIQUIDACION_CCT', cycleId: '2026-10' },
  ) === true,
  'mismo scope',
);

console.log('\ncalculateLiquidationHoursStats: no tiene parámetro de ciclo.');
console.log('Recibe turnos ya recortados al dateRange (Reportes: 26→25). Prefactura recorta 1→fin.');
console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
