/**
 * E2E emulador: publicar el cronograma del último mes renueva el SLA.
 * Segunda publicación no duplica. Cerrado no renueva. Despublicar no borra.
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8190"
 *   node scripts/eval-s8-renovar-sla-emulator.mjs
 */
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8190';
if (!/^(127\.0\.0\.1|localhost):(\d+)$/.test(host)) {
  console.error(`FIRESTORE_EMULATOR_HOST debe ser local, llegó ${host}`);
  process.exit(1);
}
process.env.FIRESTORE_EMULATOR_HOST = host;

const [pingHost, pingPort] = host.split(':');
const ping = await new Promise((resolve) => {
  const socket = net.connect(Number(pingPort), pingHost, () => { socket.end(); resolve(true); });
  socket.setTimeout(4000, () => { socket.destroy(); resolve(false); });
  socket.on('error', () => resolve(false));
});
if (!ping) {
  console.error(`Emulador Firestore no responde en ${host}`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { renovarSlaAlPublicar } = requireFn('./lib/servicios/renovarSlaMes.js');

const projectId = 'demo-s8-renovar';
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

let failed = 0;
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ok ${label}`);
  else {
    failed += 1;
    console.error(`  FAIL ${label}${extra ? ` → ${extra}` : ''}`);
  }
};

const prefix = `s8_${Date.now().toString(36)}`;
const objInd = `${prefix}_ind`;
const objGrp = `${prefix}_grp`;
const objClosed = `${prefix}_cls`;
const clientId = `${prefix}_cli`;

await db.collection('clients').doc(clientId).set({
  name: 'Cliente S8',
  status: 'activo',
  empresaId: 'pruebas_sa',
  objetivos: [
    { id: objInd, name: 'Objetivo Ind', status: 'ACTIVE' },
    { id: objGrp, name: 'Objetivo Agr', status: 'ACTIVE' },
    { id: objClosed, name: 'Objetivo Cerrado', status: 'ACTIVE' },
  ],
});

const puestos = [{ id: 'p1', name: 'Puesto 1', quantity: 2, allowedShiftTypes: [{ code: 'M', startTime: '07:00', endTime: '15:00' }] }];
const base = {
  clientId,
  clientName: 'Cliente S8',
  empresaId: 'pruebas_sa',
  positions: puestos,
  billingMode: 'EJECUTADO',
  encargadoEmployeeId: 'enc1',
  encargadoEmployeeName: 'Encargado',
  autoRenewMonthly: true,
  status: 'active',
  closed: false,
};

await db.collection('servicios_sla').doc(`${prefix}_nov`).set({
  ...base,
  objectiveId: objInd,
  objectiveName: 'Objetivo Ind',
  slaSeriesId: `${prefix}_serie`,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
});
await db.collection('servicios_sla').doc(`${prefix}_grp`).set({
  ...base,
  objectiveId: objGrp,
  objectiveName: 'Objetivo Agr',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
});
await db.collection('servicios_sla').doc(`${prefix}_closed`).set({
  ...base,
  objectiveId: objClosed,
  objectiveName: 'Objetivo Cerrado',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  closed: true,
  closedReason: 'VENCIDO',
});

const published = (objectiveId, millis) => ({
  objectiveId,
  empresaId: 'pruebas_sa',
  year: 2026,
  month: 11,
  publishedAt: admin.firestore.Timestamp.fromMillis(millis),
});

const first = await renovarSlaAlPublicar(db, null, published(objInd, 1_000));
check('publicar noviembre crea diciembre', first.action === 'created', first.reason || first.action);
const decSnap = await db.collection('servicios_sla').where('objectiveId', '==', objInd).get();
const dec = decSnap.docs.map((d) => d.data()).find((d) => d.startDate === '2026-12-01');
check('diciembre 1→31, mismos puestos y renovación', !!dec && dec.endDate === '2026-12-31' && dec.autoRenewMonthly === true && dec.positions?.[0]?.quantity === 2 && dec.billingMode === 'EJECUTADO' && dec.encargadoEmployeeId === 'enc1' && dec.closed !== true);

const second = await renovarSlaAlPublicar(db, published(objInd, 1_000), published(objInd, 2_000));
check('segunda publicación no duplica', second.action === 'skip', second.reason || '');
const decAgain = await db.collection('servicios_sla').where('objectiveId', '==', objInd).get();
check('sigue habiendo 2 servicios', decAgain.size === 2, String(decAgain.size));

const closed = await renovarSlaAlPublicar(db, null, published(objClosed, 3_000));
check('cerrado no renueva', closed.action === 'skip' && closed.reason === 'cerrado_o_inactivo', closed.reason || '');
const closedRows = await db.collection('servicios_sla').where('objectiveId', '==', objClosed).get();
check('el cerrado sigue siendo uno', closedRows.size === 1);

const ext = await renovarSlaAlPublicar(db, null, published(objGrp, 4_000));
check('agrupado extiende', ext.action === 'extended', ext.reason || '');
const grp = (await db.collection('servicios_sla').doc(`${prefix}_grp`).get()).data();
check('agrupado termina el 31/12 y no hay otro doc', grp?.endDate === '2026-12-31');
const grpRows = await db.collection('servicios_sla').where('objectiveId', '==', objGrp).get();
check('agrupado sigue en un solo doc', grpRows.size === 1);

const beforeEnd = grp?.endDate;
const off = await renovarSlaAlPublicar(db, published(objGrp, 4_000), { ...published(objGrp, 4_000), publishedAt: null });
const grpAfter = (await db.collection('servicios_sla').doc(`${prefix}_grp`).get()).data();
check('despublicar no borra ni recorta', off.action === 'skip' && grpAfter?.endDate === beforeEnd);

const nov = await db.collection('novedades').where('objectiveId', '==', objInd).where('type', '==', 'SLA_RENOVADO').get();
check('novedad a planificación', nov.size === 1 && String(nov.docs[0].data().description || '').includes('diciembre') && String(nov.docs[0].data().description || '').includes('Objetivo Ind'));
const audit = await db.collection('audit_logs').where('slaId', '==', first.slaId).get();
check('audit_logs', audit.size >= 1);

if (failed) {
  console.error(`S8_RENOVAR_FAIL ${failed}`);
  process.exit(1);
}
console.log('S8_RENOVAR_OK');
