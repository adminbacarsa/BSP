"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.advanceSlaUnplannedGap = advanceSlaUnplannedGap;
exports.runSlaUnplannedGapPass = runSlaUnplannedGapPass;
const firestore_1 = require("firebase-admin/firestore");
const coverageRetention_1 = require("./coverageRetention");
async function advanceSlaUnplannedGap(db, gap, now = firestore_1.Timestamp.now()) {
    const gapId = String(gap.id || '').trim();
    const gapRef = gapId ? db.collection('sla_huecos_sin_plan').doc(gapId) : null;
    const startMs = gap.gapStart.toMillis();
    const nowMs = now.toMillis();
    const minutesUntil = (startMs - nowMs) / 60000;
    if (gap.status === 'CLOSED')
        return { phase: 'CLOSED' };
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
                createdAt: firestore_1.FieldValue.serverTimestamp(),
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
        await (0, coverageRetention_1.retainOutgoingForGap)(db, {
            id: gapId,
            empresaId: gap.empresaId,
            objectiveId: gap.objectiveId,
            positionName: gap.positionName,
            employeeId: 'VACANTE',
            startTime: gap.gapStart,
            endTime: gap.gapEnd,
            code: gap.bandCode || 'M',
        });
        if (gapRef)
            await gapRef.update({ retentionAppliedAt: now });
        return { phase: 'RETENTION_AT_GAP' };
    }
    return { phase: 'RETENTION_DONE' };
}
async function runSlaUnplannedGapPass(db, opts) {
    const limit = opts?.limit ?? 40;
    let q = db
        .collection('sla_huecos_sin_plan')
        .where('status', '==', 'OPEN')
        .limit(limit);
    if (opts?.empresaId) {
        q = q.where('empresaId', '==', opts.empresaId);
    }
    const snap = await q.get();
    let n = 0;
    for (const d of snap.docs) {
        const data = d.data();
        await advanceSlaUnplannedGap(db, { ...data, id: d.id, gapStart: data.gapStart, gapEnd: data.gapEnd });
        n += 1;
    }
    return n;
}
//# sourceMappingURL=slaUnplannedGapPass.js.map