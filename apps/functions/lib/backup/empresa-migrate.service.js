"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deserializeIdMaps = exports.serializeIdMaps = void 0;
exports.runEmpresaMigrate = runEmpresaMigrate;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const restore_service_1 = require("./restore.service");
Object.defineProperty(exports, "serializeIdMaps", { enumerable: true, get: function () { return restore_service_1.serializeIdMaps; } });
Object.defineProperty(exports, "deserializeIdMaps", { enumerable: true, get: function () { return restore_service_1.deserializeIdMaps; } });
const MIGRATE_COLLECTIONS = restore_service_1.RESTORE_COLLECTION_ORDER.filter((c) => c !== 'empresas');
const SKIP_CLONE = new Set(['system_users', 'audit_logs', 'system_backups', 'restore_jobs', 'empresa_migrate_jobs']);
function belongsToSourceEmpresa(data, sourceEmpresaId) {
    const source = String(sourceEmpresaId ?? '').trim().toLowerCase();
    const docEmp = String(data.empresaId ?? '').trim().toLowerCase();
    if (source === 'bacarsa') {
        return !docEmp || docEmp === 'bacarsa';
    }
    return docEmp === source;
}
function sanitizeForFirestore(obj) {
    if (obj === undefined)
        return undefined;
    if (obj === null)
        return null;
    if (obj instanceof firestore_1.Timestamp)
        return obj;
    if (obj instanceof firestore_1.GeoPoint)
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
function allocatePlanificacionEstadoId(oldId, idMaps, targetEmpresaId) {
    const parts = String(oldId ?? '').split('_');
    if (parts.length < 3)
        return oldId;
    const month = parseInt(parts[parts.length - 1], 10);
    const year = parseInt(parts[parts.length - 2], 10);
    if (!Number.isFinite(month) || !Number.isFinite(year) || year < 2000)
        return oldId;
    let objectiveId;
    if (parts.length === 3) {
        objectiveId = parts[0];
    }
    else if (parts.length === 4) {
        objectiveId = parts[1];
    }
    else {
        objectiveId = parts.slice(1, -2).join('_');
    }
    const mapped = idMaps.objetivos?.get(objectiveId) ?? objectiveId;
    return `${targetEmpresaId}_${mapped}_${year}_${month}`;
}
async function readSourceDocs(db, colName, sourceEmpresaId) {
    const out = [];
    let last;
    for (;;) {
        let q = db
            .collection(colName)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(400);
        if (last)
            q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty)
            break;
        for (const d of snap.docs) {
            if (belongsToSourceEmpresa(d.data(), sourceEmpresaId)) {
                out.push({ _id: d.id, ...d.data() });
            }
        }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < 400)
            break;
    }
    return out;
}
async function writeMigratedCollection(db, colName, docs, targetEmpresaId, idMaps, copiedCounter, setJob, colIndex, totalCollections) {
    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((error) => {
        console.error('[empresa-migrate] write error', error.documentRef.path, error.message);
        return error.failedAttempts < 12;
    });
    let lastReport = copiedCounter.count;
    for (const docRow of docs) {
        const { _id, ...fields } = docRow;
        if (!_id)
            continue;
        let clean = sanitizeForFirestore(fields);
        clean.empresaId = targetEmpresaId;
        clean = sanitizeForFirestore((0, restore_service_1.remapCloneDocumentFields)(colName, clean, idMaps, db));
        const writeId = colName === 'planificacion_estados'
            ? allocatePlanificacionEstadoId(String(_id), idMaps, targetEmpresaId)
            : (0, restore_service_1.allocateCloneDocId)(db, colName, String(_id), idMaps);
        if ('id' in clean)
            clean.id = writeId;
        bulkWriter.set(db.collection(colName).doc(writeId), clean);
        copiedCounter.count += 1;
        if (copiedCounter.count - lastReport >= 250) {
            lastReport = copiedCounter.count;
            await setJob({
                phase: `Copiando ${colName} (${colIndex + 1}/${totalCollections})…`,
                docsCopied: copiedCounter.count,
            });
        }
    }
    await bulkWriter.close();
    await setJob({
        phase: `Copiando ${colName} (${colIndex + 1}/${totalCollections})…`,
        docsCopied: copiedCounter.count,
    });
}
async function runEmpresaMigrate(sourceEmpresaId, targetEmpresaId, jobId, partial = {}) {
    const t0 = Date.now();
    const db = admin.firestore();
    const source = String(sourceEmpresaId ?? '').trim();
    const target = String(targetEmpresaId ?? '').trim();
    if (!source || !target) {
        throw new Error('Empresa origen y destino son obligatorias.');
    }
    if (source.toLowerCase() === target.toLowerCase()) {
        throw new Error('Origen y destino no pueden ser la misma empresa.');
    }
    const setJob = (data) => {
        if (!jobId)
            return Promise.resolve();
        return db.collection('empresa_migrate_jobs').doc(jobId).set(data, { merge: true });
    };
    const idMaps = partial.idMaps ?? {};
    const copiedCounter = { count: partial.docsCopied ?? 0 };
    let docsDeleted = partial.docsDeleted ?? 0;
    const collections = MIGRATE_COLLECTIONS.filter((c) => !SKIP_CLONE.has(c));
    const startCol = partial.startColIndex ?? 0;
    const perRun = partial.collectionsPerRun ?? 1;
    const endCol = Math.min(startCol + perRun, collections.length);
    if (startCol === 0) {
        await setJob({
            status: 'running',
            phase: 'Preparando migración…',
            docsCopied: 0,
            docsDeleted: 0,
            totalCollections: collections.length,
            startedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    for (let ci = startCol; ci < endCol; ci++) {
        const colName = collections[ci];
        await setJob({
            phase: `Procesando ${colName} (${ci + 1}/${collections.length})…`,
            docsCopied: copiedCounter.count,
            docsDeleted,
            currentCollection: colName,
        });
        docsDeleted += await (0, restore_service_1.deleteDocsWhereEmpresaId)(db, colName, target, 400);
        const sourceDocs = await readSourceDocs(db, colName, source);
        await writeMigratedCollection(db, colName, sourceDocs, target, idMaps, copiedCounter, setJob, ci, collections.length);
    }
    const isComplete = endCol >= collections.length;
    if (isComplete) {
        await db.collection('empresas').doc(target).set({ migracionCompleta: true, migracionFecha: new Date().toISOString() }, { merge: true });
        await db.collection('audit_logs').add({
            action: 'MIGRATE_EMPRESA_DATA',
            module: 'SISTEMA',
            actorName: 'Admin',
            details: `Migración ${source} → ${target} — ${copiedCounter.count} docs copiados, ${docsDeleted} eliminados en destino`,
            timestamp: firestore_1.FieldValue.serverTimestamp(),
            empresaId: target,
        });
        await setJob({
            status: 'done',
            phase: 'Completado',
            docsCopied: copiedCounter.count,
            docsDeleted,
        });
    }
    else {
        await setJob({
            status: 'running',
            phase: `Pausa — sigue ${endCol + 1}/${collections.length}…`,
            docsCopied: copiedCounter.count,
            docsDeleted,
            resumeColIndex: endCol,
            idMaps: (0, restore_service_1.serializeIdMaps)(idMaps),
        });
    }
    return {
        sourceEmpresaId: source,
        targetEmpresaId: target,
        collections,
        docsCopied: copiedCounter.count,
        docsDeleted,
        durationMs: Date.now() - t0,
        isComplete,
        nextColIndex: endCol,
        totalCollections: collections.length,
        idMaps,
    };
}
//# sourceMappingURL=empresa-migrate.service.js.map