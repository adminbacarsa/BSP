/**
 * emulator-bridge.js
 * Mini servidor HTTP en puerto 3010.
 * Sirve como puente entre el BackupTab del emulador y gcloud/Drive,
 * ya que Next.js con output:'export' no soporta API routes.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const { execSync, execFile, spawn } = require('child_process');
const path = require('path');
const { pipeline } = require('stream/promises');
const { waitForFirestoreEmulator } = require('./emulator-firestore-ready');

let _importProgress = { active: false, done: 0, total: 0, col: '', phase: '', error: null };

const PORT = 3010;
const IMPORT_TIMEOUT_MS = 15 * 60 * 1000;
const FOLDER_ID = process.env.DRIVE_BACKUP_FOLDER_ID || '0AI2aip_4UuafUk9PVA';

// Firebase Admin para export (apunta al emulador local)
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
let _adminDb = null;
function getAdminDb() {
  if (_adminDb) return _adminDb;
  const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
  _adminDb = getFirestore();
  return _adminDb;
}

const EXPORT_EXCLUDE = new Set(['system_backups', 'restore_jobs', 'empresa_migrate_jobs', 'scheduled_job_logs']);
const EXPORT_DOC_ID_IS_EMPRESA = new Set(['planning_rules']);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Empresa-Id, X-Import-Mode, X-Import-Dev-Mode, X-File-Name');
  res.setHeader('Content-Type', 'application/json');
}

async function importBackupFile(req, res) {
  const empresaId = String(req.headers['x-empresa-id'] ?? 'bacarsa').trim() || 'bacarsa';
  const mode = String(req.headers['x-import-mode'] ?? 'empresa').trim();
  const devMode = req.headers['x-import-dev-mode'] === '1';
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

    try {
      await waitForFirestoreEmulator({ maxWaitMs: 45_000 });
    } catch (e) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const scriptPath = path.join(__dirname, 'seed-from-backup-file.js');
    const args = [scriptPath, tmpPath];
    if (mode === 'full') args.push('--full');
    else args.push('--empresa', empresaId);
    if (devMode) args.push('--dev');

    _importProgress = { active: true, done: 0, total: 0, col: '', phase: 'Preparando...', error: null };
    const output = await new Promise((resolve, reject) => {
      const childEnv = {
        ...process.env,
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      };
      const child = spawn(process.execPath, args, { env: childEnv });
      let stdout = '', stderr = '', stdoutBuf = '';
      const killTimer = setTimeout(() => {
        child.kill();
        reject(new Error(`Timeout: el import tardó más de ${IMPORT_TIMEOUT_MS / 60000} min`));
      }, IMPORT_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        stdoutBuf += text;
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const m = line.match(/^PROGRESS:(\d+):(\d+):(.*)$/);
          if (m) {
            _importProgress.done = parseInt(m[1], 10);
            _importProgress.total = parseInt(m[2], 10);
            _importProgress.col = m[3].trim();
            _importProgress.phase = '';
          }
          const s = line.match(/^STATUS:(.+)$/);
          if (s) { _importProgress.phase = s[1].trim(); }
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        _importProgress.active = false;
        if (code !== 0) {
          const detail = (stderr.trim() || stdout.trim() || `Exit code ${code}`).slice(0, 3000);
          reject(new Error(detail));
        } else resolve(`${stdout}\n${stderr}`.trim());
      });
      child.on('error', (err) => {
        clearTimeout(killTimer);
        _importProgress.active = false;
        reject(err);
      });
    });

    const writtenMatch = output.match(/([\d.,]+)\s+documentos importados/i);
    const written = writtenMatch
      ? parseInt(writtenMatch[1].replace(/[.,]/g, ''), 10)
      : 0;

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, fileName, written, output }));
  } catch (e) {
    const msg = e.message.slice(0, 2000);
    console.error('[emulator-bridge] import-backup-file', msg);
    const hint = /8080|UNAVAILABLE|ECONNRESET|offline|emulador/i.test(msg)
      ? ' Si el navegador muestra Firestore offline, reiniciá npm run lab:restart e importá de nuevo sin otras pestañas escribiendo.'
      : '';
    res.writeHead(500);
    res.end(JSON.stringify({ error: msg + hint }));
  } finally {
    _importProgress.active = false;
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

async function exportBackup(req, res) {
  const queryStr = (req.url || '').split('?')[1] || '';
  const params = new URLSearchParams(queryStr);
  const empresaId = String(params.get('empresaId') || '').trim();
  const scope = params.get('scope') || 'empresa';
  const scopeEmpresa = scope === 'empresa' && !!empresaId;

  try {
    const db = getAdminDb();
    const data = {};
    let totalDocs = 0;
    const exportedCollections = [];

    const rootCollections = await db.listCollections();

    for (const colRef of rootCollections) {
      const col = colRef.id;
      if (EXPORT_EXCLUDE.has(col)) continue;

      if (col === 'empresas' && scopeEmpresa) {
        try {
          const snap = await db.collection('empresas').doc(empresaId).get();
          if (snap.exists) {
            data[col] = [{ _id: snap.id, ...snap.data() }];
            totalDocs += 1;
            exportedCollections.push(col);
          }
        } catch {}
        continue;
      }

      try {
        const snap = await db.collection(col).limit(50000).get();
        if (snap.empty) continue;
        let docs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
        if (scopeEmpresa) {
          docs = docs.filter(row => {
            const docEmpId = String(row.empresaId ?? '').trim();
            return docEmpId === empresaId || (empresaId === 'bacarsa' && docEmpId === '');
          });
        }
        if (docs.length > 0) {
          data[col] = docs;
          totalDocs += docs.length;
          exportedCollections.push(col);
        }
      } catch {}
    }

    if (scopeEmpresa) {
      for (const col of EXPORT_DOC_ID_IS_EMPRESA) {
        try {
          const snap = await db.collection(col).doc(empresaId).get();
          if (snap.exists) {
            data[col] = [{ _id: snap.id, ...snap.data() }];
            totalDocs += 1;
            if (!exportedCollections.includes(col)) exportedCollections.push(col);
          }
        } catch {}
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
        authUsers: 0,
        source: 'emulator-export',
        ...(scopeEmpresa ? { empresaId, scopeEmpresa: true } : {}),
      },
      _auth_users: [],
      ...data,
    };

    const jsonStr = JSON.stringify(payload);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Disposition, X-File-Name, X-Total-Docs',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'X-File-Name': encodeURIComponent(fileName),
      'X-Total-Docs': String(totalDocs),
    });
    res.end(jsonStr);
    console.log(`[emulator-bridge] export-backup → ${fileName} (${totalDocs} docs)`);
  } catch (e) {
    console.error('[emulator-bridge] export-backup', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = (req.url || '').split('?')[0];

  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, port: PORT }));
    return;
  }

  if (req.method === 'GET' && url === '/import-progress') {
    res.writeHead(200);
    res.end(JSON.stringify(_importProgress));
    return;
  }

  if (req.method === 'POST' && url === '/import-backup-file') {
    importBackupFile(req, res);
    return;
  }

  if (req.method === 'GET' && url === '/export-backup') {
    exportBackup(req, res);
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
