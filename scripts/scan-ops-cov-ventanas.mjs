/**
 * Escaneo SOLO LECTURA de ops_cov EXT/ADV de pruebas_sa.
 * La ventana se ancla al hueco del titular (absenceShiftId / titularShiftId)
 * y al turno fuente vinculado (extendShiftId / advanceShiftId / coverageSourceShiftId).
 * Franco, licencia, fuente en otro día o doble cobertura no proponen horario.
 *
 *   node scripts/scan-ops-cov-ventanas.mjs
 *   node scripts/scan-ops-cov-ventanas.mjs --apply
 *
 * --apply escribe solo ventanas propuestas (emulador, o prod solo con --allow-prod).
 * No anula ni toca prod sin OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { assessOpsCovWindows, fmtWindow, gapShiftId, linkedSourceId, verdictLabel } from './opsCovVentana.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const EMPRESA = 'pruebas_sa';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProd = args.has('--allow-prod');

function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && typeof v.__ts === 'number') return v.__ts;
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
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
const cache = new Map();

async function loadShift(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const snap = await db.collection('turnos').doc(key).get();
  const value = snap.exists ? { id: snap.id, ...snap.data() } : null;
  cache.set(key, value);
  return value;
}

function asEdge(shift) {
  if (!shift) return null;
  return {
    startMs: tsMs(shift.startTime),
    endMs: tsMs(shift.endTime),
    realStartMs: tsMs(shift.realStartTime) || tsMs(shift.checkInTime) || 0,
    code: shift.code || shift.shiftCode || '',
    isFranco: shift.isFranco === true,
    employeeName: shift.employeeName || '',
    positionName: shift.positionName || '',
  };
}

const snap = await db.collection('turnos')
  .where('empresaId', '==', EMPRESA)
  .where('origin', '==', 'OPERATIONS_COVERAGE')
  .get();

const rows = [];
for (const doc of snap.docs) {
  const t = doc.data();
  const type = String(t.coverageType || '').toUpperCase();
  if (type !== 'EXTEND' && type !== 'ADVANCE') continue;
  if (t.coverageSuperseded === true || t.isDeleted === true) continue;
  const convId = String(t.assignedByConvocatoria || '').trim();
  let conv = null;
  if (convId) {
    const convSnap = await db.collection('convocatorias_cobertura').doc(convId).get();
    conv = convSnap.exists ? convSnap.data() : null;
  }
  const sourceId = linkedSourceId(t, conv);
  const sourceDoc = sourceId ? await loadShift(sourceId) : null;
  const gapId = gapShiftId(t);
  const gapDoc = gapId ? await loadShift(gapId) : null;
  rows.push({
    id: doc.id,
    type,
    name: t.employeeName || '',
    employeeId: String(t.employeeId || '').trim(),
    covStart: tsMs(t.startTime),
    covEnd: tsMs(t.endTime),
    sourceId,
    sourceMissing: !!sourceId && !sourceDoc,
    source: asEdge(sourceDoc),
    gap: asEdge(gapDoc),
  });
}

const assessed = assessOpsCovWindows(rows).filter((row) => row.action !== 'ok');
console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ops_cov EXT/ADV a revisar en ${EMPRESA}: ${assessed.length} de ${rows.length}`);
for (const row of assessed) {
  const actual = fmtWindow(row.covStart, row.covEnd);
  const motivo = row.reason ? `\t${row.reason}` : '';
  console.log(`${row.id}\t${row.type}\t${row.name}\t${actual} → ${verdictLabel(row)}${motivo}`);
}

if (apply) {
  const Timestamp = admin.firestore.Timestamp;
  let n = 0;
  for (const row of assessed) {
    if (row.action !== 'propose' || !row.proposedStart || !row.proposedEnd) continue;
    const batch = db.batch();
    batch.update(db.collection('turnos').doc(row.id), {
      startTime: Timestamp.fromMillis(row.proposedStart),
      endTime: Timestamp.fromMillis(row.proposedEnd),
    });
    if (row.sourceId && row.type === 'EXTEND') {
      batch.update(db.collection('turnos').doc(row.sourceId), {
        extensionEndTime: Timestamp.fromMillis(row.proposedEnd),
        adjustedEndTime: Timestamp.fromMillis(row.proposedEnd),
      });
    } else if (row.sourceId && row.type === 'ADVANCE') {
      batch.update(db.collection('turnos').doc(row.sourceId), {
        adjustedStartTime: Timestamp.fromMillis(row.proposedStart),
      });
    }
    await batch.commit();
    n += 1;
  }
  console.log(`Corregidos ${n} docs. ANULAR y REVISIÓN MANUAL no se escriben.`);
}
