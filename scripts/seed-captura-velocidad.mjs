#!/usr/bin/env node
/**
 * Datos para medir la velocidad del cronograma (solo emulador): Ministerio de Salud → H. de Niños,
 * octubre 2026, 3 puestos 24 h (M/T/N), 21 guardias × 31 días con 6+2, francoteros, RET, ESC, REF,
 * vacaciones, enfermedad y libres.
 *
 *   node scripts/seed-admin.js && node scripts/seed-captura-velocidad.mjs
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

if (!process.env.FIRESTORE_EMULATOR_HOST.match(/^(127\.0\.0\.1|localhost):/)) {
  throw new Error('Solo emulador local');
}
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const empresaId = 'bacarsa';
const clientId = 'cli_ms';
const clientName = 'Ministerio de Salud';
const objectiveId = 'obj_hn';
const objectiveName = 'H. de Niños';
const PUESTOS = ['Guardia Central', 'Emergencias', 'Consultorios'];
const Y = 2026;
const M = 10;
const DIAS = 31;

const BANDAS = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  RET: { start: '07:00', end: '15:00', hours: 8 },
  ESC: { start: '07:00', end: '15:00', hours: 8 },
  REF: { start: '15:00', end: '23:00', hours: 8 },
};

const NOMBRES = [
  'ACOSTA, Mariano', 'BENITEZ, Laura', 'CABRERA, Diego', 'DIAZ, Sofía', 'ESCOBAR, Hugo', 'FERNANDEZ, Paula',
  'GOMEZ, Ramiro', 'HERRERA, Natalia', 'IBARRA, Julio', 'JUAREZ, Carla', 'LEDESMA, Oscar', 'MOLINA, Verónica',
  'NAVARRO, Pablo', 'OLMEDO, Gisela', 'PERALTA, Sergio', 'QUIROGA, Andrea', 'RIOS, Marcelo', 'SUAREZ, Lucía',
  'TOLEDO, Gustavo', 'VERA, Daniela', 'ZARATE, Fabián',
];
const guardias = NOMBRES.map((name, i) => ({ id: `hn_${String(i + 1).padStart(2, '0')}`, name }));

/** Titulares: [índice, puesto, banda, desfase 6+2]. */
const TITULARES = [];
PUESTOS.forEach((puesto, p) => {
  ['M', 'T', 'N'].forEach((banda, b) => TITULARES.push([p * 3 + b, puesto, banda, (p * 3 + b * 2) % 8]));
});
const FRANCOTEROS = { M: 9, T: 10, N: 11 };

const ymd = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ts = (d, hm, nextDay = false) => {
  const date = new Date(`${ymd(d)}T${hm}:00-03:00`);
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return Timestamp.fromDate(date);
};
const esFranco = (d, offset) => ((d - 1 + offset) % 8) >= 6;
const diaSemana = (d) => new Date(`${ymd(d)}T12:00:00-03:00`).getUTCDay();

/** índice → { code, puesto } del día. */
function plan(d) {
  const out = {};
  const huecos = { M: [], T: [], N: [] };
  for (const [i, puesto, banda, off] of TITULARES) {
    if (esFranco(d, off)) {
      out[i] = { code: 'F', puesto };
      huecos[banda].push(puesto);
    } else out[i] = { code: banda, puesto };
  }
  for (const [banda, i] of Object.entries(FRANCOTEROS)) {
    out[i] = huecos[banda][0] ? { code: banda, puesto: huecos[banda][0] } : { code: 'F', puesto: PUESTOS[0] };
  }
  const finde = diaSemana(d) === 0 || diaSemana(d) === 6;
  out[12] = { code: finde ? 'F' : 'RET', puesto: PUESTOS[0] };
  out[13] = { code: finde ? 'RET' : 'F', puesto: PUESTOS[1] };
  out[14] = d % 3 === 0 ? { code: 'ESC', puesto: PUESTOS[2] } : null;
  out[15] = d % 4 === 1 ? { code: 'ESC', puesto: PUESTOS[0] } : null;
  out[16] = d % 5 === 2 ? { code: 'REF', puesto: PUESTOS[1] } : null;
  out[17] = d >= 6 && d <= 15 ? { code: 'V', puesto: PUESTOS[2] } : { code: esFranco(d, 4) ? 'F' : 'M', puesto: PUESTOS[2] };
  out[18] = d >= 20 && d <= 24 ? { code: 'E', puesto: PUESTOS[1] } : { code: esFranco(d, 2) ? 'F' : 'T', puesto: PUESTOS[1] };
  out[19] = null;
  out[20] = null;
  if (d >= 13 && d <= 15) out[0] = { code: 'V', puesto: PUESTOS[0] };
  return out;
}

async function borrarPrevio() {
  const snap = await db.collection('turnos').where('objectiveId', '==', objectiveId).get();
  const aus = await db.collection('ausencias').where('objectiveId', '==', objectiveId).get();
  let batch = db.batch();
  let n = 0;
  for (const d of [...snap.docs, ...aus.docs]) {
    batch.delete(d.ref);
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
}

await borrarPrevio();
const now = Timestamp.now();

await db.collection('clients').doc(clientId).set({
  name: clientName,
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [{ id: objectiveId, name: objectiveName, active: true, status: 'ACTIVE', lat: -31.41, lng: -64.19 }],
  createdAt: now,
});

await db.collection('servicios_sla').doc('sla_hn').set({
  empresaId,
  clientId,
  clientName,
  objectiveId,
  objectiveName,
  status: 'active',
  active: true,
  startDate: `${Y}-01-01`,
  endDate: `${Y}-12-31`,
  positions: PUESTOS.map((name) => ({
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
  createdAt: now,
});

for (const g of guardias) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  await db.collection('empleados').doc(g.id).set({
    empresaId,
    name: g.name,
    fullName: g.name,
    nombre: nombre || '',
    apellido,
    lastName: apellido,
    firstName: nombre || '',
    status: 'ACTIVE',
    modalidad: 'NOMINA',
    category: 'VIGILADOR',
    preferredObjectiveId: objectiveId,
    preferredObjectiveIds: [objectiveId],
    createdAt: now,
  });
}

let batch = db.batch();
let n = 0;
for (let d = 1; d <= DIAS; d++) {
  const dia = plan(d);
  for (let i = 0; i < guardias.length; i++) {
    const t = dia[i];
    if (!t) continue;
    const g = guardias[i];
    const ref = db.collection('turnos').doc(`${g.id}_${ymd(d)}`);
    const base = {
      empresaId,
      clientId,
      objectiveId,
      objectiveName,
      positionName: t.puesto,
      employeeId: g.id,
      employeeName: g.name,
      code: t.code,
      name: t.code,
      draft: true,
      isAbsent: false,
      createdAt: now,
    };
    if (t.code === 'F') {
      batch.set(ref, { ...base, isFranco: true, hours: 0, startTime: ts(d, '00:00'), endTime: ts(d, '23:59') });
    } else if (t.code === 'V' || t.code === 'E') {
      batch.set(ref, {
        ...base,
        name: t.code === 'V' ? 'Vacaciones' : 'Enfermedad',
        hours: 0,
        startTime: ts(d, '00:00'),
        endTime: ts(d, '23:59'),
        originalCode: 'M',
        originalPositionName: t.puesto,
      });
    } else {
      const b = BANDAS[t.code];
      batch.set(ref, { ...base, hours: b.hours, startTime: ts(d, b.start), endTime: ts(d, b.end, t.code === 'N'), isFranco: false });
    }
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
}
await batch.commit();

const ausencias = [
  { id: 'aus_hn_01_v', emp: guardias[0], type: 'Vacaciones', status: 'Autorizada', desde: 13, hasta: 15 },
  { id: 'aus_hn_18_v', emp: guardias[17], type: 'Vacaciones', status: 'Autorizada', desde: 6, hasta: 15 },
  { id: 'aus_hn_19_e', emp: guardias[18], type: 'Enfermedad', status: 'Justificada', desde: 20, hasta: 24 },
];
for (const a of ausencias) {
  await db.collection('ausencias').doc(a.id).set({
    empresaId,
    employeeId: a.emp.id,
    employeeName: a.emp.name,
    type: a.type,
    status: a.status,
    startDate: ymd(a.desde),
    endDate: ymd(a.hasta),
    objectiveId,
    createdAt: now,
  });
}

console.log(`✓ seed-captura-velocidad: ${n} turnos, ${guardias.length} legajos en ${objectiveName} (${objectiveId})`);
process.exit(0);
