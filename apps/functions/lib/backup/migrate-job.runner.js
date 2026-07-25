"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertMigrateEmpresaRequestAllowed = assertMigrateEmpresaRequestAllowed;
exports.executeEmpresaMigrateJob = executeEmpresaMigrateJob;
const firestore_1 = require("firebase-admin/firestore");
const backup_auth_util_1 = require("./backup-auth.util");
const backup_service_1 = require("./backup.service");
const empresa_migrate_service_1 = require("./empresa-migrate.service");
async function assertMigrateEmpresaRequestAllowed(authUid, tokenRoleRaw, payload) {
    const sourceEmpresaId = String(payload.sourceEmpresaId ?? '').trim();
    const targetEmpresaId = String(payload.targetEmpresaId ?? '').trim();
    if (!sourceEmpresaId || !targetEmpresaId) {
        throw new Error('Empresa origen y destino son obligatorias.');
    }
    if (sourceEmpresaId.toLowerCase() === targetEmpresaId.toLowerCase()) {
        throw new Error('Origen y destino no pueden ser la misma empresa.');
    }
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(authUid, tokenRoleRaw);
    if (!caller.isPanelUser) {
        throw new Error('Solo usuarios del panel de administración pueden migrar datos.');
    }
    if (!caller.isSuper) {
        throw new Error('Solo superadmin puede copiar datos entre empresas.');
    }
    const db = (0, backup_service_1.getBackupDb)();
    const [sourceSnap, targetSnap] = await Promise.all([
        db.collection('empresas').doc(sourceEmpresaId).get(),
        db.collection('empresas').doc(targetEmpresaId).get(),
    ]);
    if (!sourceSnap.exists) {
        throw new Error(`Empresa origen «${sourceEmpresaId}» no existe.`);
    }
    if (!targetSnap.exists) {
        throw new Error(`Empresa destino «${targetEmpresaId}» no existe.`);
    }
    const jobId = String(payload.jobId ?? `migrate_${Date.now()}`).trim();
    return { jobId, sourceEmpresaId, targetEmpresaId };
}
async function executeEmpresaMigrateJob(jobId) {
    const db = (0, backup_service_1.getBackupDb)();
    const jobRef = db.collection('empresa_migrate_jobs').doc(jobId);
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
            phase: 'Iniciando migración…',
            startedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return true;
    });
    if (!claimed)
        return;
    const sourceEmpresaId = String(data.sourceEmpresaId ?? '').trim();
    const targetEmpresaId = String(data.targetEmpresaId ?? '').trim();
    const resumeColIndex = Number(data.resumeColIndex ?? 0);
    const partial = {
        startColIndex: resumeColIndex,
        collectionsPerRun: 999,
        idMaps: (0, empresa_migrate_service_1.deserializeIdMaps)(data.idMaps),
        docsCopied: Number(data.docsCopied ?? 0),
        docsDeleted: Number(data.docsDeleted ?? 0),
    };
    try {
        const result = await (0, empresa_migrate_service_1.runEmpresaMigrate)(sourceEmpresaId, targetEmpresaId, jobId, partial);
        if (result.isComplete) {
            await jobRef.set({
                status: 'done',
                phase: 'Completado',
                docsCopied: result.docsCopied,
                docsDeleted: result.docsDeleted,
                durationMs: result.durationMs,
                collections: result.collections,
                completedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            return;
        }
        await jobRef.set({
            status: 'queued',
            resumeColIndex: result.nextColIndex ?? resumeColIndex + 1,
            idMaps: (0, empresa_migrate_service_1.serializeIdMaps)(result.idMaps ?? partial.idMaps ?? {}),
            docsCopied: result.docsCopied,
            docsDeleted: result.docsDeleted,
            phase: `Encolado ${(result.nextColIndex ?? 0) + 1}/${result.totalCollections ?? '?'}`,
        }, { merge: true });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await jobRef.set({
            status: 'error',
            phase: 'Error en migración',
            error: msg.slice(0, 500),
        }, { merge: true });
        throw e;
    }
}
//# sourceMappingURL=migrate-job.runner.js.map