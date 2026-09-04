import { FieldValue } from 'firebase-admin/firestore';
import type { PortalCheckInInput, PortalCheckInResult } from './fichajesTypes';
import { fichajeDocIdFromKey } from './sanitizeId';
import { registrarPresencia } from './registrarPresencia';

/**
 * Registra fichaje CHECK_IN idempotente y consolida en el documento turno
 * vía el motor único registrarPresencia (auto-relevo FIFO 1:1).
 */
export async function processPortalCheckIn(
  db: FirebaseFirestore.Firestore,
  input: PortalCheckInInput,
): Promise<PortalCheckInResult> {
  const { shiftId, empId, coords, recordedAt, idempotencyKey, source = 'PORTAL_GPS' } = input;

  const shiftRef = db.collection('turnos').doc(shiftId);
  const shiftDoc = await shiftRef.get();
  if (!shiftDoc.exists) {
    throw new Error('TURNO_NOT_FOUND');
  }
  const shiftData = shiftDoc.data()!;

  if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
    throw new Error('SHIFT_ABSENT');
  }

  if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
    return { success: true, fichajeId: '', alreadyApplied: true };
  }

  const key = idempotencyKey?.trim() || `ci_${shiftId}_${recordedAt || Date.now()}`;
  const fichajeRef = db.collection('fichajes').doc(fichajeDocIdFromKey(key));
  const now = FieldValue.serverTimestamp();

  const existing = await fichajeRef.get();
  if (existing.exists) {
    const st = existing.data()?.status;
    if (st === 'APPLIED') {
      return { success: true, fichajeId: fichajeRef.id, alreadyApplied: true };
    }
    if (st === 'REJECTED') {
      throw new Error('FICHAJE_REJECTED');
    }
  }

  await fichajeRef.set(
    {
      tipo: 'CHECK_IN',
      status: 'PENDING',
      shiftId,
      employeeId: empId,
      empresaId: shiftData.empresaId || null,
      coords: coords || null,
      recordedAt: recordedAt || null,
      idempotencyKey: key,
      source,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  try {
    const result = await registrarPresencia(db, {
      shiftId,
      empId,
      coords: coords || null,
      recordedAt: recordedAt || null,
      source: source === 'OPERATIONS' ? 'OPERATIONS' : 'PORTAL_GPS',
    });

    await fichajeRef.update({
      status: 'APPLIED',
      appliedAt: now,
      updatedAt: now,
      relievedShiftId: result.relieved?.shiftId || null,
    });
    return { success: true, fichajeId: fichajeRef.id, alreadyApplied: result.alreadyPresent === true };
  } catch (e) {
    await fichajeRef
      .update({
        status: 'REJECTED',
        errorMessage: (e as Error)?.message || 'unknown',
        updatedAt: now,
      })
      .catch(() => {});
    throw e;
  }
}

/** @deprecated usar registrarPresencia — reexport por compat */
export { registrarPresencia };
