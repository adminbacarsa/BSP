/**
 * Semilla del emulador: un EV el 3/10 (08:00–20:00) y un M el 4/10 a las 07:00 (descanso < 12 h).
 * No toca producción.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/seed-captura-tooltip-evento.mjs
 */
import { createRequire } from 'node:module';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):/.test(host)) {
  throw new Error('Solo emulador local. Definí FIRESTORE_EMULATOR_HOST.');
}
const require = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const empresaId = 'pruebas_sa';
const clientId = 'oo_cli';
const ninos = 'oo_ninos';
const empId = 'oo_capdevila';
const Y = 2026;
const M = 10;
const ymd = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ts = (d, hm) => Timestamp.fromDate(new Date(`${ymd(d)}T${hm}:00-03:00`));

await db.collection('clients').doc(clientId).set({
  id: clientId,
  name: 'Ministerio Demo OO',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [
    { id: ninos, name: 'H. de Niños OO', active: true, status: 'ACTIVE' },
    { id: 'oo_casa', name: 'Casa Mc Donalds OO', active: true, status: 'ACTIVE' },
  ],
}, { merge: true });
await db.collection('empleados').doc(empId).set({
  id: empId,
  empresaId,
  name: 'CAPDEVILA, GONZALO EZEQUIEL',
  lastName: 'CAPDEVILA',
  firstName: 'GONZALO EZEQUIEL',
  status: 'ACTIVE',
  preferredObjectiveId: ninos,
  planificacionDotacion: { [ninos]: { positionName: 'Rondin' } },
}, { merge: true });
await db.collection('servicios_sla').doc('oo_sla_ninos').set({
  id: 'oo_sla_ninos',
  empresaId,
  clientId,
  clientName: 'Ministerio Demo OO',
  objectiveId: ninos,
  objectiveName: 'H. de Niños OO',
  status: 'active',
  active: true,
  startDate: `${Y}-10-01`,
  endDate: `${Y}-10-31`,
  positions: [{
    name: 'Rondin',
    positionName: 'Rondin',
    quantity: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
    ],
  }],
}, { merge: true });
await db.collection('planificacion_estados').doc(`${empresaId}_${ninos}_2026_10`).set({
  empresaId, objectiveId: ninos, year: 2026, month: 10, status: 'DRAFT',
}, { merge: true });

const batch = db.batch();
const evId = `${empId}_${ymd(3)}`;
batch.set(db.collection('turnos').doc(evId), {
  id: evId,
  empresaId,
  clientId,
  objectiveId: ninos,
  objectiveName: 'Hospital de Niños',
  eventoLugar: 'Hospital de Niños',
  positionName: 'H. Niños',
  employeeId: empId,
  employeeName: 'CAPDEVILA, GONZALO EZEQUIEL',
  code: 'EV',
  origin: 'EVENTO',
  eventoId: 'oo_evt',
  eventoNombre: 'Evento para H. Niños',
  servicioId: 'oo_srv',
  servicioNombre: 'H. Niños',
  scheduleDate: ymd(3),
  draft: true,
  hours: 12,
  startTime: ts(3, '08:00'),
  endTime: ts(3, '20:00'),
});
const m4 = `${empId}_${ymd(4)}`;
batch.set(db.collection('turnos').doc(m4), {
  id: m4,
  empresaId,
  clientId,
  objectiveId: ninos,
  objectiveName: 'H. de Niños OO',
  positionName: 'Rondin',
  employeeId: empId,
  employeeName: 'CAPDEVILA, GONZALO EZEQUIEL',
  code: 'M',
  scheduleDate: ymd(4),
  draft: true,
  hours: 8,
  startTime: ts(4, '07:00'),
  endTime: ts(4, '15:00'),
});
await batch.commit();
console.log(JSON.stringify({ empId, ninos, ev: ymd(3) }));
