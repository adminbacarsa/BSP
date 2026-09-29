/**
 * Paridad ETA convocado: ops-core y functions/src son el mismo archivo.
 *   node --experimental-strip-types scripts/eval-convocado-eta-parity.mjs
 */
import fs from 'fs';
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const aPath = path.join(root, 'packages/ops-core/src/convocadoEta.ts');
const bPath = path.join(root, 'apps/functions/src/common/convocadoEta.ts');
const a = fs.readFileSync(aPath, 'utf8');
const b = fs.readFileSync(bPath, 'utf8');
const core = await import(pathToFileURL(aPath).href);
const fn = await import(pathToFileURL(bPath).href);

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

report('archivo', a === b, a === b ? 'mismo archivo' : 'copias distintas');

const km = core.haversineKm(-34.6037, -58.3816, -34.4237, -58.3816);
const eta = core.busEtaMinutes(20);
const etaFn = fn.busEtaMinutes(20);
report('20km', eta === 70 && etaFn === 70 && km > 19 && km < 21, `km=${km?.toFixed(2)} eta=${eta}/${etaFn}`);

const same = core.convocadoTravelEta({ coverageType: 'ESC', sameObjective: true, distanceKm: 20 });
const sameFn = fn.convocadoTravelEta({ coverageType: 'REF', sameObjective: true, distanceKm: 20 });
report('mismo objetivo', same.etaMinutes === 5 && same.traveled === false && sameFn.etaMinutes === 5, JSON.stringify(same));

const trip = core.convocadoTravelEta({ coverageType: 'RET', sameObjective: false, distanceKm: 20 });
const tripFn = fn.convocadoTravelEta({ coverageType: 'FT', sameObjective: true, distanceKm: 20 });
report('viaje', trip.etaMinutes === 70 && trip.traveled === true && tripFn.etaMinutes === 70 && tripFn.traveled === true, `${trip.etaMinutes}/${tripFn.etaMinutes}`);

const acc = Date.parse('2026-09-29T12:00:00-03:00');
const rem = core.convocadoReminderAtMs(acc, 70);
const remFn = fn.convocadoReminderAtMs(acc, 70);
report('2/3', rem === remFn && rem === acc + 47 * 60 * 1000, `deltaMin=${(rem - acc) / 60000}`);

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
