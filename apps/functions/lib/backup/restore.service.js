"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRestoreFromPayload = runRestoreFromPayload;
exports.runRestore = runRestore;
exports.runRestoreFromStorage = runRestoreFromStorage;
const admin = require("firebase-admin");
const assistantEmpresaScope_1 = require("../assistant/assistantEmpresaScope");
const SKIP_DELETE = new Set(['system_backups', 'audit_logs', 'restore_jobs']);
const SKIP_CLONE_COLLECTIONS = new Set(['system_users', 'audit_logs']);
const EMPRESA_SCOPED_COLLECTIONS = new Set([
    'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
    'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
    'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);
const RESTORE_COLLECTION_ORDER = [
    'clients', 'clientes', 'empleados', 'objetivos', 'tipos_turno',
    'servicios_sla', 'contratos_servicio', 'turnos', 'ausencias',
    'novedades', 'swap_requests', 'user_notifications', 'empresas',
];
function collectionSortIndex(name) {
    const i = RESTORE_COLLECTION_ORDER.indexOf(name);
    return i >= 0 ? i : 999;
}
function allocateCloneDocId(db, colName, oldId, idMaps) {
    if (!idMaps[colName])
        idMaps[colName] = new Map();
    const cached = idMaps[colName].get(oldId);
    if (cached)
        return cached;
    const newId = db.collection(colName).doc().id;
    idMaps[colName].set(oldId, newId);
    return newId;
}
function mapForeignId(idMaps, col, value) {
    const v = String(value ?? '').trim();
    if (!v)
        return value;
    const mapped = idMaps[col]?.get(v);
    return mapped ?? value;
}
function remapCloneDocumentFields(colName, data, idMaps, db) {
    const clean = { ...data };
    if (colName === 'turnos') {
        clean.employeeId = mapForeignId(idMaps, 'empleados', clean.employeeId);
        clean.objectiveId = mapForeignId(idMaps, 'objetivos', clean.objectiveId);
    }
    if (colName === 'ausencias' || colName === 'novedades') {
        clean.employeeId = mapForeignId(idMaps, 'empleados', clean.employeeId);
        clean.shiftId = mapForeignId(idMaps, 'turnos', clean.shiftId);
    }
    if (colName === 'servicios_sla' || colName === 'contratos_servicio') {
        clean.clientId = mapForeignId(idMaps, 'clients', clean.clientId);
        clean.objectiveId = mapForeignId(idMaps, 'objetivos', clean.objectiveId);
    }
    if (colName === 'clients' && Array.isArray(clean.objetivos)) {
        clean.objetivos = clean.objetivos.map((row) => {
            if (!row || typeof row !== 'object')
                return row;
            const o = { ...row };
            const oldOid = String(o.id ?? o.objectiveId ?? '').trim();
            if (oldOid) {
                const mapped = allocateCloneDocId(db, 'objetivos', oldOid, idMaps);
                o.id = mapped;
                o.objectiveId = mapped;
            }
            return o;
        });
    }
    return clean;
}
async function deleteDocsWhereEmpresaId(db, colName, empresaId, batchSize) {
    let docsDeleted = 0;
    let last;
    for (;;) {
        let q = db.collection(colName).where('empresaId', '==', empresaId).limit(batchSize);
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
async function deleteDocsWithoutEmpresaId(db, colName, batchSize) {
    let docsDeleted = 0;
    let last;
    for (;;) {
        let q = db.collection(colName).orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);
        if (last)
            q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty)
            break;
        const toDelete = snap.docs.filter((d) => !String(d.data()?.empresaId ?? '').trim());
        if (toDelete.length > 0) {
            const batch = db.batch();
            toDelete.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            docsDeleted += toDelete.length;
        }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < batchSize)
            break;
    }
    return docsDeleted;
}
async function deleteAllDocsInCollection(db, colName, batchSize) {
    const existing = await db.collection(colName).listDocuments();
    let docsDeleted = 0;
    for (let i = 0; i < existing.length; i += batchSize) {
        const batch = db.batch();
        existing.slice(i, i + batchSize).forEach((ref) => batch.delete(ref));
        await batch.commit();
        docsDeleted += Math.min(batchSize, existing.length - i);
    }
    return docsDeleted;
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
    if (opts.tenantImport === true)
        return;
    if (backupScoped && backupEmpresa && backupEmpresa.toLowerCase() !== sessionEmpresa.toLowerCase()) {
        throw new Error('El backup pertenece a otra empresa.');
    }
}
function docIncludedInScopedRestore(colName, doc, opts, platformImport, tenantImport, sourceEmpresaId) {
    if (!opts.scopeEmpresa || !opts.empresaId)
        return true;
    if (colName === 'empresas') {
        if (tenantImport)
            return false;
        return String(doc._id ?? '') === opts.empresaId;
    }
    if (EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
        if (platformImport || tenantImport) {
            if (SKIP_CLONE_COLLECTIONS.has(colName))
                return false;
        }
        if (platformImport) {
            const docEmpresa = String(doc.empresaId ?? '').trim();
            return !docEmpresa || docEmpresa === opts.empresaId;
        }
        if (tenantImport) {
            const docEmpresa = String(doc.empresaId ?? '').trim();
            if (!docEmpresa)
                return true;
            return docEmpresa.toLowerCase() === sourceEmpresaId.toLowerCase();
        }
        return (0, assistantEmpresaScope_1.belongsToEmpresa)(doc, opts.empresaId, true);
    }
    return false;
}
async function deleteCollectionForRestore(db, colName, mode, opts, batchSize) {
    if (mode !== 'full' || SKIP_DELETE.has(colName))
        return 0;
    if (colName === 'empresas')
        return 0;
    if (!EMPRESA_SCOPED_COLLECTIONS.has(colName))
        return 0;
    const empresaId = String(opts.empresaId ?? '').trim();
    if (!empresaId) {
        const empSnap = await db.collection('empresas').limit(2).get();
        if (empSnap.size > 1) {
            throw new Error('Restauración Full sin empresa activa bloqueada: hay varias empresas. Seleccioná la empresa destino en el selector.');
        }
        return deleteAllDocsInCollection(db, colName, batchSize);
    }
    let docsDeleted = 0;
    docsDeleted += await deleteDocsWhereEmpresaId(db, colName, empresaId, batchSize);
    if (empresaId.toLowerCase() === 'bacarsa') {
        docsDeleted += await deleteDocsWithoutEmpresaId(db, colName, batchSize);
    }
    return docsDeleted;
}
async function runRestoreFromPayload(payload, fileName, mode, jobId, opts = {}) {
    const t0 = Date.now();
    const db = admin.firestore();
    assertBackupAllowedForRestore(payload, opts);
    const meta = (payload._meta ?? {});
    const backupEmpresa = String(meta.empresaId ?? '').trim();
    const platformImport = isPlatformBackup(payload) && opts.scopeEmpresa === true && !!opts.empresaId;
    const sourceEmpresaId = String(opts.sourceEmpresaId ?? backupEmpresa).trim();
    const tenantImport = opts.tenantImport === true &&
        opts.scopeEmpresa === true &&
        !!opts.empresaId &&
        !!sourceEmpresaId &&
        sourceEmpresaId.toLowerCase() !== opts.empresaId.toLowerCase();
    const retagEmpresaId = platformImport || tenantImport;
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
        const filtered = docs.filter((doc) => docIncludedInScopedRestore(colName, doc, opts, platformImport, tenantImport, sourceEmpresaId));
        return [colName, filtered];
    })
        .filter(([, docs]) => docs.length > 0)
        .sort((a, b) => collectionSortIndex(a[0]) - collectionSortIndex(b[0]));
    const total = filteredEntries.reduce((acc, [, docs]) => acc + docs.length, 0);
    await setJob({ phase: 'Preparando restauración…', total });
    let docsRestored = 0;
    let docsDeleted = 0;
    const BATCH_SIZE = 400;
    const idMaps = {};
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
                let clean = deserializeFields(fields);
                if (retagEmpresaId && EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
                    clean.empresaId = opts.empresaId;
                    clean = remapCloneDocumentFields(colName, clean, idMaps, db);
                }
                const writeId = retagEmpresaId && EMPRESA_SCOPED_COLLECTIONS.has(colName)
                    ? allocateCloneDocId(db, colName, String(_id), idMaps)
                    : String(_id);
                const ref = db.collection(colName).doc(writeId);
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
        details: tenantImport
            ? `Importación cross-tenant ${sourceEmpresaId} → ${opts.empresaId} (${mode}) desde ${fileName} — ${docsRestored} docs`
            : `Restauración ${mode === 'full' ? 'completa' : 'parcial (merge)'} desde ${fileName} — ${docsRestored} docs`,
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