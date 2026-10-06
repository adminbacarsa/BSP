import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { iniciarCascadaCobertura } from '../coverage/convocatoriasCobertura';
import { isExtraNonReliefShift } from '../common/reliefEligibility';
import { isEmpresaManualMode } from '../ops/opsManualMode';
import { isRetShift, isZeroDurationShift } from '../common/retShift';
import { lateVacancyDue } from './lateAbsenceWindow';

/**
 * Abre vacante/cascada: sin aviso al marcar AUTO_T30; con aviso al T+60; o si declara el operador.
 * Idempotente: si ya hay convocatoria activa, la cascada no duplica.
 */
export async function openLateAbsenceVacancy(db: Firestore, shiftId: string): Promise<boolean> {
  const sid = String(shiftId || '').trim();
  if (!sid) return false;
  const ref = db.collection('turnos').doc(sid);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const shift = snap.data() as Record<string, unknown>;
  if (isRetShift(shift) || isZeroDurationShift(shift)) return false;
  if (!lateVacancyDue(shift, Date.now())) return false;

  const empresaId = String(shift.empresaId || '').trim() || 'bacarsa';
  const manual = await isEmpresaManualMode(db, empresaId);
  if (!manual && !isExtraNonReliefShift(shift)) {
    const start = shift.startTime as FirebaseFirestore.Timestamp | undefined;
    if (start) {
      await iniciarCascadaCobertura(
        db,
        {
          id: sid,
          objectiveId: String(shift.objectiveId || ''),
          objectiveName: String(shift.objectiveName || ''),
          positionName: String(shift.positionName || ''),
          clientId: String(shift.clientId || ''),
          clientName: String(shift.clientName || ''),
          code: String(shift.code || ''),
          startTime: start,
          endTime: shift.endTime as FirebaseFirestore.Timestamp | undefined,
          empresaId,
        },
        'AUTO',
      );
    }
  }

  await ref.update({ absenceVacancyOpenedAt: Timestamp.now() });
  return true;
}
