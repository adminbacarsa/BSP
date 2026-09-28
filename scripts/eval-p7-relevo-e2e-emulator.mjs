/**
 * E2E P7: un ESC del mismo puesto no cierra ni retiene al saliente como relevo.
 * Un ops_cov FT sí cierra por RELEVO_PRESENTE.
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   npm run build --prefix apps/functions
 *   node scripts/eval-p7-relevo-e2e-emulator.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { caseFileExists, loadCaseIntoDb } from './cc-caso-real-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const projectId = process.env.P7_PROJECT || 'demo-p7-relevo';
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { applyLateReliefNoticeToOutgoing } = requireFn('./lib/fichajes/relevoNotifications.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');

const results = [];
function report(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

function tsAt(y, m, d, h, min) {
  return Timestamp.fromDate(new Date(y, m - 1, d, h, min, 0, 0));
}

const ctx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

async function seedSla(objectiveId, mode) {
  const shifts = mode === '24h'
    ? [
        { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 },
        { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8 },
        { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
      ]
    : [{ code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 }];
  await db.collection('servicios_sla').doc(`${objectiveId}_sla`).set({
    objectiveId,
    clientId: `${objectiveId}_cli`,
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    positions: [{
      name: 'Puesto 1',
      quantity: 1,
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      coverageType: mode === '24h' ? '24hs' : 'partial',
      shifts,
      allowedShiftTypes: shifts,
    }],
  });
}

async function run() {
  try {
    await db.collection('_ping').doc('p7').set({ t: Date.now() });
  } catch (e) {
    console.error('Emulador Firestore no responde en', process.env.FIRESTORE_EMULATOR_HOST);
    process.exit(1);
  }

  const runId = `p7_${Date.now()}`;

  // ESC presente en el mismo puesto, con continuidad SLA: el saliente se retiene, no cierra por el ESC.
  {
    const objectiveId = `${runId}_c1`;
    const empresaId = `${runId}_emp`;
    await seedSla(objectiveId, '24h');
    const salId = `${runId}_sal`;
    const escId = `${runId}_esc`;
    const endPlan = tsAt(2026, 9, 28, 15, 0);
    await db.batch()
      .set(db.collection('turnos').doc(salId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eS`,
        employeeName: 'Saliente M', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: tsAt(2026, 9, 28, 7, 0), endTime: endPlan,
        checkInTime: tsAt(2026, 9, 28, 6, 55),
      })
      .set(db.collection('turnos').doc(escId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eE`,
        employeeName: 'Gaitan Ignacio', code: 'ESC', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: tsAt(2026, 9, 28, 16, 0), endTime: tsAt(2026, 9, 29, 0, 0),
        checkInTime: tsAt(2026, 9, 28, 16, 5),
      })
      .commit();
    await runAutoCompletarTurnosPass(db, ctx, tsAt(2026, 9, 28, 16, 10), { onlyOutgoingShiftId: salId });
    const sal = (await db.collection('turnos').doc(salId).get()).data();
    const ok = sal?.completionReason !== 'RELEVO_PRESENTE'
      && sal?.completionReason !== 'RELEVO_NO_PRESENTADO'
      && sal?.status !== 'COMPLETED'
      && sal?.isRetention === true
      && String(sal?.retentionAbsenceShiftId || '') !== escId;
    report('esc-no-releva-retiene', ok, `st=${sal?.status} ret=${sal?.isRetention} reason=${sal?.completionReason || sal?.retentionReason}`);
  }

  // Sin continuidad: cierra por fin de franja, nunca porque llegó el ESC.
  {
    const objectiveId = `${runId}_c2`;
    const empresaId = `${runId}_emp`;
    await seedSla(objectiveId, 'partial');
    const salId = `${runId}_sal2`;
    const escId = `${runId}_esc2`;
    const endPlan = tsAt(2026, 9, 28, 15, 0);
    await db.batch()
      .set(db.collection('turnos').doc(salId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eS2`,
        employeeName: 'Saliente sin continuo', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: tsAt(2026, 9, 28, 7, 0), endTime: endPlan,
      })
      .set(db.collection('turnos').doc(escId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eE2`,
        employeeName: 'Escuela', code: 'ESC', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: endPlan, endTime: tsAt(2026, 9, 28, 23, 0),
      })
      .commit();
    await runAutoCompletarTurnosPass(db, ctx, tsAt(2026, 9, 28, 15, 10), { onlyOutgoingShiftId: salId });
    const sal = (await db.collection('turnos').doc(salId).get()).data();
    const ok = sal?.status === 'COMPLETED' && sal?.completionReason === 'SIN_CONTINUIDAD_SLA';
    report('esc-no-releva-cierra-continuidad', ok, `st=${sal?.status} r=${sal?.completionReason}`);
  }

  // ops_cov FT sí releva.
  {
    const objectiveId = `${runId}_c3`;
    const empresaId = `${runId}_emp`;
    await seedSla(objectiveId, '24h');
    const salId = `${runId}_sal3`;
    const ftId = `${runId}_ft`;
    const endPlan = tsAt(2026, 9, 28, 15, 0);
    const check = tsAt(2026, 9, 28, 15, 4);
    await db.batch()
      .set(db.collection('turnos').doc(salId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eS3`,
        employeeName: 'Saliente', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: tsAt(2026, 9, 28, 7, 0), endTime: endPlan,
        checkInTime: tsAt(2026, 9, 28, 6, 50),
      })
      .set(db.collection('turnos').doc(ftId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eF`,
        employeeName: 'Franco trabajado', code: 'FT', origin: 'OPERATIONS_COVERAGE',
        coverageType: 'FT', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: endPlan, endTime: tsAt(2026, 9, 28, 23, 0),
        checkInTime: check, realStartTime: check,
      })
      .commit();
    await runAutoCompletarTurnosPass(db, ctx, tsAt(2026, 9, 28, 15, 8), { onlyOutgoingShiftId: salId });
    const sal = (await db.collection('turnos').doc(salId).get()).data();
    const ok = sal?.status === 'COMPLETED' && sal?.completionReason === 'RELEVO_PRESENTE';
    report('ops-cov-ft-releva', ok, `st=${sal?.status} r=${sal?.completionReason}`);
  }

  // Aviso de tardanza de un ESC no deja al saliente esperando relevo.
  {
    const objectiveId = `${runId}_c4`;
    const empresaId = `${runId}_emp`;
    const salId = `${runId}_sal4`;
    const escId = `${runId}_esc4`;
    const endPlan = tsAt(2026, 9, 28, 16, 0);
    await db.batch()
      .set(db.collection('turnos').doc(salId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eS4`,
        employeeName: 'Saliente', code: 'T', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: tsAt(2026, 9, 28, 8, 0), endTime: endPlan,
      })
      .set(db.collection('turnos').doc(escId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eE4`,
        employeeName: 'Gaitan Ignacio', code: 'ESC',
        startTime: endPlan, endTime: tsAt(2026, 9, 29, 0, 0),
      })
      .commit();
    const applied = await applyLateReliefNoticeToOutgoing(
      db, escId,
      (await db.collection('turnos').doc(escId).get()).data(),
      tsAt(2026, 9, 28, 16, 30),
    );
    const sal = (await db.collection('turnos').doc(salId).get()).data();
    const ok = applied === false && !sal?.lateReliefIncomingShiftId;
    report('esc-tarde-no-retiene-saliente', ok, `applied=${applied} link=${sal?.lateReliefIncomingShiftId || '-'}`);
  }

  // Fichar el ESC no escribe relievedBy en el saliente.
  {
    const objectiveId = `${runId}_c5`;
    const empresaId = `${runId}_emp`;
    const salId = `${runId}_sal5`;
    const escId = `${runId}_esc5`;
    await db.batch()
      .set(db.collection('turnos').doc(salId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eS5`,
        employeeName: 'Saliente', code: 'T', status: 'PRESENT', isPresent: true, isCompleted: false,
        startTime: tsAt(2026, 9, 28, 8, 0), endTime: tsAt(2026, 9, 28, 16, 0),
        checkInTime: tsAt(2026, 9, 28, 7, 55),
      })
      .set(db.collection('turnos').doc(escId), {
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${runId}_eE5`,
        employeeName: 'Gaitan Ignacio', code: 'ESC', status: 'PENDING', isPresent: false,
        startTime: tsAt(2026, 9, 28, 16, 0), endTime: tsAt(2026, 9, 29, 0, 0),
      })
      .commit();
    await registrarPresencia(db, {
      shiftId: escId,
      source: 'OPERATIONS',
      recordedAt: tsAt(2026, 9, 28, 16, 8).toDate().toISOString(),
    });
    const sal = (await db.collection('turnos').doc(salId).get()).data();
    const esc = (await db.collection('turnos').doc(escId).get()).data();
    const ok = esc?.isPresent === true && !String(sal?.relievedBy || '').trim();
    report('fichar-esc-no-releva', ok, `escPresent=${esc?.isPresent} relievedBy=${sal?.relievedBy || '-'}`);
  }

  const OBRADOR = 'obrador-malagueno-2026-09-28';
  const OBRADOR_OBJ = '31DrJvGnD2pRSFiusxUf';
  const GAITAN_ESC = 'JrZTpKgvr15OS1PABvZ5';
  if (!caseFileExists(OBRADOR)) {
    report(
      'caso-real-obrador',
      false,
      'falta scripts/out/cc-casos/obrador-malagueno-2026-09-28.json — export solo lectura: node scripts/cc-caso-real-snapshot.mjs export --empresa pruebas_sa --objective "Obrador Malagueño" --date 2026-09-28 --name obrador-malagueno-2026-09-28',
    );
  } else {
    const { isExtraNonReliefShift, isReliefEligibleShift } = requireFn('./lib/common/reliefEligibility.js');
    await loadCaseIntoDb(db, OBRADOR);
    const snap = await db.collection('turnos').where('objectiveId', '==', OBRADOR_OBJ).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const gaitan = rows.find((r) => r.id === GAITAN_ESC) || rows.find((r) =>
      String(r.employeeName || '').toLowerCase().includes('gaitan')
      && String(r.code || '').toUpperCase() === 'ESC'
      && (r.startTime?.toMillis?.() ?? 0) >= Date.parse('2026-09-28T00:00:00-03:00'),
    );
    const day = rows.filter((r) => {
      const ms = r.startTime?.toMillis?.() ?? 0;
      if (!ms) return false;
      const ar = new Date(ms - 3 * 3600000);
      return ar.getUTCFullYear() === 2026 && ar.getUTCMonth() === 8 && ar.getUTCDate() === 28;
    });
    const lateAt = gaitan?.lateArrivalAt?.toMillis?.() ?? 0;
    const checkAt = gaitan?.realStartTime?.toMillis?.() ?? gaitan?.checkInTime?.toMillis?.() ?? 0;
    const avisoPrevio = !!(gaitan?.lateArrivalConfirmed || gaitan?.lateETA || gaitan?.lateArrivalEtaMinutes);
    const stampEsFichada = lateAt > 0 && checkAt > 0 && Math.abs(lateAt - checkAt) < 2000 && !avisoPrevio;
    const extras = day.filter((r) => isExtraNonReliefShift(r));
    const base = day.filter((r) => isReliefEligibleShift(r));
    const ok = !!gaitan
      && String(gaitan.positionName || '') === 'Puesto 1'
      && isExtraNonReliefShift(gaitan)
      && stampEsFichada
      && extras.some((r) => r.id === gaitan.id);
    report(
      'caso-real-obrador',
      ok,
      ok
        ? `Gaitan ESC Puesto 1 no releva · lateArrivalAt es la fichada (no un aviso previo) · franja=${base.map((r) => r.code).filter((c, i, a) => a.indexOf(c) === i).join(',')}`
        : `gaitan=${gaitan?.id || '-'} extra=${gaitan ? isExtraNonReliefShift(gaitan) : '-'} stampFichada=${stampEsFichada} dia=${day.length}`,
    );
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} OK`);
  if (failed) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode || 0), (e) => {
  console.error(e);
  process.exit(1);
});
