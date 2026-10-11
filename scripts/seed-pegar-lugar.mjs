/**
 * ACOSTA trabaja en Cliente Ruta · Peaje Norte (turnos de octubre).
 * No borra el objetivo del padrón. Emulador 8391, proyecto comtroldata.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'comtroldata';
initializeApp({ projectId });
const db = getFirestore();

const EMPRESA = 'bacarsa';
const RUTA = 'cli_ruta';
const OBJ = 'obj_ruta';

async function run() {
  await db.collection('clients').doc(RUTA).set({
    empresaId: EMPRESA,
    name: 'Cliente Ruta',
    status: 'ACTIVE',
    objetivos: [{ id: OBJ, nombre: 'Peaje Norte', name: 'Peaje Norte' }],
  }, { merge: true });

  const snap = await db.collection('empleados').where('empresaId', '==', EMPRESA).get();
  const mismos = snap.docs.filter((d) => String(d.data().fileNumber || '') === '2001' && String(d.data().status || '').toLowerCase() !== 'inactivo');
  const id = mismos[0]?.id || 'emp_acosta';
  for (const extra of mismos.slice(1)) await extra.ref.update({ status: 'inactivo' });
  await db.collection('empleados').doc(id).set({
    empresaId: EMPRESA,
    fileNumber: '2001',
    lastName: 'ACOSTA',
    firstName: 'JULIO',
    name: 'ACOSTA, JULIO',
    email: 'julio@prueba.test',
    phone: '1100001111',
    address: 'Calle Falsa 100',
    dni: '40111222',
    cuil: '20401112228',
    category: 'Vigilador',
    status: 'activo',
    startDate: '2024-03-01',
    preferredClientId: RUTA,
    preferredObjectiveId: OBJ,
  }, { merge: true });

  for (const ymd of ['2026-10-01', '2026-10-02', '2026-10-03']) {
    const start = Timestamp.fromDate(new Date(`${ymd}T07:00:00-03:00`));
    const end = Timestamp.fromDate(new Date(`${ymd}T15:00:00-03:00`));
    await db.collection('turnos').doc(`${id}_${ymd}`).set({
      empresaId: EMPRESA,
      clientId: RUTA,
      objectiveId: OBJ,
      objectiveName: 'Peaje Norte',
      positionName: 'Puesto 1',
      employeeId: id,
      employeeName: 'ACOSTA, JULIO',
      code: 'M',
      name: 'Mañana',
      hours: 8,
      startTime: start,
      endTime: end,
      draft: false,
      isAbsent: false,
      isFranco: false,
    });
  }
  console.log('listo', id, projectId);
}

run().catch((e) => { console.error(e); process.exit(1); });
