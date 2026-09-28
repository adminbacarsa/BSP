/**
 * P1b — corrección de datos por la simulación que pisó licencias.
 *
 * 1. Cejas Mario (H. Oncológico, código V, 25–28/09): 4 turnos marcados PRESENT por la
 *    simulación vuelven a no-presente, sin realStartTime/realEndTime ni cierre por tope.
 * 2. Bustamante (turno T del 27/09): se conserva el turno con el horario real
 *    11:00 → 23:00 AR y `requiereRevision`.
 *
 * dryRun por defecto: lee prod con ADC y muestra el antes/después de cada campo sin escribir.
 * `--apply` escribe. NO correr con --apply sin OK de Mauro.
 *
 *   gcloud auth application-default login   # si hace falta
 *   node scripts/fix-p1b-demo-licencias.mjs
 *   node scripts/fix-p1b-demo-licencias.mjs --apply     # solo con OK de Mauro
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';
const AR_OFFSET_MS = 3 * 3600000;

const CEJAS_SHIFT_IDS = [
  'K7gpSv2yZqNaF4kAbNgo',
  '1jZiqRna06TO0917zs90',
  'jsrIlkjT3yyqRbnkLiSK',
  'ocEeKfwW46k1vaz6ecBe',
];

const BUSTAMANTE_SHIFT_ID = '81oeHt3N5H2byBVBDv0G';

/** Campos de presencia/cierre que la simulación dejó escritos sobre una licencia. */
const PRESENCE_FIELDS = [
  'isPresent',
  'status',
  'presentAt',
  'realStartTime',
  'realEndTime',
  'checkInTime',
  'checkOutTime',
  'isCompleted',
  'completedAt',
  'completedBy',
  'completionReason',
  'autoCloseReason',
  'autoCompletedAt',
  'autoPresencia',
  'autoCierre',
  'modoDemoAt',
  'llegadaTarde',
  'isLate',
  'isRetention',
  'retentionMinutes',
  'retentionEndedAt',
  'retentionReason',
  'adjustedStartTime',
  'requiereRevision',
];

const apply = process.argv.includes('--apply');

function tsMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
}

function fmt(v) {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  const ms = tsMs(v);
  if (ms != null) {
    const d = new Date(ms - AR_OFFSET_MS);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} AR`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function arTimestamp(ymd, hm) {
  return admin.firestore.Timestamp.fromMillis(Date.parse(`${ymd}T${hm}:00-03:00`));
}

const DELETE = Symbol('delete');

function printDiff(label, data, patch) {
  console.log(`\n── ${label}`);
  console.log(
    `   ${String(data.employeeName || data.employeeId || '?')} · ${String(data.objectiveName || data.objectiveId || '?')}`
    + ` · ${String(data.positionName || '')} · código ${String(data.code || '—')}`
    + ` · ${fmt(data.startTime)} → ${fmt(data.endTime)}`,
  );
  const keys = Object.keys(patch);
  if (!keys.length) {
    console.log('   (sin cambios: ya está correcto)');
    return 0;
  }
  let changed = 0;
  for (const k of keys) {
    const before = data[k];
    const after = patch[k];
    const beforeTxt = fmt(before);
    const afterTxt = after === DELETE ? '(borrado)' : fmt(after);
    if (beforeTxt === afterTxt) continue;
    changed++;
    console.log(`   ${k.padEnd(20)} ${beforeTxt.padEnd(22)} → ${afterTxt}`);
  }
  if (!changed) console.log('   (sin cambios: ya está correcto)');
  return changed;
}

function toFirestorePatch(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v === DELETE ? admin.firestore.FieldValue.delete() : v;
  }
  return out;
}

/** Licencia que la simulación marcó presente: vuelve a no-presente y sin horas reales. */
function buildLicensePatch(data) {
  const patch = {};
  for (const field of PRESENCE_FIELDS) {
    if (data[field] === undefined) continue;
    patch[field] = DELETE;
  }
  patch.isPresent = false;
  patch.isCompleted = false;
  patch.status = 'PENDING';
  patch.p1bDemoLicenciaFixAt = admin.firestore.Timestamp.now();
  return patch;
}

/** Bustamante: el turno T del 27/09 queda con el horario real 11:00 → 23:00 AR. */
function buildBustamantePatch() {
  const start = arTimestamp('2026-09-27', '11:00');
  const end = arTimestamp('2026-09-27', '23:00');
  return {
    adjustedStartTime: start,
    presentAt: start,
    realStartTime: start,
    realEndTime: end,
    requiereRevision: true,
    p1bDemoLicenciaFixAt: admin.firestore.Timestamp.now(),
  };
}

async function run() {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  const db = admin.firestore();

  console.log(`Proyecto: ${PROD_PROJECT} · modo: ${apply ? 'APPLY (escribe)' : 'DRY RUN (solo lectura)'}`);

  const planned = [];

  for (const id of CEJAS_SHIFT_IDS) {
    const snap = await db.collection('turnos').doc(id).get();
    if (!snap.exists) {
      console.log(`\n── Cejas ${id}\n   turno inexistente`);
      continue;
    }
    const data = snap.data();
    const code = String(data.code || '').toUpperCase();
    if (code !== 'V') {
      console.log(`\n── Cejas ${id}\n   código ${code || '—'} ≠ V: no se toca (revisar a mano)`);
      continue;
    }
    const patch = buildLicensePatch(data);
    const changed = printDiff(`Cejas ${id} (licencia V → no presente)`, data, patch);
    if (changed) planned.push({ ref: snap.ref, patch });
  }

  const bSnap = await db.collection('turnos').doc(BUSTAMANTE_SHIFT_ID).get();
  if (!bSnap.exists) {
    console.log(`\n── Bustamante ${BUSTAMANTE_SHIFT_ID}\n   turno inexistente`);
  } else {
    const data = bSnap.data();
    const patch = buildBustamantePatch();
    const changed = printDiff(`Bustamante ${BUSTAMANTE_SHIFT_ID} (turno T 27/09 → 11:00–23:00 AR)`, data, patch);
    if (changed) planned.push({ ref: bSnap.ref, patch });
  }

  console.log(`\nTurnos con cambios: ${planned.length}`);

  if (!apply) {
    console.log('DRY RUN: no se escribió nada. Para aplicar: node scripts/fix-p1b-demo-licencias.mjs --apply (solo con OK de Mauro).');
    return;
  }

  const batch = db.batch();
  for (const { ref, patch } of planned) batch.update(ref, toFirestorePatch(patch));
  await batch.commit();
  console.log(`✓ Aplicado sobre ${planned.length} turno(s).`);
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
