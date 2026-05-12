#!/usr/bin/env node
/**
 * Proxy HTTP → HTTPS para NVR.
 * Recibe peticiones por HTTP (puerto 8080) y las reenvía al webhook por HTTPS.
 * Ejecutar en la misma red que la NVR y apuntar la NVR a http://IP_DE_ESTE_PC:8080
 *
 * Uso: node scripts/nvr-http-to-https-proxy.js
 * Variables de entorno (opcionales):
 *   PORT=8080
 *   TARGET_URL=https://us-central1-comtroldata.cloudfunctions.net/nvrAlertV2
 */

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);
const TARGET_URL = process.env.TARGET_URL || 'https://us-central1-comtroldata.cloudfunctions.net/nvrAlertV2';
const LOG_BODY = process.env.NVR_LOG_BODY === '1' || process.env.DEBUG === '1';

const TARGET = url.parse(TARGET_URL);

/**
 * Inspecciona el body multipart y extrae nombres de partes y valores de texto (para saber qué envía la NVR).
 * No modifica el body; solo lo analiza para logging.
 */
function inspectMultipart(body, contentType) {
  if (!body || !Buffer.isBuffer(body) || body.length < 10) return null;
  const ct = String(contentType || '');
  const boundaryMatch = ct.match(/\bboundary\s*=\s*["']?([^"'\s;]+)["']?/i);
  const boundary = boundaryMatch ? boundaryMatch[1].trim().replace(/^["']|["']$/g, '') : null;
  if (!boundary) return { error: 'no boundary in Content-Type' };
  const delim = Buffer.from('--' + boundary, 'utf8');
  const out = { parts: [], rawFields: {} };
  let idx = body.indexOf(delim);
  if (idx < 0) return { error: 'boundary not found in body' };
  idx += delim.length;
  while (idx < body.length) {
    const nextDelim = body.indexOf(delim, idx);
    const partEnd = nextDelim >= 0 ? nextDelim : body.length;
    let part = body.subarray(idx, partEnd);
    const dbl = part.indexOf(Buffer.from('\r\n\r\n'));
    const headerEnd = dbl >= 0 ? dbl + 4 : part.indexOf(Buffer.from('\n\n')) >= 0 ? part.indexOf(Buffer.from('\n\n')) + 2 : -1;
    const headers = headerEnd >= 0 ? part.subarray(0, headerEnd - 2).toString('utf8') : '';
    const partBody = headerEnd >= 0 ? part.subarray(headerEnd) : part;
    const nameMatch = headers.match(/\bname\s*=\s*["']?([^"'\r\n;]+)["']?/i);
    const filenameMatch = headers.match(/\bfilename\s*=\s*["']?([^"'\r\n;]+)["']?/i);
    const name = nameMatch ? nameMatch[1].trim() : '(sin name)';
    const filename = filenameMatch ? filenameMatch[1].trim() : null;
    const isLikelyBinary = partBody.length > 256 || (partBody.length > 0 && partBody[0] === 0xff && partBody[1] === 0xd8);
    let valuePreview = null;
    if (!isLikelyBinary && partBody.length > 0 && partBody.length <= 500) {
      try {
        valuePreview = partBody.toString('utf8').replace(/\r?\n/g, ' ').slice(0, 120);
      } catch (_) {}
    } else if (!isLikelyBinary && partBody.length > 500) {
      try {
        valuePreview = partBody.toString('utf8', 0, 80).replace(/\r?\n/g, ' ') + '…';
      } catch (_) {}
    }
    out.parts.push({ name, filename: filename || null, size: partBody.length, binary: isLikelyBinary, valuePreview: valuePreview || (isLikelyBinary ? '(imagen/binario)' : null) });
    if (name !== '(sin name)' && valuePreview) out.rawFields[name] = valuePreview;
    if (nextDelim < 0) break;
    idx = nextDelim + delim.length;
  }
  return out;
}
const TARGET_HOST = TARGET.hostname;
const TARGET_PORT = TARGET.port || 443;

function copyHeadersToObject(src, exclude = []) {
  // Excluir host, connection y encoding: la NVR a veces envía Content-Encoding: gzip con body sin comprimir
  // y la Cloud Function intenta descomprimir → "incorrect header check". Enviamos body crudo sin ese header.
  const set = new Set([
    'host',
    'connection',
    'content-encoding',
    'transfer-encoding',
    ...exclude
  ].map(h => h.toLowerCase()));
  const out = {};
  for (let i = 0; i < src.rawHeaders.length; i += 2) {
    const name = src.rawHeaders[i].toLowerCase();
    if (set.has(name)) continue;
    out[src.rawHeaders[i]] = src.rawHeaders[i + 1];
  }
  return out;
}

const server = http.createServer((req, res) => {
  const clientIp = req.socket.remoteAddress || req.connection?.remoteAddress || '?';
  const reqPath = (req.url || '/').split('?')[0] || '/';
  const reqQuery = req.url && req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const pathWithQuery = (reqPath.startsWith('/') ? reqPath : '/' + reqPath) + reqQuery;

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '(no enviado)';
    console.log('[PROXY] Recibido:', req.method, pathWithQuery, '| body:', body.length, 'bytes', '| Content-Type:', String(contentType).slice(0, 60), '| desde:', clientIp);

    if (LOG_BODY && body.length > 0 && contentType.includes('multipart')) {
      try {
        const inspected = inspectMultipart(body, contentType);
        if (inspected && !inspected.error) {
          console.log('[PROXY] NVR body (partes):', inspected.parts.map(p => `${p.name}${p.filename ? ' (file: ' + p.filename + ')' : ''} ${p.binary ? p.size + ' bytes' : (p.valuePreview ? '= ' + JSON.stringify(p.valuePreview.slice(0, 80)) : p.size + ' bytes')}`).join(' | '));
          if (Object.keys(inspected.rawFields).length > 0) {
            console.log('[PROXY] NVR campos (texto):', JSON.stringify(inspected.rawFields));
          }
        } else if (inspected && inspected.error) {
          console.log('[PROXY] NVR body inspección:', inspected.error);
        }
      } catch (e) {
        console.log('[PROXY] NVR body inspección error:', e.message);
      }
    }

    const options = {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: pathWithQuery.startsWith('/') ? pathWithQuery : '/' + pathWithQuery,
      method: req.method,
      headers: {},
      rejectUnauthorized: true,
    };
    options.headers = copyHeadersToObject(req);
    if (body.length) options.headers['Content-Length'] = body.length;

    const proxyReq = https.request(options, (proxyRes) => {
      console.log('[PROXY] Respuesta HTTPS:', proxyRes.statusCode, pathWithQuery);
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.setTimeout(130000, () => {
      proxyReq.destroy();
      console.error('[PROXY] Timeout 130s esperando respuesta de la Cloud Function');
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Timeout: la función no respondió en 130s');
      }
    });
    proxyReq.on('error', (e) => {
      console.error('[PROXY] Error hacia HTTPS:', e.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Error de proxy: ' + e.message);
      }
    });
    if (body.length) proxyReq.write(body);
    proxyReq.end();
  });
  req.on('error', (e) => {
    console.error('[PROXY] Error leyendo request:', e.message);
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Error: ' + e.message);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[NVR Proxy] Escuchando HTTP en http://0.0.0.0:' + PORT);
  console.log('[NVR Proxy] Reenviando a:', TARGET_URL);
  if (LOG_BODY) console.log('[NVR Proxy] Modo inspección activo (NVR_LOG_BODY=1): se mostrará qué envía la NVR en cada request.');
  console.log('');
  console.log('Configura la NVR con:');
  console.log('  - Dirección: IP de esta PC (ej. ' + getLocalIP() + ')');
  console.log('  - Puerto: ' + PORT);
  console.log('  - Ruta: /nvrAlertV2?key=123456  (o /nvrWebhookTest para prueba)');
  console.log('  - Opcional: ?channel=1 o ?channel=2 para identificar cámara por URL');
  console.log('');
});

function getLocalIP() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (!net.internal && net.family === 'IPv4') return net.address;
    }
  }
  return '127.0.0.1';
}
