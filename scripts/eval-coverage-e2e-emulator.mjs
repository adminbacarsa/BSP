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

const autoCompleteCtx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || ''),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

async function run() {
  if (!(await pingEmulator())) {
    for (let i = 1; i <= 17; i++) {
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
