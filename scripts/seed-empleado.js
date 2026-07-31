/**
 * Crea un usuario de prueba en el portal empleado.
 * Uso: node scripts/seed-empleado.js
 * Requiere emuladores corriendo (npm run emulators).
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth }                = require('firebase-admin/auth');

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });

const db   = getFirestore();
const auth = getAuth();

const EMAIL    = 'guardia@bacarsa.com.ar';
const PASSWORD = 'guardia1234';
const EMPRESA_ID = 'bacarsa';
const LAB_CLIENT_ID = 'client_lab_guardia';
const LAB_OBJECTIVE_ID = 'obj_lab_guardia';

async function seedTurnoHoyGuardia(empDocId) {
  const now = new Date();
  // Ventana fichada app: desde 15 min antes del inicio hasta ~5 min después (getCheckInTiming).
  const minutesUntilStart = 12;
  const start = new Date(now.getTime() + minutesUntilStart * 60 * 1000);
  const end = new Date(start.getTime() + 8 * 60 * 60 * 1000);

  await db.collection('clients').doc(LAB_CLIENT_ID).set({
    name: 'Cliente Lab Portal',
    empresaId: EMPRESA_ID,
    active: true,
    objetivos: [{
      id: LAB_OBJECTIVE_ID,
      name: 'Planta Bacar Lab',
      active: true,
      lat: -31.42,
      lng: -64.18,
      allowRemoteCheckIn: true,
    }],
  }, { merge: true });

  const shiftDocId = `seed_shift_${empDocId}_hoy`;
  await db.collection('turnos').doc(shiftDocId).set({
    employeeId: empDocId,
    employeeName: 'Pérez, Juan',
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

  console.log(
    `✓ turnos/${shiftDocId} → turno demo (inicio en ~${minutesUntilStart} min, botón fichada GPS activo en lab)`,
  );
}

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
  await auth.setCustomUserClaims(uid, { role: 'employee', type: 'employee' });
  console.log(`✓ Auth: creado uid=${uid} con claims employee`);

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
    empresaId:  EMPRESA_ID,
    portalInvite: { sent: true },
    bypassDeviceCheck: true,
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

  await seedTurnoHoyGuardia(empDocId);

  console.log(`\n✅ Usuario empleado listo:`);
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}`);
  console.log(`   Nombre:   Juan Pérez`);
  console.log(`   Legajo:   LEG-0042`);
  console.log(`   Turno:    Planta Bacar Lab (fichada GPS en ventana tras seed; allowRemoteCheckIn en lab)`);
  console.log(`   URL:      http://localhost:3000/empleado/dashboard\n`);
  process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
