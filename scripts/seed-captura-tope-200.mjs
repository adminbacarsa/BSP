/**
 * Un guardia que pasa 200 h a mitad de octubre, en el emulador 8190.
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/seed-captura-tope-200.mjs
 */
import { createRequire } from 'node:module';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):8190$/.test(host)) {
  throw new Error('Solo el emulador 8190.');
}
const require = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const empresaId = 'pruebas_sa';
const clientId = 'g2_cli';
const obj = 'g2_ninos';
const empId = 'tope_emp';
const ymd = (d) => `2026-10-${String(d).padStart(2, '0')}`;
const ts = (d, hm) => Timestamp.fromDate(new Date(`${ymd(d)}T${hm}:00-03:00`));

await db.collection('empleados').doc(empId).set({
  id: empId,
  empresaId,
  name: 'TOPE, MARIO',
  lastName: 'TOPE',
  firstName: 'MARIO',
  status: 'ACTIVE',
  preferredObjectiveId: obj,
  planificacionDotacion: { [obj]: { positionName: 'Rondin' } },
});

let batch = db.batch();
let n = 0;
for (let d = 1; d <= 31; d += 1) {
  const id = `${empId}_${ymd(d)}`;
  batch.set(db.collection('turnos').doc(id), {
    id,
    empresaId,
    clientId,
    objectiveId: obj,
    objectiveName: 'H. de Niños',
    positionName: 'Rondin',
    employeeId: empId,
    employeeName: 'TOPE, MARIO',
    code: 'D12',
    scheduleDate: ymd(d),
    draft: true,
    hours: 12,
    topeExcedido: true,
    horasMes: 372,
    startTime: ts(d, '07:00'),
    endTime: ts(d, '19:00'),
  });
  n += 1;
  if (n >= 400) {
    await batch.commit();
    batch = db.batch();
    n = 0;
  }
}
await db.collection('tope_autorizaciones').doc(`${empresaId}_2026-10`).set({
  empresaId,
  periodo: '2026-10',
  guardias: {
    [empId]: {
      periodo: '2026-10',
      autorizadoPor: 'Mauro Martinez',
      motivo: 'cobertura del mes',
      fecha: '2026-10-09T12:00:00-03:00',
      horasAlAutorizar: 372,
      status: 'ACTIVE',
    },
  },
}, { merge: true });
if (n) await batch.commit();
console.log(JSON.stringify({ empId, obj, clientId, dias: 31, cruza: '2026-10-17' }));
