import { FieldValue, type Firestore } from 'firebase-admin/firestore';

/**
 * Cancela la pregunta «¿Estás en camino?» (LLEGADA_TARDE) pendiente de un turno cuando el guardia ya
 * fichó o avisó su demora. Si quedaba viva, su timeout marcaba AA a un guardia presente.
 */
export async function cancelLlegadaTardeConvocatorias(
  db: Firestore,
  shiftId: string,
  reason: 'CHECKED_IN' | 'LATE_NOTICE',
): Promise<number> {
  const sid = String(shiftId || '').trim();
  if (!sid) return 0;
  const snap = await db
    .collection('convocatorias_cobertura')
    .where('shiftId', '==', sid)
    .where('type', '==', 'LLEGADA_TARDE')
    .where('status', '==', 'PENDING')
    .limit(5)
    .get();
  if (snap.empty) return 0;
  const batch = db.batch();
  for (const d of snap.docs) {
    batch.update(d.ref, {
      status: 'CANCELLED',
      cancelReason: reason,
      cancelledAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return snap.size;
}
