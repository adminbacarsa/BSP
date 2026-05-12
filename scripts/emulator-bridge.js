/**
 * emulator-bridge.js
 * Mini servidor HTTP en puerto 3010.
 * Sirve como puente entre el BackupTab del emulador y gcloud/Drive,
 * ya que Next.js con output:'export' no soporta API routes.
 */
const http = require('http');
const { execSync, exec } = require('child_process');
const path = require('path');

const PORT = 3010;
const FOLDER_ID = process.env.DRIVE_BACKUP_FOLDER_ID || '0AI2aip_4UuafUk9PVA';

function getToken() {
  return execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
}

function listDriveBackups() {
  const token = getToken();
  const q = encodeURIComponent(`'${FOLDER_ID}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,size,createdTime,webViewLink)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime+desc&fields=${fields}&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const result = execSync(`curl -s -H "Authorization: Bearer ${token}" "${url}"`, { encoding: 'utf8' });
  const data = JSON.parse(result);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return (data.files || [])
    .filter(f => f.name && f.name.startsWith('backup_'))
    .map(f => ({
      id: f.id,
      driveFileId: f.id,
      fileName: f.name,
      driveLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      sizeBytes: parseInt(f.size || '0', 10),
      totalDocs: null,
      collections: null,
      createdAt: f.createdTime,
      status: 'ok',
    }));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = (req.url || '').split('?')[0];

  if (req.method === 'GET' && url === '/list-backups') {
    try {
      const backups = listDriveBackups();
      res.writeHead(200);
      res.end(JSON.stringify({ backups }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'POST' && url === '/load-backup') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { driveFileId } = JSON.parse(body);
        if (!driveFileId) { res.writeHead(400); res.end(JSON.stringify({ error: 'driveFileId requerido' })); return; }
        const scriptPath = path.join(__dirname, 'seed-from-drive.js');
        exec(`node "${scriptPath}" "${driveFileId}"`, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) { res.writeHead(500); res.end(JSON.stringify({ error: stderr || err.message, output: stdout })); }
          else { res.end(JSON.stringify({ ok: true, output: stdout })); }
        });
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[emulator-bridge] http://localhost:${PORT} - listo`);
});
