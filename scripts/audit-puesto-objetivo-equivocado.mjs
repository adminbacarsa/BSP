/**
 * Turnos cuyo puesto no está en el SLA de su objetivo, pero sí en otro del mismo grupo.
 * SOLO LISTA. No escribe.
 *
 *   node scripts/audit-puesto-objetivo-equivocado.mjs --empresa pruebas_sa --desde 2026-10-01 --hasta 2026-10-31
 *
 * Misma regla que turnoPuestoDeOtroObjetivoDelGrupo (puestoObjetivoGrupo.ts).
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const args = process.argv.slice(2);
const leer = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
};
const EMPRESA = leer('--empresa', 'pruebas_sa');
const DESDE = leer('--desde', '2026-10-01');
const HASTA = leer('--hasta', '2026-10-31');

if (args.includes('--apply') || args.includes('--allow-prod')) {
  console.log('Este script no escribe. Se ignora --apply / --allow-prod.');
}

function norm(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');
}
function esPuestoReal(name) {
  const n = norm(name);
  return n.length > 0 && n !== 'general';
}
function ymd(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Cordoba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(v.toDate());
  }
  return '';
}
function puestosDeSla(sla) {
  const raw = sla.positions;
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  const out = [];
  for (const pos of list) {
    if (!pos || typeof pos !== 'object') continue;
    const st = String(pos.status || 'ACTIVE').toUpperCase();
    if ((st === 'INACTIVE' || st === 'INACTIVO') && !pos.inactiveFrom) continue;
    const name = pos.name || pos.positionName;
    if (esPuestoReal(name)) out.push(String(name));
  }
  return out;
}
function tiene(puestos, name) {
  const n = norm(name);
  return puestos.some((p) => norm(p) === n);
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
const db = admin.firestore();

const clientes = await db.collection('clients').where('empresaId', '==', EMPRESA).get();
const nombreObj = new Map();
for (const d of clientes.docs) {
  for (const o of d.data().objetivos || []) {
    const id = String(o.id || o.name || '');
    if (id) nombreObj.set(id, o.name || id);
  }
}
const gruposSnap = await db.collection('grupos_objetivos').where('empresaId', '==', EMPRESA).get();
const grupos = gruposSnap.docs.map((d) => {
  const data = d.data();
  return {
    id: d.id,
    nombre: data.nombre || d.id,
    objectiveIds: (data.objectiveIds || []).map(String),
  };
});

const slas = await db.collection('servicios_sla').where('empresaId', '==', EMPRESA).get();
const puestosPorObjetivo = new Map();
let slasMes = 0;
for (const d of slas.docs) {
  const data = d.data();
  const st = String(data.status || '').toUpperCase();
  if (st === 'INACTIVE' || st === 'INACTIVO' || st === 'DELETED') continue;
  const ini = ymd(data.startDate) || '0000-01-01';
  const fin = ymd(data.endDate) || '9999-12-31';
  if (ini > HASTA || fin < DESDE) continue;
  const objId = String(data.objectiveId || '');
  if (!objId) continue;
  slasMes += 1;
  const prev = puestosPorObjetivo.get(objId) || [];
  puestosPorObjetivo.set(objId, prev.concat(puestosDeSla(data)));
}

console.log(`empresa ${EMPRESA} · ${DESDE} → ${HASTA}`);
console.log(`objetivos en clientes: ${nombreObj.size} · grupos: ${grupos.length} · SLA del período: ${slasMes}`);
for (const g of grupos) {
  console.log(`  grupo ${g.nombre}: ${g.objectiveIds.map((id) => nombreObj.get(id) || id).join(' · ')}`);
}

let turnos = [];
try {
  const snap = await db.collection('turnos')
    .where('empresaId', '==', EMPRESA)
    .where('scheduleDate', '>=', DESDE)
    .where('scheduleDate', '<=', HASTA)
    .get();
  turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`turnos por scheduleDate: ${turnos.length}`);
} catch (e) {
  console.log(`turnos scheduleDate no consultable (${e.message}). Pruebo startTime.`);
  const desdeTs = admin.firestore.Timestamp.fromDate(new Date(`${DESDE}T00:00:00-03:00`));
  const hastaTs = admin.firestore.Timestamp.fromDate(new Date(`${HASTA}T23:59:59-03:00`));
  const snap = await db.collection('turnos')
    .where('empresaId', '==', EMPRESA)
    .where('startTime', '>=', desdeTs)
    .where('startTime', '<=', hastaTs)
    .get();
  turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`turnos por startTime: ${turnos.length}`);
}

const hallazgos = [];
for (const t of turnos) {
  if (t.isDeleted === true) continue;
  const fecha = String(t.scheduleDate || '').slice(0, 10);
  if (fecha < DESDE || fecha > HASTA) continue;
  if (!esPuestoReal(t.positionName)) continue;
  const objId = String(t.objectiveId || '');
  const grupo = grupos.find((g) => g.objectiveIds.includes(objId));
  if (!grupo) continue;
  const propios = puestosPorObjetivo.get(objId) || [];
  if (tiene(propios, t.positionName)) continue;
  const otros = grupo.objectiveIds
    .filter((id) => id !== objId)
    .filter((id) => tiene(puestosPorObjetivo.get(id) || [], t.positionName));
  if (!otros.length) continue;
  hallazgos.push({
    id: t.id,
    fecha,
    nombre: t.employeeName || t.employeeId || '',
    code: String(t.code || t.type || ''),
    puesto: String(t.positionName),
    objetivo: nombreObj.get(objId) || objId,
    objectiveId: objId,
    otros: otros.map((id) => `${nombreObj.get(id) || id} (${id})`).join(' · '),
    grupo: grupo.nombre,
  });
}

hallazgos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
console.log(`puestos en otro objetivo del grupo: ${hallazgos.length}`);
for (const h of hallazgos) {
  console.log(`${h.fecha} · ${h.nombre} · ${h.code} · ${h.puesto} · está en ${h.objetivo} (${h.objectiveId}) · el puesto está en ${h.otros} · grupo ${h.grupo} · ${h.id}`);
}
