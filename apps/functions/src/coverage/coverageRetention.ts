import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

const normPos = (n: unknown): string =>
  String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');

const posMatch = (a: unknown, b: unknown): boolean => {
  const na = normPos(a);
  const nb = normPos(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.endsWith(nb) || nb.endsWith(na)) return true;
  return false;
};

const checkInMs = (data: Record<string, unknown>): number => {
  const real = data.realStartTime as { toMillis?: () => number } | undefined;
  if (real?.toMillis) return real.toMillis();
  const ci = data.checkInTime as { toMillis?: () => number } | undefined;
  if (ci?.toMillis) return ci.toMillis();
  const pres = data.presenciaAt as { toMillis?: () => number } | undefined;
  if (pres?.toMillis) return pres.toMillis();
  return 0;
};

/**
 * Retención obligatoria: presente en mismo objetivo/puesto del hueco, último en fichar.
 * Idempotente por retentionAbsenceShiftId.
 */
export async function applyAutoRetentionForAbsenceShift(
  db: Firestore,
  absenceShiftId: string,
  absenceData: Record<string, unknown>,
): Promise<{ applied: boolean; shiftId?: string; employeeName?: string }> {
  const objectiveId = String(absenceData.objectiveId || '').trim();
  const positionName = absenceData.positionName;
  const absentEmpId = String(absenceData.employeeId || '').trim();
  if (!objectiveId || !absenceShiftId) return { applied: false };

  const existing = await db.collection('turnos')
    .where('retentionAbsenceShiftId', '==', absenceShiftId)
    .where('isRetention', '==', true)
    .limit(3)
    .get();
  if (!existing.empty) {
    const d = existing.docs[0].data();
    return {
      applied: false,
      shiftId: existing.docs[0].id,
      employeeName: String(d.employeeName || ''),
    };
  }

  const presentSnap = await db.collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .where('isPresent', '==', true)
    .where('isCompleted', '==', false)
    .limit(25)
    .get();

  const candidates = presentSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter(({ data }) => {
      if (data.isAbsent || data.isVirtual === true) return false;
      if (!posMatch(data.positionName, positionName)) return false;
      const eid = String(data.employeeId || '').trim();
      if (!eid || eid === 'VACANTE' || eid === absentEmpId) return false;
      return true;
    })
    .sort((a, b) => checkInMs(b.data) - checkInMs(a.data));

  if (!candidates.length) return { applied: false };

  const pick = candidates[0];
  const gapEnd = absenceData.endTime as Timestamp | undefined;
  const now = Timestamp.now();

  await db.collection('turnos').doc(pick.id).update({
    isRetention: true,
    retentionReason: 'AUSENCIA_RELEVO',
    retentionKind: 'AUSENCIA_RELEVO',
    retentionAbsenceShiftId: absenceShiftId,
    autoRetentionAt: now,
    ...(gapEnd ? { retentionEndTime: gapEnd } : {}),
  });

  const priorNov = await db.collection('novedades')
    .where('absenceShiftId', '==', absenceShiftId)
    .where('type', '==', 'RETENCION_AUSENCIA_RELEVO')
    .limit(1)
    .get();
  if (priorNov.empty) {
    await db.collection('novedades').add({
      type: 'RETENCION_AUSENCIA_RELEVO',
      status: 'pending',
      title: 'Retención por ausencia de relevo',
      employeeId: pick.data.employeeId || null,
      employeeName: pick.data.employeeName || '',
      shiftId: pick.id,
      absenceShiftId,
      objectiveId,
      objectiveName: absenceData.objectiveName || '',
      positionName: absenceData.positionName || '',
      empresaId: absenceData.empresaId || null,
      description: `${pick.data.employeeName || 'Guardia'} retenido (último en puesto) por ausencia hasta cobertura.`,
      createdAt: FieldValue.serverTimestamp(),
      reportedBy: 'AUTO',
    });
  }

  return {
    applied: true,
    shiftId: pick.id,
    employeeName: String(pick.data.employeeName || ''),
  };
}
