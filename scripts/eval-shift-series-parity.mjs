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

const t7 = Date.parse('2026-09-29T07:00:00-03:00');
const viejo = { id: 'viejo', code: 'M', positionName: puesto, startMs: t7, endMs: t15, checkInMs: t7 - 10 * 60 * 1000 };
const nuevo = { id: 'nuevo', code: 'M', positionName: puesto, startMs: t7, endMs: t15, checkInMs: t7 + 20 * 60 * 1000 };
const cupo = core.keepsNextBandSlot(nuevo, [viejo, nuevo], 1) && !core.keepsNextBandSlot(viejo, [viejo, nuevo], 1)
  && fn.keepsNextBandSlot(nuevo, [viejo, nuevo], 1) && !fn.keepsNextBandSlot(viejo, [viejo, nuevo], 1)
  && core.keepsNextBandSlot(viejo, [viejo, nuevo], 2);
report('cupo', cupo, 'M×2 → T×1: se queda el de menos tiempo; con 2 lugares quedan los dos');

// FIFO (Peaje 9 Norte, Puesto 2, 01/10): M×2 11:30–15:15, T×2 15:15. El primer T que ficha releva al M que más tiempo lleva.
const p2 = 'Puesto 2';
const fin = Date.parse('2026-10-01T15:15:00-03:00');
const ini = Date.parse('2026-10-01T11:30:00-03:00');
const ferrero = { id: 'ferrero', employeeId: 'e_ferrero', code: 'M', positionName: p2, startMs: ini, endMs: fin, checkInMs: Date.parse('2026-10-01T11:38:00-03:00'), isPresent: true };
const bosio = { id: 'bosio', employeeId: 'e_bosio', code: 'M', positionName: p2, startMs: ini, endMs: fin, checkInMs: Date.parse('2026-10-01T12:05:00-03:00'), isPresent: true };
const lopez = { id: 'lopez', employeeId: 'e_lopez', code: 'T', positionName: p2, startMs: fin, endMs: fin + 8 * 3600 * 1000 };
const brizuela = { id: 'brizuela', employeeId: 'e_brizuela', code: 'T', positionName: p2, startMs: fin, endMs: fin + 8 * 3600 * 1000 };
const lopezFicha = { ...lopez, checkInMs: Date.parse('2026-10-01T15:21:00-03:00'), isPresent: true };
const brizuelaFicha = { ...brizuela, checkInMs: Date.parse('2026-10-01T15:25:00-03:00'), isPresent: true };
for (const [tag, lib] of [['ops-core', core], ['functions', fn]]) {
  const outs = lib.sortOutgoingsFifo([bosio, ferrero]).map((r) => r.id).join(',');
  const ins = lib.sortIncomingsFifo([brizuela, lopezFicha]).map((r) => r.id).join(',');
  const pares = lib.pairReliefs([bosio, ferrero], [lopezFicha, brizuela]).map((p) => `${p.outgoing.id}←${p.incoming?.id}`).join(' ');
  const primero = lib.outgoingFor(lopezFicha, [bosio, ferrero, brizuela], { peers: [bosio, ferrero, brizuela] });
  const segundo = lib.outgoingFor(brizuelaFicha, [{ ...ferrero, relievedBy: 'e_lopez' }, bosio, lopezFicha], { peers: [{ ...ferrero, relievedBy: 'e_lopez' }, bosio, lopezFicha] });
  const invertido = lib.outgoingFor(brizuelaFicha, [bosio, ferrero, lopez], { peers: [bosio, ferrero, lopez] });
  const tarjeta = lib.relieverFor(bosio, [lopezFicha, brizuela], { peers: [ferrero] });
  const ok = outs === 'ferrero,bosio' && ins === 'lopez,brizuela' && pares === 'ferrero←lopez bosio←brizuela'
    && primero?.id === 'ferrero' && segundo?.id === 'bosio' && invertido?.id === 'ferrero' && tarjeta?.id === 'brizuela';
  report(`fifo-${tag}`, ok, `outs=${outs} ins=${ins} pares=${pares} 1º ${primero?.id} 2º ${segundo?.id} BRIZUELA primero→${invertido?.id} tarjeta BOSIO←${tarjeta?.id}`);

  // Ausente: el hueco se lo queda el saliente que sobra (el más nuevo), el que ficha releva al más antiguo.
  const lopezAa = { ...lopez, isAbsent: true, status: 'ABSENT' };
  const soloAa = lib.outgoingFor(lopezAa, [ferrero, bosio]);
  const mixto = lib.pairReliefs([ferrero, bosio], [lopezAa, brizuelaFicha]).map((p) => `${p.outgoing.id}←${p.incoming?.id}`).join(' ');
  const okAa = soloAa?.id === 'bosio' && mixto === 'ferrero←brizuela bosio←lopez';
  report(`fifo-ausente-${tag}`, okAa, `T ausente retiene a ${soloAa?.id}; con BRIZUELA fichada: ${mixto}`);

  const app = { ...ferrero, checkInMs: undefined, checkInAt: ferrero.checkInMs + 6000, realStartTime: ferrero.checkInMs + 6000 };
  const operador = { ...bosio, checkInMs: undefined, checkInAt: undefined, realStartTime: bosio.checkInMs + 36000 };
  const sinCheckIn = lib.sortOutgoingsFifo([operador, app]).map((r) => r.id).join(',');
  const cerca = { id: 'z_cerca', employeeId: 'e_cerca', code: 'M', positionName: p2, startMs: ini, endMs: fin, checkInAt: ferrero.checkInMs };
  const lejos = { id: 'a_lejos', employeeId: 'e_lejos', code: 'M', positionName: p2, startMs: ini, endMs: fin, checkInAt: ferrero.checkInMs };
  const roster = [
    { id: 'duty_cerca', employeeId: 'e_cerca', code: 'M', startMs: fin + 16 * 3600 * 1000, endMs: fin + 24 * 3600 * 1000 },
    { id: 'franco', employeeId: 'e_lejos', code: 'F', isFranco: true, startMs: fin + 9 * 3600 * 1000, endMs: fin + 20 * 3600 * 1000 },
    { id: 'duty_lejos', employeeId: 'e_lejos', code: 'M', startMs: fin + 4 * 86400000, endMs: fin + 4 * 86400000 + 8 * 3600 * 1000 },
  ];
  const porDescanso = lib.sortOutgoingsFifo([lejos, cerca], { roster }).map((r) => r.id).join(',');
  const releva = lib.outgoingFor(lopezFicha, [lejos, cerca], { roster });
  report(`fifo-marca-${tag}`, sinCheckIn === 'ferrero,bosio' && porDescanso === 'z_cerca,a_lejos' && releva?.id === 'z_cerca',
    `sin checkInAt=${sinCheckIn} mismo segundo→${porDescanso} releva ${releva?.id}`);
}

const failed = results.filter((r) => !r.ok).length;
if (failed) process.exitCode = 1;
