import * as admin from 'firebase-admin';
import { Readable } from 'stream';

// Colecciones a excluir del backup
const EXCLUDE_COLLECTIONS = new Set<string>([
  // ninguna por ahora — system_backups se incluye para que el emulador muestre el historial
]);

const MAX_DOCS_PER_COLLECTION = 50000; // límite de seguridad por colección

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

export async function runBackup(folderId: string): Promise<BackupResult> {
  const db = admin.firestore();
  const data: Record<string, any[]> = {};
  let totalDocs = 0;
  const exportedCollections: string[] = [];

  // Exportar usuarios de Firebase Auth
  const authUsers = await exportAuthUsers();

  // Descubrir todas las colecciones automáticamente
  const rootCollections = await db.listCollections();

  for (const colRef of rootCollections) {
    const col = colRef.id;
    if (EXCLUDE_COLLECTIONS.has(col)) continue;
    try {
      const snap = await db.collection(col).limit(MAX_DOCS_PER_COLLECTION).get();
      if (!snap.empty) {
        data[col] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        totalDocs += snap.size;
        exportedCollections.push(col);
      }
    } catch (_) {
      // colección sin permisos, se omite
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 16).replace(':', '-');
  const fileName = `backup_${dateStr}_${timeStr}.json`;

  const payload = {
    _meta: {
      project: 'comtroldata',
      exportedAt: now.toISOString(),
      collections: exportedCollections,
      totalDocs,
      authUsers: authUsers.length,
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

  // Registrar en Firestore
  const ref = await db.collection('system_backups').add({
    driveFileId,
    driveLink,
    fileName,
    sizeBytes,
    collections: exportedCollections,
    totalDocs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'ok',
  });

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
  };
}
