import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveBackupCaller } from './backup-auth.util';
import {
  runEmpresaMigrate,
  deserializeIdMaps,
  serializeIdMaps,
} from './empresa-migrate.service';

export interface MigrateEmpresaRequestPayload {
  sourceEmpresaId: string;
  targetEmpresaId: string;
  jobId?: string;
}

export async function assertMigrateEmpresaRequestAllowed(
  authUid: string,
  tokenRoleRaw: unknown,
  payload: MigrateEmpresaRequestPayload,
): Promise<{ jobId: string; sourceEmpresaId: string; targetEmpresaId: string }> {
  const sourceEmpresaId = String(payload.sourceEmpresaId ?? '').trim();
  const targetEmpresaId = String(payload.targetEmpresaId ?? '').trim();

  if (!sourceEmpresaId || !targetEmpresaId) {
    throw new Error('Empresa origen y destino son obligatorias.');
  }
  if (sourceEmpresaId.toLowerCase() === targetEmpresaId.toLowerCase()) {
    throw new Error('Origen y destino no pueden ser la misma empresa.');
  }

  const caller = await resolveBackupCaller(authUid, tokenRoleRaw);
  if (!caller.isPanelUser) {
    throw new Error('Solo usuarios del panel de administración pueden migrar datos.');
  }
  if (!caller.isSuper) {
    throw new Error('Solo superadmin puede copiar datos entre empresas.');
  }

  const db = admin.firestore();
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

export async function executeEmpresaMigrateJob(jobId: string): Promise<void> {
  const db = admin.firestore();
  const jobRef = db.collection('empresa_migrate_jobs').doc(jobId);
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
      phase: 'Iniciando migración…',
      startedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!claimed) return;

  const sourceEmpresaId = String(data.sourceEmpresaId ?? '').trim();
  const targetEmpresaId = String(data.targetEmpresaId ?? '').trim();
  const resumeColIndex = Number(data.resumeColIndex ?? 0);
  const partial = {
    startColIndex: resumeColIndex,
    collectionsPerRun: 1,
    idMaps: deserializeIdMaps(data.idMaps),
    docsCopied: Number(data.docsCopied ?? 0),
    docsDeleted: Number(data.docsDeleted ?? 0),
  };

  try {
    const result = await runEmpresaMigrate(sourceEmpresaId, targetEmpresaId, jobId, partial);

    if (result.isComplete) {
      await jobRef.set({
        status: 'done',
        phase: 'Completado',
        docsCopied: result.docsCopied,
        docsDeleted: result.docsDeleted,
        durationMs: result.durationMs,
        collections: result.collections,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    await jobRef.set({
      status: 'queued',
      resumeColIndex: result.nextColIndex ?? resumeColIndex + 1,
      idMaps: serializeIdMaps(result.idMaps ?? partial.idMaps ?? {}),
      docsCopied: result.docsCopied,
      docsDeleted: result.docsDeleted,
      phase: `Encolado ${(result.nextColIndex ?? 0) + 1}/${result.totalCollections ?? '?'}`,
    }, { merge: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await jobRef.set({
      status: 'error',
      phase: 'Error en migración',
      error: msg.slice(0, 500),
    }, { merge: true });
    throw e;
  }
}
