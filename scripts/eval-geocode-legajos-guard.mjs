/**
 * El update de lat/lng pasa (el commit interno del batch de DocumentReference.update).
 * set/delete/create/add/batch/tx y un update con otros campos siguen bloqueados.
 *
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   node scripts/eval-geocode-legajos-guard.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installGeocodeWriteGuard } from './geocode-legajos-guard.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):(\d+)$/.test(host)) {
  console.error(`FIRESTORE_EMULATOR_HOST debe ser local, llegó ${host}`);
  process.exit(1);
}
process.env.FIRESTORE_EMULATOR_HOST = host;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const projectId = 'comtroldata';

let failed = 0;
const pass = (label) => console.log(`  ok ${label}`);
const fail = (label) => {
  failed += 1;
  console.error(`  FAIL ${label}`);
};

async function blocked(label, fn) {
  try {
    await fn();
    fail(`${label} escribió`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('escritura bloqueada') || msg.startsWith('update fuera de')) pass(`${label} → ${msg}`);
    else fail(`${label}: ${msg}`);
  }
}

const ping = await fetch(`http://${host}/`).catch((e) => e);
if (ping instanceof Error) {
  console.error(`Emulador Firestore no responde en ${host}`);
  process.exit(1);
}

if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const ref = db.collection('_geo_write_guard').doc('probe');
const patch = {
  lat: -31.4201,
  lng: -64.1888,
  geoSource: 'nominatim',
  geocodedAt: '2026-09-30T12:00:00.000Z',
};

await ref.set({ nombre: 'antes', empresaId: 'pruebas_sa' });

const gate = { apply: true };
installGeocodeWriteGuard(admin, gate);

await ref.update(patch);
const written = (await ref.get()).data() || {};
if (
  written.lat === patch.lat
  && written.lng === patch.lng
  && written.geoSource === patch.geoSource
  && written.geocodedAt === patch.geocodedAt
  && written.nombre === 'antes'
) pass('update permitido escribió solo lat/lng/geoSource/geocodedAt');
else fail(`update permitido dejó ${JSON.stringify(written)}`);

await blocked('update con otro campo', () => ref.update({ ...patch, nombre: 'no' }));
await blocked('update incompleto', () => ref.update({ lat: 1, lng: 2 }));
await blocked('set', () => ref.set({ nombre: 'set' }));
await blocked('delete', () => ref.delete());
await blocked('create', () => db.collection('_geo_write_guard').doc('otro').create({ nombre: 'x' }));
await blocked('add', () => db.collection('_geo_write_guard').add({ nombre: 'x' }));
await blocked('batch', () => {
  const batch = db.batch();
  batch.update(ref, patch);
  return batch.commit();
});
await blocked('tx', () => db.runTransaction(async (tx) => {
  tx.update(ref, patch);
}));

const mid = (await ref.get()).data() || {};
if (mid.nombre === 'antes' && mid.lat === patch.lat) pass('los writes bloqueados no tocaron el doc');
else fail(`el doc cambió: ${JSON.stringify(mid)}`);

gate.apply = false;
await blocked('dryRun', () => ref.update(patch));
const afterDry = (await ref.get()).data() || {};
if (afterDry.lat === patch.lat && afterDry.nombre === 'antes') pass('dryRun no reescribió');
else fail(`dryRun alteró ${JSON.stringify(afterDry)}`);

await fetch(
  `http://${host}/v1/projects/${projectId}/databases/(default)/documents/_geo_write_guard/probe`,
  { method: 'DELETE' },
);

if (failed) {
  console.error(`GEOCODE_GUARD_FAIL ${failed}`);
  process.exit(1);
}
console.log('GEOCODE_GUARD_OK');
