/**
 * P9 — Peaje 9 Norte, 29/09/2026 15:06 AR.
 * 5 salientes PRESENT sin cierre; T a las 15:00 y T2 a las 15:30.
 * Emulador aislado (no el lab :8080):
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-p9 "node scripts/eval-p9-salientes-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { register } from 'node:module';

await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-p9' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { classifyOpsShift } = await import(pathToFileURL(path.join(__dirname, '../packages/ops-core/src/classifyOpsShift.ts')).href);
const { shiftMatchesOpsViewTab } = await import(pathToFileURL(path.join(__dirname, '../packages/ops-core/src/shiftMatchesOpsViewTab.ts')).href);

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const ar = (h, min) => Timestamp.fromDate(new Date(`2026-09-29T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-03:00`));
const END = ar(15, 0);
const NOW = ar(15, 6);

const ctx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

function present(extra) {
  return {
    status: 'PRESENT',
    isPresent: true,
    isCompleted: false,
    isAbsent: false,
    ...extra,
  };
}

async function main() {
  const oid = 'p9_peaje';
  const emp = 'p9_emp';
  const band = (code, start, end, quantity) => ({ code, startTime: start, endTime: end, hours: 8, quantity });
  await db.collection('servicios_sla').doc('p9_sla').set({
    objectiveId: oid,
    clientId: 'p9_cli',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    positions: [
      {
        name: 'Puesto 2',
        quantity: 4,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        allowedShiftTypes: [
          band('M', '11:30', '15:00', 2),
          band('M2', '11:45', '15:00', 2),
          band('T', '15:00', '16:00', 2),
          band('T2', '15:30', '19:30', 2),
        ],
      },
      {
        name: 'Puesto 1',
        quantity: 2,
        coverageType: 'custom',
        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
        allowedShiftTypes: [
          band('M2', '11:00', '15:00', 1),
          band('M3', '12:00', '16:00', 1),
          band('T2', '15:00', '17:00', 1),
          band('T3', '16:00', '20:00', 1),
        ],
      },
    ],
  });

  const base = { empresaId: emp, objectiveId: oid, objectiveName: 'Peaje 9 Norte' };
  const rows = [
    ['ferrero', present({ employeeName: 'FERRERO', employeeId: 'e_ferrero', code: 'M', positionName: 'Puesto 2', startTime: ar(11, 30), endTime: END, checkInTime: ar(11, 30) })],
    ['bosio', present({ employeeName: 'BOSIO', employeeId: 'e_bosio', code: 'M', positionName: 'Puesto 2', startTime: ar(11, 30), endTime: END, checkInTime: ar(11, 40), relievedBy: 'e_garcia', relievedByName: 'GARCIA', relieveScheduledAt: END, relievedEarly: true })],
    ['cardo', present({ employeeName: 'CARDO', employeeId: 'e_cardo', code: 'M2', positionName: 'Puesto 2', startTime: ar(11, 45), endTime: END, checkInTime: ar(11, 45), relievedBy: 'e_ferrero', relievedByName: 'FERRERO', relieveScheduledAt: END, relievedEarly: true })],
    ['garcia', present({ employeeName: 'GARCIA', employeeId: 'e_garcia', code: 'M2', positionName: 'Puesto 2', startTime: ar(11, 45), endTime: END, checkInTime: ar(11, 50) })],
    ['fantini', present({ employeeName: 'FANTINI', employeeId: 'e_fantini', code: 'M2', positionName: 'Puesto 1', startTime: ar(11, 0), endTime: END, checkInTime: ar(11, 28), realStartTime: ar(11, 28) })],
    ['farias', present({ employeeName: 'FARIAS', employeeId: 'e_farias', code: 'M3', positionName: 'Puesto 1', startTime: ar(12, 0), endTime: ar(16, 0), checkInTime: ar(12, 0) })],
    ['lopez', { employeeName: 'LOPEZ', employeeId: 'e_lopez', code: 'T', positionName: 'Puesto 2', status: 'PENDING', startTime: ar(15, 0), endTime: ar(16, 0) }],
    ['brizuela', { employeeName: 'BRIZUELA', employeeId: 'e_brizuela', code: 'T', positionName: 'Puesto 2', status: 'PENDING', startTime: ar(15, 0), endTime: ar(16, 0) }],
    ['fontana', { employeeName: 'FONTANA', employeeId: 'e_fontana', code: 'T2', positionName: 'Puesto 1', status: 'PENDING', startTime: ar(15, 0), endTime: ar(17, 0) }],
    ['bazan', { employeeName: 'BAZAN', employeeId: 'e_bazan', code: 'T2', positionName: 'Puesto 2', status: 'PENDING', startTime: ar(15, 30), endTime: ar(19, 30) }],
    ['gonzalez', { employeeName: 'GONZALEZ', employeeId: 'e_gonzalez', code: 'T2', positionName: 'Puesto 2', status: 'PENDING', startTime: ar(15, 30), endTime: ar(19, 30) }],
    ['venencia', { employeeName: 'VENENCIA', employeeId: 'e_venencia', code: 'T3', positionName: 'Puesto 1', status: 'PENDING', startTime: ar(16, 0), endTime: ar(20, 0) }],
  ];
  const batch = db.batch();
  for (const [id, data] of rows) batch.set(db.collection('turnos').doc(`p9_${id}`), { ...base, ...data });
  await batch.commit();

  await runAutoCompletarTurnosPass(db, ctx, NOW);

  const retained = ['ferrero', 'bosio', 'cardo', 'garcia', 'fantini'];
  for (const id of retained) {
    const d = (await db.collection('turnos').doc(`p9_${id}`).get()).data() || {};
    const reason = String(d.retentionReason || '');
    const ok = d.isRetention === true
      && d.isCompleted !== true
      && !d.realEndTime
      && reason.startsWith('RELEVO_NO_PRESENTADO')
      && d.retentionStartedAt?.toMillis?.() === END.toMillis();
    report(id, ok, ok ? reason : `ret=${d.isRetention} reason=${reason} end=${d.completionReason || '-'} started=${d.retentionStartedAt?.toMillis?.()}`);
  }

  const farias = (await db.collection('turnos').doc('p9_farias').get()).data() || {};
  report('farias sigue', farias.isRetention !== true && farias.isCompleted !== true && !farias.realEndTime, `ret=${farias.isRetention} end=${farias.completionReason || '-'}`);

  const nowDate = NOW.toDate();
  const classify = (start, end, flags) => classifyOpsShift({
    shift: {
      ...flags,
      employeeId: 'e',
      shiftDateObj: start,
      endDateObj: end,
    },
    now: nowDate,
    isValidEmployee: true,
    isFranco: false,
    shiftCode: flags.code,
    effectiveEndDateObj: end,
  });
  const pending = classify(ar(11, 30).toDate(), END.toDate(), { isPresent: true, code: 'M' });
  const tab = { ...pending, isFranco: false };
  const inActivos = shiftMatchesOpsViewTab(tab, 'ACTIVOS', nowDate);
  report(
    'ui esperando relevo',
    pending.isPendingClose === true && pending.retentionMinutes === 6 && inActivos && !shiftMatchesOpsViewTab(tab, 'RETENIDOS', nowDate),
    `pending=${pending.isPendingClose} min=${pending.retentionMinutes} activos=${inActivos}`,
  );
  const held = classify(ar(11, 30).toDate(), END.toDate(), { isPresent: true, isRetention: true, code: 'M' });
  const heldTab = { ...held, isFranco: false };
  report(
    'ui retenido sigue en activos',
    held.isRetention === true && held.retentionMinutes === 6 && shiftMatchesOpsViewTab(heldTab, 'ACTIVOS', nowDate) && shiftMatchesOpsViewTab(heldTab, 'RETENIDOS', nowDate),
    `ret=${held.isRetention} min=${held.retentionMinutes}`,
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exitCode = 1;
  console.log(`P9 ${results.length - failed.length}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
