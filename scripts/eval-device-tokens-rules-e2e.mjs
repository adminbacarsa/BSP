#!/usr/bin/env node
/**
 * Reglas device_tokens (Firestore emulator :8080 + Auth :9099).
 * Reiniciá emuladores tras cambiar firestore.rules.
 *
 *   node scripts/eval-device-tokens-rules-e2e.mjs
 */
import net from 'net';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function waitPort(port, label, timeoutMs = 60000) {
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
        else setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

async function main() {
  for (const [port, label] of [
    [8080, 'Firestore'],
    [9099, 'Auth'],
  ]) {
    await waitPort(port, label);
  }

  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import('firebase/auth');
  const { getFirestore, connectFirestoreEmulator, doc, setDoc } = await import('firebase/firestore');

  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: 'localhost',
    projectId: 'comtroldata',
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  try {
    await signInWithEmailAndPassword(auth, 'guardia@bacarsa.com.ar', 'guardia1234');
  } catch {
    console.error('FALLA\tLogin guardia — ejecutá: npm run seed');
    process.exit(1);
  }

  const uid = auth.currentUser.uid;
  let failed = 0;

  // Caso 1: guardia no puede escribir vínculo device_tokens/{uid}
  try {
    await setDoc(
      doc(db, 'device_tokens', uid),
      { uid, verified: true, deviceId: 'fake_device_12345678' },
      { merge: true },
    );
    console.log('FALLA\tCaso 1\tGuardia pudo escribir device_tokens/{uid} (verified)');
    failed += 1;
  } catch (e) {
    const code = e?.code || String(e);
    if (code === 'permission-denied') {
      console.log('OK\tCaso 1\tDenegado escribir vínculo device_tokens/{uid}.verified');
    } else {
      console.log('FALLA\tCaso 1\tError inesperado:', code);
      failed += 1;
    }
  }

  // Caso 2: guardia puede registrar doc FCM (tokenId != uid, sin campos de vínculo)
  const fcmToken = `eval_fcm_${uid.slice(0, 8)}_${Date.now()}`;
  try {
    await setDoc(doc(db, 'device_tokens', fcmToken), {
      uid,
      token: fcmToken,
      platform: 'web',
      role: 'employee',
    });
    console.log('OK\tCaso 2\tPermitido setDoc device_tokens/{fcmToken}');
  } catch (e) {
    console.log('FALLA\tCaso 2\tNo pudo registrar FCM:', e?.code || e);
    failed += 1;
  }

  // Caso 4: no puede suplantar role admin
  const fcmToken4 = `eval_fcm4_${uid.slice(0, 8)}_${Date.now()}`;
  try {
    await setDoc(doc(db, 'device_tokens', fcmToken4), {
      uid,
      token: fcmToken4,
      role: 'admin',
    });
    console.log('FALLA\tCaso 4\tGuardia pudo setear role admin');
    failed += 1;
  } catch (e) {
    if (e?.code === 'permission-denied') {
      console.log('OK\tCaso 4\tDenegado role admin en FCM');
    } else {
      console.log('FALLA\tCaso 4\tError inesperado:', e?.code || e);
      failed += 1;
    }
  }

  // Caso 5: no puede setear employeeId ajeno (legajo admin seed)
  const fcmToken5 = `eval_fcm5_${uid.slice(0, 8)}_${Date.now()}`;
  try {
    await setDoc(doc(db, 'device_tokens', fcmToken5), {
      uid,
      token: fcmToken5,
      employeeId: 'admin_seed_legajo_fake',
      role: 'employee',
    });
    console.log('FALLA\tCaso 5\tGuardia pudo setear employeeId ajeno');
    failed += 1;
  } catch (e) {
    if (e?.code === 'permission-denied') {
      console.log('OK\tCaso 5\tDenegado employeeId ajeno');
    } else {
      console.log('FALLA\tCaso 5\tError inesperado:', e?.code || e);
      failed += 1;
    }
  }

  // Caso 3: guardia no puede inyectar verified en doc FCM
  const fcmToken2 = `eval_fcm2_${uid.slice(0, 8)}_${Date.now()}`;
  try {
    await setDoc(doc(db, 'device_tokens', fcmToken2), {
      uid,
      token: fcmToken2,
      verified: true,
    });
    console.log('FALLA\tCaso 3\tGuardia pudo setear verified en doc FCM');
    failed += 1;
  } catch (e) {
    if (e?.code === 'permission-denied') {
      console.log('OK\tCaso 3\tDenegado verified en doc FCM');
    } else {
      console.log('FALLA\tCaso 3\tError inesperado:', e?.code || e);
      failed += 1;
    }
  }

  if (failed) {
    console.error(`\n${failed} caso(s) fallaron`);
    process.exit(1);
  }
  console.log('\nTodos los casos OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
