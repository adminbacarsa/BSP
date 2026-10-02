/**
 * Capturas de la ficha de Play contra el export web local (HTML estático, sin JS).
 * Teléfono 1080×2400 (viewport 360×800 @3x), sin barras del navegador.
 * Antes: cd apps/mobile-guardia && npm run build:web
 *
 *   node scripts/capturar-play-ficha.mjs                # docs/play/capturas-{version}/
 *   PLAY_CAPTURAS_COPY="C:\...\1.2.0" node scripts/...  # copia extra (opcional)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const version = String(require(path.join(root, 'apps', 'mobile-guardia', 'package.json')).version || '0.0.0');
const outDir = process.env.PLAY_CAPTURAS_OUT || path.join(root, 'docs', 'play', `capturas-${version}`);
const copyDir = process.env.PLAY_CAPTURAS_COPY || '';
const dist = path.join(root, 'apps', 'mobile-guardia', 'dist-web');
const port = Number(process.env.PLAY_CAPTURAS_PORT || 4179);
const base = process.env.PLAY_CAPTURAS_URL || `http://127.0.0.1:${port}/app`;

const VIEWPORT = { width: 360, height: 800 };
const SCALE = 3;

const frames = [
  ['hoy', '01-inicio-turno-del-dia.png', 'Listo para fichar'],
  ['agenda', '02-agenda.png', /ctubre de 2026/],
  ['fichada', '03-fichada-ubicacion.png', 'GPS verificado'],
  ['alertas', '04-alertas-bandeja.png', 'Marcar todas leídas'],
  ['convocatoria', '05-convocatoria-aceptar-rechazar.png', 'No puedo'],
  ['venis', '06-aviso-venis-10-15-30.png', 'Tengo un problema'],
];

const extras = ['icono-512.png', 'destacada-1024x500.png'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Servidor estático mínimo: sirve dist-web bajo /app (mismo baseUrl que Hosting). */
function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/app' || rel.startsWith('/app/')) rel = rel.slice('/app'.length) || '/';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(dist, rel));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let server;
function stopServer() {
  if (server) server.close();
  server = undefined;
}

if (!fs.existsSync(path.join(dist, 'play-capturas', 'hoy.html'))) {
  throw new Error(`Falta ${dist}\\play-capturas\\hoy.html. Corré npm run build:web en apps/mobile-guardia.`);
}

if (!process.env.PLAY_CAPTURAS_URL) {
  server = await startStaticServer();
  const res = await fetch(`${base}/play-capturas/hoy.html`);
  if (!res.ok) {
    stopServer();
    throw new Error(`No respondió ${base}/play-capturas/hoy.html (${res.status})`);
  }
}

fs.mkdirSync(outDir, { recursive: true });
if (copyDir) fs.mkdirSync(copyDir, { recursive: true });

function writeOut(file, buffer) {
  fs.writeFileSync(path.join(outDir, file), buffer);
  if (copyDir) fs.writeFileSync(path.join(copyDir, file), buffer);
  console.log(`${file} (${VIEWPORT.width * SCALE}x${VIEWPORT.height * SCALE})`);
}

let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    javaScriptEnabled: false,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  });
  const page = await context.newPage();

  for (const [frame, file, needle] of frames) {
    const url = `${base}/play-capturas/${frame}.html`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByText(needle).first().waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    const buffer = await page.screenshot({ fullPage: false });
    writeOut(file, buffer);
  }

  for (const extra of extras) {
    const src = path.join(root, 'docs', 'play', extra);
    if (!fs.existsSync(src)) {
      console.warn(`Falta ${src} (generarlo con apps/mobile-guardia/scripts/generate-play-store-assets.py)`);
      continue;
    }
    const buffer = fs.readFileSync(src);
    fs.writeFileSync(path.join(outDir, extra), buffer);
    if (copyDir) fs.writeFileSync(path.join(copyDir, extra), buffer);
    console.log(`${extra} (copiado)`);
  }
} finally {
  if (browser) await browser.close();
  stopServer();
}
