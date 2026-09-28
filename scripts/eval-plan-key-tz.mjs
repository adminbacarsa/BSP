/**
 * Clave de `planificacion_estados` en calendario AR, independiente del TZ del proceso.
 * Functions corre en UTC: un turno de 22:00 AR del 30/09 caía en el mes 10 (y el 31/12 en el año siguiente),
 * así que `gestionarVacantes` y el aviso de modificación <12 h leían un documento que no existe.
 *
 * Uso (desde la raíz, con `npm run build` hecho en apps/functions):
 *   node scripts/eval-plan-key-tz.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '..', 'apps', 'functions', 'package.json'));
const { arPlanificacionEstadoKey, arYearMonth } = requireFn('./lib/common/arClock.js');

const ar = (ymd, hm) => Date.parse(`${ymd}T${hm}:00-03:00`);

let passed = 0;
let failed = 0;
const check = (label, got, want) => {
  if (got === want) {
    passed++;
    return;
  }
  failed++;
  console.error(`  ✗ ${label}: got ${got} want ${want}`);
};

const CASES = [
  // [etiqueta, fecha AR, hora AR, clave esperada]
  ['fin de mes 22:00 AR (01:00 UTC del 1/10)', '2026-09-30', '22:00', 'obj1_2026_9'],
  ['fin de mes 23:59 AR', '2026-09-30', '23:59', 'obj1_2026_9'],
  ['fin de año 22:00 AR (01:00 UTC del 1/1)', '2026-12-31', '22:00', 'obj1_2026_12'],
  ['inicio de mes 00:30 AR (03:30 UTC)', '2026-10-01', '00:30', 'obj1_2026_10'],
  ['medio de mes 07:00 AR', '2026-09-15', '07:00', 'obj1_2026_9'],
  ['noche que cruza a UTC del día siguiente', '2026-02-28', '21:15', 'obj1_2026_2'],
];

for (const tz of ['UTC', 'America/Argentina/Buenos_Aires', 'Asia/Tokyo']) {
  process.env.TZ = tz;
  console.log(`TZ=${tz}`);
  for (const [label, ymd, hm, want] of CASES) {
    check(`${label} [${tz}]`, arPlanificacionEstadoKey('obj1', ar(ymd, hm)), want);
  }
  const ym = arYearMonth(ar('2026-09-30', '22:00'));
  check(`arYearMonth 30/09 22:00 [${tz}]`, `${ym.year}-${ym.month}`, '2026-9');
}

// El bug original: `new Date(ms).getFullYear()/getMonth()` con el proceso en UTC.
process.env.TZ = 'UTC';
{
  const ms = ar('2026-09-30', '22:00');
  const d = new Date(ms);
  check(
    'reproduce el bug viejo en UTC',
    `obj1_${d.getFullYear()}_${d.getMonth() + 1}`,
    'obj1_2026_10',
  );
}

console.log(`\n${failed === 0 ? '✓' : '✗'} clave planificacion_estados AR: ${passed} ok, ${failed} fallas`);
process.exit(failed === 0 ? 0 : 1);
