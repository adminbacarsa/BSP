/**
 * E2E sesión operador (handler + isEmpresaManualMode) — Firestore emulator :8080.
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   npm run build --prefix apps/functions
 *   node scripts/eval-sesion-operador-e2e-emulator.mjs
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'comtroldata';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

admin.initializeApp({ projectId });
const db = admin.firestore();

const { handleSesionOperador } = requireFn('./lib/ops/sesionOperadorHandler.js');
const { isEmpresaManualMode } = requireFn('./lib/ops/opsManualMode.js');

const results = [];

function report(caseId, ok, detail) {
  results.push({ caseId, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${caseId}\t${detail}`);
}

async function pingEmulator() {
  try {
    await db.collection('_ping').doc('sesion_ops').set({ t: Date.now() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

async function seedOpsUser(prefix, empresaId) {
  const uid = `${prefix}_uid`;
  await db.collection('system_users').doc(uid).set({
    role: 'Operador',
    empresaId,
    email: `${prefix}@test.local`,
    displayName: prefix,
  });
  await db.collection('roles').doc('OPERADOR').set({
    empresaId,
    permissions: {
      OPERATIONS: ['read', 'update'],
      DASHBOARD: ['read'],
    },
  });
  return uid;
}

async function runFlow() {
  const empresaId = 'sesion_e2e_emp';
  await db.collection('empresas').doc(empresaId).set({ name: 'E2E Sesión' });

  const pilotUid = await seedOpsUser('ses_pilot', empresaId);
  const copilotUid = await seedOpsUser('ses_copilot', empresaId);

  let manual = await isEmpresaManualMode(db, empresaId);
  report('0-manual-inicial', manual === false, `isEmpresaManualMode=${manual}`);

  await handleSesionOperador(db, pilotUid, {
    action: 'start',
    empresaId,
    writeOrigin: 'WEB',
  });
  manual = await isEmpresaManualMode(db, empresaId);
  report('1-start-piloto', manual === true, `manual=${manual}`);

  await handleSesionOperador(db, copilotUid, {
    action: 'start',
    empresaId,
    writeOrigin: 'MOBILE',
  });

  const active = await db
    .collection('sesiones_operador')
    .where('empresaId', '==', empresaId)
    .where('status', '==', 'ACTIVO')
    .get();
  const roles = active.docs.map((d) => String(d.data().role || ''));
  report('2-segundo-copiloto', active.size >= 2 && roles.some((r) => r.toUpperCase() === 'COPILOTO'), `docs=${active.size} roles=${roles.join(',')}`);

  await handleSesionOperador(db, copilotUid, {
    action: 'requestPilot',
    empresaId,
    writeOrigin: 'MOBILE',
  });

  await handleSesionOperador(db, pilotUid, {
    action: 'acceptPilot',
    empresaId,
    writeOrigin: 'WEB',
  });

  const afterAccept = await db
    .collection('sesiones_operador')
    .where('empresaId', '==', empresaId)
    .where('status', '==', 'ACTIVO')
    .get();
  const pilotDoc = afterAccept.docs.find((d) => d.data().operatorId === copilotUid);
  report('3-accept-pilot', !!pilotDoc && String(pilotDoc.data().role).toUpperCase() === 'PILOTO', `copilotoEsPiloto=${!!pilotDoc}`);

  await handleSesionOperador(db, pilotUid, {
    action: 'passToAuto',
    empresaId,
    writeOrigin: 'WEB',
  });

  manual = await isEmpresaManualMode(db, empresaId);
  report('4-pass-to-auto', manual === false, `isEmpresaManualMode=${manual}`);
}

async function main() {
  if (!(await pingEmulator())) {
    console.error('Firestore emulator no responde en', process.env.FIRESTORE_EMULATOR_HOST);
    process.exit(1);
  }
  await runFlow();
  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(`Casos: ${results.length}, fallas: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
