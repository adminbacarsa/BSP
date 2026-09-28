/**
 * C1 — prefactura Ejecutado termina con un número real (fixture anonimizado
 * Banco de Córdoba, septiembre 2026) y la fecha de franja respeta el cronograma.
 *
 *   $env:NEXT_PUBLIC_FIREBASE_API_KEY='AIzaEvalDummy'; $env:NEXT_PUBLIC_USE_EMULATOR='true'; $env:NEXT_PUBLIC_FIREBASE_PROJECT_ID='comtroldata'
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/eval-crm-c1-carga.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executedBillableHoursByFranja } from '../apps/web2/src/lib/crm/executedBillableHoursByFranja.ts';
import { objectiveIdsForTurnoQuery } from '../apps/web2/src/lib/crm/clientDataMatch.ts';

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'OK' : 'FALLA', `\t${label}\tesperado ${JSON.stringify(want)}\tobtenido ${JSON.stringify(got)}`);
  if (!ok) failed++;
};

console.log('\nobjectiveId in no usa el nombre');
const ids = objectiveIdsForTurnoQuery([
  { id: 'c1', objetivos: [{ id: 'OBJ1', name: 'Sucursal Centro' }, { id: '', name: 'Sin id' }] },
]);
check('solo el id real', ids, ['OBJ1']);

console.log('\nymdOf: scheduleDate / planningDate / fecha antes que startTime');
const present = {
  code: 'M',
  employeeId: 'E1',
  objectiveId: 'O1',
  positionName: 'Puesto',
  isPresent: true,
  startTime: '2026-08-20T12:00:00.000Z',
  endTime: '2026-08-20T20:00:00.000Z',
  realStartTime: '2026-08-20T12:00:00.000Z',
  realEndTime: '2026-08-20T20:00:00.000Z',
};
const sept = { startYmd: '2026-09-01', endYmd: '2026-09-30' };
check(
  'scheduleDate dentro del mes cuenta aunque startTime sea de agosto',
  executedBillableHoursByFranja([{ ...present, scheduleDate: '2026-09-15' }], sept).totalBillable > 0,
  true,
);
check(
  'planningDate dentro del mes cuenta',
  executedBillableHoursByFranja([{ ...present, planningDate: '2026-09-02' }], sept).totalBillable > 0,
  true,
);
check(
  'fecha dentro del mes cuenta',
  executedBillableHoursByFranja([{ ...present, fecha: '2026-09-30' }], sept).totalBillable > 0,
  true,
);
check(
  'sin dia de cronograma, startTime de agosto queda afuera',
  executedBillableHoursByFranja([present], sept).totalBillable,
  0,
);

console.log('\nPrefactura Ejecutado Banco de Córdoba sept 2026 (fixture anonimizado)');
const started = Date.now();
const turnos = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'banco-cordoba-2026-09.anon.json'), 'utf8'),
) as any[];
const franja = executedBillableHoursByFranja(turnos, sept);
const elapsed = Date.now() - started;
console.log(`  turnos ${turnos.length} · ejecutado ${franja.totalBillable} hs · ${elapsed} ms`);
check('el calculo termina', elapsed < 15000, true);
check('hay turnos', turnos.length > 0, true);
check('horas ejecutadas del fixture', franja.totalBillable, 2365.3);

console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
