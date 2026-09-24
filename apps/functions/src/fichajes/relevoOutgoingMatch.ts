import type { Firestore } from 'firebase-admin/firestore';

export const RELEVO_GAP_ALIGN_MS = 30 * 60 * 1000;

const normPos = (n: unknown): string =>
  String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');

export const posMatchRelief = (a: unknown, b: unknown): boolean => {
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
  const st = data.startTime as { toMillis?: () => number } | undefined;
  return st?.toMillis?.() ?? 0;
};

const endMs = (data: Record<string, unknown>): number => {
  const et = data.endTime as { toMillis?: () => number } | undefined;
  return et?.toMillis?.() ?? 0;
};

const startMs = (data: Record<string, unknown>): number => {
  const st = data.startTime as { toMillis?: () => number } | undefined;
  return st?.toMillis?.() ?? 0;
};

export type OutgoingReliefPick = { id: string; data: Record<string, unknown> };

/**
 * Saliente presente en el puesto cuyo fin coincide con gapStart (±30 min),
 * mismo criterio que retainOutgoingForGap.
 */
export async function findPresentOutgoingAlignedToGapStart(
  db: Firestore,
  params: {
    objectiveId: string;
    positionName: unknown;
    gapStartMs: number;
    excludeShiftIds?: string[];
    excludeEmployeeId?: string;
    /** Si el candidato está retenido por otra ausencia, probar el siguiente. */
    absenceShiftId?: string;
  },
): Promise<OutgoingReliefPick | null> {
  const objectiveId = String(params.objectiveId || '').trim();
  const gapStartMs = params.gapStartMs;
  if (!objectiveId || !gapStartMs) return null;

  const exclude = new Set(params.excludeShiftIds || []);
  const absentEmpId = String(params.excludeEmployeeId || '').trim();

  const presentSnap = await db
    .collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .where('isPresent', '==', true)
    .limit(40)
    .get();

  const outgoing = presentSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter(({ id, data }) => {
      if (exclude.has(id)) return false;
      if (data.isCompleted === true) return false;
      if (String(data.relievedBy || '').trim()) return false;
      if (data.isAbsent || data.isVirtual === true) return false;
      if (!posMatchRelief(data.positionName, params.positionName)) return false;
      const eid = String(data.employeeId || '').trim();
      if (!eid || eid === 'VACANTE' || (absentEmpId && eid === absentEmpId)) return false;
      const st = startMs(data);
      if (st >= gapStartMs + 60_000) return false;
      const en = endMs(data);
      if (!en) return false;
      if (Math.abs(en - gapStartMs) > RELEVO_GAP_ALIGN_MS) return false;
      return true;
    })
    .sort((a, b) => checkInMs(b.data) - checkInMs(a.data));

  const absenceShiftId = String(params.absenceShiftId || '').trim();
  for (const cand of outgoing) {
    const linked = String(cand.data.retentionAbsenceShiftId || '').trim();
    if (
      cand.data.isRetention === true
      && linked
      && absenceShiftId
      && linked !== absenceShiftId
    ) {
      continue;
    }
    return cand;
  }
  return null;
}
