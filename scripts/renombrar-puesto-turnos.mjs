/**
 * Turnos con un puesto que ya no está en el SLA de su objetivo (puesto renombrado en Servicios).
 * Si el SLA del objetivo tiene un solo puesto, propone pasar los turnos a ese nombre.
 * Sin --apply solo lista. Escribir en prod pide --apply --allow-prod.
 *
 *   node scripts/renombrar-puesto-turnos.mjs --empresa pruebas_sa --objetivos "Tegua,Moras" --desde 2026-10-01 --hasta 2026-12-31
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
const HASTA = leer('--hasta', '2026-12-31');
const FILTRO = String(leer('--objetivos', '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const APPLY = args.includes('--apply');
if (APPLY && !args.includes('--allow-prod')) {
  console.log('Escribir en prod pide --apply --allow-prod.');
  process.exit(1);
}

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function ymd(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(v.toDate());
  }
  return '';
}
function puestosDeSla(sla) {
  const raw = sla.positions;
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
  return list
    .filter((p) => p && typeof p === 'object')
    .filter((p) => !['INACTIVE', 'INACTIVO'].includes(String(p.status || 'ACTIVE').toUpperCase()) || p.inactiveFrom)
    .map((p) => String(p.name || p.positionName || '').trim())
    .filter((n) => n && norm(n) !== 'general');
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
const elegidos = [...nombreObj.entries()].filter(([, n]) => !FILTRO.length || FILTRO.some((f) => norm(n).includes(f)));
console.log(`empresa ${EMPRESA} · ${DESDE} → ${HASTA} · objetivos: ${elegidos.map(([id, n]) => `${n} (${id})`).join(' · ') || 'ninguno'}`);

const slas = await db.collection('servicios_sla').where('empresaId', '==', EMPRESA).get();
const puestosPorObjetivo = new Map();
for (const d of slas.docs) {
  const data = d.data();
  if (['INACTIVE', 'INACTIVO', 'DELETED'].includes(String(data.status || '').toUpperCase())) continue;
  const ini = ymd(data.startDate) || '0000-01-01';
  const fin = ymd(data.endDate) || '9999-12-31';
  if (ini > HASTA || fin < DESDE) continue;
  const objId = String(data.objectiveId || '');
  if (!elegidos.some(([id]) => id === objId)) continue;
  const prev = puestosPorObjetivo.get(objId) || new Set();
  for (const p of puestosDeSla(data)) prev.add(p);
  puestosPorObjetivo.set(objId, prev);
}
for (const [id, n] of elegidos) console.log(`  ${n}: puestos del SLA = ${[...(puestosPorObjetivo.get(id) || [])].join(' · ') || '(sin SLA en el período)'}`);

const snap = await db.collection('turnos')
  .where('empresaId', '==', EMPRESA)
  .where('startTime', '>=', admin.firestore.Timestamp.fromDate(new Date(`${DESDE}T00:00:00-03:00`)))
  .where('startTime', '<=', admin.firestore.Timestamp.fromDate(new Date(`${HASTA}T23:59:59-03:00`)))
  .get();

const cambios = [];
const resumen = new Map();
for (const doc of snap.docs) {
  const t = doc.data();
  if (t.isDeleted === true) continue;
  const objId = String(t.objectiveId || '');
  const puestos = puestosPorObjetivo.get(objId);
  if (!puestos || !puestos.size) continue;
  const actual = String(t.positionName || '').trim();
  if (!actual || norm(actual) === 'general' || norm(actual) === 'reten') continue;
  if ([...puestos].some((p) => norm(p) === norm(actual))) continue;
  const clave = `${nombreObj.get(objId) || objId} · «${actual}»`;
  const destino = puestos.size === 1 ? [...puestos][0] : null;
  const r = resumen.get(clave) || { n: 0, destino };
  r.n += 1;
  resumen.set(clave, r);
  if (destino) cambios.push({ ref: doc.ref, destino });
}
console.log(`turnos con puesto que no está en el SLA: ${[...resumen.values()].reduce((a, r) => a + r.n, 0)}`);
for (const [clave, r] of resumen) console.log(`  ${clave}: ${r.n} turno(s) → ${r.destino ? `«${r.destino}»` : 'el SLA tiene varios puestos: no se toca'}`);

if (!APPLY) {
  console.log(`Sin --apply: no se escribió nada. Se actualizarían ${cambios.length} turno(s).`);
  process.exit(0);
}
let hechos = 0;
for (let i = 0; i < cambios.length; i += 400) {
  const batch = db.batch();
  for (const c of cambios.slice(i, i + 400)) batch.update(c.ref, { positionName: c.destino });
  await batch.commit();
  hechos += Math.min(400, cambios.length - i);
}
console.log(`Actualizados ${hechos} turno(s).`);
