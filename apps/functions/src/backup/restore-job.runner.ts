import * as admin from 'firebase-admin';
import { shouldScopeQueriesToEmpresa } from '../assistant/assistantEmpresaScope';
import {
  runRestore,
  runRestoreFromStorage,
  RestoreMode,
  RestoreOptions,
  serializeIdMaps,
  deserializeIdMaps,
} from './restore.service';

export interface RestoreRequestPayload {
  driveFileId?: string;
  storagePath?: string;
  fileName?: string;
  mode: RestoreMode;
  jobId?: string;
  empresaId?: string;
  tenantImport?: boolean;
  sourceEmpresaId?: string;
}

function normalizeBackupRole(role: unknown): string {
  return String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

export async function assertRestoreRequestAllowed(
  authUid: string,
  tokenRoleRaw: unknown,
  payload: RestoreRequestPayload,
): Promise<{ jobId: string; restoreOpts: RestoreOptions; fileName: string }> {
  const {
    driveFileId,
    storagePath,
    fileName: uploadedFileName,
    mode,
    jobId: requestedJobId,
    empresaId: claimedEmpresa,
    tenantImport: requestedTenantImport,
    sourceEmpresaId: claimedSourceEmpresa,
  } = payload;

  if (!driveFileId && !storagePath) {
    throw new Error('driveFileId o storagePath requerido');
  }
  if (!['merge', 'full'].includes(mode)) {
    throw new Error('mode debe ser merge o full');
  }

  const db = admin.firestore();
  let empresaId = String(claimedEmpresa ?? '').trim();
  const tokenRole = normalizeBackupRole(tokenRoleRaw);
  let isSuper = tokenRole === 'SUPERADMIN' || tokenRole === 'SUPER_ADMIN';

  const sysUser = await db.collection('system_users').doc(authUid).get();
  if (!sysUser.exists) {
    throw new Error('Solo usuarios del panel de administración pueden usar backups.');
  }

  const sysRole = normalizeBackupRole(sysUser.data()?.role);
  isSuper = isSuper || sysRole === 'SUPERADMIN' || sysRole === 'SUPER_ADMIN';
  const profileEmpresa = String(sysUser.data()?.empresaId ?? '').trim();
  if (!isSuper) empresaId = profileEmpresa || 'bacarsa';
  else if (!empresaId) empresaId = profileEmpresa;

  const tenantImport = requestedTenantImport === true;
  if (tenantImport && !isSuper) {
    throw new Error('Solo superadmin puede importar backups de otra empresa.');
  }

  let scopeEmpresa = false;
  if (empresaId) {
    const empSnap = await db.collection('empresas').doc(empresaId).get();
    const migracionCompleta = empSnap.exists && empSnap.data()?.migracionCompleta === true;
    scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
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

  const restoreOpts: RestoreOptions = {
    empresaId,
    scopeEmpresa,
    ...(tenantImport
      ? {
          tenantImport: true,
          sourceEmpresaId: String(claimedSourceEmpresa ?? '').trim(),
        }
      : {}),
  };

  const fileName = String(
    uploadedFileName
    ?? (storagePath ? storagePath.split('/').pop() : '')
    ?? 'backup.json',
  ).trim();

  const jobId = String(requestedJobId ?? `restore_${Date.now()}`).trim();

  return { jobId, restoreOpts, fileName };
}

export async function executeRestoreJob(jobId: string): Promise<void> {
  const db = admin.firestore();
  const jobRef = db.collection('restore_jobs').doc(jobId);
  const snap = await jobRef.get();
  if (!snap.exists) return;

  const data = snap.data() ?? {};
  if (data.status !== 'queued') return;

  const claimed = await db.runTransaction(async (tx) => {
    const current = await tx.get(jobRef);
    const status = String(current.data()?.status ?? '');
    if (status !== 'queued') return false;
    tx.update(jobRef, {
      status: 'running',
      phase: 'Iniciando restauración…',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!claimed) return;

  const mode = data.mode as RestoreMode;
  const restoreOpts: RestoreOptions = {
    empresaId: String(data.empresaId ?? '').trim() || undefined,
    scopeEmpresa: data.scopeEmpresa === true,
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
  const partial = {
    startColIndex: resumeColIndex,
    collectionsPerRun: 1,
    idMaps: deserializeIdMaps(data.idMaps),
    docsRestored: Number(data.docsRestored ?? 0),
    docsDeleted: Number(data.docsDeleted ?? 0),
  };

  try {
    const result = storagePath
      ? await runRestoreFromStorage(storagePath, fileName, mode, jobId, restoreOpts, partial)
      : await runRestore(driveFileId, mode, jobId, restoreOpts, partial);

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
      resumeColIndex: result.nextColIndex ?? resumeColIndex + 1,
      idMaps: serializeIdMaps(result.idMaps ?? partial.idMaps ?? {}),
      docsRestored: result.docsRestored,
      docsDeleted: result.docsDeleted,
      phase: `Encolado ${(result.nextColIndex ?? 0) + 1}/${result.totalCollections ?? '?'}`,
    }, { merge: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await jobRef.set({
      status: 'error',
      phase: 'Error en restauración',
      error: msg.slice(0, 500),
    }, { merge: true });
    throw e;
  }
}
