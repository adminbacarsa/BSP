/**
 * seed-usuarios.js
 * Crea usuarios de sistema y empleados de prueba en el emulador.
 * Todos con contraseña: test1234
 *
 * Uso: node scripts/seed-usuarios.js
 * Requiere emulador corriendo en localhost:8080 (Firestore) y localhost:9099 (Auth)
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db   = getFirestore();
const auth = getAuth();
const now  = Timestamp.now();
const PWD  = 'test1234';
const EMP  = 'bacarsa'; // empresaId por defecto

// ── Usuarios de sistema ───────────────────────────────────────────────
const SYSTEM_USERS = [
  { email: 'superadmin@bacarsa.com', firstName: 'Super',    lastName: 'Admin',    role: 'superadmin' },
  { email: 'admin@bacarsa.com',      firstName: 'Admin',    lastName: 'Sistema',  role: 'admin' },
  { email: 'operador@bacarsa.com',   firstName: 'Operador', lastName: 'Prueba',   role: 'Operator' },
  { email: 'scheduler@bacarsa.com',  firstName: 'Planif',   lastName: 'Prueba',   role: 'Scheduler' },
  { email: 'admin@bacarsa.com.ar',   firstName: 'Mauro',    lastName: 'Admin',    role: 'superadmin' },
];

// Centro de Córdoba Capital como referencia (-31.4167, -64.1833)
// Cada empleado tiene coordenadas ligeramente distintas para simular dispersión urbana
const EMPLEADOS = [
  { email: 'emp1@test.com',   firstName: 'Juan',      lastName: 'Pérez',       legajo: 'E001', phone: '+5493512345601', lat: -31.4120, lng: -64.1890 },
  { email: 'emp2@test.com',   firstName: 'María',     lastName: 'González',    legajo: 'E002', phone: '+5493512345602', lat: -31.4200, lng: -64.1780 },
  { email: 'emp3@test.com',   firstName: 'Carlos',    lastName: 'López',       legajo: 'E003', phone: '+5493512345603', lat: -31.4050, lng: -64.1950 },
  { email: 'emp4@test.com',   firstName: 'Ana',       lastName: 'Martínez',    legajo: 'E004', phone: '+5493512345604', lat: -31.4300, lng: -64.1700 },
  { email: 'emp5@test.com',   firstName: 'Pedro',     lastName: 'Rodríguez',   legajo: 'E005', phone: '+5493512345605', lat: -31.4080, lng: -64.1820 },
  { email: 'emp6@test.com',   firstName: 'Laura',     lastName: 'Fernández',   legajo: 'E006', phone: '+5493512345606', lat: -31.4180, lng: -64.2000 },
  { email: 'emp7@test.com',   firstName: 'Diego',     lastName: 'Gómez',       legajo: 'E007', phone: '+5493512345607', lat: -31.4250, lng: -64.1860 },
  { email: 'emp8@test.com',   firstName: 'Silvia',    lastName: 'Díaz',        legajo: 'E008', phone: '+5493512345608', lat: -31.4010, lng: -64.1750 },
  { email: 'emp9@test.com',   firstName: 'Roberto',   lastName: 'Torres',      legajo: 'E009', phone: '+5493512345609', lat: -31.4350, lng: -64.1900 },
  { email: 'emp10@test.com',  firstName: 'Patricia',  lastName: 'Vargas',      legajo: 'E010', phone: '+5493512345610', lat: -31.4140, lng: -64.1680 },
  { email: 'emp11@test.com',  firstName: 'Marcelo',   lastName: 'Romero',      legajo: 'E011', phone: '+5493512345611', lat: -31.4090, lng: -64.2050 },
  { email: 'emp12@test.com',  firstName: 'Claudia',   lastName: 'Suárez',      legajo: 'E012', phone: '+5493512345612', lat: -31.4220, lng: -64.1730 },
  { email: 'emp13@test.com',  firstName: 'Gustavo',   lastName: 'Castro',      legajo: 'E013', phone: '+5493512345613', lat: -31.4160, lng: -64.1970 },
  { email: 'emp14@test.com',  firstName: 'Verónica',  lastName: 'Morales',     legajo: 'E014', phone: '+5493512345614', lat: -31.4030, lng: -64.1840 },
  { email: 'emp15@test.com',  firstName: 'Alejandro', lastName: 'Herrera',     legajo: 'E015', phone: '+5493512345615', lat: -31.4280, lng: -64.1770 },
];

async function createUser(email, displayName, password, customClaims) {
  try {
    let existing = await auth.getUserByEmail(email).catch(() => null);
    if (existing) {
      // Actualizar displayName y claims aunque el usuario ya exista
      await auth.updateUser(existing.uid, { displayName });
      if (customClaims) await auth.setCustomUserClaims(existing.uid, customClaims);
      return existing.uid;
    }
    const u = await auth.createUser({ email, displayName, password });
    if (customClaims) await auth.setCustomUserClaims(u.uid, customClaims);
    return u.uid;
  } catch (e) {
    console.warn(`  ✗  ${email}: ${e.message}`);
    return null;
  }
}

async function seed() {
  console.log('\n━━━ Seed Usuarios Emulador ━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Contraseña para todos: ${PWD}\n`);

  // ── Sistema ──
  console.log('Sistema:');
  for (const u of SYSTEM_USERS) {
    const displayName = `${u.firstName} ${u.lastName}`;
    const uid = await createUser(u.email, displayName, PWD, { role: u.role, type: 'SYSTEM' });
    if (!uid) continue;
    await db.collection('system_users').doc(uid).set({
      uid, email: u.email, firstName: u.firstName, lastName: u.lastName,
      role: u.role, empresaId: EMP, status: 'ACTIVE', createdAt: now,
    }, { merge: true });
    console.log(`  ✓  ${u.email}  [${u.role}]`);
  }

  // ── Empleados ──
  console.log('\nEmpleados (portal):');
  for (const e of EMPLEADOS) {
    const displayName = `${e.lastName} ${e.firstName}`;
    const uid = await createUser(e.email, displayName, PWD, { role: 'employee', type: 'EMPLOYEE' });
    if (!uid) continue;
    await db.collection('empleados').doc(uid).set({
      uid, email: e.email, firstName: e.firstName, lastName: e.lastName,
      fullName: `${e.lastName} ${e.firstName}`,
      legajo: e.legajo,
      phone: e.phone,
      celular: e.phone,
      lat: e.lat,
      lng: e.lng,
      empresaId: EMP,
      status: 'ACTIVE',
      role: 'employee',
      portalAccess: true,
      createdAt: now,
    }, { merge: true });
    console.log(`  ✓  ${e.email}  [${e.legajo}]  📍 (${e.lat}, ${e.lng})  📱 ${e.phone}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Total empleados: ${EMPLEADOS.length}`);
  console.log('  Auth:      http://127.0.0.1:4000/auth');
  console.log('  Firestore: http://127.0.0.1:4000/firestore\n');
}

seed().catch(e => { console.error(e.message); process.exit(1); });
