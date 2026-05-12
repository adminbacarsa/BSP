/**
 * Crea un usuario de prueba en el portal empleado.
 * Uso: node scripts/seed-empleado.js
 * Requiere emuladores corriendo (npm run emulators).
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore }           = require('firebase-admin/firestore');
const { getAuth }                = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db   = getFirestore();
const auth = getAuth();

const EMAIL    = 'guardia@bacarsa.com.ar';
const PASSWORD = 'guardia1234';

async function run() {
  console.log('\n🌱 Seed emulador — usuario empleado\n');

  // Auth: recrear siempre limpio
  try {
    const existing = await auth.getUserByEmail(EMAIL);
    await auth.deleteUser(existing.uid);
    console.log(`  Auth: usuario previo eliminado (uid=${existing.uid})`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') console.warn(`  WARN: ${e.message}`);
  }

  const u = await auth.createUser({
    email:       EMAIL,
    password:    PASSWORD,
    displayName: 'Juan Pérez',
  });
  const uid = u.uid;
  console.log(`✓ Auth: creado uid=${uid}`);

  // Documento en 'empleados'
  const empData = {
    uid,
    email:      EMAIL,
    firstName:  'Juan',
    lastName:   'Pérez',
    dni:        '32.456.789',
    cuil:       '20-32456789-4',
    fileNumber: 'LEG-0042',
    category:   'Vigilador',
    phone:      '1123456789',
    status:     'active',
    startDate:  '2023-03-01',
    laborAgreement: 'SUVICO',
    empresaId:  'bacarsa',
    portalInvite: { sent: true },
  };

  // Buscar si ya existe un doc con ese uid para reutilizar el mismo ID
  const existing = await db.collection('empleados')
    .where('email', '==', EMAIL).limit(1).get();

  let empDocId;
  if (!existing.empty) {
    empDocId = existing.docs[0].id;
    await db.collection('empleados').doc(empDocId).set(empData, { merge: true });
    console.log(`✓ empleados/${empDocId} → actualizado`);
  } else {
    const ref = await db.collection('empleados').add(empData);
    empDocId = ref.id;
    console.log(`✓ empleados/${empDocId} → creado`);
  }

  console.log(`\n✅ Usuario empleado listo:`);
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   Nombre:   Juan Pérez`);
  console.log(`   Legajo:   LEG-0042`);
  console.log(`   URL:      http://localhost:3000/empleado/dashboard\n`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
