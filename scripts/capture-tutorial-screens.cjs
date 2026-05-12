/**
 * Genera PNG en docs/tutorial-assets/** para el tutorial interactivo.
 *
 * Uso:
 *   1) Arrancá la app: npm run dev:web2  (puerto 3000 por defecto)
 *   2) Opcional: emuladores Firebase si tu login depende de ellos
 *   3) Con cuenta admin:
 *        set TUTORIAL_EMAIL=tu@correo.com
 *        set TUTORIAL_PASSWORD=****
 *        set TUTORIAL_BASE=http://127.0.0.1:3000
 *        npm run docs:capturas
 *
 * Sin credenciales solo se guarda login.png (pantalla pública).
 *
 * Primera vez: npx playwright install chromium
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadTutorialEnv } = require('./load-tutorial-env.cjs');

const ROOT = path.join(__dirname, '..');
const PLAT = path.join(ROOT, 'docs', 'tutorial-assets', 'plataforma');
const PORTAL = path.join(ROOT, 'docs', 'tutorial-assets', 'portal');

function ensureDirs() {
  [PLAT, PORTAL].forEach((d) => fs.mkdirSync(d, { recursive: true }));
}

async function shot(page, file, fullPage) {
  const p = path.join(PLAT, file);
  await page.screenshot({ path: p, fullPage: !!fullPage });
  console.log('OK', p);
}

async function main() {
  loadTutorialEnv();

  const base = (process.env.TUTORIAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const email = process.env.TUTORIAL_EMAIL || '';
  const password = process.env.TUTORIAL_PASSWORD || '';

  ensureDirs();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(800);
  await shot(page, 'login.png');

  if (!email || !password) {
    console.log('\n[docs:capturas] Definí TUTORIAL_EMAIL y TUTORIAL_PASSWORD para capturar el panel admin.');
    await browser.close();
    return;
  }

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL(
      (url) => /\/admin\//.test(url.pathname) || /\/empleado\//.test(url.pathname),
      { timeout: 90000 }
    );
  } catch (e) {
    console.error('Login falló o la URL no cambió. Revisá credenciales, base URL y que el servidor esté arriba.');
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(1500);

  const adminRoutes = [
    ['/admin/dashboard', 'dashboard.png'],
    ['/admin/crm', 'crm-lista.png'],
    ['/admin/servicios', 'servicios-contrato.png'],
    ['/admin/rrhh', 'rrhh-legajos.png'],
    ['/admin/planificacion', 'plan-01-planificador.png'],
    ['/admin/operaciones', 'operaciones-tabs.png'],
    ['/admin/reportes', 'reportes.png'],
    ['/admin/configuracion', 'configuracion.png'],
  ];

  for (const [route, file] of adminRoutes) {
    try {
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2000);
      await shot(page, file);
    } catch (err) {
      console.warn('Omitido', route, err.message);
    }
  }

  await browser.close();
  console.log('\nListo. Reabrí docs/tutorial-interactivo.html para ver las capturas.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
