/**
 * Graba secuencias reales en la UI → docs/tutorial-assets/flujo/
 *
 * docs/tutorial-capture.env (copiar desde tutorial-capture.env.example)
 * o variables TUTORIAL_EMAIL / TUTORIAL_PASSWORD.
 *
 * Flujos: CRM nuevo cliente, Planificación cliente/objetivo/grilla,
 * Servicios, RRHH, Operaciones, Reportes, Configuración.
 *
 * Planificación (nombres en tu base):
 *   TUTORIAL_PLAN_CLIENT=Tadicor
 *   TUTORIAL_PLAN_OBJECTIVE=Tadicor
 * (por defecto ambos "Tadicor" si no están definidos)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadTutorialEnv } = require('./load-tutorial-env.cjs');

const ROOT = path.join(__dirname, '..');
const FLOW = path.join(ROOT, 'docs', 'tutorial-assets', 'flujo');

function ensureDirs() {
  fs.mkdirSync(FLOW, { recursive: true });
}

async function shot(page, name) {
  const p = path.join(FLOW, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log('OK', p);
}

async function login(page, base, email, password) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL((url) => /\/admin\//.test(url.pathname) || /\/empleado\//.test(url.pathname), {
      timeout: 90000,
    }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
}

async function flowCrm(page, base) {
  console.log('\n--- CRM: nuevo cliente ---');
  await page.goto(`${base}/admin/crm`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2200);

  await shot(page, 'crm-flujo-01-lista.png');

  const nuevoClienteBtn = page.locator('button.flex.items-center').filter({ hasText: 'Cliente' }).first();
  await nuevoClienteBtn.waitFor({ state: 'visible', timeout: 15000 });
  await nuevoClienteBtn.click();

  await page.getByRole('heading', { name: 'Nuevo Cliente' }).waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(600);
  await shot(page, 'crm-flujo-02-modal-vacio.png');

  await page.getByPlaceholder('Ej: Empresa SA').fill('Cliente tutorial (demo)');
  await page.waitForTimeout(400);
  await shot(page, 'crm-flujo-03-nombre-ejemplo.png');

  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.waitForTimeout(800);
}

/** Coincidencia por texto (cliente / sede; case-insensitive). */
function matchLabelRx(label) {
  const escaped = String(label).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

/**
 * Lista desplegable Cliente/Objetivo en planificacion (min-w-[220px]; el header usa min-w-[200px]).
 * El panel "Diagnóstico" usa min-w-[280px] y no son botones de lista → no coincide.
 */
function openPlanSelectMenu(page) {
  return page
    .locator('div.absolute.left-0.top-full.min-w-\\[220px\\]')
    .filter({ has: page.locator('button') })
    .last();
}

/**
 * Clic en la opción del menú que está abierto.
 * Si `fallbackFirst` y no hay texto que coincida, usa la primera fila.
 */
async function clickPlanDropdownOption(page, label, fallbackFirst = false) {
  const rx = matchLabelRx(label);
  const dropdown = openPlanSelectMenu(page);
  await dropdown.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  let named = dropdown.getByRole('button', { name: rx }).first();
  if ((await named.count()) === 0) {
    named = dropdown.locator('button').filter({ hasText: rx }).first();
  }
  if ((await named.count()) > 0) {
    await named.click({ timeout: 15000 });
    return;
  }
  if (fallbackFirst) {
    const n = await dropdown.locator('button').count();
    const first = dropdown.locator('button').first();
    await first.waitFor({ state: 'visible', timeout: 8000 });
    console.warn(`[plan] Sin texto "${label}" en el menú; usando la 1.ª opción (${n} ítems).`);
    await first.click();
    return;
  }
  await named.click({ timeout: 15000 });
}

async function flowPlan(page, base) {
  /* Por defecto alineado a la UI típica: chip cliente TADICOR y sede "Tadicor" (regex ignora mayúsculas). */
  const clientName = (process.env.TUTORIAL_PLAN_CLIENT || 'TADICOR').trim();
  const objectiveName = (process.env.TUTORIAL_PLAN_OBJECTIVE || 'Tadicor').trim();

  console.log('\n--- Planificación ---');
  console.log(`[plan] Cliente: "${clientName}" · Objetivo/sede: "${objectiveName}"`);

  await page.goto(`${base}/admin/planificacion`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2800);
  await shot(page, 'plan-flujo-01-ingreso.png');

  const clientBtn = page.locator('button.bg-slate-800').filter({ hasText: 'Cliente' }).first();
  if ((await clientBtn.count()) === 0) {
    console.warn('[plan] No hay botón Cliente — omitiendo pasos.');
    return;
  }
  await clientBtn.click();
  await page.waitForTimeout(600);
  await shot(page, 'plan-flujo-02-menu-clientes.png');

  try {
    await clickPlanDropdownOption(page, clientName);
  } catch (e) {
    console.warn(`[plan] No se encontró el cliente "${clientName}" en el menú.`, e.message || e);
    await page.keyboard.press('Escape');
    return;
  }

  await page.waitForTimeout(2200);
  await shot(page, 'plan-flujo-03-cliente-seleccionado.png');

  const objBtn = page.locator('button.bg-indigo-600').first();
  await objBtn.waitFor({ state: 'visible', timeout: 10000 });
  await objBtn.click();
  await page.waitForTimeout(700);
  await shot(page, 'plan-flujo-04-menu-objetivos.png');

  try {
    await clickPlanDropdownOption(page, objectiveName, true);
  } catch (e) {
    console.warn(`[plan] No se pudo elegir objetivo:`, e.message || e);
    await page.keyboard.press('Escape');
    return;
  }

  await page.waitForTimeout(2800);
  await shot(page, 'plan-flujo-05-grilla.png');

  const limpiar = page.locator('button[title="Limpiar selección"]');
  if ((await limpiar.count()) > 0) {
    await limpiar.click();
    await page.waitForTimeout(600);
  }
}

async function flowServicios(page, base) {
  console.log('\n--- Servicios ---');
  await page.goto(`${base}/admin/servicios`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot(page, 'serv-flujo-01-vista.png');
}

async function flowRrhh(page, base) {
  console.log('\n--- RRHH ---');
  await page.goto(`${base}/admin/rrhh`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot(page, 'rrhh-flujo-01-legajos.png');

  const tabNov = page.getByRole('button', { name: 'Novedades' });
  if ((await tabNov.count()) > 0) {
    await tabNov.first().click();
    await page.waitForTimeout(1200);
    await shot(page, 'rrhh-flujo-02-novedades.png');
  }
}

async function flowOperaciones(page, base) {
  console.log('\n--- Operaciones ---');
  await page.goto(`${base}/admin/operaciones`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);
  await shot(page, 'ops-flujo-01-vista.png');

  const tabActivos = page.getByRole('button', { name: 'ACTIVOS' });
  if ((await tabActivos.count()) > 0) {
    await tabActivos.first().click();
    await page.waitForTimeout(1200);
    await shot(page, 'ops-flujo-02-activos.png');
  }
}

async function flowReportes(page, base) {
  console.log('\n--- Reportes ---');
  await page.goto(`${base}/admin/reportes`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2200);
  await shot(page, 'rep-flujo-01-vista.png');
}

async function flowConfig(page, base) {
  console.log('\n--- Configuración ---');
  await page.goto(`${base}/admin/configuracion`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2200);
  await shot(page, 'cfg-flujo-01-vista.png');
}

function printCredentialHelp() {
  console.error('');
  console.error('Faltan TUTORIAL_EMAIL y/o TUTORIAL_PASSWORD.');
  console.error('Copiá docs/tutorial-capture.env.example → docs/tutorial-capture.env y completalo.');
  console.error('');
}

async function main() {
  loadTutorialEnv();

  const base = (process.env.TUTORIAL_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const email = (process.env.TUTORIAL_EMAIL || '').trim();
  const password = process.env.TUTORIAL_PASSWORD || '';

  if (!email || !password) {
    printCredentialHelp();
    process.exit(1);
  }

  ensureDirs();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  try {
    await login(page, base, email, password);

    await flowCrm(page, base);
    await flowPlan(page, base);
    await flowServicios(page, base);
    await flowRrhh(page, base);
    await flowOperaciones(page, base);
    await flowReportes(page, base);
    await flowConfig(page, base);

    console.log('\n✓ Flujos terminados. PNG en docs/tutorial-assets/flujo/');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
