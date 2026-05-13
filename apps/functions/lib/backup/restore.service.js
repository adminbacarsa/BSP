"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRestore = runRestore;
const admin = require("firebase-admin");
async function runRestore(driveFileId, mode, jobId) {
    const t0 = Date.now();
    const db = admin.firestore();
    const setJob = (data) => {
        if (!jobId)
            return Promise.resolve();
        return db.collection('restore_jobs').doc(jobId).set(data, { merge: true });
    };
    await setJob({ status: 'running', phase: 'Descargando backup de Drive…', docsRestored: 0, total: 0, startedAt: admin.firestore.FieldValue.serverTimestamp() });
    const { google } = await Promise.resolve().then(() => require('googleapis'));
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const fileMetaRes = await drive.files.get({
        fileId: driveFileId,
        fields: 'name',
        supportsAllDrives: true,
    });
    const fileName = fileMetaRes.data.name || driveFileId;
    const fileRes = await drive.files.get({ fileId: driveFileId, alt: 'media', supportsAllDrives: true }, { responseType: 'text' });
    const raw = fileRes.data;
    const payload = JSON.parse(raw);
    const { _meta, ...collections } = payload;
    const SKIP_DELETE = new Set(['system_backups', 'audit_logs', 'restore_jobs']);
    const colEntries = Object.entries(collections).filter(([, docs]) => Array.isArray(docs) && docs.length > 0);
    const total = colEntries.reduce((acc, [, docs]) => acc + docs.length, 0);
    await setJob({ phase: 'Preparando restauración…', total });
    let docsRestored = 0;
    let docsDeleted = 0;
    const BATCH_SIZE = 400;
    for (let ci = 0; ci < colEntries.length; ci++) {
        const [colName, docs] = colEntries[ci];
        await setJob({ phase: `Restaurando ${colName} (${ci + 1}/${colEntries.length})…`, docsRestored });
        if (mode === 'full' && !SKIP_DELETE.has(colName)) {
            const existing = await db.collection(colName).listDocuments();
            for (let i = 0; i < existing.length; i += BATCH_SIZE) {
                const batch = db.batch();
                existing.slice(i, i + BATCH_SIZE).forEach(ref => batch.delete(ref));
                await batch.commit();
                docsDeleted += Math.min(BATCH_SIZE, existing.length - i);
            }
        }
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = docs.slice(i, i + BATCH_SIZE);
            let written = 0;
            chunk.forEach(doc => {
                const { _id, ...fields } = doc;
                if (!_id)
                    return;
                const clean = deserializeFields(fields);
                const ref = db.collection(colName).doc(_id);
                if (mode === 'full') {
                    batch.set(ref, clean);
                }
                else {
                    batch.set(ref, clean, { merge: true });
                }
                written++;
            });
            await batch.commit();
            docsRestored += written;
        }
    }
    await setJob({ status: 'done', phase: 'Completado', docsRestored, total });
    await db.collection('audit_logs').add({
        action: 'RESTORE_BACKUP',
        module: 'SISTEMA',
        actorName: 'Admin',
        details: `Restauración ${mode === 'full' ? 'completa' : 'parcial (merge)'} desde ${fileName} — ${docsRestored} docs`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
        mode,
        fileName,
        collections: Object.keys(collections),
        docsRestored,
        docsDeleted,
        durationMs: Date.now() - t0,
    };
}
function deserializeFields(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map(deserializeFields);
    if (typeof obj._seconds === 'number' && typeof obj._nanoseconds === 'number') {
        return new admin.firestore.Timestamp(obj._seconds, obj._nanoseconds);
    }
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        result[k] = deserializeFields(v);
    }
    return result;
}
//# sourceMappingURL=restore.service.js.map