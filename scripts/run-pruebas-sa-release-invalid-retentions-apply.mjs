/**
 * releaseInvalidRetentions dryRun:false — Pruebas SA producción.
 *   node scripts/run-pruebas-sa-release-invalid-retentions-apply.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Quitar FIRESTORE_EMULATOR_HOST para apuntar a producción.');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'comtroldata';
const empresaId = process.argv[2] || 'pruebas_sa';

admin.initializeApp({ projectId });
const db = admin.firestore();

const { releaseInvalidRetentionsRun } = requireFn('./lib/coverage/coverageRetention.js');

async function main() {
  console.log(`\n=== releaseInvalidRetentions APPLY empresaId=${empresaId} project=${projectId} ===\n`);
  const ret = await releaseInvalidRetentionsRun(db, { empresaId, dryRun: false });
  console.log(JSON.stringify({ dryRun: false, count: ret.rows.length, rows: ret.rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
