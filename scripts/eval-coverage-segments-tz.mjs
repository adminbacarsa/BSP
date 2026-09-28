/**
 * Tramos EXT/ADV y ventanas de día de la cascada en hora AR, independientes del TZ del proceso.
 * Functions corre en UTC: antes los tramos salían corridos −3 h (Bustamante 27/09, Nuevo Edificio 28/09).
 *
 * Uso (desde la raíz, con `npm run build` hecho en apps/functions):
 *   node --experimental-strip-types scripts/eval-coverage-segments-tz.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const functionsDir = path.join(__dirname, '..', 'apps', 'functions');
const requireFn = createRequire(path.join(functionsDir, 'package.json'));

const seg = requireFn('./lib/coverage/coverageExtAdvSegments.js');
const srvClock = requireFn('./lib/common/arClock.js');
const webClock = await import(pathToFileURL(path.join(__dirname, '..', 'apps', 'web2', 'src', 'lib', 'arClock.ts')).href);

const H = 3600 * 1000;
const ar = (ymd, hm) => Date.parse(`${ymd}T${hm}:00-03:00`);
const fmt = (ms) => new Date(ms - 3 * H).toISOString().slice(0, 16).replace('T', ' ');
const tsMs = (t) => t.toMillis();

let failed = 0;
let passed = 0;
const check = (label, got, want) => {
  if (got === want) {
    passed++;
    return;
  }
  failed++;
  console.error(`  ✗ ${label}: got ${got} want ${want}`);
};

const TZS = ['UTC', 'America/Argentina/Buenos_Aires', 'Asia/Tokyo'];

for (const tz of TZS) {
  process.env.TZ = tz;
  console.log(`TZ=${tz} (offset local ${-new Date(ar('2026-09-28', '12:00')).getTimezoneOffset() / 60} h)`);

  // M 07–15 AR (Recepción 1, Nuevo Edificio 28/09): EXT 07–11, ADV 11–15.
  {
    const anchor = new Date(ar('2026-09-28', '07:00'));
    const band = seg.resolveCoverageBandCode({ code: 'M', startTime: anchor });
    const s = seg.dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand: band });
    check('M ext.start', fmt(tsMs(s.extCov.start)), '2026-09-28 07:00');
    check('M ext.end', fmt(tsMs(s.extCov.end)), '2026-09-28 11:00');
    check('M adv.start', fmt(tsMs(s.advCov.start)), '2026-09-28 11:00');
    check('M adv.end', fmt(tsMs(s.advCov.end)), '2026-09-28 15:00');
    check('M extensionEnd', fmt(tsMs(seg.extensionEndTimestamp(anchor, s.extCov.extensionEndHm))), '2026-09-28 11:00');
    check('M adjustedStart', fmt(tsMs(seg.adjustedStartTimestamp(anchor, s.advCov.adjustedStartHm))), '2026-09-28 11:00');
  }

  // Playa M 07–15 27/09 (Bustamante): ADV debía arrancar 11:00, no 08:00.
  {
    const anchor = new Date(ar('2026-09-27', '07:00'));
    const s = seg.dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand: 'M' });
    check('Playa adjustedStart', fmt(tsMs(seg.adjustedStartTimestamp(anchor, s.advCov.adjustedStartHm))), '2026-09-27 11:00');
    check('Playa ext', `${fmt(tsMs(s.extCov.start))}→${fmt(tsMs(s.extCov.end))}`, '2026-09-27 07:00→2026-09-27 11:00');
  }

  // N 19–07: el tramo ADV cruza medianoche al día AR siguiente.
  {
    const anchor = new Date(ar('2026-09-28', '19:00'));
    const s = seg.dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand: 'N' });
    check('N ext', `${fmt(tsMs(s.extCov.start))}→${fmt(tsMs(s.extCov.end))}`, '2026-09-28 19:00→2026-09-28 23:00');
    check('N adv', `${fmt(tsMs(s.advCov.start))}→${fmt(tsMs(s.advCov.end))}`, '2026-09-28 23:00→2026-09-29 07:00');
  }

  // Titular que arranca 22:00 AR (01:00 UTC del día siguiente): el ancla es el día AR, no el UTC.
  {
    const anchor = new Date(ar('2026-09-28', '22:00'));
    const s = seg.dualExtAdvSegmentTimestamps({ titularAnchor: anchor, gapBand: 'N' });
    check('22:00 ancla día AR', fmt(tsMs(s.extCov.start)), '2026-09-28 19:00');
  }

  // Banda por hora AR cuando el código no alcanza.
  check('banda 13:00 AR', seg.resolveCoverageBandCode({ code: '', startTime: new Date(ar('2026-09-28', '13:00')) }), 'M');
  check('banda 05:00 AR', seg.resolveCoverageBandCode({ code: '', startTime: new Date(ar('2026-09-28', '05:00')) }), 'N');
  check('banda 21:30 AR', seg.resolveCoverageBandCode({ code: 'COBERTURA', startTime: new Date(ar('2026-09-28', '21:30')) }), 'T');

  // Ventana "hoy" de la cascada a las 22:30 AR (01:30 UTC del 29): sigue siendo el 28 AR.
  {
    const b = srvClock.arDayBoundsMs(ar('2026-09-28', '22:30'));
    check('día AR 22:30 start', fmt(b.startMs), '2026-09-28 00:00');
    check('día AR 22:30 end', new Date(b.endMs - 3 * H).toISOString().slice(0, 19), '2026-09-28T23:59:59');
  }

  // Espejo front == server.
  const samples = [
    ar('2026-09-28', '00:00'),
    ar('2026-09-28', '02:59'),
    ar('2026-09-28', '21:00'),
    ar('2026-09-28', '23:59'),
    ar('2026-12-31', '22:15'),
    ar('2027-01-01', '00:30'),
  ];
  for (const ms of samples) {
    check(`espejo arMidnightMs ${fmt(ms)}`, webClock.arMidnightMs(ms), srvClock.arMidnightMs(ms));
    check(`espejo arHour ${fmt(ms)}`, webClock.arHour(ms), srvClock.arHour(ms));
    check(`espejo arYmd ${fmt(ms)}`, webClock.arYmd(ms), srvClock.arYmd(ms));
    check(`espejo arHmOnDayMs ${fmt(ms)}`, webClock.arHmOnDayMs(ms, 11, 0), srvClock.arHmOnDayMs(ms, 11, 0));
    check(`espejo arDayBoundsMs ${fmt(ms)}`, JSON.stringify(webClock.arDayBoundsMs(ms)), JSON.stringify(srvClock.arDayBoundsMs(ms)));
  }
  check('espejo arHmOnYmdMs', webClock.arHmOnYmdMs('2026-09-28', 11, 0), srvClock.arHmOnYmdMs('2026-09-28', 11, 0));
  check('arHmOnYmdMs 11:00', fmt(srvClock.arHmOnYmdMs('2026-09-28', 11, 0)), '2026-09-28 11:00');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} segmentos TZ: ${passed} ok, ${failed} fallas`);
process.exit(failed === 0 ? 0 : 1);
