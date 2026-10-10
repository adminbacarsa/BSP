#!/usr/bin/env node
/**
 * Copia sintética del día 1 de Obrador para la sobrecobertura (emulador aislado).
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/seed-sobrecobertura-emu.mjs
 * Dos puestos de 24 h × 1 pax, Rondín y Encargada, el día 1 con 6 M / 3 T / 4 N
 * y dos turnos sin puesto. El día 2 tiene un juego M+T+N en cada puesto para Liberar.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8291';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9291';
const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(fsHost)) throw new Error('Solo emulador local');
for (const port of ['8080', '9099', '3001']) {
  if (fsHost.endsWith(`:${port}`) || authHost.endsWith(`:${port}`)) throw new Error(`Puerto de lab ${port}: no usar`);
}

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();
const auth = getAuth();
const empresaId = 'bacarsa';
const now = Timestamp.now();
const clientId = 'cli_sobrecob';
const objectiveId = 'obj_sobrecob';

const EMAIL = 'admin@bacarsa.com.ar';
try { await auth.deleteUser((await auth.getUserByEmail(EMAIL)).uid); } catch { /* no existe */ }
const u = await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(u.uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(u.uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'ANALYSIS', 'ASSISTANT', 'CONFIG'];
await db.collection('roles').doc('SUPERADMIN').set({
  name: 'Superadmin',
  permissions: Object.fromEntries(modules.map((m) => [m, ['read', 'create', 'update', 'delete', 'publish', 'correct', 'assign_ft']])),
}, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

await db.collection('clients').doc(clientId).set({
  name: 'Cliente Sintético',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [{ id: objectiveId, name: 'Obrador Sintético', active: true, status: 'ACTIVE', lat: -31.42, lng: -64.18 }],
  createdAt: now,
});

const banda = (code, start, end) => ({ code, startTime: start, endTime: end, hours: 8, quantity: 1 });
const puesto24 = (name) => ({
  name,
  positionName: name,
  quantity: 1,
  coverageType: '24hs',
  activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
  allowedShiftTypes: [banda('M', '07:00', '15:00'), banda('T', '15:00', '23:00'), banda('N', '23:00', '07:00')],
});

const viejos = await db.collection('servicios_sla').where('objectiveId', '==', objectiveId).get();
for (const d of viejos.docs) await d.ref.delete();
await db.collection('servicios_sla').doc('sla_sobrecob').set({
  empresaId,
  clientId,
  clientName: 'Cliente Sintético',
  objectiveId,
  objectiveName: 'Obrador Sintético',
  status: 'active',
  active: true,
  closed: false,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [
    puesto24('Puesto 1'),
    puesto24('Puesto 2'),
    {
      name: 'P Rondín',
      positionName: 'P Rondín',
      quantity: 1,
      coverageType: 'custom',
      activeDays: ['L', 'M', 'X', 'J', 'V'],
      allowedShiftTypes: [{ code: 'RO', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 }],
    },
    {
      name: 'P Encargada',
      positionName: 'P Encargada',
      quantity: 1,
      coverageType: 'custom',
      activeDays: ['L', 'M', 'X', 'J', 'V'],
      allowedShiftTypes: [{ code: 'EN', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 }],
    },
  ],
  createdAt: now,
});

const turnos = await db.collection('turnos').where('objectiveId', '==', objectiveId).get();
for (const d of turnos.docs) await d.ref.delete();
const previos = await db.collection('empleados').where('preferredObjectiveId', '==', objectiveId).get();
for (const d of previos.docs) await d.ref.delete();

const gente = [
  ['empRomero', 'ROMERO', 'JUAN'],
  ['empGoyochea', 'GOYOCHEA', 'ANA'],
  ['empVidela', 'VIDELA', 'LUIS'],
  ['empLopez', 'LOPEZ', 'CARLOS'],
  ['empAraya', 'ARAYA', 'PEDRO'],
  ['empDiaz', 'DIAZ', 'MARIO'],
  ['empBordino', 'BORDINO', 'RAUL'],
  ['empMorales', 'MORALES', 'DIEGO'],
  ['empLucero', 'LUCERO ROMERO', 'Jorge'],
  ['empKasianchuk', 'KASIANCHUK', 'IVAN'],
  ['empMartinez', 'MARTINEZ', 'PABLO'],
  ['empPalacios', 'PALACIOS', 'SERGIO'],
  ['empBarrios', 'BARRIOS', 'HUGO'],
  ['empCoronel', 'CORONEL', 'NICO'],
  ['empRegalo', 'REGALO', 'TOMAS'],
];
for (const [id, last, first] of gente) {
  await db.collection('empleados').doc(id).set({
    empresaId,
    name: `${last}, ${first}`,
    lastName: last,
    firstName: first,
    status: 'activo',
    category: 'Vigilador',
    role: 'employee',
    preferredObjectiveId: objectiveId,
    preferredClientId: clientId,
    createdAt: now,
  });
}

const HORAS = {
  M: ['07:00', '15:00', 0],
  T: ['15:00', '23:00', 0],
  N: ['23:00', '07:00', 1],
  RO: ['07:00', '15:00', 0],
  EN: ['07:00', '15:00', 0],
};

function armar(empId, date, code, positionName) {
  const [ini, fin, cruza] = HORAS[code];
  const start = new Date(`${date}T${ini}:00-03:00`);
  const finDia = cruza
    ? new Date(new Date(`${date}T12:00:00-03:00`).getTime() + 86400000).toISOString().slice(0, 10)
    : date;
  const end = new Date(`${finDia}T${fin}:00-03:00`);
  const doc = {
    empresaId,
    clientId,
    objectiveId,
    objectiveName: 'Obrador Sintético',
    employeeId: empId,
    employeeName: gente.find((g) => g[0] === empId)?.[1] || empId,
    code,
    name: code,
    hours: 8,
    isFranco: false,
    startTime: Timestamp.fromDate(start),
    endTime: Timestamp.fromDate(end),
    draft: false,
    isAbsent: false,
    createdAt: now,
  };
  if (positionName) doc.positionName = positionName;
  return doc;
}

const dia1 = [
  ['empRomero', 'RO', 'P Rondín'],
  ['empGoyochea', 'EN', 'P Encargada'],
  ['empVidela', 'M', 'Puesto 1'],
  ['empLopez', 'M', 'Puesto 1'],
  ['empAraya', 'M', 'Puesto 2'],
  ['empDiaz', 'M', 'Puesto 2'],
  ['empBordino', 'T', 'Puesto 1'],
  ['empMorales', 'T', 'Puesto 2'],
  ['empLucero', 'T', 'Puesto 2'],
  ['empKasianchuk', 'N', 'Puesto 1'],
  ['empMartinez', 'N', 'Puesto 1'],
  ['empPalacios', 'N', 'Puesto 2'],
  ['empBarrios', 'N', 'Puesto 2'],
  ['empCoronel', 'M', ''],
  ['empRegalo', 'T', ''],
];
const dia2 = [
  ['empVidela', 'M', 'Puesto 1'],
  ['empBordino', 'T', 'Puesto 1'],
  ['empKasianchuk', 'N', 'Puesto 1'],
  ['empLopez', 'M', 'Puesto 2'],
  ['empMartinez', 'T', 'Puesto 2'],
  ['empBarrios', 'N', 'Puesto 2'],
];

const batch = db.batch();
for (const [empId, code, pos] of dia1) {
  batch.set(db.collection('turnos').doc(`${empId}_2026-10-01`), armar(empId, '2026-10-01', code, pos));
}
for (const [empId, code, pos] of dia2) {
  batch.set(db.collection('turnos').doc(`${empId}_2026-10-02`), armar(empId, '2026-10-02', code, pos));
}
await batch.commit();

writeFileSync(new URL('./alta-servicio/.manifest-sobrecob.json', import.meta.url), JSON.stringify({
  clientId, objectiveId, year: 2026, month: 10,
}, null, 2));
console.log('✓ seed sobrecobertura: Obrador Sintético, octubre, día 1 y día 2');
process.exit(0);
