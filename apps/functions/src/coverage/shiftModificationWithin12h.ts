import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const TZ = 'America/Argentina/Cordoba';

function startMs(shift: Record<string, unknown>): number {
  const st = shift.startTime;
  if (st instanceof Timestamp) return st.toMillis();
  return 0;
}

async function isPlanningPublishedForShift(
  db: admin.firestore.Firestore,
  objectiveId: string,
  startMsVal: number,
): Promise<boolean> {
  const oid = String(objectiveId || '').trim();
  if (!oid || !startMsVal) return false;
  const d = new Date(startMsVal);
  const planKey = `${oid}_${d.getFullYear()}_${d.getMonth() + 1}`;
  const pub = await db.collection('planificacion_estados').doc(planKey).get();
  if (!pub.exists) return false;
  const publishedAt = pub.data()?.publishedAt;
  return publishedAt != null && publishedAt !== '';
}

export async function handlePublishedShiftModifiedWithin12h(
  db: admin.firestore.Firestore,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  turnoId: string,
): Promise<{ notified: boolean; orphanCoverage: boolean }> {
  if (after.draft === true) return { notified: false, orphanCoverage: false };
  const emp = String(after.employeeId || '').trim();
  if (!emp || emp === 'VACANTE') return { notified: false, orphanCoverage: false };

  const relevant = ['startTime', 'endTime', 'code', 'objectiveId', 'positionName'];
  const changed = relevant.some(
    (f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]),
  );
  if (!changed) return { notified: false, orphanCoverage: false };

  const objectiveId = String(after.objectiveId || before.objectiveId || '').trim();
  const newStart = startMs(after);
  if (!newStart) return { notified: false, orphanCoverage: false };

  const published = await isPlanningPublishedForShift(db, objectiveId, newStart);
  if (!published) return { notified: false, orphanCoverage: false };

  const nowMs = Date.now();
  const hoursUntil = (newStart - nowMs) / 3600000;
  if (hoursUntil < 0 || hoursUntil > 12) return { notified: false, orphanCoverage: false };

  const safeId = turnoId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const novRef = db.collection('novedades').doc(`mod12h_${safeId}_${newStart}`);
  const exist = await novRef.get();
  if (!exist.exists) {
    const fmt = new Date(newStart).toLocaleString('es-AR', { timeZone: TZ });
    await novRef.set({
      type: 'TURNO_MODIFICADO_MENOS_12H',
      status: 'PENDIENTE',
      shiftId: turnoId,
      objectiveId,
      objectiveName: after.objectiveName || '',
      empresaId: after.empresaId || null,
      positionName: after.positionName || '',
      description: `Turno modificado a menos de 12 h del inicio (${fmt}). Revisar cobertura y convocatorias.`,
      hoursUntilStart: Math.round(hoursUntil * 100) / 100,
      createdAt: FieldValue.serverTimestamp(),
      source: 'onTurnoWrite',
    });
  }

  let orphanCoverage = false;
  const covId = String(after.coverageDocId || before.coverageDocId || '').trim();
  const byAbs = await db.collection('turnos').where('absenceShiftId', '==', turnoId).limit(10).get();

  const markOrphan = async (ref: admin.firestore.DocumentReference, data: Record<string, unknown>) => {
    if (String(data.origin || '') !== 'OPERATIONS_COVERAGE') return;
    if (data.coverageSuperseded === true) return;
    orphanCoverage = true;
    await ref.update({
      coverageOrphaned: true,
      coverageOrphanReason: 'TITULAR_MODIFIED_LT_12H',
      coverageOrphanAt: FieldValue.serverTimestamp(),
    });
  };

  for (const d of byAbs.docs) {
    await markOrphan(d.ref, d.data() as Record<string, unknown>);
  }
  if (covId) {
    const covSnap = await db.collection('turnos').doc(covId).get();
    if (covSnap.exists) {
      await markOrphan(covSnap.ref, covSnap.data() as Record<string, unknown>);
    }
  }

  if (orphanCoverage) {
    const huRef = db.collection('novedades').doc(`orphcov_${safeId}_${newStart}`);
    const huExist = await huRef.get();
    if (!huExist.exists) {
      await huRef.set({
        type: 'COBERTURA_HUERFANA',
        status: 'PENDIENTE',
        shiftId: turnoId,
        objectiveId,
        objectiveName: after.objectiveName || '',
        empresaId: after.empresaId || null,
        description:
          'Cobertura ops vinculada quedó huérfana por modificación del turno titular a <12 h.',
        createdAt: FieldValue.serverTimestamp(),
        source: 'onTurnoWrite',
      });
    }
  }

  return { notified: true, orphanCoverage };
}
