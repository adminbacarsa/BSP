/**
 * Sube un TXT de carga masiva a Simplificacion Registral y confirma el lote en COSP.
 *
 *   node scripts/arca-robot/subir.mjs --archivo C:\arca-txt\lote.txt --lote lote_x --cuit 30000000001 --tipo AT --empresa bacarsa
 *
 * ARCA_SIMULACION=1 no abre el navegador ni entra a ARCA: confirma en COSP con nro SIM-...
 * La clave fiscal se lee de ARCA_CLAVES_PATH (JSON { "CUIT": "clave" }, fuera del repo).
 * Reintentos: ARCA_ROBOT_REINTENTOS (default 3). Captura: ARCA_SHOTS_DIR.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bodyResultado,
  claveDeCuit,
  clavesPathSeguro,
  esSimulacion,
  extraerNros,
  nroSimulado,
  parseArgs,
} from './flujo.mjs';

const LOGIN_URL = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml';

async function postCosp(body) {
  const base = String(process.env.ARCA_ENVIOS_URL || '').trim();
  const key = String(process.env.ARCA_ROBOT_KEY || '').trim();
  if (!base || !key) {
    console.error('FALTA_ARCA_ENVIOS_URL_O_KEY');
    return false;
  }
  const join = base.includes('?') ? '&' : '?';
  const res = await fetch(`${base}${join}action=resultado`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-arca-key': key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(JSON.stringify({ cospStatus: res.status, cospBody: text.slice(0, 300) }));
  return res.ok;
}

async function terminar(body) {
  const ok = await postCosp(body);
  process.exit(ok ? 0 : 1);
}

function leerClaves() {
  const file = clavesPathSeguro(process.env.ARCA_CLAVES_PATH, process.env.COSP_REPO);
  if (!file) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function capturar(page, loteId, intento) {
  if (!page) return '';
  const dir = process.env.ARCA_SHOTS_DIR || path.join(os.tmpdir(), 'arca-robot-shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(loteId || 'envio').replace(/[^\w.-]/g, '_')}-error-${intento}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.error(JSON.stringify({ captura: file }));
  return file;
}

async function login(page, cuit, clave) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#F1\\:username, input[name="F1:username"]').first().fill(cuit);
  await page.locator('#F1\\:btnSiguiente, input[name="F1:btnSiguiente"]').first().click();
  await page.locator('#F1\\:password, input[name="F1:password"]').first().fill(clave);
  await page.locator('#F1\\:btnIngresar, input[name="F1:btnIngresar"]').first().click();
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
}

async function abrirCargaMasiva(context, page) {
  const buscador = page.locator('input[type="search"], input[placeholder*="Busc" i], #buscadorInput').first();
  if (await buscador.count()) {
    await buscador.fill('Simplificacion Registral');
    await page.waitForTimeout(800);
  }
  const popupWait = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await page.getByText(/Simplificaci[oó]n Registral/i).first().click();
  const popup = await popupWait;
  const sr = popup || page;
  await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  await sr.getByText(/Relaciones Laborales/i).first().click();
  await sr.getByText(/Carga Masiva/i).first().click();
  const nuevo = sr.getByRole('button', { name: /Nuevo/i }).or(sr.getByRole('link', { name: /Nuevo/i })).or(sr.getByText(/^Nuevo$/i));
  await nuevo.first().click();
  return sr;
}

async function subirArchivo(sr, archivo) {
  await sr.locator('input[type="file"]').first().setInputFiles(archivo);
  const cargar = sr.getByRole('button', { name: /Cargar/i });
  if (await cargar.count()) await cargar.first().click();
  await sr.getByRole('button', { name: /^Enviar$/i }).first().click();
  await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  const texto = await sr.locator('body').innerText();
  const nros = extraerNros(texto);
  const hrefs = await sr.locator('a').evaluateAll((as) => as.map((a) => a.href || ''));
  const constanciaUrl = hrefs.find((h) => /constancia|acuse|comprobante/i.test(h)) || '';
  if (!nros.length) throw new Error('SIN_NRO_TRANSACCION');
  return { nros, constanciaUrl };
}

async function subirReal({ archivo, cuit, clave, loteId, intento }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('PLAYWRIGHT_NO_INSTALADO');
  }
  const browser = await chromium.launch({ headless: process.env.ARCA_ROBOT_HEADLESS !== '0' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try {
    await login(page, cuit, clave);
    const sr = await abrirCargaMasiva(context, page);
    return await subirArchivo(sr, archivo);
  } catch (e) {
    await capturar(page, loteId, intento).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const loteId = args.lote || '';
  const envioId = args.envio || '';
  const tipo = String(args.tipo || '').toUpperCase();
  const cuit = String(args.cuit || '').replace(/\D/g, '');
  if (!(loteId || envioId) || !(tipo === 'AT' || tipo === 'BT')) {
    console.error('USO: --archivo --lote|--envio --cuit --tipo AT|BT --empresa');
    process.exit(2);
  }
  const baseBody = { loteId, envioId };

  if (esSimulacion()) {
    const nro = nroSimulado(loteId || envioId);
    console.log(JSON.stringify({ simulacion: true, nroTransaccion: nro, tipo }));
    await terminar(bodyResultado({ ...baseBody, estado: 'CONFIRMADO', nroTransaccion: nro }));
  }

  let clave = '';
  try {
    clave = claveDeCuit(leerClaves(), cuit);
  } catch (e) {
    await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: e.message || 'CLAVE' }));
  }
  if (!clave || !cuit) {
    await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: 'FALTA_CLAVE_FISCAL' }));
  }
  const archivo = String(args.archivo || '');
  if (!archivo || !fs.existsSync(archivo)) {
    await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: 'FALTA_TXT' }));
  }

  const intentos = Math.min(5, Math.max(1, Number(process.env.ARCA_ROBOT_REINTENTOS || 3)));
  let last = 'ERROR_ROBOT';
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const subido = await subirReal({ archivo, cuit, clave, loteId: loteId || envioId, intento: i });
      console.log(JSON.stringify({ ok: true, nros: subido.nros, intento: i }));
      await terminar(bodyResultado({
        ...baseBody,
        estado: 'CONFIRMADO',
        nroTransaccion: subido.nros.join(','),
        constanciaUrl: subido.constanciaUrl,
      }));
    } catch (e) {
      last = String(e && e.message ? e.message : e).slice(0, 500);
      console.error(JSON.stringify({ intento: i, error: last }));
    }
  }
  await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: last }));
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((e) => {
    console.error(JSON.stringify({ error: String(e && e.message ? e.message : e).slice(0, 500) }));
    process.exit(1);
  });
}