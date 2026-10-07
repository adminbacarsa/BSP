import * as admin from 'firebase-admin';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { positionHasContinuityFromSlaDoc } from './positionHasContinuity';
import { skipAbsencePipelineForShift } from './coverageTraceShift';
import { findPresentOutgoingAlignedToGapStart } from '../fichajes/relevoOutgoingMatch';
import { guardFirstName } from '../common/pushGreeting';
import { isReliefEligibleShift } from '../common/reliefEligibility';
import { seriesCodeOf } from '../common/shiftSeries';
import { eventoTieneFranjasEncadenadas, isEventoShift } from '../eventos/eventoCoverage';
import { buildAutoClosePatch, SHIFT_HARD_CAP_MS } from '../scheduling/shiftClose';
import { ObjectiveOperationCache } from '../common/simulableShift';

const GAP_ALIGN_MS = 30 * 60 * 1000;
const RETENTION_MAX_TOTAL_MS = SHIFT_HARD_CAP_MS;

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

const endMs = (data: Record<string, unknown>): number => {
  const et = data.endTime as { toMillis?: () => number } | undefined;
  return et?.toMillis?.() ?? 0;
};

const startMs = (data: Record<string, unknown>): number => {
  const st = data.startTime as { toMillis?: () => number } | undefined;
  return st?.toMillis?.() ?? 0;
};

async function employeePushTokens(db: Firestore, employeeId: string): Promise<string[]> {
  if (!employeeId || employeeId === 'VACANTE') return [];
  const empDoc = await db.collection('empleados').doc(employeeId).get();
  const authUid: string | undefined = empDoc.data()?.uid;
  if (!authUid) return [];
  const tokenSnap = await db.collection('device_tokens').where('uid', '==', authUid).get();
  return tokenSnap.docs
    .map((d) => d.data()?.token)
    .filter((t): t is string => typeof t === 'string' && t.length > 10);
}

export type RetainOutgoingOpts = {
  sendPush?: boolean;
  reportedBy?: string;
  /** Reloj de la pasada (el cron). Sin esto, la hora real. */
  nowMs?: number;
  /** Quien cubre no llega al inicio: retener ya, aunque el hueco todavía no haya empezado. */
  holdNow?: boolean;
};

export type RetainOutgoingResult = {
  applied: boolean;
  /** Hueco en el futuro: no hay `isRetention`. El cron la activa al fin del saliente. */
  planned?: boolean;
  shiftIds: string[];
  employeeNames: string[];
  skippedReason?: string;
};

function releasedRetentionPatch(releasedBy: string): Record<string, unknown> {
  return {
    isRetention: false,
    retentionReleasedAt: FieldValue.serverTimestamp(),
    releasedBy,
    retentionReason: FieldValue.delete(),
    retentionKind: FieldValue.delete(),
    retentionAbsenceShiftId: FieldValue.delete(),
    retentionPlannedFor: FieldValue.delete(),
    retentionPlannedKind: FieldValue.delete(),
  };
}

/**
 * Retiene al(los) saliente(s) del puesto para cubrir el hueco del titular ausente.
 * Idempotente: una retención activa por titularShiftId (retentionAbsenceShiftId).
 */
export async function retainOutgoingForGap(
  db: Firestore,
  titularShift: Record<string, unknown> & { id?: string },
  opts: RetainOutgoingOpts = {},
): Promise<RetainOutgoingResult> {
  if (skipAbsencePipelineForShift(titularShift)) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'TRACE_REGISTRATION_SHIFT' };
  }
  // ESC/REF/RET ausente no deja hueco de SLA: la franja sigue cubierta por el titular.
  if (!isReliefEligibleShift(titularShift)) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'EXTRA_SHIFT_NO_GAP' };
  }
  if (isEventoShift(titularShift) && !eventoTieneFranjasEncadenadas(titularShift)) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'EVENTO_SIN_CONTINUIDAD' };
  }
  const dayVerdict = await new ObjectiveOperationCache().operationVerdict(db, titularShift);
  if (dayVerdict === 'OUT') {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'FIN_SERVICIO_SIN_CRONOGRAMA' };
  }

  const absenceShiftId = String(titularShift.id || '').trim();
  const objectiveId = String(titularShift.objectiveId || '').trim();
  const positionName = titularShift.positionName;
  const absentEmpId = String(titularShift.employeeId || '').trim();
  const gapStartMs = startMs(titularShift);
  if (!objectiveId || !absenceShiftId || !gapStartMs) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'INVALID_TITULAR' };
  }

  const nowMs = typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const gapInFuture = gapStartMs > nowMs && opts.holdNow !== true;

  const existing = await db
    .collection('turnos')
    .where('retentionAbsenceShiftId', '==', absenceShiftId)
    .limit(5)
    .get();
  const activeLinked = existing.docs.filter((d) => d.data().isCompleted !== true);
  const activeRetained = activeLinked.filter((d) => d.data().isRetention === true && !d.data().manualRetentionType);
  if (activeRetained.length && !gapInFuture) {
    return {
      applied: false,
      shiftIds: activeRetained.map((d) => d.id),
      employeeNames: activeRetained.map((d) => String(d.data().employeeName || '')),
      skippedReason: 'ALREADY_RETAINED_FOR_GAP',
    };
  }
  if (gapInFuture && activeRetained.length) {
    for (const docSnap of activeRetained) {
      await docSnap.ref.update({
        isRetention: false,
        retentionPlannedFor: Timestamp.fromMillis(gapStartMs),
        retentionPlannedKind: 'AUSENCIA_RELEVO',
        retentionReason: FieldValue.delete(),
        retentionKind: FieldValue.delete(),
      });
    }
    return {
      applied: true,
      planned: true,
      shiftIds: activeRetained.map((d) => d.id),
      employeeNames: activeRetained.map((d) => String(d.data().employeeName || '')),
    };
  }
  const alreadyPlanned = activeLinked.filter((d) => d.data().retentionPlannedFor && d.data().isRetention !== true);
  if (gapInFuture && alreadyPlanned.length) {
    return {
      applied: false,
      planned: true,
      shiftIds: alreadyPlanned.map((d) => d.id),
      employeeNames: alreadyPlanned.map((d) => String(d.data().employeeName || '')),
      skippedReason: 'ALREADY_PLANNED_FOR_GAP',
    };
  }

  const pick = await findPresentOutgoingAlignedToGapStart(db, {
    objectiveId,
    positionName,
    gapStartMs,
    excludeShiftIds: [absenceShiftId],
    excludeEmployeeId: absentEmpId,
    absenceShiftId,
    incoming: titularShift,
  });

  if (!pick) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'NO_OUTGOING' };
  }

  const linked = String(pick.data.retentionAbsenceShiftId || '').trim();
  if ((pick.data.isRetention === true || pick.data.retentionPlannedFor) && linked && linked !== absenceShiftId) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'NO_OUTGOING' };
  }

  const toRetain = [{ id: pick.id, data: pick.data }];
  const retainedIds: string[] = [];
  const retainedNames: string[] = [];

  for (const row of toRetain) {
    const retEnd = endMs(row.data);
    const holdFromMs = retEnd || gapStartMs;
    const adopt =
      !gapInFuture
      && row.data.isRetention === true
      && !String(row.data.retentionAbsenceShiftId || '').trim();
    if (gapInFuture) {
      await db.collection('turnos').doc(row.id).update({
        isRetention: false,
        retentionPlannedFor: Timestamp.fromMillis(gapStartMs),
        retentionPlannedKind: 'AUSENCIA_RELEVO',
        retentionAbsenceShiftId: absenceShiftId,
        retentionReason: FieldValue.delete(),
        retentionKind: FieldValue.delete(),
      });
    } else if (adopt) {
      await db.collection('turnos').doc(row.id).update({
        retentionAbsenceShiftId: absenceShiftId,
        retentionKind: row.data.retentionKind || 'AUSENCIA_RELEVO',
        retentionPlannedFor: FieldValue.delete(),
        retentionPlannedKind: FieldValue.delete(),
      });
    } else {
      await db.collection('turnos').doc(row.id).update({
        isRetention: true,
        retentionReason: 'AUSENCIA_RELEVO',
        retentionKind: 'AUSENCIA_RELEVO',
        retentionAbsenceShiftId: absenceShiftId,
        retentionStartedAt: Timestamp.fromMillis(holdFromMs),
        autoRetentionAt: Timestamp.fromMillis(holdFromMs),
        retentionPlannedFor: FieldValue.delete(),
        retentionPlannedKind: FieldValue.delete(),
        ...(retEnd ? { retentionEndTime: Timestamp.fromMillis(retEnd) } : {}),
      });
    }
    retainedIds.push(row.id);
    retainedNames.push(String(row.data.employeeName || ''));

    if (!gapInFuture && opts.sendPush !== false && !adopt) {
      const tokens = await employeePushTokens(db, String(row.data.employeeId || ''));
      if (tokens.length > 0) {
        await admin
          .messaging()
          .sendEachForMulticast({
            tokens,
            notification: {
              title: '⛔ Quedás retenido',
              body: (() => {
                const name = guardFirstName({ employeeName: row.data.employeeName });
                const where = [titularShift.objectiveName, titularShift.positionName]
                  .map((s) => String(s || '').trim())
                  .filter(Boolean)
                  .join(' · ') || 'el puesto';
                const lead = name ? `${name}, quedás retenido` : 'Quedás retenido';
                return `${lead} en ${where}. No abandones el puesto hasta que llegue tu relevo o Operaciones te libere.`;
              })(),
            },
            webpush: {
              notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
              fcmOptions: { link: '/app/' },
            },
          })
          .catch(() => undefined);
      }
    }
  }

  const priorNov = await db
    .collection('novedades')
    .where('absenceShiftId', '==', absenceShiftId)
    .where('type', '==', 'RETENCION_AUSENCIA_RELEVO')
    .limit(1)
    .get();
  if (!gapInFuture && priorNov.empty && retainedIds.length && !toRetain[0].data.isRetention) {
    await db.collection('novedades').add({
      type: 'RETENCION_AUSENCIA_RELEVO',
      status: 'pending',
      title: 'Retención por ausencia de relevo',
      employeeId: toRetain[0].data.employeeId || null,
      employeeName: toRetain[0].data.employeeName || '',
      shiftId: retainedIds[0],
      absenceShiftId,
      objectiveId,
      objectiveName: titularShift.objectiveName || '',
      positionName: titularShift.positionName || '',
      empresaId: titularShift.empresaId || null,
      description: `${toRetain[0].data.employeeName || 'Guardia'} retenido (saliente) por ausencia hasta cobertura.`,
      createdAt: FieldValue.serverTimestamp(),
      reportedBy: opts.reportedBy || 'AUTO',
    });
  }

  return {
    applied: true,
    planned: gapInFuture,
    shiftIds: retainedIds,
    employeeNames: retainedNames,
  };
}

export async function releaseRetentionForAbsenceShift(
  db: Firestore,
  absenceShiftId: string,
  releasedBy: string,
): Promise<number> {
  const aid = String(absenceShiftId || '').trim();
  if (!aid) return 0;
  const snap = await db
    .collection('turnos')
    .where('retentionAbsenceShiftId', '==', aid)
    .limit(10)
    .get();
  if (snap.empty) return 0;

  const ordered = snap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as Record<string, unknown> }))
    .filter((row) => row.data.isCompleted !== true)
    .filter((row) => row.data.isRetention === true || !!row.data.retentionPlannedFor || !!row.data.retentionAbsenceShiftId)
    .filter((row) => !row.data.manualRetentionType)
    .sort((a, b) => checkInMs(a.data) - checkInMs(b.data));
  if (!ordered.length) return 0;

  const batch = db.batch();
  for (const row of ordered) {
    batch.update(row.ref, releasedRetentionPatch(releasedBy));
  }
  await batch.commit();
  return ordered.length;
}

/**
 * Un turno nuevo (o reasignado) del mismo puesto y la misma serie cubre el hueco:
 * suelta la retención real o programada de la ausencia de esa franja.
 */
export async function releaseRetentionsCoveredByShift(
  db: Firestore,
  shift: Record<string, unknown> & { id?: string },
  releasedBy: string,
): Promise<number> {
  if (shift.isAbsent === true || shift.draft === true || shift.isVirtual === true) return 0;
  if (!isReliefEligibleShift(shift)) return 0;
  const employeeId = String(shift.employeeId || '').trim();
  if (!employeeId || employeeId === 'VACANTE' || shift.isUnassigned === true) return 0;
  const objectiveId = String(shift.objectiveId || '').trim();
  const positionName = shift.positionName;
  const start = startMs(shift);
  if (!objectiveId || !positionName || !start) return 0;
  const code = seriesCodeOf(shift);
  const snap = await db
    .collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .where('positionName', '==', positionName)
    .where('startTime', '>=', Timestamp.fromMillis(start - GAP_ALIGN_MS))
    .where('startTime', '<=', Timestamp.fromMillis(start + GAP_ALIGN_MS))
    .get();
  let released = 0;
  for (const docSnap of snap.docs) {
    if (docSnap.id === shift.id) continue;
    const data = docSnap.data() as Record<string, unknown>;
    const absent = data.isAbsent === true || String(data.status || '').toUpperCase() === 'ABSENT';
    if (!absent) continue;
    const theirCode = seriesCodeOf(data);
    if (code && theirCode && code !== theirCode) continue;
    released += await releaseRetentionForAbsenceShift(db, docSnap.id, releasedBy);
  }
  return released;
}

/**
 * Borrado del titular, ausencia revertida o alta de un turno que cubre la franja.
 * Lo llama el trigger de `turnos`.
 */
export async function syncRetentionVinculoOnTurnoWrite(
  db: Firestore,
  shiftId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): Promise<void> {
  if (before && !after) {
    await releaseRetentionForAbsenceShift(db, shiftId, 'TITULAR_BORRADO');
    return;
  }
  if (!after || after.draft === true || after.isVirtual === true) return;
  if (before?.isAbsent === true && after.isAbsent !== true) {
    await releaseRetentionForAbsenceShift(db, shiftId, 'AUSENCIA_REVERTIDA');
  }
  const created = !before;
  const reassigned = !!before && (
    String(before.employeeId || '') !== String(after.employeeId || '')
    || (before.isAbsent === true && after.isAbsent !== true)
  );
  if ((created || reassigned) && after.isAbsent !== true) {
    await releaseRetentionsCoveredByShift(
      db,
      { ...after, id: shiftId },
      created ? 'TURNO_NUEVO_CUBRE' : 'TURNO_REASIGNADO_CUBRE',
    );
  }
}

export function totalShiftMs(data: Record<string, unknown>, nowMs: number): number {
  const ci = checkInMs(data) || startMs(data);
  if (!ci) return 0;
  return Math.max(0, nowMs - ci);
}

export { RETENTION_MAX_TOTAL_MS };

export type ReleaseInvalidRetentionRow = {
  shiftId: string;
  employeeName: string;
  objectiveId: string;
  reason: string;
  action: 'would_release' | 'released';
};

export async function releaseInvalidRetentionsRun(
  db: Firestore,
  opts: { empresaId?: string; dryRun?: boolean },
): Promise<{ rows: ReleaseInvalidRetentionRow[] }> {
  const dryRun = opts.dryRun !== false;
  const empresaFilter = String(opts.empresaId || '').trim();
  let q = db.collection('turnos').where('isRetention', '==', true).limit(400);
  const snap = await q.get();
  const rows: ReleaseInvalidRetentionRow[] = [];
  const slaCache = new Map<string, FirebaseFirestore.DocumentData[]>();

  for (const docSnap of snap.docs) {
    const shift = docSnap.data();
    if (empresaFilter && String(shift.empresaId || '') !== empresaFilter) continue;
    if (shift.isCompleted === true) continue;
    const endMs = (shift.endTime as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (!endMs) continue;
    const oid = String(shift.objectiveId || '');
    if (!slaCache.has(oid)) {
      const slaSnap = await db
        .collection('servicios_sla')
        .where('objectiveId', '==', oid)
        .where('status', '==', 'active')
        .get();
      slaCache.set(oid, slaSnap.docs.map((d) => ({ ...d.data(), id: d.id })));
    }
    const continuous = (slaCache.get(oid) || []).some((sla) =>
      positionHasContinuityFromSlaDoc(sla, shift.positionName || '', new Date(endMs), seriesCodeOf(shift)),
    );
    if (continuous) continue;
    const reason = String(shift.retentionReason || '');
    if (!reason.includes('SIN_RELEVO') && !reason.includes('24H')) continue;

    rows.push({
      shiftId: docSnap.id,
      employeeName: String(shift.employeeName || ''),
      objectiveId: oid,
      reason,
      action: dryRun ? 'would_release' : 'released',
    });

    if (!dryRun) {
      await docSnap.ref.update({
        ...buildAutoClosePatch(shift as Record<string, unknown>, {
          realEndMs: endMs,
          reason: 'SIN_CONTINUIDAD_SLA',
          now: Timestamp.now(),
          by: 'ADMIN_RELEASE_INVALID',
          extra: { requiereRevision: true },
        }),
        isRetention: false,
        retentionReleasedAt: FieldValue.serverTimestamp(),
        releasedBy: 'ADMIN_RELEASE_INVALID',
      });
    }
  }
  return { rows };
}

/** @deprecated usar retainOutgoingForGap */
export async function applyAutoRetentionForAbsenceShift(
  db: Firestore,
  absenceShiftId: string,
  absenceData: Record<string, unknown>,
): Promise<{ applied: boolean; shiftId?: string; employeeName?: string }> {
  const r = await retainOutgoingForGap(
    db,
    { ...absenceData, id: absenceShiftId },
    { sendPush: true, reportedBy: 'AUTO' },
  );
  return {
    applied: r.applied,
    shiftId: r.shiftIds[0],
    employeeName: r.employeeNames[0],
  };
}
