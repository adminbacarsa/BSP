/**
 * Seed empresa sandbox de capacitación en PRODUCCIÓN.
 * Uso: node scripts/seed-capacitacion-prod.js
 *
 * Requiere autenticación con gcloud o variable de entorno GOOGLE_APPLICATION_CREDENTIALS.
 * Alternativa rápida (si tenés firebase-tools logueado):
 *   npx firebase-admin-node scripts/seed-capacitacion-prod.js
 *
 * En la práctica, la forma más simple es correrlo con:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\a\serviceAccount.json"
 *   node scripts/seed-capacitacion-prod.js
 */

const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
const { getFirestore }  = require('firebase-admin/firestore');
const { getAuth }       = require('firebase-admin/auth');

// Sin emuladores — conecta directo a producción comtroldata via ADC (gcloud auth)
if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
}

const db   = getFirestore();
const auth = getAuth();

const EMPRESA_ID  = 'capacitacion';
const ADMIN_EMAIL = 'admin@capacitacion.cosp';
const ADMIN_PASS  = 'cap1234';

async function ensureAuthUser(email, password, claims, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    console.log(`  ℹ Auth: usuario ${email} ya existe (uid ${existing.uid}) — actualizando claims`);
    await auth.setCustomUserClaims(existing.uid, claims);
    return existing.uid;
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
  const u = await auth.createUser({ email, password, displayName });
  await auth.setCustomUserClaims(u.uid, claims);
  return u.uid;
}

async function run() {
  console.log('\n🎓 Seed empresa capacitacion → PRODUCCIÓN (comtroldata)\n');

  // ── Empresa ──────────────────────────────────────────────────────────────────
  await db.collection('empresas').doc(EMPRESA_ID).set({
    name: 'Capacitación COSP',
    active: true,
    migracionCompleta: true,
    isTrainingEmpresa: true,
    centroControlEnabled: false,
  }, { merge: true });
  console.log(`✓ empresas/${EMPRESA_ID}  (isTrainingEmpresa=true)`);

  // ── Rol admin capacitación ────────────────────────────────────────────────────
  const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'ANALYSIS', 'CONFIG'];
  const perms = {};
  modules.forEach(m => { perms[m] = ['read', 'create', 'update', 'delete']; });
  perms['PLANNING'] = ['read', 'create', 'update', 'delete', 'publish', 'correct'];

  await db.collection('roles').doc('ADMIN_CAPACITACION').set({
    name: 'Admin Capacitación',
    permissions: perms,
    empresaId: EMPRESA_ID,
  }, { merge: true });
  console.log('✓ roles/ADMIN_CAPACITACION');

  // ── Usuario admin ─────────────────────────────────────────────────────────────
  const adminUid = await ensureAuthUser(ADMIN_EMAIL, ADMIN_PASS, { role: 'ADMIN_CAPACITACION' }, 'Admin Capacitación');
  await db.collection('system_users').doc(adminUid).set({
    email: ADMIN_EMAIL,
    role: 'ADMIN_CAPACITACION',
    empresaId: EMPRESA_ID,
    nombre: 'Admin Capacitación',
  }, { merge: true });
  console.log(`✓ system_users/${adminUid} → ${ADMIN_EMAIL}`);

  // ── Cliente y objetivo ficticios ──────────────────────────────────────────────
  const CLIENT_ID    = 'client_cap_fabrica';
  const OBJECTIVE_ID = 'obj_cap_planta_norte';

  await db.collection('clients').doc(CLIENT_ID).set({
    name: 'Fábrica Demo SRL',
    empresaId: EMPRESA_ID,
    active: true,
    address: 'Av. Capacitación 1000, Buenos Aires',
    objetivos: [{
      id: OBJECTIVE_ID,
      name: 'Planta Norte',
      address: 'Acceso Norte, Fábrica Demo SRL',
      lat: -34.61,
      lng: -58.44,
      active: true,
    }],
  });
  console.log(`✓ clients/${CLIENT_ID}  →  objetivo ${OBJECTIVE_ID}`);

  // ── SLA ───────────────────────────────────────────────────────────────────────
  await db.collection('servicios_sla').doc('sla_cap_fabrica').set({
    clientId: CLIENT_ID,
    clientName: 'Fábrica Demo SRL',
    objectiveId: OBJECTIVE_ID,
    objectiveName: 'Planta Norte',
    empresaId: EMPRESA_ID,
    status: 'active',
    positions: [
      {
        id: 'puesto_acceso',
        name: 'Acceso Principal',
        qty: 1,
        coverageType: 'custom',
        shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }],
        activeDays: [1, 2, 3, 4, 5, 6, 0],
      },
      {
        id: 'puesto_perimetro',
        name: 'Perímetro',
        qty: 1,
        coverageType: 'custom',
        shifts: [{ code: 'N', hours: 8 }],
        activeDays: [1, 2, 3, 4, 5, 6, 0],
      },
    ],
  });
  console.log('✓ servicios_sla/sla_cap_fabrica');

  // ── Empleados ficticios ───────────────────────────────────────────────────────
  const guardias = [
    { id: 'emp_cap_001', firstName: 'Laura',   lastName: 'Fernández', dni: '28.100.001', file: 'CAP-001' },
    { id: 'emp_cap_002', firstName: 'Roberto',  lastName: 'Gómez',    dni: '30.100.002', file: 'CAP-002' },
    { id: 'emp_cap_003', firstName: 'Natalia',  lastName: 'Sosa',     dni: '32.100.003', file: 'CAP-003' },
    { id: 'emp_cap_004', firstName: 'Marcelo',  lastName: 'Torres',   dni: '29.100.004', file: 'CAP-004' },
  ];

  for (const g of guardias) {
    await db.collection('empleados').doc(g.id).set({
      firstName: g.firstName,
      lastName: g.lastName,
      name: `${g.firstName} ${g.lastName}`,
      dni: g.dni,
      fileNumber: g.file,
      status: 'active',
      empresaId: EMPRESA_ID,
      preferredObjectiveId: OBJECTIVE_ID,
    }, { merge: true });
    console.log(`✓ empleados/${g.id}  ${g.firstName} ${g.lastName}`);
  }

  console.log('\n✅ Empresa capacitacion lista en PRODUCCIÓN:');
  console.log(`   URL:      https://comtroldata.web.app`);
  console.log(`   Admin:    ${ADMIN_EMAIL} / ${ADMIN_PASS}`);
  console.log(`   Empresa:  ${EMPRESA_ID}  (sandbox, isTrainingEmpresa=true)`);
  console.log(`   Cliente:  Fábrica Demo SRL → Planta Norte`);
  console.log(`   Guardias: 4 ficticios (emp_cap_001..004)\n`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
