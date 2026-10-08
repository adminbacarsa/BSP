/**
 * Copia SOLO LECTURA de prod (comtroldata) el objetivo Obrador Malagueño de pruebas_sa
 * a un emulador propio (8190/9199). No escribe en producción.
 *
 *   FIRESTORE ya en 127.0.0.1:8190 y Auth en 127.0.0.1:9199
 *   node scripts/copiar-obrador-emulator.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const EMU_FS = '127.0.0.1:8190';
const EMU_AUTH = '127.0.0.1:9199';
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('No arranques este script con el emulador en el entorno: primero lee prod.');
}

const prodApp = initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' }, 'prod');
const prod = getFirestore(prodApp);

function texto(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const clientsSnap = await prod.collection('clients').where('empresaId', '==', 'pruebas_sa').get();
let client = null;
let objetivo = null;
for (const doc of clientsSnap.docs) {
  const data = doc.data();
  const objetivos = Array.isArray(data.objetivos) ? data.objetivos : [];
  const hit = objetivos.find((o) => texto(o?.name || o?.nombre).includes('malaguen'));
  if (hit) {
    client = { id: doc.id, ...data };
    objetivo = { ...hit, id: hit.id || hit.objectiveId };
    break;
  }
}
if (!objetivo?.id) {
  throw new Error('No encontré Obrador Malagueño en clients de pruebas_sa');
}
const objectiveId = String(objetivo.id);
const clientId = client.id;
console.log('objetivo', objectiveId, objetivo.name || objetivo.nombre, 'cliente', clientId, client.name || client.nombre);

const empresa = await prod.collection('empresas').doc('pruebas_sa').get();
const slas = await prod.collection('servicios_sla').where('empresaId', '==', 'pruebas_sa').where('objectiveId', '==', objectiveId).get();
const empleados = await prod.collection('empleados').where('empresaId', '==', 'pruebas_sa').get();
const turnos = await prod.collection('turnos').where('empresaId', '==', 'pruebas_sa').where('objectiveId', '==', objectiveId).get();
const ausencias = await prod.collection('ausencias').where('empresaId', '==', 'pruebas_sa').get();

const desde = '2026-09-28';
const hasta = '2026-11-02';
function ymd(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(d);
  }
  if (typeof v.seconds === 'number') return ymd(new Date(v.seconds * 1000).toISOString());
  return '';
}
const turnosOct = turnos.docs.filter((d) => {
  const dia = ymd(d.data().startTime);
  return dia >= desde && dia < hasta;
});
const empIds = new Set();
for (const d of turnosOct) {
  const id = d.data().employeeId;
  if (id) empIds.add(String(id));
}
const empleadosObj = empleados.docs.filter((d) => empIds.has(d.id) || texto(d.data().name || d.data().nombre).includes('martinez walter') || texto(d.data().name || d.data().nombre).includes('bordino') || texto(d.data().name || d.data().nombre).includes('barrios') || texto(d.data().name || d.data().nombre).includes('morales') || texto(d.data().name || d.data().nombre).includes('herrera'));
for (const d of empleadosObj) empIds.add(d.id);
const ausenciasOct = ausencias.docs.filter((d) => {
  const data = d.data();
  if (!empIds.has(String(data.employeeId || ''))) return false;
  const ini = ymd(data.startDate || data.fechaDesde || data.start);
  const fin = ymd(data.endDate || data.fechaHasta || data.end) || ini;
  return fin >= desde && ini < hasta;
});

const estados = await prod.collection('planificacion_estados').where('empresaId', '==', 'pruebas_sa').where('objectiveId', '==', objectiveId).get().catch(async () => {
  const all = await prod.collection('planificacion_estados').where('empresaId', '==', 'pruebas_sa').get();
  return { docs: all.docs.filter((d) => String(d.data().objectiveId || d.id).includes(objectiveId) || d.id.includes(objectiveId)) };
});

console.log({
  slas: slas.size,
  empleados: empleadosObj.length,
  turnos: turnosOct.length,
  ausencias: ausenciasOct.length,
  estados: estados.docs.length,
});

const bolsa = {
  empresa: empresa.exists ? empresa.data() : { name: 'Pruebas SA' },
  client: { id: clientId, data: client },
  objetivo,
  slas: slas.docs.map((d) => ({ id: d.id, data: d.data() })),
  empleados: empleadosObj.map((d) => ({ id: d.id, data: d.data() })),
  turnos: turnosOct.map((d) => ({ id: d.id, data: d.data() })),
  ausencias: ausenciasOct.map((d) => ({ id: d.id, data: d.data() })),
  estados: estados.docs.map((d) => ({ id: d.id, data: d.data() })),
};
const serial = bolsa;

process.env.FIRESTORE_EMULATOR_HOST = EMU_FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = EMU_AUTH;
if (!process.env.FIRESTORE_EMULATOR_HOST.includes('8190')) throw new Error('emulador mal apuntado');

const emuApp = initializeApp({ projectId: 'comtroldata' }, 'emu');
const emu = getFirestore(emuApp);
emu.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(emuApp);

const email = 'admin@bacarsa.com.ar';
try {
  const prev = await auth.getUserByEmail(email);
  await auth.deleteUser(prev.uid);
} catch (e) {
  if (e.code !== 'auth/user-not-found') throw e;
}
const user = await auth.createUser({ email, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(user.uid, { role: 'SUPERADMIN' });
await emu.collection('system_users').doc(user.uid).set({
  email, role: 'SUPERADMIN', empresaId: 'pruebas_sa', nombre: 'Admin', allEmpresas: true,
});
await emu.collection('empresas').doc('pruebas_sa').set({ ...(serial.empresa || {}), name: serial.empresa?.name || 'Pruebas SA' });
await emu.collection('clients').doc(clientId).set(serial.client.data);
const batchWrite = async (col, rows) => {
  for (let i = 0; i < rows.length; i += 400) {
    const batch = emu.batch();
    for (const row of rows.slice(i, i + 400)) batch.set(emu.collection(col).doc(row.id), row.data);
    await batch.commit();
  }
};
await batchWrite('servicios_sla', serial.slas);
await batchWrite('empleados', serial.empleados);
const idsTurno = new Set(serial.turnos.map((t) => t.id));
const viejos = await emu.collection('turnos').where('objectiveId', '==', objectiveId).get();
for (let i = 0; i < viejos.docs.length; i += 400) {
  const batch = emu.batch();
  let n = 0;
  for (const d of viejos.docs.slice(i, i + 400)) {
    if (idsTurno.has(d.id)) continue;
    batch.delete(d.ref);
    n++;
  }
  if (n) await batch.commit();
}
await batchWrite('turnos', serial.turnos);
await batchWrite('ausencias', serial.ausencias);
await batchWrite('planificacion_estados', serial.estados);

const nombres = {};
for (const e of serial.empleados) {
  const n = texto(e.data.name || e.data.nombre || '');
  if (n.includes('martinez') && n.includes('walter')) nombres.martinez = e.id;
  if (n.includes('bordino')) nombres.bordino = e.id;
  if (n.includes('barrios')) nombres.barrios = e.id;
  if (n.includes('morales')) nombres.morales = e.id;
  if (n.includes('herrera')) nombres.herrera = e.id;
}
const manifest = {
  objectiveId, clientId, empresaId: 'pruebas_sa',
  objetivo: objetivo.name || objetivo.nombre,
  ...nombres,
};
writeFileSync('scripts/.obrador-manifest.json', JSON.stringify(manifest, null, 2));
console.log(manifest);
console.log('copiado al emulador', EMU_FS);
