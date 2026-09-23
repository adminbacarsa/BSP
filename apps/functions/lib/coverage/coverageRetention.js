"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETENTION_MAX_TOTAL_MS = void 0;
exports.retainOutgoingForGap = retainOutgoingForGap;
exports.releaseRetentionForAbsenceShift = releaseRetentionForAbsenceShift;
exports.totalShiftMs = totalShiftMs;
exports.releaseInvalidRetentionsRun = releaseInvalidRetentionsRun;
exports.applyAutoRetentionForAbsenceShift = applyAutoRetentionForAbsenceShift;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const positionHasContinuity_1 = require("./positionHasContinuity");
const GAP_ALIGN_MS = 30 * 60 * 1000;
const RETENTION_MAX_TOTAL_MS = 12 * 60 * 60 * 1000;
exports.RETENTION_MAX_TOTAL_MS = RETENTION_MAX_TOTAL_MS;
const normPos = (n) => String(n ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^puesto\s+/, '');
const posMatch = (a, b) => {
    const na = normPos(a);
    const nb = normPos(b);
    if (!na || !nb)
        return false;
    if (na === nb)
        return true;
    if (na.endsWith(nb) || nb.endsWith(na))
        return true;
    return false;
};
const checkInMs = (data) => {
    const real = data.realStartTime;
    if (real?.toMillis)
        return real.toMillis();
    const ci = data.checkInTime;
    if (ci?.toMillis)
        return ci.toMillis();
    const pres = data.presenciaAt;
    if (pres?.toMillis)
        return pres.toMillis();
    return 0;
};
const endMs = (data) => {
    const et = data.endTime;
    return et?.toMillis?.() ?? 0;
};
const startMs = (data) => {
    const st = data.startTime;
    return st?.toMillis?.() ?? 0;
};
async function employeePushTokens(db, employeeId) {
    if (!employeeId || employeeId === 'VACANTE')
        return [];
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    const authUid = empDoc.data()?.uid;
    if (!authUid)
        return [];
    const tokenSnap = await db.collection('device_tokens').where('uid', '==', authUid).get();
    return tokenSnap.docs
        .map((d) => d.data()?.token)
        .filter((t) => typeof t === 'string' && t.length > 10);
}
async function retainOutgoingForGap(db, titularShift, opts = {}) {
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
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter(({ id, data }) => {
        if (id === absenceShiftId)
            return false;
        if (data.isCompleted === true)
            return false;
        if (data.isAbsent || data.isVirtual === true)
            return false;
        if (!posMatch(data.positionName, positionName))
            return false;
        const eid = String(data.employeeId || '').trim();
        if (!eid || eid === 'VACANTE' || eid === absentEmpId)
            return false;
        const st = startMs(data);
        if (st >= gapStartMs + 60_000)
            return false;
        const en = endMs(data);
        if (!en)
            return false;
        if (Math.abs(en - gapStartMs) > GAP_ALIGN_MS)
            return false;
        if (data.isRetention === true && data.retentionAbsenceShiftId !== absenceShiftId)
            return false;
        return true;
    })
        .sort((a, b) => checkInMs(b.data) - checkInMs(a.data));
    if (!outgoing.length) {
        return { applied: false, shiftIds: [], employeeNames: [], skippedReason: 'NO_OUTGOING' };
    }
    const toRetain = [outgoing[0]];
    const now = firestore_1.Timestamp.now();
    const nowMs = now.toMillis();
    const retainedIds = [];
    const retainedNames = [];
    for (const pick of toRetain) {
        const retEnd = endMs(pick.data);
        const autoAt = firestore_1.Timestamp.fromMillis(Math.max(nowMs, retEnd || nowMs));
        await db.collection('turnos').doc(pick.id).update({
            isRetention: true,
            retentionReason: 'AUSENCIA_RELEVO',
            retentionKind: 'AUSENCIA_RELEVO',
            retentionAbsenceShiftId: absenceShiftId,
            autoRetentionAt: autoAt,
            ...(retEnd ? { retentionEndTime: firestore_1.Timestamp.fromMillis(retEnd) } : {}),
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
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            reportedBy: opts.reportedBy || 'AUTO',
        });
    }
    return {
        applied: true,
        shiftIds: retainedIds,
        employeeNames: retainedNames,
    };
}
async function releaseRetentionForAbsenceShift(db, absenceShiftId, releasedBy) {
    const aid = String(absenceShiftId || '').trim();
    if (!aid)
        return 0;
    const snap = await db
        .collection('turnos')
        .where('retentionAbsenceShiftId', '==', aid)
        .where('isRetention', '==', true)
        .limit(10)
        .get();
    if (snap.empty)
        return 0;
    const ordered = snap.docs
        .map((d) => ({ ref: d.ref, data: d.data() }))
        .sort((a, b) => checkInMs(a.data) - checkInMs(b.data));
    const batch = db.batch();
    const now = firestore_1.FieldValue.serverTimestamp();
    for (const row of ordered) {
        batch.update(row.ref, {
            isRetention: false,
            retentionReleasedAt: now,
            releasedBy,
            retentionReason: firestore_1.FieldValue.delete(),
        });
    }
    await batch.commit();
    return ordered.length;
}
function totalShiftMs(data, nowMs) {
    const ci = checkInMs(data) || startMs(data);
    if (!ci)
        return 0;
    return Math.max(0, nowMs - ci);
}
async function releaseInvalidRetentionsRun(db, opts) {
    const dryRun = opts.dryRun !== false;
    const empresaFilter = String(opts.empresaId || '').trim();
    let q = db.collection('turnos').where('isRetention', '==', true).limit(400);
    const snap = await q.get();
    const rows = [];
    const slaCache = new Map();
    for (const docSnap of snap.docs) {
        const shift = docSnap.data();
        if (empresaFilter && String(shift.empresaId || '') !== empresaFilter)
            continue;
        const endMs = shift.endTime?.toMillis?.() ?? 0;
        if (!endMs)
            continue;
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
        const continuous = (0, positionHasContinuity_1.positionHasContinuityFromSlaDoc)(slaCache.get(oid) || undefined, shift.positionName || '', new Date(endMs));
        if (continuous)
            continue;
        const reason = String(shift.retentionReason || '');
        if (!reason.includes('SIN_RELEVO') && !reason.includes('24H'))
            continue;
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
                retentionReleasedAt: firestore_1.FieldValue.serverTimestamp(),
                releasedBy: 'ADMIN_RELEASE_INVALID',
                completionReason: 'SIN_CONTINUIDAD_SLA',
            });
        }
    }
    return { rows };
}
async function applyAutoRetentionForAbsenceShift(db, absenceShiftId, absenceData) {
    const r = await retainOutgoingForGap(db, { ...absenceData, id: absenceShiftId }, { sendPush: true, reportedBy: 'AUTO' });
    return {
        applied: r.applied,
        shiftId: r.shiftIds[0],
        employeeName: r.employeeNames[0],
    };
}
//# sourceMappingURL=coverageRetention.js.map