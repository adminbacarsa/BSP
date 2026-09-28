/**
 * Re-tipifica ops_cov ADVANCE cuya fuente es RET o franco (FT) y anula
 * la pata no contigua de Ceballos/Ramos. Dry-run por defecto.
 *
 *   node scripts/fix-ops-cov-retipo.mjs
 *   node scripts/fix-ops-cov-retipo.mjs --apply --allow-prod
 *
 * --apply escribe (emulador, o prod solo con --allow-prod). No correrlo sin OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { arYmd } from '../apps/functions/src/common/arClock.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const covLib = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const EMPRESA = 'pruebas_sa';
const RAMOS_OPS = 'ops_cov_rMdDJxgdwpibFWC1ESKa_F7bYgkiu9m7403dHnGOI';
const ANULAR_REASON = 'NO_CONTIGUA';
const FRANCO = new Set(['F', 'FF', 'FP']);
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProd = args.has('--allow-prod');

function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms - 3 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  const ymd = arYmd(ms);
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function codeOf(shift) {
  return String(shift?.code || shift?.shiftCode || '').trim().toUpperCase();
}

function targetType(source) {
  if (!source) return null;
  if (codeOf(source) === 'RET') return 'RET';
  if (source.isFranco === true || FRANCO.has(codeOf(source))) return 'FT';
  return null;
}

function plannedWindow(cov, gap) {
  const gapStart = tsMs(gap?.startTime);
  const gapEnd = tsMs(gap?.endTime);
  const realStart = tsMs(cov.realStartTime);
  const realEnd = tsMs(cov.realEndTime);
  if (realStart && realEnd && realEnd > realStart && gapStart && gapEnd) {
    const start = Math.max(realStart, gapStart);
    const end = Math.min(realEnd, gapEnd);
    if (end > start) return { start, end, via: 'presencia real' };
  }
  const via = realStart ? 'hueco (presencia abierta, sin realEnd)' : 'hueco';
  return { start: gapStart, end: gapEnd, via };
}

if (!admin.apps.length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: 'comtroldata',
    });
  }
}

if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
  console.error('Refuso --apply contra prod. Usá el emulador o pasá --allow-prod (solo con OK de Mauro).');
  process.exit(1);
}

const db = admin.firestore();

async function load(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const snap = await db.collection('turnos').doc(key).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

const snap = await db.collection('turnos')
  .where('empresaId', '==', EMPRESA)
  .where('origin', '==', 'OPERATIONS_COVERAGE')
  .get();

const retipos = [];
for (const doc of snap.docs) {
  const t = doc.data();
  if (t.coverageSuperseded === true || t.isDeleted === true) continue;
  const type = String(t.coverageType || '').toUpperCase();
  if (type !== 'ADVANCE' && type !== 'EXTEND') continue;
  const source = await load(t.sourceShiftId);
  const next = targetType(source);
  if (!next || next === type) continue;
  const gap = await load(t.absenceShiftId || t.coveredShiftId);
  retipos.push({ id: doc.id, cov: t, source, gap, next });
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} retipo RET/FT en ${EMPRESA}: ${retipos.length}`);
for (const row of retipos) {
  const win = plannedWindow(row.cov, row.gap);
  const siblings = snap.docs.filter((d) => {
    if (d.id === row.id) return false;
    const o = d.data();
    return o.absenceShiftId === row.cov.absenceShiftId
      && o.coverageSuperseded !== true
      && String(o.origin) === 'OPERATIONS_COVERAGE';
  });
  console.log(`\n${row.id}`);
  console.log(`  guardia ${row.cov.employeeName}  ${row.cov.coverageType} → ${row.next}`);
  console.log(`  ventana ${fmt(tsMs(row.cov.startTime))}–${fmt(tsMs(row.cov.endTime))} → ${fmt(win.start)}–${fmt(win.end)} (${win.via})`);
  console.log(`  ops_cov code ${row.cov.code} → ${row.next === 'FT' ? 'FT' : row.gap?.code || row.cov.code}  coverageHoursOnSource ${row.cov.coverageHoursOnSource === true} → false  presencia ${row.cov.isPresent === true ? 'se conserva' : 'sin fichada'}`);
  if (row.next === 'FT') {
    console.log(`  fuente ${row.source.id} ${codeOf(row.source)} franco → code FT, isFrancoTrabajado, sin isEarlyStart`);
  } else {
    console.log(`  fuente ${row.source.id} RET → coverageUsed + isRetentionActivated, sin isEarlyStart (horario del RET no se mueve)`);
  }
  console.log(`  titular ${row.gap?.id} ${row.gap?.coverageStatus || '—'} / ${row.gap?.coverageType || '—'} → COVERED / ${row.next}  operacionallyCovered true`);
  if (siblings.length) {
    console.log(`  hermanos que se conservan: ${siblings.map((d) => `${d.id} ${d.data().coverageType}`).join(', ')}`);
  }
  if (!apply) continue;
  const resolved = ['OPERACIONES', 'AUTO', 'MODO_DEMO'].includes(row.cov.resolvedBy) ? row.cov.resolvedBy : 'OPERACIONES';
  const batch = db.batch();
  await covLib.applyCoverage(db, batch, {
    titularShiftId: row.gap.id,
    titularShift: row.gap,
    candidateEmployeeId: row.cov.employeeId,
    candidateEmployeeName: row.cov.employeeName,
    sourceShiftId: row.source.id,
    coverageType: row.next,
    resolvedBy: resolved,
    empresaId: EMPRESA,
    startTime: admin.firestore.Timestamp.fromMillis(win.start),
    endTime: admin.firestore.Timestamp.fromMillis(win.end),
    code: row.next === 'FT' ? 'FT' : row.gap.code,
    positionName: row.cov.positionName || row.gap.positionName,
    objectiveId: row.cov.objectiveId || row.gap.objectiveId,
    objectiveName: row.cov.objectiveName || row.gap.objectiveName,
    clientId: row.cov.clientId || row.gap.clientId,
    clientName: row.cov.clientName || row.gap.clientName,
    titularCloseMode: 'FULL',
    preserveSiblingOpsCov: true,
    convocatoriaId: row.cov.assignedByConvocatoria || undefined,
  });
  await batch.commit();
  console.log('  escrito');
}

const ramos = await load(RAMOS_OPS);
console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} anular ${RAMOS_OPS}`);
if (!ramos || ramos.coverageSuperseded === true) {
  console.log('  ya no está activa');
} else {
  const gap = await load(ramos.absenceShiftId);
  const source = await load(ramos.sourceShiftId);
  const other = snap.docs.find((d) => {
    if (d.id === RAMOS_OPS) return false;
    const o = d.data();
    return o.sourceShiftId === ramos.sourceShiftId && o.coverageSuperseded !== true && o.origin === 'OPERATIONS_COVERAGE';
  });
  console.log(`  guardia ${ramos.employeeName}  ${ramos.coverageType} ${fmt(tsMs(ramos.startTime))}–${fmt(tsMs(ramos.endTime))}`);
  console.log(`  ops_cov coverageSuperseded false → true  motivo ${ANULAR_REASON}  (no se borra)`);
  console.log(`  titular ${gap?.id} ${gap?.employeeName} ${gap?.coverageStatus} / coveredBy ${gap?.coveredByEmployeeName} / operacionallyCovered ${gap?.operacionallyCovered} → sin cobertura (sigue ausente)`);
  if (other) {
    console.log(`  fuente ${source?.id} coverageDocId ${source?.coverageDocId} → ${other.id}  (se conserva adjustedStart ${fmt(tsMs(source?.adjustedStartTime))} de la otra pata)`);
  } else {
    console.log(`  fuente ${source?.id} se restaura (no hay otra cobertura activa)`);
  }
  if (apply) {
    const batch = db.batch();
    await covLib.anularOpsCoverageLeg(db, batch, { opsCovId: RAMOS_OPS, reason: ANULAR_REASON });
    await batch.commit();
    console.log('  escrito');
  }
}
