/**
 * Migra device_bindings desde device_tokens (verified + deviceId).
 *
 * Uso (siempre dry-run por defecto):
 *   node scripts/migrate-device-bindings.mjs
 *   node scripts/migrate-device-bindings.mjs --apply
 *
 * Prod: FIRESTORE_EMULATOR_HOST vacío + credenciales ADC / service account.
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

if (!admin.apps.length) {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function main() {
  const snap = await db.collection('device_tokens').get();
  const byDevice = new Map();
  const verifiedNoDeviceId = [];
  const notVerifiedWithDevice = [];

  for (const docSnap of snap.docs) {
    const uid = docSnap.id;
    const d = docSnap.data() || {};
    const verified = d.verified === true;
    const deviceId = String(d.deviceId ?? '').trim();
    const employeeId = String(d.employeeId ?? '').trim();

    if (verified && !deviceId) {
      verifiedNoDeviceId.push({ uid, employeeId });
      continue;
    }
    if (!verified && deviceId) {
      notVerifiedWithDevice.push({ uid, employeeId, deviceId });
    }
    if (!verified || !deviceId) continue;

    const row = {
      uid,
      employeeId,
      empresaId: d.empresaId ?? null,
      deviceId,
      source: d.source || 'legacy_migration',
    };
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
    byDevice.get(deviceId).push(row);
  }

  const conflicts = [];
  for (const [deviceId, owners] of byDevice.entries()) {
    const uids = [...new Set(owners.map((o) => o.uid))];
    if (uids.length > 1) {
      conflicts.push({ deviceId, owners });
    }
  }

  const uniqueBindings = [];
  for (const [deviceId, owners] of byDevice.entries()) {
    const uids = [...new Set(owners.map((o) => o.uid))];
    if (uids.length === 1) {
      uniqueBindings.push({ deviceId, ...owners[0] });
    }
  }

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    scannedTokens: snap.size,
    candidateBindings: uniqueBindings.length,
    conflicts: conflicts.length,
    verifiedNoDeviceId: verifiedNoDeviceId.length,
    notVerifiedWithDevice: notVerifiedWithDevice.length,
    conflictDetails: conflicts,
    verifiedNoDeviceIdSample: verifiedNoDeviceId.slice(0, 50),
    notVerifiedWithDeviceSample: notVerifiedWithDevice.slice(0, 50),
  };

  console.log(JSON.stringify(report, null, 2));

  if (conflicts.length > 0) {
    console.error('\n⚠ Hay conflictos (mismo deviceId en varios uid). No se aplican cambios automáticos.');
    if (apply) process.exit(2);
    return;
  }

  if (!apply) {
    console.log('\nDry-run OK. Revisá el JSON y ejecutá con --apply si corresponde.');
    return;
  }

  let written = 0;
  for (const row of uniqueBindings) {
    const bindRef = db.collection('device_bindings').doc(row.deviceId);
    const existing = await bindRef.get();
    if (existing.exists) {
      const exUid = String(existing.data()?.uid ?? '');
      if (exUid && exUid !== row.uid) {
        console.error(`Skip ${row.deviceId}: binding existente para otro uid ${exUid}`);
        continue;
      }
    }
    await bindRef.set(
      {
        uid: row.uid,
        employeeId: row.employeeId || null,
        empresaId: row.empresaId,
        boundAt: FieldValue.serverTimestamp(),
        source: 'legacy_migration',
        migratedFrom: 'device_tokens',
      },
      { merge: true },
    );
    written += 1;
  }

  console.log(JSON.stringify({ applied: true, bindingsWritten: written }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
