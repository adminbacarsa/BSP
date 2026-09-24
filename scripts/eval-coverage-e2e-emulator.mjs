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

const { resolverCobertura, iniciarCascadaCobertura } = requireFn('./lib/coverage/convocatoriasCobertura.js');
const {
  retainOutgoingForGap,
  releaseRetentionForAbsenceShift,
  RETENTION_MAX_TOTAL_MS,
} = requireFn('./lib/coverage/coverageRetention.js');
const { isEmpresaManualMode } = requireFn('./lib/ops/opsManualMode.js');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { positionHasContinuityFromSlaDoc } = requireFn('./lib/coverage/positionHasContinuity.js');
const { skipAbsencePipelineForShift } = requireFn('./lib/coverage/coverageTraceShift.js');
const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { revertirAusenciaShift } = requireFn('./lib/attendance/revertirAusencia.js');
const { runConvocadoAbsentPass } = requireFn('./lib/attendance/convocadoAbsentPass.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');
const { resolveEarlyWithdrawReplacePolicy } = requireFn('./lib/coverage/earlyWithdrawPolicy.js');
const { processEarlyWithdrawal } = requireFn('./lib/coverage/earlyWithdrawalCore.js');
const { escalarVacanteSinCobertura } = requireFn('./lib/coverage/escalarVacanteSinCobertura.js');
const { handlePublishedShiftModifiedWithin12h } = requireFn('./lib/coverage/shiftModificationWithin12h.js');
const { advanceSlaUnplannedGap } = requireFn('./lib/coverage/slaUnplannedGapPass.js');

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

function ccAllReal() {
  return { anyEnabled: true, isEnabled: () => true, isDemo: () => false };
}

function ccWithDemo(demoEmpresaIds) {
  const set = new Set(demoEmpresaIds);
  return {
    anyEnabled: true,
    isEnabled: () => true,
    isDemo: (id) => set.has(String(id || '').trim()),
  };
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
    ausDocId: `${prefix}_aus`,
  };
}

async function seedEmpleadoMinimal(empresaId, objectiveId, employeeId, name) {
  await db.collection('empleados').doc(employeeId).set({
    empresaId,
    status: 'ACTIVE',
    name,
    experienciaObjetivos: { [objectiveId]: true },
  });
}

function baseConvFields(s) {
  return {
    empresaId: s.empresaId,
    shiftId: s.titularId,
    objectiveId: s.objectiveId,
    objectiveName: 'Obj Test',
    clientId: s.clientId,
    shiftCode: 'M',
    startTime: s.titular.startTime,
    endTime: s.titular.endTime,
    urgency: 'NORMAL',
    cascadeStep: 3,
    createdBy: 'AUTO',
    timeoutAt: Timestamp.now(),
    createdAt: Timestamp.now(),
  };
}

async function writeConvAndResolve(fields) {
  const ref = db.collection('convocatorias_cobertura').doc();
  const doc = { ...fields, status: 'ACCEPTED', respondedAt: Timestamp.now() };
  await ref.set(doc);
  await resolverCobertura(db, { id: ref.id, ...doc });
  return ref.id;
}

async function seedSla(objectiveId, clientId, mode) {
  const slaId = `${objectiveId}_sla`;
  const basePos = {
    name: 'Puesto 1',
    quantity: 1,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    coverageType: mode === '24h' ? '24hs' : 'custom',
  };
  const positions =
    mode === '24h'
      ? [{
          ...basePos,
          allowedShiftTypes: [
            { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
            { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
          ],
        }]
      : [{
          ...basePos,
          allowedShiftTypes: [{ code: 'M', startTime: '08:00', endTime: '15:00', hours: 8 }],
        }];
  await db.collection('servicios_sla').doc(slaId).set({
    objectiveId,
    clientId,
    status: 'active',
    positions,
  });
  return slaId;
}

async function seedSlaExcludeBand(objectiveId, clientId, dateStr, bandCode) {
  const slaId = `${objectiveId}_sla`;
  await db.collection('servicios_sla').doc(slaId).set({
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
      excludedShiftDates: { [dateStr]: [bandCode] },
      allowedShiftTypes: [
        { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8 },
        { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
      ],
    }],
  });
  return slaId;
}

const autoCompleteCtx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

async function run() {
  if (!(await pingEmulator())) {
    for (let i = 1; i <= 20; i++) {
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
        && src?.isDeleted !== true
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
      const ok =
        cov?.objectiveId === s.objectiveId
        && src?.objectiveId === `${runId}_c2_obj_ref`
        && src?.isDeleted === true
        && src?.deletedReason === 'CONVERTIDO_EN_COBERTURA'
        && src?.convertedToCoverageDocId === covId
        && src?.coverageUsed !== true;
      report(2, ok, ok ? 'REF convertido (baja lógica) + ops_cov en obj titular' : `cov.obj=${cov?.objectiveId} srcDel=${src?.isDeleted}`);
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
      const src = (await db.collection('turnos').doc(s.retSourceId).get()).data();
      const ok =
        active.length === 1
        && cov?.coverageType === 'ESC'
        && !cov?.coverageHoursOnSource
        && src?.isDeleted === true
        && src?.deletedReason === 'CONVERTIDO_EN_COBERTURA';
      report(3, ok, ok ? '1 ops_cov ESC + origen convertido' : `activos=${active.length} srcDel=${src?.isDeleted}`);
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

    // Caso 9 — resolverCobertura: EXTEND → PARTIAL + ADVANCE PENDING → COVERED dual
    {
      const s = await seedBase(`${runId}_c9`);
      await db.collection('turnos').doc(s.extSourceId).update({
        isPresent: true,
        isCompleted: false,
      });
      const advStart = Timestamp.fromMillis(Date.now() + 45 * 60 * 1000);
      await db.collection('turnos').doc(s.advSourceId).update({
        isCompleted: false,
        startTime: advStart,
        endTime: Timestamp.fromMillis(advStart.toMillis() + 8 * 3600000),
      });
      await seedEmpleadoMinimal(s.empresaId, s.objectiveId, s.empExt, 'Guardia EXT');
      await seedEmpleadoMinimal(s.empresaId, s.objectiveId, s.empAdv, 'Guardia ADV');

      const extConvId = await writeConvAndResolve({
        ...baseConvFields(s),
        type: 'EXTEND',
        candidateEmployeeId: s.empExt,
        candidateEmployeeName: 'Guardia EXT',
        extendShiftId: s.extSourceId,
      });

      const titPartial = (await db.collection('turnos').doc(s.titularId).get()).data();
      const advPendingSnap = await db.collection('convocatorias_cobertura')
        .where('shiftId', '==', s.titularId)
        .where('type', '==', 'ADVANCE')
        .where('status', '==', 'PENDING')
        .limit(1)
        .get();

      if (titPartial?.coverageStatus !== 'PARTIAL' || advPendingSnap.empty) {
        report(
          9,
          false,
          `tras EXT: st=${titPartial?.coverageStatus} advPending=${advPendingSnap.size}`,
        );
      } else {
        const advDoc = advPendingSnap.docs[0];
        const advData = advDoc.data();
        await advDoc.ref.update({ status: 'ACCEPTED', respondedAt: Timestamp.now() });
        await resolverCobertura(db, {
          id: advDoc.id,
          ...advData,
          status: 'ACCEPTED',
        });

        const tit = (await db.collection('turnos').doc(s.titularId).get()).data();
        const ops = (await db.collection('turnos').where('absenceShiftId', '==', s.titularId).get()).docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((d) => d.coverageSuperseded !== true);
        const aus = (await db.collection('ausencias').doc(s.ausDocId).get()).data();
        const extConv = (await db.collection('convocatorias_cobertura').doc(extConvId).get()).data();
        const ok =
          tit?.coverageStatus === 'COVERED'
          && ops.length === 2
          && ops.every((d) => d.coverageHoursOnSource === true)
          && aus?.coberturaEstado === 'GESTIONADA'
          && extConv?.status === 'ACCEPTED';
        report(
          9,
          ok,
          ok
            ? 'resolver EXT→PARTIAL+ADV PENDING→COVERED + 2 ops trace + RRHH GESTIONADA'
            : `st=${tit?.coverageStatus} ops=${ops.length} aus=${aus?.coberturaEstado}`,
        );
      }
    }

    // Caso 10 — dos RET aceptados en paralelo → 1 cobertura, otra conv CANCELLED
    {
      const prefix = `${runId}_c10`;
      const s = await seedBase(prefix);
      const empRet2 = `${prefix}_e_ret2`;
      const retSource2 = `${prefix}_ret_src2`;
      await db.collection('turnos').doc(retSource2).set({
        employeeId: empRet2,
        employeeName: 'Guardia RET 2',
        code: 'RET',
        objectiveId: s.objectiveId,
        clientId: s.clientId,
        empresaId: s.empresaId,
        startTime: tsAt(2026, 9, 23, 7, 0),
        endTime: tsAt(2026, 9, 23, 15, 0),
      });

      const convBase = baseConvFields(s);
      const mkRetConv = async (empId, name, shiftId) => {
        const ref = db.collection('convocatorias_cobertura').doc();
        const doc = {
          ...convBase,
          type: 'RET',
          cascadeStep: 0,
          candidateEmployeeId: empId,
          candidateEmployeeName: name,
          candidateShiftId: shiftId,
          status: 'ACCEPTED',
          respondedAt: Timestamp.now(),
        };
        await ref.set(doc);
        return { id: ref.id, ...doc };
      };

      const c1 = await mkRetConv(s.empRet, 'Guardia RET', s.retSourceId);
      const c2 = await mkRetConv(empRet2, 'Guardia RET 2', retSource2);

      await Promise.all([
        resolverCobertura(db, c1),
        resolverCobertura(db, c2),
      ]);

      const ops = (await db.collection('turnos').where('absenceShiftId', '==', s.titularId).get()).docs
        .filter((d) => d.data().coverageSuperseded !== true && d.data().status !== 'CANCELLED');
      const convSnaps = await Promise.all([
        db.collection('convocatorias_cobertura').doc(c1.id).get(),
        db.collection('convocatorias_cobertura').doc(c2.id).get(),
      ]);
      const statuses = convSnaps.map((snap) => ({
        id: snap.id,
        status: snap.data()?.status,
        cancelReason: snap.data()?.cancelReason,
      }));
      const cancelled = statuses.filter((x) => x.status === 'CANCELLED');
      const ok =
        ops.length === 1
        && cancelled.length === 1
        && ['ALREADY_COVERED', 'CLAIM_HELD_BY_OTHER_CONVOCATORIA'].includes(
          cancelled[0].cancelReason || '',
        );
      report(
        10,
        ok,
        ok
          ? `1 ops_cov + conv ${cancelled[0].cancelReason}`
          : `ops=${ops.length} convs=${JSON.stringify(statuses)}`,
      );
    }

    // Caso 11 — sin continuidad SLA → cierre SIN_CONTINUIDAD_SLA
    {
      const prefix = `${runId}_c11`;
      const objectiveId = `${prefix}_obj`;
      await seedSla(objectiveId, `${prefix}_cli`, 'partial');
      const shiftId = `${prefix}_saliente`;
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`,
        objectiveId,
        clientId: `${prefix}_cli`,
        positionName: 'Puesto 1',
        employeeId: `${prefix}_e1`,
        employeeName: 'Saliente',
        code: 'M',
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
        startTime: tsAt(2026, 9, 23, 8, 0),
        endTime: tsAt(2026, 9, 23, 15, 0),
      });
      await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAt(2026, 9, 23, 15, 10));
      const data = (await db.collection('turnos').doc(shiftId).get()).data();
      const ok =
        data?.status === 'COMPLETED'
        && data?.completionReason === 'SIN_CONTINUIDAD_SLA'
        && data?.isRetention !== true;
      report(11, ok, ok ? 'COMPLETED sin retención' : `st=${data?.status} ret=${data?.isRetention} r=${data?.completionReason}`);
    }

    // Caso 12 — 24h: saliente M presente, entrante T ausente → 1 retención
    {
      const prefix = `${runId}_c12`;
      const objectiveId = `${prefix}_obj`;
      const empresaId = `${prefix}_emp`;
      await seedSla(objectiveId, `${prefix}_cli`, '24h');
      const salId = `${prefix}_m`;
      const entId = `${prefix}_t`;
      await db.batch()
        .set(db.collection('turnos').doc(salId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eM`,
          employeeName: 'Saliente M', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
          checkInTime: tsAt(2026, 9, 23, 6, 55),
        })
        .set(db.collection('turnos').doc(entId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eT`,
          employeeName: 'Entrante T', code: 'T', status: 'ABSENT', isAbsent: true,
          startTime: tsAt(2026, 9, 23, 15, 0), endTime: tsAt(2026, 9, 23, 23, 0),
        })
        .commit();
      const r = await retainOutgoingForGap(db, { id: entId, ...(await db.collection('turnos').doc(entId).get()).data() }, { sendPush: false });
      const nov = await db.collection('novedades').where('absenceShiftId', '==', entId).where('type', '==', 'RETENCION_AUSENCIA_RELEVO').get();
      const sal = (await db.collection('turnos').doc(salId).get()).data();
      const ok = r.applied && sal?.isRetention === true && nov.size === 1;
      report(12, ok, ok ? 'retenido saliente M + 1 novedad' : `applied=${r.applied} nov=${nov.size}`);
    }

    // Caso 13 — 2 pax: A 06:50, B 06:58 → retiene B
    {
      const prefix = `${runId}_c13`;
      const objectiveId = `${prefix}_obj`;
      const empresaId = `${prefix}_emp`;
      const entId = `${prefix}_ent`;
      const aId = `${prefix}_a`;
      const bId = `${prefix}_b`;
      await db.batch()
        .set(db.collection('turnos').doc(aId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eA`, employeeName: 'A',
          code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
          checkInTime: tsAt(2026, 9, 23, 6, 50),
        })
        .set(db.collection('turnos').doc(bId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eB`, employeeName: 'B',
          code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
          checkInTime: tsAt(2026, 9, 23, 6, 58),
        })
        .set(db.collection('turnos').doc(entId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eT`, employeeName: 'Entrante',
          code: 'T', isAbsent: true, status: 'ABSENT',
          startTime: tsAt(2026, 9, 23, 15, 0), endTime: tsAt(2026, 9, 23, 23, 0),
        })
        .commit();
      const r = await retainOutgoingForGap(db, { id: entId, ...(await db.collection('turnos').doc(entId).get()).data() }, { sendPush: false });
      const b = (await db.collection('turnos').doc(bId).get()).data();
      const a = (await db.collection('turnos').doc(aId).get()).data();
      const ok = r.applied && b?.isRetention === true && a?.isRetention !== true;
      report(13, ok, ok ? 'retenido B (último fichaje)' : `bRet=${b?.isRetention} aRet=${a?.isRetention}`);
    }

    // Caso 14 — compañero en medio de turno largo NO retenido
    {
      const prefix = `${runId}_c14`;
      const objectiveId = `${prefix}_obj`;
      const empresaId = `${prefix}_emp`;
      const longId = `${prefix}_long`;
      const entId = `${prefix}_ent`;
      await db.batch()
        .set(db.collection('turnos').doc(longId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eL`, employeeName: 'Largo',
          code: 'D12', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 8, 0), endTime: tsAt(2026, 9, 23, 20, 0),
          checkInTime: tsAt(2026, 9, 23, 7, 55),
        })
        .set(db.collection('turnos').doc(entId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eT`,
          code: 'T', isAbsent: true, status: 'ABSENT',
          startTime: tsAt(2026, 9, 23, 15, 0), endTime: tsAt(2026, 9, 23, 23, 0),
        })
        .commit();
      const r = await retainOutgoingForGap(db, { id: entId, ...(await db.collection('turnos').doc(entId).get()).data() }, { sendPush: false });
      const long = (await db.collection('turnos').doc(longId).get()).data();
      const ok = !r.applied && long?.isRetention !== true;
      report(14, ok, ok ? 'sin retención compañero en turno' : `applied=${r.applied} longRet=${long?.isRetention}`);
    }

    // Caso 15 — Manual: retención sí, cascada no
    {
      const prefix = `${runId}_c15`;
      const objectiveId = `${prefix}_obj`;
      const empresaId = `${prefix}_emp`;
      await seedSla(objectiveId, `${prefix}_cli`, '24h');
      await db.collection('sesiones_operador').add({
        empresaId,
        status: 'ACTIVO',
        operatorId: 'op_test',
        operatorName: 'Operador Test',
        startTime: Timestamp.now(),
        role: 'PILOTO',
      });
      const salId = `${prefix}_m`;
      const entId = `${prefix}_t`;
      await db.batch()
        .set(db.collection('turnos').doc(salId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eM`,
          employeeName: 'Saliente M', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
          checkInTime: tsAt(2026, 9, 23, 6, 55),
        })
        .set(db.collection('turnos').doc(entId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eT`,
          employeeName: 'Entrante T', code: 'T', status: 'ABSENT', isAbsent: true,
          startTime: tsAt(2026, 9, 23, 15, 0), endTime: tsAt(2026, 9, 23, 23, 0),
        })
        .commit();
      const entData = (await db.collection('turnos').doc(entId).get()).data();
      const manual = await isEmpresaManualMode(db, empresaId);
      await retainOutgoingForGap(db, { id: entId, ...entData }, { sendPush: false });
      if (!manual) {
        await iniciarCascadaCobertura(db, {
          id: entId,
          empresaId,
          objectiveId,
          objectiveName: 'Obj',
          positionName: 'Puesto 1',
          startTime: entData.startTime,
          endTime: entData.endTime,
        }, 'AUTO');
      }
      const convs = await db.collection('convocatorias_cobertura').where('shiftId', '==', entId).get();
      const retained = await db.collection('turnos').where('retentionAbsenceShiftId', '==', entId).get();
      const ok = manual && retained.size >= 1 && convs.size === 0;
      report(15, ok, ok ? 'Manual: retención sin convocatorias' : `manual=${manual} ret=${retained.size} conv=${convs.size}`);
    }

    // Caso 16 — applyCoverage FULL libera retenido
    {
      const prefix = `${runId}_c16`;
      const s = await seedBase(prefix);
      await db.collection('turnos').doc(s.retSourceId).update({
        isPresent: true,
        isCompleted: false,
        startTime: tsAt(2026, 9, 22, 23, 0),
        endTime: tsAt(2026, 9, 23, 7, 0),
        checkInTime: tsAt(2026, 9, 23, 6, 55),
      });
      await retainOutgoingForGap(db, { id: s.titularId, ...s.titular, isAbsent: true }, { sendPush: false });
      const batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular, isAbsent: true },
        candidateEmployeeId: s.empRet,
        candidateEmployeeName: 'Guardia RET',
        sourceShiftId: s.retSourceId,
        coverageType: 'RET',
        resolvedBy: 'AUTO',
        empresaId: s.empresaId,
        titularCloseMode: 'FULL',
      });
      await batch.commit();
      const ret = (await db.collection('turnos').doc(s.retSourceId).get()).data();
      const ok = ret?.isRetention === false || ret?.isRetention !== true;
      report(16, ok, ok ? 'retenido liberado tras FULL' : `isRet=${ret?.isRetention}`);
    }

    // Caso 17 — tope 12h con continuidad → novedad, no cierre
    {
      const prefix = `${runId}_c17`;
      const objectiveId = `${prefix}_obj`;
      await seedSla(objectiveId, `${prefix}_cli`, '24h');
      const shiftId = `${prefix}_ret12`;
      const endPlan = tsAt(2026, 9, 23, 15, 0);
      const checkIn = Timestamp.fromMillis(endPlan.toMillis() - RETENTION_MAX_TOTAL_MS - 60000);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`,
        objectiveId,
        positionName: 'Puesto 1',
        employeeId: `${prefix}_e1`,
        employeeName: 'Retenido 12h',
        code: 'M',
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
        isRetention: true,
        autoRetentionAt: endPlan,
        checkInTime: checkIn,
        startTime: Timestamp.fromMillis(checkIn.toMillis() - 4 * 3600000),
        endTime: endPlan,
      });
      await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAt(2026, 9, 23, 16, 0));
      const data = (await db.collection('turnos').doc(shiftId).get()).data();
      const nov = await db.collection('novedades').where('shiftId', '==', shiftId).where('type', '==', 'RETENCION_TOPE_12H').get();
      const slaDoc = (await db.collection('servicios_sla').doc(`${objectiveId}_sla`).get()).data();
      const cont = positionHasContinuityFromSlaDoc(slaDoc, 'Puesto 1', new Date(data.endTime.toMillis()));
      const ok = cont && data?.status === 'PRESENT' && nov.size >= 1;
      report(17, ok, ok ? 'sigue retenido + RETENCION_TOPE_12H' : `st=${data?.status} nov=${nov.size} cont=${cont}`);
    }

    // Caso 18 — 2 pax: compañero 1h antes no cierra al saliente; relevo no llega → retención
    {
      const prefix = `${runId}_c18`;
      const objectiveId = `${prefix}_obj`;
      const empresaId = `${prefix}_emp`;
      await seedSla(objectiveId, `${prefix}_cli`, '24h');
      const salId = `${prefix}_sal`;
      const compId = `${prefix}_comp`;
      const relId = `${prefix}_rel_pending`;
      await db.batch()
        .set(db.collection('turnos').doc(salId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eS`,
          employeeName: 'Saliente', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
          checkInTime: tsAt(2026, 9, 23, 6, 50),
        })
        .set(db.collection('turnos').doc(compId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eC`,
          employeeName: 'Compañero', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 14, 0), endTime: tsAt(2026, 9, 23, 22, 0),
          checkInTime: tsAt(2026, 9, 23, 13, 55),
        })
        .set(db.collection('turnos').doc(relId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eR`,
          employeeName: 'Relevo T', code: 'T', status: 'PENDING', isPresent: false,
          startTime: tsAt(2026, 9, 23, 15, 0), endTime: tsAt(2026, 9, 23, 23, 0),
        })
        .commit();
      await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAt(2026, 9, 23, 15, 10));
      const sal = (await db.collection('turnos').doc(salId).get()).data();
      const ok = sal?.status === 'PRESENT' && sal?.isRetention === true && sal?.isCompleted !== true;
      report(18, ok, ok ? 'saliente retenido (compañero no relevo)' : `st=${sal?.status} ret=${sal?.isRetention}`);
    }

    // Caso 19 — RELEVO_NO_PRESENTADO vinculado → ausente relevo → adopt → FULL libera
    {
      const prefix = `${runId}_c19`;
      const objectiveId = `${prefix}_obj`;
      const empresaId = `${prefix}_emp`;
      await seedSla(objectiveId, `${prefix}_cli`, '24h');
      const salId = `${prefix}_sal`;
      const entId = `${prefix}_ent`;
      await db.batch()
        .set(db.collection('turnos').doc(salId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eS`,
          employeeName: 'Saliente', code: 'M', status: 'PRESENT', isPresent: true, isCompleted: false,
          startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
          checkInTime: tsAt(2026, 9, 23, 6, 55),
        })
        .set(db.collection('turnos').doc(entId), {
          empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eT`,
          employeeName: 'Entrante', code: 'T', status: 'PENDING', isPresent: false,
          startTime: tsAt(2026, 9, 23, 15, 0), endTime: tsAt(2026, 9, 23, 23, 0),
        })
        .commit();
      await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAt(2026, 9, 23, 15, 10));
      await db.collection('turnos').doc(entId).update({ status: 'ABSENT', isAbsent: true });
      const entData = (await db.collection('turnos').doc(entId).get()).data();
      await retainOutgoingForGap(db, { id: entId, ...entData }, { sendPush: false });
      const retained = (await db.collection('turnos').where('objectiveId', '==', objectiveId).where('isRetention', '==', true).get()).docs;
      const salBefore = (await db.collection('turnos').doc(salId).get()).data();
      const covRetId = `${prefix}_cov_ret`;
      await db.collection('turnos').doc(covRetId).set({
        empresaId, objectiveId, positionName: 'Puesto 1', employeeId: `${prefix}_eCov`,
        employeeName: 'Cobertura', code: 'RET', status: 'PRESENT', isPresent: true,
        startTime: tsAt(2026, 9, 23, 7, 0), endTime: tsAt(2026, 9, 23, 15, 0),
      });
      const batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: entId,
        titularShift: { id: entId, ...entData, isAbsent: true, objectiveId, positionName: 'Puesto 1', empresaId },
        candidateEmployeeId: `${prefix}_eCov`,
        candidateEmployeeName: 'Cobertura',
        sourceShiftId: covRetId,
        coverageType: 'RET',
        resolvedBy: 'AUTO',
        empresaId,
        titularCloseMode: 'FULL',
      });
      await batch.commit();
      const salAfter = (await db.collection('turnos').doc(salId).get()).data();
      const ok =
        retained.length === 1
        && salBefore?.retentionAbsenceShiftId === entId
        && (salAfter?.isRetention === false || salAfter?.isRetention !== true);
      report(19, ok, ok ? '1 retenido vinculado + liberado tras FULL' : `ret=${retained.length} link=${salBefore?.retentionAbsenceShiftId}`);
    }

    // Caso 20 — banda T excluida ese día → sin continuidad → cierre
    {
      const prefix = `${runId}_c20`;
      const objectiveId = `${prefix}_obj`;
      const dateStr = '2026-09-23';
      await seedSlaExcludeBand(objectiveId, `${prefix}_cli`, dateStr, 'T');
      const salId = `${prefix}_sal`;
      await db.collection('turnos').doc(salId).set({
        empresaId: `${prefix}_emp`,
        objectiveId,
        positionName: 'Puesto 1',
        employeeId: `${prefix}_e1`,
        employeeName: 'Saliente',
        code: 'M',
        status: 'PRESENT',
        isPresent: true,
        isCompleted: false,
        startTime: tsAt(2026, 9, 23, 7, 0),
        endTime: tsAt(2026, 9, 23, 15, 0),
      });
      await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAt(2026, 9, 23, 15, 10));
      const sal = (await db.collection('turnos').doc(salId).get()).data();
      const ok = sal?.status === 'COMPLETED' && sal?.completionReason === 'SIN_CONTINUIDAD_SLA';
      report(20, ok, ok ? 'COMPLETED banda excluida' : `st=${sal?.status} r=${sal?.completionReason}`);
    }

    // Caso 21 — ops_cov EXT registro T+40 sin fichar → no AA (pipeline excluido)
    {
      const prefix = `${runId}_c21`;
      const base = await seedBase(prefix);
      const batch = db.batch();
      await applyCoverage(db, batch, {
        titularShiftId: base.titularId,
        titularShift: { id: base.titularId, ...base.titular, objectiveId: base.objectiveId, empresaId: base.empresaId },
        candidateEmployeeId: base.empExt,
        candidateEmployeeName: 'Ext',
        sourceShiftId: base.extSourceId,
        coverageType: 'EXTEND',
        resolvedBy: 'AUTO',
        empresaId: base.empresaId,
        titularCloseMode: 'FULL',
      });
      await batch.commit();
      const traceId = buildOpsCoverageDocId(base.titularId, base.empExt);
      const startPast = Timestamp.fromMillis(Date.now() - 40 * 60 * 1000);
      await db.collection('turnos').doc(traceId).update({ startTime: startPast, isPresent: false, status: 'PENDING' });
      const trace = (await db.collection('turnos').doc(traceId).get()).data();
      const skip = skipAbsencePipelineForShift(trace);
      if (!skip) await markShiftAbsent(db, traceId, { reason: 'AUTO_T30', by: 'E2E' });
      const after = (await db.collection('turnos').doc(traceId).get()).data();
      const ok = skip === true && after?.isAbsent !== true;
      report(21, ok, ok ? 'EXT registro sin AA' : `skip=${skip} absent=${after?.isAbsent}`);
    }

    // Caso 22 — No voy → AA + RRHH + 1 novedad
    {
      const prefix = `${runId}_c22`;
      const shiftId = `${prefix}_sh`;
      const empresaId = `${prefix}_emp`;
      await db.collection('turnos').doc(shiftId).set({
        empresaId, employeeId: `${prefix}_e`, employeeName: 'Titular',
        objectiveId: `${prefix}_obj`, clientId: `${prefix}_cli`, positionName: 'Puesto 1', code: 'M',
        startTime: tsAt(2026, 9, 23, 8, 0), endTime: tsAt(2026, 9, 23, 16, 0), status: 'PENDING',
      });
      await markShiftAbsent(db, shiftId, { reason: 'LLEGADA_TARDE_RECHAZADA', by: 'E2E' });
      const aus = await db.collection('ausencias').where('shiftId', '==', shiftId).get();
      const nov = await db.collection('novedades').where('shiftId', '==', shiftId).where('type', '==', 'AUSENCIA_AUTO').get();
      const sh = (await db.collection('turnos').doc(shiftId).get()).data();
      const ok = sh?.isAbsent && aus.size === 1 && aus.docs[0].data()?.type === 'No Presentacion'
        && aus.docs[0].data()?.origin === 'LLEGADA_TARDE_RECHAZADA' && nov.size === 1;
      report(22, ok, ok ? 'AA + RRHH + 1 novedad' : `aus=${aus.size} nov=${nov.size}`);
    }

    // Caso 23 — aviso eta 30: T+20 sin AA; T+31 ETA_VENCIDA
    {
      const prefix = `${runId}_c23`;
      const shiftId = `${prefix}_sh`;
      const start = tsAt(2026, 9, 23, 10, 0);
      const etaAt = Timestamp.fromMillis(start.toMillis() + 30 * 60 * 1000);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'T',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: start, endTime: tsAt(2026, 9, 23, 18, 0), status: 'PENDING',
        lateArrivalAt: Timestamp.now(), lateArrivalEtaMinutes: 30, lateArrivalEtaAt: etaAt,
      });
      const t20 = Timestamp.fromMillis(start.toMillis() + 20 * 60 * 1000);
      const deadline = Math.min(etaAt.toMillis(), start.toMillis() + 60 * 60 * 1000);
      const ok20 = t20.toMillis() < deadline;
      const t31 = Timestamp.fromMillis(start.toMillis() + 31 * 60 * 1000);
      if (t31.toMillis() >= deadline) {
        await markShiftAbsent(db, shiftId, { reason: 'ETA_VENCIDA', by: 'E2E' });
      }
      const sh = (await db.collection('turnos').doc(shiftId).get()).data();
      const ok = ok20 && sh?.isAbsent && sh?.absenceDetectedBy === 'ETA_VENCIDA';
      report(23, ok, ok ? 'T+20 ok; T+31 ETA_VENCIDA' : `abs=${sh?.isAbsent} by=${sh?.absenceDetectedBy}`);
    }

    // Caso 24 — fichada T+18 con aviso → presente, realStartTime llegada, lateMinutes 18
    {
      const prefix = `${runId}_c24`;
      const shiftId = `${prefix}_sh`;
      const start = tsAt(2026, 9, 24, 8, 0);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'T',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: start, endTime: tsAt(2026, 9, 24, 16, 0), status: 'PENDING',
        lateArrivalAt: Timestamp.fromMillis(start.toMillis() + 5 * 60 * 1000),
        lateArrivalEtaMinutes: 30,
        lateArrivalEtaAt: Timestamp.fromMillis(start.toMillis() + 30 * 60 * 1000),
      });
      const recordedAt = new Date(start.toMillis() + 18 * 60 * 1000).toISOString();
      await registrarPresencia(db, {
        shiftId, source: 'PORTAL_GPS', empId: `${prefix}_e`, recordedAt,
      });
      const sh = (await db.collection('turnos').doc(shiftId).get()).data();
      const realMs = sh?.realStartTime?.toMillis?.() ?? 0;
      const ok = sh?.isPresent && Math.abs(realMs - (start.toMillis() + 18 * 60 * 1000)) < 5000
        && (sh?.lateMinutes === 18 || sh?.isLate === true);
      report(24, ok, ok ? 'presente + realStart + late 18' : `late=${sh?.lateMinutes} real=${realMs}`);
    }

    // Caso 25 — T+10 sin aviso → rechazada ventana
    {
      const prefix = `${runId}_c25`;
      const start = tsAt(2026, 9, 24, 9, 0);
      const shiftId = `${prefix}_sh`;
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'T',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: start, endTime: tsAt(2026, 9, 24, 17, 0), status: 'PENDING',
      });
      const nowMs = start.toMillis() + 10 * 60 * 1000;
      const win = evaluateServerCheckInWindow(
        (await db.collection('turnos').doc(shiftId).get()).data(),
        nowMs,
        { source: 'PORTAL_GPS' },
      );
      report(25, win.allowed === false, win.allowed === false ? 'rechazada ventana T+10' : `allowed=${win.allowed}`);
    }

    // Caso 26 — RET convocado sin fichar → CONVOCADO_NO_LLEGO + relanzar (Auto)
    {
      const prefix = `${runId}_c26`;
      const titularId = `${prefix}_tit`;
      const covId = `${prefix}_cov`;
      const empresaId = `${prefix}_emp`;
      const objectiveId = `${prefix}_obj`;
      const created = Timestamp.fromMillis(Date.now() - 70 * 60 * 1000);
      const start = Timestamp.fromMillis(Date.now() - 65 * 60 * 1000);
      await db.batch()
        .set(db.collection('turnos').doc(titularId), {
          empresaId, objectiveId, positionName: 'P1', employeeId: `${prefix}_eT`, employeeName: 'Titular',
          code: 'M', startTime: start, endTime: Timestamp.fromMillis(Date.now() + 5 * 3600000),
          isAbsent: true, status: 'ABSENT', absenceType: 'AA',
          operacionallyCovered: true, coverageStatus: 'COVERED',
          coveredByEmployeeId: `${prefix}_eR`, coveredByEmployeeName: 'RET cov', coverageDocId: covId,
        })
        .set(db.collection('turnos').doc(covId), {
          empresaId, objectiveId, positionName: 'P1', employeeId: `${prefix}_eR`, employeeName: 'RET cov',
          code: 'RET', origin: 'OPERATIONS_COVERAGE', coverageType: 'RET',
          absenceShiftId: titularId, startTime: start, endTime: Timestamp.fromMillis(Date.now() + 5 * 3600000),
          createdAt: created, status: 'PENDING', isPresent: false,
        })
        .set(db.collection('empresas').doc(empresaId), { centroControlEnabled: true, modoDemoEnabled: false }, { merge: true })
        .commit();
      await db.collection('ausencias').add({
        shiftId: titularId, employeeId: `${prefix}_eT`, empresaId, coberturaEstado: 'GESTIONADA', status: 'Confirmada',
      });
      await runConvocadoAbsentPass(db, Timestamp.now(), ccAllReal());
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      const tit = (await db.collection('turnos').doc(titularId).get()).data();
      const aus = await db.collection('ausencias').where('shiftId', '==', titularId).limit(1).get();
      const ok =
        cov?.isAbsent === true
        && cov?.absenceDetectedBy === 'CONVOCADO_NO_LLEGO'
        && tit?.operacionallyCovered === false
        && aus.docs[0]?.data()?.coberturaEstado === 'PENDIENTE';
      report(26, ok, ok ? 'CONVOCADO_NO_LLEGO + titular descubierto' : `abs=${cov?.isAbsent} cov=${tit?.operacionallyCovered}`);
    }

    // Caso 27 — revertir T+45 sin cobertura
    {
      const prefix = `${runId}_c27`;
      const shiftId = `${prefix}_sh`;
      const start = Timestamp.fromMillis(Date.now() - 45 * 60 * 1000);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'T',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: start, endTime: Timestamp.fromMillis(Date.now() + 4 * 3600000),
        isAbsent: true, status: 'ABSENT', absenceType: 'AA', absenceDetectedAt: Timestamp.now(),
      });
      await db.collection('ausencias').add({
        shiftId, employeeId: `${prefix}_e`, type: 'No Presentacion', status: 'Confirmada', origin: 'AUTO_T30',
      });
      const r = await revertirAusenciaShift(db, { shiftId, cancelCoverage: false });
      const sh = (await db.collection('turnos').doc(shiftId).get()).data();
      const aus = await db.collection('ausencias').where('shiftId', '==', shiftId).get();
      const ok = r.success && sh?.isPresent && aus.docs[0]?.data()?.status === 'Anulada';
      report(27, ok, ok ? 'revertida T+45' : `success=${r.success} st=${sh?.status}`);
    }

    // Caso 28 — revertir T+70 rechazada
    {
      const prefix = `${runId}_c28`;
      const shiftId = `${prefix}_sh`;
      const start = Timestamp.fromMillis(Date.now() - 70 * 60 * 1000);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'T',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: start, endTime: Timestamp.fromMillis(Date.now() + 2 * 3600000),
        isAbsent: true, status: 'ABSENT',
      });
      const r = await revertirAusenciaShift(db, { shiftId });
      report(28, r.success === false && r.reason === 'PAST_T60', r.reason === 'PAST_T60' ? 'rechazada T+70' : `r=${r.reason}`);
    }

    // Caso 29 — isEarlyStart ADV: fichada adjustedStart −10 → presente, realStart = adjusted
    {
      const prefix = `${runId}_c29`;
      const shiftId = `${prefix}_sh`;
      const planned = tsAt(2026, 9, 24, 14, 0);
      const adjusted = tsAt(2026, 9, 24, 10, 0);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'ADV',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: planned, endTime: tsAt(2026, 9, 24, 22, 0), status: 'PENDING',
        isEarlyStart: true, adjustedStartTime: adjusted,
      });
      const recordedAt = new Date(adjusted.toMillis() - 10 * 60 * 1000).toISOString();
      await registrarPresencia(db, { shiftId, source: 'PORTAL_GPS', empId: `${prefix}_e`, recordedAt });
      const sh = (await db.collection('turnos').doc(shiftId).get()).data();
      const realMs = sh?.realStartTime?.toMillis?.() ?? 0;
      const ok = sh?.isPresent && realMs === adjusted.toMillis();
      report(29, ok, ok ? 'ADV earlyStart −10 presente' : `present=${sh?.isPresent} real=${realMs} adj=${adjusted.toMillis()}`);
    }

    // Caso 30 — aviso sin eta: T+40 rechazada (ventana cierra T+30)
    {
      const prefix = `${runId}_c30`;
      const shiftId = `${prefix}_sh`;
      const start = tsAt(2026, 9, 24, 11, 0);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`, employeeId: `${prefix}_e`, employeeName: 'T',
        objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
        startTime: start, endTime: tsAt(2026, 9, 24, 19, 0), status: 'PENDING',
        lateArrivalAt: Timestamp.fromMillis(start.toMillis() + 5 * 60 * 1000),
      });
      const nowMs = start.toMillis() + 40 * 60 * 1000;
      const win = evaluateServerCheckInWindow(
        (await db.collection('turnos').doc(shiftId).get()).data(),
        nowMs,
        { source: 'PORTAL_GPS' },
      );
      report(30, win.allowed === false && win.rejectCode === 'TOO_LATE', win.rejectCode === 'TOO_LATE' ? 'T+40 rechazada sin eta' : `allowed=${win.allowed} code=${win.rejectCode}`);
    }

    // Caso 31 — política retiro <2 h con compañeros → NO_REPLACE
    {
      const p = resolveEarlyWithdrawReplacePolicy({
        hoursLeft: 1.5,
        colleaguesPresent: 2,
        reemplazarRetiro2a3h: null,
        isAutoMode: false,
      });
      report(31, p === 'NO_REPLACE', `policy=${p}`);
    }

    // Caso 32 — retiro anticipado >3 h crea remanente
    {
      const prefix = `${runId}_c32`;
      const shiftId = `${prefix}_sh`;
      const now = Date.now();
      const start = Timestamp.fromMillis(now - 4 * 3600000);
      const end = Timestamp.fromMillis(now + 5 * 3600000);
      await db.collection('turnos').doc(shiftId).set({
        empresaId: `${prefix}_emp`,
        employeeId: `${prefix}_e`,
        employeeName: 'Titular',
        objectiveId: `${prefix}_obj`,
        objectiveName: 'Obj',
        positionName: 'Puesto 1',
        code: 'M',
        startTime: start,
        endTime: end,
        isPresent: true,
        status: 'PRESENT',
      });
      await db.collection('servicios_sla').add({
        objectiveId: `${prefix}_obj`,
        status: 'active',
        positions: [{ name: 'Puesto 1', reemplazarRetiro2a3h: true }],
      });
      const r = await processEarlyWithdrawal(db, {
        shiftId,
        reason: 'ENFERMEDAD',
        resolvedBy: 'OPERACIONES',
      });
      const sh = (await db.collection('turnos').doc(shiftId).get()).data();
      report(
        32,
        r.ok && r.remainderShiftId && sh?.isCompleted === true,
        r.ok ? `rem=${r.remainderShiftId}` : r.error,
      );
    }

    // Caso 33 — escalar vacante sin cobertura marca isSinCobertura
    {
      const prefix = `${runId}_c33`;
      const vacId = `${prefix}_vac`;
      await db.collection('turnos').doc(vacId).set({
        empresaId: `${prefix}_emp`,
        objectiveId: `${prefix}_obj`,
        objectiveName: 'Obj',
        positionName: 'P1',
        employeeId: 'VACANTE',
        startTime: Timestamp.fromMillis(Date.now() + 3600000),
        endTime: Timestamp.fromMillis(Date.now() + 9 * 3600000),
        isUnassigned: true,
      });
      await db.collection('system_users').doc(`${prefix}_sup`).set({
        objetivosAsignados: [`${prefix}_obj`],
        role: 'supervisor',
      });
      const esc = await escalarVacanteSinCobertura(db, {
        shiftId: vacId,
        empresaId: `${prefix}_emp`,
        objectiveId: `${prefix}_obj`,
        attemptRetention: false,
      });
      const vac = (await db.collection('turnos').doc(vacId).get()).data();
      const nov = await db.collection('novedades').doc(`escalada_${vacId}`).get();
      report(
        33,
        esc.escalated && vac?.isSinCobertura === true && nov.exists,
        `esc=${esc.escalated} sup=${esc.supervisorsNotified}`,
      );
    }

    // Caso 34 — turno publicado modificado <12 h + cobertura huérfana
    {
      const prefix = `${runId}_c34`;
      const shiftId = `${prefix}_tit`;
      const covId = `ops_cov_${shiftId}_covEmp`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      const obj = `${prefix}_obj`;
      const newStart = Timestamp.fromMillis(Date.now() + 6 * 3600000);
      const d = new Date(newStart.toMillis());
      const planKey = `${obj}_${d.getFullYear()}_${d.getMonth() + 1}`;
      await db.collection('planificacion_estados').doc(planKey).set({ publishedAt: Timestamp.now() });
      const before = {
        employeeId: `${prefix}_e`,
        objectiveId: obj,
        objectiveName: 'Obj',
        empresaId: `${prefix}_emp`,
        startTime: Timestamp.fromMillis(newStart.toMillis() + 3600000),
        endTime: Timestamp.fromMillis(newStart.toMillis() + 9 * 3600000),
        code: 'M',
        draft: false,
        coverageDocId: covId,
      };
      const after = { ...before, startTime: newStart };
      await db.collection('turnos').doc(covId).set({
        origin: 'OPERATIONS_COVERAGE',
        absenceShiftId: shiftId,
        employeeId: 'covEmp',
        status: 'PENDING',
      });
      const h = await handlePublishedShiftModifiedWithin12h(db, before, after, shiftId);
      const modNov = await db.collection('novedades').doc(`mod12h_${shiftId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}_${newStart.toMillis()}`).get();
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      report(
        34,
        h.notified && modNov.exists && cov?.coverageOrphaned === true,
        `notif=${h.notified} orphan=${cov?.coverageOrphaned}`,
      );
    }

    // Caso 35 — hueco SLA sin plan: fases planificación y CC
    {
      const prefix = `${runId}_c35`;
      const gapId = `${prefix}_gap`;
      const gapStart = Timestamp.fromMillis(Date.now() + 20 * 3600000);
      const gapEnd = Timestamp.fromMillis(Date.now() + 28 * 3600000);
      await db.collection('sla_huecos_sin_plan').doc(gapId).set({
        empresaId: `${prefix}_emp`,
        objectiveId: `${prefix}_obj`,
        objectiveName: 'Obj',
        positionName: 'P1',
        gapStart,
        gapEnd,
        status: 'OPEN',
      });
      const p1 = await advanceSlaUnplannedGap(db, {
        id: gapId,
        empresaId: `${prefix}_emp`,
        objectiveId: `${prefix}_obj`,
        positionName: 'P1',
        gapStart,
        gapEnd,
      });
      const planNov = await db.collection('novedades').doc(`sla_gap_plan_${gapId}`).get();
      const gapStart2 = Timestamp.fromMillis(Date.now() + 8 * 3600000);
      await db.collection('sla_huecos_sin_plan').doc(`${gapId}_2`).set({
        empresaId: `${prefix}_emp`,
        objectiveId: `${prefix}_obj`,
        positionName: 'P1',
        gapStart: gapStart2,
        gapEnd: Timestamp.fromMillis(Date.now() + 16 * 3600000),
        status: 'OPEN',
      });
      const p2 = await advanceSlaUnplannedGap(
        db,
        {
          id: `${gapId}_2`,
          empresaId: `${prefix}_emp`,
          objectiveId: `${prefix}_obj`,
          positionName: 'P1',
          gapStart: gapStart2,
          gapEnd: Timestamp.fromMillis(Date.now() + 16 * 3600000),
        },
        Timestamp.now(),
      );
      report(
        35,
        p1.phase === 'PLANNING_INBOX' && planNov.exists && p2.phase === 'CC_VACANCY' && !!p2.shiftId,
        `p1=${p1.phase} p2=${p2.phase}`,
      );
    }

    // Caso 36 — FT applyCoverage (titular vacante + franco fuente)
    {
      const prefix = `${runId}_c36`;
      const titularId = `${prefix}_tit`;
      const francoId = `${prefix}_fr`;
      const empId = `${prefix}_ft`;
      const start = Timestamp.fromMillis(Date.now() + 2 * 3600000);
      const end = Timestamp.fromMillis(Date.now() + 10 * 3600000);
      await db.batch()
        .set(db.collection('turnos').doc(titularId), {
          empresaId: `${prefix}_emp`,
          objectiveId: `${prefix}_obj`,
          objectiveName: 'Obj',
          positionName: 'P1',
          employeeId: 'VACANTE',
          employeeName: 'VACANTE',
          code: 'M',
          startTime: start,
          endTime: end,
          isUnassigned: true,
          isAbsent: true,
          status: 'ABSENT',
        })
        .set(db.collection('turnos').doc(francoId), {
          empresaId: `${prefix}_emp`,
          employeeId: empId,
          employeeName: 'Franco FT',
          code: 'F',
          isFranco: true,
          startTime: start,
          endTime: end,
        })
        .commit();
      const batch = db.batch();
      const covDocId = await applyCoverage(db, batch, {
        titularShiftId: titularId,
        candidateEmployeeId: empId,
        candidateEmployeeName: 'Franco FT',
        sourceShiftId: francoId,
        coverageType: 'FT',
        resolvedBy: 'OPERACIONES',
        empresaId: `${prefix}_emp`,
        startTime: start,
        endTime: end,
        code: 'FT',
      });
      await batch.commit();
      const cov = (await db.collection('turnos').doc(covDocId).get()).data();
      report(36, cov?.coverageType === 'FT' && cov?.origin === 'OPERATIONS_COVERAGE', `cov=${covDocId}`);
    }

    // Caso 37 — Demo ON: convocadoAbsentPass no marca AA en ops_cov (createdAt + 70)
    {
      const prefix = `${runId}_c37`;
      const demoEmp = `${prefix}_demo`;
      const covId = `${prefix}_cov`;
      const created = Timestamp.fromMillis(Date.now() - 70 * 60 * 1000);
      const start = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
      await db.batch()
        .set(db.collection('empresas').doc(demoEmp), { centroControlEnabled: true, modoDemoEnabled: true })
        .set(db.collection('turnos').doc(covId), {
          empresaId: demoEmp, objectiveId: `${prefix}_obj`, positionName: 'P1',
          employeeId: `${prefix}_e`, employeeName: 'Cov demo',
          code: 'RET', origin: 'OPERATIONS_COVERAGE', coverageType: 'RET',
          absenceShiftId: `${prefix}_tit`, startTime: start,
          endTime: Timestamp.fromMillis(Date.now() + 4 * 3600000),
          createdAt: created, status: 'PENDING', isPresent: false,
        })
        .commit();
      await runConvocadoAbsentPass(db, Timestamp.now(), ccWithDemo([demoEmp]));
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      report(37, cov?.isAbsent !== true, cov?.isAbsent !== true ? 'Demo: sin AA en ops_cov' : 'marcó AA indebido');
    }

    // Caso 38 — Real: ops_cov sin fichar → AA + titular descubierto + RRHH PENDIENTE
    {
      const prefix = `${runId}_c38`;
      const empresaId = `${prefix}_emp`;
      const titularId = `${prefix}_tit`;
      const covId = `${prefix}_cov`;
      const created = Timestamp.fromMillis(Date.now() - 70 * 60 * 1000);
      const start = Timestamp.fromMillis(Date.now() - 65 * 60 * 1000);
      const endSoon = Timestamp.fromMillis(Date.now() + 90 * 60 * 1000);
      await db.batch()
        .set(db.collection('empresas').doc(empresaId), { centroControlEnabled: true, modoDemoEnabled: false })
        .set(db.collection('turnos').doc(titularId), {
          empresaId, objectiveId: `${prefix}_obj`, positionName: 'P1', code: 'M',
          employeeId: `${prefix}_eT`, employeeName: 'Titular',
          startTime: start, endTime: endSoon,
          isAbsent: true, status: 'ABSENT',
          operacionallyCovered: true, coverageDocId: covId, coveredByEmployeeId: `${prefix}_eC`,
        })
        .set(db.collection('turnos').doc(covId), {
          empresaId, objectiveId: `${prefix}_obj`, positionName: 'P1',
          employeeId: `${prefix}_eC`, employeeName: 'Convocado',
          code: 'RET', origin: 'OPERATIONS_COVERAGE', coverageType: 'RET',
          absenceShiftId: titularId, startTime: start,
          endTime: endSoon,
          createdAt: created, status: 'PENDING', isPresent: false,
        })
        .commit();
      await db.collection('ausencias').add({
        shiftId: titularId, empresaId, coberturaEstado: 'GESTIONADA', status: 'Confirmada',
      });
      await runConvocadoAbsentPass(db, Timestamp.now(), ccAllReal());
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      const tit = (await db.collection('turnos').doc(titularId).get()).data();
      const aus = await db.collection('ausencias').where('shiftId', '==', titularId).limit(1).get();
      const ok =
        cov?.absenceDetectedBy === 'CONVOCADO_NO_LLEGO'
        && tit?.operacionallyCovered === false
        && aus.docs[0]?.data()?.coberturaEstado === 'PENDIENTE';
      report(38, ok, ok ? 'Real: AA convocado + titular PENDIENTE' : `cov=${cov?.absenceDetectedBy} tit=${tit?.operacionallyCovered}`);
    }

    // Caso 39 — revertir ausencia + cancelCoverage restaura REF convertido
    {
      const prefix = `${runId}_c39`;
      const s = await seedBase(prefix);
      const start = Timestamp.fromMillis(Date.now() - 25 * 60 * 1000);
      const end = Timestamp.fromMillis(Date.now() + 5 * 3600000);
      await db.collection('turnos').doc(s.titularId).update({ startTime: start, endTime: end });
      await db.collection('turnos').doc(s.refSourceId).update({
        startTime: start,
        endTime: end,
        status: 'ACTIVE',
        isDeleted: false,
      });
      const batch = db.batch();
      const covId = await applyCoverage(db, batch, {
        titularShiftId: s.titularId,
        titularShift: { id: s.titularId, ...s.titular, startTime: start, endTime: end },
        candidateEmployeeId: s.empRef,
        candidateEmployeeName: 'Guardia REF',
        sourceShiftId: s.refSourceId,
        coverageType: 'REF',
        resolvedBy: 'OPERACIONES',
        empresaId: s.empresaId,
        objectiveId: s.objectiveId,
      });
      await batch.commit();
      const beforeRevert = (await db.collection('turnos').doc(s.refSourceId).get()).data();
      const r = await revertirAusenciaShift(db, { shiftId: s.titularId, cancelCoverage: true });
      const src = (await db.collection('turnos').doc(s.refSourceId).get()).data();
      const cov = (await db.collection('turnos').doc(covId).get()).data();
      const ok =
        beforeRevert?.isDeleted === true
        && r.success
        && src?.isDeleted !== true
        && String(src?.status || '').toUpperCase() !== 'CANCELLED'
        && cov?.coverageSuperseded === true;
      report(39, ok, ok ? 'revertir restaura REF planificado' : `success=${r.success} srcDel=${src?.isDeleted}`);
    }

    // Caso 40 — REF convertido (isDeleted) excluido del pipeline de ausencias
    {
      const s = await seedBase(`${runId}_c40`);
      const batch = db.batch();
      await applyCoverage(db, batch, {
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
      const src = (await db.collection('turnos').doc(s.refSourceId).get()).data();
      const skip = skipAbsencePipelineForShift(src);
      if (!skip) await markShiftAbsent(db, s.refSourceId, { reason: 'AUTO_T30', by: 'E2E' });
      const after = (await db.collection('turnos').doc(s.refSourceId).get()).data();
      const ok = skip === true && after?.isAbsent !== true;
      report(40, ok, ok ? 'isDeleted: sin AA en origen convertido' : `skip=${skip} absent=${after?.isAbsent}`);
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
