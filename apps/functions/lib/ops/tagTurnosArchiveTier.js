"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tagTurnosArchiveTier = tagTurnosArchiveTier;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const dataRetention_1 = require("./dataRetention");
const BATCH_SIZE = 400;
async function tagTurnosArchiveTier(opts) {
    const db = admin.firestore();
    const dryRun = opts?.dryRun === true;
    const maxDocs = opts?.maxDocs ?? 5000;
    const now = new Date();
    const oldestOnline = (0, dataRetention_1.calendarMonthBounds)((0, dataRetention_1.onlineOldestYearMonth)(now)).start;
    const hot = (0, dataRetention_1.hotWindow)(now);
    const byTier = { hot: 0, warm: 0, cold: 0 };
    let scanned = 0;
    let updated = 0;
    let q = db
        .collection('turnos')
        .where('startTime', '<', firestore_1.Timestamp.fromDate(hot.start))
        .orderBy('startTime', 'asc')
        .limit(Math.min(BATCH_SIZE, maxDocs));
    if (opts?.empresaId) {
        q = db
            .collection('turnos')
            .where('empresaId', '==', opts.empresaId)
            .where('startTime', '<', firestore_1.Timestamp.fromDate(hot.start))
            .orderBy('startTime', 'asc')
            .limit(Math.min(BATCH_SIZE, maxDocs));
    }
    const snap = await q.get();
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
        if (ops === 0 || dryRun)
            return;
        await batch.commit();
        batch = db.batch();
        ops = 0;
    };
    for (const doc of snap.docs) {
        if (scanned >= maxDocs)
            break;
        scanned += 1;
        const data = doc.data();
        const start = data.startTime?.toDate?.();
        if (!start)
            continue;
        const tier = (0, dataRetention_1.classifyDate)(start, now);
        byTier[tier] += 1;
        if (data.archiveTier === tier)
            continue;
        updated += 1;
        if (!dryRun) {
            batch.update(doc.ref, {
                archiveTier: tier,
                archiveTaggedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            ops += 1;
            if (ops >= BATCH_SIZE)
                await flush();
        }
    }
    await flush();
    console.info('[tagTurnosArchiveTier]', {
        dryRun,
        scanned,
        updated,
        byTier,
        hotStart: hot.start.toISOString(),
        onlineOldest: oldestOnline.toISOString(),
    });
    return { scanned, updated, byTier, dryRun };
}
//# sourceMappingURL=tagTurnosArchiveTier.js.map