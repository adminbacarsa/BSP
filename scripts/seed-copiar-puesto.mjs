/**
 * Agrega Puesto 2 y turnos sintéticos al emulador del padrón.
 * No borra lo que ya está. FIRESTORE_EMULATOR_HOST y AUTH tienen que apuntar al emulador.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'comtroldata';
initializeApp({ projectId });
const db = getFirestore();

const EMPRESA = 'bacarsa';
const CLIENT = 'cli_padron';
const OBJECTIVE = 'obj_padron';

function dia(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function rango(y, m, d, inicio, fin) {
  const [sh, sm] = inicio.split(':').map(Number);
  const [eh, em] = fin.split(':').map(Number);
  const start = new Date(y, m - 1, d, sh, sm, 0);
  const end = new Date(y, m - 1, d, eh, em, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { startTime: Timestamp.fromDate(start), endTime: Timestamp.fromDate(end) };
}

async function turnos(empId, nombre, puesto, inicio, fin, hours, meses) {
  for (const [y, m] of meses) {
    for (let d = 1; d <= 6; d++) {
      const id = `turno_copia_${empId}_${dia(y, m, d)}`;
      const horas = rango(y, m, d, inicio, fin);
      await db.collection('turnos').doc(id).set({
        empresaId: EMPRESA,
        employeeId: empId,
        employeeName: nombre,
        clientId: CLIENT,
        objectiveId: OBJECTIVE,
        code: 'M',
        type: 'Mañana',
        name: 'Mañana',
        positionName: puesto,
        ...horas,
        scheduleDate: dia(y, m, d),
        hours,
        isFranco: false,
        draft: false,
      });
    }
  }
}

async function run() {
  const sla = await db.collection('servicios_sla').doc('sla_padron').get();
  if (!sla.exists) {
    console.error('No está sla_padron en', projectId, '(¿el emulador es otro proyecto?)');
    process.exit(1);
  }
  const puesto = (code, name, inicio, fin, hours) => ({
    code, name, startTime: inicio, endTime: fin, hours, quantity: 1,
  });
  const positions = [
    {
      id: 'p1', name: 'Puesto 1', positionName: 'Puesto 1', quantity: 1,
      coverageType: 'custom', status: 'ACTIVE',
      shifts: [puesto('M', 'Mañana', '07:00', '15:00', 8), puesto('T', 'Tarde', '15:00', '23:00', 8), puesto('N', 'Noche', '23:00', '07:00', 8)],
      allowedShiftTypes: [puesto('M', 'Mañana', '07:00', '15:00', 8), puesto('T', 'Tarde', '15:00', '23:00', 8), puesto('N', 'Noche', '23:00', '07:00', 8)],
    },
    {
      id: 'p2', name: 'Puesto 2', positionName: 'Puesto 2', quantity: 1,
      coverageType: 'custom', status: 'ACTIVE',
      shifts: [puesto('M', 'Mañana', '06:00', '14:00', 8), puesto('T', 'Tarde', '14:00', '22:00', 8)],
      allowedShiftTypes: [puesto('M', 'Mañana', '06:00', '14:00', 8), puesto('T', 'Tarde', '14:00', '22:00', 8)],
    },
  ];
  await db.collection('servicios_sla').doc('sla_padron').set({ positions }, { merge: true });

  await db.collection('empleados').doc('emp_perez').set({
    planificacionDotacion: { [OBJECTIVE]: { positionName: 'Puesto 2' } },
  }, { merge: true });
  await db.collection('empleados').doc('emp_sosa').set({
    planificacionDotacion: { [OBJECTIVE]: { positionName: 'Puesto 1' } },
  }, { merge: true });
  await db.collection('empleados').doc('emp_regalo').set({
    empresaId: EMPRESA,
    fileNumber: '1003',
    lastName: 'REGALO',
    firstName: 'MARIO',
    name: 'REGALO, MARIO',
    email: 'mario.regalo@prueba.test',
    dni: '30111000',
    cuil: '20301110009',
    category: 'Vigilador',
    status: 'activo',
    startDate: '2020-01-01',
    preferredObjectiveId: OBJECTIVE,
    planificacionDotacion: { [OBJECTIVE]: { positionName: 'Puesto 1' } },
  }, { merge: true });

  const meses = [[2026, 10], [2026, 9]];
  await turnos('emp_perez', 'PEREZ, JUAN', 'Puesto 2', '06:00', '14:00', 8, meses);
  await turnos('emp_regalo', 'REGALO, MARIO', 'Puesto 1', '07:00', '15:00', 8, meses);
  console.log('listo', projectId);
}

run().catch((e) => { console.error(e); process.exit(1); });
