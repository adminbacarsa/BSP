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

export type FinTurnoKind = 'RELIEVO' | 'FIN' | 'TOPE';

export function finTurnoDocId(shiftId: string): string {
  return `fin_turno_${String(shiftId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140)}`;
}

function conNombre(name: string, sentence: string): string {
  const text = sentence.trim();
  if (!name) return text;
  const rest = text.charAt(0).toLocaleLowerCase('es-AR') + text.slice(1);
  return `${name}, ${rest}`;
}

/** Texto del aviso de fin. El push sale por el trigger de la bandeja, canal alertas_turno. */
export function finTurnoCopy(input: {
  kind: FinTurnoKind;
  name: string;
  place: string;
  incomingName?: string;
  hm?: string;
}): { title: string; body: string; type: string } {
  const place = input.place.trim() || 'el puesto';
  if (input.kind === 'TOPE') {
    return {
      title: 'Tope de jornada',
      type: 'TOPE_JORNADA',
      body: conNombre(input.name, 'Llegaste al máximo de horas de hoy. Podés retirarte, gracias por quedarte.'),
    };
  }
  if (input.kind === 'RELIEVO') {
    const who = (input.incomingName || 'tu relevo').trim() || 'tu relevo';
    return {
      title: 'Turno finalizado',
      type: 'TURNO_FINALIZADO',
      body: conNombre(input.name, `Terminaste tu turno en ${place}. Te relevó ${who}. Buen descanso.`),
    };
  }
  const hm = input.hm || '--:--';
  return {
    title: 'Turno finalizado',
    type: 'TURNO_FINALIZADO',
    body: conNombre(input.name, `Terminó tu turno en ${place} a las ${hm}. Buen descanso.`),
  };
}

/** CC apagado o Demo: no se avisa a guardias (misma regla que los avisos de turno P5b). */
export async function avisosDeTurnoSilenciosos(
  db: FirebaseFirestore.Firestore,
  empresaId: string | null | undefined,
): Promise<boolean> {
  const id = String(empresaId || '').trim();
  if (!id) return false;
  const snap = await db.collection('empresas').doc(id).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  return data.centroControlEnabled === false || data.modoDemoEnabled === true;
}

/**
 * Bandeja + flag `finTurnoAvisoAt`. Un doc por turno: el trigger manda el push una sola vez.
 * Si el turno ya tiene el flag, no escribe de nuevo.
 */
export async function claimFinTurnoAviso(
  db: FirebaseFirestore.Firestore,
  params: {
    kind: FinTurnoKind;
    outEmpId: string;
    outDocId: string;
    employeeName?: string;
    incomingName?: string;
    place: string;
    hm?: string;
    empresaId: string | null;
    at?: Timestamp;
  },
): Promise<boolean> {
  const empId = String(params.outEmpId || '').trim();
  if (!empId || empId === 'VACANTE' || !params.outDocId) return false;
  const shiftRef = db.collection('turnos').doc(params.outDocId);
  const notifRef = db.collection('user_notifications').doc(finTurnoDocId(params.outDocId));
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(shiftRef);
      if (!snap.exists || snap.data()?.finTurnoAvisoAt) return false;
      const emp = await tx.get(db.collection('empleados').doc(empId));
      const row = emp.data() || {};
      const name = guardFirstName({
        firstName: row.firstName,
        employeeName: params.employeeName || row.nombre,
      });
      const msg = finTurnoCopy({
        kind: params.kind,
        name,
        place: params.place,
        incomingName: params.incomingName,
        hm: params.hm,
      });
      tx.update(shiftRef, { finTurnoAvisoAt: params.at || Timestamp.now() });
      tx.set(notifRef, {
        uid: row.uid ? String(row.uid) : null,
        employeeId: empId,
        userId: empId,
        title: msg.title,
        body: msg.body,
        type: msg.type,
        target: 'employee',
        turnoId: params.outDocId,
        shiftId: params.outDocId,
        empresaId: params.empresaId || null,
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  } catch (e) {
    console.warn('[relevoNotifications] fin de turno:', (e as Error)?.message);
    return false;
  }
}

/** Push + bandeja: turno saliente cerrado porque ya lo relevó alguien. */
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
  if (await avisosDeTurnoSilenciosos(db, params.empresaId)) return;
  await claimFinTurnoAviso(db, {
    kind: 'RELIEVO',
    outEmpId: params.outEmpId,
    outDocId: params.outDocId,
    incomingName: params.incomingName,
    place: params.objectiveName || 'el puesto',
    empresaId: params.empresaId,
  });
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
