import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { guardFirstName } from '../common/pushGreeting';
import { findPresentOutgoingAlignedToGapStart } from './relevoOutgoingMatch';
import { isReliefEligibleShift } from '../common/reliefEligibility';

export function formatHmArgentina(ms: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(ms));
}

async function employeePushIdentity(
  db: FirebaseFirestore.Firestore,
  employeeId: string,
  employeeName?: string,
): Promise<{ uid?: string; name: string }> {
  if (!employeeId) return { name: guardFirstName({ employeeName }) };
  const empDoc = await db.collection('empleados').doc(employeeId).get();
  const emp = empDoc.exists ? empDoc.data() || {} : {};
  return {
    uid: emp.uid as string | undefined,
    name: guardFirstName({ firstName: emp.firstName, employeeName: employeeName || emp.nombre }),
  };
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
  const { outEmpId, outDocId, objectiveName, empresaId } = params;
  const who = await employeePushIdentity(db, outEmpId);
  const title = 'Turno finalizado';
  const body = who.name
    ? `¡Gracias, ${who.name}! Terminaste tu turno en ${objectiveName || 'el puesto'}. Buen descanso.`
    : `¡Gracias! Terminaste tu turno en ${objectiveName || 'el puesto'}. Buen descanso.`;

  try {
    const outEmpUid = who.uid;
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
  const who = await employeePushIdentity(db, outEmpId);
  const title = '⛔ Quedás retenido';
  const lead = who.name ? `${who.name}, quedás retenido` : 'Quedás retenido';
  const body = `${lead} en ${objLabel}. ${incomingName} llega cerca de las ${etaLabel}. No abandones el puesto hasta que llegue tu relevo o Operaciones te libere.`;

  try {
    const outEmpUid = who.uid;
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
  // Un ESC/REF/RET que llega tarde no deja a nadie sin relevo: nadie queda retenido por él.
  if (!isReliefEligibleShift(shiftData)) return false;

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
