"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRestore = runRestore;
const admin = require("firebase-admin");
async function runRestore(driveFileId, mode) {
    const t0 = Date.now();
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
    const db = admin.firestore();
    let docsRestored = 0;
    let docsDeleted = 0;
    const BATCH_SIZE = 400;
    for (const [colName, docs] of Object.entries(collections)) {
        if (!Array.isArray(docs) || docs.length === 0)
            continue;
        if (mode === 'full') {
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
            chunk.forEach(doc => {
                const { _id, ...fields } = doc;
                const clean = deserializeFields(fields);
                const ref = db.collection(colName).doc(_id);
                if (mode === 'full') {
                    batch.set(ref, clean);
                }
                else {
                    batch.set(ref, clean, { merge: true });
                }
            });
            await batch.commit();
            docsRestored += chunk.length;
        }
    }
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