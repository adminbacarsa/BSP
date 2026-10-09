/**
 * Seed del emulador para la captura de puesto + objetivo en la vista agrupada.
 * No toca producción: exige FIRESTORE_EMULATOR_HOST en localhost.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/seed-captura-grupo-puesto.mjs
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
const clientId = 'gp_cli';
const ninos = 'gp_ninos';
const casa = 'gp_casa';
const Y = 2026;
const M = 10;

const puestosNinos = ['Internado', 'Playa', 'Proveedores', 'Rondin'];
const ymd = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ts = (d) => Timestamp.fromDate(new Date(`${ymd(d)}T12:00:00-03:00`));

const gente = [
  { id: 'gp_internado', name: 'ACOSTA, MARIA', puesto: 'Internado', obj: ninos },
  { id: 'gp_playa', name: 'BENITEZ, LUIS', puesto: 'Playa', obj: ninos },
  { id: 'gp_prov', name: 'CARDOZO, ANA', puesto: 'Proveedores', obj: ninos },
  { id: 'gp_rondin', name: 'DIAZ, PEDRO', puesto: 'Rondin', obj: ninos },
  { id: 'gp_guardia', name: 'ESCOBAR, JUANA', puesto: 'Guardia', obj: casa },
  { id: 'gp_mixto', name: 'NAVARRO ASTRADA, ROXANA GABRIELA', puesto: 'Internado', obj: ninos, tambien: { puesto: 'Playa', obj: casa, dias: [3, 10, 17, 24] } },
];

function sla(id, objectiveId, objectiveName, positions) {
  return db.collection('servicios_sla').doc(id).set({
    id,
    empresaId,
    clientId,
    clientName: 'Ministerio Demo',
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
  name: 'Ministerio Demo',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [
    { id: ninos, name: 'H. de Niños', active: true, status: 'ACTIVE' },
    { id: casa, name: 'Casa Mc Donalds', active: true, status: 'ACTIVE' },
  ],
});
await sla('gp_sla_ninos', ninos, 'H. de Niños', puestosNinos);
await sla('gp_sla_casa', casa, 'Casa Mc Donalds', ['Guardia']);
await db.collection('grupos_objetivos').doc('gp_grupo').set({
  empresaId,
  nombre: 'NIÑOS Y CASA RONALD',
  clientId,
  clientName: 'Ministerio Demo',
  objectiveIds: [ninos, casa],
  objectiveNames: ['H. de Niños', 'Casa Mc Donalds'],
});
for (const obj of [ninos, casa]) {
  await db.collection('planificacion_estados').doc(`${empresaId}_${obj}_2026_10`).set({
    empresaId, objectiveId: obj, year: 2026, month: 10, status: 'DRAFT',
  });
}

const batch = db.batch();
for (const g of gente) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  batch.set(db.collection('empleados').doc(g.id), {
    empresaId,
    name: g.name,
    lastName: apellido,
    firstName: nombre,
    status: 'ACTIVE',
    preferredObjectiveId: g.obj,
    planificacionDotacion: { [g.obj]: { positionName: g.puesto } },
  });
  for (let d = 1; d <= 31; d++) {
    const extra = g.tambien && g.tambien.dias.includes(d);
    const puesto = extra ? g.tambien.puesto : g.puesto;
    const obj = extra ? g.tambien.obj : g.obj;
    const nombreObj = obj === ninos ? 'H. de Niños' : 'Casa Mc Donalds';
    batch.set(db.collection('turnos').doc(`${g.id}_${ymd(d)}`), {
      empresaId,
      clientId,
      objectiveId: obj,
      objectiveName: nombreObj,
      positionName: puesto,
      employeeId: g.id,
      employeeName: g.name,
      code: 'M',
      scheduleDate: ymd(d),
      draft: true,
      hours: 8,
      startTime: ts(d),
      endTime: ts(d),
    });
  }
}
await batch.commit();
console.log(JSON.stringify({ clientId, ninos, casa, grupo: 'gp_grupo', empresaId }, null, 2));
