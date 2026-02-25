"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupExpiredNvrAlerts = void 0;
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const DEFAULT_RETENTION_DAYS = 30;
function ensureAdmin() {
    if (!admin.apps.length)
        admin.initializeApp();
}
function storagePathFromUrl(url) {
    if (!url || typeof url !== 'string')
        return null;
    try {
        const match = url.match(/\/o\/(.+?)(\?|$)/);
        if (!match)
            return null;
        return decodeURIComponent(match[1]);
    }
    catch {
        return null;
    }
}
exports.cleanupExpiredNvrAlerts = (0, scheduler_1.onSchedule)({ schedule: '0 3 * * *', timeZone: 'America/Argentina/Buenos_Aires', timeoutSeconds: 540 }, async () => {
    ensureAdmin();
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    let retentionDays = DEFAULT_RETENTION_DAYS;
    try {
        const settingsSnap = await db.doc('nvr_config/settings').get();
        if (settingsSnap.exists && typeof settingsSnap.data()?.alert_retention_days === 'number') {
            retentionDays = Math.max(1, settingsSnap.data().alert_retention_days);
        }
    }
    catch (e) {
        console.warn('[ALERT_RETENTION] No se pudo leer nvr_config/settings, usando', DEFAULT_RETENTION_DAYS, 'días');
    }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoff);
    const resolved = await db
        .collection('alerts')
        .where('status', 'in', ['acknowledged', 'false_alarm'])
        .where('timestamp', '<', cutoffTimestamp)
        .limit(500)
        .get();
    let deletedFiles = 0;
    let updatedDocs = 0;
    for (const docSnap of resolved.docs) {
        const data = docSnap.data();
        const urls = Array.isArray(data.image_urls)
            ? data.image_urls
            : data.image_url
                ? [data.image_url]
                : [];
        if (urls.length === 0 && !data.image_url)
            continue;
        if (data.images_expired === true)
            continue;
        for (const url of urls) {
            const path = storagePathFromUrl(url);
            if (path) {
                try {
                    await bucket.file(path).delete();
                    deletedFiles++;
                }
                catch (e) {
                    const err = e;
                    if (err?.code !== 404)
                        console.warn('[ALERT_RETENTION] No se pudo borrar', path, err);
                }
            }
        }
        await docSnap.ref.update({
            image_url: null,
            image_urls: [],
            images_expired: true,
            retention_cleaned_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        updatedDocs++;
    }
    if (updatedDocs > 0) {
        console.log('[ALERT_RETENTION] Limpieza:', updatedDocs, 'alertas actualizadas,', deletedFiles, 'archivos borrados de Storage. Retención:', retentionDays, 'días.');
    }
});
//# sourceMappingURL=alertRetention.js.map