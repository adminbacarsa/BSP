/**
 * P5b — ventanas de aviso y reloj de pago. Sin emulador.
 *   node --experimental-strip-types scripts/eval-p5b-arrival.mjs
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(path.join(root, '../apps/functions/package.json'));

const windowMod = await import(pathToFileURL(path.join(root, '../apps/functions/src/attendance/arrivalNoticeWindow.ts')).href);
const payMod = await import(pathToFileURL(path.join(root, '../apps/functions/src/fichajes/checkInPay.ts')).href);
const fcmMod = await import(pathToFileURL(path.join(root, '../apps/functions/src/notifications/shiftAlertFcm.ts')).href);

const { classifyArrivalNotice, headsUpBody, venisBody, lugarAviso } = windowMod;
const { resolveCheckInPayClock } = payMod;
const { isShiftAlertFcmType, SHIFT_ALERT_CHANNEL_ID, shiftAlertPlatformConfig } = fcmMod;

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const start = Date.parse('2026-09-29T08:00:00-03:00');
report('T-6 no avisa', classifyArrivalNotice(start, start - 6 * 60_000) === null, 'antes de T-5');
report('T-5 heads-up', classifyArrivalNotice(start, start - 5 * 60_000) === 'HEADS_UP', '07:55');
report('T-1 heads-up', classifyArrivalNotice(start, start - 60_000) === 'HEADS_UP', '07:59');
report('T venis', classifyArrivalNotice(start, start) === 'VENIS', '08:00');
report('T+70s venis', classifyArrivalNotice(start, start + 70_000) === 'VENIS', 'gracia de un tick');
report('T+2min no', classifyArrivalNotice(start, start + 2 * 60_000) === null, 'no llega tarde como el cron de 5 min');

const lugar = lugarAviso({
  clientName: 'Malagueño',
  objectiveName: 'Obrador Malagueño',
  positionName: 'Puesto 1',
});
const heads = headsUpBody('08:00', lugar);
report('texto T-5', heads.includes('08:00') && heads.includes('Obrador Malagueño') && heads.includes('Puesto 1') && heads.includes('¿Ya estás llegando?'), heads);
const venis = venisBody('M', lugar, '08:00');
report('texto venis', venis.includes('Obrador Malagueño') && venis.includes('Puesto 1') && !venis.includes('objetivo / puesto'), venis);

const t5 = resolveCheckInPayClock({ nowMs: start + 5 * 60_000, plannedStartMs: start });
report('pago T+5', t5.realStartMs === start && t5.isLate === false && t5.checkInAtMs === start + 5 * 60_000, `real=${t5.realStartMs}`);
const t6 = resolveCheckInPayClock({ nowMs: start + 6 * 60_000, plannedStartMs: start, windowLateMinutes: 6 });
report('pago T+6', t6.realStartMs === start + 6 * 60_000 && t6.isLate && t6.lateMinutes === 6 && t6.checkInAtMs === t6.realStartMs, `late=${t6.lateMinutes}`);

report('canal', SHIFT_ALERT_CHANNEL_ID === 'alertas_turno' && isShiftAlertFcmType('CONVOCATORIA_COBERTURA') && isShiftAlertFcmType('AVISO_TURNO_PROXIMO'), SHIFT_ALERT_CHANNEL_ID);
const plat = shiftAlertPlatformConfig();
report('fcm high', plat.android.priority === 'high' && plat.android.notification?.channelId === 'alertas_turno' && plat.apns.payload?.aps?.['interruption-level'] === 'time-sensitive', 'android+apns');

void req;
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
