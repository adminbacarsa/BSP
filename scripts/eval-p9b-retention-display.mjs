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
const { formatRetentionDuration, buildRetentionWaitInfo, formatRetentionLine, relevoAusenteAviso, retentionPendingReason: uiReason } = await load('packages/ops-core/src/retentionDisplay.ts');
const { retentionPendingReason: srvReason } = await load('apps/functions/src/scheduling/retentionPendingReason.ts');
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
report('ferrero espera T 15:00', wf?.reliever?.code === 'T' && wf.elapsedMinutes === 12 && /no se presentó$/.test(wf?.waitLabel || ''), `${wf?.waitLabel} · ${wf?.elapsedMinutes} min`);
report('ferrero tope 12:59 desde 11:30', wf?.capAtMs === ms(at(11, 30)) + (12 * 60 + 59) * 60000 && wf.capRemainingMinutes === (12 * 60 + 59) - (3 * 60 + 42), `restan ${wf?.capRemainingMinutes} min`);

const wc = buildRetentionWaitInfo(cardo, all, now);
report('cardo espera T2 15:30 (no T)', wc?.reliever?.code === 'T2' && wc.reliever.startMs === ms(at(15, 30)) && wc.waitLabel === `Esperando relevo de las 15:30 (${wc.reliever.employeeName})`, wc?.waitLabel);

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
report('línea completa', /^Retenido desde 15:00 · 12 min · /.test(line || '') && /no se presentó/.test(line || '') && /tope 00:29/.test(line || ''), line);
const early = { nowMs: ms(at(15, 9)), reliefStartMs: ms(at(15, 30)), employeeName: 'GARCIA' };
const late = { nowMs: ms(at(15, 31)), reliefStartMs: ms(at(15, 30)), employeeName: 'GARCIA' };
report('paridad texto antes de la hora', uiReason(early) === srvReason(early) && uiReason(early) === 'Esperando relevo de las 15:30 (GARCIA)', uiReason(early));
report('paridad texto hora pasada', uiReason(late) === srvReason(late) && uiReason(late) === 'GARCIA no se presentó', uiReason(late));
const covLlega = { nowMs: ms(at(15, 5)), reliefStartMs: ms(at(16, 0)), employeeName: 'KOPP Franco Isaias', cobertura: true };
const covCamino = { nowMs: ms(at(15, 5)), reliefStartMs: ms(at(15, 0)), employeeName: 'KOPP, Franco', cobertura: true };
report('paridad cobertura llega', uiReason(covLlega) === srvReason(covLlega) && uiReason(covLlega) === 'Esperando a KOPP (cobertura, llega 16:00)', uiReason(covLlega));
report('paridad cobertura en camino', uiReason(covCamino) === srvReason(covCamino) && uiReason(covCamino) === 'Esperando a KOPP (cobertura, en camino)', uiReason(covCamino));
const kopp = mk('kopp', 'KOPP Franco Isaias', 'T', 'Puesto 2', END, at(23, 0), { origin: 'OPERATIONS_COVERAGE', coverageType: 'FT', status: 'PENDING' });
const wCov = buildRetentionWaitInfo(ferrero, [ferrero, kopp], now);
report('tarjeta: cobertura sin fichar dice en camino', wCov?.waitLabel === 'Esperando a KOPP (cobertura, en camino)', wCov?.waitLabel);

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

const antes = at(12, 17);
const fariasAnt = classify(farias, { isRetention: true, isPresent: true, retentionAbsenceShiftId: 'venencia' });
const fariasAntes = classifyOpsShift({
  shift: { ...farias, isRetention: true, isPresent: true, shiftDateObj: farias.shiftDateObj, endDateObj: farias.endDateObj },
  now: antes,
  isValidEmployee: true,
  isFranco: false,
  shiftCode: 'M3',
  effectiveEndDateObj: farias.endDateObj,
});
report('antes del fin no es RETENIDO', fariasAntes.isRetention === false && fariasAntes.isPendingRetention === false, `ret=${fariasAntes.isRetention}`);
const venAbs = { ...venencia, isAbsent: true, status: 'ABSENT' };
const aviso = relevoAusenteAviso({ ...farias, isPresent: true }, [farias, venAbs], antes);
report('línea relevo ausente sin cubrir', aviso === 'Relevo ausente: VENENCIA (T3 16:00) · sin cubrir', aviso);
const cubierto = { ...venencia, id: 'quiroga', employeeName: 'QUIROGA', isAbsent: false, status: 'PENDING' };
const avisoCub = relevoAusenteAviso({ ...farias, isPresent: true }, [farias, venAbs, cubierto], antes);
report('cubierto en planificación: sin línea', avisoCub === null, String(avisoCub));
report('pasado el fin no usa la línea', relevoAusenteAviso({ ...ferrero, isPresent: true }, [ferrero, { ...lopez, isAbsent: true }], now) === null, 'fin vencido');
void fariasAnt;

const failed = results.filter((r) => !r.ok).length;
console.log(`P9b ${results.length - failed}/${results.length}`);
if (failed) process.exit(1);
