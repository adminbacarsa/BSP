/**
 * Casos prod 30/09: revertir releva la serie, el cierre por relevo limpia la retención,
 * y un planificado ±30 min de la misma serie no es vacante SLA.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-rev-relevo "node scripts/eval-cc-revertir-relevo-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-rev-relevo' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { revertirAusenciaShift } = requireFn('./lib/attendance/revertirAusencia.js');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { detectPublishedSlaGapsForEmpresa } = requireFn('./lib/coverage/detectPublishedSlaGaps.js');
const { plannedShiftCoversSlaBand } = await import(
  pathToFileURL(path.join(__dirname, '../packages/ops-core/src/gapVacancy.ts')).href
);

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const ctx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

async function casoRevertir() {
  const now = Date.now();
  const tStart = now - 37 * 60 * 1000;
  const mStart = tStart - 8 * 60 * 60 * 1000;
  const empresaId = 'rev_emp';
  const objectiveId = 'obrador';
  const positionName = 'Puesto 1';
  await db.collection('turnos').doc('m_araya').set({
    empresaId, objectiveId, positionName,
    employeeId: 'emp_araya', employeeName: 'ARAYA',
    code: 'M', status: 'PRESENT', isPresent: true,
    isRetention: true, retentionReason: 'MORALES no se presentó',
    retentionAbsenceShiftId: 't_morales',
    startTime: Timestamp.fromMillis(mStart),
    endTime: Timestamp.fromMillis(tStart),
    realStartTime: Timestamp.fromMillis(mStart),
  });
  await db.collection('turnos').doc('m2_otro').set({
    empresaId, objectiveId, positionName,
    employeeId: 'emp_otro', employeeName: 'OTRO',
    code: 'M2', status: 'PRESENT', isPresent: true,
    isRetention: true, retentionReason: 'espera T2',
    startTime: Timestamp.fromMillis(mStart),
    endTime: Timestamp.fromMillis(tStart),
    realStartTime: Timestamp.fromMillis(mStart),
  });
  await db.collection('turnos').doc('t_morales').set({
    empresaId, objectiveId, positionName,
    employeeId: 'emp_morales', employeeName: 'MORALES',
    code: 'T', status: 'ABSENT', isAbsent: true, isPresent: false,
    startTime: Timestamp.fromMillis(tStart),
    endTime: Timestamp.fromMillis(tStart + 8 * 60 * 60 * 1000),
  });

  const rev = await revertirAusenciaShift(db, { shiftId: 't_morales', operatorUid: 'op' });
  const m = (await db.collection('turnos').doc('m_araya').get()).data() || {};
  const m2 = (await db.collection('turnos').doc('m2_otro').get()).data() || {};
  const t = (await db.collection('turnos').doc('t_morales').get()).data() || {};
  const endMs = m.realEndTime?.toMillis?.() ?? 0;
  report('revertir ok', rev.success === true, JSON.stringify(rev));
  report(
    'entrante presente',
    t.isPresent === true && t.isAbsent !== true && t.presenciaSource === 'OPERATIONS',
    `present=${t.isPresent} src=${t.presenciaSource}`,
  );
  report(
    'saliente de la serie cerrado ya',
    m.status === 'COMPLETED' && m.isCompleted === true && Math.abs(endMs - Math.max(tStart, now)) < 15_000,
    `status=${m.status} endDelta=${endMs - now}`,
  );
  report(
    'retención limpiada y minutos conservados',
    m.isRetention !== true && m.retentionReason == null && Number(m.retentionMinutes) >= 30 && m.retentionEndedAt,
    `ret=${m.isRetention} reason=${m.retentionReason} min=${m.retentionMinutes}`,
  );
  report(
    'otra serie sigue retenida',
    m2.status === 'PRESENT' && m2.isRetention === true && m2.isCompleted !== true,
    `status=${m2.status} ret=${m2.isRetention}`,
  );
}

async function casoCierreRelevo() {
  const end = Timestamp.fromDate(new Date('2026-09-30T15:30:00-03:00'));
  const start = Timestamp.fromDate(new Date('2026-09-30T11:45:00-03:00'));
  const punch = Timestamp.fromDate(new Date('2026-09-30T15:31:00-03:00'));
  await db.collection('turnos').doc('garcia_m2').set({
    empresaId: 'rev_emp', objectiveId: 'peaje', positionName: 'Puesto 2',
    employeeId: 'emp_garcia', employeeName: 'GARCIA',
    code: 'M2', status: 'PRESENT', isPresent: true,
    isRetention: true, retentionReason: 'GONZALEZ no se presentó',
    startTime: start, endTime: end, realStartTime: start,
  });
  await db.collection('turnos').doc('gonzalez_t2').set({
    empresaId: 'rev_emp', objectiveId: 'peaje', positionName: 'Puesto 2',
    employeeId: 'emp_gonzalez', employeeName: 'GONZALEZ',
    code: 'T2', status: 'PRESENT', isPresent: true,
    startTime: end,
    endTime: Timestamp.fromDate(new Date('2026-09-30T19:30:00-03:00')),
    realStartTime: punch, checkInTime: punch,
  });
  await runAutoCompletarTurnosPass(db, ctx, punch, { onlyOutgoingShiftId: 'garcia_m2' });
  const g = (await db.collection('turnos').doc('garcia_m2').get()).data() || {};
  report(
    'cierre por relevo limpia retención',
    g.status === 'COMPLETED' && g.autoCloseReason === 'RELEVO_PRESENTE'
      && g.isRetention !== true && g.retentionReason == null
      && Number(g.retentionMinutes) >= 1 && g.retentionEndedAt,
    `status=${g.status} reason=${g.autoCloseReason} ret=${g.isRetention} why=${g.retentionReason} min=${g.retentionMinutes}`,
  );
}

async function casoHuecoSla() {
  const bandT = Date.parse('2026-09-30T15:00:00-03:00');
  const lopez = {
    employeeId: 'emp_lopez', positionName: 'Puesto 2', code: 'T',
    shiftDateObj: new Date('2026-09-30T15:15:00-03:00'),
  };
  const cardo = {
    employeeId: 'emp_cardo', positionName: 'Puesto 2', code: 'M2',
    shiftDateObj: new Date('2026-09-30T11:45:00-03:00'),
  };
  report('T +15 min cubre la franja T', plannedShiftCoversSlaBand(lopez, { positionName: 'Puesto 2', code: 'T', startMs: bandT }) === true, '');
  report(
    'M2 no cubre la franja M',
    plannedShiftCoversSlaBand(cardo, { positionName: 'Puesto 2', code: 'M', startMs: Date.parse('2026-09-30T11:30:00-03:00') }) === false,
    '',
  );
  report(
    'T +90 min no cubre',
    plannedShiftCoversSlaBand(
      { employeeId: 'emp_x', positionName: 'Puesto 2', code: 'T', shiftDateObj: new Date('2026-09-30T16:30:00-03:00') },
      { positionName: 'Puesto 2', code: 'T', startMs: bandT },
    ) === false,
    '',
  );

  const now = Timestamp.fromDate(new Date('2026-09-30T14:00:00-03:00'));
  const empresaId = 'rev_emp';
  await db.collection('planificacion_estados').doc('peaje_2026_9').set({ publishedAt: now });
  await db.collection('planificacion_estados').doc('ctrl_2026_9').set({ publishedAt: now });
  const bands = (list) => ({ name: 'Puesto 2', quantity: 2, allowedShiftTypes: list });
  await db.collection('servicios_sla').doc('sla_peaje').set({
    empresaId, status: 'active', objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte',
    positions: [bands([{ code: 'T', startTime: '15:00', hours: 1, quantity: 2 }])],
  });
  await db.collection('servicios_sla').doc('sla_ctrl').set({
    empresaId, status: 'active', objectiveId: 'ctrl', objectiveName: 'Control',
    positions: [bands([{ code: 'N', startTime: '20:00', hours: 8, quantity: 1 }])],
  });
  const planned = (id, objectiveId, code, iso, name) => db.collection('turnos').doc(id).set({
    empresaId, objectiveId, positionName: 'Puesto 2',
    employeeId: id, employeeName: name, code, status: 'PLAN',
    startTime: Timestamp.fromDate(new Date(iso)),
    endTime: Timestamp.fromMillis(Date.parse(iso) + 4 * 3600000),
  });
  await planned('lopez', 'peaje', 'T', '2026-09-30T15:15:00-03:00', 'LOPEZ');
  await planned('brizuela', 'peaje', 'T', '2026-09-30T15:15:00-03:00', 'BRIZUELA');
  await planned('lejos', 'ctrl', 'N', '2026-09-30T22:30:00-03:00', 'LEJOS');

  await detectPublishedSlaGapsForEmpresa(db, empresaId, now);
  const peaje = await db.collection('sla_huecos_sin_plan').where('objectiveId', '==', 'peaje').get();
  const ctrl = await db.collection('sla_huecos_sin_plan').where('objectiveId', '==', 'ctrl').get();
  report('plan ±15 min no genera vacante', peaje.size === 0, `n=${peaje.size}`);
  report('plan a +150 min sí es vacante', ctrl.size === 1, `n=${ctrl.size}`);
}

await casoRevertir();
await casoCierreRelevo();
await casoHuecoSla();
const failed = results.filter((r) => !r.ok).length;
console.log(`${failed ? 'FALLA' : 'OK'} ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
