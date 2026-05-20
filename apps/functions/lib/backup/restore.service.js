"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESTORE_COLLECTION_ORDER = void 0;
exports.serializeIdMaps = serializeIdMaps;
exports.deserializeIdMaps = deserializeIdMaps;
exports.downloadBackupPayloadFromStorage = downloadBackupPayloadFromStorage;
exports.deleteBackupStorageFile = deleteBackupStorageFile;
exports.allocateCloneDocId = allocateCloneDocId;
exports.remapCloneDocumentFields = remapCloneDocumentFields;
exports.deleteDocsWhereEmpresaId = deleteDocsWhereEmpresaId;
exports.runRestoreFromPayload = runRestoreFromPayload;
exports.runRestore = runRestore;
exports.runRestoreFromStorage = runRestoreFromStorage;
const admin = require("firebase-admin");
const assistantEmpresaScope_1 = require("../assistant/assistantEmpresaScope");
function serializeIdMaps(idMaps) {
    const out = {};
    for (const [col, map] of Object.entries(idMaps)) {
        out[col] = Object.fromEntries(map.entries());
    }
    return out;
}
function deserializeIdMaps(raw) {
    const idMaps = {};
    if (!raw || typeof raw !== 'object')
        return idMaps;
    for (const [col, entries] of Object.entries(raw)) {
        idMaps[col] = new Map(Object.entries(entries ?? {}));
    }
    return idMaps;
}
async function downloadBackupPayloadFromStorage(storagePath) {
    const bucket = admin.storage().bucket(getBackupStorageBucketName());
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
        throw new Error('El archivo de backup no está en Storage. Volvé a subir el JSON y confirmá la restauración de inmediato.');
    }
    const [buf] = await file.download();
    return JSON.parse(buf.toString('utf8'));
}
async function deleteBackupStorageFile(storagePath) {
    const bucket = admin.storage().bucket(getBackupStorageBucketName());
    await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
}
function getBackupStorageBucketName() {
    const fromEnv = String(process.env.FIREBASE_STORAGE_BUCKET ?? process.env.GCLOUD_STORAGE_BUCKET ?? '').trim();
    if (fromEnv)
        return fromEnv;
    const projectId = String(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'comtroldata').trim();
    return `${projectId}.firebasestorage.app`;
}
const SKIP_DELETE = new Set(['system_backups', 'audit_logs', 'restore_jobs']);
const SKIP_CLONE_COLLECTIONS = new Set(['system_users', 'audit_logs']);
const EMPRESA_SCOPED_COLLECTIONS = new Set([
    'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
    'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
    'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);
exports.RESTORE_COLLECTION_ORDER = [
    'clients', 'clientes', 'empleados', 'objetivos', 'tipos_turno',
    'servicios_sla', 'contratos_servicio', 'turnos', 'ausencias',
    'novedades', 'swap_requests', 'user_notifications', 'planificacion_estados',
    'empresas',
];
function collectionSortIndex(name) {
    const i = exports.RESTORE_COLLECTION_ORDER.indexOf(name);
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
        return undefined;
    const mapped = idMaps[col]?.get(v);
    return mapped ?? value;
}
function setMappedForeignField(target, key, idMaps, col, value) {
    const mapped = mapForeignId(idMaps, col, value);
    if (mapped === undefined)
        delete target[key];
    else
        target[key] = mapped;
}
function remapCloneDocumentFields(colName, data, idMaps, db) {
    const clean = { ...data };
    if (colName === 'turnos') {
        setMappedForeignField(clean, 'employeeId', idMaps, 'empleados', clean.employeeId);
        setMappedForeignField(clean, 'objectiveId', idMaps, 'objetivos', clean.objectiveId);
        setMappedForeignField(clean, 'clientId', idMaps, 'clients', clean.clientId);
    }
    if (colName === 'ausencias' || colName === 'novedades') {
        setMappedForeignField(clean, 'employeeId', idMaps, 'empleados', clean.employeeId);
        setMappedForeignField(clean, 'shiftId', idMaps, 'turnos', clean.shiftId);
    }
    if (colName === 'servicios_sla' || colName === 'contratos_servicio') {
        setMappedForeignField(clean, 'clientId', idMaps, 'clients', clean.clientId);
        setMappedForeignField(clean, 'objectiveId', idMaps, 'objetivos', clean.objectiveId);
    }
    if (colName === 'planificacion_estados') {
        setMappedForeignField(clean, 'objetivoId', idMaps, 'objetivos', clean.objetivoId);
        setMappedForeignField(clean, 'objectiveId', idMaps, 'objetivos', clean.objectiveId);
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
function sanitizeForFirestore(obj) {
    if (obj === undefined)
        return undefined;
    if (obj === null)
        return null;
    if (obj instanceof admin.firestore.Timestamp)
        return obj;
    if (obj instanceof admin.firestore.GeoPoint)
        return obj;
    if (Array.isArray(obj)) {
        return obj.map((item) => sanitizeForFirestore(item)).filter((item) => item !== undefined);
    }
    if (typeof obj !== 'object')
        return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined)
            continue;
        const sanitized = sanitizeForFirestore(v);
        if (sanitized !== undefined)
            out[k] = sanitized;
    }
    return out;
}
async function writeCollectionWithBulkWriter(db, colName, docs, mode, retagEmpresaId, opts, idMaps, ci, totalCollections, total, setJob, docsRestored) {
    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((error) => {
        console.error('[restore] write error', error.documentRef.path, error.message);
        if (error.failedAttempts < 12)
            return true;
        return false;
    });
    let lastReport = docsRestored.count;
    for (const doc of docs) {
        const { _id, ...fields } = doc;
        if (!_id)
            continue;
        let clean = sanitizeForFirestore(deserializeFields(fields));
        if (retagEmpresaId && EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
            clean.empresaId = opts.empresaId;
            clean = sanitizeForFirestore(remapCloneDocumentFields(colName, clean, idMaps, db));
        }
        const writeId = retagEmpresaId && EMPRESA_SCOPED_COLLECTIONS.has(colName)
            ? allocateCloneDocId(db, colName, String(_id), idMaps)
            : String(_id);
        const ref = db.collection(colName).doc(writeId);
        bulkWriter.set(ref, clean, { merge: mode === 'merge' });
        docsRestored.count += 1;
        if (docsRestored.count - lastReport >= 250) {
            lastReport = docsRestored.count;
            await setJob({
                phase: `Restaurando ${colName} (${ci + 1}/${totalCollections})…`,
                docsRestored: docsRestored.count,
                total,
            });
        }
    }
    await bulkWriter.close();
    await setJob({
        phase: `Restaurando ${colName} (${ci + 1}/${totalCollections})…`,
        docsRestored: docsRestored.count,
        total,
    });
}
function isPlatformBackup(payload) {
    const meta = (payload._meta ?? {});
    const backupEmpresa = String(meta.empresaId ?? '').trim();
    return !backupEmpresa && meta.scopeEmpresa !== true;
}
const DETECT_EMPRESA_COLS = ['clients', 'empleados', 'turnos', 'servicios_sla', 'ausencias', 'novedades'];
function detectDominantEmpresaInPayload(payload) {
    const counts = new Map();
    let legacyCount = 0;
    for (const col of DETECT_EMPRESA_COLS) {
        const rows = payload[col];
        if (!Array.isArray(rows))
            continue;
        for (const row of rows) {
            if (!row || typeof row !== 'object')
                continue;
            const emp = String(row.empresaId ?? '').trim();
            if (!emp) {
                legacyCount += 1;
                continue;
            }
            counts.set(emp, (counts.get(emp) || 0) + 1);
        }
    }
    let empresaId = '';
    let max = 0;
    counts.forEach((n, id) => {
        if (n > max) {
            max = n;
            empresaId = id;
        }
    });
    return { empresaId, legacyCount };
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
async function runRestoreFromPayload(payload, fileName, mode, jobId, opts = {}, partial = {}) {
    const t0 = Date.now();
    const db = admin.firestore();
    const meta = (payload._meta ?? {});
    const backupEmpresa = String(meta.empresaId ?? '').trim();
    const sessionEmpresa = String(opts.empresaId ?? '').trim();
    const detected = detectDominantEmpresaInPayload(payload);
    let inferredSource = backupEmpresa || detected.empresaId;
    if (!inferredSource && detected.legacyCount > 0) {
        inferredSource = 'bacarsa';
    }
    if (opts.scopeEmpresa &&
        sessionEmpresa &&
        inferredSource &&
        inferredSource.toLowerCase() !== sessionEmpresa.toLowerCase()) {
        opts.tenantImport = true;
        opts.sourceEmpresaId = opts.sourceEmpresaId || inferredSource;
    }
    assertBackupAllowedForRestore(payload, opts);
    const platformImport = isPlatformBackup(payload) && opts.scopeEmpresa === true && !!opts.empresaId;
    const sourceEmpresaId = String(opts.sourceEmpresaId ?? backupEmpresa).trim();
    const tenantImport = opts.tenantImport === true &&
        opts.scopeEmpresa === true &&
        !!opts.empresaId &&
        !!sourceEmpresaId &&
        sourceEmpresaId.toLowerCase() !== opts.empresaId.toLowerCase();
    const retagEmpresaId = platformImport || tenantImport;
    const effectiveMode = tenantImport && mode === 'merge' ? 'full' : mode;
    const setJob = (data) => {
        if (!jobId)
            return Promise.resolve();
        return db.collection('restore_jobs').doc(jobId).set(data, { merge: true });
    };
    let docsRestored = 0;
    let docsDeleted = 0;
    let total = 0;
    try {
        if ((partial.startColIndex ?? 0) === 0) {
            await setJob({ status: 'running', phase: 'Preparando restauración…', docsRestored: partial.docsRestored ?? 0, total: 0, startedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        const { _meta, _auth_users, ...collections } = payload;
        const colEntries = Object.entries(collections).filter(([, docs]) => Array.isArray(docs) && docs.length > 0);
        const filteredEntries = colEntries
            .map(([colName, docs]) => {
            const filtered = docs.filter((doc) => docIncludedInScopedRestore(colName, doc, opts, platformImport, tenantImport, sourceEmpresaId));
            return [colName, filtered];
        })
            .filter(([, docs]) => docs.length > 0)
            .sort((a, b) => collectionSortIndex(a[0]) - collectionSortIndex(b[0]));
        total = filteredEntries.reduce((acc, [, docs]) => acc + docs.length, 0);
        await setJob({ phase: 'Preparando restauración…', total });
        const DELETE_BATCH_SIZE = 400;
        const idMaps = partial.idMaps ?? {};
        const restoredCounter = { count: partial.docsRestored ?? 0 };
        docsDeleted = partial.docsDeleted ?? 0;
        const startCol = partial.startColIndex ?? 0;
        const perRun = partial.collectionsPerRun ?? filteredEntries.length;
        const endCol = Math.min(startCol + perRun, filteredEntries.length);
        for (let ci = startCol; ci < endCol; ci++) {
            const [colName, docs] = filteredEntries[ci];
            await setJob({ phase: `Restaurando ${colName} (${ci + 1}/${filteredEntries.length})…`, docsRestored: restoredCounter.count, total });
            docsDeleted += await deleteCollectionForRestore(db, colName, effectiveMode, opts, DELETE_BATCH_SIZE);
            await writeCollectionWithBulkWriter(db, colName, docs, effectiveMode, retagEmpresaId, opts, idMaps, ci, filteredEntries.length, total, setJob, restoredCounter);
        }
        docsRestored = restoredCounter.count;
        const isComplete = endCol >= filteredEntries.length;
        if (isComplete) {
            await setJob({ status: 'done', phase: 'Completado', docsRestored, total });
            await db.collection('audit_logs').add({
                action: 'RESTORE_BACKUP',
                module: 'SISTEMA',
                actorName: 'Admin',
                details: tenantImport
                    ? `Importación cross-tenant ${sourceEmpresaId} → ${opts.empresaId} (${effectiveMode}) desde ${fileName} — ${docsRestored} docs`
                    : `Restauración ${effectiveMode === 'full' ? 'completa' : 'parcial (merge)'} desde ${fileName} — ${docsRestored} docs`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
            });
        }
        else {
            await setJob({
                status: 'running',
                phase: `Pausa — sigue ${endCol + 1}/${filteredEntries.length}…`,
                docsRestored,
                total,
            });
        }
        return {
            mode: effectiveMode,
            fileName,
            collections: filteredEntries.map(([c]) => c),
            docsRestored,
            docsDeleted,
            durationMs: Date.now() - t0,
            isComplete,
            nextColIndex: endCol,
            totalCollections: filteredEntries.length,
            idMaps,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await setJob({
            status: 'error',
            phase: 'Error en restauración',
            error: msg.slice(0, 500),
            docsRestored,
            total,
        });
        throw e;
    }
}
async function runRestore(driveFileId, mode, jobId, opts = {}, partial = {}) {
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
    return runRestoreFromPayload(payload, fileName, mode, jobId, opts, partial);
}
async function runRestoreFromStorage(storagePath, fileName, mode, jobId, opts = {}, partial = {}) {
    const payload = await downloadBackupPayloadFromStorage(storagePath);
    const result = await runRestoreFromPayload(payload, fileName, mode, jobId, opts, partial);
    if (result.isComplete) {
        await deleteBackupStorageFile(storagePath);
    }
    return result;
}
//# sourceMappingURL=restore.service.js.map