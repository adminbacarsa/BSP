import * as admin from 'firebase-admin';
import {
  allocateCloneDocId,
  deleteDocsWhereEmpresaId,
  remapCloneDocumentFields,
  RESTORE_COLLECTION_ORDER,
  serializeIdMaps,
  deserializeIdMaps,
} from './restore.service';

export interface EmpresaMigrateResult {
  sourceEmpresaId: string;
  targetEmpresaId: string;
  collections: string[];
  docsCopied: number;
  docsDeleted: number;
  durationMs: number;
  isComplete?: boolean;
  nextColIndex?: number;
  totalCollections?: number;
  idMaps?: Record<string, Map<string, string>>;
}

export interface EmpresaMigratePartialState {
  startColIndex?: number;
  collectionsPerRun?: number;
  idMaps?: Record<string, Map<string, string>>;
  docsCopied?: number;
  docsDeleted?: number;
}

const MIGRATE_COLLECTIONS = RESTORE_COLLECTION_ORDER.filter((c) => c !== 'empresas');

const SKIP_CLONE = new Set(['system_users', 'audit_logs', 'system_backups', 'restore_jobs', 'empresa_migrate_jobs']);

type IdMaps = Record<string, Map<string, string>>;

function belongsToSourceEmpresa(data: Record<string, unknown>, sourceEmpresaId: string): boolean {
  const source = String(sourceEmpresaId ?? '').trim().toLowerCase();
  const docEmp = String(data.empresaId ?? '').trim().toLowerCase();
  if (source === 'bacarsa') {
    return !docEmp || docEmp === 'bacarsa';
  }
  return docEmp === source;
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

function allocatePlanificacionEstadoId(oldId: string, idMaps: IdMaps): string {
  const idx = oldId.indexOf('_');
  if (idx <= 0) return oldId;
  const oldObjId = oldId.slice(0, idx);
  const suffix = oldId.slice(idx);
  const mapped = idMaps.objetivos?.get(oldObjId) ?? oldObjId;
  return `${mapped}${suffix}`;
}

async function readSourceDocs(
  db: FirebaseFirestore.Firestore,
  colName: string,
  sourceEmpresaId: string,
): Promise<Array<{ _id: string; [key: string]: unknown }>> {
  const out: Array<{ _id: string; [key: string]: unknown }> = [];
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: FirebaseFirestore.Query = db
      .collection(colName)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (belongsToSourceEmpresa(d.data() as Record<string, unknown>, sourceEmpresaId)) {
        out.push({ _id: d.id, ...d.data() });
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  return out;
}

async function writeMigratedCollection(
  db: FirebaseFirestore.Firestore,
  colName: string,
  docs: Array<{ _id: string; [key: string]: unknown }>,
  targetEmpresaId: string,
  idMaps: IdMaps,
  copiedCounter: { count: number },
  setJob: (data: object) => Promise<unknown>,
  colIndex: number,
  totalCollections: number,
): Promise<void> {
  const bulkWriter = db.bulkWriter();
  bulkWriter.onWriteError((error) => {
    console.error('[empresa-migrate] write error', error.documentRef.path, error.message);
    return error.failedAttempts < 12;
  });

  let lastReport = copiedCounter.count;

  for (const docRow of docs) {
    const { _id, ...fields } = docRow;
    if (!_id) continue;
    let clean = sanitizeForFirestore(fields) as Record<string, unknown>;
    clean.empresaId = targetEmpresaId;
    clean = sanitizeForFirestore(remapCloneDocumentFields(colName, clean, idMaps, db)) as Record<string, unknown>;

    const writeId = colName === 'planificacion_estados'
      ? allocatePlanificacionEstadoId(String(_id), idMaps)
      : allocateCloneDocId(db, colName, String(_id), idMaps);

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

export async function runEmpresaMigrate(
  sourceEmpresaId: string,
  targetEmpresaId: string,
  jobId?: string,
  partial: EmpresaMigratePartialState = {},
): Promise<EmpresaMigrateResult> {
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

  const setJob = (data: object) => {
    if (!jobId) return Promise.resolve();
    return db.collection('empresa_migrate_jobs').doc(jobId).set(data, { merge: true });
  };

  const idMaps: IdMaps = partial.idMaps ?? {};
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
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
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

    docsDeleted += await deleteDocsWhereEmpresaId(db, colName, target, 400);

    const sourceDocs = await readSourceDocs(db, colName, source);
    await writeMigratedCollection(
      db,
      colName,
      sourceDocs,
      target,
      idMaps,
      copiedCounter,
      setJob,
      ci,
      collections.length,
    );
  }

  const isComplete = endCol >= collections.length;

  if (isComplete) {
    await db.collection('empresas').doc(target).set(
      { migracionCompleta: true, migracionFecha: new Date().toISOString() },
      { merge: true },
    );

    await db.collection('audit_logs').add({
      action: 'MIGRATE_EMPRESA_DATA',
      module: 'SISTEMA',
      actorName: 'Admin',
      details: `Migración ${source} → ${target} — ${copiedCounter.count} docs copiados, ${docsDeleted} eliminados en destino`,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      empresaId: target,
    });

    await setJob({
      status: 'done',
      phase: 'Completado',
      docsCopied: copiedCounter.count,
      docsDeleted,
    });
  } else {
    await setJob({
      status: 'running',
      phase: `Pausa — sigue ${endCol + 1}/${collections.length}…`,
      docsCopied: copiedCounter.count,
      docsDeleted,
      resumeColIndex: endCol,
      idMaps: serializeIdMaps(idMaps),
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

export { serializeIdMaps, deserializeIdMaps };
