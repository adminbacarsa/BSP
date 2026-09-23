/**
 * Dry-run limpieza Pruebas SA en Firestore PRODUCCIÓN (no emulador).
 * Requiere credenciales Admin (Application Default Credentials o GOOGLE_APPLICATION_CREDENTIALS).
 *
 *   node scripts/run-pruebas-sa-release-dryrun.mjs
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

const { releaseTraceAbsencesRun } = requireFn('./lib/coverage/releaseTraceAbsences.js');
const { releaseInvalidRetentionsRun } = requireFn('./lib/coverage/coverageRetention.js');

async function main() {
  console.log(`\n=== releaseTraceAbsences dryRun empresaId=${empresaId} project=${projectId} ===\n`);
  const trace = await releaseTraceAbsencesRun(db, { empresaId, dryRun: true });
  console.log(JSON.stringify({ dryRun: true, count: trace.rows.length, rows: trace.rows }, null, 2));

  console.log(`\n=== releaseInvalidRetentions dryRun empresaId=${empresaId} ===\n`);
  const ret = await releaseInvalidRetentionsRun(db, { empresaId, dryRun: true });
  console.log(JSON.stringify({ dryRun: true, count: ret.rows.length, rows: ret.rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
