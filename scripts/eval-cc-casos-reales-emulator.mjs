/**
 * E2E Centro de Comando sobre casos REALES (snapshot de prod → emulador, proyecto aislado).
 *
 * 1) Exportar (solo lectura prod, una vez):
 *    node scripts/cc-caso-real-snapshot.mjs export --empresa pruebas_sa --objective "Angelelli" --date 2026-09-26 --shift LplWKivQhBKowL3vVKTj --shift lXLFk2F33HRiAsQpmoqS --name caps-angelelli-2026-09-26
 * 2) Emulador Firestore activo (:8080) + `npm run build` en apps/functions.
 * 3) node scripts/eval-cc-casos-reales-emulator.mjs
 *
 * Cada caso recarga su snapshot en el proyecto `demo-cc-casos` (no toca los datos del lab).
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCaseIntoDb, caseFileExists } from './cc-caso-real-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const projectId = process.env.CC_CASOS_PROJECT || 'demo-cc-casos';
admin.initializeApp({ projectId });
const db = admin.firestore();

const CAPS = 'caps-angelelli-2026-09-26';

const results = [];
function report(caseId, ok, detail) {
  results.push({ caseId, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${caseId}\t${detail}`);
}

async function clearProject() {
  const cols = await db.listCollections();
  for (const col of cols) {
    await db.recursiveDelete(col);
  }
}

async function withCase(name, fn) {
  if (!caseFileExists(name)) {
    report(name, false, `falta scripts/out/cc-casos/${name}.json (correr export)`);
    return;
  }
  await clearProject();
  const meta = await loadCaseIntoDb(db, name);
  await fn(meta);
}

async function shift(id) {
  const s = await db.collection('turnos').doc(id).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}

async function run() {
  await withCase(CAPS, async (meta) => {
    const titular = await shift('LplWKivQhBKowL3vVKTj');
    const slaVirtual = await shift('lXLFk2F33HRiAsQpmoqS');
    const vpa = await shift('yDCPQSFsdMlqn6UhRX7J');
    const zombie = await shift('8pO5wLJxCj5CA2WWkE0v');
    const diaz = await shift('U8r4xp9303cWemPug1RW');
    const barrio = await shift('ops_cov_lXLFk2F33HRiAsQpmoqS_hzHO3PUA0Bo5DwZwHlG2');

    report('T0.1', meta.objectiveId === 'uGccyya4SYft29gEeV8z' && !!titular, `snapshot ${meta.name} cargado (objetivo ${meta.objectiveName})`);
    report('T0.2', titular?.isAbsent === true && titular?.startTime instanceof admin.firestore.Timestamp,
      `titular Quevedo AA, Timestamps restaurados`);
    report('T0.3', slaVirtual?.origin === 'SLA_VIRTUAL' && vpa?.origin === 'VACANTE_POR_AUSENCIA',
      'reproduce las 3 representaciones del mismo hueco (AA + SLA_VIRTUAL + VACANTE_POR_AUSENCIA)');
    report('T0.4', zombie?.employeeId === titular?.employeeId,
      'incluye el turno M 20/09 de Quevedo usado como EXTEND de su propia ausencia');
    report('T0.5', diaz?.completionReason === 'AUTO_ZOMBIE_SHIFT_END',
      'DIAZ cerrado por el navegador (AUTO_ZOMBIE_SHIFT_END) a las 17:00');
    report('T0.6', barrio?.realStartTime instanceof admin.firestore.Timestamp && barrio?.code === 'FT',
      'Barrionuevo FT con realStartTime 18:17');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode || 0), (e) => {
  console.error(e);
  process.exit(1);
});
