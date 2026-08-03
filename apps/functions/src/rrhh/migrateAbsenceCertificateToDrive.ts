import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { Readable } from 'stream';
import { resolveOrCreateDriveFolder } from '../backup/backup.service';

export type MigrateAbsenceCertificateResult =
  | { ok: true; driveFileId: string; driveLink: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

function sanitizeDriveFileName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'certificado';
}

/** Ruta en bucket a partir de URL de Firebase Storage (`.../o/absences%2F...`). */
export function storagePathFromFirebaseDownloadUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const pathPart = u.pathname.split('/o/')[1];
    if (!pathPart) return null;
    const withoutQuery = pathPart.split('?')[0];
    return decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
}

async function resolveCertsRootFolderId(drive: any): Promise<string | null> {
  const dedicated = String(process.env.DRIVE_RRHH_CERTS_FOLDER_ID ?? '').trim();
  if (dedicated) return dedicated;

  const backupRoot = String(process.env.DRIVE_BACKUP_FOLDER_ID ?? '').trim();
  if (!backupRoot) return null;

  try {
    return await resolveOrCreateDriveFolder(drive, backupRoot, 'certificados-ausencias');
  } catch (e) {
    console.warn('[migrateAbsenceCertificate] No se pudo crear certificados-ausencias bajo backup root', e);
    return backupRoot;
  }
}

function guessMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

/**
 * Copia el certificado de Firebase Storage a Google Drive y borra el objeto en Storage.
 * Pensado para ~1000 legajos: un evento por ausencia, sin batch.
 */
export async function migrateAbsenceCertificateToDrive(
  ausenciaId: string,
  data: admin.firestore.DocumentData,
): Promise<MigrateAbsenceCertificateResult> {
  if (data.certificateDriveFileId) {
    return { ok: false, skipped: true, reason: 'already_migrated' };
  }

  const downloadUrl = String(data.certificateUrl ?? '').trim();
  const storagePathExplicit = String(data.certificateStoragePath ?? '').trim();
  const storagePath =
    storagePathExplicit ||
    (downloadUrl ? storagePathFromFirebaseDownloadUrl(downloadUrl) : '');

  if (!storagePath || (!storagePath.startsWith('absences/') && !storagePath.startsWith('certificados/'))) {
    return {
      ok: false,
      skipped: false,
      error: 'Sin certificateStoragePath ni URL de Storage válida (ruta absences/)',
    };
  }

  if (process.env.FUNCTIONS_EMULATOR === 'true' && !process.env.DRIVE_RRHH_CERTS_FOLDER_ID) {
    return { ok: false, skipped: true, reason: 'emulator_without_DRIVE_RRHH_CERTS_FOLDER_ID' };
  }

  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    return { ok: false, skipped: false, error: `Archivo no encontrado en Storage: ${storagePath}` };
  }

  const [metadata] = await file.getMetadata();
  const sizeBytes = Number(metadata.size ?? 0);
  if (sizeBytes > 12 * 1024 * 1024) {
    return { ok: false, skipped: false, error: 'Certificado supera 12 MB (límite de migración)' };
  }

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const rootFolderId = await resolveCertsRootFolderId(drive);
  if (!rootFolderId) {
    return { ok: false, skipped: true, reason: 'DRIVE_RRHH_CERTS_FOLDER_ID/DRIVE_BACKUP_FOLDER_ID no configurado' };
  }

  const empresaId = String(data.empresaId ?? 'bacarsa').trim() || 'bacarsa';
  const year = String(data.startDate ?? '').slice(0, 4) || new Date().getFullYear().toString();

  let folderId = rootFolderId;
  try {
    folderId = await resolveOrCreateDriveFolder(drive, rootFolderId, empresaId);
    folderId = await resolveOrCreateDriveFolder(drive, folderId, year);
  } catch (e) {
    console.warn(`[migrateAbsenceCertificate] Subcarpetas Drive ${empresaId}/${year}, usando raíz certs`, e);
    folderId = rootFolderId;
  }

  const baseName = String(data.certificateName ?? '').trim() || storagePath.split('/').pop() || 'certificado';
  const employeeLabel = sanitizeDriveFileName(String(data.employeeName ?? 'empleado'));
  const driveFileName = sanitizeDriveFileName(
    `${employeeLabel}_${data.startDate || 'sin-fecha'}_${ausenciaId.slice(0, 8)}_${baseName}`,
  );

  const [buffer] = await file.download();
  const mimeType =
    (metadata.contentType && String(metadata.contentType)) || guessMimeType(baseName);

  const driveRes = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: driveFileName,
      parents: [folderId],
      mimeType,
      description: `COSP ausencia ${ausenciaId} · legajo ref ${data.employeeId ?? ''}`,
    },
    media: { mimeType, body: Readable.from([buffer]) },
    fields: 'id, webViewLink',
  });

  const driveFileId = driveRes.data.id!;
  const driveLink =
    driveRes.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;

  const db = admin.firestore();
  await db.collection('ausencias').doc(ausenciaId).update({
    certificateDriveFileId: driveFileId,
    certificateDriveLink: driveLink,
    certificateMigratedAt: FieldValue.serverTimestamp(),
    certificateUrl: FieldValue.delete(),
    certificateStoragePath: FieldValue.delete(),
    certificateDriveMigrateError: FieldValue.delete(),
  });

  try {
    await file.delete();
  } catch (e) {
    console.warn(`[migrateAbsenceCertificate] Drive OK pero no se pudo borrar Storage ${storagePath}`, e);
  }

  console.log(
    `[migrateAbsenceCertificate] OK ausencia=${ausenciaId} driveFileId=${driveFileId} size=${sizeBytes}`,
  );

  return { ok: true, driveFileId, driveLink };
}
