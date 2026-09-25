import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { findPresentOutgoingAlignedToGapStart } from './relevoOutgoingMatch';

export function formatHmArgentina(ms: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(ms));
}

async function employeeUid(
  db: FirebaseFirestore.Firestore,
  employeeId: string,
): Promise<string | undefined> {
  if (!employeeId) return undefined;
  const empDoc = await db.collection('empleados').doc(employeeId).get();
  return empDoc.exists ? (empDoc.data()?.uid as string | undefined) : undefined;
}

/** Push + bandeja: turno saliente cerrado con relevo ya en puesto (TURNO_FINALIZADO). */
export async function notifyTurnoFinalizadoRelevo(
  db: FirebaseFirestore.Firestore,
  params: {
    outEmpId: string;
    outDocId: string;
    incomingName: string;
    objectiveName: string;
    empresaId: string | null;
  },
): Promise<void> {
  const { outEmpId, outDocId, incomingName, objectiveName, empresaId } = params;
  const title = 'Turno finalizado';
  const body = `Turno finalizado — tu relevo ${incomingName} ya está en el puesto${objectiveName ? ` (${objectiveName})` : ''}.`;

  try {
    const outEmpUid = await employeeUid(db, outEmpId);
    await db.collection('user_notifications').add({
      uid: outEmpUid || null,
      employeeId: outEmpId,
      userId: outEmpId,
      title,
      body,
      type: 'TURNO_FINALIZADO',
      target: 'employee',
      turnoId: outDocId,
      empresaId: empresaId || null,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[relevoNotifications] TURNO_FINALIZADO doc:', (e as Error)?.message);
  }
}

/** Aviso al saliente: relevo llega tarde; queda retenido hasta que llegue (RETENCION_AVISO). */
export async function notifyRetencionAvisoRelevoTarde(
  db: FirebaseFirestore.Firestore,
  params: {
    outEmpId: string;
    outDocId: string;
    incomingName: string;
    objectiveName: string;
    etaAtMs: number;
    empresaId: string | null;
  },
): Promise<void> {
  const { outEmpId, outDocId, incomingName, objectiveName, etaAtMs, empresaId } = params;
  const etaLabel = formatHmArgentina(etaAtMs);
  const objLabel = objectiveName || 'el puesto';
  const title = 'Retención — relevo en camino';
  const body = `Tu relevo ${incomingName} llega aprox. a las ${etaLabel}. Quedás retenido en ${objLabel} hasta que llegue.`;

  try {
    const outEmpUid = await employeeUid(db, outEmpId);
    await db.collection('user_notifications').add({
      uid: outEmpUid || null,
      employeeId: outEmpId,
      userId: outEmpId,
      title,
      body,
      type: 'RETENCION_AVISO',
      target: 'employee',
      turnoId: outDocId,
      empresaId: empresaId || null,
      lateReliefEtaAtMs: etaAtMs,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[relevoNotifications] RETENCION_AVISO doc:', (e as Error)?.message);
  }
}

/** Saliente alineado al inicio del entrante: aviso RETENCION_AVISO (portal o convocatoria LLEGADA_TARDE). */
export async function applyLateReliefNoticeToOutgoing(
  db: Firestore,
  incomingShiftId: string,
  shiftData: Record<string, unknown>,
  etaAt: Timestamp,
): Promise<boolean> {
  const gapStartMs =
    (shiftData.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
  const objectiveId = String(shiftData.objectiveId || '').trim();
  const positionName = shiftData.positionName;
  if (!objectiveId || !positionName || !gapStartMs) return false;

  const outgoing = await findPresentOutgoingAlignedToGapStart(db, {
    objectiveId,
    positionName,
    gapStartMs,
    excludeShiftIds: [incomingShiftId],
    excludeEmployeeId: String(shiftData.employeeId || ''),
  });
  if (!outgoing) return false;

  const outEmpId = String(outgoing.data.employeeId || '').trim();
  const incomingName = String(shiftData.employeeName || 'Tu relevo').trim();
  const objectiveName = String(shiftData.objectiveName || '');
  const empresaId = shiftData.empresaId ? String(shiftData.empresaId) : null;

  await db.collection('turnos').doc(outgoing.id).set(
    {
      lateReliefIncomingShiftId: incomingShiftId,
      lateReliefIncomingName: incomingName,
      lateReliefEtaAt: etaAt,
      retentionExpectedUntil: etaAt,
    },
    { merge: true },
  );

  if (outEmpId) {
    const dupSnap = await db
      .collection('user_notifications')
      .where('employeeId', '==', outEmpId)
      .where('type', '==', 'RETENCION_AVISO')
      .where('turnoId', '==', outgoing.id)
      .limit(1)
      .get();
    if (!dupSnap.empty) return true;

    await notifyRetencionAvisoRelevoTarde(db, {
      outEmpId,
      outDocId: outgoing.id,
      incomingName,
      objectiveName,
      etaAtMs: etaAt.toMillis(),
      empresaId,
    });
  }
  return true;
}
