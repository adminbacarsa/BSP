/**
 * Cierre de turno: la copia de Functions y @cosp/ops-core son el mismo m?dulo, y el c?lculo
 * que usa el CHECKOUT del operador es el del servidor (tope 12:59 + retenci?n).
 *
 *   node --experimental-strip-types scripts/eval-shift-close-core.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = fs.readFileSync(path.join(root, 'packages/ops-core/src/shiftClose.ts'), 'utf8');
const b = fs.readFileSync(path.join(root, 'apps/functions/src/scheduling/shiftCloseCore.ts'), 'utf8');

const core = await import('../packages/ops-core/src/shiftClose.ts');
const { computeShiftCloseTimes, shiftWorkStartMs, shiftHardCapAtMs, SHIFT_HARD_CAP_MS, closeTimeMs } = core;

const results = [];
const report = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${detail ? ` ? ${detail}` : ''}`); };
const ar = (h, m = 0, d = 1) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
const ts = (ms) => ({ toMillis: () => ms });

report('archivo', a === b, a === b ? 'ops-core y functions/src son el mismo archivo' : 'las copias difieren');

// GARCIA 01/10: M2 11:45?15:30, fich? 11:41, retenida desde 15:30, salida del operador 15:59 ? 29 min.
{
  const garcia = { startTime: ts(ar(11, 45)), endTime: ts(ar(15, 30)), checkInTime: ts(ar(11, 41)), realStartTime: ts(ar(11, 45)), isRetention: true };
  const r = computeShiftCloseTimes(garcia, ar(15, 59));
  const ok = r.realEndMs === ar(15, 59) && r.retentionEndedMs === ar(15, 59) && r.retentionMinutes === 29 && r.cappedAtMs === false;
  report('retenida: fin de retenci?n = salida real, 29 min', ok, JSON.stringify(r));
}
// Sin retenci?n: nada de retenci?n en el parche.
{
  const r = computeShiftCloseTimes({ startTime: ts(ar(11, 45)), endTime: ts(ar(15, 30)), realStartTime: ts(ar(11, 45)) }, ar(15, 59));
  report('sin retenci?n: retentionEndedMs/Minutes null', r.retentionEndedMs === null && r.retentionMinutes === null && r.realEndMs === ar(15, 59));
}
// Retenida pero sali? antes del fin planificado (liberada temprano): fin de retenci?n s?, minutos no.
{
  const r = computeShiftCloseTimes({ startTime: ts(ar(7)), endTime: ts(ar(15)), realStartTime: ts(ar(7)), isRetention: true }, ar(14, 50));
  report('retenida liberada antes del fin planificado: sin minutos', r.retentionEndedMs === ar(14, 50) && r.retentionMinutes === null);
}
// Tope 12:59 desde el inicio real: una salida pedida a las 21:00 con fichada 07:00 se recorta a 19:59.
{
  const data = { startTime: ts(ar(7)), endTime: ts(ar(15)), checkInTime: ts(ar(7)), isRetention: true };
  const r = computeShiftCloseTimes(data, ar(21));
  const cap = ar(7) + SHIFT_HARD_CAP_MS;
  const ok = r.realEndMs === cap && r.cappedAtMs === true && r.retentionEndedMs === cap && r.retentionMinutes === 299 && shiftHardCapAtMs(data) === cap;
  report('tope 12:59: recorta la salida y los minutos', ok, `realEnd=${new Date(r.realEndMs).toISOString()} min=${r.retentionMinutes}`);
}
// Inicio de jornada: fichada real antes que el planificado; sin fichada, el planificado.
{
  const conFichada = shiftWorkStartMs({ startTime: ts(ar(7)), realStartTime: ts(ar(7, 12)) });
  const sinFichada = shiftWorkStartMs({ startTime: ts(ar(7)) });
  report('inicio de jornada: realStartTime > startTime', conFichada === ar(7, 12) && sinFichada === ar(7));
}
// Timestamps del cliente, Date, ms e ISO se leen igual (el front recibe cualquiera).
{
  const ms = ar(15, 30);
  const same = [ts(ms), new Date(ms), ms, new Date(ms).toISOString(), { seconds: ms / 1000 }, { _seconds: ms / 1000 }].every((v) => closeTimeMs(v) === ms);
  report('closeTimeMs: Timestamp/Date/ms/ISO/seconds', same && closeTimeMs(null) === 0 && closeTimeMs('') === 0);
}
// Redondeo: 6,83 min ? 7 (Bosio 15:15 ? 15:21:50).
{
  const r = computeShiftCloseTimes({ startTime: ts(ar(11, 30)), endTime: ts(ar(15, 15)), realStartTime: ts(ar(12, 5)), isRetention: true }, ar(15, 21) + 50_000);
  report('redondeo al minuto m?s cercano (7)', r.retentionMinutes === 7, String(r.retentionMinutes));
}

const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} caso(s) fallaron` : '\nSHIFT_CLOSE_CORE_OK');
process.exit(failed ? 1 : 0);
