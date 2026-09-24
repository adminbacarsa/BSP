/**
 * Marca como ATENDIDA las novedades IA_ALERTA_* pendientes (retiro alertas IA CC).
 *
 *   node scripts/retire-ia-alerta-novedades.mjs              # dry-run (default)
 *   node scripts/retire-ia-alerta-novedades.mjs --apply      # escribe Firestore
 *
 * Prod: sin FIRESTORE_EMULATOR_HOST + credenciales ADC.
 * Lab:  $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'comtroldata';
const apply = process.argv.includes('--apply');
const empresaFilter = (() => {
  const i = process.argv.indexOf('--empresaId');
  return i >= 0 ? String(process.argv[i + 1] || '').trim() : '';
})();

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const IA_PREFIX = 'IA_ALERTA_';
const ATTENDIDA_POR = 'RETIRO_ALERTAS_IA';

function isPending(status) {
  const st = String(status || '').trim().toUpperCase();
  return st !== 'ATENDIDA';
}

async function main() {
  const snap = await db.collection('novedades').limit(5000).get();
  const candidates = [];

  for (const docSnap of snap.docs) {
    const d = docSnap.data() || {};
    const type = String(d.type || '');
    if (!type.startsWith(IA_PREFIX)) continue;
    if (!isPending(d.status)) continue;
    if (empresaFilter && String(d.empresaId || '') !== empresaFilter) continue;
    candidates.push({
      id: docSnap.id,
      type,
      status: d.status ?? null,
      empresaId: d.empresaId ?? null,
      objectiveName: d.objectiveName ?? null,
      employeeName: d.employeeName ?? null,
    });
  }

  const byType = {};
  for (const c of candidates) {
    byType[c.type] = (byType[c.type] || 0) + 1;
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    emulator: process.env.FIRESTORE_EMULATOR_HOST || null,
    empresaFilter: empresaFilter || null,
    scanned: snap.size,
    toAttend: candidates.length,
    byType,
    sample: candidates.slice(0, 25),
  }, null, 2));

  if (!apply) {
    console.log('\nDry-run: no se modificó Firestore. Ejecutá con --apply tras OK de Mauro.');
    return;
  }

  if (candidates.length === 0) {
    console.log('Nada que actualizar.');
    return;
  }

  let batch = db.batch();
  let ops = 0;
  let updated = 0;

  for (const c of candidates) {
    batch.update(db.collection('novedades').doc(c.id), {
      status: 'ATENDIDA',
      atendidaPor: ATTENDIDA_POR,
      atendidaAt: FieldValue.serverTimestamp(),
      resolution: 'RETIRO_ALERTAS_IA',
    });
    ops += 1;
    updated += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  console.log(`\nActualizadas ${updated} novedades → ATENDIDA (${ATTENDIDA_POR}).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
