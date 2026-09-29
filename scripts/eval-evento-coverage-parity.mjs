/**
 * Paridad del hueco de evento: ops-core y functions son el mismo archivo.
 *   node --experimental-strip-types scripts/eval-evento-coverage-parity.mjs
 */
import fs from 'fs';
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const aPath = path.join(root, 'packages/ops-core/src/eventoCoverage.ts');
const bPath = path.join(root, 'apps/functions/src/eventos/eventoCoverage.ts');
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
report('es evento', core.isEventoShift({ code: 'EV' }) && fn.isEventoShift({ origin: 'EVENTO' }) && !core.isEventoShift({ code: 'M', eventoId: 'x' }), '');
report('sin continuidad', core.eventoTieneFranjasEncadenadas({}) === false && fn.eventoTieneFranjasEncadenadas({ eventoFranjasEncadenadas: true }) === true, '');
report('bolsa vacia', core.eventualesParaHueco().length === 0 && fn.eventualesParaHueco().length === 0, '');
report('orden', core.EVENT_COVERAGE_CASCADE_ORDER.join(',') === 'REF,ESC,EXTEND,ADVANCE,FT' && !core.EVENT_COVERAGE_CASCADE_ORDER.includes('RET'), core.EVENT_COVERAGE_CASCADE_ORDER.join(','));
const plan = core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', eventoId: 'ev', shiftId: 's', isEventual: true, punched: false });
report('eventual sin fichar', plan?.arcaBajaPendiente === true && plan.descuentaLiquidacion === true && plan.confiabilidadDelta === -1, JSON.stringify(plan));
report('no eventual', core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', isEventual: false }) === null, '');

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
