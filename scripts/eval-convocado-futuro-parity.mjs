/**
 * Paridad portal-core / functions del plan de llegada del convocado futuro.
 *   node --experimental-strip-types scripts/eval-convocado-futuro-parity.mjs
 */
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const srv = await load('apps/functions/src/common/convocadoEta.ts');
const portal = await load('packages/portal-core/src/checkIn/convocadoArrival.ts');
const cc = await load('apps/web2/src/lib/operaciones/convocadoVentana.ts');

let failed = 0;
function check(label, ok) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK' : 'FALLA'}\t${label}`);
}

const accepted = new Date('2026-10-05T13:56:00-03:00').getTime();
const gap = new Date('2026-10-05T16:00:00-03:00').getTime();
const cases = [
  { acceptedAtMs: accepted, gapStartMs: gap, etaMinutes: 10 },
  { acceptedAtMs: new Date('2026-10-05T16:10:00-03:00').getTime(), gapStartMs: gap, etaMinutes: 10 },
  { acceptedAtMs: accepted, gapStartMs: gap, etaMinutes: 70 },
  { acceptedAtMs: accepted, gapStartMs: 0, etaMinutes: 12 },
];
for (const c of cases) {
  const a = srv.planConvocadoArrival(c);
  const b = portal.planConvocadoArrival(c);
  check(`plan eta=${c.etaMinutes} gap=${c.gapStartMs === gap ? '16:00' : '0'}`, JSON.stringify(a) === JSON.stringify(b));
}

const future = srv.planConvocadoArrival(cases[0]);
check('futuro llega a las 16:00', future.future === true && future.expectedArrivalMs === gap);
check('recordatorio 15:40', future.reminderAtMs === new Date('2026-10-05T15:40:00-03:00').getTime());

const label = cc.convocadoEnCaminoLabel({
  startTime: new Date(gap),
  acceptedAt: new Date(accepted),
  etaMinutes: 10,
  expectedArrivalAt: new Date(gap),
  origin: 'OPERATIONS_COVERAGE',
}, new Date('2026-10-05T13:56:00-03:00'));
check('CC antes de salir', label === 'Cubre 16:00 (aceptó 13:56)', );
const camino = cc.convocadoEnCaminoLabel({
  startTime: new Date(gap),
  acceptedAt: new Date(accepted),
  etaMinutes: 10,
  expectedArrivalAt: new Date(gap),
}, new Date('2026-10-05T15:51:00-03:00'));
check('CC en camino a las 16:00', String(camino).startsWith('EN CAMINO') && String(camino).includes('16:00'));

if (failed) {
  console.error(`\n${failed} falla(s)`);
  process.exit(1);
}
console.log('\nparidad convocado futuro ok');
