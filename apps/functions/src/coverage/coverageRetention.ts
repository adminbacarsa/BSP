import * as admin from 'firebase-admin';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { positionHasContinuityFromSlaDoc } from './positionHasContinuity';

const GAP_ALIGN_MS = 30 * 60 * 1000;
const RETENTION_MAX_TOTAL_MS = 12 * 60 * 60 * 1000;

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
};

export type RetainOutgoingResult = {
  applied: boolean;
  shiftIds: string[];
  employeeNames: string[];
  skippedReason?: string;
};

/**
 * Retiene al(los) saliente(s) del puesto para cubrir el hueco del titular ausente.
 * Idempotente: una retención activa por titularShiftId (retentionAbsenceShiftId).
 */
export async function retainOutgoingForGap(
  db: Firestore,
  titularShift: Record<string, unknown> & { id?: string },
  opts: RetainOutgoingOpts = {},
): Promise<RetainOutgoingResult> {
  const absenceShiftId = String(titularShift.id || '').trim();
  const objectiveId = String(titularShift.objectiveId || '').trim();
  const positionName = titularShift.positionName;
  const absentEmpId = String(titularShift.employeeId || '').trim();
  const gapStartMs = startMs(titularShift);
  if (!objectiveId || !absenceShiftId || !gapStartMs) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'INVALID_TITULAR' };
  }

  const existing = await db
    .collection('turnos')
    .where('retentionAbsenceShiftId', '==', absenceShiftId)
    .where('isRetention', '==', true)
    .limit(5)
    .get();
  if (!existing.empty) {
    return {
      applied: false,
      shiftIds: existing.docs.map((d) => d.id),
      employeeNames: existing.docs.map((d) => String(d.data().employeeName || '')),
      skippedReason: 'ALREADY_RETAINED_FOR_GAP',
    };
  }

  const presentSnap = await db
    .collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .where('isPresent', '==', true)
    .limit(40)
    .get();

  const outgoing = presentSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter(({ id, data }) => {
      if (id === absenceShiftId) return false;
      if (data.isCompleted === true) return false;
      if (data.isAbsent || data.isVirtual === true) return false;
      if (!posMatch(data.positionName, positionName)) return false;
      const eid = String(data.employeeId || '').trim();
      if (!eid || eid === 'VACANTE' || eid === absentEmpId) return false;
      const st = startMs(data);
      if (st >= gapStartMs + 60_000) return false;
      const en = endMs(data);
      if (!en) return false;
      if (Math.abs(en - gapStartMs) > GAP_ALIGN_MS) return false;
      if (data.isRetention === true && data.retentionAbsenceShiftId !== absenceShiftId) return false;
      return true;
    })
    .sort((a, b) => checkInMs(b.data) - checkInMs(a.data));

  if (!outgoing.length) {
    return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'NO_OUTGOING' };
  }

  const toRetain = [outgoing[0]];
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const retainedIds: string[] = [];
  const retainedNames: string[] = [];

  for (const pick of toRetain) {
    const retEnd = endMs(pick.data);
    const autoAt = Timestamp.fromMillis(Math.max(nowMs, retEnd || nowMs));
    await db.collection('turnos').doc(pick.id).update({
      isRetention: true,
      retentionReason: 'AUSENCIA_RELEVO',
      retentionKind: 'AUSENCIA_RELEVO',
      retentionAbsenceShiftId: absenceShiftId,
      autoRetentionAt: autoAt,
      ...(retEnd ? { retentionEndTime: Timestamp.fromMillis(retEnd) } : {}),
    });
    retainedIds.push(pick.id);
    retainedNames.push(String(pick.data.employeeName || ''));

    if (opts.sendPush !== false) {
      const tokens = await employeePushTokens(db, String(pick.data.employeeId || ''));
      if (tokens.length > 0) {
        await admin
          .messaging()
          .sendEachForMulticast({
            tokens,
            notification: {
              title: 'Quedaste retenido',
              body: `Permanecé en ${titularShift.objectiveName || 'el puesto'} hasta que llegue el relevo.`,
            },
            webpush: {
              notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
              fcmOptions: { link: '/empleado/dashboard' },
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
  if (priorNov.empty && retainedIds.length) {
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
    .where('isRetention', '==', true)
    .limit(10)
    .get();
  if (snap.empty) return 0;

  const ordered = snap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as Record<string, unknown> }))
    .sort((a, b) => checkInMs(a.data) - checkInMs(b.data));

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  for (const row of ordered) {
    batch.update(row.ref, {
      isRetention: false,
      retentionReleasedAt: now,
      releasedBy,
      retentionReason: FieldValue.delete(),
    });
  }
  await batch.commit();
  return ordered.length;
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
  const slaCache = new Map<string, FirebaseFirestore.DocumentData | null>();

  for (const docSnap of snap.docs) {
    const shift = docSnap.data();
    if (empresaFilter && String(shift.empresaId || '') !== empresaFilter) continue;
    const endMs = (shift.endTime as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (!endMs) continue;
    const oid = String(shift.objectiveId || '');
    if (!slaCache.has(oid)) {
      const slaSnap = await db
        .collection('servicios_sla')
        .where('objectiveId', '==', oid)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      slaCache.set(oid, slaSnap.empty ? null : slaSnap.docs[0].data());
    }
    const continuous = positionHasContinuityFromSlaDoc(
      slaCache.get(oid) || undefined,
      shift.positionName || '',
      new Date(endMs),
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
        isRetention: false,
        status: 'COMPLETED',
        isCompleted: true,
        isPresent: false,
        retentionReleasedAt: FieldValue.serverTimestamp(),
        releasedBy: 'ADMIN_RELEASE_INVALID',
        completionReason: 'SIN_CONTINUIDAD_SLA',
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
