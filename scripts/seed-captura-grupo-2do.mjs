/**
 * Emulador: grupo con la N de Casa abierta y adelantos en los dos objetivos.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/seed-captura-grupo-2do.mjs
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
const clientId = 'g2_cli';
const ninos = 'g2_ninos';
const casa = 'g2_casa';
const afuera = 'g2_afuera';
const Y = 2026;
const M = 10;
const ymd = (d) => {
  const dt = new Date(Date.UTC(Y, M - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const ts = (d, hm) => Timestamp.fromDate(new Date(`${ymd(d)}T${hm}:00-03:00`));
const DIA = 9;

function puestoN(name) {
  return {
    name,
    positionName: name,
    quantity: 1,
    coverageType: '24hs',
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 1 },
    ],
  };
}

await db.collection('clients').doc(clientId).set({
  id: clientId,
  name: 'Ministerio 2do',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [
    { id: ninos, name: 'H. de Niños', active: true, status: 'ACTIVE' },
    { id: casa, name: 'Casa Mc Donalds', active: true, status: 'ACTIVE' },
    { id: afuera, name: 'Obrador Afuera', active: true, status: 'ACTIVE' },
  ],
});
await db.collection('servicios_sla').doc('g2_sla_ninos').set({
  id: 'g2_sla_ninos', empresaId, clientId, clientName: 'Ministerio 2do',
  objectiveId: ninos, objectiveName: 'H. de Niños', status: 'active', active: true,
  startDate: `${Y}-10-01`, endDate: `${Y}-10-31`, positions: [puestoN('Rondin')],
});
await db.collection('servicios_sla').doc('g2_sla_casa').set({
  id: 'g2_sla_casa', empresaId, clientId, clientName: 'Ministerio 2do',
  objectiveId: casa, objectiveName: 'Casa Mc Donalds', status: 'active', active: true,
  startDate: `${Y}-10-01`, endDate: `${Y}-10-31`, positions: [puestoN('Proveedores')],
});
await db.collection('servicios_sla').doc('g2_sla_afuera').set({
  id: 'g2_sla_afuera', empresaId, clientId, clientName: 'Ministerio 2do',
  objectiveId: afuera, objectiveName: 'Obrador Afuera', status: 'active', active: true,
  startDate: `${Y}-10-01`, endDate: `${Y}-10-31`, positions: [puestoN('Otro')],
});
await db.collection('grupos_objetivos').doc('g2_grupo').set({
  empresaId,
  nombre: 'NIÑOS Y CASA 2DO',
  clientId,
  clientName: 'Ministerio 2do',
  objectiveIds: [ninos, casa],
  objectiveNames: ['H. de Niños', 'Casa Mc Donalds'],
});
for (const obj of [ninos, casa, afuera]) {
  await db.collection('planificacion_estados').doc(`${empresaId}_${obj}_2026_10`).set({
    empresaId, objectiveId: obj, year: 2026, month: 10, status: 'DRAFT',
  });
}

const gente = [
  { id: 'g2_dominguez', name: 'DOMINGUEZ, CARLOS', puesto: 'Rondin', obj: ninos, code: 'N', ini: '23:00', fin: '07:00', dias: [DIA] },
  { id: 'g2_escobar', name: 'ESCOBAR, JUANA', puesto: 'Rondin', obj: ninos, code: 'T', ini: '15:00', fin: '23:00', dias: [DIA] },
  { id: 'g2_galeano', name: 'GALEANO, MARCOS', puesto: 'Rondin', obj: ninos, code: 'M', ini: '07:00', fin: '15:00', dias: [DIA + 1] },
  { id: 'g2_alaniz', name: 'ALANIZ, PEDRO', puesto: 'Proveedores', obj: casa, code: 'T', ini: '15:00', fin: '23:00', dias: [DIA] },
  { id: 'g2_navarro', name: 'NAVARRO ASTRADA, ROXANA', puesto: 'Proveedores', obj: casa, code: 'M', ini: '07:00', fin: '15:00', dias: [DIA + 1] },
  { id: 'g2_ajeno', name: 'AJENO, LUIS', puesto: 'Otro', obj: afuera, code: 'M', ini: '07:00', fin: '15:00', dias: [DIA + 1] },
];

const nombres = { [ninos]: 'H. de Niños', [casa]: 'Casa Mc Donalds', [afuera]: 'Obrador Afuera' };
let batch = db.batch();
let n = 0;
const flush = async () => { await batch.commit(); batch = db.batch(); n = 0; };
for (const g of gente) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  batch.set(db.collection('empleados').doc(g.id), {
    id: g.id, empresaId, name: g.name, lastName: apellido, firstName: nombre, status: 'ACTIVE',
    preferredObjectiveId: g.obj,
    planificacionDotacion: { [g.obj]: { positionName: g.puesto } },
  });
  n += 1;
  for (const d of g.dias) {
    const id = `${g.id}_${ymd(d)}`;
    const finDia = g.fin < g.ini ? d + 1 : d;
    batch.set(db.collection('turnos').doc(id), {
      id, empresaId, clientId, objectiveId: g.obj,
      objectiveName: nombres[g.obj],
      positionName: g.puesto, employeeId: g.id, employeeName: g.name,
      code: g.code, scheduleDate: ymd(d), draft: true, hours: 8,
      startTime: ts(d, g.ini), endTime: ts(finDia, g.fin),
    });
    n += 1;
    if (n >= 400) await flush();
  }
}
if (n) await flush();
console.log(JSON.stringify({ clientId, ninos, casa, grupo: 'NIÑOS Y CASA 2DO', dia: ymd(DIA) }));
