/**
 * Materializa turnos OPERATIONS_COVERAGE faltantes para titulares ya marcados cubiertos
 * (coveredBy* / operacionallyCovered) sin doc ops_cov_* activo en el objetivo del hueco.
 *
 * Uso:
 *   node scripts/backfill-ops-coverage-from-titular.js
 *   node scripts/backfill-ops-coverage-from-titular.js --apply
 *   node scripts/backfill-ops-coverage-from-titular.js --apply --empresaId=XXX
 *   node scripts/backfill-ops-coverage-from-titular.js --apply --max=200
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'comtroldata';
const BATCH_SIZE = 450;

const empresaArg = process.argv.find((a) => a.startsWith('--empresaId='));
const FILTER_EMPRESA = empresaArg ? empresaArg.split('=')[1].trim() : '';
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const MAX_DOCS = maxArg ? parseInt(maxArg.split('=')[1], 10) : 5000;

if (!getApps().length) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();

function clean(v) {
  return String(v ?? '').trim();
}

function isTitularCoverageAssigned(data) {
  if (!data) return false;
  if (data.operacionallyCovered === true) return true;
  if (String(data.coverageStatus || '').toUpperCase() === 'COVERED') return true;
  if (clean(data.coveredByEmployeeId)) return true;
  if (clean(data.coveredByEmployeeName || data.coveredBy)) return true;
  return false;
}

function isActiveOpsCoverageDoc(data) {
  if (!data) return false;
  if (String(data.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  if (data.coverageSuperseded === true) return false;
  if (String(data.status || '').toUpperCase() === 'CANCELLED') return false;
  if (data.isDeleted === true) return false;
  return true;
}

function isAbsentTitular(data) {
  if (!data) return false;
  if (data.isAbsent === true) return true;
  if (String(data.status || '').toUpperCase() === 'ABSENT') return true;
  return false;
}

function opsCovDocId(absenceShiftId, candidateEmployeeId) {
  return `ops_cov_${absenceShiftId}_${candidateEmployeeId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

async function loadActiveOpsByAbsenceShiftId(absenceShiftId) {
  const [a, b] = await Promise.all([
    db.collection('turnos').where('absenceShiftId', '==', absenceShiftId).limit(20).get(),
    db.collection('turnos').where('coveredShiftId', '==', absenceShiftId).limit(20).get(),
  ]);
  const out = [];
  const seen = new Set();
  for (const d of [...a.docs, ...b.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const data = d.data();
    if (isActiveOpsCoverageDoc(data)) out.push({ id: d.id, data });
  }
  return out;
}

function hasOpsOnObjective(activeOps, objectiveId, coverEmpId) {
  return activeOps.some(
    (row) =>
      clean(row.data.objectiveId) === objectiveId
      && clean(row.data.employeeId) === coverEmpId,
  );
}

async function collectTargets() {
  const targets = [];
  let scanned = 0;

  let q = db.collection('turnos').where('operacionallyCovered', '==', true);
  if (FILTER_EMPRESA) {
    q = q.where('empresaId', '==', FILTER_EMPRESA);
  }

  const snap = await q.limit(MAX_DOCS).get();
  for (const d of snap.docs) {
    scanned += 1;
    const data = d.data();
    if (!isAbsentTitular(data)) continue;
    if (!isTitularCoverageAssigned(data)) continue;

    const coverId = clean(data.coveredByEmployeeId);
    if (!coverId) continue;

    const objectiveId = clean(data.objectiveId);
    const empresaId = clean(data.empresaId);
    if (FILTER_EMPRESA && empresaId !== FILTER_EMPRESA) continue;

    const activeOps = await loadActiveOpsByAbsenceShiftId(d.id);
    if (hasOpsOnObjective(activeOps, objectiveId, coverId)) continue;

    targets.push({
      titularId: d.id,
      titular: data,
      coverId,
      coverName: clean(data.coveredByEmployeeName || data.coveredBy) || coverId,
      objectiveId,
      empresaId,
      covDocId: opsCovDocId(d.id, coverId),
    });
  }

  return { targets, scanned };
}

async function applyTargets(targets) {
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;

  const flush = async () => {
    if (inBatch === 0) return;
    await batch.commit();
    written += inBatch;
    batch = db.batch();
    inBatch = 0;
  };

  for (const t of targets) {
    const tit = t.titular;
    const payload = {
      employeeId: t.coverId,
      employeeName: t.coverName,
      clientId: tit.clientId || null,
      clientName: tit.clientName || null,
      objectiveId: tit.objectiveId || null,
      objectiveName: tit.objectiveName || '',
      positionName: tit.positionName || null,
      coversPositionName: tit.positionName || null,
      code: tit.code || 'T',
      type: tit.code || 'T',
      startTime: tit.startTime || null,
      endTime: tit.endTime || null,
      status: 'PENDING',
      origin: 'OPERATIONS_COVERAGE',
      resolvedBy: 'OPERACIONES',
      coverageType: tit.coverageType || 'COBERTURA',
      absenceShiftId: t.titularId,
      coveredShiftId: t.titularId,
      coversEmployeeId: tit.employeeId || null,
      coversEmployeeName: tit.employeeName || null,
      isAwaitingCoverageCheckIn: true,
      backfillOpsCoverageAt: FieldValue.serverTimestamp(),
      backfillOpsCoverage: true,
    };
    if (t.empresaId) payload.empresaId = t.empresaId;

    batch.set(db.collection('turnos').doc(t.covDocId), payload, { merge: true });
    inBatch += 1;

    const ausSnap = await db.collection('ausencias').where('shiftId', '==', t.titularId).limit(10).get();
    for (const d of ausSnap.docs) {
      batch.update(d.ref, {
        coberturaEstado: 'GESTIONADA',
        coberturaResolvedAt: FieldValue.serverTimestamp(),
        coberturaResolvedBy: 'BACKFILL_OPS_COV',
        coveredByEmployeeId: t.coverId,
        coveredByEmployeeName: t.coverName,
      });
      inBatch += 1;
    }

    if (inBatch >= BATCH_SIZE) await flush();
  }

  await flush();
  return written;
}

(async () => {
  console.log(`[backfill-ops-coverage] project=${PROJECT_ID} apply=${APPLY} empresa=${FILTER_EMPRESA || '*'} max=${MAX_DOCS}`);
  const { targets, scanned } = await collectTargets();
  console.log(`Escaneados (operacionallyCovered): ${scanned}`);
  console.log(`Titulares sin doc OPERATIONS_COVERAGE en objetivo: ${targets.length}`);

  for (const t of targets.slice(0, 30)) {
    console.log(
      `  - titular=${t.titularId} obj=${t.objectiveId} cover=${t.coverName} (${t.coverId}) → ${t.covDocId}`,
    );
  }
  if (targets.length > 30) console.log(`  ... +${targets.length - 30} más`);

  if (!APPLY) {
    console.log('\nDry-run. Re-ejecutá con --apply para escribir.');
    process.exit(0);
  }

  if (!targets.length) {
    console.log('Nada que aplicar.');
    process.exit(0);
  }

  const n = await applyTargets(targets);
  console.log(`Listo. Operaciones de batch (~docs): ${n}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
