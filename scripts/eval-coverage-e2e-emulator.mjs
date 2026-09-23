/**
 * E2E cobertura contra Firestore emulator (:8080).
 * Requiere: emulador activo + `npm run build` en apps/functions.
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   node scripts/eval-coverage-e2e-emulator.mjs
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

const {
  applyCoverage,
  buildOpsCoverageDocId,
  isTitularAlreadyCovered,
  syncAusenciaCoberturaGestionada,
} = requireFn('./lib/coverage/syncAusenciaCobertura.js');

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
    await db.collection('_ping').doc('cov').set({ t: Date.now() }, { merge: true });
    return true;
  } catch (e) {
    return false;
  }
}

function hoursBetween(start, end) {
  if (!start?.toMillis || !end?.toMillis) return 0;
  let h = (end.toMillis() - start.toMillis()) / 3600000;
  if (h <= 0) h += 24;
  return Math.round(h * 100) / 100;
}

async function seedBase(prefix) {
  const empresaId = `${prefix}_emp`;
  const objectiveId = `${prefix}_obj`;
  const clientId = `${prefix}_cli`;
  const titularId = `${prefix}_titular`;
  const retSourceId = `${prefix}_ret_src`;
  const refSourceId = `${prefix}_ref_src`;
  const extSourceId = `${prefix}_ext_src`;
  const advSourceId = `${prefix}_adv_src`;
  const empTitular = `${prefix}_e_tit`;
  const empRet = `${prefix}_e_ret`;
  const empRef = `${prefix}_e_ref`;
  const empExt = `${prefix}_e_ext`;
  const empAdv = `${prefix}_e_adv`;

  const batch = db.batch();
  const titular = {
    employeeId: empTitular,
    employeeName: 'Titular Test',
    code: 'M',
    objectiveId,
    clientId,
    empresaId,
    positionName: 'Puesto 1',
    startTime: tsAt(2026, 9, 23, 7, 0),
    endTime: tsAt(2026, 9, 23, 15, 0),
    isAbsent: true,
    status: 'ABSENT',
    absenceType: 'AA',
  };
  batch.set(db.collection('turnos').doc(titularId), titular);
  batch.set(db.collection('turnos').doc(retSourceId), {
    employeeId: empRet,
    employeeName: 'Guardia RET',
    code: 'RET',
    objectiveId,
    clientId,
    empresaId,
    startTime: tsAt(2026, 9, 23, 7, 0),
    endTime: tsAt(2026, 9, 23, 15, 0),
  });
  batch.set(db.collection('turnos').doc(refSourceId), {
    employeeId: empRef,
    employeeName: 'Guardia REF',
    code: 'REF',
    objectiveId: `${prefix}_obj_ref`,
    clientId,
    empresaId,
    startTime: tsAt(2026, 9, 23, 7, 0),
    endTime: tsAt(2026, 9, 23, 15, 0),
  });
  batch.set(db.collection('turnos').doc(extSourceId), {
    employeeId: empExt,
    employeeName: 'Guardia EXT',
    code: 'M',
    objectiveId,
    clientId,
    empresaId,
    startTime: tsAt(2026, 9, 23, 7, 0),
    endTime: tsAt(2026, 9, 23, 15, 0),
  });
  batch.set(db.collection('turnos').doc(advSourceId), {
    employeeId: empAdv,
    employeeName: 'Guardia ADV',
    code: 'M',
    objectiveId,
    clientId,
    empresaId,
    startTime: tsAt(2026, 9, 23, 15, 0),
    endTime: tsAt(2026, 9, 23, 23, 0),
  });
  batch.set(db.collection('ausencias').doc(`${prefix}_aus`), {
    shiftId: titularId,
    empresaId,
    employeeId: empTitular,
    coberturaEstado: 'PENDIENTE',
  });
  await batch.commit();

  return {
    empresaId,
    objectiveId,
    clientId,
    titularId,
    retSourceId,
    refSourceId,
    extSourceId,
    advSourceId,
    empTitular,
    empRet,
    empRef,
    empExt,
    empAdv,
    titular,
  };
}

async function run() {
  if (!(await pingEmulator())) {
    for (let i = 1; i <= 8; i++) {
      report(i, false, 'Emulador Firestore :8080 no responde');
    }
    process.exitCode = 1;
    return;
  }

  const runId = `cov_e2e_${Date.now()}`;

  try {
    // Caso 1 — RET mismo objetivo
    {
      const s = await seedBase(`${runId}_c1`);
      const batch = db.batch();
      const covId = await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empRet,
        candidateEmployeeName: 'Guardia RET',
        sourceShiftId: s.retSourceId,
        coverageType: 'RET',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
      });
      await syncAusenciaCoberturaGestionada(db, {
        shiftId: s.titularId,
        coveredByEmployeeId: s.empRet,
        coveredByEmployeeName: 'Guardia RET',
        coverageType: 'RET',
        empresaId: s.empresaId,
      }, batch);
      await batch.commit();
      const tit = (await db.collection('turnos').doc(s.titularId).get()).data();
      const src = (await db.collection('turnos').doc(s.retSourceId).get()).data();
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      const aus = (await db.collection('ausencias').doc(`${runId}_c1_aus`).get()).data();
      const ok =
        tit?.coverageStatus === 'COVERED'
        && tit?.coverageDocId === covId
        && src?.coverageUsed === true
        && cov?.origin === 'OPERATIONS_COVERAGE'
        && cov?.coverageType === 'RET'
        && aus?.coberturaEstado === 'GESTIONADA';
      report(1, ok, ok ? 'titular COVERED + RET usado + ops_cov + RRHH GESTIONADA' : JSON.stringify({ tit: tit?.coverageStatus, src: src?.coverageUsed, aus: aus?.coberturaEstado }));
    }

    // Caso 2 — REF otro objetivo
    {
      const s = await seedBase(`${runId}_c2`);
      const batch = db.batch();
      const covId = await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empRef,
        candidateEmployeeName: 'Guardia REF',
        sourceShiftId: s.refSourceId,
        coverageType: 'REF',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
        objectiveId: s.objectiveId,
      });
      await batch.commit();
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      const src = (await db.collection('turnos').doc(s.refSourceId).get()).data();
      const ok = cov?.objectiveId === s.objectiveId && src?.objectiveId === `${runId}_c2_obj_ref` && src?.coverageUsed === true;
      report(2, ok, ok ? 'REF en su obj + COB en titular obj' : `cov.obj=${cov?.objectiveId}`);
    }

    // Caso 3 — ESC (applyCoverage como app/resolver)
    {
      const s = await seedBase(`${runId}_c3`);
      const batch = db.batch();
      const covId = await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empRet,
        candidateEmployeeName: 'Guardia ESC',
        sourceShiftId: s.retSourceId,
        coverageType: 'ESC',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
        convocatoriaId: `${runId}_conv_esc`,
      });
      await batch.commit();
      const snaps = await db.collection('turnos').where('absenceShiftId', '==', s.titularId).get();
      const active = snaps.docs.filter((d) => d.data().coverageSuperseded !== true);
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      const ok = active.length === 1 && cov?.coverageType === 'ESC' && !cov?.coverageHoursOnSource;
      report(3, ok, ok ? '1 ops_cov ESC sin duplicado' : `activos=${active.length} type=${cov?.coverageType}`);
    }

    // Caso 4 — Auto RET
    {
      const s = await seedBase(`${runId}_c4`);
      const batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empRet,
        candidateEmployeeName: 'Guardia RET',
        sourceShiftId: s.retSourceId,
        coverageType: 'RET',
        resolvedBy: 'AUTO',
        empresaId: s.empresaId,
      });
      await batch.commit();
      const covSnap = await db.collection('turnos').where('absenceShiftId', '==', s.titularId).limit(1).get();
      const ok = covSnap.docs[0]?.data()?.resolvedBy === 'AUTO';
      report(4, ok, ok ? 'resolvedBy AUTO' : `resolvedBy=${covSnap.docs[0]?.data()?.resolvedBy}`);
    }

    // Caso 5 — EXT sin ADV → PARTIAL
    {
      const s = await seedBase(`${runId}_c5`);
      const batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empExt,
        candidateEmployeeName: 'Guardia EXT',
        sourceShiftId: s.extSourceId,
        coverageType: 'EXTEND',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
        titularCloseMode: 'PARTIAL',
        covSegmentStart: tsAt(2026, 9, 23, 11, 0),
        covSegmentEnd: tsAt(2026, 9, 23, 15, 0),
        extensionEndTime: tsAt(2026, 9, 23, 15, 0),
      });
      await batch.commit();
      const tit = (await db.collection('turnos').doc(s.titularId).get()).data();
      const ok = tit?.coverageStatus === 'PARTIAL' && tit?.operacionallyCovered !== true;
      report(5, ok, ok ? 'titular PARTIAL' : `status=${tit?.coverageStatus}`);
    }

    // Caso 6 — idempotencia
    {
      const s = await seedBase(`${runId}_c6`);
      const batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empRet,
        candidateEmployeeName: 'Guardia RET',
        sourceShiftId: s.retSourceId,
        coverageType: 'RET',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
      });
      await batch.commit();
      let threw = false;
      try {
        const b2 = db.batch();
        await applyCoverage(db, b2, {
          titularShiftId: s.titularId,
          candidateEmployeeId: s.empRef,
          candidateEmployeeName: 'Otro',
          sourceShiftId: s.refSourceId,
          coverageType: 'REF',
          resolvedBy: 'OPERACIONES',
          empresaId: s.empresaId,
        });
      } catch (e) {
        threw = e.code === 'ALREADY_COVERED';
      }
      const snaps = await db.collection('turnos').where('absenceShiftId', '==', s.titularId).get();
      const active = snaps.docs.filter((d) => d.data().coverageSuperseded !== true && d.data().status !== 'CANCELLED');
      report(6, threw && active.length === 1, threw ? 'ALREADY_COVERED + 1 ops activo' : 'no lanzó ALREADY_COVERED');
    }

    // Caso 7 — campos alineados titular/source/cov
    {
      const s = await seedBase(`${runId}_c7`);
      const batch = db.batch();
      const covId = await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empRet,
        candidateEmployeeName: 'Guardia RET',
        sourceShiftId: s.retSourceId,
        coverageType: 'RET',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
      });
      await batch.commit();
      const tit = (await db.collection('turnos').doc(s.titularId).get()).data();
      const ok =
        isTitularAlreadyCovered(tit)
        && tit.coverageDocId === covId
        && buildOpsCoverageDocId(s.titularId, s.empRet) === covId;
      report(7, ok, ok ? 'isTitularAlreadyCovered + ids determinísticos' : 'campos inconsistentes');
    }

    // Caso 8 — EXT+ADV → COVERED, 2 ops_cov trace, 8h facturables ops_cov
    {
      const s = await seedBase(`${runId}_c8`);
      let batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empExt,
        candidateEmployeeName: 'Guardia EXT',
        sourceShiftId: s.extSourceId,
        coverageType: 'EXTEND',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
        titularCloseMode: 'PARTIAL',
        covSegmentStart: tsAt(2026, 9, 23, 7, 0),
        covSegmentEnd: tsAt(2026, 9, 23, 11, 0),
        extensionEndTime: tsAt(2026, 9, 23, 11, 0),
      });
      await batch.commit();
      batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular },
        candidateEmployeeId: s.empAdv,
        candidateEmployeeName: 'Guardia ADV',
        sourceShiftId: s.advSourceId,
        coverageType: 'ADVANCE',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
        titularCloseMode: 'FULL',
        covSegmentStart: tsAt(2026, 9, 23, 11, 0),
        covSegmentEnd: tsAt(2026, 9, 23, 15, 0),
        adjustedStartTime: tsAt(2026, 9, 23, 11, 0),
      });
      await batch.commit();
      const tit = (await db.collection('turnos').doc(s.titularId).get()).data();
      const ops = (await db.collection('turnos').where('absenceShiftId', '==', s.titularId).get()).docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => d.coverageSuperseded !== true);
      const traceHours = ops.reduce((acc, d) => {
        if (d.coverageHoursOnSource !== true) return acc + hoursBetween(d.startTime, d.endTime);
        return acc;
      }, 0);
      const ok =
        tit?.coverageStatus === 'COVERED'
        && ops.length === 2
        && ops.every((d) => d.coverageHoursOnSource === true)
        && traceHours === 0;
      report(8, ok, ok ? 'COVERED + 2 trace ops_cov + 0h en ops_cov' : `ops=${ops.length} traceH=${traceHours} st=${tit?.coverageStatus}`);
    }
  } catch (e) {
    console.error('Error fatal E2E:', e);
    process.exitCode = 1;
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log('\n--- Resumen ---');
  console.table(results);
  if (failed) process.exitCode = 1;
}

run();
