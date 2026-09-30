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
report('orden evento', core.EVENT_COVERAGE_CASCADE_ORDER.join(',') === 'EVENTUAL,REF,ESC,EXTEND,ADVANCE,FT', core.EVENT_COVERAGE_CASCADE_ORDER.join(','));
report('orden objetivo', core.OBJECTIVE_COVERAGE_WITH_EVENTUAL.join(',') === 'RET,REF,ESC,EXTEND,ADVANCE,EVENTUAL,FT', core.OBJECTIVE_COVERAGE_WITH_EVENTUAL.join(','));
const hueco = { empresaId: 'e1', startMs: Date.parse('2026-10-02T10:00:00-03:00'), endMs: Date.parse('2026-10-02T18:00:00-03:00'), lat: -31.4, lng: -64.2, hoyYmd: '2026-10-02' };
const base = { disponibilidad: 'DISPONIBLE', empresasHabilitadas: ['e1'], credencialVencimiento: '2027-01-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-01-01' }, uid: 'u' };
const cerca = { ...base, cuil: '20111111111', nombre: 'Cerca', confiabilidad: 1, domicilioGeo: { lat: -31.41, lng: -64.21 } };
const lejos = { ...base, cuil: '20222222222', nombre: 'Lejos', confiabilidad: 9, domicilioGeo: { lat: -32.9, lng: -68.8 } };
const cruce = { ...base, cuil: '20333333333', nombre: 'Cruce', confiabilidad: 5, domicilioGeo: { lat: -31.4, lng: -64.2 } };
const lista = core.eventualesParaHueco({
  bolsa: [lejos, cruce, cerca],
  hueco,
  otrasJornadas: [{ cuil: '20333333333', empresaId: 'e2', startMs: hueco.startMs - 8 * 3600000, endMs: hueco.startMs - 6 * 3600000 }],
});
report('orden distancia', lista.map((r) => r.cuil).join(',') === '20111111111,20222222222' && !lista.some((r) => r.cuil === '20333333333'), lista.map((r) => r.nombre).join(','));
report('cruce espejo', fn.eventualesParaHueco({ bolsa: [cruce], hueco, otrasJornadas: [{ cuil: cruce.cuil, empresaId: 'e2', startMs: hueco.startMs - 8 * 3600000, endMs: hueco.startMs - 6 * 3600000 }] }).length === 0, '');
const plan = core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', eventoId: 'ev', shiftId: 's', isEventual: true, punched: false });
report('eventual sin fichar', plan?.arcaBajaPendiente === true && plan.descuentaLiquidacion === true && plan.confiabilidadDelta === -1, JSON.stringify(plan));
report('no eventual', core.planEventualAusente({ employeeId: 'e', empresaAltaId: 'emp', isEventual: false }) === null, '');

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
