/**
 * Datos sintéticos para el padrón. No usa nombres reales.
 * FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST tienen que estar puestos.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || 'demo-padron';
initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

function cuil(base10) {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = [...base10].reduce((a, d, i) => a + Number(d) * w[i], 0);
  const r = sum % 11;
  const dig = r === 0 ? 0 : r === 1 ? 9 : 11 - r;
  return `${base10}${dig}`;
}

const EMPRESA = 'bacarsa';
const CLIENT = 'cli_padron';
const OBJECTIVE = 'obj_padron';

const EMAIL = 'admin@bacarsa.com.ar';
const PASSWORD = 'admin1234';

async function user() {
  try {
    const prev = await auth.getUserByEmail(EMAIL);
    await auth.deleteUser(prev.uid);
  } catch { /* no estaba */ }
  const u = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: 'Admin' });
  await auth.setCustomUserClaims(u.uid, { role: 'SUPERADMIN' });
  await db.collection('system_users').doc(u.uid).set({
    email: EMAIL, role: 'SUPERADMIN', empresaId: EMPRESA, nombre: 'Admin', allEmpresas: true,
  });
  const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'CONFIG'];
  const permissions = {};
  for (const m of modules) permissions[m] = ['read', 'create', 'update', 'delete', 'publish', 'correct'];
  await db.collection('roles').doc('SUPERADMIN').set({ name: 'Superadmin', permissions });
  await db.collection('empresas').doc(EMPRESA).set({ name: 'Bacarsa', migracionCompleta: true });
}

async function run() {
  await user();
  await db.collection('clients').doc(CLIENT).set({
    empresaId: EMPRESA, name: 'Cliente Prueba', status: 'ACTIVE',
    objetivos: [{ id: OBJECTIVE, nombre: 'Objetivo Prueba', name: 'Objetivo Prueba' }],
  });
  await db.collection('servicios_sla').doc('sla_padron').set({
    empresaId: EMPRESA,
    clientId: CLIENT,
    clientName: 'Cliente Prueba',
    objectiveId: OBJECTIVE,
    objectiveName: 'Objetivo Prueba',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    status: 'active',
    positions: [{
      id: 'p1',
      name: 'Puesto 1',
      positionName: 'Puesto 1',
      quantity: 1,
      coverageType: 'custom',
      status: 'ACTIVE',
      shifts: [
        { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 },
        { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8 },
        { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
      ],
      allowedShiftTypes: [
        { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
        { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 },
        { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 1 },
      ],
    }],
  });

  const gente = [
    { id: 'emp_perez', legajo: '1001', apellido: 'PEREZ', nombre: 'JUAN', mail: 'juan.viejo@prueba.test', dni: '30111222', cuil: cuil('2030111222'), activo: true, objetivo: OBJECTIVE },
    { id: 'emp_sosa', legajo: '1002', apellido: 'SOSA', nombre: 'LUIS', mail: 'luis@prueba.test', dni: '30999888', cuil: cuil('2030999888'), activo: true, objetivo: OBJECTIVE },
  ];
  for (const g of gente) {
    await db.collection('empleados').doc(g.id).set({
      empresaId: EMPRESA,
      fileNumber: g.legajo,
      lastName: g.apellido,
      firstName: g.nombre,
      name: `${g.apellido}, ${g.nombre}`,
      email: g.mail,
      phone: '1100000000',
      address: 'Calle Falsa 123',
      dni: g.dni,
      cuil: g.cuil,
      category: 'Vigilador',
      status: g.activo ? 'activo' : 'inactivo',
      startDate: '2020-01-01',
      preferredObjectiveId: g.objetivo,
    });
  }
  console.log(JSON.stringify({
    empresaId: EMPRESA,
    clientId: CLIENT,
    objectiveId: OBJECTIVE,
    cuilPerez: cuil('2030111222'),
    cuilAcosta: cuil('2040111222'),
    cuilDiaz: cuil('2740111222'),
  }));
}

run().catch((e) => { console.error(e); process.exit(1); });
