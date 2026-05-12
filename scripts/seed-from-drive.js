/**
 * seed-from-drive.js
 * Descarga un backup de Google Drive usando credenciales locales (gcloud ADC)
 * y siembra el emulador de Firestore + Auth.
 *
 * Uso: node scripts/seed-from-drive.js <driveFileId>
 * Requiere: gcloud auth application-default login (ya hecho)
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { execSync } = require('child_process');
const https        = require('https');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth }                 = require('firebase-admin/auth');

const DEFAULT_PASSWORD = 'test1234';
const BATCH_SIZE       = 400;

const driveFileId = process.argv[2];
if (!driveFileId) {
  console.error('Uso: node scripts/seed-from-drive.js <driveFileId>');
  process.exit(1);
}

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db   = getFirestore();
const auth = getAuth();

async function getADCToken() {
  try {
    const token = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
    return token;
  } catch {
    throw new Error('No se pudo obtener token ADC. Ejecutá: gcloud auth application-default login');
  }
}

function downloadFromDrive(fileId, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path:     `/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      headers:  { Authorization: `Bearer ${token}` },
    };
    https.get(options, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`Drive respondió ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function clearFirestore() {
  process.stdout.write('Limpiando Firestore del emulador... ');
  const cols = await db.listCollections();
  for (const col of cols) {
    const docs = await col.listDocuments();
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach(r => batch.delete(r));
      await batch.commit();
    }
  }
  console.log('OK');
}

async function clearAuth() {
  process.stdout.write('Limpiando Auth del emulador... ');
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    if (res.users.length > 0) {
      await auth.deleteUsers(res.users.map(u => u.uid));
    }
    pageToken = res.pageToken;
  } while (pageToken);
  console.log('OK');
}

async function seedAuth(users) {
  if (!users || users.length === 0) { console.log('  (sin usuarios)'); return; }
  let created = 0;
  for (const u of users) {
    if (!u.email) continue;
    try {
      await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName || undefined, password: DEFAULT_PASSWORD, disabled: u.disabled || false });
      if (u.customClaims) await auth.setCustomUserClaims(u.uid, u.customClaims);
      created++;
    } catch (e) {
      if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') {
        console.warn(`  WARN ${u.email}: ${e.message}`);
      }
    }
  }
  console.log(`  ${created} usuarios creados (password: ${DEFAULT_PASSWORD})`);
}

async function seedFirestore(collections) {
  let total = 0;
  for (const [col, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    process.stdout.write(`  ${col.padEnd(35)} ${String(docs.length).padStart(5)} docs ... `);
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach(doc => {
        const { _id, ...fields } = doc;
        batch.set(db.collection(col).doc(_id), deserialize(fields));
      });
      await batch.commit();
    }
    total += docs.length;
    console.log('OK');
  }
  return total;
}

function deserialize(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deserialize);
  if (typeof obj._seconds === 'number' && typeof obj._nanoseconds === 'number') {
    return new Timestamp(obj._seconds, obj._nanoseconds);
  }
  const result = {};
  for (const [k, v] of Object.entries(obj)) result[k] = deserialize(v);
  return result;
}

async function run() {
  console.log(`\nDescargando backup ${driveFileId} desde Drive...`);
  const token = await getADCToken();
  const raw   = await downloadFromDrive(driveFileId, token);
  const data  = JSON.parse(raw);
  const { _meta, _auth_users, ...collections } = data;

  console.log(`Backup: ${_meta?.exportedAt || '?'} — ${_meta?.totalDocs || '?'} docs\n`);

  await clearFirestore();
  await clearAuth();

  // Auth — usa _auth_users o extrae de system_users
  let authUsers = _auth_users;
  if (!authUsers || authUsers.length === 0) {
    const src = collections['system_users'] || collections['usuarios'] || [];
    authUsers = src.filter(u => u.email).map(u => ({
      uid: u._id, email: u.email,
      displayName: u.nombre || u.displayName || null,
      customClaims: u.role ? { role: u.role } : null,
      disabled: false,
    }));
  }
  console.log('Sembrando Auth:');
  await seedAuth(authUsers);

  console.log('\nSembrando Firestore:');
  const total = await seedFirestore(collections);

  console.log(`\n✔ Listo — ${total} documentos en ${Object.keys(collections).length} colecciones`);
  console.log('  http://127.0.0.1:4000\n');
}

run().catch(e => { console.error('\nError:', e.message); process.exit(1); });
