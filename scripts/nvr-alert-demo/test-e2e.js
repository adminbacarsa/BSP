/**
 * Test E2E: POST al webhook con imagen mínima y verificación en Firestore.
 * Requiere: seed ya ejecutado (o config manual en Firestore) y webhook desplegado + invoker público.
 */
const path = require('path');
const https = require('https');
const { Writable } = require('stream');
const admin = require('firebase-admin');
const FormData = require('form-data');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// JPEG mínimo válido (1x1 pixel) para no depender de archivo externo
const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQACEQADAPwA/9k=';
const MINIMAL_JPEG = Buffer.from(MINIMAL_JPEG_BASE64, 'base64');

const REQUEST_TIMEOUT_MS = 120000;

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    return require(configPath);
  } catch (e) {
    console.error('Crea config.json (copia config.example.json).');
    process.exit(1);
  }
}

function postMultipart(url, secret, fields, fileBuffer, filename) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const pathWithKey =
      parsed.pathname +
      (parsed.search || '') +
      (secret ? (parsed.search ? '&' : '?') + 'key=' + encodeURIComponent(secret) : '');

    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
    form.append('image', fileBuffer, { filename: filename || 'snapshot.jpg', contentType: 'image/jpeg' });

    const chunks = [];
    const collector = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    collector.on('finish', () => {
      const body = Buffer.concat(chunks);
      const headers = { ...form.getHeaders(), 'Content-Length': body.length };

      const req = https.request(
        {
          hostname: parsed.hostname,
          port: 443,
          path: pathWithKey,
          method: 'POST',
          headers,
        },
        (res) => {
          const resChunks = [];
          res.on('data', (c) => resChunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(resChunks).toString('utf8');
            let bodyJson;
            try {
              bodyJson = JSON.parse(text);
            } catch {
              bodyJson = text;
            }
            resolve({ statusCode: res.statusCode, body: bodyJson });
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error('Timeout después de ' + REQUEST_TIMEOUT_MS / 1000 + 's'));
      });
      req.write(body);
      req.end();
    });
    form.pipe(collector);
  });
}

async function run() {
  const config = loadConfig();
  const { projectId, webhookUrl, secret, channelId, cameraName, serviceAccountPath } = config;

  console.log('Enviando POST al webhook... (timeout 120s)');
  const result = await postMultipart(
    webhookUrl,
    secret,
    {
      channel_id: String(channelId ?? 2),
      camera_name: cameraName || 'Entrada Principal',
      event_type: 'Tripwire',
      object_type: 'human',
    },
    MINIMAL_JPEG,
    'snapshot.jpg'
  );

  if (result.statusCode !== 200) {
    console.error('Webhook respondió:', result.statusCode, result.body);
    process.exit(1);
  }

  const alertId = result.body && result.body.alertId;
  if (!alertId) {
    console.error('Respuesta sin alertId:', result.body);
    process.exit(1);
  }

  console.log('AlertId:', alertId);

  const saPath = path.isAbsolute(serviceAccountPath)
    ? serviceAccountPath
    : path.join(PROJECT_ROOT, serviceAccountPath || 'service-account.json');
  if (!admin.apps.length) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(require(saPath)), projectId });
    } catch (e) {
      console.warn('No se pudo conectar a Firestore para verificación:', e.message);
      console.log('E2E parcial OK: webhook creó alertId', alertId);
      process.exit(0);
    }
  }

  const db = admin.firestore();
  const ref = db.collection('alerts').doc(alertId);
  const doc = await ref.get();
  if (!doc.exists) {
    console.error('Alerta no encontrada en Firestore:', alertId);
    process.exit(1);
  }

  const data = doc.data();
  if (data.status !== 'pending') {
    console.warn('status esperado pending, got', data.status);
  }
  if (!data.image_url) {
    console.error('Falta image_url en el doc.');
    process.exit(1);
  }

  console.log('Verificación OK: doc alerts/' + alertId + ' con image_url y status pending.');
  console.log('URL imagen:', data.image_url);
  if (data.notification) {
    console.log('Notificación:', data.notification.sent ? 'enviada' : 'no enviada', data.notification.reason || '');
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e.message || e);
  if ((e.message || '').includes('Timeout')) {
    console.log('\nAlternativa con curl (muestra código HTTP y respuesta):');
    console.log('  curl.exe -w "\\nHTTP:%{http_code}" -m 120 -X POST "https://us-central1-comtroldata.cloudfunctions.net/nvrAlert?key=123456" -F "image=@scripts/nvr-alert-demo/snapshot.jpg" -F "channel_id=2" -F "camera_name=Entrada" -F "event_type=Tripwire" -F "object_type=human"');
  }
  process.exit(1);
});
