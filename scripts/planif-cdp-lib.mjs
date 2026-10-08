/**
 * Planificación real en Chromium headless por el protocolo de DevTools (sin dependencias).
 * Sirve `apps/web2/out` (next build con NEXT_PUBLIC_USE_EMULATOR=true), entra con el admin del seed
 * y abre el cronograma del objetivo. Usa el Chromium de la caché de Playwright.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// PLANIF_OUT_DIR: otra carpeta `out` (p. ej. el build del commit anterior en un worktree temporal).
const outDir = process.env.PLANIF_OUT_DIR || join(root, 'apps/web2/out');
/** PLANIF_EMU_PORTS="8080:8190,9099:9199": el front compilado apunta a 8080/9099; se reescribe a otro emulador. */
const emuPorts = (process.env.PLANIF_EMU_PORTS || '').split(',').map((p) => p.split(':').map(Number)).filter((p) => p.length === 2 && p[0] && p[1]);
export const shotsDir = join(root, 'docs/capturas-cobertura');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

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

export async function abrirPlanificacion({ objectiveId, clientId, year = 2026, month = 10, prefijo, port = 3011, devtoolsPort = 9333, scriptInicial = null, email = 'admin@bacarsa.com.ar', password = 'admin1234' }) {
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
  await new Promise((r) => server.listen(port, '127.0.0.1', r));

  const profile = join(tmpdir(), `cosp-captura-${Date.now()}`);
  const chrome = spawn(chromePath(), [
    '--headless=new', `--remote-debugging-port=${devtoolsPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
    '--lang=es-AR', 'about:blank',
  ], { stdio: 'ignore' });

  async function devtools(path) {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${devtoolsPort}${path}`, { method: path.startsWith('/json/new') ? 'PUT' : 'GET' });
        if (r.ok) return r.json();
      } catch { /* arrancando */ }
      await sleep(250);
    }
    throw new Error('DevTools no responde');
  }
  const target = await devtools('/json/new?about:blank');
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
  async function click(selector, button = 'left', espera = 450) {
    const p = await rectOf(selector);
    if (!p) throw new Error(`No está: ${selector}`);
    await mouse('mouseMoved', p.x, p.y, 'none');
    await mouse('mousePressed', p.x, p.y, button);
    await mouse('mouseReleased', p.x, p.y, button);
    await sleep(espera);
    return p;
  }
  async function hover(selector, espera = 400) {
    const p = await rectOf(selector);
    if (!p) throw new Error(`No está: ${selector}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await sleep(espera);
    return p;
  }
  mkdirSync(shotsDir, { recursive: true });
  async function shot(name) {
    await sleep(500);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
    const file = join(shotsDir, `${prefijo}-${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('✓', file);
  }
  async function cerrar() {
    ws.close();
    chrome.kill();
    server.close();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* lock del perfil */ }
  }

  if (emuPorts.length) {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method !== 'Fetch.requestPaused') return;
      let url = msg.params.request.url;
      for (const [de, a] of emuPorts) {
        url = url.replace(`//127.0.0.1:${de}/`, `//127.0.0.1:${a}/`).replace(`//localhost:${de}/`, `//127.0.0.1:${a}/`);
      }
      send('Fetch.continueRequest', { requestId: msg.params.requestId, url }).catch(() => {});
    });
    const patterns = emuPorts.flatMap(([de]) => [`http://127.0.0.1:${de}/*`, `http://localhost:${de}/*`]).map((urlPattern) => ({ urlPattern }));
    await send('Fetch.enable', { patterns });
  }
  await send('Page.enable');
  await send('Runtime.enable');
  if (scriptInicial) await send('Page.addScriptToEvaluateOnNewDocument', { source: scriptInicial });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTimezoneOverride', { timezoneId: 'America/Argentina/Buenos_Aires' });
  await send('Emulation.setLocaleOverride', { locale: 'es-AR' }).catch(() => {});
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/login/` });
  await waitFor(`(() => { const el = document.querySelector('input[type=email]'); return el && Object.keys(el).some((k) => k.startsWith('__reactProps')); })()`, 60000, 'login hidratado');
  await sleep(800);
  await evaluate(`(() => {
    const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('input[type=email]'), ${JSON.stringify(email)});
    set(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
    const btn = [...document.querySelectorAll('button')].find((b) => /ingresar/i.test(b.textContent || ''));
    btn.click();
  })()`);
  await waitFor(`!location.pathname.startsWith('/login')`, 60000, 'salir del login');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/admin/planificacion/?objectiveId=${objectiveId}&clientId=${clientId}&year=${year}&month=${month}` });
  await sleep(1500);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const fila = (emp) => `document.getElementById('plan-emp-${emp}')`;
  const celda = (emp, dia) => `${fila(emp)}?.querySelectorAll('td[data-testid=grilla-celda]')[${dia - 1}]`;

  return { send, evaluate, waitFor, rectOf, mouse, click, hover, shot, cerrar, fila, celda };
}
