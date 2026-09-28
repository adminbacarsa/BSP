/**
 * P3 — marca hermanos de un mismo hueco (VACANTE_POR_AUSENCIA / SLA_VIRTUAL /
 * SLA_UNPLANNED_GAP / autodev_ / autosinc_ / INTERRUPTION) como SUPERSEDED.
 *
 * Dry-run por defecto (solo lectura, ADC). Escritura:
 *   node scripts/dedupe-vacantes-hueco.mjs --apply --allow-prod
 *
 * NUNCA deleteDoc. Patch: status SUPERSEDED + supersededBy.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const PROD_PROJECT = 'comtroldata';
const SIBLING_ORIGINS = ['VACANTE_POR_AUSENCIA', 'SLA_VIRTUAL', 'SLA_UNPLANNED_GAP', 'INTERRUPTION'];

function parseArgs(argv) {
  const out = { apply: false, allowProd: false, empresa: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--allow-prod') out.allowProd = true;
    else if (a === '--empresa') out.empresa = argv[++i];
  }
  return out;
}

function installWriteGuard() {
  const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
  const deny = (what) => function denied() {
    throw new Error(`[dedupe-vacantes] escritura bloqueada (${what}): dryRun`);
  };
  for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(`doc.${m}`);
  CollectionReference.prototype.add = deny('collection.add');
  WriteBatch.prototype.commit = deny('batch.commit');
  Firestore.prototype.runTransaction = deny('runTransaction');
}

function tsMs(v) {
  return v?.toMillis?.() ?? 0;
}

function ymdAr(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Cordoba' });
}

function normPos(n) {
  return String(n ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function gapKey(d) {
  const start = tsMs(d.startTime);
  const rounded = Math.round(start / (30 * 60 * 1000)) * (30 * 60 * 1000);
  return [
    String(d.empresaId || ''),
    String(d.objectiveId || ''),
    normPos(d.positionName),
    ymdAr(rounded),
    String(d.code || d.bandCode || '').toUpperCase(),
    String(rounded),
  ].join('|');
}

async function loadSiblings(db, onlyEmpresa) {
  const out = [];
  const seen = new Set();
  const push = (doc) => {
    if (seen.has(doc.id)) return;
    seen.add(doc.id);
    const d = doc.data();
    if (onlyEmpresa && String(d.empresaId || '') !== onlyEmpresa) return;
    if (String(d.status || '').toUpperCase() === 'SUPERSEDED') return;
    out.push({ id: doc.id, ref: doc.ref, ...d });
  };
  for (const origin of SIBLING_ORIGINS) {
    const snap = await db.collection('turnos').where('origin', '==', origin).get();
    snap.docs.forEach(push);
  }
  const sin = await db.collection('turnos').where('employeeId', '==', 'SIN_COBERTURA').get();
  sin.docs.forEach(push);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const write = args.apply === true && args.allowProd === true;
  if (args.apply && !args.allowProd) {
    console.error('Para escribir hace falta --apply --allow-prod juntos.');
    process.exit(1);
  }

  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.GCLOUD_PROJECT;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  if (!write) installWriteGuard();
  const db = admin.firestore();

  const siblings = await loadSiblings(db, args.empresa);
  const groups = new Map();
  const vpaBySlot = new Map();
  for (const row of siblings) {
    if (String(row.origin || '') === 'VACANTE_POR_AUSENCIA') {
      vpaBySlot.set(gapKey(row), String(row.causedByShiftId || '').trim() || row.id);
    }
  }
  for (const row of siblings) {
    const byCause = String(row.causedByShiftId || row.originRef || '').trim();
    const slotCause = vpaBySlot.get(gapKey(row));
    const key = byCause
      ? `cause:${byCause}`
      : (slotCause ? `cause:${slotCause}` : `slot:${gapKey(row)}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const byEmpresa = new Map();
  let markCount = 0;
  const caps = [];
  const nuevo = [];
  const toMark = [];

  for (const [key, rows] of groups) {
    rows.sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt) || String(a.id).localeCompare(b.id));
    const canonical = key.startsWith('cause:')
      ? key.slice(6)
      : rows[0].id;
    const extras = key.startsWith('cause:')
      ? rows
      : rows.slice(1);
    if (!extras.length) continue;
    const empresaId = String(rows[0].empresaId || '');
    if (!byEmpresa.has(empresaId)) byEmpresa.set(empresaId, { groups: 0, mark: 0 });
    const acc = byEmpresa.get(empresaId);
    acc.groups += 1;
    acc.mark += extras.length;
    markCount += extras.length;
    for (const s of extras) {
      toMark.push({ id: s.id, supersededBy: canonical, empresaId, origin: s.origin });
      const ymd = ymdAr(tsMs(s.startTime));
      if (s.id === 'lXLFk2F33HRiAsQpmoqS' || s.id === 'yDCPQSFsdMlqn6UhRX7J' || (ymd === '2026-09-26' && String(s.objectiveId) === 'uGccyya4SYft29gEeV8z')) {
        caps.push({ id: s.id, origin: s.origin, supersededBy: canonical, ymd });
      }
      if (s.id === '1KpNlPVZkaiMFC6tAnWV' || s.id === '1evQFKo3KVvMpe8MwtOL') {
        nuevo.push({ id: s.id, origin: s.origin, supersededBy: canonical, ymd });
      }
    }
  }

  if (write) {
    for (let i = 0; i < toMark.length; i += 400) {
      const batch = db.batch();
      for (const row of toMark.slice(i, i + 400)) {
        batch.update(db.collection('turnos').doc(row.id), {
          status: 'SUPERSEDED',
          supersededBy: row.supersededBy,
          supersededAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  console.log(write ? 'APPLY' : 'DRY-RUN', `grupos=${[...byEmpresa.values()].reduce((n, a) => n + a.groups, 0)} marcar=${markCount} hermanosLeidos=${siblings.length}`);
  console.log('\nPor empresa:');
  for (const [eid, a] of [...byEmpresa.entries()].sort((x, y) => y[1].mark - x[1].mark)) {
    console.log(`  ${eid}\tgrupos=${a.groups}\tmarcar=${a.mark}`);
  }
  console.log('\nCAPS 26/09:');
  console.log(caps);
  console.log('\nNuevo Edificio 28/09 (1KpNlPVZkaiMFC6tAnWV / 1evQFKo3KVvMpe8MwtOL):');
  console.log(nuevo);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
