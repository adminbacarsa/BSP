/**
 * Aviso de fin de turno. Solo emulador aislado (firebase.e2e-p2.json, Firestore :8190).
 *
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-p2-e2e "node scripts/eval-aviso-fin-turno-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!host || host.endsWith(':8080')) {
  console.error('Este script corre solo en el emulador aislado (firebase.e2e-p2.json, :8190).');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-p2-e2e';
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { finTurnoDocId } = requireFn('./lib/fichajes/relevoNotifications.js');

const runId = `fin_${Date.now()}`;
const results = [];
function report(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
}

function tsAt(y, m, d, h, min) {
  return Timestamp.fromDate(new Date(y, m - 1, d, h, min, 0, 0));
}

const ctxOn = {
  isEnabled: () => true,
  isDemo: () => false,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => {
    throw new Error('el push sale por la bandeja, no por getEmployeeTokens');
  },
};

async function seedSla(objectiveId, clientId, mode) {
  const base = {
    name: 'Puesto 1',
    quantity: 1,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    coverageType: mode === '24h' ? '24hs' : 'custom',
  };
  const positions = mode === '24h'
    ? [{
        ...base,
        allowedShiftTypes: [
          { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
          { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
        ],
      }]
    : [{ ...base, allowedShiftTypes: [{ code: 'M', startTime: '08:00', endTime: '15:00', hours: 8 }] }];
  await db.collection('servicios_sla').doc(`${objectiveId}_sla`).set({
    objectiveId,
    clientId,
    status: 'active',
    positions,
  });
}

async function notifs(shiftId) {
  const snap = await db.collection('user_notifications').where('turnoId', '==', shiftId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function main() {
  const emp = `${runId}_kevin`;
  await db.collection('empleados').doc(emp).set({
    nombre: 'QUIROGA, Kevin',
    firstName: 'Kevin',
    uid: `${runId}_uid`,
    empresaId: `${runId}_emp`,
  });

  {
    const objectiveId = `${runId}_obj_sc`;
    const shiftId = `${runId}_sc`;
    await seedSla(objectiveId, `${runId}_cli`, 'partial');
    await db.collection('turnos').doc(shiftId).set({
      empresaId: `${runId}_emp`,
      objectiveId,
      clientId: `${runId}_cli`,
      positionName: 'Puesto 1',
      employeeId: emp,
      employeeName: 'QUIROGA, Kevin',
      objectiveName: 'Peaje 9 Norte',
      code: 'M',
      status: 'PRESENT',
      isPresent: true,
      isCompleted: false,
      startTime: tsAt(2026, 10, 2, 8, 0),
      endTime: tsAt(2026, 10, 2, 15, 0),
    });
    await runAutoCompletarTurnosPass(db, ctxOn, tsAt(2026, 10, 2, 15, 10));
    await runAutoCompletarTurnosPass(db, ctxOn, tsAt(2026, 10, 2, 15, 11));
    const shift = (await db.collection('turnos').doc(shiftId).get()).data();
    const rows = await notifs(shiftId);
    const body = String(rows[0]?.body || '');
    const ok =
      shift?.status === 'COMPLETED'
      && shift?.completionReason === 'SIN_CONTINUIDAD_SLA'
      && shift?.finTurnoAvisoAt
      && rows.length === 1
      && rows[0].id === finTurnoDocId(shiftId)
      && rows[0].type === 'TURNO_FINALIZADO'
      && body.includes('Kevin, terminó tu turno en Peaje 9 Norte a las 15:00')
      && body.includes('Buen descanso.');
    report('sin-continuidad', ok, ok ? body : `st=${shift?.status} r=${shift?.completionReason} n=${rows.length} body=${body}`);
  }

  {
    const objectiveId = `${runId}_obj_rel`;
    const salId = `${runId}_rel_sal`;
    const relId = `${runId}_rel_in`;
    await seedSla(objectiveId, `${runId}_cli`, '24h');
    const relCheck = tsAt(2026, 10, 2, 15, 2);
    await db.batch()
      .set(db.collection('turnos').doc(salId), {
        empresaId: `${runId}_emp`,
        objectiveId,
        positionName: 'Puesto 1',
        employeeId: emp,
        employeeName: 'QUIROGA, Kevin',
        objectiveName: 'Peaje 9 Norte',
        code: 'M',
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
        startTime: tsAt(2026, 10, 2, 7, 0),
        endTime: tsAt(2026, 10, 2, 15, 0),
        checkInTime: tsAt(2026, 10, 2, 6, 58),
      })
      .set(db.collection('turnos').doc(relId), {
        empresaId: `${runId}_emp`,
        objectiveId,
        positionName: 'Puesto 1',
        employeeId: `${runId}_lopez`,
        employeeName: 'Lopez, Ana',
        code: 'T',
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
        startTime: tsAt(2026, 10, 2, 15, 0),
        endTime: tsAt(2026, 10, 2, 23, 0),
        checkInTime: relCheck,
        realStartTime: relCheck,
      })
      .commit();
    await runAutoCompletarTurnosPass(db, ctxOn, tsAt(2026, 10, 2, 15, 5), { onlyOutgoingShiftId: salId });
    const shift = (await db.collection('turnos').doc(salId).get()).data();
    const rows = await notifs(salId);
    const body = String(rows[0]?.body || '');
    const ok =
      shift?.completionReason === 'RELEVO_PRESENTE'
      && rows.length === 1
      && body.includes('Te relevó Lopez, Ana')
      && body.startsWith('Kevin, terminaste tu turno en Peaje 9 Norte');
    report('relevo', ok, ok ? body : `r=${shift?.completionReason} n=${rows.length} body=${body}`);
  }

  {
    const objectiveId = `${runId}_obj_off`;
    const shiftId = `${runId}_off`;
    await seedSla(objectiveId, `${runId}_cli`, 'partial');
    await db.collection('turnos').doc(shiftId).set({
      empresaId: `${runId}_off_emp`,
      objectiveId,
      positionName: 'Puesto 1',
      employeeId: emp,
      employeeName: 'QUIROGA, Kevin',
      objectiveName: 'Peaje 9 Norte',
      code: 'M',
      status: 'PRESENT',
      isPresent: true,
      isCompleted: false,
      startTime: tsAt(2026, 10, 2, 8, 0),
      endTime: tsAt(2026, 10, 2, 15, 0),
    });
    const offCtx = { ...ctxOn, isEnabled: () => false };
    await runAutoCompletarTurnosPass(db, offCtx, tsAt(2026, 10, 2, 15, 5), { onlyOutgoingShiftId: shiftId });
    const shift = (await db.collection('turnos').doc(shiftId).get()).data();
    const rows = await notifs(shiftId);
    const ok = shift?.status === 'COMPLETED' && shift?.completionReason === 'SIN_CONTINUIDAD_SLA' && !shift?.finTurnoAvisoAt && rows.length === 0;
    report('cc-apagado', ok, ok ? 'cierre sin bandeja' : `st=${shift?.status} flag=${!!shift?.finTurnoAvisoAt} n=${rows.length}`);
  }

  {
    const objectiveId = `${runId}_obj_demo`;
    const shiftId = `${runId}_demo`;
    await seedSla(objectiveId, `${runId}_cli`, 'partial');
    await db.collection('turnos').doc(shiftId).set({
      empresaId: `${runId}_demo_emp`,
      objectiveId,
      positionName: 'Puesto 1',
      employeeId: emp,
      employeeName: 'QUIROGA, Kevin',
      objectiveName: 'Peaje 9 Norte',
      code: 'M',
      status: 'PRESENT',
      isPresent: true,
      isCompleted: false,
      startTime: tsAt(2026, 10, 2, 8, 0),
      endTime: tsAt(2026, 10, 2, 15, 0),
    });
    const demoCtx = { ...ctxOn, isDemo: () => true };
    await runAutoCompletarTurnosPass(db, demoCtx, tsAt(2026, 10, 2, 15, 5), { onlyOutgoingShiftId: shiftId });
    const shift = (await db.collection('turnos').doc(shiftId).get()).data();
    const rows = await notifs(shiftId);
    const ok = shift?.status === 'COMPLETED' && !shift?.finTurnoAvisoAt && rows.length === 0;
    report('demo', ok, ok ? 'cierre sin aviso' : `st=${shift?.status} n=${rows.length}`);
  }

  {
    const objectiveId = `${runId}_obj_ev`;
    const shiftId = `${runId}_ev`;
    await seedSla(objectiveId, `${runId}_cli`, 'partial');
    await db.collection('turnos').doc(shiftId).set({
      empresaId: `${runId}_emp`,
      objectiveId,
      positionName: 'Servicio',
      employeeId: emp,
      employeeName: 'QUIROGA, Kevin',
      objectiveName: 'Objetivo Base',
      eventoNombre: 'pumas',
      code: 'EV',
      origin: 'EVENTO',
      status: 'PRESENT',
      isPresent: true,
      isCompleted: false,
      startTime: tsAt(2026, 10, 2, 16, 0),
      endTime: tsAt(2026, 10, 2, 20, 0),
    });
    await runAutoCompletarTurnosPass(db, ctxOn, tsAt(2026, 10, 2, 20, 5), { onlyOutgoingShiftId: shiftId });
    const rows = await notifs(shiftId);
    const body = String(rows[0]?.body || '');
    const ok = rows.length === 1 && body.includes('en pumas a las 20:00') && !body.includes('Objetivo Base');
    report('evento', ok, ok ? body : `n=${rows.length} body=${body}`);
  }

  {
    const now = tsAt(2026, 10, 2, 15, 1);
    const recentId = `${runId}_win`;
    const oldId = `${runId}_old`;
    const contId = `${runId}_cont`;
    const objRecent = `${runId}_obj_win`;
    const objOld = `${runId}_obj_old`;
    const objCont = `${runId}_obj_cont`;
    await seedSla(objRecent, `${runId}_cli`, 'partial');
    await seedSla(objOld, `${runId}_cli`, 'partial');
    await seedSla(objCont, `${runId}_cli`, '24h');
    const base = {
      empresaId: `${runId}_emp`,
      positionName: 'Puesto 1',
      employeeId: emp,
      employeeName: 'QUIROGA, Kevin',
      objectiveName: 'Peaje 9 Norte',
      code: 'M',
      status: 'PRESENT',
      isPresent: true,
      isCompleted: false,
    };
    await db.collection('turnos').doc(recentId).set({
      ...base,
      objectiveId: objRecent,
      startTime: tsAt(2026, 10, 2, 8, 0),
      endTime: tsAt(2026, 10, 2, 15, 0),
    });
    await db.collection('turnos').doc(oldId).set({
      ...base,
      objectiveId: objOld,
      startTime: tsAt(2026, 10, 2, 7, 0),
      endTime: tsAt(2026, 10, 2, 14, 50),
    });
    await db.collection('turnos').doc(contId).set({
      ...base,
      objectiveId: objCont,
      startTime: tsAt(2026, 10, 2, 7, 0),
      endTime: tsAt(2026, 10, 2, 15, 0),
      checkInTime: tsAt(2026, 10, 2, 6, 55),
    });
    await runAutoCompletarTurnosPass(db, ctxOn, now, { recentEndMs: 2 * 60 * 1000, empresaFilter: (id) => id === `${runId}_emp` });
    const recent = (await db.collection('turnos').doc(recentId).get()).data();
    const old = (await db.collection('turnos').doc(oldId).get()).data();
    const cont = (await db.collection('turnos').doc(contId).get()).data();
    const rows = await notifs(recentId);
    const ok =
      recent?.status === 'COMPLETED'
      && recent?.finTurnoAvisoAt
      && rows.length === 1
      && old?.status === 'PRESENT'
      && cont?.status === 'PRESENT'
      && cont?.isRetention !== true;
    report(
      'ventana-2min',
      ok,
      ok ? 'cierra el reciente; deja el viejo y el continuo' : `recent=${recent?.status} old=${old?.status} cont=${cont?.status}/${cont?.isRetention}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`FALLARON ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`SUITE OK aviso fin de turno (${results.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
