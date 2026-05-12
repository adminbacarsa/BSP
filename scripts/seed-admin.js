/**
 * Bootstrap mínimo del emulador: crea superadmin + colecciones base.
 * Uso: node scripts/seed-admin.js
 * Requiere emuladores corriendo (npm run emulators).
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db = getFirestore();
const auth = getAuth();

const EMAIL    = 'admin@bacarsa.com.ar';
const PASSWORD = 'admin1234';

async function run() {
  console.log('\n🌱 Seed emulador — superadmin\n');

  // Auth: borrar siempre si existe (garantiza contraseña y claims frescos)
  try {
    const existing = await auth.getUserByEmail(EMAIL);
    await auth.deleteUser(existing.uid);
    console.log(`  Auth: usuario previo eliminado (uid=${existing.uid})`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') console.warn(`  WARN: ${e.message}`);
  }

  const u = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: 'Admin' });
  const uid = u.uid;
  await auth.setCustomUserClaims(uid, { role: 'SUPERADMIN' });
  console.log(`✓ Auth: creado uid=${uid} con customClaims { role: SUPERADMIN }`);

  // system_users — set sin merge para estado limpio
  await db.collection('system_users').doc(uid).set({
    email: EMAIL, role: 'SUPERADMIN', empresaId: 'bacarsa', nombre: 'Admin',
  });
  console.log(`✓ system_users/${uid} → SUPERADMIN`);

  // roles/SUPERADMIN
  const modules = ['DASHBOARD','OPERATIONS','PLANNING','PLANNING_AI','RRHH','CLIENTS','SERVICES','REPORTS','ANALYSIS','CONFIG'];
  const perms = {};
  modules.forEach(m => perms[m] = ['read','create','update','delete']);
  await db.collection('roles').doc('SUPERADMIN').set({ name: 'Superadmin', permissions: perms }, { merge: true });
  console.log(`✓ roles/SUPERADMIN`);

  // empresa base
  await db.collection('empresas').doc('bacarsa').set({
    name: 'Bacarsa', migracionCompleta: true,
  }, { merge: true });
  console.log(`✓ empresas/bacarsa`);

  console.log(`\n✅ Listo. Ingresá con:`);
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   URL:      http://localhost:3000\n`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
