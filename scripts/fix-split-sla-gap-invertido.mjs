/**
 * Lista paquetes sla_gap_* con tramo de 0 h o rol invertido (Ext/Adel al revés).
 * No escribe. Mauro decide qué corregir.
 *
 *   node scripts/fix-split-sla-gap-invertido.mjs
 *   node scripts/fix-split-sla-gap-invertido.mjs --empresa pruebas_sa
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : 'pruebas_sa';

if (process.argv.includes('--apply')) {
  console.error('Este script no escribe. Solo lista los paquetes para que decidas.');
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();

function pad(n) {
  return String(n).padStart(2, '0');
}

function hmDe(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return `${pad(m[1])}:${m[2]}`;
  }
  let ms = null;
  if (typeof value.toDate === 'function') ms = value.toDate().getTime();
  else if (typeof value.seconds === 'number') ms = value.seconds * 1000;
  else if (value instanceof Date) ms = value.getTime();
  if (ms == null) return null;
  const ar = new Date(ms - 3 * 60 * 60 * 1000);
  return `${pad(ar.getUTCHours())}:${pad(ar.getUTCMinutes())}`;
}

function minDe(hm) {
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function rolDe(shift) {
  const role = String(shift.coverageSegmentRole || '').toUpperCase();
  if (role === 'EXTENSION' || role === 'EARLY_START') return role;
  if (shift.isExtended && !shift.isEarlyStart) return 'EXTENSION';
  if (shift.isEarlyStart) return 'EARLY_START';
  return '';
}

function cerca(a, b, tol = 30) {
  if (a == null || b == null) return false;
  const d = Math.abs(a - b);
  return d <= tol || Math.abs(d - 24 * 60) <= tol;
}

function hallazgo(shift) {
  const from = hmDe(shift.segmentFromTime);
  const to = hmDe(shift.segmentToTime);
  const ini = hmDe(shift.startTime);
  const fin = hmDe(shift.endTime);
  const motivos = [];
  if (from && to && from === to) motivos.push('tramo de 0 h');
  const role = rolDe(shift);
  const iniMin = minDe(ini);
  const finMin = minDe(fin);
  const fromMin = minDe(from);
  const toMin = minDe(to);
  if (role === 'EXTENSION' && cerca(iniMin, toMin) && !cerca(finMin, fromMin)) {
    motivos.push('rol invertido: arranca al cierre y está marcado como extensión');
  }
  if (role === 'EARLY_START' && toMin != null && iniMin != null) {
    let delta = iniMin - toMin;
    if (delta < -12 * 60) delta += 24 * 60;
    if (delta < 0 || delta > 30) motivos.push('rol invertido: no arranca al cierre del tramo');
  }
  return motivos;
}

console.log(`SOLO LECTURA · empresa ${empresaId} · paquetes sla_gap_*`);
const snap = await db.collection('turnos').where('empresaId', '==', empresaId).get();
const porPaquete = new Map();
for (const doc of snap.docs) {
  const data = doc.data() || {};
  const pkg = String(data.coveragePackageId || '');
  if (!pkg.startsWith('sla_gap_')) continue;
  const motivos = hallazgo(data);
  if (!motivos.length) continue;
  if (!porPaquete.has(pkg)) porPaquete.set(pkg, []);
  porPaquete.get(pkg).push({ id: doc.id, data, motivos });
}

if (porPaquete.size === 0) {
  console.log('Sin paquetes sla_gap con tramo de 0 h o rol invertido.');
  process.exit(0);
}

console.log(`${porPaquete.size} paquete(s):`);
for (const [pkg, rows] of porPaquete) {
  console.log(`\n${pkg}`);
  for (const row of rows) {
    const d = row.data;
    const nombre = String(d.employeeName || d.name || row.id);
    const cuando = hmDe(d.startTime) && hmDe(d.endTime) ? `${hmDe(d.startTime)}–${hmDe(d.endTime)}` : 'sin horario';
    const segA = hmDe(d.segmentFromTime) || '—';
    const segB = hmDe(d.segmentToTime) || '—';
    console.log(`  ${nombre} · ${d.positionName || '—'} ${d.code || ''} · ${rolDe(d) || 'sin rol'} · tramo ${segA}–${segB} · turno ${cuando} · ${row.motivos.join(' · ')}`);
  }
}
