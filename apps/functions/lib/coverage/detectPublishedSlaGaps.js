"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPublishedSlaGapsForEmpresa = detectPublishedSlaGapsForEmpresa;
exports.runDetectPublishedSlaGaps = runDetectPublishedSlaGaps;
const firestore_1 = require("firebase-admin/firestore");
const planificacionEstadoKeys_1 = require("../assistant/planificacionEstadoKeys");
const TZ = 'America/Argentina/Cordoba';
function weekdayLetter(d) {
    const en = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ });
    const map = {
        Mon: 'L', Tue: 'M', Wed: 'X', Thu: 'J', Fri: 'V', Sat: 'S', Sun: 'D',
    };
    return map[en] || 'L';
}
function ymdAr(d) {
    return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
function bandStartMsOnDay(dayYmd, hm) {
    const [y, m, d] = dayYmd.split('-').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    const utcGuess = Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0);
    return utcGuess;
}
function normPos(n) {
    return String(n ?? '').trim().toLowerCase();
}
async function isPlanPublished(db, objectiveId, when) {
    const { year, month } = (0, planificacionEstadoKeys_1.ymCordobaParts)(when);
    const planKey = `${objectiveId}_${year}_${month}`;
    const pub = await db.collection('planificacion_estados').doc(planKey).get();
    if (!pub.exists)
        return false;
    const publishedAt = pub.data()?.publishedAt;
    return publishedAt != null && publishedAt !== '';
}
async function detectPublishedSlaGapsForEmpresa(db, empresaId, now = firestore_1.Timestamp.now()) {
    const eid = String(empresaId || '').trim();
    if (!eid)
        return 0;
    const nowMs = now.toMillis();
    const horizonMs = nowMs + 24 * 3600000;
    const slaSnap = await db
        .collection('servicios_sla')
        .where('empresaId', '==', eid)
        .where('status', '==', 'active')
        .limit(120)
        .get();
    let created = 0;
    const daySet = new Set();
    for (let ms = nowMs; ms < horizonMs; ms += 3600000) {
        daySet.add(ymdAr(new Date(ms)));
    }
    for (const slaDoc of slaSnap.docs) {
        const sla = slaDoc.data();
        const objectiveId = String(sla.objectiveId || '').trim();
        if (!objectiveId)
            continue;
        if (!(await isPlanPublished(db, objectiveId, new Date(nowMs))))
            continue;
        const positions = Array.isArray(sla.positions) ? sla.positions : [];
        const turnoSnap = await db
            .collection('turnos')
            .where('objectiveId', '==', objectiveId)
            .where('startTime', '>=', now)
            .where('startTime', '<=', firestore_1.Timestamp.fromMillis(horizonMs))
            .get();
        const planned = turnoSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((t) => t.draft !== true && t.employeeId && t.employeeId !== 'VACANTE');
        for (const pos of positions) {
            if (pos?.status === 'INACTIVE')
                continue;
            const posName = String(pos.name || '').trim();
            if (!posName)
                continue;
            const qty = Math.max(1, Number(pos.quantity) || 1);
            const activeDays = Array.isArray(pos.activeDays)
                ? pos.activeDays
                : ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
            const bands = Array.isArray(pos.allowedShiftTypes) ? pos.allowedShiftTypes : [];
            if (bands.length === 0)
                continue;
            for (const dayStr of daySet) {
                const dayDate = new Date(bandStartMsOnDay(dayStr, '12:00'));
                if (!activeDays.includes(weekdayLetter(dayDate)))
                    continue;
                for (const band of bands) {
                    const code = String(band.code || '').toUpperCase();
                    if (!code || ['F', 'FF', 'FP', 'FT'].includes(code))
                        continue;
                    const hm = String(band.startTime || '07:00').slice(0, 5);
                    const gapStartMs = bandStartMsOnDay(dayStr, hm);
                    if (gapStartMs < nowMs || gapStartMs > horizonMs)
                        continue;
                    const count = planned.filter((t) => {
                        const st = t.startTime?.toMillis?.() ?? 0;
                        if (!st)
                            return false;
                        if (ymdAr(new Date(st)) !== dayStr)
                            return false;
                        if (String(t.code || '').toUpperCase() !== code)
                            return false;
                        return normPos(t.positionName) === normPos(posName)
                            || normPos(t.positionName).endsWith(normPos(posName));
                    }).length;
                    if (count >= qty)
                        continue;
                    const gapId = `gap_${eid}_${objectiveId}_${normPos(posName)}_${dayStr}_${code}`
                        .replace(/[^a-zA-Z0-9_-]/g, '_')
                        .slice(0, 120);
                    const gapRef = db.collection('sla_huecos_sin_plan').doc(gapId);
                    const exist = await gapRef.get();
                    if (exist.exists)
                        continue;
                    const hours = Number(band.hours) || (code.includes('12') ? 12 : 8);
                    await gapRef.set({
                        empresaId: eid,
                        objectiveId,
                        objectiveName: sla.objectiveName || sla.name || '',
                        clientId: sla.clientId || null,
                        clientName: sla.clientName || null,
                        positionName: posName,
                        bandCode: code,
                        gapStart: firestore_1.Timestamp.fromMillis(gapStartMs),
                        gapEnd: firestore_1.Timestamp.fromMillis(gapStartMs + hours * 3600000),
                        status: 'OPEN',
                        detectedAt: now,
                        source: 'DETECT_SLA_GAPS',
                    });
                    created += 1;
                }
            }
        }
    }
    return created;
}
async function runDetectPublishedSlaGaps(db, opts) {
    const empSnap = await db.collection('empresas').get();
    let total = 0;
    for (const e of empSnap.docs) {
        if (!opts.isEnabled(e.id))
            continue;
        if (opts.isDemo(e.id))
            continue;
        total += await detectPublishedSlaGapsForEmpresa(db, e.id);
    }
    return total;
}
//# sourceMappingURL=detectPublishedSlaGaps.js.map