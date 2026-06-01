/**
 * seed-from-backup-file.js
 * Importa un backup JSON local al emulador Firestore (+ Auth desde system_users).
 *
 * Uso:
 *   node scripts/seed-from-backup-file.js "C:\path\backup.json"
 *   node scripts/seed-from-backup-file.js ./backup.json --empresa bacarsa
 *   node scripts/seed-from-backup-file.js ./backup.json --full
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const fs = require('fs');
const path = require('path');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldPath } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const PROJECT_ID = 'comtroldata';
const BATCH_SIZE = 400;
const DEFAULT_PASSWORD = 'admin1234';

const EMPRESA_SCOPED_COLS = new Set([
  'empleados', 'turnos', 'ausencias', 'objetivos', 'clientes', 'clients',
  'novedades', 'audit_logs', 'planificacion_estados', 'servicios_sla',
  'contratos_servicio', 'tipos_turno', 'user_notifications', 'system_backups',
  'roles', 'feriados', 'planificaciones_historial', 'historial_operaciones',
  'contracts', 'quotes', 'system_users', 'swap_requests',
]);

const args = process.argv.slice(2);
const fullMode = args.includes('--full');
const empresaIdx = args.indexOf('--empresa');
const empresaId = empresaIdx >= 0 ? String(args[empresaIdx + 1] || '').trim() : 'bacarsa';
const fileArg = args.find(a => !a.startsWith('--') && a !== empresaId);

if (!fileArg) {
  console.error('Uso: node scripts/seed-from-backup-file.js <backup.json> [--empresa bacarsa] [--full]');
  process.exit(1);
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`No existe: ${filePath}`);
  process.exit(1);
}

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

function docMatchesEmpresa(doc, empId) {
  const docEmpId = String(doc.empresaId ?? '').trim();
  return docEmpId === empId || (empId === 'bacarsa' && docEmpId === '');
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

async function deleteCollectionWhereEmpresa(colName, empId) {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(colName).where('empresaId', '==', empId).limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
  if (empId === 'bacarsa') {
    while (true) {
      const snap = await db.collection(colName).where('empresaId', '==', '').limit(BATCH_SIZE).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
    }
  }
  return deleted;
}

async function clearEmulatorFull() {
  process.stdout.write('Limpiando Firestore completo... ');
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

async function clearEmpresa(empId) {
  process.stdout.write(`Limpiando datos de ${empId}... `);
  let deleted = 0;
  for (const col of EMPRESA_SCOPED_COLS) {
    try {
      deleted += await deleteCollectionWhereEmpresa(col, empId);
    } catch { /* colección inexistente */ }
  }
  try {
    const empRef = db.collection('empresas').doc(empId);
    const snap = await empRef.get();
    if (snap.exists) {
      await empRef.delete();
      deleted += 1;
    }
  } catch { /* omit */ }
  console.log(`${deleted} docs borrados`);
}

async function seedAuthFromSystemUsers(systemUsers) {
  if (!Array.isArray(systemUsers) || systemUsers.length === 0) {
    console.log('Auth: sin system_users en backup');
    return 0;
  }
  let created = 0;
  for (const u of systemUsers) {
    const email = String(u.email ?? '').trim();
    const uid = String(u._id ?? u.uid ?? '').trim();
    if (!email || !uid) continue;
    try {
      await auth.createUser({
        uid,
        email,
        displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined,
        password: DEFAULT_PASSWORD,
        disabled: u.status === 'INACTIVE',
      });
      const role = String(u.role ?? 'ADMIN').trim();
      if (role) await auth.setCustomUserClaims(uid, { role });
      created++;
    } catch (e) {
      if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
        try {
          await auth.updateUser(uid, { email, password: DEFAULT_PASSWORD });
          const role = String(u.role ?? 'ADMIN').trim();
          if (role) await auth.setCustomUserClaims(uid, { role });
        } catch { /* omit */ }
      } else {
        console.warn(`  WARN Auth ${email}: ${e.message}`);
      }
    }
  }
  console.log(`Auth: ${created} usuarios (${DEFAULT_PASSWORD} si son nuevos)`);
  return created;
}

async function seedFirestore(collections, empId, isFull) {
  let written = 0;
  for (const [col, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;

    let filtered = docs;
    if (!isFull) {
      if (col === 'empresas') {
        filtered = docs.filter(d => d._id === empId);
      } else if (EMPRESA_SCOPED_COLS.has(col)) {
        filtered = docs.filter(d => docMatchesEmpresa(d, empId));
      } else {
        continue;
      }
      if (filtered.length === 0) continue;
    }

    process.stdout.write(`  ${col.padEnd(28)} ${String(filtered.length).padStart(6)} docs ... `);
    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = db.batch();
      filtered.slice(i, i + BATCH_SIZE).forEach(doc => {
        const { _id, ...fields } = doc;
        if (!_id) return;
        batch.set(db.collection(col).doc(_id), deserialize(fields), { merge: false });
      });
      await batch.commit();
    }
    written += filtered.length;
    console.log('OK');
  }
  return written;
}

async function run() {
  console.log(`\nLeyendo ${filePath}...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const meta = data._meta || {};
  const { _meta, _auth_users, ...collections } = data;
  const isFull = fullMode;
  const scope = isFull ? 'plataforma completa' : `empresa ${empresaId}`;

  console.log(`Backup: ${meta.exportedAt || '?'} — ${meta.totalDocs || '?'} docs — alcance import: ${scope}\n`);

  if (isFull) {
    await clearEmulatorFull();
  } else {
    await clearEmpresa(empresaId);
  }

  const authUsers = Array.isArray(_auth_users) && _auth_users.length > 0
    ? _auth_users
    : null;
  if (authUsers) {
    await seedAuthFromSystemUsers(authUsers.map(u => ({ ...u, _id: u.uid })));
  } else {
    await seedAuthFromSystemUsers(collections.system_users || []);
  }

  console.log('\nSembrando Firestore:');
  const written = await seedFirestore(collections, empresaId, isFull);

  console.log(`\n✔ Listo — ${written.toLocaleString()} documentos importados (${scope})`);
  console.log('  Firestore UI: http://127.0.0.1:4000/firestore');
  console.log('  App: http://localhost:3000 (recargá con Ctrl+F5)\n');
}

run().catch(e => {
  console.error('\nError:', e.message);
  process.exit(1);
});
