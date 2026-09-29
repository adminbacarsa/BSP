/**
 * P9b — contador de retención, a quién espera y pestañas del CC. Sin emulador.
 *   node --experimental-strip-types scripts/eval-p9b-retention-display.mjs
 */
import path from 'path';
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { formatRetentionDuration, buildRetentionWaitInfo, formatRetentionLine } = await load('packages/ops-core/src/retentionDisplay.ts');
const { classifyOpsShift } = await load('packages/ops-core/src/classifyOpsShift.ts');
const { shiftMatchesOpsViewTab } = await load('packages/ops-core/src/shiftMatchesOpsViewTab.ts');

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

const at = (h, m, s = 0) => new Date(`2026-09-29T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}-03:00`);
const ms = (d) => d.getTime();

report('12 min', formatRetentionDuration(12) === '12 min', formatRetentionDuration(12));
report('1 h 05 min', formatRetentionDuration(65) === '1 h 05 min', formatRetentionDuration(65));
report('2 h 00 min', formatRetentionDuration(120) === '2 h 00 min', formatRetentionDuration(120));
report('negativo → 0 min', formatRetentionDuration(-3) === '0 min', formatRetentionDuration(-3));

const oid = 'peaje';
const mk = (id, name, code, pos, start, end, extra = {}) => ({
  id, objectiveId: oid, employeeId: `e_${id}`, employeeName: name, code, positionName: pos,
  shiftDateObj: start, endDateObj: end, ...extra,
});
const END = at(15, 0);
const ferrero = mk('ferrero', 'FERRERO', 'M', 'Puesto 2', at(11, 30), END, { isPresent: true, realStartTime: { seconds: ms(at(11, 30)) / 1000 } });
const cardo = mk('cardo', 'CARDO', 'M2', 'Puesto 2', at(11, 45), END, { isPresent: true, realStartTime: { seconds: ms(at(11, 45)) / 1000 } });
const fantini = mk('fantini', 'FANTINI', 'M2', 'Puesto 1', at(11, 0), END, { isPresent: true, realStartTime: { seconds: ms(at(11, 28)) / 1000 } });
const farias = mk('farias', 'FARIAS', 'M3', 'Puesto 1', at(12, 0), at(16, 0), { isPresent: true });
const lopez = mk('lopez', 'LOPEZ', 'T', 'Puesto 2', END, at(16, 0));
const brizuela = mk('brizuela', 'BRIZUELA', 'T', 'Puesto 2', END, at(16, 0));
const fontana = mk('fontana', 'FONTANA', 'T2', 'Puesto 1', END, at(17, 0));
const bazan = mk('bazan', 'BAZAN', 'T2', 'Puesto 2', at(15, 30), at(16, 30));
const gonzalez = mk('gonzalez', 'GONZALEZ', 'T2', 'Puesto 2', at(15, 30), at(16, 30));
const venencia = mk('venencia', 'VENENCIA', 'T3', 'Puesto 1', at(16, 0), at(17, 0));
const all = [ferrero, cardo, fantini, farias, lopez, brizuela, fontana, bazan, gonzalez, venencia];
const now = at(15, 12);

const wf = buildRetentionWaitInfo(ferrero, all, now);
report('ferrero espera T 15:00', wf?.reliever?.code === 'T' && wf.elapsedMinutes === 12 && wf.waitLabel.startsWith('Espera a '), `${wf?.waitLabel} · ${wf?.elapsedMinutes} min`);
report('ferrero tope 12:59 desde 11:30', wf?.capAtMs === ms(at(11, 30)) + (12 * 60 + 59) * 60000 && wf.capRemainingMinutes === (12 * 60 + 59) - (3 * 60 + 42), `restan ${wf?.capRemainingMinutes} min`);

const wc = buildRetentionWaitInfo(cardo, all, now);
report('cardo espera T2 15:30 (no T)', wc?.reliever?.code === 'T2' && wc.reliever.startMs === ms(at(15, 30)), wc?.waitLabel);

const wfa = buildRetentionWaitInfo(fantini, all, now);
report('fantini espera a FONTANA, no a FARIAS', wfa?.reliever?.employeeName === 'FONTANA', wfa?.waitLabel);
report('fantini tope desde fichada 11:28', wfa?.capAtMs === ms(at(11, 28)) + (12 * 60 + 59) * 60000, String(wfa?.capAtMs));

const solo = buildRetentionWaitInfo(ferrero, [ferrero, cardo, farias], now);
report('sin relevo planificado → vacante', solo?.reliever === null && /vacante/i.test(solo.waitLabel), solo?.waitLabel);

const lopezAbs = { ...lopez, isAbsent: true, status: 'ABSENT' };
const wAbs = buildRetentionWaitInfo(ferrero, [ferrero, lopezAbs, brizuela], now);
report('relevo ausente → el otro T de la serie', wAbs?.reliever?.employeeName === 'BRIZUELA' && wAbs.reliever.status === 'NO_FICHO', wAbs?.waitLabel);
const wAbsSolo = buildRetentionWaitInfo(ferrero, [ferrero, lopezAbs], now);
report('único relevo ausente → espera cubridor', wAbsSolo?.reliever?.status === 'AUSENTE' && /cubridor/.test(wAbsSolo.waitLabel), wAbsSolo?.waitLabel);

const line = formatRetentionLine(wf);
report('línea completa', /^Retenido desde 15:00 · 12 min · Espera a LOPEZ \(T 15:00\)|BRIZUELA/.test(line) && /tope 00:29/.test(line), line);

// Pestañas: el saliente vencido cuenta en RET y sigue en ACT; el retenido también.
const classify = (shift, flags) => classifyOpsShift({
  shift: { ...shift, ...flags },
  now,
  isValidEmployee: true,
  isFranco: false,
  shiftCode: shift.code,
  effectiveEndDateObj: shift.endDateObj,
});
const pending = { ...classify(ferrero, {}), isFranco: false };
const held = { ...classify(ferrero, { isRetention: true }), isFranco: false };
const active = { ...classify(farias, {}), isFranco: false };
const count = (rows, tab) => rows.filter((r) => shiftMatchesOpsViewTab(r, tab, now)).length;
const rows = [pending, held, active];
report('RET cuenta vencido + retenido', count(rows, 'RETENIDOS') === 2, `ret=${count(rows, 'RETENIDOS')}`);
report('ACT los mantiene a los tres', count(rows, 'ACTIVOS') === 3, `act=${count(rows, 'ACTIVOS')}`);
report('minutos en vivo', pending.retentionMinutes === 12 && held.retentionMinutes === 12, `${pending.retentionMinutes}/${held.retentionMinutes}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`P9b ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
