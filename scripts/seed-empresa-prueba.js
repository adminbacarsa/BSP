/**
 * Segunda empresa de lab para probar aislamiento multi-tenant.
 * Uso: node scripts/seed-empresa-prueba.js  (tras seed-admin.js)
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db = getFirestore();
const auth = getAuth();

const EMPRESA_ID = 'prueba_sa';
const ADMIN_EMAIL = 'admin@prueba.com';
const ADMIN_PASSWORD = 'prueba1234';
const GUARDIA_EMAIL = 'guardia@prueba.com';
const GUARDIA_PASSWORD = 'prueba1234';

const CLIENT_ID = 'client_prueba_sa';
const OBJECTIVE_ID = 'obj_prueba_centro';

async function ensureAuthUser(email, password, claims, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.deleteUser(existing.uid);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
  const u = await auth.createUser({ email, password, displayName });
  await auth.setCustomUserClaims(u.uid, claims);
  return u.uid;
}

async function run() {
  console.log('\n🌱 Seed empresa prueba_sa\n');

  await db.collection('empresas').doc(EMPRESA_ID).set({
    name: 'Prueba SA',
    active: true,
    migracionCompleta: true,
  }, { merge: true });
  console.log(`✓ empresas/${EMPRESA_ID}`);

  const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'CONFIG'];
  const perms = {};
  modules.forEach((m) => { perms[m] = ['read', 'create', 'update', 'delete']; });

  await db.collection('roles').doc('ADMIN_PRUEBA').set({
    name: 'Admin Prueba SA',
    permissions: perms,
    empresaId: EMPRESA_ID,
  }, { merge: true });
  console.log('✓ roles/ADMIN_PRUEBA (tenant prueba_sa)');

  const adminUid = await ensureAuthUser(ADMIN_EMAIL, ADMIN_PASSWORD, { role: 'ADMIN_PRUEBA' }, 'Admin Prueba');
  await db.collection('system_users').doc(adminUid).set({
    email: ADMIN_EMAIL,
    role: 'ADMIN_PRUEBA',
    empresaId: EMPRESA_ID,
    nombre: 'Admin Prueba',
  });
  console.log(`✓ system_users/${adminUid} → admin@prueba.com`);

  await db.collection('clients').doc(CLIENT_ID).set({
    name: 'Cliente Prueba SA',
    empresaId: EMPRESA_ID,
    objetivos: [{
      id: OBJECTIVE_ID,
      name: 'Centro Logístico Prueba',
      address: 'Av. Test 100, Córdoba',
      lat: -31.41,
      lng: -64.19,
      active: true,
    }],
  });
  console.log(`✓ clients/${CLIENT_ID}`);

  await db.collection('servicios_sla').doc('sla_prueba_sa').set({
    clientId: CLIENT_ID,
    clientName: 'Cliente Prueba SA',
    objectiveId: OBJECTIVE_ID,
    objectiveName: 'Centro Logístico Prueba',
    empresaId: EMPRESA_ID,
    status: 'active',
    positions: [{
      id: 'puesto_1',
      name: 'Acceso Principal',
      qty: 1,
      coverageType: 'custom',
      shifts: [{ code: 'M', hours: 8 }],
      activeDays: [1, 2, 3, 4, 5, 6, 0],
    }],
  });
  console.log('✓ servicios_sla/sla_prueba_sa');

  const guardiaUid = await ensureAuthUser(GUARDIA_EMAIL, GUARDIA_PASSWORD, { role: 'employee', type: 'employee' }, 'Carlos Prueba');
  await db.collection('empleados').doc('emp_prueba_001').set({
    uid: guardiaUid,
    email: GUARDIA_EMAIL,
    firstName: 'Carlos',
    lastName: 'Prueba',
    name: 'Carlos Prueba',
    dni: '30.111.222',
    fileNumber: 'LEG-P001',
    status: 'active',
    empresaId: EMPRESA_ID,
    preferredObjectiveId: OBJECTIVE_ID,
  });
  console.log('✓ empleados/emp_prueba_001');

  await db.collection('feriados').add({
    date: '2026-06-20',
    name: 'Día Prueba Empresa',
    type: 'Optativo',
    empresaId: EMPRESA_ID,
  });
  console.log('✓ feriado tenant prueba_sa');

  console.log('\n✅ Empresa prueba_sa lista:');
  console.log(`   Admin:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`   Guardia: ${GUARDIA_EMAIL} / ${GUARDIA_PASSWORD}`);
  console.log(`   Cliente/objetivo: ${CLIENT_ID} / ${OBJECTIVE_ID}\n`);
  process.exit(0);
}

run().catch((e) => { console.error('❌', e.message); process.exit(1); });
