import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { Readable } from 'stream';

// Colecciones a excluir del backup
const EXCLUDE_COLLECTIONS = new Set<string>([
  // ninguna por ahora — system_backups se incluye para que el emulador muestre el historial
]);

/** Colecciones con campo empresaId (misma lista que migración multiempresa). */
const EMPRESA_SCOPED_COLLECTIONS = new Set([
  'empleados', 'clients', 'clientes', 'turnos', 'ausencias', 'novedades',
  'swap_requests', 'contratos_servicio', 'tipos_turno', 'servicios_sla',
  'objetivos', 'audit_logs', 'user_notifications', 'system_users',
]);

const MAX_DOCS_PER_COLLECTION = 50000;

export interface BackupOptions {
  empresaId?: string;
  scopeEmpresa?: boolean;
  /** scheduledBackup | triggerBackup */
  source?: string;
}

function docBelongsToEmpresa(data: Record<string, unknown>, empresaId: string, scopeEmpresa: boolean): boolean {
  if (!scopeEmpresa) return true;
  const docEmpId = String(data.empresaId ?? '').trim();
  if (docEmpId === empresaId) return true;
  if (empresaId === 'bacarsa' && docEmpId === '') return true;
  return false;
}

export interface BackupResult {
  id: string;
  driveFileId: string;
  driveLink: string;
  fileName: string;
  sizeBytes: number;
  collections: string[];
  totalDocs: number;
  createdAt: string;
  status: 'ok' | 'error';
  error?: string;
  empresaId?: string;
}

async function exportAuthUsers(): Promise<any[]> {
  const users: any[] = [];
  let pageToken: string | undefined;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    result.users.forEach(u => users.push({
      uid:          u.uid,
      email:        u.email || null,
      displayName:  u.displayName || null,
      phoneNumber:  u.phoneNumber || null,
      photoURL:     u.photoURL || null,
      disabled:     u.disabled,
      customClaims: u.customClaims || null,
    }));
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

export async function runBackup(folderId: string, opts: BackupOptions = {}): Promise<BackupResult> {
  const db = admin.firestore();
  const empresaId = String(opts.empresaId ?? '').trim();
  const scopeEmpresa = opts.scopeEmpresa === true && !!empresaId;
  const data: Record<string, any[]> = {};
  let totalDocs = 0;
  const exportedCollections: string[] = [];

  const authUsers = scopeEmpresa ? [] : await exportAuthUsers();

  const rootCollections = await db.listCollections();

  for (const colRef of rootCollections) {
    const col = colRef.id;
    if (EXCLUDE_COLLECTIONS.has(col)) continue;

    if (col === 'empresas' && scopeEmpresa) {
      try {
        const snap = await db.collection('empresas').doc(empresaId).get();
        if (snap.exists) {
          data[col] = [{ _id: snap.id, ...snap.data() }];
          totalDocs += 1;
          exportedCollections.push(col);
        }
      } catch { /* omit */ }
      continue;
    }

    try {
      const snap = await db.collection(col).limit(MAX_DOCS_PER_COLLECTION).get();
      if (snap.empty) continue;

      const docs = snap.docs
        .map(d => ({ _id: d.id, ...d.data() as Record<string, unknown> }))
        .filter(row => {
          if (!scopeEmpresa) return true;
          if (EMPRESA_SCOPED_COLLECTIONS.has(col)) {
            return docBelongsToEmpresa(row, empresaId, true);
          }
          return false;
        });

      if (docs.length > 0) {
        data[col] = docs;
        totalDocs += docs.length;
        exportedCollections.push(col);
      }
    } catch {
      // colección sin permisos, se omite
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16).replace(':', '-');
  const fileName = scopeEmpresa
    ? `backup_${empresaId}_${dateStr}_${timeStr}.json`
    : `backup_${dateStr}_${timeStr}.json`;

  const payload = {
    _meta: {
      project: 'comtroldata',
      exportedAt: now.toISOString(),
      collections: exportedCollections,
      totalDocs,
      authUsers: authUsers.length,
      ...(scopeEmpresa ? { empresaId, scopeEmpresa: true } : {}),
    },
    _auth_users: authUsers,
    ...data,
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const sizeBytes = Buffer.byteLength(jsonStr, 'utf8');

  // Subir a Google Drive usando Application Default Credentials
  // (comtroldata@appspot.gserviceaccount.com — service account de Cloud Functions)
  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const stream = Readable.from([jsonStr]);
  const driveRes = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: { mimeType: 'application/json', body: stream },
    fields: 'id, webViewLink',
  });

  const driveFileId = driveRes.data.id!;
  const driveLink = driveRes.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;

  // Registrar en Firestore — uno por empresa (fixed ID) o acumulativo si es plataforma
  const backupDoc = {
    driveFileId,
    driveLink,
    fileName,
    sizeBytes,
    collections: exportedCollections,
    totalDocs,
    driveBackupFolderId: folderId,
    createdAt: FieldValue.serverTimestamp(),
    status: 'ok',
    backupScope: scopeEmpresa ? 'empresa' : 'platform',
    ...(opts.source ? { source: opts.source } : {}),
    ...(empresaId ? { empresaId } : {}),
    ...(scopeEmpresa ? { scopeEmpresa: true } : {}),
  };
  let ref: FirebaseFirestore.DocumentReference;
  if (scopeEmpresa && empresaId) {
    ref = db.collection('system_backups').doc(`${empresaId}_latest`);
    await ref.set(backupDoc);
  } else {
    ref = await db.collection('system_backups').add(backupDoc);
  }

  return {
    id: ref.id,
    driveFileId,
    driveLink,
    fileName,
    sizeBytes,
    collections: exportedCollections,
    totalDocs,
    createdAt: now.toISOString(),
    status: 'ok',
    ...(empresaId ? { empresaId } : {}),
  };
}

export interface SyncDriveBackupsResult {
  checked: number;
  removed: number;
  kept: number;
  removedIds: string[];
}

/**
 * Reconcilia `system_backups` con Google Drive: elimina los documentos cuyo
 * archivo `driveFileId` ya no existe (borrado manualmente o movido a papelera).
 * No toca documentos sin `driveFileId` (registros de error / informativos).
 */
export async function syncDriveBackups(opts: { empresaId?: string; scopeEmpresa?: boolean } = {}): Promise<SyncDriveBackupsResult> {
  const db = admin.firestore();
  const empresaId = String(opts.empresaId ?? '').trim();
  const scopeEmpresa = opts.scopeEmpresa === true && !!empresaId;

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  let query: FirebaseFirestore.Query = db.collection('system_backups');
  if (scopeEmpresa) query = query.where('empresaId', '==', empresaId);
  const snap = await query.get();

  let checked = 0;
  let removed = 0;
  let kept = 0;
  const removedIds: string[] = [];

  // Cache de existencia por fileId para no consultar dos veces el mismo archivo
  const existenceCache = new Map<string, boolean>();

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, unknown>;
    const driveFileId = String(data.driveFileId ?? '').trim();
    if (!driveFileId) { kept++; continue; }
    checked++;

    let exists = existenceCache.get(driveFileId);
    if (exists === undefined) {
      try {
        const res = await drive.files.get({
          fileId: driveFileId,
          fields: 'id, trashed',
          supportsAllDrives: true,
        });
        exists = !res.data.trashed;
      } catch (e: any) {
        const code = e?.code || e?.response?.status;
        if (code === 404) exists = false;
        else { kept++; existenceCache.set(driveFileId, true); continue; } // error transitorio: no borrar
      }
      existenceCache.set(driveFileId, exists);
    }

    if (exists) { kept++; continue; }

    await docSnap.ref.delete();
    removed++;
    removedIds.push(docSnap.id);
  }

  return { checked, removed, kept, removedIds };
}

/** Borra un backup puntual: elimina el archivo en Drive (si existe) y el doc de Firestore. */
export async function deleteDriveBackup(
  docId: string,
  opts: { empresaId?: string; scopeEmpresa?: boolean; isSuper?: boolean } = {},
): Promise<{ deleted: boolean; driveDeleted: boolean }> {
  const db = admin.firestore();
  const ref = db.collection('system_backups').doc(docId);
  const docSnap = await ref.get();
  if (!docSnap.exists) return { deleted: false, driveDeleted: false };

  const data = docSnap.data() as Record<string, unknown>;
  if (!opts.isSuper && opts.scopeEmpresa) {
    const docEmp = String(data.empresaId ?? '').trim();
    if (docEmp !== String(opts.empresaId ?? '').trim()) {
      throw new Error('El backup pertenece a otra empresa.');
    }
  }

  const driveFileId = String(data.driveFileId ?? '').trim();
  let driveDeleted = false;
  if (driveFileId) {
    try {
      const { google } = await import('googleapis');
      const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
      const drive = google.drive({ version: 'v3', auth });
      await drive.files.delete({ fileId: driveFileId, supportsAllDrives: true });
      driveDeleted = true;
    } catch (e: any) {
      const code = e?.code || e?.response?.status;
      if (code !== 404) throw e; // 404 = ya no estaba; cualquier otro error sube
    }
  }

  await ref.delete();
  return { deleted: true, driveDeleted };
}

/** Carpeta Drive: env de la función o último backup OK en Firestore (scheduled y manual comparten config). */
export async function resolveDriveBackupFolderId(): Promise<string | null> {
  const fromEnv = String(process.env.DRIVE_BACKUP_FOLDER_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    const db = admin.firestore();
    const snap = await db
      .collection('system_backups')
      .orderBy('createdAt', 'desc')
      .limit(12)
      .get();
    for (const d of snap.docs) {
      const meta = d.data();
      if (meta.status !== 'ok') continue;
      const folder = String(meta.driveBackupFolderId ?? meta.driveFolderId ?? '').trim();
      if (folder) return folder;
    }
  } catch (e) {
    console.warn('[resolveDriveBackupFolderId] fallback query failed', e);
  }
  return null;
}
