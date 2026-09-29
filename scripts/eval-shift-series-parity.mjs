/**
 * Paridad de la serie de relevo: ops-core y functions/src son el mismo archivo.
 *
 *   node --experimental-strip-types scripts/eval-shift-series-parity.mjs
 */
import fs from 'fs';
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const aPath = path.join(root, 'packages/ops-core/src/shiftSeries.ts');
const bPath = path.join(root, 'apps/functions/src/common/shiftSeries.ts');
const a = fs.readFileSync(aPath, 'utf8');
const b = fs.readFileSync(bPath, 'utf8');

const core = await import(pathToFileURL(path.join(root, 'packages/ops-core/src/shiftSeries.ts')).href);
const fn = await import(pathToFileURL(path.join(root, 'apps/functions/src/common/shiftSeries.ts')).href);

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

report('archivo', a === b, a === b ? 'ops-core y functions/src son el mismo archivo' : 'las copias difieren');

const chain = ['M', 'T', 'N', 'M'];
const chainOk = chain.slice(0, 3).every((code, i) => core.nextSeriesCode(code) === chain[i + 1] && fn.nextSeriesCode(code) === chain[i + 1]);
report('M-T-N', chainOk, chain.map((c) => core.nextSeriesCode(c) || 'M').join('→'));

const s2 = core.nextSeriesCode('M2') === 'T2' && core.nextSeriesCode('T2') === 'N2' && core.nextSeriesCode('N2') === 'M2';
const s2b = fn.nextSeriesCode('M3') === 'T3' && fn.prevSeriesCode('T3') === 'M3';
report('sufijo', s2 && s2b, `M2→${core.nextSeriesCode('M2')} T2→${core.nextSeriesCode('T2')} N2→${core.nextSeriesCode('N2')}`);

const d12 = core.nextSeriesCode('D12') === 'N12' && core.nextSeriesCode('N12') === 'D12' && fn.nextSeriesCode('N12') === 'D12';
report('D12', d12, 'D12→N12→D12 (N12 no es la serie 12)');

const puesto = 'Puesto 1';
const gap = Date.parse('2026-09-29T12:00:00-03:00');
const baez = { id: 'baez', employeeName: 'Baez', code: 'M', positionName: puesto, startMs: gap - 75 * 60 * 1000, endMs: gap, checkInMs: gap - 70 * 60 * 1000 };
const farias = { id: 'farias', employeeName: 'Farias', code: 'M3', positionName: puesto, startMs: gap, endMs: gap + 4 * 3600 * 1000, checkInMs: gap - 13 * 60 * 1000 };
const guerrero = { id: 'guerrero', employeeName: 'Guerrero', code: 'T', positionName: puesto, startMs: gap, endMs: gap + 150 * 60 * 1000 };
const reliever = core.relieverFor(baez, [farias, guerrero]);
const relieverFn = fn.relieverFor(baez, [farias, guerrero]);
report('baez', reliever?.id === 'guerrero' && relieverFn?.id === 'guerrero', `releva ${reliever?.employeeName}`);

const retained = core.outgoingFor(guerrero, [baez, { ...farias, isPresent: true }]);
const retainedFn = fn.outgoingFor(guerrero, [baez, farias]);
report('retenido', retained?.id === 'baez' && retainedFn?.id === 'baez', `retiene ${retained?.employeeName}`);

const t15 = Date.parse('2026-09-29T15:00:00-03:00');
const fantini = { id: 'fantini', code: 'M2', positionName: puesto, startMs: t15 - 4 * 3600 * 1000, endMs: t15 };
const fontana = { id: 'fontana', code: 'T2', positionName: puesto, startMs: t15, endMs: t15 + 4 * 3600 * 1000 };
const otroT = { id: 'otro', code: 'T', positionName: puesto, startMs: t15, endMs: t15 + 4 * 3600 * 1000 };
const fan = core.relieverFor(fantini, [otroT, fontana]);
report('fantini', fan?.id === 'fontana' && fn.relieverFor(fantini, [otroT, fontana])?.id === 'fontana', `releva ${fan?.id}`);

const mEnd = Date.parse('2026-09-29T15:00:00-03:00');
const manana = { id: 'm', code: 'M', positionName: puesto, startMs: mEnd - 8 * 3600 * 1000, endMs: mEnd };
const m3 = { id: 'm3', code: 'M3', positionName: puesto, startMs: mEnd, endMs: mEnd + 4 * 3600 * 1000 };
const tarde = { id: 't', code: 'T', positionName: puesto, startMs: mEnd, endMs: mEnd + 8 * 3600 * 1000 };
const plain = core.relieverFor(manana, [m3, tarde]);
report('sin-sufijo', plain?.id === 't' && fn.outgoingFor(tarde, [manana, { ...m3, startMs: mEnd - 4 * 3600 * 1000, endMs: mEnd }])?.id === 'm', `releva ${plain?.id}`);

const customOut = { id: 'out', code: 'CUSTOM', positionName: puesto, startMs: gap - 4 * 3600 * 1000, endMs: gap };
const libre = { id: 'in', code: 'LIBRE', positionName: puesto, startMs: gap, endMs: gap + 4 * 3600 * 1000 };
const fb = core.relieverFor(customOut, [libre]);
const ft = { id: 'ft', code: 'FT', origin: 'OPERATIONS_COVERAGE', titularCode: 'T', positionName: puesto, startMs: gap, endMs: gap + 4 * 3600 * 1000 };
const inherited = core.seriesCodeOf(ft) === 'T' && fn.seriesCodeOf(ft) === 'T';
const inheritedRel = core.relieverFor(baez, [ft, farias]);
report('fallback', fb?.id === 'in' && inherited && inheritedRel?.id === 'ft', `custom→${fb?.id} ops_cov hereda T y releva a Baez=${inheritedRel?.id}`);

const esc = { id: 'esc', code: 'ESC', positionName: puesto, startMs: gap, endMs: gap + 8 * 3600 * 1000 };
report('esc', core.relieverFor(baez, [esc]) == null && fn.relieverFor(baez, [esc, guerrero])?.id === 'guerrero', 'ESC no releva');

const failed = results.filter((r) => !r.ok).length;
if (failed) process.exitCode = 1;
