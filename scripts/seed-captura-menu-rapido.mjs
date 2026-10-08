#!/usr/bin/env node
/**
 * Datos de la captura del menú rápido de cobertura (solo emulador).
 * Octubre 2026, un objetivo 24 h (M/T/N), ocho guardias y BAEZ con V del 13 al 15.
 *
 *   node scripts/seed-admin.js && node scripts/seed-captura-menu-rapido.mjs
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
const clientId = 'cli_mr';
const objectiveId = 'obj_mr';
const objectiveName = 'Peaje Demo';
const positionName = 'Puesto 1';
const Y = 2026;
const M = 10;
const DIAS = 31;

const BANDAS = {
  M: { start: '07:00', end: '15:00', hours: 8 },
  T: { start: '15:00', end: '23:00', hours: 8 },
  N: { start: '23:00', end: '07:00', hours: 8 },
  RET: { start: '07:00', end: '15:00', hours: 8 },
  ESC: { start: '07:00', end: '15:00', hours: 8 },
};

const guardias = [
  { id: 'mr_baez', name: 'BAEZ, Juan' },
  { id: 'mr_barros', name: 'BARROS, Luis' },
  { id: 'mr_galeano', name: 'GALEANO, Marta' },
  { id: 'mr_ross', name: 'ROSS, Carlos' },
  { id: 'mr_ferrero', name: 'FERRERO, Juan' },
  { id: 'mr_bosio', name: 'BOSIO, Ana' },
  { id: 'mr_lopez', name: 'LOPEZ, Raúl' },
  { id: 'mr_fontana', name: 'FONTANA, Luis' },
];
const fuera = { id: 'mr_sosa', name: 'SOSA, Inés' };

const ymd = (d) => `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ts = (d, hm, nextDay = false) => {
  const date = new Date(`${ymd(d)}T${hm}:00-03:00`);
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return Timestamp.fromDate(date);
};

/** 6+2 corrido por guardia: francos en días distintos para cada banda. */
const esFranco = (d, offset) => ((d - 1 + offset) % 8) >= 6;

function plan(d) {
  const out = {};
  const titulares = [
    ['mr_baez', 'M', 0],
    ['mr_barros', 'T', 3],
    ['mr_galeano', 'N', 5],
  ];
  const francosHoy = [];
  for (const [id, code, off] of titulares) {
    if (esFranco(d, off)) {
      out[id] = 'F';
      francosHoy.push(code);
    } else out[id] = code;
  }
  out.mr_ross = francosHoy[0] || 'F';
  out.mr_fontana = francosHoy[1] || (d % 7 === 0 ? 'F' : '');
  const weekday = new Date(`${ymd(d)}T12:00:00-03:00`).getUTCDay();
  out.mr_ferrero = weekday === 0 || weekday === 6 ? 'F' : 'RET';
  out.mr_bosio = d % 3 === 0 ? 'ESC' : '';
  out.mr_lopez = '';
  if (d >= 13 && d <= 15) out.mr_baez = 'V';
  if (d === 15) out.mr_ferrero = 'E';
  return out;
}

async function borrarPrevio() {
  const snap = await db.collection('turnos').where('objectiveId', '==', objectiveId).get();
  const aus = await db.collection('ausencias').where('employeeId', '==', 'mr_baez').get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  aus.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

await borrarPrevio();
const now = Timestamp.now();

await db.collection('clients').doc(clientId).set({
  name: 'Autopista Demo',
  empresaId,
  status: 'ACTIVE',
  active: true,
  objetivos: [{ id: objectiveId, name: objectiveName, active: true, status: 'ACTIVE', lat: -31.42, lng: -64.18 }],
  createdAt: now,
});

await db.collection('servicios_sla').doc('sla_mr').set({
  empresaId,
  clientId,
  clientName: 'Autopista Demo',
  objectiveId,
  objectiveName,
  status: 'active',
  active: true,
  startDate: `${Y}-01-01`,
  endDate: `${Y}-12-31`,
  positions: [{
    name: positionName,
    positionName,
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

for (const g of [...guardias, fuera]) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  await db.collection('empleados').doc(g.id).set({
    empresaId,
    name: g.name,
    fullName: g.name,
    nombre: nombre || '',
    apellido: apellido || g.name,
    lastName: apellido,
    firstName: nombre || '',
    status: 'ACTIVE',
    modalidad: 'NOMINA',
    category: 'VIGILADOR',
    ...(g.id === fuera.id ? {} : { preferredObjectiveId: objectiveId, preferredObjectiveIds: [objectiveId] }),
    createdAt: now,
  });
}

let batch = db.batch();
let n = 0;
for (let d = 1; d <= DIAS; d++) {
  const dia = plan(d);
  for (const g of guardias) {
    const code = dia[g.id];
    if (!code) continue;
    const ref = db.collection('turnos').doc(`${g.id}_${ymd(d)}`);
    const base = {
      empresaId,
      clientId,
      objectiveId,
      objectiveName,
      positionName,
      employeeId: g.id,
      employeeName: g.name,
      code,
      name: code,
      draft: true,
      isAbsent: false,
      createdAt: now,
    };
    if (code === 'F') {
      batch.set(ref, { ...base, isFranco: true, hours: 0, startTime: ts(d, '00:00'), endTime: ts(d, '23:59') });
    } else if (code === 'V' || code === 'E') {
      batch.set(ref, {
        ...base,
        name: code === 'V' ? 'Vacaciones' : 'Enfermedad',
        hours: 0,
        startTime: ts(d, '00:00'),
        endTime: ts(d, '23:59'),
        originalCode: 'M',
        originalPositionName: positionName,
      });
    } else {
      const b = BANDAS[code];
      batch.set(ref, {
        ...base,
        hours: b.hours,
        startTime: ts(d, b.start),
        endTime: ts(d, b.end, code === 'N'),
        isFranco: false,
      });
    }
    n++;
    if (n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
}
await batch.commit();

await db.collection('ausencias').doc('aus_mr_baez_v').set({
  empresaId,
  employeeId: 'mr_baez',
  employeeName: 'BAEZ, Juan',
  type: 'Vacaciones',
  status: 'Autorizada',
  startDate: ymd(13),
  endDate: ymd(15),
  objectiveId,
  createdAt: now,
});

console.log(`✓ seed-captura-menu-rapido: ${n} turnos, ${guardias.length + 1} legajos, BAEZ V 13→15/10 en ${objectiveId}`);
process.exit(0);
