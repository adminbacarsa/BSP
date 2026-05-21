#!/usr/bin/env node
/** Cliente + objetivo + SLA activo para probar Automatizar en bacarsa (emulador). */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();
const now = Timestamp.now();
const empresaId = 'bacarsa';
const objectiveId = 'obj_demo_plan';
const clientId = 'client_demo_plan';

const y = new Date().getFullYear();
const m = new Date().getMonth();
const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
const end = `${y}-${String(m + 1).padStart(2, '0')}-28`;

await db.collection('clients').doc(clientId).set({
  name: 'Cliente Demo Plan',
  empresaId,
  active: true,
  objetivos: [{
    id: objectiveId,
    name: 'Objetivo Demo 24hs',
    active: true,
    lat: -31.42,
    lng: -64.18,
  }],
  createdAt: now,
}, { merge: true });

await db.collection('servicios_sla').doc('sla_demo_plan').set({
  clientId,
  empresaId,
  objectiveId,
  active: true,
  effectiveFrom: start,
  effectiveTo: end,
  totalMonthlyHours: 2160,
  positions: [{
    positionName: 'General',
    qty: 3,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    shifts: [
      { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
      { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
      { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
    ],
  }],
  createdAt: now,
}, { merge: true });

const emps = ['emp_demo_1', 'emp_demo_2', 'emp_demo_3', 'emp_demo_4'];
for (let i = 0; i < emps.length; i++) {
  const nombre = `Demo Guardia ${i + 1}`;
  await db.collection('empleados').doc(emps[i]).set({
    empresaId,
    nombre,
    name: nombre,
    fullName: nombre,
    preferredObjectiveId: objectiveId,
    status: 'ACTIVE',
    createdAt: now,
  }, { merge: true });
}

console.log('✓ seed-planning-demo: client_demo_plan / obj_demo_plan / sla_demo_plan (2160h, 3 pax 24hs)');
console.log('  4 empleados demo en bacarsa');
