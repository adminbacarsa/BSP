/**
 * Copia de solo lectura (prod, projectId comtroldata) los 3 objetivos de octubre a pruebas_sa
 * en un emulador propio, y deja un objetivo sintético en bacarsa para las capturas.
 * No imprime nombres de personas. No escribe en producción.
 *
 *   node scripts/importar-excel/preparar-emulator.mjs
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
  { oid: 'eipPkdpurtIoAp1UpoSs' },
  { oid: '1787231046789' },
  { oid: '3vWeMDkmhcFm7RrjcBAY' },
];

const prod = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' }, 'prod'));
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
  console.log(caso.oid, 'turnos', turnos.size, 'empleados', empleados.length, 'slas', slas.size);
}

process.env.FIRESTORE_EMULATOR_HOST = FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH;
const emuApp = initializeApp({ projectId: 'comtroldata' }, 'emu');
const emu = getFirestore(emuApp);
emu.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(emuApp);

const email = 'admin@bacarsa.com.ar';
try { const prev = await auth.getUserByEmail(email); await auth.deleteUser(prev.uid); } catch { /* no estaba */ }
const user = await auth.createUser({ email, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(user.uid, { role: 'SUPERADMIN' });
await emu.collection('system_users').doc(user.uid).set({ email, role: 'SUPERADMIN', empresaId: 'bacarsa', nombre: 'Admin' });
await emu.collection('empresas').doc('bacarsa').set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });
await emu.collection('empresas').doc('pruebas_sa').set({ name: 'Pruebas SA', migracionCompleta: true }, { merge: true });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'CONFIG'];
const perms = {};
modules.forEach((m) => { perms[m] = ['read', 'create', 'update', 'delete', 'publish', 'correct']; });
await emu.collection('roles').doc('SUPERADMIN').set({ name: 'Superadmin', permissions: perms });

let batch = emu.batch();
let n = 0;
const commit = async () => { if (n) await batch.commit(); batch = emu.batch(); n = 0; };
const put = async (ref, data) => { batch.set(ref, data); n += 1; if (n >= 400) await commit(); };

for (const p of paquetes) {
  const objetivo = { ...p.objetivo, id: p.caso.oid };
  await put(emu.collection('clients').doc(`imp_${p.caso.oid}`), {
    empresaId: 'pruebas_sa',
    name: p.clientDoc.data().name || 'Cliente',
    status: 'ACTIVE',
    objetivos: [objetivo],
  });
  for (const s of p.slas) {
    await put(emu.collection('servicios_sla').doc(s.id), { ...s.data(), empresaId: 'pruebas_sa' });
  }
  for (const e of p.empleados) {
    await put(emu.collection('empleados').doc(e.id), { ...e.data(), empresaId: 'pruebas_sa' });
  }
  for (const t of p.turnos) {
    await put(emu.collection('turnos').doc(t.id), { ...t.data(), empresaId: 'pruebas_sa' });
  }
}
await commit();

const OBJ = 'obj_import_prueba';
const TADICOR = 'obj_import_tadicor';
const MATRIZ = 'obj_import_matriz';
const CLI = 'cli_import_prueba';
const turno = (code, start, end, hours) => ({ code, startTime: start, endTime: end, hours, quantity: 1 });
await emu.collection('clients').doc(CLI).set({
  empresaId: 'bacarsa',
  name: 'Cliente Prueba',
  status: 'ACTIVE',
  objetivos: [
    { id: OBJ, name: 'Objetivo Prueba', status: 'ACTIVE' },
    { id: TADICOR, name: 'Tadicor', status: 'ACTIVE' },
    { id: MATRIZ, name: 'Casa Matriz / Centro Cultural', status: 'ACTIVE' },
  ],
});
await emu.collection('servicios_sla').doc('sla_import_prueba').set({
  empresaId: 'bacarsa',
  clientId: CLI,
  objectiveId: OBJ,
  status: 'ACTIVE',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1',
    quantity: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [turno('M', '07:00', '15:00', 8), turno('T', '15:00', '23:00', 8), turno('N', '23:00', '07:00', 8), turno('D12', '07:00', '19:00', 12), turno('N12', '19:00', '07:00', 12)],
  }],
});
await emu.collection('servicios_sla').doc('sla_import_tadicor').set({
  empresaId: 'bacarsa',
  clientId: CLI,
  objectiveId: TADICOR,
  status: 'ACTIVE',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [{
    name: 'Vigilancia',
    quantity: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [turno('M', '07:00', '15:00', 8), turno('T', '15:00', '23:00', 8)],
  }],
});
await emu.collection('servicios_sla').doc('sla_import_tadicor_2').set({
  empresaId: 'bacarsa',
  clientId: CLI,
  objectiveId: TADICOR,
  status: 'ACTIVE',
  startDate: '2026-10-01',
  endDate: '2026-10-15',
  positions: [{
    name: 'Refuerzo',
    quantity: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [turno('N', '23:00', '07:00', 8)],
  }],
});
const gente = [
  ['e_perez', 'PEREZ, JUAN', '1001'],
  ['e_gomez', 'GOMEZ, ANA', '1002'],
  ['e_lopez', 'LOPEZ, MARIO', '1003'],
];
for (const [id, name, legajo] of gente) {
  await emu.collection('empleados').doc(id).set({
    empresaId: 'bacarsa', name, fileNumber: legajo, status: 'ACTIVE', preferredObjectiveId: OBJ,
  });
}
await emu.collection('turnos').doc('t_perez_1').set({
  empresaId: 'bacarsa', objectiveId: OBJ, employeeId: 'e_perez', employeeName: 'PEREZ, JUAN',
  code: 'M', positionName: 'Puesto 1', startTime: new Date('2026-10-01T10:00:00Z'), endTime: new Date('2026-10-01T18:00:00Z'), hours: 8,
});

writeFileSync(new URL('./.manifest-captura.json', import.meta.url), JSON.stringify({ objectiveId: OBJ, clientId: CLI, year: 2026, month: 10 }));
console.log('emulador listo', OBJ);
process.exit(0);
