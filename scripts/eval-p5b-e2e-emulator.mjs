/**
 * P5b E2E en emulador aislado (no el lab :8080).
 *
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-p5b "node scripts/eval-p5b-e2e-emulator.mjs"
 *
 * Requiere `npx tsc -p apps/functions --pretty false` (lib/).
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-p5b';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Falta FIRESTORE_EMULATOR_HOST. Usar firebase.e2e-p2.json (puerto 8190).');
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Este E2E no corre contra el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { runShiftArrivalNotices } = requireFn('./lib/attendance/arrivalNotices.js');
const { loadCentroControlState } = requireFn('./lib/ops/centroControlGuard.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');

const EMP = 'p5b_e2e';
const OBJ = 'obj_obrador';
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const start = new Date('2026-09-29T08:00:00-03:00');
const startTs = Timestamp.fromDate(start);

async function reset() {
  for (const col of ['turnos', 'user_notifications', 'convocatorias_cobertura', 'empleados']) {
    const snap = await db.collection(col).where('empresaId', '==', EMP).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }
  await db.collection('empresas').doc(EMP).set({
    centroControlEnabled: true,
    modoDemoEnabled: false,
    nombre: 'P5b',
  });
  await db.collection('clients').doc('cli_p5b').set({
    empresaId: EMP,
    status: 'ACTIVO',
    name: 'Malagueño',
  });
  await db.collection('servicios_sla').doc('sla_p5b').set({
    empresaId: EMP,
    objectiveId: OBJ,
    clientId: 'cli_p5b',
    status: 'ACTIVE',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
  });
  await db.collection('planificacion_estados').doc(`${EMP}_${OBJ}_2026_9`).set({
    empresaId: EMP,
    objectiveId: OBJ,
    publishedAt: Timestamp.fromDate(start),
  });
  await db.collection('empleados').doc('emp_araya').set({
    empresaId: EMP,
    uid: 'uid_araya',
    firstName: 'Santiago',
    lastName: 'ARAYA',
    legajo: '3597',
  });
}

function shiftBase(id, extra = {}) {
  return {
    empresaId: EMP,
    employeeId: 'emp_araya',
    employeeName: 'ARAYA Santiago',
    objectiveId: OBJ,
    objectiveName: 'Obrador Malagueño',
    positionName: 'Puesto 1',
    clientId: 'cli_p5b',
    clientName: 'Malagueño',
    code: 'M',
    startTime: startTs,
    endTime: Timestamp.fromDate(new Date('2026-09-29T16:00:00-03:00')),
    status: 'ASSIGNED',
    isPresent: false,
    ...extra,
    id,
  };
}

async function main() {
  await db.collection('_ping').doc('p5b').set({ t: Date.now() });
  await reset();

  const on = shiftBase('shift_on');
  delete on.id;
  await db.collection('turnos').doc('shift_on').set(on);
  const off = shiftBase('shift_off', { objectiveId: 'obj_fuera' });
  delete off.id;
  await db.collection('turnos').doc('shift_off').set(off);

  const atHeads = Timestamp.fromDate(new Date(start.getTime() - 5 * 60_000));
  const cc = await loadCentroControlState(db);
  const n1 = await runShiftArrivalNotices(db, atHeads, cc);
  const n2 = await runShiftArrivalNotices(db, atHeads, cc);
  const notes = await db.collection('user_notifications').where('empresaId', '==', EMP).where('type', '==', 'AVISO_TURNO_PROXIMO').get();
  const bodies = notes.docs.map((d) => d.data().body || '');
  report('T-5 una vez', n1 === 1 && n2 === 0 && notes.size === 1, `n1=${n1} n2=${n2} docs=${notes.size}`);
  report('T-5 nombres', bodies.some((b) => b.includes('Obrador Malagueño') && b.includes('Puesto 1') && b.includes('08:00')), bodies[0] || '');
  const offFlag = (await db.collection('turnos').doc('shift_off').get()).data()?.preStartArrivalNoticeAt;
  report('fuera de operacion', !offFlag, 'sin aviso');

  const atT = Timestamp.fromDate(start);
  const v1 = await runShiftArrivalNotices(db, atT, cc);
  const v2 = await runShiftArrivalNotices(db, atT, cc);
  const conv = await db.collection('convocatorias_cobertura').where('empresaId', '==', EMP).where('type', '==', 'LLEGADA_TARDE').get();
  const body = conv.empty ? '' : '';
  const notifVenis = await db.collection('user_notifications').where('empresaId', '==', EMP).where('shiftId', '==', 'shift_on').get();
  const venisBody = notifVenis.docs.map((d) => String(d.data().body || '')).find((b) => b.includes('¿Venís?')) || '';
  report('venis en T', v1 === 1 && v2 === 0 && conv.size === 1, `v1=${v1} v2=${v2} conv=${conv.size}`);
  report('venis lugar', venisBody.includes('Obrador Malagueño') && venisBody.includes('Puesto 1') && !venisBody.includes('objetivo / puesto'), venisBody);
  void body;

  await registrarPresencia(db, { shiftId: 'shift_on', source: 'PORTAL_GPS', recordedAt: new Date(start.getTime() + 6 * 60_000).toISOString() });
  const after = (await db.collection('turnos').doc('shift_on').get()).data();
  const punch = after.checkInAt?.toMillis?.();
  const paid = after.realStartTime?.toMillis?.();
  report('checkInAt T+6', punch === start.getTime() + 6 * 60_000 && paid === punch && after.lateMinutes === 6 && after.isLate === true, `punch=${punch} paid=${paid} late=${after.lateMinutes}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
