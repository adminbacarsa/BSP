import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { iniciarCascadaCobertura } from '../coverage/convocatoriasCobertura';
import { isExtraNonReliefShift } from '../common/reliefEligibility';
import { shouldSuppressCcAutoAlerts } from '../ops/opsManualMode';
import { isRetShift, isZeroDurationShift } from '../common/retShift';
import { lateVacancyDue } from './lateAbsenceWindow';

export type OpenLateAbsenceVacancyOpts = {
  /**
   * Modo Rápido / operador elige cobertura a mano: marca vacante pero no dispara cascada
   * (evita asignación directa RET/REF/ESC sin que el operador elija).
   */
  skipCascade?: boolean;
};

/**
 * Abre vacante/cascada: sin aviso al marcar AUTO_T30; con aviso al T+60; o si declara el operador.
 * Idempotente: si ya hay convocatoria activa, la cascada no duplica.
 */
export async function openLateAbsenceVacancy(
  db: Firestore,
  shiftId: string,
  opts?: OpenLateAbsenceVacancyOpts,
): Promise<boolean> {
  const sid = String(shiftId || '').trim();
  if (!sid) return false;
  const ref = db.collection('turnos').doc(sid);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const shift = snap.data() as Record<string, unknown>;
  if (shift.draft === true) return false;
  if (isRetShift(shift) || isZeroDurationShift(shift)) return false;
  if (!lateVacancyDue(shift, Date.now())) return false;

  const holdCascade =
    opts?.skipCascade === true || shift.absenceCascadeSkip === true;
  const empresaId = String(shift.empresaId || '').trim() || 'bacarsa';
  const manual = holdCascade || (await shouldSuppressCcAutoAlerts(db, empresaId));
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
