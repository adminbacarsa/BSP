/**
 * Fichada de un REF/ESC/RET que es fuente de un ops_cov del mismo horario:
 * la presencia queda en la cobertura, la fuente no suma horas, y no sale ¿Venís?.
 *
 * firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-fichada-fuente "node scripts/eval-fichada-cobertura-fuente-emulator.mjs"
 */
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-fichada-fuente' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { processPortalCheckIn } = requireFn('./lib/fichajes/applyPortalCheckIn.js');
const { applyCoverage } = requireFn('./lib/coverage/syncAusenciaCobertura.js');
const { buildOpsCoverageDocId } = requireFn('./lib/coverage/syncAusenciaCobertura.js');
const { runShiftArrivalNotices } = requireFn('./lib/attendance/arrivalNotices.js');
const { loadCentroControlState } = requireFn('./lib/ops/centroControlGuard.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const P = `fichada_${Date.now()}`;
const EMP = `${P}_emp`;
const OBJ = `${P}_obj`;
const id = (n) => `${P}_${n}`;
const ar = (h, min, s = 0) => Timestamp.fromDate(new Date(
  `2026-10-07T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}-03:00`,
));
const reloj = (data) => !!(data?.realStartTime || data?.checkInAt);

async function base({ tit, fuente, emp, nombre }) {
  await db.collection('turnos').doc(tit).set({
    empresaId: EMP, objectiveId: OBJ, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2',
    employeeId: id('titular'), employeeName: 'TITULAR', code: 'M2',
    startTime: ar(11, 45), endTime: ar(15, 30), isAbsent: true, status: 'ABSENT',
  });
  await db.collection('turnos').doc(fuente).set({
    empresaId: EMP, objectiveId: OBJ, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2',
    employeeId: emp, employeeName: nombre, code: 'REF',
    startTime: ar(11, 45), endTime: ar(15, 30), status: 'PENDING', isPresent: false,
  });
  await db.collection('empleados').doc(emp).set({ empresaId: EMP, firstName: 'Franco', nombre });
}

function sinHoras(src, cov) {
  return cov?.isPresent === true
    && cov?.status === 'PRESENT'
    && reloj(cov)
    && src?.isPresent !== true
    && !reloj(src)
    && src?.coverageUsed === true
    && src?.status === 'CANCELLED';
}

async function main() {
  const emp = id('kopp');
  const tit = id('tit');
  const fuente = id('ref');
  await base({ tit, fuente, emp, nombre: 'KOPP' });

  await registrarPresencia(db, {
    shiftId: fuente,
    source: 'OPERATIONS',
    empId: emp,
    recordedAt: '2026-10-07T11:37:08-03:00',
  });
  const antes = (await db.collection('turnos').doc(fuente).get()).data();
  report('antes de aceptar: la fichada queda en el REF', antes?.isPresent === true, antes?.status || '');

  const batch = db.batch();
  const covId = await applyCoverage(db, batch, {
    titularShiftId: tit,
    candidateEmployeeId: emp,
    candidateEmployeeName: 'KOPP',
    sourceShiftId: fuente,
    coverageType: 'REF',
    resolvedBy: 'OPERACIONES',
    empresaId: EMP,
    startTime: ar(11, 45),
    endTime: ar(15, 30),
    code: 'M2',
    objectiveId: OBJ,
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 2',
  });
  await batch.commit();
  const srcAntes = (await db.collection('turnos').doc(fuente).get()).data();
  const covAntes = (await db.collection('turnos').doc(covId).get()).data();
  report(
    'fichada antes de aceptar: ops_cov presente, fuente sin horas',
    sinHoras(srcAntes, covAntes) && covAntes?.checkInAt?.toMillis?.() === antes?.checkInAt?.toMillis?.(),
    `cov=${covAntes?.status} fuente=${srcAntes?.status} used=${srcAntes?.coverageUsed}`,
  );
  report(
    'un solo turno: código del titular y origen REF',
    covAntes?.code === 'M2'
      && covAntes?.codigoOriginal === 'REF'
      && covAntes?.coverageForShiftId === tit
      && srcAntes?.isDeleted === true,
    `code=${covAntes?.code} origen=${covAntes?.codigoOriginal}`,
  );

  const emp0 = id('sin_fichar');
  const tit0 = id('tit0');
  const fuente0 = id('ref0');
  await base({ tit: tit0, fuente: fuente0, emp: emp0, nombre: 'SIN' });
  const batch0 = db.batch();
  const cov0 = await applyCoverage(db, batch0, {
    titularShiftId: tit0,
    candidateEmployeeId: emp0,
    candidateEmployeeName: 'SIN',
    sourceShiftId: fuente0,
    coverageType: 'REF',
    resolvedBy: 'OPERACIONES',
    empresaId: EMP,
    startTime: ar(11, 45),
    endTime: ar(15, 30),
    code: 'M2',
    objectiveId: OBJ,
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 2',
  });
  await batch0.commit();
  const src0 = (await db.collection('turnos').doc(fuente0).get()).data();
  const cov0d = (await db.collection('turnos').doc(cov0).get()).data();
  const vivos = [src0, cov0d].filter((d) => d && d.isDeleted !== true && String(d.status || '').toUpperCase() !== 'CANCELLED');
  report(
    'sin fichar igual hay un solo turno, el del titular',
    vivos.length === 1 && vivos[0]?.code === 'M2' && src0?.isDeleted === true && cov0d?.codigoOriginal === 'REF',
    `vivos=${vivos.length} code=${cov0d?.code}`,
  );

  const emp2 = id('kopp2');
  const tit2 = id('tit2');
  const fuente2 = id('ref2');
  const cov2 = buildOpsCoverageDocId(tit2, emp2);
  await base({ tit: tit2, fuente: fuente2, emp: emp2, nombre: 'KOPP2' });
  await db.collection('turnos').doc(cov2).set({
    empresaId: EMP, objectiveId: OBJ, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2',
    employeeId: emp2, employeeName: 'KOPP2', code: 'M2', coverageType: 'REF',
    origin: 'OPERATIONS_COVERAGE', sourceShiftId: fuente2, absenceShiftId: tit2,
    startTime: ar(11, 45), endTime: ar(15, 30), status: 'PENDING', isPresent: false,
    acceptedAt: ar(11, 36),
    isAwaitingCoverageCheckIn: true,
  });
  await processPortalCheckIn(db, {
    shiftId: fuente2,
    empId: emp2,
    recordedAt: '2026-10-07T11:37:08-03:00',
    idempotencyKey: id('portal'),
    source: 'PORTAL_GPS',
  });
  const srcDesp = (await db.collection('turnos').doc(fuente2).get()).data();
  const covDesp = (await db.collection('turnos').doc(cov2).get()).data();
  report(
    'fichada después de aceptar: ops_cov presente, fuente sin horas',
    sinHoras(srcDesp, covDesp),
    `cov=${covDesp?.status} fuente=${srcDesp?.status} relojFuente=${reloj(srcDesp)}`,
  );

  const avisoEmp = id('aviso');
  const avisoFuente = id('aviso_ref');
  const avisoCov = id('aviso_cov');
  const control = id('control');
  const start = ar(11, 45);
  const now = ar(11, 45, 20);
  await db.collection('empresas').doc(EMP).set({ centroControlEnabled: true, modoDemoEnabled: false, nombre: 'Pruebas' });
  await db.collection('clients').doc(id('cli')).set({ empresaId: EMP, status: 'ACTIVO', name: 'Cliente' });
  await db.collection('servicios_sla').doc(id('sla')).set({
    empresaId: EMP, objectiveId: OBJ, clientId: id('cli'), status: 'ACTIVE',
    startDate: '2026-10-01', endDate: '2026-10-31',
  });
  for (const key of [`${EMP}_${OBJ}_2026_10`, `${OBJ}_2026_10`]) {
    await db.collection('planificacion_estados').doc(key).set({
      empresaId: EMP, objectiveId: OBJ, publishedAt: start,
    });
  }
  await db.collection('empleados').doc(avisoEmp).set({ empresaId: EMP, uid: id('uid_ana'), firstName: 'Ana', nombre: 'ANA' });
  await db.collection('empleados').doc(id('control_emp')).set({ empresaId: EMP, uid: id('uid_luis'), firstName: 'Luis', nombre: 'LUIS' });
  await db.collection('turnos').doc(avisoFuente).set({
    empresaId: EMP, objectiveId: OBJ, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2',
    employeeId: avisoEmp, employeeName: 'ANA', code: 'REF',
    startTime: start, endTime: ar(15, 30), isPresent: true, status: 'PRESENT',
    checkInAt: ar(11, 37), realStartTime: start,
  });
  await db.collection('turnos').doc(avisoCov).set({
    empresaId: EMP, objectiveId: OBJ, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2',
    employeeId: avisoEmp, employeeName: 'ANA', code: 'M2', coverageType: 'REF',
    origin: 'OPERATIONS_COVERAGE', sourceShiftId: avisoFuente,
    startTime: start, endTime: ar(15, 30), status: 'PENDING', isPresent: false,
  });
  await db.collection('turnos').doc(control).set({
    empresaId: EMP, objectiveId: OBJ, objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 2',
    employeeId: id('control_emp'), employeeName: 'LUIS', code: 'M2',
    startTime: start, endTime: ar(15, 30), status: 'PENDING', isPresent: false,
  });
  const cc = await loadCentroControlState(db);
  await runShiftArrivalNotices(db, now, cc);
  const tardes = await db.collection('convocatorias_cobertura').where('type', '==', 'LLEGADA_TARDE').get();
  const ids = tardes.docs
    .filter((d) => d.data().empresaId === EMP)
    .map((d) => String(d.data().shiftId || ''));
  report(
    'sin ¿Venís? si la fuente ya fichó',
    !ids.includes(avisoCov) && ids.includes(control),
    ids.join(',') || '(ninguna)',
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
