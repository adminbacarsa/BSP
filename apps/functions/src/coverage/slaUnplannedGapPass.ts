import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { retainOutgoingForGap } from './coverageRetention';

export type SlaUnplannedGapDoc = {
  id?: string;
  empresaId: string;
  objectiveId: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  positionName: string;
  bandCode?: string;
  gapStart: Timestamp;
  gapEnd: Timestamp;
  planningNotifiedAt?: Timestamp | null;
  ccVacancyShiftId?: string | null;
  retentionAppliedAt?: Timestamp | null;
  status?: 'OPEN' | 'CLOSED';
};

/**
 * Avanza un hueco SLA sin planificar:
 * - hasta T−12 h → novedad bandeja Planificación
 * - desde T−12 h → vacante en CC
 * - a la hora del hueco → retainOutgoingForGap sobre saliente
 */
export async function advanceSlaUnplannedGap(
  db: admin.firestore.Firestore,
  gap: SlaUnplannedGapDoc,
  now: Timestamp = Timestamp.now(),
): Promise<{ phase: string; shiftId?: string }> {
  const gapId = String(gap.id || '').trim();
  const gapRef = gapId ? db.collection('sla_huecos_sin_plan').doc(gapId) : null;
  const startMs = gap.gapStart.toMillis();
  const nowMs = now.toMillis();
  const minutesUntil = (startMs - nowMs) / 60000;

  if (gap.status === 'CLOSED') return { phase: 'CLOSED' };

  if (minutesUntil > 12 * 60) {
    if (!gap.planningNotifiedAt && gapRef) {
      const safe = gapId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
      await db.collection('novedades').doc(`sla_gap_plan_${safe}`).set({
        type: 'SLA_HUECO_SIN_PLAN',
        status: 'PENDIENTE',
        objectiveId: gap.objectiveId,
        objectiveName: gap.objectiveName || '',
        empresaId: gap.empresaId,
        positionName: gap.positionName,
        description: `Hueco SLA sin planificar — ${gap.positionName} en ${gap.objectiveName || gap.objectiveId}. Planificar antes de T−12 h.`,
        minutesUntilStart: Math.round(minutesUntil),
        gapDocId: gapId,
        createdAt: FieldValue.serverTimestamp(),
        source: 'SLA_UNPLANNED_GAP',
      });
      await gapRef.update({ planningNotifiedAt: now });
    }
    return { phase: 'PLANNING_INBOX' };
  }

  if (minutesUntil > 0) {
    if (gapRef && !gap.ccVacancyShiftId) {
      await gapRef.update({ ccVacancyShiftId: gapId });
    }
    return { phase: 'CC_VACANCY', shiftId: gapId || undefined };
  }

  if (!gap.retentionAppliedAt) {
    await retainOutgoingForGap(db, {
      id: gapId,
      empresaId: gap.empresaId,
      objectiveId: gap.objectiveId,
      positionName: gap.positionName,
      employeeId: 'VACANTE',
      startTime: gap.gapStart,
      endTime: gap.gapEnd,
      code: gap.bandCode || 'M',
    });
    if (gapRef) await gapRef.update({ retentionAppliedAt: now });
    return { phase: 'RETENTION_AT_GAP' };
  }

  return { phase: 'RETENTION_DONE' };
}

export async function runSlaUnplannedGapPass(
  db: admin.firestore.Firestore,
  opts?: { empresaId?: string; limit?: number },
): Promise<number> {
  const limit = opts?.limit ?? 40;
  let q: admin.firestore.Query = db
    .collection('sla_huecos_sin_plan')
    .where('status', '==', 'OPEN')
    .limit(limit);
  if (opts?.empresaId) {
    q = q.where('empresaId', '==', opts.empresaId);
  }
  const snap = await q.get();
  let n = 0;
  for (const d of snap.docs) {
    const data = d.data() as SlaUnplannedGapDoc;
    await advanceSlaUnplannedGap(db, { ...data, id: d.id, gapStart: data.gapStart, gapEnd: data.gapEnd });
    n += 1;
  }
  return n;
}
