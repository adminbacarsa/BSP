import * as admin from 'firebase-admin';

export type RestoreMode = 'merge' | 'full';

export interface RestoreResult {
  mode: RestoreMode;
  fileName: string;
  collections: string[];
  docsRestored: number;
  docsDeleted: number;
  durationMs: number;
}

export async function runRestore(driveFileId: string, mode: RestoreMode): Promise<RestoreResult> {
  const t0 = Date.now();

  // 1. Descargar JSON desde Drive
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
    { responseType: 'text' }
  );
  const raw = fileRes.data as string;
  const payload = JSON.parse(raw);
  const { _meta, ...collections } = payload;

  const db = admin.firestore();
  let docsRestored = 0;
  let docsDeleted = 0;

  const BATCH_SIZE = 400;

  for (const [colName, docs] of Object.entries(collections)) {
    if (!Array.isArray(docs) || docs.length === 0) continue;

    // Full restore: borrar todos los docs actuales de la colección
    if (mode === 'full') {
      const existing = await db.collection(colName).listDocuments();
      for (let i = 0; i < existing.length; i += BATCH_SIZE) {
        const batch = db.batch();
        existing.slice(i, i + BATCH_SIZE).forEach(ref => batch.delete(ref));
        await batch.commit();
        docsDeleted += Math.min(BATCH_SIZE, existing.length - i);
      }
    }

    // Escribir docs del backup en batches
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE) as any[];
      chunk.forEach(doc => {
        const { _id, ...fields } = doc;
        // Convertir timestamps serializados de vuelta
        const clean = deserializeFields(fields);
        const ref = db.collection(colName).doc(_id);
        if (mode === 'full') {
          batch.set(ref, clean);
        } else {
          batch.set(ref, clean, { merge: true });
        }
      });
      await batch.commit();
      docsRestored += chunk.length;
    }
  }

  // Registrar la restauración en audit_logs
  await db.collection('audit_logs').add({
    action: 'RESTORE_BACKUP',
    module: 'SISTEMA',
    actorName: 'Admin',
    details: `Restauración ${mode === 'full' ? 'completa' : 'parcial (merge)'} desde ${fileName} — ${docsRestored} docs`,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    mode,
    fileName,
    collections: Object.keys(collections),
    docsRestored,
    docsDeleted,
    durationMs: Date.now() - t0,
  };
}

// Convierte campos serializados del JSON de vuelta a tipos Firestore
function deserializeFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deserializeFields);

  // Timestamp serializado por Firebase Admin: { _seconds, _nanoseconds }
  if (typeof obj._seconds === 'number' && typeof obj._nanoseconds === 'number') {
    return new admin.firestore.Timestamp(obj._seconds, obj._nanoseconds);
  }

  const result: any = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = deserializeFields(v);
  }
  return result;
}
