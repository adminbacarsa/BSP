/**
 * Marca leídas las notificaciones de retención cuyo turno ya cerró.
 * SOLO LECTURA por defecto.
 *
 *   node scripts/fix-retencion-notif-cerradas.mjs --empresa pruebas_sa
 *   node scripts/fix-retencion-notif-cerradas.mjs --empresa pruebas_sa --apply --allow-prod
 *
 * --apply escribe en prod. Solo con OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');
const empresaArg = process.argv.indexOf('--empresa');
const empresaId = empresaArg >= 0 ? String(process.argv[empresaArg + 1] || '').trim() : '';

if (!empresaId) {
  console.error('Hace falta --empresa');
  process.exit(1);
}
if (apply && !allowProd) {
  console.error('Para escribir hace falta --apply --allow-prod');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TIPOS = ['RETENCION_AUTO', 'RETENCION_AVISO', 'RETENCION_MANUAL'];
const MOTIVO = 'Retención terminada';

function aMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function inicioHoyAr(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return Date.parse(`${ymd}T00:00:00-03:00`);
}

function turnoMuestraTarjeta(shift, now) {
  if (!shift) return false;
  if (aMs(shift.realEndTime) > 0 || shift.isCompleted === true) return false;
  const status = String(shift.status || '').toUpperCase();
  if (status === 'COMPLETED' || status === 'FINALIZED' || status === 'FINALIZADO' || status === 'CERRADO') return false;
  if (shift.isAbsent === true || status === 'ABSENT' || status === 'AUSENTE') return false;
  if (shift.isRetention === true && shift.isPresent === true) return true;
  const end = aMs(shift.endTime);
  return shift.isPresent === true && end > 0 && now >= end;
}

const hoy = inicioHoyAr();
const ahora = Date.now();
const snap = await db.collection('user_notifications').where('type', 'in', TIPOS).get();
const shiftCache = new Map();

async function turno(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  if (shiftCache.has(key)) return shiftCache.get(key);
  const doc = await db.collection('turnos').doc(key).get();
  const row = doc.exists ? { id: doc.id, ...doc.data() } : null;
  shiftCache.set(key, row);
  return row;
}

async function deLaEmpresa(data, shift) {
  if (String(data.empresaId || '') === empresaId) return true;
  if (shift && String(shift.empresaId || '') === empresaId) return true;
  if (String(data.empresaId || '') && String(data.empresaId) !== empresaId) return false;
  const empId = String(data.employeeId || '').trim();
  if (!empId) return false;
  const emp = await db.collection('empleados').doc(empId).get();
  return emp.exists && String(emp.get('empresaId') || '') === empresaId;
}

const cerrar = [];
let ajenas = 0;
let vivas = 0;
for (const doc of snap.docs) {
  const data = doc.data();
  if (data.closedAt) continue;
  const shiftId = String(data.shiftId || data.turnoId || '').trim();
  const shift = shiftId ? await turno(shiftId) : null;
  if (!(await deLaEmpresa(data, shift))) {
    ajenas += 1;
    continue;
  }
  if (shiftId) {
    if (shift && turnoMuestraTarjeta(shift, ahora)) vivas += 1;
    else cerrar.push({ doc, motivo: shift ? 'turno cerrado' : 'sin turno', shiftId });
    continue;
  }
  const created = aMs(data.createdAt);
  if (created > 0 && created < hoy) cerrar.push({ doc, motivo: 'sin turno', shiftId: '' });
  else vivas += 1;
}

console.log(`${apply ? 'APPLY' : 'DRY'} empresa=${empresaId} candidatas=${cerrar.length} vivas=${vivas} otras_empresas=${ajenas}`);
for (const row of cerrar.slice(0, 40)) {
  const data = row.doc.data();
  console.log(`  ${row.doc.id} ${data.type} ${row.motivo} shift=${row.shiftId || '—'} emp=${data.employeeId || '—'}`);
}
if (cerrar.length > 40) console.log(`  … y ${cerrar.length - 40} más`);

if (!apply) {
  console.log('Sin --apply no se escribió nada.');
  process.exit(0);
}

let batch = db.batch();
let n = 0;
let written = 0;
for (const row of cerrar) {
  const data = row.doc.data();
  batch.update(row.doc.ref, {
    read: true,
    readAt: data.readAt || FieldValue.serverTimestamp(),
    closedAt: FieldValue.serverTimestamp(),
    closedMotivo: MOTIVO,
  });
  n += 1;
  written += 1;
  if (n >= 400) {
    await batch.commit();
    batch = db.batch();
    n = 0;
  }
}
if (n) await batch.commit();
console.log(`Cerradas ${written}`);
