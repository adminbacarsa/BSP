import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * Cierre manual del legajo de revisión Play (`fichadaRemota`).
 * No retiene, no abre vacante y no escribe novedad: el objetivo está fuera del CC.
 */
export async function cerrarTurnoRevision(
  db: Firestore,
  input: { shiftId: string; empId: string },
): Promise<{ closed: boolean; alreadyClosed?: boolean }> {
  const shiftId = String(input.shiftId || '').trim();
  const empId = String(input.empId || '').trim();
  if (!shiftId || !empId) throw new Error('SHIFT_REQUIRED');

  const emp = await db.collection('empleados').doc(empId).get();
  if (!emp.exists || emp.data()?.fichadaRemota !== true) throw new Error('NOT_REVIEW');

  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('TURNO_NOT_FOUND');
  const shift = snap.data() as Record<string, unknown>;
  const owner = String(shift.employeeId || '').trim();
  if (owner !== empId) throw new Error('NOT_OWNER');
  if (shift.isPresent !== true) throw new Error('NOT_PRESENT');
  if (shift.isCompleted === true || shift.realEndTime) return { closed: true, alreadyClosed: true };

  const now = Timestamp.now();
  await ref.update({
    isCompleted: true,
    status: 'COMPLETED',
    realEndTime: now,
    isRetention: false,
    completionReason: 'CIERRE_REVISION',
    closedAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { closed: true };
}
