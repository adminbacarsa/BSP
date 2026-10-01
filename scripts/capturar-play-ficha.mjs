/**
 * Capturas 1080×1920 de la ficha de Play, contra el export web local.
 * Antes: cd apps/mobile-guardia && npm run build:web
 *
 *   node scripts/capturar-play-ficha.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'play');
const dist = path.join(root, 'apps', 'mobile-guardia', 'dist-web');
const port = Number(process.env.PLAY_CAPTURAS_PORT || 4179);
const base = process.env.PLAY_CAPTURAS_URL || `http://127.0.0.1:${port}/app`;

let server;
let serveRoot;
function stopServer() {
  if (server) server.kill();
  server = undefined;
  if (serveRoot) {
    fs.unlinkSync(path.join(serveRoot, 'app'));
    fs.rmdirSync(serveRoot);
    serveRoot = undefined;
  }
}
if (!process.env.PLAY_CAPTURAS_URL) {
  serveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'play-capturas-'));
  fs.symlinkSync(dist, path.join(serveRoot, 'app'), 'junction');
  server = spawn('npx', ['--yes', 'serve', serveRoot, '-p', String(port), '-n'], {
    shell: true,
    stdio: 'ignore',
  });
  let ready = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/play-capturas/hoy.html`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* todavía no escucha */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!ready) {
    stopServer();
    throw new Error(`No respondió ${base}/play-capturas/hoy.html`);
  }
}

const frames = [
  ['hoy', '01-hoy.png'],
  ['fichada', '02-fichada.png'],
  ['alertas', '03-alertas.png'],
  ['credencial', '04-credencial.png'],
  ['agenda', '05-agenda.png'],
  ['contratos', '06-contratos.png'],
];

let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 3,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();

  for (const [frame, file] of frames) {
    const url = `${base}/play-capturas/${frame}.html`;
    const needle = {
      hoy: 'Fichar presente',
      fichada: 'Presente registrado',
      alertas: 'Convocatoria de cobertura',
      credencial: 'DNI 00.000.000',
      agenda: 'Octubre 2026',
      contratos: 'Contrato marco de prueba',
    }[frame];
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.getByText(needle).waitFor({ timeout: 30_000 });
    await page.screenshot({ path: path.join(outDir, file) });
    console.log(file);
  }
} finally {
  if (browser) await browser.close();
  stopServer();
}
