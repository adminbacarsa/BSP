/**
 * Lista licencias marcadas TARGET / «Cubierto split» cuyo par Ext/Adel no existe.
 * No escribe. Mauro decide.
 *
 *   node scripts/fix-target-sin-patas.mjs --empresa bacarsa
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : '';

if (!empresaId) {
  console.error('Falta --empresa X');
  process.exit(1);
}
if (process.argv.includes('--apply')) {
  console.error('Este script no escribe. Solo lista. Sacá --apply.');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();

function ymd(value) {
  return String(value || '').slice(0, 10);
}

function esTargetSplit(row) {
  const role = String(row.coverageSegmentRole || '').toUpperCase();
  const note = `${row.coverageNote || ''} ${row.coveredBy || ''}`;
  const tipo = String(row.coverageType || '').toLowerCase();
  if (/cubierto split/i.test(note)) return true;
  if (role !== 'TARGET') return false;
  if (tipo === 'substitute') return false;
  return tipo === 'split' || /\bext\b/i.test(note);
}

function esExtension(row) {
  const role = String(row.coverageSegmentRole || '').toUpperCase();
  if (role === 'EARLY_START') return false;
  if (role === 'EXTENSION') return true;
  return row.isExtended === true && row.isEarlyStart !== true;
}

function esAdelanto(row) {
  const role = String(row.coverageSegmentRole || '').toUpperCase();
  if (role === 'EXTENSION') return false;
  if (role === 'EARLY_START') return true;
  return row.isEarlyStart === true && row.isExtended !== true;
}

function sumaDia(ymdStr, delta) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

const snap = await db.collection('turnos').where('empresaId', '==', empresaId).select(
  'employeeId',
  'employeeName',
  'scheduleDate',
  'code',
  'objectiveId',
  'objectiveName',
  'positionName',
  'coverageSegmentRole',
  'coverageNote',
  'coveredBy',
  'coverageType',
  'coverageStatus',
  'coversDateStr',
  'coversEmployeeId',
  'coveragePackageId',
  'isExtended',
  'isEarlyStart',
  'isDeleted',
).get();

const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.isDeleted);
const targets = rows.filter(esTargetSplit);
const patas = rows.filter((r) => esExtension(r) || esAdelanto(r));

function acredita(pata, dia, titularId, packageId) {
  if (packageId && pata.coveragePackageId && pata.coveragePackageId === packageId) return true;
  if (packageId && pata.coveragePackageId && pata.coveragePackageId !== packageId) return false;
  const explicito = ymd(pata.coversDateStr);
  const diaTurno = ymd(pata.scheduleDate);
  if (explicito && explicito !== dia) return false;
  if (!explicito && diaTurno !== dia && diaTurno !== sumaDia(dia, -1) && diaTurno !== sumaDia(dia, 1)) return false;
  if (pata.coversEmployeeId && titularId && pata.coversEmployeeId !== titularId) return false;
  return true;
}

const hallazgos = [];
for (const t of targets) {
  const dia = ymd(t.scheduleDate);
  if (!dia) continue;
  const propias = patas.filter((p) => acredita(p, dia, t.employeeId, t.coveragePackageId));
  const ext = propias.filter(esExtension);
  const adel = propias.filter(esAdelanto);
  const soloExt = /extensi[oó]n sola|solo ext/i.test(`${t.coverageNote || ''} ${t.coveredBy || ''}`);
  const soloAdel = /adelanto solo|solo adel/i.test(`${t.coverageNote || ''} ${t.coveredBy || ''}`);
  const faltaExt = !soloAdel && ext.length === 0;
  const faltaAdel = !soloExt && adel.length === 0;
  if (!faltaExt && !faltaAdel) continue;
  const que = [
    faltaExt ? 'falta extensión' : '',
    faltaAdel ? 'falta adelanto' : '',
  ].filter(Boolean).join(' y ');
  hallazgos.push({
    dia,
    nombre: String(t.employeeName || t.employeeId || ''),
    code: t.code || '',
    objetivo: t.objectiveName || t.objectiveId || '',
    puesto: t.positionName || '',
    que,
    nota: String(t.coverageNote || t.coveredBy || '').slice(0, 140),
  });
}

const empIds = [...new Set(hallazgos.map((h) => h.nombre).filter((id) => id && !id.includes(' ')))];
const objIds = [...new Set(hallazgos.map((h) => h.objetivo).filter(Boolean))];
const nombreDe = new Map();
const objetivoDe = new Map();
for (let i = 0; i < empIds.length; i += 100) {
  const refs = empIds.slice(i, i + 100).map((id) => db.collection('empleados').doc(id));
  if (!refs.length) break;
  const got = await db.getAll(...refs);
  for (const doc of got) {
    if (!doc.exists) continue;
    const data = doc.data() || {};
    nombreDe.set(doc.id, String(data.name || data.nombre || doc.id));
  }
}
if (objIds.length) {
  const clients = await db.collection('clients').where('empresaId', '==', empresaId).select('name', 'nombre', 'objetivos').get();
  for (const doc of clients.docs) {
    const data = doc.data() || {};
    const cliente = String(data.name || data.nombre || '');
    for (const o of data.objetivos || []) {
      const id = String(o?.id || o?.objectiveId || '');
      if (!id || !objIds.includes(id)) continue;
      objetivoDe.set(id, `${cliente} · ${o.name || o.nombre || id}`.trim());
    }
  }
}
for (const h of hallazgos) {
  if (nombreDe.has(h.nombre)) h.nombre = nombreDe.get(h.nombre);
  if (objetivoDe.has(h.objetivo)) h.objetivo = objetivoDe.get(h.objetivo);
}

hallazgos.sort((a, b) => (a.dia + a.objetivo + a.nombre).localeCompare(b.dia + b.objetivo + b.nombre, 'es'));
console.log(`${empresaId}: ${targets.length} licencias TARGET/split, ${hallazgos.length} sin el par Ext/Adel. No se escribió nada.`);
for (const h of hallazgos) {
  const dd = `${h.dia.slice(8, 10)}/${h.dia.slice(5, 7)}/${h.dia.slice(0, 4)}`;
  console.log(`${dd} · ${h.nombre} · ${h.code} · ${h.objetivo} · ${h.puesto} · ${h.que} · ${h.nota}`);
}
