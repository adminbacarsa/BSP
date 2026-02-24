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

const TARGET = url.parse(TARGET_URL);
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
  console.log('');
  console.log('Configura la NVR con:');
  console.log('  - Dirección: IP de esta PC (ej. ' + getLocalIP() + ')');
  console.log('  - Puerto: ' + PORT);
  console.log('  - Ruta: /nvrAlertV2?key=123456  (o /nvrWebhookTest para prueba)');
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
