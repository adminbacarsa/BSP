import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  buildRestoreSourceShiftAfterCoveragePatch,
  isActiveOpsCoverageDoc,
} from '../coverage/syncAusenciaCobertura';

/** Deshace cobertura activa del titular cuando el ops_cov no llegó. */
export async function revertTitularAfterConvocadoNoLlego(
  db: Firestore,
  opsCov: Record<string, unknown> & { id: string },
): Promise<boolean> {
  const titularId = String(opsCov.absenceShiftId || opsCov.coveredShiftId || '').trim();
  if (!titularId) return false;

  const batch = db.batch();
  const opsRef = db.collection('turnos').doc(opsCov.id);
  const opsSnap = await opsRef.get();
  if (!opsSnap.exists) return false;
  const opsData = opsSnap.data() as Record<string, unknown>;

  if (isActiveOpsCoverageDoc(opsData)) {
    const sourceId = String(opsData.sourceShiftId || '').trim();
    if (sourceId) {
      const srcSnap = await db.collection('turnos').doc(sourceId).get();
      if (srcSnap.exists) {
        batch.update(
          srcSnap.ref,
          buildRestoreSourceShiftAfterCoveragePatch(srcSnap.data() as Record<string, unknown>),
        );
      }
    }
    batch.update(opsRef, {
      coverageSuperseded: true,
      coverageSupersededAt: FieldValue.serverTimestamp(),
      coverageSupersededBy: 'CONVOCADO_NO_LLEGO',
      status: 'CANCELLED',
    });
  }

  const titRef = db.collection('turnos').doc(titularId);
  const titSnap = await titRef.get();
  if (titSnap.exists) {
    batch.update(titRef, {
      operacionallyCovered: false,
      coverageStatus: 'PENDING',
      coveredByEmployeeId: null,
      coveredByEmployeeName: null,
      coverageDocId: null,
      coverageType: null,
      coverageConvocatoriaId: null,
      coverageClaimConvocatoriaId: null,
      resolvedBy: null,
    });
  }

  const ausSnap = await db.collection('ausencias').where('shiftId', '==', titularId).limit(10).get();
  for (const d of ausSnap.docs) {
    batch.update(d.ref, {
      coberturaEstado: 'PENDIENTE',
      status: 'Pendiente',
      coveredByEmployeeId: null,
      coveredByEmployeeName: null,
      coverageType: null,
      coberturaResolvedAt: null,
      coberturaResolvedBy: null,
    });
  }

  await batch.commit();
  return true;
}

export async function cancelPendingConvocatoriasForTitular(
  db: Firestore,
  titularShiftId: string,
): Promise<number> {
  const tid = String(titularShiftId || '').trim();
  if (!tid) return 0;
  const snap = await db
    .collection('convocatorias_cobertura')
    .where('shiftId', '==', tid)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(20)
    .get();
  let n = 0;
  for (const d of snap.docs) {
    await d.ref.update({
      status: 'CANCELLED',
      resolvedAt: Timestamp.now(),
      rejectionReason: 'CONVOCADO_NO_LLEGO_REVERT',
    });
    n += 1;
  }
  return n;
}
