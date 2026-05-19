"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRestoreFromPayload = runRestoreFromPayload;
exports.runRestore = runRestore;
exports.runRestoreFromStorage = runRestoreFromStorage;
const admin = require("firebase-admin");
const assistantEmpresaScope_1 = require("../assistant/assistantEmpresaScope");
const SKIP_DELETE = new Set(['system_backups', 'audit_logs', 'restore_jobs']);
const EMPRESA_SCOPED_COLLECTIONS = new Set([
    'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
    'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
    'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);
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
function isPlatformBackup(payload) {
    const meta = (payload._meta ?? {});
    const backupEmpresa = String(meta.empresaId ?? '').trim();
    return !backupEmpresa && meta.scopeEmpresa !== true;
}
function assertBackupAllowedForRestore(payload, opts) {
    const meta = (payload._meta ?? {});
    const backupEmpresa = String(meta.empresaId ?? '').trim();
    const backupScoped = meta.scopeEmpresa === true;
    const sessionEmpresa = String(opts.empresaId ?? '').trim();
    if (!opts.scopeEmpresa || !sessionEmpresa)
        return;
    if (backupScoped && backupEmpresa && backupEmpresa.toLowerCase() !== sessionEmpresa.toLowerCase()) {
        throw new Error('El backup pertenece a otra empresa.');
    }
}
function docIncludedInScopedRestore(colName, doc, opts, platformImport) {
    if (!opts.scopeEmpresa || !opts.empresaId)
        return true;
    if (colName === 'empresas') {
        return String(doc._id ?? '') === opts.empresaId;
    }
    if (EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
        if (platformImport) {
            const docEmpresa = String(doc.empresaId ?? '').trim();
            return !docEmpresa || docEmpresa === opts.empresaId;
        }
        return (0, assistantEmpresaScope_1.belongsToEmpresa)(doc, opts.empresaId, true);
    }
    return false;
}
async function deleteCollectionForRestore(db, colName, mode, opts, batchSize) {
    if (mode !== 'full' || SKIP_DELETE.has(colName))
        return 0;
    let docsDeleted = 0;
    if (opts.scopeEmpresa && opts.empresaId) {
        if (colName === 'empresas') {
            const ref = db.collection('empresas').doc(opts.empresaId);
            const snap = await ref.get();
            if (snap.exists) {
                await ref.delete();
                docsDeleted += 1;
            }
            return docsDeleted;
        }
        if (!EMPRESA_SCOPED_COLLECTIONS.has(colName))
            return 0;
        let last;
        for (;;) {
            let q = db.collection(colName).where('empresaId', '==', opts.empresaId).limit(batchSize);
            if (last)
                q = q.startAfter(last);
            const snap = await q.get();
            if (snap.empty)
                break;
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            docsDeleted += snap.size;
            last = snap.docs[snap.docs.length - 1];
            if (snap.size < batchSize)
                break;
        }
        return docsDeleted;
    }
    const existing = await db.collection(colName).listDocuments();
    for (let i = 0; i < existing.length; i += batchSize) {
        const batch = db.batch();
        existing.slice(i, i + batchSize).forEach((ref) => batch.delete(ref));
        await batch.commit();
        docsDeleted += Math.min(batchSize, existing.length - i);
    }
    return docsDeleted;
}
async function runRestoreFromPayload(payload, fileName, mode, jobId, opts = {}) {
    const t0 = Date.now();
    const db = admin.firestore();
    assertBackupAllowedForRestore(payload, opts);
    const platformImport = isPlatformBackup(payload) && opts.scopeEmpresa === true && !!opts.empresaId;
    const setJob = (data) => {
        if (!jobId)
            return Promise.resolve();
        return db.collection('restore_jobs').doc(jobId).set(data, { merge: true });
    };
    await setJob({ status: 'running', phase: 'Preparando restauración…', docsRestored: 0, total: 0, startedAt: admin.firestore.FieldValue.serverTimestamp() });
    const { _meta, _auth_users, ...collections } = payload;
    const colEntries = Object.entries(collections).filter(([, docs]) => Array.isArray(docs) && docs.length > 0);
    const filteredEntries = colEntries
        .map(([colName, docs]) => {
        const filtered = docs.filter((doc) => docIncludedInScopedRestore(colName, doc, opts, platformImport));
        return [colName, filtered];
    })
        .filter(([, docs]) => docs.length > 0);
    const total = filteredEntries.reduce((acc, [, docs]) => acc + docs.length, 0);
    await setJob({ phase: 'Preparando restauración…', total });
    let docsRestored = 0;
    let docsDeleted = 0;
    const BATCH_SIZE = 400;
    for (let ci = 0; ci < filteredEntries.length; ci++) {
        const [colName, docs] = filteredEntries[ci];
        await setJob({ phase: `Restaurando ${colName} (${ci + 1}/${filteredEntries.length})…`, docsRestored });
        docsDeleted += await deleteCollectionForRestore(db, colName, mode, opts, BATCH_SIZE);
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = docs.slice(i, i + BATCH_SIZE);
            let written = 0;
            chunk.forEach((doc) => {
                const { _id, ...fields } = doc;
                if (!_id)
                    return;
                const clean = deserializeFields(fields);
                if (platformImport && EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
                    clean.empresaId = opts.empresaId;
                }
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
        ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
    });
    return {
        mode,
        fileName,
        collections: filteredEntries.map(([c]) => c),
        docsRestored,
        docsDeleted,
        durationMs: Date.now() - t0,
    };
}
async function runRestore(driveFileId, mode, jobId, opts = {}) {
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
    const payload = JSON.parse(fileRes.data);
    return runRestoreFromPayload(payload, fileName, mode, jobId, opts);
}
async function runRestoreFromStorage(storagePath, fileName, mode, jobId, opts = {}) {
    const bucket = admin.storage().bucket();
    const [buf] = await bucket.file(storagePath).download();
    const payload = JSON.parse(buf.toString('utf8'));
    try {
        return await runRestoreFromPayload(payload, fileName, mode, jobId, opts);
    }
    finally {
        bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
}
//# sourceMappingURL=restore.service.js.map