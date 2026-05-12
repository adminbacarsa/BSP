import type { NextApiRequest, NextApiResponse } from 'next';
import { execSync } from 'child_process';
import https from 'https';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NEXT_PUBLIC_USE_EMULATOR !== 'true') {
    return res.status(403).json({ error: 'Solo disponible en modo emulador' });
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const folderId = process.env.DRIVE_BACKUP_FOLDER_ID;
  if (!folderId) {
    return res.status(500).json({ error: 'DRIVE_BACKUP_FOLDER_ID no configurado en .env.local' });
  }

  try {
    const token = execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();

    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,size,createdTime,webViewLink)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime+desc&fields=${fields}&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const data = await new Promise<any>((resolve, reject) => {
      https.get(url, { headers: { Authorization: `Bearer ${token}` } }, r => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Parse error: ' + body.slice(0, 300))); }
        });
      }).on('error', reject);
    });

    if (data.error) {
      return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
    }

    const backups = (data.files || [])
      .filter((f: any) => f.name && f.name.startsWith('backup_'))
      .map((f: any) => ({
        id: f.id,
        driveFileId: f.id,
        fileName: f.name,
        driveLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        sizeBytes: parseInt(f.size || '0', 10),
        totalDocs: null,
        collections: null,
        createdAt: f.createdTime,
        status: 'ok' as const,
      }));

    res.json({ backups });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
