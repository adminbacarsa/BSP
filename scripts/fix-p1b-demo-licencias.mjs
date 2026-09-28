/**
 * P1b — corrección de datos: la simulación pisó licencias de RRHH.
 *
 * Barrido (no lista fija): turnos `type: NOVEDAD` de pruebas_sa con inicio desde el
 * 01/08/2026 cuyo código es licencia (V, L, E, A, AA, PG, SUS, ART, más los códigos
 * ACTIVE de `tipos_novedad` de la empresa, salvo LT) y que tienen marca de Demo
 * (`modoDemoAt` o `autoPresencia`) o presencia/fichada sin `checkInTime` real.
 *
 * Cada una vuelve al estado de una licencia del mismo código que el Demo no tocó
 * (en V, verificado: `Approved`). Si no hay referencia, `Approved`. Se borran
 * presencia, fichada inventada, cierre y marcas de Demo. No se escribe `isPresent`.
 *
 * Un turno de trabajo que el Demo marcó AA (ausencia simulada, retiro) no es
 * novedad RRHH: se lista como omitido y no se toca.
 *
 * Aparte, Bustamante (turno T 27/09) queda 11:00 → 23:00 AR con `requiereRevision`.
 *
 * dryRun por defecto. `--apply` escribe. NO correr con --apply sin OK de Mauro.
 *
 *   node scripts/fix-p1b-demo-licencias.mjs
 *   node scripts/fix-p1b-demo-licencias.mjs --apply
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';
const EMPRESA_ID = 'pruebas_sa';
const SCAN_FROM_ISO = '2026-08-01T00:00:00-03:00';
const AR_OFFSET_MS = 3 * 3600000;
const BATCH_LIMIT = 400;

const BUSTAMANTE_SHIFT_ID = '81oeHt3N5H2byBVBDv0G';

/** Códigos de licencia de la grilla. LT (llegada tarde) no es una licencia. */
const BASE_LICENSE_CODES = ['V', 'L', 'E', 'A', 'AA', 'PG', 'SUS', 'ART', 'SGS'];
const NOT_A_LICENSE = new Set(['LT']);

/**
 * Lo que una licencia intacta no tiene. `llegadaTarde` lo escribe el Demo junto
 * con la presencia ficticia. `completedAt`/`completedBy` los escribe el cierre
 * por tope (además de `autoCompletedAt`/`autoCompletedBy`).
 */
const CLEAR_FIELDS = [
  'isPresent',
  'realStartTime',
  'realEndTime',
  'presentAt',
  'checkInTime',
  'autoPresencia',
  'modoDemoAt',
  'llegadaTarde',
  'isCompleted',
  'completionReason',
  'autoCloseReason',
  'autoCompletedAt',
  'autoCompletedBy',
  'completedAt',
  'completedBy',
  'retentionEndedAt',
  'retentionMinutes',
];

const TOPE_REASONS = new Set(['TOPE_JORNADA', 'TOPE_JORNADA_RETROACTIVO']);

const apply = process.argv.includes('--apply');
const DELETE = Symbol('delete');

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

function gridCode(data) {
  return String(data.code || data.shiftCode || '').trim().toUpperCase();
}

function hasValue(v) {
  return v !== undefined && v !== null && v !== '';
}

function hasDemoMark(data) {
  return hasValue(data.modoDemoAt) || data.autoPresencia === true;
}

/** Presencia o cierre inventados: no hay `checkInTime` de una fichada real. */
function hasPresenceWithoutRealCheckIn(data) {
  if (hasValue(data.checkInTime)) return false;
  return data.isPresent === true
    || hasValue(data.realStartTime)
    || hasValue(data.presentAt)
    || data.status === 'PRESENT'
    || data.status === 'COMPLETED';
}

function isLicenseNovedad(data, codes) {
  return data.type === 'NOVEDAD' && codes.has(gridCode(data));
}

/** Estado más frecuente entre las licencias del código que el Demo no tocó. */
function referenceStatus(code, cleanByCode) {
  const counts = cleanByCode.get(code);
  if (!counts || counts.size === 0) return 'Approved';
  let best = 'Approved';
  let bestN = -1;
  for (const [status, n] of counts) {
    if (n > bestN || (n === bestN && status === 'Approved')) {
      best = status;
      bestN = n;
    }
  }
  return best;
}

function buildLicensePatch(data, status) {
  const patch = {};
  for (const field of CLEAR_FIELDS) {
    if (data[field] !== undefined) patch[field] = DELETE;
  }
  const reason = String(data.completionReason || '');
  if (data.requiereRevision !== undefined && TOPE_REASONS.has(reason)) {
    patch.requiereRevision = DELETE;
  }
  if (data.status !== status) patch.status = status;
  if (Object.keys(patch).length === 0) return patch;
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

function printDiff(label, data, patch, who) {
  console.log(`\n── ${label}`);
  console.log(
    `   ${who} · ${String(data.objectiveName || data.objectiveId || '?')}`
    + ` · ${String(data.positionName || '')} · código ${gridCode(data) || '—'}`
    + ` · ${fmt(data.startTime)} → ${fmt(data.endTime)}`,
  );
  const keys = Object.keys(patch);
  if (!keys.length) {
    console.log('   (sin cambios: ya está correcto)');
    return 0;
  }
  let changed = 0;
  for (const k of keys) {
    const beforeTxt = fmt(data[k]);
    const after = patch[k];
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

function guardiaAliases(employeeIds) {
  const map = new Map();
  [...new Set(employeeIds)].sort().forEach((id, i) => {
    map.set(id, `Guardia ${String(i + 1).padStart(2, '0')}`);
  });
  return map;
}

async function licenseCodes(db) {
  const codes = new Set(BASE_LICENSE_CODES);
  const snap = await db.collection('tipos_novedad').where('empresaId', '==', EMPRESA_ID).get();
  snap.forEach((doc) => {
    const data = doc.data();
    if (String(data.status || 'ACTIVE').toUpperCase() === 'INACTIVE') return;
    const code = String(data.code || '').trim().toUpperCase();
    if (code && !NOT_A_LICENSE.has(code)) codes.add(code);
  });
  return codes;
}

async function run() {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  const db = admin.firestore();
  const from = admin.firestore.Timestamp.fromMillis(Date.parse(SCAN_FROM_ISO));

  console.log(`Proyecto: ${PROD_PROJECT} · empresa: ${EMPRESA_ID} · modo: ${apply ? 'APPLY (escribe)' : 'DRY RUN (solo lectura)'}`);
  console.log(`Barrido de licencias con startTime >= 01/08/2026 AR`);

  const codes = await licenseCodes(db);
  const snap = await db.collection('turnos')
    .where('empresaId', '==', EMPRESA_ID)
    .where('startTime', '>=', from)
    .get();

  const licenses = [];
  const omitted = [];
  snap.forEach((doc) => {
    const data = doc.data();
    if (!codes.has(gridCode(data))) return;
    if (!hasDemoMark(data) && !hasPresenceWithoutRealCheckIn(data)) return;
    if (!isLicenseNovedad(data, codes)) {
      omitted.push({ id: doc.id, code: gridCode(data), type: String(data.type || '—'), status: String(data.status || '—') });
      return;
    }
    licenses.push({ id: doc.id, ref: doc.ref, data });
  });

  const cleanByCode = new Map();
  snap.forEach((doc) => {
    const data = doc.data();
    if (!isLicenseNovedad(data, codes)) return;
    if (hasDemoMark(data) || hasPresenceWithoutRealCheckIn(data)) return;
    const code = gridCode(data);
    if (!cleanByCode.has(code)) cleanByCode.set(code, new Map());
    const counts = cleanByCode.get(code);
    const status = String(data.status || '');
    counts.set(status, (counts.get(status) || 0) + 1);
  });

  const alias = guardiaAliases(licenses.map((row) => String(row.data.employeeId || row.id)));
  const who = (data, id) => alias.get(String(data.employeeId || id)) || 'Guardia ??';

  const planned = [];
  const byCode = new Map();
  const byGuardia = new Map();

  for (const row of licenses) {
    const code = gridCode(row.data);
    const status = referenceStatus(code, cleanByCode);
    const patch = buildLicensePatch(row.data, status);
    const name = who(row.data, row.id);
    const changed = printDiff(`${row.id} (licencia ${code} → ${status})`, row.data, patch, name);
    if (!changed) continue;
    planned.push({ ref: row.ref, patch });
    byCode.set(code, (byCode.get(code) || 0) + 1);
    if (!byGuardia.has(name)) byGuardia.set(name, new Map());
    const codesOf = byGuardia.get(name);
    codesOf.set(code, (codesOf.get(code) || 0) + 1);
  }

  const bSnap = await db.collection('turnos').doc(BUSTAMANTE_SHIFT_ID).get();
  if (!bSnap.exists) {
    console.log(`\n── Bustamante ${BUSTAMANTE_SHIFT_ID}\n   turno inexistente`);
  } else {
    const data = bSnap.data();
    const patch = buildBustamantePatch();
    const changed = printDiff(`Bustamante ${BUSTAMANTE_SHIFT_ID} (turno T 27/09 → 11:00–23:00 AR)`, data, patch, 'Bustamante');
    if (changed) planned.push({ ref: bSnap.ref, patch });
  }

  console.log('\n── Resumen (anonimizado)');
  if (byCode.size === 0) console.log('   Por código: ninguno');
  else console.log(`   Por código: ${[...byCode.entries()].sort().map(([c, n]) => `${c}=${n}`).join(', ')}`);
  if (byGuardia.size === 0) console.log('   Por empleado: ninguno');
  for (const [name, codesOf] of [...byGuardia.entries()].sort()) {
    const detail = [...codesOf.entries()].map(([c, n]) => `${c}×${n}`).join(', ');
    const total = [...codesOf.values()].reduce((a, b) => a + b, 0);
    console.log(`   ${name}: ${total} (${detail})`);
  }
  for (const [code, counts] of [...cleanByCode.entries()].sort()) {
    const ref = [...counts.entries()].map(([s, n]) => `${s}×${n}`).join(', ');
    console.log(`   Referencia ${code} no tocada por Demo: ${ref} → se usa ${referenceStatus(code, cleanByCode)}`);
  }
  if (omitted.length) {
    console.log(`   Omitidos (código de licencia pero no son novedad RRHH): ${omitted.length}`);
    for (const row of omitted) {
      console.log(`     ${row.id} código ${row.code} type=${row.type} status=${row.status}`);
    }
  }

  console.log(`\nTurnos con cambios: ${planned.length} (${licenses.length} licencias a corregir + Bustamante si cambia)`);

  if (!apply) {
    console.log('DRY RUN: no se escribió nada. Para aplicar: node scripts/fix-p1b-demo-licencias.mjs --apply (solo con OK de Mauro).');
    return;
  }

  for (let i = 0; i < planned.length; i += BATCH_LIMIT) {
    const slice = planned.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const { ref, patch } of slice) batch.update(ref, toFirestorePatch(patch));
    await batch.commit();
  }
  console.log(`✓ Aplicado sobre ${planned.length} turno(s).`);
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
