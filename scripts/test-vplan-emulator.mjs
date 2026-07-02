#!/usr/bin/env node
/**
 * E2E emulador: auth admin → vplanRun (fases 0–3).
 * Requiere: Firestore 8080, Auth 9099, Functions 5001
 * Uso: npm run test:vplan-emulator
 */
import net from 'net';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function waitPort(port, label, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = () => {
      const s = net.createConnection({ port, host: '127.0.0.1' }, () => {
        s.end();
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() >= deadline) reject(new Error(`Timeout ${label} :${port}`));
        else setTimeout(tryOnce, 800);
      });
    };
    tryOnce();
  });
}

async function main() {
  console.log('COSP — test VPLAN emulador (Ola 1)\n');
  for (const [port, label] of [[8080, 'Firestore'], [9099, 'Auth'], [5001, 'Functions']]) {
    await waitPort(port, label);
    console.log(`✓ ${label} :${port}`);
  }

  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FUNCTIONS_EMULATOR = 'true';

  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import('firebase/auth');
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');
  const { initializeApp: initAdmin, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) initAdmin({ projectId: 'comtroldata' });
  const adb = getFirestore();

  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: 'localhost',
    projectId: 'comtroldata',
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);

  try {
    await signInWithEmailAndPassword(auth, 'admin@bacarsa.com.ar', 'admin1234');
    console.log('✓ Login admin@bacarsa.com.ar');
  } catch {
    console.error('✗ Login falló — ejecutá: npm run seed');
    process.exit(1);
  }

  const empresaId = 'bacarsa';
  let objectiveId = 'obj_demo_plan';
  const demoSla = await adb.collection('servicios_sla').doc('sla_demo_plan').get();
  if (!demoSla.exists) {
    const slaSnap = await adb.collection('servicios_sla').where('empresaId', '==', empresaId).limit(5).get();
    const first = slaSnap.docs.find((d) => d.data().objectiveId);
    if (first) objectiveId = String(first.data().objectiveId);
    else {
      console.warn('⚠ Sin SLA — ejecutá: npm run seed:planning-demo');
    }
  }
  console.log(`✓ Objetivo: ${objectiveId}\n`);

  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  const vplanRun = httpsCallable(functions, 'vplanRun', { timeout: 125000 });

  const payload = {
    empresaId,
    objectiveId,
    year: y,
    month: m,
    mode: 'GREENFIELD',
    intent: 'full',
    preferredCycle: '6+2',
    budgetMode: 'cct',
    runOptimization: false,
  };

  console.log('Invocando vplanRun…', payload);
  const res = await vplanRun(payload);
  const data = res.data;
  console.log('\n--- Respuesta ---');
  console.log('status:', data.status);
  console.log('message:', data.message);
  console.log('steps:');
  for (const s of data.context?.steps ?? []) {
    console.log(`  ${s.ok ? '✓' : '✗'} ${s.phase}: ${s.summary}`);
  }
  if (data.context?.feasibility) {
    const f = data.context.feasibility;
    console.log('\nViabilidad:', f.ok ? 'OK' : 'FALLA');
    if (f.reasons?.length) console.log('  reasons:', f.reasons.join(' | '));
    if (f.warnings?.length) console.log('  warnings:', f.warnings.join(' | '));
  }

  if (data.context?.deliverable) {
    const d = data.context.deliverable;
    console.log('\nEntrega:', d.reportSummary);
    console.log('  diff ops:', d.diff.length);
  }

  const ok = ['ok', 'verification_failed', 'feasibility_failed'].includes(data.status);
  if (!data.context?.demand) {
    console.error('\n✗ Sin modelo de demanda');
    process.exit(1);
  }
  console.log(ok ? '\nOK — pipeline VPLAN respondió (fases 0–10)' : '\n✗ Respuesta inesperada');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
