/**
 * Escaneo SOLO LECTURA de ops_cov EXT/ADV de pruebas_sa cuya ventana no es contigua
 * al turno propio (EXT empieza cuando termina el turno; ADV termina cuando empieza).
 *
 *   node scripts/scan-ops-cov-ventanas.mjs
 *   node scripts/scan-ops-cov-ventanas.mjs --apply
 *
 * --apply escribe (emulador, o prod solo con --allow-prod). No correrlo sin OK de Mauro.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const TOL_MS = 60 * 1000;
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

function fmt(ms) {
  if (!ms) return '—';
  const d = new Date(ms - 3 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
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

const snap = await db.collection('turnos')
  .where('empresaId', '==', EMPRESA)
  .where('origin', '==', 'OPERATIONS_COVERAGE')
  .get();

const bad = [];
for (const doc of snap.docs) {
  const t = doc.data();
  const type = String(t.coverageType || '').toUpperCase();
  if (type !== 'EXTEND' && type !== 'ADVANCE') continue;
  if (t.coverageSuperseded === true || t.isDeleted === true) continue;
  const sourceId = String(t.sourceShiftId || '').trim();
  if (!sourceId) {
    bad.push({ id: doc.id, type, why: 'sin sourceShiftId', actual: '', proposed: '' });
    continue;
  }
  const srcSnap = await db.collection('turnos').doc(sourceId).get();
  if (!srcSnap.exists) {
    bad.push({ id: doc.id, type, why: 'turno propio inexistente', actual: '', proposed: '' });
    continue;
  }
  const src = srcSnap.data();
  const srcStart = tsMs(src.startTime);
  const srcEnd = tsMs(src.endTime);
  const covStart = tsMs(t.startTime);
  const covEnd = tsMs(t.endTime);
  const dur = covEnd - covStart;
  let aligned = false;
  let proposedStart = covStart;
  let proposedEnd = covEnd;
  if (type === 'EXTEND') {
    aligned = Math.abs(covStart - srcEnd) <= TOL_MS;
    proposedStart = srcEnd;
    proposedEnd = srcEnd + dur;
  } else {
    aligned = Math.abs(covEnd - srcStart) <= TOL_MS;
    proposedEnd = srcStart;
    proposedStart = srcStart - dur;
  }
  if (aligned) continue;
  bad.push({
    id: doc.id,
    type,
    name: t.employeeName || '',
    sourceId,
    actual: `${fmt(covStart)}–${fmt(covEnd)}`,
    proposed: `${fmt(proposedStart)}–${fmt(proposedEnd)}`,
    proposedStart,
    proposedEnd,
    why: type === 'EXTEND' ? 'EXT no empieza en el fin del turno' : 'ADV no termina en el inicio del turno',
  });
}

console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ops_cov EXT/ADV desalineados en ${EMPRESA}: ${bad.length} de ${snap.size} ops_cov`);
for (const row of bad) {
  console.log(`${row.id}\t${row.type}\t${row.name || ''}\t${row.actual} → ${row.proposed}\t${row.why}`);
}

if (apply && bad.length) {
  const Timestamp = admin.firestore.Timestamp;
  for (const row of bad) {
    if (!row.proposedStart || !row.proposedEnd) continue;
    const batch = db.batch();
    batch.update(db.collection('turnos').doc(row.id), {
      startTime: Timestamp.fromMillis(row.proposedStart),
      endTime: Timestamp.fromMillis(row.proposedEnd),
    });
    if (row.type === 'EXTEND') {
      batch.update(db.collection('turnos').doc(row.sourceId), {
        extensionEndTime: Timestamp.fromMillis(row.proposedEnd),
        adjustedEndTime: Timestamp.fromMillis(row.proposedEnd),
      });
    } else if (row.type === 'ADVANCE') {
      batch.update(db.collection('turnos').doc(row.sourceId), {
        adjustedStartTime: Timestamp.fromMillis(row.proposedStart),
      });
    }
    await batch.commit();
  }
  console.log(`Corregidos ${bad.filter((r) => r.proposedStart).length} docs.`);
}
