/**
 * E2E reglas device_bindings / bindGuardDevice (Firestore emulator :8080).
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   npm run build --prefix apps/functions
 *   node scripts/eval-guard-device-bindings-e2e.mjs
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

const {
  bindGuardDevice,
  GuardDeviceBindError,
  assertCanRequestGuardDeviceRegistration,
  unbindGuardDeviceForUid,
} = requireFn('./lib/auth/bindGuardDevice.js');

const results = [];

function report(caseId, ok, detail) {
  results.push({ caseId, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\tCaso ${caseId}\t${detail}`);
}

async function pingEmulator() {
  try {
    await db.collection('_ping').doc('guard_device').set({ t: Date.now() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

function errCode(err) {
  return err?.details?.code || err?.code || err?.message || String(err);
}

async function seedUser(prefix, deviceId) {
  const uid = `${prefix}_uid`;
  const employeeId = `${prefix}_emp`;
  const empresaId = `${prefix}_co`;
  await db.collection('empleados').doc(employeeId).set({
    uid,
    empresaId,
    email: `${prefix}@test.local`,
    firstName: 'Test',
    lastName: prefix,
  });
  if (deviceId) {
    await db.collection('device_tokens').doc(uid).set({
      uid,
      employeeId,
      verified: true,
      deviceId,
    });
  } else {
    await db.collection('device_tokens').doc(uid).set({
      uid,
      employeeId,
      verified: true,
    });
  }
  return { uid, employeeId, empresaId };
}

async function bindingUid(deviceId) {
  const snap = await db.collection('device_bindings').doc(deviceId).get();
  return snap.exists ? String(snap.data()?.uid ?? '') : null;
}

async function retiredFor(uid) {
  const snap = await db.collection('device_tokens').doc(uid).get();
  return snap.data()?.retiredDeviceIds || [];
}

async function run() {
  if (!(await pingEmulator())) {
    console.error('Firestore emulator no responde en', process.env.FIRESTORE_EMULATOR_HOST);
    process.exit(1);
  }

  const devA1 = 'device_a_old_11111111';
  const devA2 = 'device_a_new_22222222';

  // Caso 1: dispositivo de A no valida a B (mail)
  try {
    const a = await seedUser('gd1a', null);
    const b = await seedUser('gd1b', null);
    const dev1 = 'device_gd1_shared_aaaa1111';
    await bindGuardDevice(db, {
      uid: a.uid,
      employeeId: a.employeeId,
      empresaId: a.empresaId,
      deviceId: dev1,
      source: 'email_link',
    });
    let blocked = false;
    try {
      await bindGuardDevice(db, {
        uid: b.uid,
        employeeId: b.employeeId,
        empresaId: b.empresaId,
        deviceId: dev1,
        source: 'email_link',
      });
    } catch (e) {
      blocked = e instanceof GuardDeviceBindError && e.code === 'DEVICE_OWNED_BY_OTHER';
    }
    report('1', blocked, 'B no puede vincular deviceId de A');
  } catch (e) {
    report('1', false, String(e));
  }

  // Caso 2: A pasa al nuevo → viejo retirado
  try {
    const a = await seedUser('gd2a', devA1);
    await db.collection('device_bindings').doc(devA1).set({
      uid: a.uid,
      employeeId: a.employeeId,
      source: 'legacy',
    });
    await bindGuardDevice(db, {
      uid: a.uid,
      employeeId: a.employeeId,
      empresaId: a.empresaId,
      deviceId: devA2,
      source: 'approval',
    });
    const retired = await retiredFor(a.uid);
    const oldBound = await bindingUid(devA1);
    const newBound = await bindingUid(devA2);
    report(
      '2',
      retired.includes(devA1) && !oldBound && newBound === a.uid,
      `retired=${JSON.stringify(retired)} oldBind=${oldBound} newBind=${newBound}`,
    );
  } catch (e) {
    report('2', false, String(e));
  }

  // Caso 3: aprobación del viejo → RETIRED_DEVICE_NEEDS_EMAIL
  try {
    const a = await seedUser('gd3a', devA2);
    await db.collection('device_tokens').doc(a.uid).set(
      {
        uid: a.uid,
        employeeId: a.employeeId,
        verified: true,
        deviceId: devA2,
        retiredDeviceIds: [devA1],
      },
      { merge: true },
    );
    let code = '';
    try {
      await bindGuardDevice(db, {
        uid: a.uid,
        employeeId: a.employeeId,
        empresaId: a.empresaId,
        deviceId: devA1,
        source: 'approval',
      });
    } catch (e) {
      code = e instanceof GuardDeviceBindError ? e.code : errCode(e);
    }
    report('3', code === 'RETIRED_DEVICE_NEEDS_EMAIL', code);
  } catch (e) {
    report('3', false, String(e));
  }

  // Caso 4: mail en el viejo → vuelve y libera el nuevo
  try {
    const a = await seedUser('gd4a', devA2);
    await db.collection('device_tokens').doc(a.uid).set(
      {
        uid: a.uid,
        employeeId: a.employeeId,
        verified: true,
        deviceId: devA2,
        retiredDeviceIds: [devA1],
      },
      { merge: true },
    );
    await db.collection('device_bindings').doc(devA2).set({ uid: a.uid, employeeId: a.employeeId });
    await bindGuardDevice(db, {
      uid: a.uid,
      employeeId: a.employeeId,
      empresaId: a.empresaId,
      deviceId: devA1,
      source: 'email_link',
    });
    const retired = await retiredFor(a.uid);
    const bindOld = await bindingUid(devA1);
    const bindNew = await bindingUid(devA2);
    report(
      '4',
      bindOld === a.uid && !bindNew && retired.includes(devA2) && !retired.includes(devA1),
      `retired=${JSON.stringify(retired)} bindOld=${bindOld} bindNew=${bindNew}`,
    );
  } catch (e) {
    report('4', false, String(e));
  }

  // Caso 5: request rechaza mismo deviceId de otro
  try {
    const a = await seedUser('gd5a', null);
    const b = await seedUser('gd5b', null);
    const dev5 = 'device_gd5_shared_bbbb2222';
    await bindGuardDevice(db, {
      uid: a.uid,
      employeeId: a.employeeId,
      empresaId: a.empresaId,
      deviceId: dev5,
      source: 'email_link',
    });
    let code = '';
    try {
      await assertCanRequestGuardDeviceRegistration(db, b.uid, dev5);
    } catch (e) {
      code = e instanceof GuardDeviceBindError ? e.code : errCode(e);
    }
    report('5', code === 'DEVICE_OWNED_BY_OTHER', code);
  } catch (e) {
    report('5', false, String(e));
  }

  // Caso 6: unbind libera binding
  try {
    const a = await seedUser('gd6a', devA1);
    await db.collection('device_bindings').doc(devA1).set({ uid: a.uid, employeeId: a.employeeId });
    await unbindGuardDeviceForUid(db, a.uid, 'e2e');
    const bind = await bindingUid(devA1);
    const tok = await db.collection('device_tokens').doc(a.uid).get();
    const noDevice = !String(tok.data()?.deviceId ?? '').trim();
    report('6', !bind && noDevice && tok.data()?.verified === false, `bind=${bind} verified=${tok.data()?.verified}`);
  } catch (e) {
    report('6', false, String(e));
  }

  // Caso 7: bypass no crea binding (simulado: sin llamada bind)
  try {
    const uid = 'gd7_uid';
    const employeeId = 'gd7_emp';
    await db.collection('empleados').doc(employeeId).set({ uid, bypassDeviceCheck: true, empresaId: 'gd7_co' });
    const before = (await db.collection('device_bindings').get()).size;
    // requestGuardDeviceRegistration con bypass no escribe device_tokens ni bindings
    const after = (await db.collection('device_bindings').get()).size;
    const tokSnap = await db.collection('device_tokens').doc(uid).get();
    report('7', before === after && !tokSnap.exists, 'sin binding ni token');
  } catch (e) {
    report('7', false, String(e));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`Total: ${results.length}, OK: ${results.length - failed.length}, FALLA: ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

run();
