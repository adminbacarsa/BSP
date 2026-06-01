/**
 * emulator-bridge.js
 * Mini servidor HTTP en puerto 3010.
 * Sirve como puente entre el BackupTab del emulador y gcloud/Drive,
 * ya que Next.js con output:'export' no soporta API routes.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const { execSync, execFile } = require('child_process');
const path = require('path');
const { pipeline } = require('stream/promises');

const PORT = 3010;
const IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
const FOLDER_ID = process.env.DRIVE_BACKUP_FOLDER_ID || '0AI2aip_4UuafUk9PVA';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Empresa-Id, X-Import-Mode, X-File-Name');
  res.setHeader('Content-Type', 'application/json');
}

async function importBackupFile(req, res) {
  const empresaId = String(req.headers['x-empresa-id'] ?? 'bacarsa').trim() || 'bacarsa';
  const mode = String(req.headers['x-import-mode'] ?? 'empresa').trim();
  const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'backup.json').trim());
  const tmpPath = path.join(os.tmpdir(), `cosp-backup-${Date.now()}.json`);

  try {
    await pipeline(req, fs.createWriteStream(tmpPath));
    const stat = fs.statSync(tmpPath);
    if (stat.size < 10) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Archivo vacío o no recibido' }));
      return;
    }

    const scriptPath = path.join(__dirname, 'seed-from-backup-file.js');
    const args = [scriptPath, tmpPath];
    if (mode === 'full') args.push('--full');
    else args.push('--empresa', empresaId);

    const output = await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        args,
        {
          timeout: IMPORT_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
          env: {
            ...process.env,
            FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
            FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
          },
        },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message || 'Error al importar'));
          else resolve(`${stdout}\n${stderr}`.trim());
        },
      );
    });

    const writtenMatch = output.match(/([\d.,]+)\s+documentos importados/i);
    const written = writtenMatch
      ? parseInt(writtenMatch[1].replace(/[.,]/g, ''), 10)
      : 0;

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, fileName, written, output }));
  } catch (e) {
    console.error('[emulator-bridge] import-backup-file', e.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message.slice(0, 2000) }));
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* omit */ }
  }
}

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
  setCors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = (req.url || '').split('?')[0];

  if (req.method === 'POST' && url === '/import-backup-file') {
    importBackupFile(req, res);
    return;
  }

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
        execFile(process.execPath, [scriptPath, driveFileId], { timeout: 120000 }, (err, stdout, stderr) => {
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
