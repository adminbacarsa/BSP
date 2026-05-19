import * as admin from 'firebase-admin';
import { belongsToEmpresa } from '../assistant/assistantEmpresaScope';

export type RestoreMode = 'merge' | 'full';

export interface RestoreResult {
  mode: RestoreMode;
  fileName: string;
  collections: string[];
  docsRestored: number;
  docsDeleted: number;
  durationMs: number;
}

export interface RestoreOptions {
  empresaId?: string;
  scopeEmpresa?: boolean;
}

const SKIP_DELETE = new Set(['system_backups', 'audit_logs', 'restore_jobs']);

const EMPRESA_SCOPED_COLLECTIONS = new Set([
  'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
  'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
  'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);

function deserializeFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deserializeFields);

  if (typeof obj._seconds === 'number' && typeof obj._nanoseconds === 'number') {
    return new admin.firestore.Timestamp(obj._seconds, obj._nanoseconds);
  }

  const result: any = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = deserializeFields(v);
  }
  return result;
}

function assertBackupAllowedForRestore(
  payload: Record<string, unknown>,
  opts: RestoreOptions,
): void {
  const meta = (payload._meta ?? {}) as Record<string, unknown>;
  const backupEmpresa = String(meta.empresaId ?? '').trim();
  const backupScoped = meta.scopeEmpresa === true;
  const sessionEmpresa = String(opts.empresaId ?? '').trim();

  if (!opts.scopeEmpresa || !sessionEmpresa) return;

  if (backupScoped && backupEmpresa && backupEmpresa.toLowerCase() !== sessionEmpresa.toLowerCase()) {
    throw new Error('El backup pertenece a otra empresa.');
  }
  if (!backupEmpresa && !backupScoped) {
    throw new Error('Este backup es de plataforma completa y no puede restaurarse en esta empresa.');
  }
}

function docIncludedInScopedRestore(
  colName: string,
  doc: Record<string, unknown>,
  opts: RestoreOptions,
): boolean {
  if (!opts.scopeEmpresa || !opts.empresaId) return true;
  if (colName === 'empresas') {
    return String(doc._id ?? '') === opts.empresaId;
  }
  if (EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
    return belongsToEmpresa(doc, opts.empresaId, true);
  }
  return false;
}

async function deleteCollectionForRestore(
  db: FirebaseFirestore.Firestore,
  colName: string,
  mode: RestoreMode,
  opts: RestoreOptions,
  batchSize: number,
): Promise<number> {
  if (mode !== 'full' || SKIP_DELETE.has(colName)) return 0;

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
    if (!EMPRESA_SCOPED_COLLECTIONS.has(colName)) return 0;

    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let q: FirebaseFirestore.Query = db.collection(colName).where('empresaId', '==', opts.empresaId).limit(batchSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      docsDeleted += snap.size;
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < batchSize) break;
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

export async function runRestoreFromPayload(
  payload: Record<string, unknown>,
  fileName: string,
  mode: RestoreMode,
  jobId?: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const t0 = Date.now();
  const db = admin.firestore();

  assertBackupAllowedForRestore(payload, opts);

  const setJob = (data: object) => {
    if (!jobId) return Promise.resolve();
    return db.collection('restore_jobs').doc(jobId).set(data, { merge: true });
  };

  await setJob({ status: 'running', phase: 'Preparando restauración…', docsRestored: 0, total: 0, startedAt: admin.firestore.FieldValue.serverTimestamp() });

  const { _meta, _auth_users, ...collections } = payload;
  const colEntries = Object.entries(collections).filter(
    ([, docs]) => Array.isArray(docs) && (docs as any[]).length > 0,
  ) as [string, any[]][];

  const filteredEntries = colEntries
    .map(([colName, docs]) => {
      const filtered = docs.filter((doc) => docIncludedInScopedRestore(colName, doc as Record<string, unknown>, opts));
      return [colName, filtered] as [string, any[]];
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
      const chunk = docs.slice(i, i + BATCH_SIZE) as any[];
      let written = 0;
      chunk.forEach((doc) => {
        const { _id, ...fields } = doc;
        if (!_id) return;
        const clean = deserializeFields(fields);
        const ref = db.collection(colName).doc(_id);
        if (mode === 'full') {
          batch.set(ref, clean);
        } else {
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

export async function runRestore(driveFileId: string, mode: RestoreMode, jobId?: string, opts: RestoreOptions = {}): Promise<RestoreResult> {
  const db = admin.firestore();

  const setJob = (data: object) => {
    if (!jobId) return Promise.resolve();
    return db.collection('restore_jobs').doc(jobId).set(data, { merge: true });
  };

  await setJob({ status: 'running', phase: 'Descargando backup de Drive…', docsRestored: 0, total: 0, startedAt: admin.firestore.FieldValue.serverTimestamp() });

  const { google } = await import('googleapis');
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

  const fileRes = await drive.files.get(
    { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'text' },
  );
  const payload = JSON.parse(fileRes.data as string) as Record<string, unknown>;
  return runRestoreFromPayload(payload, fileName, mode, jobId, opts);
}

export async function runRestoreFromStorage(
  storagePath: string,
  fileName: string,
  mode: RestoreMode,
  jobId?: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  const bucket = admin.storage().bucket();
  const [buf] = await bucket.file(storagePath).download();
  const payload = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
  try {
    return await runRestoreFromPayload(payload, fileName, mode, jobId, opts);
  } finally {
    bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}
