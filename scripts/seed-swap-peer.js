/**
 * Segundo guardia + turno en el mismo objetivo lab (permuntas F4-08).
 * Requiere emuladores y haber corrido seed-admin + seed-empleado (o npm run seed).
 * Uso: node scripts/seed-swap-peer.js  |  npm run seed:swap-peer
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db = getFirestore();
const auth = getAuth();

const EMAIL = 'guardia2@bacarsa.com.ar';
const PASSWORD = 'guardia1234';
const EMPRESA_ID = 'bacarsa';
const LAB_CLIENT_ID = 'client_lab_guardia';
const LAB_OBJECTIVE_ID = 'obj_lab_guardia';

async function findGuardia1EmpId() {
  const byEmail = await db.collection('empleados').where('email', '==', 'guardia@bacarsa.com.ar').limit(1).get();
  if (!byEmail.empty) return byEmail.docs[0].id;
  console.error('❌ No existe guardia@bacarsa.com.ar. Ejecutá primero: npm run seed');
  process.exit(1);
}

async function seedTurnoPeer(empDocId, employeeName) {
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);

  const shiftDocId = `seed_shift_${empDocId}_swap_peer`;
  await db.collection('turnos').doc(shiftDocId).set({
    employeeId: empDocId,
    employeeName,
    empresaId: EMPRESA_ID,
    clientId: LAB_CLIENT_ID,
    clientName: 'Cliente Lab Portal',
    objectiveId: LAB_OBJECTIVE_ID,
    objectiveName: 'Planta Bacar Lab',
    positionName: 'Puesto Principal',
    code: 'M',
    status: 'Assigned',
    startTime: Timestamp.fromDate(start),
    endTime: Timestamp.fromDate(end),
    isPresent: false,
    isCompleted: false,
    isAbsent: false,
    isFranco: false,
    createdAt: Timestamp.now(),
  }, { merge: true });

  console.log(`✓ turnos/${shiftDocId} → ${employeeName} (inicio ~mañana +1h AR, mismo objetivo lab)`);
}

async function run() {
  console.log('\n🌱 Seed emulador — segundo guardia (permuntas E2E)\n');

  await findGuardia1EmpId();

  let uid;
  try {
    const existing = await auth.getUserByEmail(EMAIL);
    uid = existing.uid;
    await auth.updateUser(uid, { password: PASSWORD, displayName: 'María García' });
    console.log(`  Auth: reutilizado uid=${uid}`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const u = await auth.createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: 'María García',
    });
    uid = u.uid;
    console.log(`✓ Auth: creado uid=${uid}`);
  }

  await auth.setCustomUserClaims(uid, { role: 'employee', type: 'employee' });

  const empData = {
    uid,
    email: EMAIL,
    firstName: 'María',
    lastName: 'García',
    dni: '28.111.222',
    cuil: '27-28111222-3',
    fileNumber: 'LEG-0043',
    category: 'Vigilador',
    phone: '1123456790',
    status: 'active',
    startDate: '2023-06-01',
    laborAgreement: 'SUVICO',
    empresaId: EMPRESA_ID,
    portalInvite: { sent: true },
    bypassDeviceCheck: true,
  };

  const existingEmp = await db.collection('empleados').where('email', '==', EMAIL).limit(1).get();
  let empDocId;
  if (!existingEmp.empty) {
    empDocId = existingEmp.docs[0].id;
    await db.collection('empleados').doc(empDocId).set(empData, { merge: true });
    console.log(`✓ empleados/${empDocId} → actualizado`);
  } else {
    const ref = await db.collection('empleados').add(empData);
    empDocId = ref.id;
    console.log(`✓ empleados/${empDocId} → creado`);
  }

  const displayName = 'García, María';
  await seedTurnoPeer(empDocId, displayName);

  console.log('\n✅ Segundo guardia listo para F4-08:');
  console.log(`   Guardia A: guardia@bacarsa.com.ar / guardia1234 (turno hoy lab)`);
  console.log(`   Guardia B: ${EMAIL} / ${PASSWORD} (turno mañana, mismo objetivo)`);
  console.log('   Supervisor: admin@bacarsa.com.ar / admin1234 → Planificación\n');
  process.exit(0);
}

run().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
