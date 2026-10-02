/**
 * El revisor ficha y cierra sin ausencia automática ni alertas del Centro de Control.
 * Hay SLA y cronograma publicado a propósito: sin el flag, el T−5 y el cierre del cron correrían.
 *
 * firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-play-review "node scripts/eval-play-review-emulator.mjs"
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-play-review' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const repoRoot = path.join(__dirname, '..');
const packed = spawnSync(
  'npx',
  [
    '--yes', 'esbuild',
    'apps/functions/src/attendance/markShiftAbsent.ts',
    'apps/functions/src/attendance/arrivalNotices.ts',
    'apps/functions/src/scheduling/autoCompletarTurnosCore.ts',
    'apps/functions/src/fichajes/registrarPresencia.ts',
    'apps/functions/src/fichajes/cerrarTurnoRevision.ts',
    '--bundle', '--platform=node', '--format=cjs',
    '--outdir=apps/functions/.e2e-play', '--packages=external',
  ],
  { cwd: repoRoot, shell: true, stdio: 'inherit' },
);
if (packed.status !== 0) process.exit(packed.status || 1);

const { markShiftAbsent } = requireFn('./.e2e-play/attendance/markShiftAbsent.js');
const { runShiftArrivalNotices } = requireFn('./.e2e-play/attendance/arrivalNotices.js');
const { runAutoCompletarTurnosPass } = requireFn('./.e2e-play/scheduling/autoCompletarTurnosCore.js');
const { registrarPresencia } = requireFn('./.e2e-play/fichajes/registrarPresencia.js');
const { cerrarTurnoRevision } = requireFn('./.e2e-play/fichajes/cerrarTurnoRevision.js');

const EMPRESA = 'pruebas_sa';
const OBJ = 'obj_play_review';
const EMP = 'play_review_01';
const nowMs = Date.now();
const now = Timestamp.fromMillis(nowMs);
const ar = new Date(nowMs - 3 * 60 * 60 * 1000);
const year = ar.getUTCFullYear();
const month = ar.getUTCMonth() + 1;

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

await db.collection('empresas').doc(EMPRESA).set({ centroControlEnabled: true, modoDemoEnabled: false });
await db.collection('clients').doc('client_play_review').set({
  name: 'Cliente Revisión Play',
  empresaId: EMPRESA,
  status: 'ACTIVE',
  active: true,
  excluirDeOperacion: true,
  reviewPlay: true,
});
await db.collection('objetivos').doc(OBJ).set({
  id: OBJ,
  name: 'Objetivo Revisión Play',
  empresaId: EMPRESA,
  clientId: 'client_play_review',
  status: 'ACTIVE',
  active: true,
  excluirDeOperacion: true,
  reviewPlay: true,
});
await db.collection('empleados').doc(EMP).set({
  uid: 'uid_play_review',
  empresaId: EMPRESA,
  email: 'cosp@bacarsa.com.ar',
  fichadaRemota: true,
  bypassDeviceCheck: true,
  status: 'ACTIVE',
});
await db.collection('servicios_sla').doc('sla_play_review').set({
  empresaId: EMPRESA,
  clientId: 'client_play_review',
  objectiveId: OBJ,
  status: 'ACTIVE',
  startDate: `${year}-01-01`,
  endDate: `${year}-12-31`,
});
const published = { empresaId: EMPRESA, objectiveId: OBJ, year, month, publishedAt: now, status: 'PUBLISHED' };
await db.collection('planificacion_estados').doc(`${EMPRESA}_${OBJ}_${year}_${month}`).set(published);
await db.collection('planificacion_estados').doc(`${OBJ}_${year}_${month}`).set(published);

const base = {
  empresaId: EMPRESA,
  clientId: 'client_play_review',
  objectiveId: OBJ,
  objectiveName: 'Objetivo Revisión Play',
  positionName: 'Puesto Revisión',
  employeeId: EMP,
  employeeName: 'Play, Review',
  code: 'M',
  excluirDeOperacion: true,
  draft: false,
  isFranco: false,
  isAbsent: false,
};

await db.collection('turnos').doc('play_tarde').set({
  ...base,
  status: 'Assigned',
  isPresent: false,
  isCompleted: false,
  startTime: Timestamp.fromMillis(nowMs - 45 * 60 * 1000),
  endTime: Timestamp.fromMillis(nowMs + 6 * 60 * 60 * 1000),
});
await db.collection('turnos').doc('play_aviso').set({
  ...base,
  status: 'Assigned',
  isPresent: false,
  isCompleted: false,
  startTime: Timestamp.fromMillis(nowMs + 3 * 60 * 1000),
  endTime: Timestamp.fromMillis(nowMs + 8 * 60 * 60 * 1000),
});
await db.collection('turnos').doc('play_cierre').set({
  ...base,
  status: 'PRESENT',
  isPresent: true,
  isCompleted: false,
  startTime: Timestamp.fromMillis(nowMs - 9 * 60 * 60 * 1000),
  endTime: Timestamp.fromMillis(nowMs - 30 * 60 * 1000),
  realStartTime: Timestamp.fromMillis(nowMs - 9 * 60 * 60 * 1000),
});

const absent = await markShiftAbsent(db, 'play_tarde', { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
const tarde = (await db.collection('turnos').doc('play_tarde').get()).data();
report('AUTO_T30 no marca ausencia', absent.applied === false && tarde.isAbsent !== true, JSON.stringify(absent));

const cc = {
  anyEnabled: true,
  isEnabled: () => true,
  isDemo: () => false,
};
const sent = await runShiftArrivalNotices(db, now, cc);
const aviso = (await db.collection('turnos').doc('play_aviso').get()).data();
report(
  'T−5 no avisa',
  sent === 0 && !aviso.preStartArrivalNoticeAt && !aviso.earlyRetentionAlertAt,
  `sent=${sent}`,
);

const pass = await runAutoCompletarTurnosPass(db, {}, now, { onlyOutgoingShiftId: 'play_cierre' });
const cierre = (await db.collection('turnos').doc('play_cierre').get()).data();
report(
  'el cron no cierra ni retiene',
  pass.completed === 0 && cierre.isCompleted !== true && cierre.isRetention !== true && !cierre.realEndTime,
  `completed=${pass.completed}`,
);

const punch = await registrarPresencia(db, {
  shiftId: 'play_tarde',
  source: 'PORTAL_GPS',
  empId: EMP,
  fichadaRemota: true,
  skipAutoRelevo: true,
});
const punched = (await db.collection('turnos').doc('play_tarde').get()).data();
report('el revisor ficha', punch.success === true && punched.isPresent === true, JSON.stringify(punch));

const closed = await cerrarTurnoRevision(db, { shiftId: 'play_tarde', empId: EMP });
const afterClose = (await db.collection('turnos').doc('play_tarde').get()).data();
report(
  'el revisor cierra sin retención',
  closed.closed === true && afterClose.isCompleted === true && afterClose.isRetention !== true,
  JSON.stringify(closed),
);

const ausencias = await db.collection('ausencias').get();
const novedades = await db.collection('novedades').get();
const notifs = await db.collection('user_notifications').get();
report(
  'sin AA, novedades ni alertas',
  ausencias.empty && novedades.empty && notifs.empty,
  `aus=${ausencias.size} nov=${novedades.size} notif=${notifs.size}`,
);

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`${failed.length} fallas`);
  process.exit(1);
}
console.log(`${results.length} ok`);
