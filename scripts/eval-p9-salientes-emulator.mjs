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
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
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
    pending.isPendingClose === true && pending.retentionMinutes === 6 && inActivos && shiftMatchesOpsViewTab(tab, 'RETENIDOS', nowDate),
    `pending=${pending.isPendingClose} min=${pending.retentionMinutes} activos=${inActivos}`,
  );
  const held = classify(ar(11, 30).toDate(), END.toDate(), { isPresent: true, isRetention: true, code: 'M' });
  const heldTab = { ...held, isFranco: false };
  report(
    'ui retenido sigue en activos',
    held.isRetention === true && held.retentionMinutes === 6 && shiftMatchesOpsViewTab(heldTab, 'ACTIVOS', nowDate) && shiftMatchesOpsViewTab(heldTab, 'RETENIDOS', nowDate),
    `ret=${held.isRetention} min=${held.retentionMinutes}`,
  );

  await casoRioPrimero();
  await casoRelevoProgramadoLegacy();

  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exitCode = 1;
  console.log(`P9 ${results.length - failed.length}/${results.length}`);
}

/** A — H. Río Primero: el operador da presente a Banega T (14:56) eligiendo a Molina M2. */
async function casoRioPrimero() {
  const oid = 'p9a_rio_primero';
  const base = { empresaId: 'p9a_emp', objectiveId: oid, objectiveName: 'H. Rio Primero', positionName: 'Puesto 1' };
  await db.collection('servicios_sla').doc('p9a_sla').set({
    objectiveId: oid, clientId: 'p9a_cli', status: 'active', startDate: '2026-01-01', endDate: '2027-12-31',
    positions: [{
      name: 'Puesto 1', quantity: 1, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
        { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8 },
        { code: 'M2', startTime: '07:00', endTime: '15:00', hours: 8 },
      ],
    }],
  });
  await db.batch()
    .set(db.collection('turnos').doc('p9a_coronel'), { ...base, ...present({ employeeId: 'e_coronel', employeeName: 'CORONEL', code: 'M', startTime: ar(7, 0), endTime: END, realStartTime: ar(7, 0), checkInTime: ar(6, 58) }) })
    .set(db.collection('turnos').doc('p9a_molina'), { ...base, ...present({ employeeId: 'e_molina', employeeName: 'MOLINA', code: 'M2', startTime: ar(7, 0), endTime: END, realStartTime: ar(7, 0), checkInTime: ar(7, 3) }) })
    .set(db.collection('turnos').doc('p9a_banega'), { ...base, employeeId: 'e_banega', employeeName: 'BANEGA', code: 'T', status: 'PENDING', startTime: END, endTime: ar(23, 0) })
    .commit();

  const res = await registrarPresencia(db, {
    shiftId: 'p9a_banega', source: 'OPERATIONS', empId: 'e_banega',
    recordedAt: '2026-09-29T14:56:12-03:00', overrideRelieveShiftId: 'p9a_molina',
  });
  const molina1 = (await db.collection('turnos').doc('p9a_molina').get()).data() || {};
  const coronel1 = (await db.collection('turnos').doc('p9a_coronel').get()).data() || {};
  const okA1 = res.relieved?.shiftId === 'p9a_coronel' && res.relieved?.scheduled === true
    && !molina1.relievedBy && molina1.isCompleted !== true
    && coronel1.relievedBy === 'e_banega' && coronel1.isCompleted !== true
    && coronel1.relieveScheduledAt?.toMillis?.() === END.toMillis();
  report('A rio primero: override M2 → releva al M de la serie a las 15:00', okA1,
    okA1 ? 'Coronel programado 15:00, Molina intacto' : `relieved=${res.relieved?.shiftId}/${res.relieved?.scheduled} molinaBy=${molina1.relievedBy} coronelBy=${coronel1.relievedBy} sched=${coronel1.relieveScheduledAt?.toMillis?.()}`);

  await runAutoCompletarTurnosPass(db, ctx, ar(15, 1));
  const molina2 = (await db.collection('turnos').doc('p9a_molina').get()).data() || {};
  const coronel2 = (await db.collection('turnos').doc('p9a_coronel').get()).data() || {};
  const okA2 = coronel2.completionReason === 'RELEVO_PROGRAMADO'
    && coronel2.realEndTime?.toMillis?.() === END.toMillis()
    && molina2.isCompleted === true && molina2.isRetention !== true
    && molina2.realEndTime?.toMillis?.() === END.toMillis()
    && ['SIN_CONTINUIDAD_SLA', 'SIN_LUGAR_FRANJA'].includes(String(molina2.completionReason));
  report('A rio primero: cron 15:01 cierra Coronel por relevo y Molina a su hora sin retención', okA2,
    okA2 ? `coronel=${coronel2.completionReason} molina=${molina2.completionReason}`
      : `coronel=${coronel2.completionReason}/${coronel2.realEndTime?.toMillis?.()} molina=${molina2.completionReason}/ret=${molina2.isRetention}/end=${molina2.realEndTime?.toMillis?.()}`);
}

/** B — Peaje legacy: BOSIO relievedBy GARCIA (M2, misma salida) con relieveScheduledAt 15:00. */
async function casoRelevoProgramadoLegacy() {
  const oid = 'p9b_peaje';
  const base = { empresaId: 'p9b_emp', objectiveId: oid, objectiveName: 'Peaje legacy', positionName: 'Puesto 2' };
  await db.collection('servicios_sla').doc('p9b_sla').set({
    objectiveId: oid, clientId: 'p9b_cli', status: 'active', startDate: '2026-01-01', endDate: '2027-12-31',
    positions: [{
      name: 'Puesto 2', quantity: 2, coverageType: 'custom', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      allowedShiftTypes: [
        { code: 'M', startTime: '11:30', endTime: '15:00', hours: 8 },
        { code: 'M2', startTime: '11:45', endTime: '15:00', hours: 8 },
        { code: 'T', startTime: '15:00', endTime: '16:00', hours: 8 },
        { code: 'T2', startTime: '15:30', endTime: '16:30', hours: 8 },
      ],
    }],
  });
  await db.batch()
    .set(db.collection('turnos').doc('p9b_bosio'), { ...base, ...present({ employeeId: 'e_bosio', employeeName: 'BOSIO', code: 'M', startTime: ar(11, 30), endTime: END, checkInTime: ar(11, 21), realStartTime: ar(11, 30), relievedBy: 'e_garcia', relievedByName: 'GARCIA', relieveScheduledAt: END, relievedEarly: true, autoRelevo: true }) })
    .set(db.collection('turnos').doc('p9b_garcia'), { ...base, ...present({ employeeId: 'e_garcia', employeeName: 'GARCIA', code: 'M2', startTime: ar(11, 45), endTime: END, checkInTime: ar(11, 31), realStartTime: ar(11, 45) }) })
    .set(db.collection('turnos').doc('p9b_lopez'), { ...base, employeeId: 'e_lopez', employeeName: 'LOPEZ', code: 'T', status: 'PENDING', startTime: END, endTime: ar(16, 0) })
    .set(db.collection('turnos').doc('p9b_gonzalez'), { ...base, employeeId: 'e_gonzalez', employeeName: 'GONZALEZ', code: 'T2', status: 'PENDING', startTime: ar(15, 30), endTime: ar(16, 30) })
    .commit();

  await runAutoCompletarTurnosPass(db, ctx, ar(15, 0));
  const bosio = (await db.collection('turnos').doc('p9b_bosio').get()).data() || {};
  const garcia = (await db.collection('turnos').doc('p9b_garcia').get()).data() || {};
  const okB = bosio.isCompleted !== true && bosio.isRetention === true
    && String(bosio.retentionReason || '').startsWith('RELEVO_NO_PRESENTADO')
    && !bosio.relievedBy && !bosio.relieveScheduledAt && bosio.staleReliefPrevious?.relievedBy === 'e_garcia'
    && garcia.isCompleted !== true && garcia.isRetention === true;
  report('B legacy: relieveScheduledAt contra compañero se ignora; Bosio y Garcia retenidos', okB,
    okB ? `bosio=${bosio.retentionReason}` : `bosio=${bosio.completionReason}/ret=${bosio.isRetention}/by=${bosio.relievedBy} garcia=${garcia.completionReason}/ret=${garcia.isRetention}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
