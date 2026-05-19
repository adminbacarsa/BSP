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
  isComplete?: boolean;
  nextColIndex?: number;
  totalCollections?: number;
  idMaps?: IdMaps;
}

export interface RestorePartialState {
  startColIndex?: number;
  /** Cuántas colecciones procesar en esta invocación (default: todas). */
  collectionsPerRun?: number;
  idMaps?: IdMaps;
  docsRestored?: number;
  docsDeleted?: number;
}

export function serializeIdMaps(idMaps: IdMaps): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [col, map] of Object.entries(idMaps)) {
    out[col] = Object.fromEntries(map.entries());
  }
  return out;
}

export function deserializeIdMaps(raw: unknown): IdMaps {
  const idMaps: IdMaps = {};
  if (!raw || typeof raw !== 'object') return idMaps;
  for (const [col, entries] of Object.entries(raw as Record<string, Record<string, string>>)) {
    idMaps[col] = new Map(Object.entries(entries ?? {}));
  }
  return idMaps;
}

export async function downloadBackupPayloadFromStorage(storagePath: string): Promise<Record<string, unknown>> {
  const bucket = admin.storage().bucket(getBackupStorageBucketName());
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(
      'El archivo de backup no está en Storage. Volvé a subir el JSON y confirmá la restauración de inmediato.',
    );
  }
  const [buf] = await file.download();
  return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
}

export async function deleteBackupStorageFile(storagePath: string): Promise<void> {
  const bucket = admin.storage().bucket(getBackupStorageBucketName());
  await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
}

function getBackupStorageBucketName(): string {
  const fromEnv = String(process.env.FIREBASE_STORAGE_BUCKET ?? process.env.GCLOUD_STORAGE_BUCKET ?? '').trim();
  if (fromEnv) return fromEnv;
  const projectId = String(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'comtroldata').trim();
  return `${projectId}.firebasestorage.app`;
}

export interface RestoreOptions {
  empresaId?: string;
  scopeEmpresa?: boolean;
  /** Copiar backup de otra empresa al tenant destino (superadmin). */
  tenantImport?: boolean;
  sourceEmpresaId?: string;
}

const SKIP_DELETE = new Set(['system_backups', 'audit_logs', 'restore_jobs']);

/** No clonar usuarios del panel ni auditoría — comparten uid global y pisan otras empresas. */
const SKIP_CLONE_COLLECTIONS = new Set(['system_users', 'audit_logs']);

const EMPRESA_SCOPED_COLLECTIONS = new Set([
  'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
  'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
  'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);

/** Orden para clonar/importar: padres antes que hijos (remap de FKs). */
const RESTORE_COLLECTION_ORDER = [
  'clients', 'clientes', 'empleados', 'objetivos', 'tipos_turno',
  'servicios_sla', 'contratos_servicio', 'turnos', 'ausencias',
  'novedades', 'swap_requests', 'user_notifications', 'empresas',
];

type IdMaps = Record<string, Map<string, string>>;

function collectionSortIndex(name: string): number {
  const i = RESTORE_COLLECTION_ORDER.indexOf(name);
  return i >= 0 ? i : 999;
}

function allocateCloneDocId(
  db: FirebaseFirestore.Firestore,
  colName: string,
  oldId: string,
  idMaps: IdMaps,
): string {
  if (!idMaps[colName]) idMaps[colName] = new Map();
  const cached = idMaps[colName].get(oldId);
  if (cached) return cached;
  const newId = db.collection(colName).doc().id;
  idMaps[colName].set(oldId, newId);
  return newId;
}

function mapForeignId(idMaps: IdMaps, col: string, value: unknown): unknown {
  const v = String(value ?? '').trim();
  if (!v) return value;
  const mapped = idMaps[col]?.get(v);
  return mapped ?? value;
}

function remapCloneDocumentFields(
  colName: string,
  data: Record<string, unknown>,
  idMaps: IdMaps,
  db: FirebaseFirestore.Firestore,
): Record<string, unknown> {
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
    clean.objetivos = (clean.objetivos as unknown[]).map((row) => {
      if (!row || typeof row !== 'object') return row;
      const o = { ...(row as Record<string, unknown>) };
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

async function deleteDocsWhereEmpresaId(
  db: FirebaseFirestore.Firestore,
  colName: string,
  empresaId: string,
  batchSize: number,
): Promise<number> {
  let docsDeleted = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: FirebaseFirestore.Query = db.collection(colName).where('empresaId', '==', empresaId).limit(batchSize);
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

/** Docs legacy sin empresaId (pertenecen a Bacarsa en convención multiempresa). */
async function deleteDocsWithoutEmpresaId(
  db: FirebaseFirestore.Firestore,
  colName: string,
  batchSize: number,
): Promise<number> {
  let docsDeleted = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: FirebaseFirestore.Query = db.collection(colName).orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const toDelete = snap.docs.filter((d) => !String(d.data()?.empresaId ?? '').trim());
    if (toDelete.length > 0) {
      const batch = db.batch();
      toDelete.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      docsDeleted += toDelete.length;
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < batchSize) break;
  }
  return docsDeleted;
}

async function deleteAllDocsInCollection(
  db: FirebaseFirestore.Firestore,
  colName: string,
  batchSize: number,
): Promise<number> {
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

function sanitizeForFirestore(obj: unknown): unknown {
  if (obj === undefined) return undefined;
  if (obj === null) return null;
  if (obj instanceof admin.firestore.Timestamp) return obj;
  if (obj instanceof admin.firestore.GeoPoint) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForFirestore(item)).filter((item) => item !== undefined);
  }
  if (typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined) continue;
    const sanitized = sanitizeForFirestore(v);
    if (sanitized !== undefined) out[k] = sanitized;
  }
  return out;
}

async function writeCollectionWithBulkWriter(
  db: FirebaseFirestore.Firestore,
  colName: string,
  docs: any[],
  mode: RestoreMode,
  retagEmpresaId: boolean,
  opts: RestoreOptions,
  idMaps: IdMaps,
  ci: number,
  totalCollections: number,
  total: number,
  setJob: (data: object) => Promise<unknown>,
  docsRestored: { count: number },
): Promise<void> {
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => {
    console.error('[restore] write error', error.documentRef.path, error.message);
    if (error.failedAttempts < 12) return true;
    return false;
  });

  let lastReport = docsRestored.count;

  for (const doc of docs) {
    const { _id, ...fields } = doc;
    if (!_id) continue;
    let clean = sanitizeForFirestore(deserializeFields(fields)) as Record<string, unknown>;
    if (retagEmpresaId && EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
      clean.empresaId = opts.empresaId;
      clean = remapCloneDocumentFields(colName, clean, idMaps, db) as Record<string, unknown>;
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

function isPlatformBackup(payload: Record<string, unknown>): boolean {
  const meta = (payload._meta ?? {}) as Record<string, unknown>;
  const backupEmpresa = String(meta.empresaId ?? '').trim();
  return !backupEmpresa && meta.scopeEmpresa !== true;
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
  if (opts.tenantImport === true) return;

  if (backupScoped && backupEmpresa && backupEmpresa.toLowerCase() !== sessionEmpresa.toLowerCase()) {
    throw new Error('El backup pertenece a otra empresa.');
  }
}

function docIncludedInScopedRestore(
  colName: string,
  doc: Record<string, unknown>,
  opts: RestoreOptions,
  platformImport: boolean,
  tenantImport: boolean,
  sourceEmpresaId: string,
): boolean {
  if (!opts.scopeEmpresa || !opts.empresaId) return true;
  if (colName === 'empresas') {
    if (tenantImport) return false;
    return String(doc._id ?? '') === opts.empresaId;
  }
  if (EMPRESA_SCOPED_COLLECTIONS.has(colName)) {
    if (platformImport || tenantImport) {
      if (SKIP_CLONE_COLLECTIONS.has(colName)) return false;
    }
    if (platformImport) {
      const docEmpresa = String(doc.empresaId ?? '').trim();
      return !docEmpresa || docEmpresa === opts.empresaId;
    }
    if (tenantImport) {
      const docEmpresa = String(doc.empresaId ?? '').trim();
      if (!docEmpresa) return true;
      return docEmpresa.toLowerCase() === sourceEmpresaId.toLowerCase();
    }
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
  if (colName === 'empresas') return 0;
  if (!EMPRESA_SCOPED_COLLECTIONS.has(colName)) return 0;

  const empresaId = String(opts.empresaId ?? '').trim();

  if (!empresaId) {
    const empSnap = await db.collection('empresas').limit(2).get();
    if (empSnap.size > 1) {
      throw new Error(
        'Restauración Full sin empresa activa bloqueada: hay varias empresas. Seleccioná la empresa destino en el selector.',
      );
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

export async function runRestoreFromPayload(
  payload: Record<string, unknown>,
  fileName: string,
  mode: RestoreMode,
  jobId?: string,
  opts: RestoreOptions = {},
  partial: RestorePartialState = {},
): Promise<RestoreResult> {
  const t0 = Date.now();
  const db = admin.firestore();

  assertBackupAllowedForRestore(payload, opts);
  const meta = (payload._meta ?? {}) as Record<string, unknown>;
  const backupEmpresa = String(meta.empresaId ?? '').trim();
  const platformImport = isPlatformBackup(payload) && opts.scopeEmpresa === true && !!opts.empresaId;
  const sourceEmpresaId = String(opts.sourceEmpresaId ?? backupEmpresa).trim();
  const tenantImport =
    opts.tenantImport === true &&
    opts.scopeEmpresa === true &&
    !!opts.empresaId &&
    !!sourceEmpresaId &&
    sourceEmpresaId.toLowerCase() !== opts.empresaId.toLowerCase();
  const retagEmpresaId = platformImport || tenantImport;

  const setJob = (data: object) => {
    if (!jobId) return Promise.resolve();
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
  const colEntries = Object.entries(collections).filter(
    ([, docs]) => Array.isArray(docs) && (docs as any[]).length > 0,
  ) as [string, any[]][];

  const filteredEntries = colEntries
    .map(([colName, docs]) => {
      const filtered = docs.filter((doc) =>
        docIncludedInScopedRestore(
          colName,
          doc as Record<string, unknown>,
          opts,
          platformImport,
          tenantImport,
          sourceEmpresaId,
        ),
      );
      return [colName, filtered] as [string, any[]];
    })
    .filter(([, docs]) => docs.length > 0)
    .sort((a, b) => collectionSortIndex(a[0]) - collectionSortIndex(b[0]));

  total = filteredEntries.reduce((acc, [, docs]) => acc + docs.length, 0);
  await setJob({ phase: 'Preparando restauración…', total });

  const DELETE_BATCH_SIZE = 400;
  const idMaps: IdMaps = partial.idMaps ?? {};
  const restoredCounter = { count: partial.docsRestored ?? 0 };
  docsDeleted = partial.docsDeleted ?? 0;

  const startCol = partial.startColIndex ?? 0;
  const perRun = partial.collectionsPerRun ?? filteredEntries.length;
  const endCol = Math.min(startCol + perRun, filteredEntries.length);

  for (let ci = startCol; ci < endCol; ci++) {
    const [colName, docs] = filteredEntries[ci];
    await setJob({ phase: `Restaurando ${colName} (${ci + 1}/${filteredEntries.length})…`, docsRestored: restoredCounter.count, total });

    docsDeleted += await deleteCollectionForRestore(db, colName, mode, opts, DELETE_BATCH_SIZE);

    await writeCollectionWithBulkWriter(
      db,
      colName,
      docs,
      mode,
      retagEmpresaId,
      opts,
      idMaps,
      ci,
      filteredEntries.length,
      total,
      setJob,
      restoredCounter,
    );
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
        ? `Importación cross-tenant ${sourceEmpresaId} → ${opts.empresaId} (${mode}) desde ${fileName} — ${docsRestored} docs`
        : `Restauración ${mode === 'full' ? 'completa' : 'parcial (merge)'} desde ${fileName} — ${docsRestored} docs`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ...(opts.empresaId ? { empresaId: opts.empresaId } : {}),
    });
  } else {
    await setJob({
      status: 'running',
      phase: `Pausa — sigue ${endCol + 1}/${filteredEntries.length}…`,
      docsRestored,
      total,
    });
  }

  return {
    mode,
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
  } catch (e: unknown) {
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

export async function runRestore(
  driveFileId: string,
  mode: RestoreMode,
  jobId?: string,
  opts: RestoreOptions = {},
  partial: RestorePartialState = {},
): Promise<RestoreResult> {
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
  return runRestoreFromPayload(payload, fileName, mode, jobId, opts, partial);
}

export async function runRestoreFromStorage(
  storagePath: string,
  fileName: string,
  mode: RestoreMode,
  jobId?: string,
  opts: RestoreOptions = {},
  partial: RestorePartialState = {},
): Promise<RestoreResult> {
  const payload = await downloadBackupPayloadFromStorage(storagePath);
  const result = await runRestoreFromPayload(payload, fileName, mode, jobId, opts, partial);
  if (result.isComplete) {
    await deleteBackupStorageFile(storagePath);
  }
  return result;
}
