#!/usr/bin/env node
/**
 * Datos del modo rápido de la grilla (solo emulador aislado 8190/9199).
 * Noviembre 2026 vacío: «Peaje Rápido» con SLA (M/T/N × 3) y 10 guardias, y «Depósito Sin Servicio»
 * sin SLA con 3 guardias. Crea también el admin del seed (mismo usuario que `npm run seed`).
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 node scripts/seed-captura-modo-rapido.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8190';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Solo emulador local');
if (/:(8080)$/.test(process.env.FIRESTORE_EMULATOR_HOST) || /:(9099)$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  throw new Error('No usar el emulador del lab (8080/9099): este seed va al aislado 8190/9199');
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

const EMAIL = 'admin@bacarsa.com.ar';
try { await auth.deleteUser((await auth.getUserByEmail(EMAIL)).uid); } catch { /* no existe */ }
const u = await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(u.uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(u.uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'ANALYSIS', 'ASSISTANT', 'CONFIG'];
await db.collection('roles').doc('SUPERADMIN').set({
  name: 'Superadmin',
  permissions: Object.fromEntries(modules.map((m) => [m, ['read', 'create', 'update', 'delete']])),
}, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });
await db.collection('system_users').doc('sup_mq').set({
  email: 'supervisor.mq@bacarsa.com.ar', role: 'Supervisor', empresaId, firstName: 'Sara', lastName: 'Supervisora',
  displayName: 'Sara Supervisora', supervisorPin: '1234',
});

const clientId = 'cli_mq';
const conSla = { id: 'obj_mq_sla', name: 'Peaje Rápido' };
const sinSla = { id: 'obj_mq_sin', name: 'Depósito Sin Servicio' };

for (const col of ['turnos', 'ausencias']) {
  for (const obj of [conSla.id, sinSla.id]) {
    const snap = await db.collection(col).where('objectiveId', '==', obj).get();
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
}
const viejos = await db.collection('servicios_sla').where('objectiveId', '==', sinSla.id).get();
for (const d of viejos.docs) await d.ref.delete();

await db.collection('clients').doc(clientId).set({
  name: 'Autopista Rápida',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [
    { id: conSla.id, name: conSla.name, active: true, status: 'ACTIVE', lat: -31.42, lng: -64.18 },
    { id: sinSla.id, name: sinSla.name, active: true, status: 'ACTIVE', lat: -31.41, lng: -64.19 },
  ],
  createdAt: now,
});

await db.collection('servicios_sla').doc('sla_mq').set({
  empresaId,
  clientId,
  clientName: 'Autopista Rápida',
  objectiveId: conSla.id,
  objectiveName: conSla.name,
  status: 'active',
  active: true,
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  positions: [{
    name: 'Puesto 1',
    positionName: 'Puesto 1',
    quantity: 3,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 3 },
      { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 3 },
      { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 3 },
    ],
  }],
  createdAt: now,
});

const apellidos = ['ACOSTA', 'BENITEZ', 'CASTRO', 'DIAZ', 'ESCOBAR', 'FUNES', 'GOMEZ', 'HERRERA', 'IBARRA', 'JUAREZ'];
// Ids sin «_»: las claves de cambios pendientes son `${empId}_${fecha}`.
const guardias = apellidos.map((a, i) => ({ id: `mq${String(i + 1).padStart(2, '0')}`, name: `${a}, Guardia ${i + 1}`, obj: conSla.id }));
const deposito = ['KLEIN', 'LUNA', 'MOLINA'].map((a, i) => ({ id: `mqsin${i + 1}`, name: `${a}, Depósito ${i + 1}`, obj: sinSla.id }));
for (const obj of [conSla.id, sinSla.id]) {
  const previos = await db.collection('empleados').where('preferredObjectiveId', '==', obj).get();
  for (const d of previos.docs) await d.ref.delete();
}
for (const g of [...guardias, ...deposito]) {
  const aus = await db.collection('ausencias').where('employeeId', '==', g.id).get();
  for (const d of aus.docs) await d.ref.delete();
}
const topes = await db.collection('tope_autorizaciones').get();
for (const d of topes.docs) if (d.id.startsWith(`${empresaId}_`)) await d.ref.delete();

for (const g of [...guardias, ...deposito]) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  await db.collection('empleados').doc(g.id).set({
    empresaId,
    name: g.name,
    fullName: g.name,
    nombre,
    apellido,
    lastName: apellido,
    firstName: nombre,
    status: 'ACTIVE',
    modalidad: 'NOMINA',
    category: 'VIGILADOR',
    preferredObjectiveId: g.obj,
    preferredObjectiveIds: [g.obj],
    createdAt: now,
  });
}

// Octubre con un turno por guardia: la dotación del objetivo se arma también con el historial reciente.
const b = db.batch();
for (const g of [...guardias, ...deposito]) {
  const start = new Date('2026-10-31T07:00:00-03:00');
  const end = new Date('2026-10-31T15:00:00-03:00');
  b.set(db.collection('turnos').doc(`${g.id}_2026-10-31`), {
    empresaId, clientId, objectiveId: g.obj, objectiveName: g.obj === conSla.id ? conSla.name : sinSla.name,
    positionName: 'Puesto 1', employeeId: g.id, employeeName: g.name, code: 'M', name: 'M', hours: 8,
    startTime: Timestamp.fromDate(start), endTime: Timestamp.fromDate(end), draft: true, isAbsent: false, isFranco: false, createdAt: now,
  });
}
await b.commit();

console.log(`✓ seed-captura-modo-rapido: admin, ${guardias.length} guardias en ${conSla.name} (SLA), ${deposito.length} en ${sinSla.name} (sin servicio), noviembre vacío`);
process.exit(0);
