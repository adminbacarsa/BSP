#!/usr/bin/env node
/**
 * UI emulador: login → Planificación → Cliente Demo → Automatizar → revisar cobertura/grilla.
 * Requiere: emuladores (8080/9099/5001), GEMINI en apps/functions/.env, Next :3000
 */
import { chromium } from 'playwright';
import net from 'net';

const BASE = process.env.COSP_BASE_URL || 'http://127.0.0.1:3000';
const EMAIL = process.env.COSP_ADMIN_EMAIL || 'admin@bacarsa.com.ar';
const PASS = process.env.COSP_ADMIN_PASS || 'admin1234';
const CLIENT = process.env.PLAN_CLIENT || 'Cliente Demo Plan';
const OBJECTIVE = process.env.PLAN_OBJECTIVE || 'Objetivo Demo 24hs';

function waitPort(port, ms = 90000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tryOnce = () => {
      const s = net.createConnection({ port, host: '127.0.0.1' }, () => {
        s.end();
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() >= deadline) reject(new Error(`Timeout :${port}`));
        else setTimeout(tryOnce, 600);
      });
    };
    tryOnce();
  });
}

function matchLabelRx(label) {
  const escaped = String(label).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

function openPlanSelectMenu(page) {
  return page.locator('div.absolute.left-0.top-full').filter({ has: page.locator('button') }).last();
}

async function clickPlanDropdownOption(page, label, fallbackFirst = false) {
  const rx = matchLabelRx(label);
  const dropdown = openPlanSelectMenu(page);
  await dropdown.waitFor({ state: 'visible', timeout: 15000 });

  let named = dropdown.locator('button').filter({ hasText: rx });
  const count = await named.count();
  if (count > 0) {
    await named.first().scrollIntoViewIfNeeded();
    await named.first().click({ timeout: 30000 });
    return;
  }
  if (fallbackFirst) {
    await dropdown.locator('button').first().click({ timeout: 8000 });
    return;
  }
  throw new Error(`No se encontró "${label}" en el menú desplegable`);
}

async function main() {
  console.log('COSP — test UI Automatizar (planificación)\n');
  console.log(`Objetivo: ${CLIENT} → ${OBJECTIVE}\n`);
  for (const [port, label] of [
    [8080, 'Firestore'],
    [9099, 'Auth'],
    [5001, 'Functions'],
    [3000, 'Next dev'],
  ]) {
    await waitPort(port, label);
    console.log(`✓ ${label} :${port}`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await Promise.all([
    page.waitForURL((url) => /\/admin/.test(url.pathname), { timeout: 90000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log('✓ Login admin');

  await page.goto(`${BASE}/admin/planificacion`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(5000);

  const clearBtn = page.locator('button[title="Limpiar selección"]');
  const clientChip = page.locator('span.bg-slate-800').filter({ hasText: /.+/ }).first();
  const alreadyClient = (await clientChip.count()) > 0 ? await clientChip.textContent() : '';

  if (alreadyClient && !matchLabelRx(CLIENT).test(alreadyClient)) {
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click();
      await page.waitForTimeout(800);
    }
  }

  const clientBtn = page.locator('button.bg-slate-800').filter({ hasText: /^Cliente/i });
  if ((await clientBtn.count()) > 0 && (await clientBtn.isVisible())) {
    await clientBtn.click();
    await page.locator('div.absolute.left-0.top-full button').first().waitFor({ state: 'visible', timeout: 45000 });
    await page.waitForTimeout(400);
    await clickPlanDropdownOption(page, CLIENT);
    await page.waitForTimeout(1500);
  } else if (!matchLabelRx(CLIENT).test(alreadyClient || '')) {
    throw new Error(`Cliente "${CLIENT}" no visible. Actual: "${alreadyClient?.trim() || 'ninguno'}"`);
  }
  console.log(`✓ Cliente: ${CLIENT}`);

  const objChip = page.locator('button.bg-indigo-600').first();
  const objLabel = (await objChip.textContent())?.trim() || '';
  if (!matchLabelRx(OBJECTIVE).test(objLabel)) {
    await objChip.click();
    await page.waitForTimeout(600);
    await clickPlanDropdownOption(page, OBJECTIVE, true);
    await page.waitForTimeout(2000);
  }
  console.log(`✓ Objetivo: ${OBJECTIVE}`);

  const autoBtn = page.locator('button[title*="Automatizar"]').first();
  await autoBtn.click();
  console.log('→ Modal Automatizar abierto (viabilidad + generación + IA)…');

  const modal = page.locator('h3', { hasText: 'Automatizar cronograma' });
  await modal.waitFor({ state: 'visible', timeout: 15000 });

  const doneText = page.getByText(/Cronograma listo|Cronograma con avisos|Dotación insuficiente/i);
  await doneText.waitFor({ state: 'visible', timeout: 600000 });

  const modalRoot = page.locator('div.rounded-2xl.shadow-2xl').filter({
    has: page.getByRole('heading', { name: /Automatizar cronograma/i }),
  });

  const infeasible = await page.getByText(/Dotación insuficiente/i).isVisible().catch(() => false);
  if (infeasible) {
    const reasons = await modalRoot.locator('li').allTextContents().catch(() => []);
    console.log('\n⚠ Viabilidad NO — dotación insuficiente para el SLA');
    reasons.slice(0, 5).forEach((r) => console.log(`  - ${r}`));
    await page.screenshot({ path: 'scripts/.last-automate-planning-ui.png', fullPage: false });
    await browser.close();
    process.exit(2);
  }
  const statValues = modalRoot.locator('.grid.grid-cols-3 .text-2xl.font-black');
  const billable = (await statValues.nth(0).textContent())?.trim() ?? '—';
  const covered = (await statValues.nth(1).textContent())?.trim() ?? '—';
  const uncovered = (await statValues.nth(2).textContent())?.trim() ?? '—';
  const iaLine = await page.locator('text=/^IA:/').textContent().catch(() => null);

  console.log('\n--- Verificación cobertura (modal Automatizar) ---');
  console.log(`  Hs facturables: ${billable?.trim()}`);
  console.log(`  Cubiertos: ${covered?.trim()}`);
  console.log(`  Sin cubrir: ${uncovered?.trim()}`);
  if (iaLine) console.log(`  ${iaLine.trim()}`);

  const gridCells = await page.locator('[class*="grid"]').locator('button, [role="button"]').count();
  const tempCells = await page.locator('[class*="border-dashed"], [class*="ring-amber"]').count();
  console.log('\n--- Grilla ---');
  console.log(`  Controles en grilla (aprox.): ${gridCells}`);
  console.log(`  Celdas temporales/borrador (aprox.): ${tempCells}`);

  const screenshot = 'scripts/.last-automate-planning-ui.png';
  await page.screenshot({ path: screenshot, fullPage: false });
  console.log(`\n✓ Captura: ${screenshot}`);

  const uncoveredN = Number(String(uncovered).replace(/\D/g, '')) || 0;
  if (uncoveredN > 0) {
    console.warn('\n⚠ Hay slots sin cubrir — revisar dotación/SLA.');
    await browser.close();
    process.exit(1);
  }

  console.log('\nOK — Automatizar completó con cobertura sin slots pendientes.');
  await browser.close();
}

main().catch(async (e) => {
  console.error('\nFALLO:', e.message || e);
  process.exit(1);
});
