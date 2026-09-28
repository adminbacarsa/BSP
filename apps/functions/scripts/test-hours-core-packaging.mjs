/**
 * Smoke de empaquetado: @cosp/hours-core se resuelve DENTRO de apps/functions
 * (vendor), sin subir a ../../packages. Correr después de sync + build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const functionsRoot = path.resolve(here, '..');
const vendorRoot = path.join(functionsRoot, 'vendor', 'hours-core');
const vendorPkgPath = path.join(vendorRoot, 'package.json');
const distIndex = path.join(vendorRoot, 'dist', 'index.js');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(vendorPkgPath)) {
  fail('Falta apps/functions/vendor/hours-core. Corré: node scripts/sync-hours-core-to-functions.mjs');
}

const vendorPkg = JSON.parse(fs.readFileSync(vendorPkgPath, 'utf8'));
if (vendorPkg.main !== './dist/index.js') {
  fail(`package.json vendor main=${vendorPkg.main} (esperado ./dist/index.js)`);
}
if (!fs.existsSync(distIndex)) {
  fail('Falta vendor/hours-core/dist/index.js');
}

const distReal = fs.realpathSync(distIndex);
const vendorReal = fs.realpathSync(vendorRoot);
const normDist = distReal.replace(/\\/g, '/').toLowerCase();
const normVendor = vendorReal.replace(/\\/g, '/').toLowerCase();
if (!normDist.startsWith(normVendor)) {
  fail(`dist fuera del vendor: ${distReal}`);
}
if (!normDist.includes('/apps/functions/vendor/hours-core/')) {
  fail(`dist no está bajo apps/functions/vendor: ${distReal}`);
}
if (normDist.includes('/packages/hours-core/')) {
  fail(`el require resolvió packages/hours-core, no el vendor: ${distReal}`);
}

const requireFromFunctions = createRequire(path.join(functionsRoot, 'package.json'));
let resolved;
try {
  resolved = requireFromFunctions.resolve('@cosp/hours-core');
} catch {
  resolved = requireFromFunctions.resolve('./vendor/hours-core');
}
const resolvedReal = fs.realpathSync(resolved);
const normResolved = resolvedReal.replace(/\\/g, '/').toLowerCase();
if (!normResolved.startsWith(normVendor)) {
  fail(`Node resolvió @cosp/hours-core fuera del vendor: ${resolvedReal}`);
}

const mod = requireFromFunctions(resolvedReal.endsWith('.js') ? resolved : './vendor/hours-core');
if (typeof mod.calcTurnoHoursContrib !== 'function') {
  fail('calcTurnoHoursContrib no está exportado desde el vendor');
}

const start = new Date('2026-05-10T07:00:00-03:00');
const end = new Date('2026-05-10T15:00:00-03:00');
const sec = (d) => ({ seconds: Math.floor(d.getTime() / 1000) });
const contrib = mod.calcTurnoHoursContrib({
  employeeId: 'emp-smoke',
  isCompleted: true,
  code: 'M',
  status: 'COMPLETED',
  startTime: sec(start),
  endTime: sec(end),
  realStartTime: sec(start),
  realEndTime: sec(end),
}, new Set());

if (!contrib || Math.abs(contrib.hsReales - 8) > 0.02 || Math.abs(contrib.hsTeoricas - 8) > 0.02) {
  fail(`fixture inesperado: ${JSON.stringify(contrib)}`);
}

console.log(`packaging smoke OK hsReales=${contrib.hsReales} hsTeoricas=${contrib.hsTeoricas} monthKey=${contrib.monthKey}`);
console.log(`resuelto: ${resolvedReal}`);
