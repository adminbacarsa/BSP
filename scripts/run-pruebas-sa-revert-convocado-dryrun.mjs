/**
 * Dry-run revertConvocadoFalseAbsences en producción (Pruebas SA).
 *   node scripts/run-pruebas-sa-revert-convocado-dryrun.mjs
 *   node scripts/run-pruebas-sa-revert-convocado-dryrun.mjs pruebas_sa false
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
const dryRun = (process.argv[3] || 'true').toLowerCase() !== 'false';

admin.initializeApp({ projectId });
const db = admin.firestore();

const { revertConvocadoFalseAbsencesRun } = requireFn('./lib/attendance/revertConvocadoFalseAbsences.js');

async function main() {
  console.log(`\n=== revertConvocadoFalseAbsences dryRun=${dryRun} empresaId=${empresaId} project=${projectId} ===\n`);
  const result = await revertConvocadoFalseAbsencesRun(db, { empresaId, dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
