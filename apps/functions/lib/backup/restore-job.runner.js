"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertRestoreRequestAllowed = assertRestoreRequestAllowed;
exports.executeRestoreJob = executeRestoreJob;
const admin = require("firebase-admin");
const assistantEmpresaScope_1 = require("../assistant/assistantEmpresaScope");
const backup_auth_util_1 = require("./backup-auth.util");
const restore_service_1 = require("./restore.service");
async function assertRestoreRequestAllowed(authUid, tokenRoleRaw, payload) {
    const { driveFileId, storagePath, fileName: uploadedFileName, mode, jobId: requestedJobId, empresaId: claimedEmpresa, tenantImport: requestedTenantImport, sourceEmpresaId: claimedSourceEmpresa, } = payload;
    if (!driveFileId && !storagePath) {
        throw new Error('driveFileId o storagePath requerido');
    }
    if (!['merge', 'full'].includes(mode)) {
        throw new Error('mode debe ser merge o full');
    }
    const db = admin.firestore();
    let empresaId = String(claimedEmpresa ?? '').trim();
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(authUid, tokenRoleRaw);
    if (!caller.isPanelUser) {
        throw new Error('Solo usuarios del panel de administración pueden usar backups.');
    }
    let isSuper = caller.isSuper;
    const profileEmpresa = caller.profileEmpresa;
    if (!isSuper)
        empresaId = profileEmpresa || 'bacarsa';
    else if (!empresaId)
        empresaId = profileEmpresa;
    const tenantImport = requestedTenantImport === true;
    if (tenantImport && !isSuper) {
        throw new Error('Solo superadmin puede importar backups de otra empresa.');
    }
    if (tenantImport && mode === 'merge') {
        throw new Error('Import cross-tenant: usá solo Full Restore. Merge duplica empleados, clientes y turnos.');
    }
    let scopeEmpresa = false;
    let migracionCompleta = false;
    if (empresaId) {
        const empSnap = await db.collection('empresas').doc(empresaId).get();
        migracionCompleta = empSnap.exists && empSnap.data()?.migracionCompleta === true;
        scopeEmpresa = (0, assistantEmpresaScope_1.shouldScopeQueriesToEmpresa)(empresaId, migracionCompleta);
    }
    if (driveFileId && !tenantImport) {
        const metaSnap = await db.collection('system_backups').where('driveFileId', '==', driveFileId).limit(1).get();
        if (!metaSnap.empty) {
            const meta = metaSnap.docs[0].data();
            const backupEmpresa = String(meta.empresaId ?? '').trim();
            const backupScoped = meta.scopeEmpresa === true;
            if (backupScoped && backupEmpresa && empresaId && backupEmpresa.toLowerCase() !== empresaId.toLowerCase()) {
                throw new Error('El backup no pertenece a la empresa activa.');
            }
        }
    }
    if (storagePath) {
        const safePath = String(storagePath).trim();
        if (!safePath.startsWith('backup-restore/') || safePath.includes('..')) {
            throw new Error('storagePath inválido');
        }
    }
    const restoreOpts = {
        empresaId,
        scopeEmpresa,
        migracionCompleta,
        ...(tenantImport
            ? {
                tenantImport: true,
                sourceEmpresaId: String(claimedSourceEmpresa ?? '').trim(),
            }
            : {}),
    };
    const fileName = String(uploadedFileName
        ?? (storagePath ? storagePath.split('/').pop() : '')
        ?? 'backup.json').trim();
    const jobId = String(requestedJobId ?? `restore_${Date.now()}`).trim();
    return { jobId, restoreOpts, fileName };
}
async function executeRestoreJob(jobId) {
    const db = admin.firestore();
    const jobRef = db.collection('restore_jobs').doc(jobId);
    const snap = await jobRef.get();
    if (!snap.exists)
        return;
    const data = snap.data() ?? {};
    if (data.status !== 'queued')
        return;
    const claimed = await db.runTransaction(async (tx) => {
        const current = await tx.get(jobRef);
        const status = String(current.data()?.status ?? '');
        if (status !== 'queued')
            return false;
        tx.update(jobRef, {
            status: 'running',
            phase: 'Preparando restauración…',
            startedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
    });
    if (!claimed)
        return;
    const mode = data.mode;
    const effectiveMode = data.tenantImport === true ? 'full' : mode;
    const restoreOpts = {
        empresaId: String(data.empresaId ?? '').trim() || undefined,
        scopeEmpresa: data.scopeEmpresa === true,
        migracionCompleta: data.migracionCompleta === true,
        ...(data.tenantImport === true
            ? {
                tenantImport: true,
                sourceEmpresaId: String(data.sourceEmpresaId ?? '').trim(),
            }
            : {}),
    };
    const fileName = String(data.fileName ?? 'backup.json').trim();
    const storagePath = String(data.storagePath ?? '').trim();
    const driveFileId = String(data.driveFileId ?? '').trim();
    const resumeColIndex = Number(data.resumeColIndex ?? 0);
    const runChunk = async (colIndex, idMaps, docsRestored, docsDeleted) => {
        const partial = {
            startColIndex: colIndex,
            collectionsPerRun: 50,
            idMaps,
            docsRestored,
            docsDeleted,
        };
        return storagePath
            ? await (0, restore_service_1.runRestoreFromStorage)(storagePath, fileName, effectiveMode, jobId, restoreOpts, partial)
            : await (0, restore_service_1.runRestore)(driveFileId, effectiveMode, jobId, restoreOpts, partial);
    };
    try {
        let colIndex = resumeColIndex;
        let idMaps = (0, restore_service_1.deserializeIdMaps)(data.idMaps);
        let docsRestored = Number(data.docsRestored ?? 0);
        let docsDeleted = Number(data.docsDeleted ?? 0);
        let lastResult = null;
        for (let guard = 0; guard < 80; guard++) {
            lastResult = await runChunk(colIndex, idMaps, docsRestored, docsDeleted);
            docsRestored = lastResult.docsRestored;
            docsDeleted = lastResult.docsDeleted;
            idMaps = lastResult.idMaps ?? idMaps;
            if (lastResult.isComplete)
                break;
            colIndex = lastResult.nextColIndex ?? colIndex + 1;
        }
        const result = lastResult;
        if (!result)
            return;
        if (result.isComplete) {
            await jobRef.set({
                status: 'done',
                phase: 'Completado',
                docsRestored: result.docsRestored,
                docsDeleted: result.docsDeleted,
                durationMs: result.durationMs,
                collections: result.collections,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            return;
        }
        await jobRef.set({
            status: 'queued',
            resumeColIndex: result.nextColIndex ?? colIndex,
            idMaps: (0, restore_service_1.serializeIdMaps)(result.idMaps ?? idMaps),
            docsRestored: result.docsRestored,
            docsDeleted: result.docsDeleted,
            phase: `Encolado ${(result.nextColIndex ?? 0) + 1}/${result.totalCollections ?? '?'}`,
        }, { merge: true });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await jobRef.set({
            status: 'error',
            phase: 'Error en restauración',
            error: msg.slice(0, 500),
        }, { merge: true });
        throw e;
    }
}
//# sourceMappingURL=restore-job.runner.js.map