/**
 * Semilla del emulador: un guardia con turnos M en un objetivo que no es del grupo.
 * No toca producción: exige FIRESTORE_EMULATOR_HOST en localhost.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/seed-captura-otro-objetivo.mjs
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
const casa = 'oo_casa';
const peaje = 'oo_peaje';
const empId = 'oo_capdevila';
const Y = 2026;
const M = 10;
const ymd = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ts = (d) => Timestamp.fromDate(new Date(`${ymd(d)}T10:00:00-03:00`));
const fin = (d) => Timestamp.fromDate(new Date(`${ymd(d)}T18:00:00-03:00`));
const enPeaje = new Set([2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15]);

function sla(id, objectiveId, objectiveName, positions) {
  return db.collection('servicios_sla').doc(id).set({
    id,
    empresaId,
    clientId,
    clientName: 'Ministerio Demo OO',
    objectiveId,
    objectiveName,
    status: 'active',
    active: true,
    startDate: `${Y}-10-01`,
    endDate: `${Y}-10-31`,
    positions: positions.map((name) => ({
      name,
      positionName: name,
      quantity: 1,
      coverageType: '24hs',
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 },
        { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 1 },
      ],
    })),
  });
}

await db.collection('clients').doc(clientId).set({
  id: clientId,
  name: 'Ministerio Demo OO',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [
    { id: ninos, name: 'H. de Niños OO', active: true, status: 'ACTIVE' },
    { id: casa, name: 'Casa Mc Donalds OO', active: true, status: 'ACTIVE' },
    { id: peaje, name: 'Peaje Norte', active: true, status: 'ACTIVE' },
  ],
});
await sla('oo_sla_ninos', ninos, 'H. de Niños OO', ['Rondin']);
await sla('oo_sla_casa', casa, 'Casa Mc Donalds OO', ['Guardia']);
await sla('oo_sla_peaje', peaje, 'Peaje Norte', ['Cabina']);
await db.collection('grupos_objetivos').doc('oo_grupo').set({
  id: 'oo_grupo',
  empresaId,
  nombre: 'NIÑOS Y CASA RONALD OO',
  clientId,
  clientName: 'Ministerio Demo OO',
  objectiveIds: [ninos, casa],
  objectiveNames: ['H. de Niños OO', 'Casa Mc Donalds OO'],
});
for (const obj of [ninos, casa, peaje]) {
  await db.collection('planificacion_estados').doc(`${empresaId}_${obj}_2026_10`).set({
    empresaId, objectiveId: obj, year: 2026, month: 10, status: 'DRAFT',
  });
}

const batch = db.batch();
batch.set(db.collection('empleados').doc(empId), {
  id: empId,
  empresaId,
  name: 'CAPDEVILA, GONZALO EZEQUIEL',
  lastName: 'CAPDEVILA',
  firstName: 'GONZALO EZEQUIEL',
  status: 'ACTIVE',
  preferredObjectiveId: ninos,
  planificacionDotacion: { [ninos]: { positionName: 'Rondin' } },
});
for (let d = 1; d <= 31; d++) {
  const ajeno = enPeaje.has(d);
  const obj = ajeno ? peaje : ninos;
  const docId = `${empId}_${ymd(d)}`;
  batch.set(db.collection('turnos').doc(docId), {
    id: docId,
    empresaId,
    clientId,
    objectiveId: obj,
    objectiveName: ajeno ? 'Peaje Norte' : 'H. de Niños OO',
    positionName: ajeno ? 'Cabina' : 'Rondin',
    employeeId: empId,
    employeeName: 'CAPDEVILA, GONZALO EZEQUIEL',
    code: 'M',
    scheduleDate: ymd(d),
    draft: true,
    hours: 8,
    startTime: ts(d),
    endTime: fin(d),
  });
}
await batch.commit();
console.log(JSON.stringify({ clientId, ninos, casa, peaje, empId, grupo: 'oo_grupo' }));
