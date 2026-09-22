/**
 * Elimina un SLA por id (+ turnos/ausencias/novedades del rango).
 * Uso: node scripts/delete-sla-by-id.mjs JY4N0LEepjoc3zkxRSKM bacarsa
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const slaId = process.argv[2];
const empresaId = process.argv[3] || 'bacarsa';

if (!slaId) {
  console.error('Uso: node scripts/delete-sla-by-id.mjs <slaId> [empresaId]');
  process.exit(1);
}

if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

function toYmd(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim().slice(0, 10);
  if (value.toDate) return value.toDate().toISOString().slice(0, 10);
  if (value.seconds != null) return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  return String(value).trim().slice(0, 10);
}

async function deleteInBatches(col, ids) {
  let n = 0;
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + 400)) {
      batch.delete(db.collection(col).doc(id));
      n++;
    }
    await batch.commit();
  }
  return n;
}

async function main() {
  const ref = db.collection('servicios_sla').doc(slaId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`SLA no encontrado: ${slaId}`);
    process.exit(1);
  }

  const sla = snap.data();
  const docEmpresa = String(sla.empresaId ?? '').trim();
  if (docEmpresa && docEmpresa !== empresaId) {
    console.error(`Empresa distinta: doc=${docEmpresa} esperado=${empresaId}`);
    process.exit(1);
  }

  const startDate = toYmd(sla.startDate);
  const endDate = toYmd(sla.endDate);
  const objectiveId = String(sla.objectiveId ?? '').trim();
  const clientId = String(sla.clientId ?? '').trim();

  console.log('Eliminando SLA:', {
    id: slaId,
    clientName: sla.clientName,
    objectiveName: sla.objectiveName,
    startDate,
    endDate,
    objectiveId,
  });

  const turnoIds = new Set();
  if (startDate && endDate) {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const rangeStart = Timestamp.fromDate(new Date(sy, sm - 1, sd, 0, 0, 0));
    const rangeEnd = Timestamp.fromDate(new Date(ey, em - 1, ed, 23, 59, 59));

    const queries = [];
    if (objectiveId) {
      queries.push(
        db.collection('turnos')
          .where('objectiveId', '==', objectiveId)
          .where('startTime', '>=', rangeStart)
          .where('startTime', '<=', rangeEnd)
          .get(),
      );
    }
    if (clientId) {
      queries.push(
        db.collection('turnos')
          .where('clientId', '==', clientId)
          .where('startTime', '>=', rangeStart)
          .where('startTime', '<=', rangeEnd)
          .get(),
      );
    }

    const snaps = await Promise.all(queries);
    for (const s of snaps) {
      for (const d of s.docs) {
        const tEmp = String(d.data().empresaId ?? '').trim();
        if (tEmp && tEmp !== empresaId) continue;
        const tOid = String(d.data().objectiveId ?? '').trim();
        if (objectiveId && tOid !== objectiveId) continue;
        turnoIds.add(d.id);
      }
    }
  }

  const shiftList = [...turnoIds];
  const ausIds = [];
  const novIds = [];
  for (let i = 0; i < shiftList.length; i += 30) {
    const chunk = shiftList.slice(i, i + 30);
    if (!chunk.length) continue;
    const [ausSnap, novSnap] = await Promise.all([
      db.collection('ausencias').where('shiftId', 'in', chunk).get(),
      db.collection('novedades').where('shiftId', 'in', chunk).get(),
    ]);
    ausSnap.docs.forEach((d) => ausIds.push(d.id));
    novSnap.docs.forEach((d) => novIds.push(d.id));
  }

  const deletedTurnos = await deleteInBatches('turnos', shiftList);
  const deletedAus = await deleteInBatches('ausencias', ausIds);
  const deletedNov = await deleteInBatches('novedades', novIds);
  await ref.delete();

  console.log('OK:', {
    deletedTurnos,
    deletedAusencias: deletedAus,
    deletedNovedades: deletedNov,
    deletedSla: slaId,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
