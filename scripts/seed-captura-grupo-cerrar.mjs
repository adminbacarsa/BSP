/**
 * Emulador: grupo con dos objetivos y un día con una banda abierta en cada uno.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/seed-captura-grupo-cerrar.mjs
 *   ... node scripts/seed-captura-grupo-cerrar.mjs --cerrado
 * --cerrado: el M de Casa extiende y cierra la T de H. de Niños.
 */
import { createRequire } from 'node:module';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):/.test(host)) {
  throw new Error('Solo emulador local. Definí FIRESTORE_EMULATOR_HOST.');
}
const cerrado = process.argv.includes('--cerrado');
const require = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const empresaId = 'pruebas_sa';
const clientId = 'gc_cli';
const ninos = 'gc_ninos';
const casa = 'gc_casa';
const Y = 2026;
const M = 10;
const ymd = (d) => {
  const dt = new Date(Date.UTC(Y, M - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const ts = (d, hm) => Timestamp.fromDate(new Date(`${ymd(d)}T${hm}:00-03:00`));
const DIA = 9;

function puesto(name) {
  return {
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
  };
}

await db.collection('clients').doc(clientId).set({
  id: clientId,
  name: 'Ministerio Cerrar',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [
    { id: ninos, name: 'H. de Niños', active: true, status: 'ACTIVE' },
    { id: casa, name: 'Casa Mc Donalds', active: true, status: 'ACTIVE' },
  ],
});
await db.collection('servicios_sla').doc('gc_sla_ninos').set({
  id: 'gc_sla_ninos', empresaId, clientId, clientName: 'Ministerio Cerrar',
  objectiveId: ninos, objectiveName: 'H. de Niños', status: 'active', active: true,
  startDate: `${Y}-10-01`, endDate: `${Y}-10-31`, positions: [puesto('Playa')],
});
await db.collection('servicios_sla').doc('gc_sla_casa').set({
  id: 'gc_sla_casa', empresaId, clientId, clientName: 'Ministerio Cerrar',
  objectiveId: casa, objectiveName: 'Casa Mc Donalds', status: 'active', active: true,
  startDate: `${Y}-10-01`, endDate: `${Y}-10-31`, positions: [puesto('Guardia')],
});
await db.collection('grupos_objetivos').doc('gc_grupo').set({
  empresaId,
  nombre: 'NIÑOS Y CASA CERRAR',
  clientId,
  clientName: 'Ministerio Cerrar',
  objectiveIds: [ninos, casa],
  objectiveNames: ['H. de Niños', 'Casa Mc Donalds'],
});
for (const obj of [ninos, casa]) {
  await db.collection('planificacion_estados').doc(`${empresaId}_${obj}_2026_10`).set({
    empresaId, objectiveId: obj, year: 2026, month: 10, status: 'DRAFT',
  });
}

const gente = [
  { id: 'gc_benitez', name: 'BENITEZ, LUIS', puesto: 'Playa', obj: ninos, code: 'M', ini: '07:00', fin: '15:00', salvo: null },
  { id: 'gc_acosta', name: 'ACOSTA, MARIA', puesto: 'Playa', obj: ninos, code: 'N', ini: '23:00', fin: '07:00', salvo: null },
  { id: 'gc_tarda', name: 'TARDA, PEDRO', puesto: 'Playa', obj: ninos, code: 'T', ini: '15:00', fin: '23:00', salvo: DIA },
  { id: 'gc_escobar', name: 'ESCOBAR, JUANA', puesto: 'Guardia', obj: casa, code: 'M', ini: '07:00', fin: '15:00', salvo: null },
  { id: 'gc_fernan', name: 'FERNANDEZ, ROSA', puesto: 'Guardia', obj: casa, code: 'T', ini: '15:00', fin: '23:00', salvo: null },
  { id: 'gc_noche', name: 'NOCHE, RAMON', puesto: 'Guardia', obj: casa, code: 'N', ini: '23:00', fin: '07:00', salvo: DIA },
];

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
  for (let d = 1; d <= 31; d++) {
    if (g.salvo === d) continue;
    const id = `${g.id}_${ymd(d)}`;
    const finDia = g.fin < g.ini ? d + 1 : d;
    const doc = {
      id, empresaId, clientId, objectiveId: g.obj,
      objectiveName: g.obj === ninos ? 'H. de Niños' : 'Casa Mc Donalds',
      positionName: g.puesto, employeeId: g.id, employeeName: g.name,
      code: g.code, scheduleDate: ymd(d), draft: true, hours: 8,
      startTime: ts(d, g.ini), endTime: ts(finDia, g.fin),
    };
    if (cerrado && g.id === 'gc_escobar' && d === DIA) {
      Object.assign(doc, {
        isExtended: true,
        isEarlyStart: false,
        coveragePackageId: 'gc_cierre_t',
        coverageSegmentRole: 'EXTENSION',
        coverageMode: 'FULL_BAND',
        coverageStatus: 'COVERED',
        coverageType: 'ABSENCE_COVERAGE',
        coversBandCode: 'T',
        coversPositionName: 'Playa',
        coversDateStr: ymd(DIA),
        coversObjectiveId: ninos,
        extExtraHours: 8,
        adjustedEndTime: '23:00',
        segmentFromTime: '15:00',
        segmentToTime: '23:00',
      });
    }
    batch.set(db.collection('turnos').doc(id), doc);
    n += 1;
    if (n >= 400) await flush();
  }
}
if (n) await flush();
console.log(JSON.stringify({ clientId, ninos, casa, grupo: 'NIÑOS Y CASA CERRAR', dia: ymd(DIA), cerrado }));
