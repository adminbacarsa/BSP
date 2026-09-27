/**
 * EJECUTADO por franja con la forma real de ops_cov:
 *   sourceShiftId = turno DEL QUE CUBRE (su franco), absenceShiftId/coveredShiftId = ausente.
 *
 * Fixture real con nombres anonimizados (Guardia NN por legajo).
 *
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/eval-executed-franja-example.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executedBillableHoursByFranja, type FranjaShift } from '../apps/web2/src/lib/crm/executedBillableHoursByFranja.ts';

const realDay = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'edificio-nk-2026-09-25.json'), 'utf8'),
) as FranjaShift[];

const day = '2026-09-17';
const base = { objectiveId: 'obrador', objectiveName: 'Obrador', positionName: 'Puesto 1', startDate: day };

let failed = 0;
const check = (label: string, got: number, want: number) => {
  const ok = got === want;
  console.log(ok ? 'OK' : 'FALLA', `\t${label}\tesperado ${want}\tobtenido ${got}`);
  if (!ok) failed++;
};

function opsCov(absentShiftId: string, coverEmployeeId: string, extra: Partial<FranjaShift>): FranjaShift {
  return {
    ...base,
    id: `ops_cov_${absentShiftId}_${coverEmployeeId}`,
    employeeId: coverEmployeeId,
    origin: 'OPERATIONS_COVERAGE',
    absenceShiftId: absentShiftId,
    coveredShiftId: absentShiftId,
    ...extra,
  };
}

const present = (id: string, employeeId: string, code: string): FranjaShift => ({
  ...base, id, employeeId, code, isPresent: true, isCompleted: true,
});
const absent = (id: string, employeeId: string, code: string): FranjaShift => ({
  ...base, id, employeeId, code, isAbsent: true, status: 'ABSENT',
});

console.log('\n(a) Puesto qty 4 en M, uno ausente cubierto por FT vía ops_cov real');
{
  const turnos: FranjaShift[] = [
    present('m1', 'g1', 'M'),
    present('m2', 'g2', 'M'),
    present('m3', 'g3', 'M'),
    absent('9vWEy0Ux3hkEHwGR8lsa', 'g4', 'M'),
    // franco del que cubre (Guardia 07): NO factura al cliente
    { ...base, id: 'UvhO3franco', employeeId: 'g07', code: 'F' },
    opsCov('9vWEy0Ux3hkEHwGR8lsa', 'g07', {
      code: 'FT',
      type: 'FT',
      coverageType: 'FT',
      sourceShiftId: 'UvhO3franco',
      hours: 8,
      isPresent: true,
    }),
  ];
  const r = executedBillableHoursByFranja(turnos);
  const m = r.buckets.find((b) => b.code === 'M')!;
  console.log(`  M pedido ${m.requested} cubierto ${m.covered} descubierto ${m.uncovered} factura ${m.billable}`);
  check('(a) factura', r.totalBillable, 32);
  check('(a) buckets (F no crea franja)', r.buckets.length, 1);
}

console.log('\n(b) Puesto qty 4 en M, uno ausente sin cobertura');
{
  const turnos: FranjaShift[] = [
    present('m1', 'g1', 'M'),
    present('m2', 'g2', 'M'),
    present('m3', 'g3', 'M'),
    absent('m4', 'g4', 'M'),
  ];
  const r = executedBillableHoursByFranja(turnos);
  const m = r.buckets[0];
  console.log(`  M pedido ${m.requested} cubierto ${m.covered} descubierto ${m.uncovered} factura ${m.billable}`);
  check('(b) pedido', r.totalRequested, 32);
  check('(b) descubierto', r.totalUncovered, 8);
  check('(b) factura', r.totalBillable, 24);
}

console.log('\n(c) M/T/N, T ausente: extensión 4 h de M + cobertura 4 h de otro (ops_cov reales)');
{
  const turnos: FranjaShift[] = [
    { ...present('m1', 'gM', 'M'), hours: 12 },   // reloj 12 h por la extensión
    absent('t1', 'gT', 'T'),
    present('n1', 'gN', 'N'),
    opsCov('t1', 'gM', {
      code: 'T',
      coverageType: 'EXTEND',
      coverageHoursOnSource: true,
      sourceShiftId: 'm1',
      hours: 4,
      isPresent: true,
    }),
    opsCov('t1', 'gX', {
      code: 'T',
      coverageType: 'FT',
      sourceShiftId: 'UvhO3francoX',
      hours: 4,
      isPresent: true,
    }),
  ];
  const r = executedBillableHoursByFranja(turnos);
  for (const b of r.buckets) console.log(`  ${b.code} pedido ${b.requested} cubierto ${b.covered} factura ${b.billable}`);
  const t = r.buckets.find((b) => b.code === 'T')!;
  check('(c) franja T', t.billable, 8);
  check('(c) total (no 28)', r.totalBillable, 24);
}

console.log('\n(d) ops_cov presente, ingreso real, sin realEndTime → fin planificado');
{
  const win = { startTime: '2026-09-25T10:00:00.000Z', endTime: '2026-09-25T18:00:00.000Z' };
  const turnos: FranjaShift[] = [
    { ...absent('tit', 'g14', 'M'), ...win },
    opsCov('tit', 'g07', {
      ...win,
      code: 'FT',
      coverageType: 'FT',
      sourceShiftId: 'franco',
      isPresent: true,
      realStartTime: '2026-09-25T10:19:11.000Z',
    }),
  ];
  const r = executedBillableHoursByFranja(turnos);
  const m = r.buckets[0];
  console.log(`  M pedido ${m.requested} cubierto ${m.covered} factura ${m.billable}`);
  check('(d) factura la franja', r.totalBillable, 8);
}

console.log('\n(e) salida real anterior al fin planificado → recorte');
{
  const win = { startTime: '2026-09-25T10:00:00.000Z', endTime: '2026-09-25T18:00:00.000Z' };
  const turnos: FranjaShift[] = [
    { ...absent('tit', 'g14', 'M'), ...win },
    opsCov('tit', 'g07', {
      ...win,
      code: 'FT',
      coverageType: 'FT',
      isPresent: true,
      realStartTime: '2026-09-25T10:00:00.000Z',
      realEndTime: '2026-09-25T14:00:00.000Z',
    }),
  ];
  const r = executedBillableHoursByFranja(turnos);
  console.log(`  M cubierto ${r.buckets[0].covered} factura ${r.totalBillable}`);
  check('(e) recorte 4 h', r.totalBillable, 4);
}

console.log('\n(f) Nuevo Edificio Corporativo 2026-09-25 (docs reales)');
{
  const r = executedBillableHoursByFranja(realDay);
  const titulares = r.buckets.reduce((n, b) => n + b.titulares.length, 0);
  const de10 = r.buckets.filter((b) => b.requested === 10);
  for (const b of r.buckets) {
    console.log(`  ${b.positionName} ${b.code} pedido ${b.requested} cubierto ${b.covered} factura ${b.billable}`);
  }
  const titular14 = r.buckets.flatMap((b) => b.titulares).find((t) => t.shiftId === '9vWEy0Ux3hkEHwGR8lsa');
  console.log(`  Guardia 14 (ausente) cubierto ${titular14?.covered} por FT de Guardia 07`);
  console.log(`  franjas ${titulares} pedido ${r.totalRequested} factura ${r.totalBillable}`);
  check('(f) franjas', titulares, 12);
  check('(f) franjas de 10 h', de10.length, 2);
  check('(f) ausente cubierto por FT', titular14?.covered ?? 0, 8);
  check('(f) total del día', r.totalBillable, 100);
}

console.log('\n(g) tardanza del titular: vino tarde y la franja va completa');
{
  const turnos: FranjaShift[] = [
    {
      ...present('m1', 'g1', 'M'),
      startTime: '2026-09-25T10:00:00.000Z',
      endTime: '2026-09-25T18:00:00.000Z',
      realStartTime: '2026-09-25T10:47:00.000Z',
      realEndTime: '2026-09-25T18:02:00.000Z',
    },
  ];
  const r = executedBillableHoursByFranja(turnos);
  console.log(`  M pedido ${r.totalRequested} factura ${r.totalBillable}`);
  check('(g) no descuenta 47 min', r.totalBillable, 8);
}

console.log('\n(h) ESC y REF no facturan (ni franja ni adicional)');
{
  const win = { startTime: '2026-09-25T10:00:00.000Z', endTime: '2026-09-25T18:00:00.000Z' };
  const turnos: FranjaShift[] = [
    { ...present('esc1', 'e1', 'ESC'), ...win, positionName: 'Puesto 1' },
    { ...present('ref1', 'r1', 'REF'), ...win, positionName: 'Puesto 1' },
  ];
  const r = executedBillableHoursByFranja(turnos);
  console.log(`  buckets ${r.buckets.length} factura ${r.totalBillable}`);
  check('(h) buckets', r.buckets.length, 0);
  check('(h) factura', r.totalBillable, 0);
}

console.log('\n(i) ESC usado como cobertura ya es ops_cov: llena al ausente y el ESC fuente no suma');
{
  const win = { startTime: '2026-09-25T10:00:00.000Z', endTime: '2026-09-25T18:00:00.000Z' };
  const turnos: FranjaShift[] = [
    { ...absent('aus', 'titular', 'M'), ...win, positionName: 'Puesto 1' },
    { ...present('escFuente', 'escuela', 'ESC'), ...win, positionName: 'Puesto 1' },
    opsCov('aus', 'escuela', {
      ...win,
      code: 'M',
      coverageType: 'ESC',
      sourceShiftId: 'escFuente',
      isPresent: true,
      realStartTime: '2026-09-25T10:20:00.000Z',
    }),
  ];
  const r = executedBillableHoursByFranja(turnos);
  console.log(`  factura ${r.totalBillable} buckets ${r.buckets.map((b) => b.code).join(',')}`);
  check('(i) solo la franja del ausente', r.totalBillable, 8);
  check('(i) sin bucket ESC', r.buckets.filter((b) => b.code === 'ESC').length, 0);
}

const at = (hhmm: string, dayOffset = 0) => {
  const d = new Date(`2026-09-25T${hhmm}:00.000-03:00`);
  return new Date(d.getTime() + dayOffset * 24 * 3600000).toISOString();
};
const M = { startTime: at('06:00'), endTime: at('14:00') };
const T = { startTime: at('14:00'), endTime: at('22:00') };

console.log('\n(j) titular se va 1 h antes y nadie cubre → se recorta igual que la cobertura');
{
  const turnos: FranjaShift[] = [
    { ...present('m1', 'g1', 'M'), ...M, realStartTime: at('06:10'), realEndTime: at('13:00') },
  ];
  const r = executedBillableHoursByFranja(turnos);
  console.log(`  M pedido ${r.totalRequested} factura ${r.totalBillable} descubierto ${r.totalUncovered}`);
  check('(j) factura 7', r.totalBillable, 7);
  check('(j) descubierto 1', r.totalUncovered, 1);
}

console.log('\n(k) titular se va 1 h antes; el relevo T llegó 1 h antes → la franja M va completa');
{
  const turnos: FranjaShift[] = [
    { ...present('m1', 'g1', 'M'), ...M, realStartTime: at('06:00'), realEndTime: at('13:00') },
    { ...present('t1', 'g2', 'T'), ...T, realStartTime: at('13:00'), realEndTime: at('22:00') },
  ];
  const r = executedBillableHoursByFranja(turnos);
  const m = r.buckets.find((b) => b.code === 'M')!;
  const relevo = m.titulares[0].contributions.find((c) => c.kind === 'relevo');
  console.log(`  M factura ${m.billable} (relevo ${relevo?.employeeId} ${relevo?.hours} h) · total ${r.totalBillable}`);
  check('(k) franja M', m.billable, 8);
  check('(k) relevo atribuido a g2', relevo?.employeeId === 'g2' ? relevo.hours : 0, 1);
  check('(k) total M + T (la llegada temprana no suma a T)', r.totalBillable, 16);
}

console.log('\n(l) T ausente sin cobertura; el M retenido se queda hasta las 17:00 → cubre 3 h');
{
  const turnos: FranjaShift[] = [
    {
      ...present('m1', 'g1', 'M'), ...M, realStartTime: at('06:00'), realEndTime: at('17:00'),
      isRetention: false, retentionAbsenceShiftId: 't1', retentionReleasedAt: at('17:00'),
    },
    { ...absent('t1', 'g2', 'T'), ...T },
  ];
  const r = executedBillableHoursByFranja(turnos);
  const t = r.buckets.find((b) => b.code === 'T')!;
  console.log(`  M ${r.buckets.find((b) => b.code === 'M')!.billable} · T ${t.billable} descubierto ${t.uncovered}`);
  check('(l) franja T', t.billable, 3);
  check('(l) franja M sin inflar', r.buckets.find((b) => b.code === 'M')!.billable, 8);
}

console.log('\n(m) retenido que se queda hasta las 23:00 → tope 12:59 desde su ingreso (hasta 18:59)');
{
  const turnos: FranjaShift[] = [
    { ...present('m1', 'g1', 'M'), ...M, realStartTime: at('06:00'), realEndTime: at('23:00'), isRetention: true, retentionAbsenceShiftId: 't1' },
    { ...absent('t1', 'g2', 'T'), ...T },
  ];
  const r = executedBillableHoursByFranja(turnos);
  const t = r.buckets.find((b) => b.code === 'T')!;
  console.log(`  T factura ${t.billable.toFixed(2)} h`);
  check('(m) 4:59 h', Math.round(t.billable * 60), 4 * 60 + 59);
}

console.log('\n(n) sin marca de retención, quedarse de más no cubre la franja siguiente');
{
  const turnos: FranjaShift[] = [
    { ...present('m1', 'g1', 'M'), ...M, realStartTime: at('06:00'), realEndTime: at('17:00') },
    { ...absent('t1', 'g2', 'T'), ...T },
  ];
  const r = executedBillableHoursByFranja(turnos);
  check('(n) franja T', r.buckets.find((b) => b.code === 'T')!.billable, 0);
}

console.log('\n(o) qty 2 en M, los dos se van 1 h antes y un solo relevo llegó 1 h antes → no cubre dos franjas');
{
  const turnos: FranjaShift[] = [
    { ...present('m1', 'g1', 'M'), ...M, realStartTime: at('06:00'), realEndTime: at('13:00') },
    { ...present('m2', 'g2', 'M'), ...M, realStartTime: at('06:00'), realEndTime: at('13:00') },
    { ...present('t1', 'g3', 'T'), ...T, realStartTime: at('13:00'), realEndTime: at('22:00') },
  ];
  const r = executedBillableHoursByFranja(turnos);
  const m = r.buckets.find((b) => b.code === 'M')!;
  console.log(`  M pedido ${m.requested} factura ${m.billable} descubierto ${m.uncovered}`);
  check('(o) M factura 15 de 16', m.billable, 15);
}

console.log('\n(p) aportes por legajo suman lo cubierto (base de la grilla Ejecutado)');
{
  const r = executedBillableHoursByFranja(realDay);
  const diff = r.buckets.flatMap((b) => b.titulares)
    .reduce((a, t) => a + Math.abs(t.covered - t.contributions.reduce((s, c) => s + c.hours, 0)), 0);
  check('(p) diferencia total', Math.round(diff * 1000), 0);
}

console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
