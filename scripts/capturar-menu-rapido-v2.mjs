#!/usr/bin/env node
/**
 * Capturas 1440x900 de la GRILLA real de Planificación con el menú rápido (clic derecho → modo elegir).
 * Requiere: emuladores Auth + Firestore, `node scripts/seed-admin.js`, `node scripts/seed-captura-menu-rapido.mjs`
 * y `next build` en apps/web2 con NEXT_PUBLIC_USE_EMULATOR=true. Usa el Chromium de la caché de Playwright
 * por el protocolo de DevTools (sin dependencias).
 *
 *   node scripts/capturar-menu-rapido-v2.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web2/out');
const shotsDir = join(root, 'docs/capturas-cobertura');
const PORT = Number(process.env.CAPTURA_PORT || 3011);
const DEVTOOLS = 9333;
const OBJ = 'obj_mr';
const CLI = 'cli_mr';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/sw.js' || url === '/firebase-messaging-sw.js') {
    res.writeHead(404);
    res.end();
    return;
  }
  let file = join(outDir, url);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) file = join(outDir, '404.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function chromePath() {
  const base = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const p = join(base, d, sub, 'chrome.exe');
      if (existsSync(p)) return p;
    }
  }
  throw new Error('No hay Chromium en la caché de Playwright');
}
const profile = join(tmpdir(), `cosp-captura-${Date.now()}`);
const chrome = spawn(chromePath(), [
  '--headless=new', `--remote-debugging-port=${DEVTOOLS}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
  '--lang=es-AR', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function devtools(path) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEVTOOLS}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' });
      if (r.ok) return r.json();
    } catch { /* arrancando */ }
    await sleep(250);
  }
  throw new Error('DevTools no responde');
}
const target = await devtools(`/json/new?about:blank`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (process.env.CAPTURA_DEBUG && msg.method === 'Runtime.consoleAPICalled') {
    console.log('[consola]', msg.params.type, msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
  if (process.env.CAPTURA_DEBUG && msg.method === 'Runtime.exceptionThrown') {
    console.log('[error]', msg.params.exceptionDetails?.exception?.description?.slice(0, 300));
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, ms = 30000, label = expression) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(250);
  }
  const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (r) writeFileSync(join(root, '.captura-debug.png'), Buffer.from(r.data, 'base64'));
  const texto = await evaluate(`location.href + ' :: ' + document.body.innerText.slice(0, 600)`).catch(() => '');
  throw new Error(`Timeout esperando: ${label}\n${texto}`);
};
const rectOf = (selector) => evaluate(`(() => { const el = ${selector}; if (!el) return null; el.scrollIntoView({block:'center', inline:'center'}); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const mouse = async (type, x, y, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, buttons: button === 'right' ? 2 : 1 });
async function click(selector, button = 'left') {
  const p = await rectOf(selector);
  if (!p) throw new Error(`No está: ${selector}`);
  await mouse('mouseMoved', p.x, p.y, 'none');
  await mouse('mousePressed', p.x, p.y, button);
  await mouse('mouseReleased', p.x, p.y, button);
  await sleep(450);
  return p;
}
async function hover(selector) {
  const p = await rectOf(selector);
  if (!p) throw new Error(`No está: ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await sleep(400);
}
mkdirSync(shotsDir, { recursive: true });
async function shot(name) {
  await sleep(500);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const file = join(shotsDir, `menu-rapido-v2-${name}.png`);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓', file);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setTimezoneOverride', { timezoneId: 'America/Argentina/Buenos_Aires' });
await send('Emulation.setLocaleOverride', { locale: 'es-AR' }).catch(() => {});
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/login/` });
await waitFor(`(() => { const el = document.querySelector('input[type=email]'); return el && Object.keys(el).some((k) => k.startsWith('__reactProps')); })()`, 60000, 'login hidratado');
await sleep(800);
await evaluate(`(() => {
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set(document.querySelector('input[type=email]'), 'admin@bacarsa.com.ar');
  set(document.querySelector('input[type=password]'), 'admin1234');
  const btn = [...document.querySelectorAll('button')].find((b) => /ingresar/i.test(b.textContent || ''));
  btn.click();
})()`);
await waitFor(`!location.pathname.startsWith('/login')`, 60000, 'salir del login');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/admin/planificacion/?objectiveId=${OBJ}&clientId=${CLI}&year=2026&month=10` });

await sleep(1500);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Browser.setWindowBounds', {
  windowId: (await send('Browser.getWindowForTarget', {})).windowId,
  bounds: { width: 1440, height: 900 },
}).catch(() => {});
const fila = (emp) => `document.getElementById('plan-emp-${emp}')`;
const celda = (emp, dia) => `${fila(emp)}?.querySelectorAll('td[data-testid=grilla-celda]')[${dia - 1}]`;
await waitFor(`${celda('mr_baez', 13)}`, 90000, 'grilla con BAEZ');
await sleep(2500);

// 1. Menú abierto sobre la V de BAEZ (13/10)
await click(celda('mr_baez', 13), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 5000, 'menú');
await shot('1-menu');

// 2. Modo elegir (Asignar a…) con la franja
await click(`document.querySelector('[data-menu-accion=asignar]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 5000, 'franja');
await hover(celda('mr_ferrero', 9));
await shot('2-elegir-asignar');

// 2b. Un clic que no pasa (BARROS está de franco ese día)
await click(celda('mr_barros', 13));
await waitFor(`document.querySelector('[data-franja-aviso]')`, 5000, 'aviso');
await shot('2b-elegir-aviso');

// 3. FERRERO (RET) cubre: celda pendiente con la marca + oferta de repetir
await click(celda('mr_ferrero', 20));
await waitFor(`document.querySelector('[data-franja-repetir]')`, 8000, 'oferta repetir');
await hover(celda('mr_ferrero', 13));
await shot('3-asignado');
await hover(`document.querySelector('[data-franja-repetir]')`);
await shot('6-repetir');

// 7. Repetir: 14/10 se aplica, 15/10 se saltea (FERRERO con licencia)
await click(`document.querySelector('[data-franja-repetir]')`);
await waitFor(`document.querySelector('[data-franja-aviso]')`, 8000, 'resultado repetir');
await shot('7-repetir-resultado');
await click(`document.querySelector('[data-franja-cancelar]')`);

// 4 y 5. Ext / Adel sobre el 15/10
await click(celda('mr_baez', 15), 'right');
await waitFor(`document.querySelector('[data-menu-rapido=raiz]')`, 5000, 'menú 15');
await click(`document.querySelector('[data-menu-accion=ext]')`);
await waitFor(`document.querySelector('[data-franja-elegir]')`, 5000, 'franja ext');
const extId = process.env.CAPTURA_EXT || 'mr_galeano';
const adelId = process.env.CAPTURA_ADEL || 'mr_barros';
await click(celda(extId, 15));
await sleep(300);
await shot('4-ext');
await click(celda(adelId, 15));
await sleep(600);
if (await evaluate(`!!document.querySelector('[data-franja-elegir]')`)) {
  console.log('franja:', await evaluate(`document.querySelector('[data-franja-elegir]').innerText`));
}
await hover(celda(extId, 15));
await shot('5-ext-adel');

ws.close();
chrome.kill();
server.close();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* lock del perfil */ }
process.exit(0);
