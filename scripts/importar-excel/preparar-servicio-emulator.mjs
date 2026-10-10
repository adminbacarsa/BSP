/**
 * Solo lectura de prod. Copia a pruebas_sa del emulador (8291/9291) Corblock, Tadicor
 * y Peaje Ruta 20 (sin SLA de octubre), más un objetivo sintético para el aviso.
 * No imprime nombres de personas. No escribe en producción.
 *
 *   node scripts/importar-excel/preparar-servicio-emulator.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../apps/functions/package.json', import.meta.url)));
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const FS = '127.0.0.1:8291';
const AUTH = '127.0.0.1:9291';
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Este script lee producción primero. No lo arranques con el emulador en el entorno.');
}
const CASOS = [
  { clave: 'corblock', oid: 'eipPkdpurtIoAp1UpoSs', archivo: 'A. CORBLOCK OCTUBRE.xlsx' },
  { clave: 'tadicor', oid: 'FA0p5IQ7ythf1GYpDJ58', archivo: 'A. TADICOR OCTUBRE.xlsx' },
  { clave: 'peaje', oid: 'AUOMjDCashPHdrTBFef2', archivo: 'Casisa 1. Ruta 20 OCTUBRE.xlsx' },
];

const prod = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' }, 'prod-servicio'));
const clients = await prod.collection('clients').where('empresaId', '==', 'bacarsa').get();
const paquetes = [];
for (const caso of CASOS) {
  const clientDoc = clients.docs.find((d) => (d.data().objetivos || []).some((o) => o.id === caso.oid));
  if (!clientDoc) throw new Error(`Sin cliente para ${caso.oid}`);
  const objetivo = clientDoc.data().objetivos.find((o) => o.id === caso.oid);
  const turnos = await prod.collection('turnos').where('objectiveId', '==', caso.oid).where('startTime', '>=', new Date('2026-09-30T03:00:00Z')).where('startTime', '<', new Date('2026-11-01T03:00:00Z')).get();
  const slas = await prod.collection('servicios_sla').where('objectiveId', '==', caso.oid).get();
  const ids = new Set();
  turnos.docs.forEach((d) => { const id = String(d.data().employeeId || ''); if (id && !id.toUpperCase().startsWith('VACANTE')) ids.add(id); });
  const prefer = await prod.collection('empleados').where('preferredObjectiveId', '==', caso.oid).get();
  prefer.docs.forEach((d) => ids.add(d.id));
  const empleados = [];
  const lista = [...ids];
  for (let i = 0; i < lista.length; i += 10) {
    const s = await prod.collection('empleados').where(FieldPath.documentId(), 'in', lista.slice(i, i + 10)).get();
    empleados.push(...s.docs);
  }
  paquetes.push({ caso, clientDoc, objetivo, turnos: turnos.docs, slas: slas.docs, empleados });
  console.log(caso.clave, 'turnos', turnos.size, 'empleados', empleados.length, 'slas', slas.size);
}

process.env.FIRESTORE_EMULATOR_HOST = FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
const emuApp = initializeApp({ projectId: 'comtroldata' }, 'emu-servicio');
const emu = getFirestore(emuApp);
emu.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(emuApp);

const email = 'admin@bacarsa.com.ar';
try { const prev = await auth.getUserByEmail(email); await auth.deleteUser(prev.uid); } catch { /* no estaba */ }
const user = await auth.createUser({ email, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(user.uid, { role: 'SUPERADMIN' });
await emu.collection('system_users').doc(user.uid).set({ email, role: 'SUPERADMIN', empresaId: 'pruebas_sa', nombre: 'Admin' });
await emu.collection('empresas').doc('pruebas_sa').set({ name: 'Pruebas SA', migracionCompleta: true, status: 'ACTIVE' }, { merge: true });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'CONFIG'];
const perms = {};
modules.forEach((m) => { perms[m] = ['read', 'create', 'update', 'delete', 'publish', 'correct']; });
await emu.collection('roles').doc('SUPERADMIN').set({ name: 'Superadmin', permissions: perms });

let batch = emu.batch();
let n = 0;
const commit = async () => { if (n) await batch.commit(); batch = emu.batch(); n = 0; };
const put = async (ref, data) => { batch.set(ref, data); n += 1; if (n >= 400) await commit(); };

const manifest = { year: 2026, month: 10, casos: {} };
for (const p of paquetes) {
  const clientId = `imp_${p.caso.oid}`;
  const objetivo = { ...p.objetivo, id: p.caso.oid };
  await put(emu.collection('clients').doc(clientId), {
    empresaId: 'pruebas_sa',
    name: p.clientDoc.data().name || 'Cliente',
    status: 'ACTIVE',
    objetivos: [objetivo],
  });
  for (const s of p.slas) {
    const data = { ...s.data(), empresaId: 'pruebas_sa', clientId };
    await put(emu.collection('servicios_sla').doc(s.id), data);
  }
  for (const e of p.empleados) {
    await put(emu.collection('empleados').doc(e.id), { ...e.data(), empresaId: 'pruebas_sa' });
  }
  for (const t of p.turnos) {
    await put(emu.collection('turnos').doc(t.id), { ...t.data(), empresaId: 'pruebas_sa' });
  }
  manifest.casos[p.caso.clave] = { objectiveId: p.caso.oid, clientId, archivo: p.caso.archivo, nombre: String(p.objetivo.name || p.caso.clave) };
}

const avisoObj = 'obj_servicio_aviso';
const avisoCli = 'cli_servicio_aviso';
await put(emu.collection('clients').doc(avisoCli), {
  empresaId: 'pruebas_sa',
  name: 'Cliente Aviso',
  status: 'ACTIVE',
  objetivos: [{ id: avisoObj, name: 'Objetivo Aviso', status: 'ACTIVE' }],
});
await put(emu.collection('servicios_sla').doc('sla_servicio_aviso'), {
  empresaId: 'pruebas_sa',
  clientId: avisoCli,
  clientName: 'Cliente Aviso',
  objectiveId: avisoObj,
  objectiveName: 'Objetivo Aviso',
  status: 'active',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [{
    id: 'p1',
    name: 'Puesto 1',
    quantity: 1,
    coverageType: 'custom',
    status: 'ACTIVE',
    activeDays: ['L', 'M', 'X', 'J', 'V'],
    allowedShiftTypes: [{ code: 'M', name: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1, days: ['L', 'M', 'X', 'J', 'V'] }],
  }],
});
await put(emu.collection('empleados').doc('e_aviso_perez'), {
  empresaId: 'pruebas_sa', name: 'PEREZ, JUAN', fileNumber: '1001', status: 'ACTIVE', preferredObjectiveId: avisoObj,
});
await commit();
manifest.casos.aviso = { objectiveId: avisoObj, clientId: avisoCli, archivo: '', nombre: 'Objetivo Aviso' };
writeFileSync(new URL('./.manifest-servicio.json', import.meta.url), JSON.stringify(manifest, null, 2));
console.log('emulador listo', Object.keys(manifest.casos).join(', '));
process.exit(0);
