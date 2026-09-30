/**
 * Copia del TXT a Drive: archivo y respaldo humano.
 * Reutiliza la integración de backups (`googleapis` + carpeta raíz ya configurada).
 * Sin carpeta configurada no falla el envío: devuelve skipped y lo sube n8n.
 */
import { Readable } from 'stream';
import { resolveDriveBackupFolderId, resolveOrCreateDriveFolder } from '../backup/backup.service';

export type ArcaDriveResult = {
  ok: boolean;
  driveFileId?: string;
  driveLink?: string;
  skipped?: boolean;
  reason?: string;
};

async function carpetaRaiz(drive: unknown): Promise<string | null> {
  const dedicada = String(process.env.DRIVE_ARCA_FOLDER_ID ?? '').trim();
  if (dedicada) return dedicada;
  const backupRoot = await resolveDriveBackupFolderId();
  if (!backupRoot) return null;
  try {
    return await resolveOrCreateDriveFolder(drive, backupRoot, 'arca-envios');
  } catch (e) {
    console.warn('[arcaEnvioDrive] No se pudo crear arca-envios', e);
    return null;
  }
}

export async function subirTxtADrive(input: {
  envioId: string;
  empresaId: string;
  tipo: 'AT' | 'BT';
  txt: string;
}): Promise<ArcaDriveResult> {
  if (!input.txt?.trim()) return { ok: false, skipped: true, reason: 'TXT_VACIO' };

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
  const drive = google.drive({ version: 'v3', auth });

  const raiz = await carpetaRaiz(drive);
  if (!raiz) return { ok: false, skipped: true, reason: 'DRIVE_ARCA_FOLDER_ID/DRIVE_BACKUP_FOLDER_ID no configurado' };

  let folderId = raiz;
  try {
    folderId = await resolveOrCreateDriveFolder(drive, raiz, input.empresaId);
  } catch (e) {
    console.warn(`[arcaEnvioDrive] Subcarpeta ${input.empresaId}, uso la raíz`, e);
  }

  const nombre = `${input.tipo}_${input.empresaId}_${input.envioId}.txt`;
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name: nombre, parents: [folderId], description: `COSP envío ARCA ${input.envioId}` },
    media: { mimeType: 'text/plain', body: Readable.from([input.txt]) },
    fields: 'id, webViewLink',
  });

  const driveFileId = res.data.id!;
  return {
    ok: true,
    driveFileId,
    driveLink: res.data.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`,
  };
}
