/**
 * E2E relevo / handover (Firestore :8080). Requiere build en apps/functions.
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   node scripts/eval-relevo-handover-e2e-emulator.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'comtroldata';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { applyLateReliefNoticeToOutgoing } = requireFn('./lib/fichajes/relevoNotifications.js');

const results = [];

function report(caseId, ok, detail) {
  results.push({ caseId, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\tCaso ${caseId}\t${detail}`);
}

function tsAt(y, m, d, h, min) {
  return Timestamp.fromDate(new Date(y, m - 1, d, h, min, 0, 0));
}

async function pingEmulator() {
  try {
    await db.collection('_ping').doc('relevo').set({ t: Date.now() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

async function seedSla24h(objectiveId, clientId) {
  await db.collection('servicios_sla').doc(`${objectiveId}_sla`).set({
    objectiveId,
    clientId,
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    positions: [{
      name: 'Puesto 1',
      quantity: 1,
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
      coverageType: '24hs',
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
      ],
    }],
  });
}

async function countNotifs(employeeId, type) {
  const snap = await db.collection('user_notifications').where('employeeId', '==', employeeId).limit(80).get();
  return snap.docs.filter((d) => String(d.data().type || '') === type).length;
}

const autoCompleteCtx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

async function run() {
  if (!(await pingEmulator())) {
    for (let i = 1; i <= 4; i++) report(i, false, 'Emulador :8080 no responde');
    process.exitCode = 1;
    return;
  }

  const runId = `relevo_e2e_${Date.now()}`;

  try {
    // Caso 1 — entrante 14:45 (turno 15:00): saliente sigue presente, sin TURNO_FINALIZADO
    {
      const prefix = `${runId}_c1`;
      const objectiveId = `${prefix}_obj`;
      const outId = `${prefix}_out`;
      const inId = `${prefix}_in`;
      const outEmp = `${prefix}_e_out`;
      const inEmp = `${prefix}_e_in`;
      const day = { y: 2026, m: 9, d: 24 };
      await seedSla24h(objectiveId, `${prefix}_cli`);
      await db.batch()
        .set(db.collection('turnos').doc(outId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: outEmp,
          employeeName: 'Saliente',
          code: 'M',
          startTime: tsAt(day.y, day.m, day.d, 7, 0),
          endTime: tsAt(day.y, day.m, day.d, 15, 0),
          isPresent: true,
          status: 'PRESENT',
          checkInTime: tsAt(day.y, day.m, day.d, 6, 55),
          realStartTime: tsAt(day.y, day.m, day.d, 6, 55),
        })
        .set(db.collection('turnos').doc(inId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: inEmp,
          employeeName: 'Entrante',
          code: 'T',
          startTime: tsAt(day.y, day.m, day.d, 15, 0),
          endTime: tsAt(day.y, day.m, day.d, 23, 0),
          status: 'PENDING',
          isPresent: false,
        })
        .commit();

      const beforeNotifs = await countNotifs(outEmp, 'TURNO_FINALIZADO');
      const recordedAt = new Date(tsAt(day.y, day.m, day.d, 14, 45).toMillis()).toISOString();
      const reg = await registrarPresencia(db, {
        shiftId: inId,
        source: 'OPERATIONS',
        empId: inEmp,
        recordedAt,
      });

      const out = (await db.collection('turnos').doc(outId).get()).data();
      const afterNotifs = await countNotifs(outEmp, 'TURNO_FINALIZADO');
      const schedMs = tsAt(day.y, day.m, day.d, 15, 0).toMillis();
      const ok =
        reg.relieved?.shiftId === outId
        && out?.isPresent === true
        && out?.isCompleted !== true
        && out?.relievedBy === inEmp
        && out?.relieveScheduledAt?.toMillis?.() === schedMs
        && afterNotifs === beforeNotifs;
      report(
        1,
        ok,
        ok
          ? 'saliente presente + relevo programado sin push'
          : `relieved=${reg.relieved?.shiftId} by=${out?.relievedBy} sched=${out?.relieveScheduledAt?.toMillis?.()}/${schedMs} notifs=${afterNotifs}`,
      );
    }

    // Caso 2 — a las 15:05 autoCompletar: cierre fin 15:00 + TURNO_FINALIZADO
    {
      const prefix = `${runId}_c2`;
      const objectiveId = `${prefix}_obj`;
      const outId = `${prefix}_out`;
      const inId = `${prefix}_in`;
      const outEmp = `${prefix}_e_out`;
      const inEmp = `${prefix}_e_in`;
      const day = { y: 2026, m: 9, d: 25 };
      await seedSla24h(objectiveId, `${prefix}_cli`);
      await db.batch()
        .set(db.collection('turnos').doc(outId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: outEmp,
          employeeName: 'Saliente',
          code: 'M',
          startTime: tsAt(day.y, day.m, day.d, 7, 0),
          endTime: tsAt(day.y, day.m, day.d, 15, 0),
          isPresent: true,
          status: 'PRESENT',
          relievedBy: inEmp,
          relievedByName: 'Entrante',
          relieveScheduledAt: tsAt(day.y, day.m, day.d, 15, 0),
          checkInTime: tsAt(day.y, day.m, day.d, 6, 55),
        })
        .set(db.collection('turnos').doc(inId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: inEmp,
          employeeName: 'Entrante',
          code: 'T',
          startTime: tsAt(day.y, day.m, day.d, 15, 0),
          endTime: tsAt(day.y, day.m, day.d, 23, 0),
          isPresent: true,
          status: 'PRESENT',
          realStartTime: tsAt(day.y, day.m, day.d, 14, 45),
          checkInTime: tsAt(day.y, day.m, day.d, 14, 45),
        })
        .commit();

      const beforeNotifs = await countNotifs(outEmp, 'TURNO_FINALIZADO');
      await runAutoCompletarTurnosPass(
        db,
        autoCompleteCtx,
        tsAt(day.y, day.m, day.d, 15, 5),
        { onlyOutgoingShiftId: outId },
      );
      const out = (await db.collection('turnos').doc(outId).get()).data();
      const afterNotifs = await countNotifs(outEmp, 'TURNO_FINALIZADO');
      const endMs = tsAt(day.y, day.m, day.d, 15, 0).toMillis();
      const ok =
        out?.isCompleted === true
        && out?.realEndTime?.toMillis?.() === endMs
        && afterNotifs === beforeNotifs + 1;
      report(2, ok, ok ? 'cierre 15:00 + notif TURNO_FINALIZADO' : `end=${out?.realEndTime?.toMillis?.()} notifs=${afterNotifs}`);
    }

    // Caso 3 — aviso tarde +15 → saliente RETENCION_AVISO
    {
      const prefix = `${runId}_c3`;
      const objectiveId = `${prefix}_obj`;
      const outId = `${prefix}_out`;
      const inId = `${prefix}_in`;
      const outEmp = `${prefix}_e_out`;
      const inEmp = `${prefix}_e_in`;
      const day = { y: 2026, m: 9, d: 26 };
      await seedSla24h(objectiveId, `${prefix}_cli`);
      const inStart = tsAt(day.y, day.m, day.d, 15, 0);
      const etaAt = tsAt(day.y, day.m, day.d, 15, 15);
      await db.batch()
        .set(db.collection('turnos').doc(outId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: outEmp,
          employeeName: 'Saliente',
          code: 'M',
          startTime: tsAt(day.y, day.m, day.d, 7, 0),
          endTime: inStart,
          isPresent: true,
          status: 'PRESENT',
          checkInTime: tsAt(day.y, day.m, day.d, 6, 55),
        })
        .set(db.collection('turnos').doc(inId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: inEmp,
          employeeName: 'Entrante',
          code: 'T',
          startTime: inStart,
          endTime: tsAt(day.y, day.m, day.d, 23, 0),
          status: 'PENDING',
          lateArrivalEtaMinutes: 15,
          lateArrivalEtaAt: etaAt,
        })
        .commit();

      const inData = (await db.collection('turnos').doc(inId).get()).data();
      await applyLateReliefNoticeToOutgoing(db, inId, inData, etaAt);
      const n = await countNotifs(outEmp, 'RETENCION_AVISO');
      const out = (await db.collection('turnos').doc(outId).get()).data();
      const ok = n >= 1 && out?.lateReliefIncomingShiftId === inId;
      report(3, ok, ok ? 'push/bandeja RETENCION_AVISO al saliente' : `notifs=${n} link=${out?.lateReliefIncomingShiftId}`);
    }

    // Caso 4 — entrante ficha 15:12 (post fin): saliente cierra realEnd 15:12 + TURNO_FINALIZADO
    {
      const prefix = `${runId}_c4`;
      const objectiveId = `${prefix}_obj`;
      const outId = `${prefix}_out`;
      const inId = `${prefix}_in`;
      const outEmp = `${prefix}_e_out`;
      const inEmp = `${prefix}_e_in`;
      const day = { y: 2026, m: 9, d: 27 };
      await seedSla24h(objectiveId, `${prefix}_cli`);
      const outEnd = tsAt(day.y, day.m, day.d, 15, 0);
      const checkInMs = tsAt(day.y, day.m, day.d, 15, 12).toMillis();
      await db.batch()
        .set(db.collection('turnos').doc(outId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: outEmp,
          employeeName: 'Saliente',
          code: 'M',
          startTime: tsAt(day.y, day.m, day.d, 7, 0),
          endTime: outEnd,
          isPresent: true,
          status: 'PRESENT',
          isRetention: true,
          checkInTime: tsAt(day.y, day.m, day.d, 6, 55),
        })
        .set(db.collection('turnos').doc(inId), {
          empresaId: `${prefix}_emp`,
          objectiveId,
          objectiveName: 'Obj Relevo',
          clientId: `${prefix}_cli`,
          positionName: 'Puesto 1',
          employeeId: inEmp,
          employeeName: 'Entrante',
          code: 'T',
          startTime: outEnd,
          endTime: tsAt(day.y, day.m, day.d, 23, 0),
          status: 'PENDING',
          isPresent: false,
        })
        .commit();

      const beforeNotifs = await countNotifs(outEmp, 'TURNO_FINALIZADO');
      await registrarPresencia(db, {
        shiftId: inId,
        source: 'OPERATIONS',
        empId: inEmp,
        recordedAt: new Date(checkInMs).toISOString(),
      });
      const out = (await db.collection('turnos').doc(outId).get()).data();
      const afterNotifs = await countNotifs(outEmp, 'TURNO_FINALIZADO');
      const ok =
        out?.isCompleted === true
        && out?.realEndTime?.toMillis?.() === checkInMs
        && afterNotifs === beforeNotifs + 1;
      report(4, ok, ok ? 'cierre 15:12 + TURNO_FINALIZADO' : `realEnd=${out?.realEndTime?.toMillis?.()} notifs=${afterNotifs}`);
    }
  } catch (e) {
    console.error('Error fatal E2E relevo:', e);
    process.exitCode = 1;
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n--- Resumen ---');
  console.table(results);
  if (failed) process.exitCode = 1;
}

run();
