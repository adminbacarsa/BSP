/**
 * P5 ventana del convocado + P6 eventos. Emulador aislado.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-p5p6 "node scripts/eval-p5-p6-e2e-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-p5p6';
admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { runConvocadoAbsentPass } = requireFn('./lib/attendance/convocadoAbsentPass.js');
const { loadCentroControlState } = requireFn('./lib/ops/centroControlGuard.js');
const { crearConvocatoriaDoc } = requireFn('./lib/coverage/convocatoriasCobertura.js');

const EMP = 'p5p6_e2e';
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const accepted = new Date('2026-09-26T16:00:00-03:00');
const shift = {
  origin: 'OPERATIONS_COVERAGE',
  coverageType: 'FT',
  startTime: Timestamp.fromDate(new Date('2026-09-26T15:00:00-03:00')),
  endTime: Timestamp.fromDate(new Date('2026-09-26T23:00:00-03:00')),
  acceptedAt: Timestamp.fromDate(accepted),
};

function at(iso) {
  return new Date(iso).getTime();
}

async function main() {
  const onTime = evaluateServerCheckInWindow(shift, at('2026-09-26T16:20:00-03:00'));
  report('a tiempo +20', onTime.allowed === true && !onTime.lateNoNotice && onTime.usePlannedStart === false, JSON.stringify(onTime));
  const late = evaluateServerCheckInWindow(shift, at('2026-09-26T16:40:00-03:00'));
  report('tarde +40', late.allowed === true && late.lateNoNotice === true && late.lateMinutes === 10, JSON.stringify(late));
  const over = evaluateServerCheckInWindow(shift, at('2026-09-26T17:01:00-03:00'));
  report('tope +61', over.rejectCode === 'TOO_LATE', over.rejectCode || '');

  await db.collection('empresas').doc(EMP).set({ centroControlEnabled: true, modoDemoEnabled: false });
  await db.collection('turnos').doc('cov_p5').set({
    ...shift,
    empresaId: EMP,
    employeeId: 'emp1',
    employeeName: 'Barrionuevo',
    objectiveId: 'obj1',
    isPresent: false,
    isAbsent: false,
  });
  const cc = await loadCentroControlState(db);
  const before = await runConvocadoAbsentPass(db, Timestamp.fromDate(new Date('2026-09-26T16:50:00-03:00')), cc);
  const mid = (await db.collection('turnos').doc('cov_p5').get()).data();
  report('no ausente antes del tope', before === 0 && mid.isAbsent !== true, `n=${before}`);
  const after = await runConvocadoAbsentPass(db, Timestamp.fromDate(new Date('2026-09-26T17:02:00-03:00')), cc);
  const end = (await db.collection('turnos').doc('cov_p5').get()).data();
  report('ausente al tope', after === 1 && end.isAbsent === true, `n=${after} absent=${end.isAbsent}`);

  const convId = await crearConvocatoriaDoc(db, {
    empresaId: EMP,
    shiftId: 'titular1',
    objectiveId: 'obj1',
    objectiveName: 'CAPS',
    positionName: 'Puesto 1',
    clientName: 'Cliente',
    shiftCode: 'M',
    startTime: Timestamp.fromDate(new Date('2026-09-26T15:00:00-03:00')),
    type: 'FT',
    cascadeStep: 5,
    candidateEmployeeId: 'emp2',
    candidateEmployeeName: 'Candidato',
    createdBy: 'AUTO',
  });
  const ev = await db.collection('convocatorias_cobertura').doc(convId).collection('eventos').get();
  const creada = ev.docs.map((d) => d.data()).find((e) => e.type === 'CREADA');
  report('evento CREADA AUTO', !!creada && creada.origin === 'AUTO', JSON.stringify(creada || null));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
