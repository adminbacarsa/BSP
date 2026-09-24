import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { getUrgency, type CandidateType } from './eligibilityFilter';
import {
  crearConvocatoriaDoc,
  dispararBroadcastFT,
  findBestCandidate,
  type ShiftDataForCascade,
} from './convocatoriasCobertura';
import { escalarVacanteSinCobertura } from './escalarVacanteSinCobertura';

/** Retiro anticipado: sin EXT; ADV máx 4 h (filtro en candidatos). */
const EARLY_WITHDRAW_CASCADE: CandidateType[] = ['RET', 'REF', 'ESC', 'ADVANCE', 'FT'];

export async function iniciarEarlyWithdrawCascade(
  db: admin.firestore.Firestore,
  shift: ShiftDataForCascade,
  createdBy = 'AUTO',
): Promise<void> {
  const { isTitularAlreadyCovered, isActiveOpsCoverageDoc } = await import('./syncAusenciaCobertura');

  const titularSnap = await db.collection('turnos').doc(shift.id).get();
  const titularData = (titularSnap.data() || {}) as Record<string, unknown>;
  if (isTitularAlreadyCovered(titularData)) return;

  const priorCov = await db.collection('turnos').where('absenceShiftId', '==', shift.id).limit(20).get();
  if (priorCov.docs.some((d) => isActiveOpsCoverageDoc(d.data()))) return;

  const existing = await db
    .collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(1)
    .get();
  if (!existing.empty) return;

  const baseConvData = {
    empresaId: shift.empresaId,
    shiftId: shift.id,
    objectiveId: String(shift.objectiveId || ''),
    objectiveName: String(shift.objectiveName || ''),
    positionName: String(shift.positionName || ''),
    clientId: String(shift.clientId || ''),
    clientName: String(shift.clientName || ''),
    shiftCode: String(shift.code || ''),
    startTime: shift.startTime,
    endTime: shift.endTime,
    aptitudesRequeridas: [] as string[],
    type: 'RET' as const,
    urgency: getUrgency(shift.startTime),
    cascadeStep: 0,
    candidateEmployeeId: '',
    candidateEmployeeName: '',
    status: 'PENDING' as const,
    timeoutAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    createdBy,
  };

  for (const type of EARLY_WITHDRAW_CASCADE) {
    if (type === 'FT') {
      await dispararBroadcastFT(db, baseConvData as any);
      return;
    }
    const candidate = await findBestCandidate(db, baseConvData as any, type);
    if (!candidate) continue;
    if (type === 'ADVANCE' && candidate.advanceShiftId) {
      const advSnap = await db.collection('turnos').doc(candidate.advanceShiftId).get();
      const advEnd = advSnap.data()?.endTime?.toMillis?.() ?? 0;
      const gapEnd = shift.endTime?.toMillis?.() ?? 0;
      if (advEnd && gapEnd && (gapEnd - advEnd) / 3600000 > 4) continue;
    }
    await crearConvocatoriaDoc(db, {
      ...baseConvData,
      type,
      cascadeStep: EARLY_WITHDRAW_CASCADE.indexOf(type),
      candidateEmployeeId: candidate.id,
      candidateEmployeeName: candidate.name,
      candidateUid: candidate.uid,
      ...(candidate.candidateShiftId ? { candidateShiftId: candidate.candidateShiftId } : {}),
      ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
      createdBy,
    } as any);
    return;
  }

  await escalarVacanteSinCobertura(db, {
    shiftId: shift.id,
    empresaId: shift.empresaId,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName || '',
    positionName: shift.positionName || '',
    message: `Retiro anticipado: sin candidatos en ${shift.objectiveName || 'objetivo'}.`,
    attemptRetention: true,
    source: 'EARLY_WITHDRAW',
  });
}
