/**
 * seed-emulator.js
 * Siembra Firestore + Auth del emulador con datos de un backup JSON.
 * Uso: node scripts/seed-emulator.js <ruta-al-backup.json>
 *
 * Requiere que el emulador esté corriendo en localhost:8080 y localhost:9099
 * Los usuarios se crean con contraseña: test1234
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const fs   = require('fs');
const path = require('path');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth }                 = require('firebase-admin/auth');

const DEFAULT_PASSWORD = 'test1234';

const backupFile = process.argv[2];
if (!backupFile) {
  console.error('Uso: node scripts/seed-emulator.js <backup.json>');
  process.exit(1);
}
if (!fs.existsSync(backupFile)) {
  console.error(`No se encontró: ${backupFile}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ projectId: 'comtroldata' });
}
const db   = getFirestore();
const auth = getAuth();

const BATCH_SIZE = 400;

async function clearAuth() {
  let deleted = 0;
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    if (result.users.length > 0) {
      await auth.deleteUsers(result.users.map(u => u.uid));
      deleted += result.users.length;
    }
    pageToken = result.pageToken;
  } while (pageToken);
  console.log(`  ${deleted} usuarios eliminados del emulador`);
}

async function seedAuth(users) {
  if (!users || users.length === 0) {
    console.log('  (sin usuarios Auth en el backup)');
    return;
  }
  let created = 0;
  let skipped = 0;
  for (const u of users) {
    if (!u.email) { skipped++; continue; }
    try {
      await auth.createUser({
        uid:         u.uid,
        email:       u.email,
        displayName: u.displayName || undefined,
        password:    DEFAULT_PASSWORD,
        disabled:    u.disabled || false,
      });
      if (u.customClaims) {
        await auth.setCustomUserClaims(u.uid, u.customClaims);
      }
      created++;
    } catch (e) {
      console.warn(`  WARN usuario ${u.email}: ${e.message}`);
    }
  }
  console.log(`  ${created} creados, ${skipped} omitidos`);
}

async function seedFirestore(collections) {
  let totalRestored = 0;
  for (const [colName, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;
    process.stdout.write(`  ${colName.padEnd(35)} ${String(docs.length).padStart(5)} docs ... `);
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach(doc => {
        const { _id, ...fields } = doc;
        batch.set(db.collection(colName).doc(_id), deserialize(fields));
      });
      await batch.commit();
    }
    totalRestored += docs.length;
    console.log('OK');
  }
  return totalRestored;
}

const ADMIN_EMAIL    = 'admin@bacarsa.com.ar';
const ADMIN_PASSWORD = 'admin1234';

async function seedAdminUser() {
  console.log('\nSuperadmin local:');

  // Borrar usuario previo si existe (puede tener UID distinto al del backup)
  try {
    const existing = await auth.getUserByEmail(ADMIN_EMAIL);
    await auth.deleteUser(existing.uid);
    console.log(`  Auth: borrado usuario previo uid=${existing.uid}`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') {
      console.warn(`  WARN al borrar: ${e.message}`);
    }
  }

  // Crear limpio con contraseña conocida
  const u = await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, displayName: 'Admin' });
  const uid = u.uid;
  // Custom claims → el login.tsx redirige a /admin sin necesitar leer Firestore
  await auth.setCustomUserClaims(uid, { role: 'SUPERADMIN' });
  console.log(`  Auth: creado uid=${uid} + customClaims { role: SUPERADMIN }`);

  const modules = ['DASHBOARD','OPERATIONS','PLANNING','PLANNING_AI','RRHH','CLIENTS','SERVICES','REPORTS','ANALYSIS','ASSISTANT','CONFIG'];
  const perms = {};
  modules.forEach(m => perms[m] = ['read','create','update','delete']);

  // set() sin merge — garantiza estado limpio
  await db.collection('system_users').doc(uid).set({
    email: ADMIN_EMAIL, role: 'SUPERADMIN', empresaId: 'bacarsa', nombre: 'Admin',
  });
  await db.collection('roles').doc('SUPERADMIN').set({ permissions: perms }, { merge: true });
  await db.collection('empresas').doc('bacarsa').set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

  // Verificación inmediata
  const verify = await db.collection('system_users').doc(uid).get();
  if (verify.exists && (verify.data().role || '').toUpperCase() === 'SUPERADMIN') {
    console.log(`  ✔ Verificado: system_users/${uid} → SUPERADMIN`);
  } else {
    console.error(`  ✗ ERROR: no se pudo verificar system_users/${uid} — datos:`, verify.data());
  }

  console.log(`  Ingresá con: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

async function seed() {
  const raw  = fs.readFileSync(backupFile, 'utf8');
  const data = JSON.parse(raw);
  const { _meta, _auth_users, ...collections } = data;

  console.log(`\nBackup: ${path.resolve(backupFile)}`);
  if (_meta) console.log(`Exportado: ${_meta.exportedAt}\n`);

  // Auth — usa _auth_users si existe, sino extrae emails de la colección "usuarios"
  let authUsers = _auth_users;
  if (!authUsers || authUsers.length === 0) {
    // Buscar en system_users (fuente principal) o empleados como fallback
    const systemUsers = collections['system_users'] || [];
    const source = systemUsers.length > 0 ? systemUsers : (collections['empleados'] || []);
    authUsers = source
      .filter(u => u.email)
      .map(u => ({
        uid:         u._id,
        email:       u.email,
        displayName: u.nombre || u.displayName || u.name || null,
        customClaims: u.role ? { role: u.role } : null,
        disabled:    false,
      }));
    const colName = systemUsers.length > 0 ? 'system_users' : 'empleados';
    if (authUsers.length > 0) {
      console.log(`Auth — usando ${authUsers.length} emails de "${colName}" (password: ${DEFAULT_PASSWORD}):`);
    }
  } else {
    console.log(`Auth — creando ${authUsers.length} usuarios (password: ${DEFAULT_PASSWORD}):`);
  }

  // Limpiar Auth antes de importar para evitar conflictos de UID/email
  console.log('\nLimpiando Auth del emulador:');
  await clearAuth();

  await seedAuth(authUsers);

  // Firestore
  console.log(`\nFirestore — sembrando colecciones:`);
  const total = await seedFirestore(collections);

  console.log(`\n✔ Listo — ${total} documentos en ${Object.keys(collections).length} colecciones`);
  console.log(`  Usuarios: http://127.0.0.1:4000/auth`);
  console.log(`  Datos:    http://127.0.0.1:4000/firestore`);

  // Siempre garantizar que el admin local tenga SUPERADMIN en el emulador
  await seedAdminUser();
  console.log();
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

seed().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
