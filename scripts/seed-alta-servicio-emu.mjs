#!/usr/bin/env node
/**
 * Datos sintéticos para el alta desde padrón y «activar el mes» (emulador aislado).
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/seed-alta-servicio-emu.mjs
 * Objetivo Norte: SLA que termina el 31/10/2026. Un guardia en la dotación (SOSA) y octubre con turnos.
 * QUIROGA no existe: entra por el padrón sintético del script de captura.
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
const clientId = 'cli_alta';
const objectiveId = 'obj_alta';

const EMAIL = 'admin@bacarsa.com.ar';
try { await auth.deleteUser((await auth.getUserByEmail(EMAIL)).uid); } catch { /* no existe */ }
const u = await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(u.uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(u.uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'PLANNING_AI', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'ANALYSIS', 'ASSISTANT', 'CONFIG'];
await db.collection('roles').doc('SUPERADMIN').set({
  name: 'Superadmin',
  permissions: Object.fromEntries(modules.map((m) => [m, ['read', 'create', 'update', 'delete', 'publish', 'correct']])),
}, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

await db.collection('clients').doc(clientId).set({
  name: 'Cliente Sintético',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [{ id: objectiveId, name: 'Objetivo Norte', active: true, status: 'ACTIVE', lat: -31.42, lng: -64.18 }],
  createdAt: now,
});

const viejos = await db.collection('servicios_sla').where('objectiveId', '==', objectiveId).get();
for (const d of viejos.docs) await d.ref.delete();
await db.collection('servicios_sla').doc('sla_alta').set({
  empresaId,
  clientId,
  clientName: 'Cliente Sintético',
  objectiveId,
  objectiveName: 'Objetivo Norte',
  status: 'active',
  active: true,
  closed: false,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1',
    positionName: 'Puesto 1',
    quantity: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
      { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 },
      { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 1 },
    ],
  }],
  createdAt: now,
});

const turnos = await db.collection('turnos').where('objectiveId', '==', objectiveId).get();
for (const d of turnos.docs) await d.ref.delete();
const previos = await db.collection('empleados').where('preferredObjectiveId', '==', objectiveId).get();
for (const d of previos.docs) await d.ref.delete();

await db.collection('empleados').doc('altaSosa').set({
  empresaId,
  name: 'SOSA, PEDRO',
  lastName: 'SOSA',
  firstName: 'PEDRO',
  fileNumber: '1001',
  dni: '20111000',
  status: 'activo',
  category: 'Vigilador',
  role: 'employee',
  preferredObjectiveId: objectiveId,
  preferredClientId: clientId,
  createdAt: now,
});

const batch = db.batch();
for (let day = 1; day <= 28; day += 1) {
  const ciclo = day % 8;
  const franco = ciclo === 0 || ciclo === 7;
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  const start = new Date(`${date}T07:00:00-03:00`);
  const end = new Date(`${date}T15:00:00-03:00`);
  batch.set(db.collection('turnos').doc(`altaSosa_${date}`), {
    empresaId,
    clientId,
    objectiveId,
    objectiveName: 'Objetivo Norte',
    positionName: 'Puesto 1',
    employeeId: 'altaSosa',
    employeeName: 'SOSA, PEDRO',
    code: franco ? 'F' : 'M',
    name: franco ? 'F' : 'M',
    hours: franco ? 0 : 8,
    isFranco: franco,
    startTime: Timestamp.fromDate(start),
    endTime: Timestamp.fromDate(end),
    draft: false,
    isAbsent: false,
    createdAt: now,
  });
}
await batch.commit();

writeFileSync(new URL('./alta-servicio/.manifest.json', import.meta.url), JSON.stringify({
  clientId, objectiveId, year: 2026, month: 10, slaId: 'sla_alta',
}, null, 2));

console.log('✓ seed-alta-servicio: Objetivo Norte, SLA hasta 31/10, SOSA en octubre');
process.exit(0);
