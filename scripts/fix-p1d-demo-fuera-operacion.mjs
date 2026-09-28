/**
 * P1d — el Demo inventó presencia en objetivos que ese día no estaban en operación.
 *
 * Barrido: turnos de pruebas_sa con inicio desde el 01/08/2026 AR, en un objetivo
 * que ESE día no tiene SLA activo o cerrado vigente (cliente activo) con cronograma
 * publicado, con marca de Demo (modoDemoAt o autoPresencia) y sin
 * fichada real de guardia (checkInMethod / checkInSource / presenciaSource de portal
 * u operador). Revierte la presencia simulada y el cierre, y guarda el estado previo
 * en p1dRevertedFrom. No borra el turno. No toca bacarsa ni licencias/francos.
 *
 * dryRun por defecto. Escribir solo con --apply --allow-prod (OK de Mauro).
 *
 *   node scripts/fix-p1d-demo-fuera-operacion.mjs
 *   node scripts/fix-p1d-demo-fuera-operacion.mjs --apply --allow-prod
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const {
  ObjectiveOperationCache,
  isLicenseShift,
  isFrancoShiftCode,
  shiftGridCode,
} = requireFn('./lib/common/simulableShift.js');

const PROD_PROJECT = 'comtroldata';
const EMPRESA_ID = 'pruebas_sa';
const SCAN_FROM_ISO = '2026-08-01T00:00:00-03:00';
const AR_OFFSET_MS = 3 * 3600000;
const BATCH_LIMIT = 400;
const CODE_HOURS = { M: 8, T: 8, N: 8, ESC: 8, REF: 8, FT: 8, D12: 12, N12: 12 };
const REAL_METHODS = new Set([
  'PORTAL_GPS', 'PORTAL', 'OPERATIONS', 'VIGI', 'MANUAL_RADIO', 'MANUAL_PHONE', 'GPS',
]);

const apply = process.argv.includes('--apply');
const allowProd = process.argv.includes('--allow-prod');

const CLEAR_FIELDS = [
  'realStartTime',
  'realEndTime',
  'presentAt',
  'checkInTime',
  'autoPresencia',
  'modoDemoAt',
  'llegadaTarde',
  'completionReason',
  'autoCloseReason',
  'autoCompletedAt',
  'autoCompletedBy',
  'completedAt',
  'completedBy',
  'autoCierre',
  'retentionEndedAt',
  'retentionMinutes',
];

function tsMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
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

function hasValue(v) {
  return v !== undefined && v !== null && v !== '';
}

function hasDemoMark(data) {
  return hasValue(data.modoDemoAt) || data.autoPresencia === true;
}

function hasRealGuardCheckIn(data) {
  const method = String(data.checkInMethod || data.checkInSource || data.presenciaSource || '')
    .trim()
    .toUpperCase();
  if (!method || method === 'DEMO' || method === 'MODO_DEMO') return false;
  if (REAL_METHODS.has(method)) return true;
  return method.includes('PORTAL') || method.includes('GPS');
}

function hasSimulatedPresence(data) {
  if (!hasDemoMark(data) || hasRealGuardCheckIn(data)) return false;
  const status = String(data.status || '').toUpperCase();
  return data.isPresent === true
    || data.isCompleted === true
    || hasValue(data.realStartTime)
    || hasValue(data.realEndTime)
    || status === 'PRESENT'
    || status === 'COMPLETED';
}

function shiftHours(data) {
  const a = tsMs(data.realStartTime);
  const b = tsMs(data.realEndTime);
  if (a != null && b != null) {
    let h = (b - a) / 3600000;
    if (h <= 0) h += 24;
    if (h > 13) h = 12.983;
    return Math.round(h * 10) / 10;
  }
  const code = shiftGridCode(data);
  if (CODE_HOURS[code]) return CODE_HOURS[code];
  const sa = tsMs(data.startTime);
  const sb = tsMs(data.endTime);
  if (sa == null || sb == null) return 0;
  let h = (sb - sa) / 3600000;
  if (h <= 0) h += 24;
  if (h > 13) h = 12.983;
  return Math.round(h * 10) / 10;
}

function buildPatch(data) {
  const prev = {};
  const patch = {};
  const status = String(data.status || '').toUpperCase();
  if (data.isPresent !== false) {
    prev.isPresent = data.isPresent === undefined ? null : data.isPresent;
    patch.isPresent = false;
  }
  if (status === 'PRESENT' || status === 'COMPLETED') {
    prev.status = data.status;
    patch.status = 'PENDING';
  }
  if (data.isCompleted === true) {
    prev.isCompleted = true;
    patch.isCompleted = false;
  }
  for (const field of CLEAR_FIELDS) {
    if (data[field] !== undefined) {
      prev[field] = data[field];
      patch[field] = admin.firestore.FieldValue.delete();
    }
  }
  if (Object.keys(prev).length === 0) return null;
  patch.p1dRevertedFrom = prev;
  patch.p1dFixAt = admin.firestore.FieldValue.serverTimestamp();
  return patch;
}

function afterLabel(v) {
  if (v === false || v === true || typeof v === 'string' || typeof v === 'number') return fmt(v);
  if (v && typeof v === 'object') return '(borrado)';
  return fmt(v);
}

function printExample(n, id, data, patch) {
  const code = shiftGridCode(data) || '—';
  console.log(
    `\nEjemplo ${n}  ${id}  ${String(data.objectiveName || data.objectiveId || '?')}  ${code}  ${fmt(data.startTime)}`,
  );
  const show = ['isPresent', 'status', 'isCompleted', 'realStartTime', 'realEndTime', 'autoPresencia', 'modoDemoAt'];
  for (const k of show) {
    if (patch[k] === undefined) continue;
    console.log(`  ${k.padEnd(16)} ${fmt(data[k])}  →  ${afterLabel(patch[k])}`);
  }
}

async function run() {
  if (apply && !process.env.FIRESTORE_EMULATOR_HOST && !allowProd) {
    console.error('Para escribir en prod hace falta --apply --allow-prod juntos. No se escribió nada.');
    process.exit(1);
  }
  delete process.env.FIRESTORE_EMULATOR_HOST;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  const db = admin.firestore();
  const from = admin.firestore.Timestamp.fromMillis(Date.parse(SCAN_FROM_ISO));
  const cache = new ObjectiveOperationCache();

  console.log(`Proyecto: ${PROD_PROJECT} · empresa: ${EMPRESA_ID} · modo: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log('Barrido desde 01/08/2026 AR · objetivos fuera de operación ese día · sin fichada real');

  const snap = await db.collection('turnos')
    .where('empresaId', '==', EMPRESA_ID)
    .where('startTime', '>=', from)
    .get();

  const byObj = new Map();
  const planned = [];
  let skippedInOp = 0;
  let skippedLicense = 0;
  let skippedReal = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (String(data.empresaId || '') !== EMPRESA_ID) continue;
    if (!hasDemoMark(data)) continue;
    if (hasRealGuardCheckIn(data)) {
      skippedReal++;
      continue;
    }
    if (!hasSimulatedPresence(data)) continue;
    if (isLicenseShift(data) || data.isFranco === true || isFrancoShiftCode(shiftGridCode(data))) {
      skippedLicense++;
      continue;
    }
    if (hasValue(data.p1dFixAt) && data.isPresent !== true && !hasValue(data.realStartTime)) continue;
    const inOp = await cache.isShiftInOperation(db, data);
    if (inOp) {
      skippedInOp++;
      continue;
    }
    const patch = buildPatch(data);
    if (!patch) continue;
    const hours = shiftHours(data);
    const oid = String(data.objectiveId || '?');
    const name = String(data.objectiveName || oid);
    const row = byObj.get(oid) || { name, turnos: 0, hours: 0 };
    row.turnos += 1;
    row.hours = Math.round((row.hours + hours) * 10) / 10;
    byObj.set(oid, row);
    planned.push({ id: doc.id, ref: doc.ref, data, patch, hours });
  }

  const ranked = [...byObj.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'es'));
  const totalHours = Math.round(ranked.reduce((s, r) => s + r.hours, 0) * 10) / 10;
  console.log(`\nObjetivos: ${ranked.length} · turnos: ${planned.length} · horas: ${totalHours}`);
  for (const r of ranked) {
    console.log(`  ${String(r.turnos).padStart(4)} turnos  ${String(r.hours).padStart(8)} h  ${r.name}`);
  }
  console.log(`Omitidos en operación: ${skippedInOp} · licencia/franco: ${skippedLicense} · fichada real: ${skippedReal}`);

  const examples = [];
  for (const name of ranked.slice(0, 3).map((r) => r.name)) {
    const row = planned.find((p) => String(p.data.objectiveName || p.data.objectiveId) === name);
    if (row) examples.push(row);
  }
  examples.forEach((row, i) => printExample(i + 1, row.id, row.data, row.patch));

  if (!apply) {
    console.log('\nDRY RUN: no se escribió nada.');
    return;
  }

  for (let i = 0; i < planned.length; i += BATCH_LIMIT) {
    const slice = planned.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const { ref, patch } of slice) batch.update(ref, patch);
    await batch.commit();
  }
  console.log(`Aplicado sobre ${planned.length} turno(s).`);
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
