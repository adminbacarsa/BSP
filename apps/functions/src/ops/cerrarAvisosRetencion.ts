import { FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { esNotifRetencion, MOTIVO_RETENCION_TERMINADA } from './retencionTarjetaPura';

/** Marca leídas y cerradas las notificaciones de retención de ese turno (shiftId o turnoId viejo). */
export async function cerrarAvisosRetencionDelTurno(
  db: Firestore,
  shiftId: string,
): Promise<number> {
  const id = String(shiftId || '').trim();
  if (!id) return 0;
  const [byShift, byTurno] = await Promise.all([
    db.collection('user_notifications').where('shiftId', '==', id).get(),
    db.collection('user_notifications').where('turnoId', '==', id).get(),
  ]);
  const docs = new Map<string, QueryDocumentSnapshot>();
  for (const doc of [...byShift.docs, ...byTurno.docs]) docs.set(doc.id, doc);
  const now = FieldValue.serverTimestamp();
  let batch = db.batch();
  let pending = 0;
  let closed = 0;
  const flush = async () => {
    if (!pending) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };
  for (const doc of docs.values()) {
    const data = doc.data() as Record<string, unknown>;
    if (!esNotifRetencion(data.type)) continue;
    if (data.closedAt) continue;
    batch.update(doc.ref, {
      read: true,
      readAt: data.readAt || now,
      closedAt: now,
      closedMotivo: MOTIVO_RETENCION_TERMINADA,
    });
    pending += 1;
    closed += 1;
    if (pending >= 400) await flush();
  }
  await flush();
  return closed;
}
