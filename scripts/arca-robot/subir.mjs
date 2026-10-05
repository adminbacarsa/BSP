/**
 * Sube un TXT de carga masiva a Simplificacion Registral y confirma el lote en COSP.
 *
 * Recorrido real (capturas 05/10):
 *   portal → Simplificación Registral Empleadores → select CUIT empleador → (DatosBasicos Continuar)
 *   → CargaMasiva listado → Nuevo | editar si código del lote | error si abierta ajena
 *   → principal (guardar Código) → Cargar Archivo → file + Cargar → validar Registros
 *   → Presentar (por confirmar) → leer Nro. Transacción del listado por Código
 *
 *   node scripts/arca-robot/subir.mjs --archivo C:\arca-txt\lote.txt --lote lote_x --cuit 30668134978 --tipo AT --empresa bacarsa
 *   node scripts/arca-robot/subir.mjs --modo explorar --archivo ...  → hasta después de Cargar, sin presentar
 *
 * ARCA_SIMULACION=1 no abre el navegador, no pide la clave y confirma en COSP con nro SIM-...
 * La clave se pide a COSP (action=credencial) y queda solo en memoria.
 * ARCA_CLAVES_PATH es respaldo si COSP no la devuelve. Reintentos: ARCA_ROBOT_REINTENTOS (default 3).
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
  formatearCuit,
  nroSimulado,
  parseArgs,
  planAcceso,
  sanitizarTexto,
  soloDigitosCuit,
} from './flujo.mjs';
import {
  URLS_CARGA,
  contarLineasTxt,
  decidirNovedadAbierta,
  extraerCodigoPrincipal,
  leerEstadoCarga,
  nroDesdeFilaListado,
  parseFilasListado,
  validarRegistrosVsTxt,
} from './cargaMasiva.mjs';

const LOGIN_URL = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml';

async function postCosp(action, body) {
  const base = String(process.env.ARCA_ENVIOS_URL || '').trim();
  const key = String(process.env.ARCA_ROBOT_KEY || '').trim();
  if (!base || !key) {
    console.error('FALTA_ARCA_ENVIOS_URL_O_KEY');
    return false;
  }
  const join = base.includes('?') ? '&' : '?';
  const res = await fetch(`${base}${join}action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-arca-key': key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(JSON.stringify({ cospAction: action, cospStatus: res.status, cospBody: text.slice(0, 300) }));
  return res.ok;
}

async function terminar(body) {
  const ok = await postCosp('resultado', body);
  process.exit(ok ? 0 : 1);
}

async function guardarCodigoLote({ loteId, envioId, arcaCodigoNovedad }) {
  const body = { arcaCodigoNovedad: String(arcaCodigoNovedad) };
  if (loteId) body.loteId = String(loteId);
  if (envioId) body.envioId = String(envioId);
  const ok = await postCosp('arca-codigo', body);
  if (!ok) throw new Error('NO_GUARDO_CODIGO_NOVEDAD');
}

function leerClaves() {
  const file = clavesPathSeguro(process.env.ARCA_CLAVES_PATH, process.env.COSP_REPO);
  if (!file) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function capturar(page, loteId, intento, paso = 'error') {
  if (!page) return '';
  const dir = process.env.ARCA_SHOTS_DIR || path.join(os.tmpdir(), 'arca-robot-shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(loteId || 'envio').replace(/[^\w.-]/g, '_')}-${paso}-${intento}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.error(JSON.stringify({ captura: file, paso }));
  return file;
}

async function pedirCredencial(empresaId) {
  const base = String(process.env.ARCA_ENVIOS_URL || '').trim();
  const key = String(process.env.ARCA_ROBOT_KEY || '').trim();
  if (!base || !key || !empresaId) return null;
  const join = base.includes('?') ? '&' : '?';
  const res = await fetch(`${base}${join}action=credencial&empresaId=${encodeURIComponent(empresaId)}`, {
    headers: { 'x-arca-key': key },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const clave = String(data.clave || '');
  if (!clave) return null;
  return {
    cuitLogin: String(data.cuitLogin || ''),
    cuitRepresentado: String(data.cuitRepresentado || data.cuitLogin || ''),
    clave,
  };
}

async function resolverAcceso(empresaId, cuitArg) {
  try {
    const remoto = await pedirCredencial(empresaId);
    if (remoto && remoto.clave) return remoto;
  } catch {
    /* respaldo: archivo local */
  }
  const clave = claveDeCuit(leerClaves(), cuitArg);
  if (!clave) return null;
  const cuit = soloDigitosCuit(cuitArg);
  return { cuitLogin: cuit, cuitRepresentado: cuit, clave };
}

/** Portal AFIP (si login ≠ representado): click en fila + Representar. */
async function elegirRepresentado(page, cuit) {
  const visible = formatearCuit(cuit);
  const crudo = soloDigitosCuit(cuit);
  const fila = page.getByText(new RegExp(`${visible}|${crudo}`)).first();
  await fila.waitFor({ timeout: 20000 });
  await fila.click();
  const entrar = page.getByRole('button', { name: /Representar|Ingresar|Seleccionar|Continuar/i }).or(
    page.getByRole('link', { name: /Representar|Ingresar|Seleccionar|Continuar/i }),
  );
  if (await entrar.count()) await entrar.first().click();
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
}

/**
 * IndexContribuyente.aspx: <select> de CUITs + Aceptar.
 * Elige por CUIT del empleador (no el primero de la lista).
 */
async function elegirEmpleadorSimplificacion(page, cuit) {
  const crudo = soloDigitosCuit(cuit);
  const visible = formatearCuit(cuit);
  const select = page.locator('select').first();
  await select.waitFor({ timeout: 25000 });
  const options = await select.locator('option').evaluateAll((opts) =>
    opts.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })),
  );
  const match = options.find((o) => {
    const digits = String(o.text || o.value || '').replace(/\D/g, '');
    return digits.includes(crudo) || String(o.text).includes(visible);
  });
  if (!match) throw new Error(`CUIT_EMPLEADOR_NO_EN_LISTA:${crudo}`);
  await select.selectOption(match.value ? { value: match.value } : { label: match.text });
  await page.getByRole('button', { name: /^Aceptar$/i }).first().click();
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
}

async function login(page, cuit, clave) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#F1\\:username, input[name="F1:username"]').first().fill(cuit);
  await page.locator('#F1\\:btnSiguiente, input[name="F1:btnSiguiente"]').first().click();
  await page.locator('#F1\\:password, input[name="F1:password"]').first().fill(clave);
  await page.locator('#F1\\:btnIngresar, input[name="F1:btnIngresar"]').first().click();
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
}

async function abrirSimplificacion(context, page) {
  try {
    await page.goto(URLS_CARGA.portal, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    /* ya puede estar en el portal tras login */
  }
  const popupWait = context.waitForEvent('page', { timeout: 20000 }).catch(() => null);
  const tarjeta = page.getByText(/Simplificaci[oó]n Registral\s*-\s*Empleadores/i)
    .or(page.getByRole('link', { name: /Simplificaci[oó]n Registral/i }))
    .or(page.getByText(/Simplificaci[oó]n Registral/i));
  await tarjeta.first().click({ timeout: 25000 });
  const popup = await popupWait;
  const sr = popup || page;
  await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  return sr;
}

async function continuarDatosBasicosSiAparece(sr) {
  const continuar = sr.getByRole('button', { name: /^Continuar$/i });
  try {
    if (await continuar.count() && await continuar.first().isVisible({ timeout: 4000 })) {
      await continuar.first().click();
      await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
    }
  } catch {
    /* pantalla opcional */
  }
}

async function irACargaMasiva(sr) {
  await sr.goto(URLS_CARGA.cargaMasiva, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sr.getByText(/LISTADO DE NOVEDADES/i).first().waitFor({ timeout: 30000 });
}

async function leerFilasListado(sr) {
  const texto = await sr.locator('body').innerText();
  const filas = parseFilasListado(texto);
  if (filas.length) return filas;
  return sr.locator('table').filter({ hasText: /LISTADO DE NOVEDADES|C[oó]digo/i }).locator('tr').evaluateAll((trs) => {
    const out = [];
    for (const tr of trs) {
      const cells = [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
      if (cells.length < 5) continue;
      if (!/^\d{4,}$/.test(cells[0])) continue;
      out.push({
        codigo: cells[0],
        fechaCreacion: cells[1] || '',
        fechaPresentacion: cells[2] || '',
        nroTransaccion: cells[3] || '',
        estado: cells[4] || '',
      });
    }
    return out;
  });
}

async function abrirNovedad(sr, decision) {
  if (decision.accion === 'NUEVO') {
    const nuevo = sr.getByRole('button', { name: /^Nuevo$/i })
      .or(sr.getByRole('link', { name: /^Nuevo$/i }))
      .or(sr.getByText(/^Nuevo$/i));
    await nuevo.first().click({ timeout: 20000 });
  } else if (decision.accion === 'EDITAR') {
    const fila = sr.locator('tr').filter({ hasText: new RegExp(`^\\s*${decision.codigo}\\b`) }).first();
    const lapiz = fila.locator('a, button, img, input').filter({
      has: sr.locator('[title*="Editar" i], [title*="Modificar" i], [alt*="Editar" i], [src*="edit" i], [src*="lapiz" i], [src*="pencil" i]'),
    }).or(fila.locator('a').nth(0));
    await lapiz.first().click({ timeout: 20000 });
  } else {
    throw new Error(decision.mensaje || 'NOVEDAD_ABIERTA_AJENA');
  }
  await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
}

async function leerYGuardarCodigo(sr, { loteId, envioId }) {
  const texto = await sr.locator('body').innerText();
  const codigo = extraerCodigoPrincipal(texto);
  if (!codigo) throw new Error('SIN_CODIGO_NOVEDAD');
  console.log(JSON.stringify({ arcaCodigoNovedad: codigo }));
  await guardarCodigoLote({ loteId, envioId, arcaCodigoNovedad: codigo });
  return codigo;
}

async function clickCargarArchivo(sr) {
  const porTitle = sr.locator('[title*="Cargar Archivo" i], a[title*="Cargar" i], img[alt*="Cargar" i], input[title*="Cargar Archivo" i]');
  if (await porTitle.count()) {
    await porTitle.first().click();
  } else {
    await sr.getByRole('link', { name: /Cargar Archivo/i }).first().click({ timeout: 15000 });
  }
  await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  await sr.getByText(/INGRESO DE ARCHIVO/i).first().waitFor({ timeout: 20000 }).catch(() => {});
}

async function subirYValidar(sr, archivo) {
  const lineasTxt = contarLineasTxt(fs.readFileSync(archivo, 'utf8'));
  await sr.locator('input[type="file"]').first().setInputFiles(archivo);
  const cargar = sr.getByRole('button', { name: /^Cargar$/i });
  await cargar.first().click();
  await sr.waitForLoadState('domcontentloaded', { timeout: 60000 });
  const texto = await sr.locator('body').innerText();
  const estado = leerEstadoCarga(texto);
  const validacion = validarRegistrosVsTxt({ registros: estado.registros, lineasTxt });
  console.log(JSON.stringify({ carga: estado, lineasTxt, validacion }));
  if (!validacion.ok) {
    const detalle = texto.slice(0, 800);
    console.error(JSON.stringify({ detalleErrores: detalle }));
    throw new Error(validacion.error);
  }
  return { estado, lineasTxt, texto };
}

/** Presentar: selectores por confirmar. Tras presentar, nro desde listado por código. */
async function presentarYLeerNro(sr, codigo, explorar) {
  if (explorar) {
    console.log(JSON.stringify({ explorar: true, presentar: 'omitido', arcaCodigoNovedad: codigo }));
    return { nros: [], explorar: true };
  }
  const presentar = sr.getByRole('button', { name: /Presentar|Enviar|Cerrar/i })
    .or(sr.getByRole('link', { name: /Presentar|Enviar/i }));
  if (!(await presentar.count())) {
    throw new Error('PRESENTAR_POR_CONFIRMAR');
  }
  await presentar.first().click();
  await sr.waitForLoadState('domcontentloaded', { timeout: 60000 });
  try {
    await sr.goto(URLS_CARGA.cargaMasiva, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch {
    /* puede haber quedado en listado */
  }
  const filas = await leerFilasListado(sr);
  const nro = nroDesdeFilaListado(filas, codigo);
  if (nro) return { nros: [nro], explorar: false };
  const texto = await sr.locator('body').innerText();
  const nros = extraerNros(texto);
  if (!nros.length) throw new Error('SIN_NRO_TRANSACCION');
  return { nros, explorar: false };
}

async function subirReal({ archivo, acceso, loteId, envioId, codigoLote, intento, explorar }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('PLAYWRIGHT_NO_INSTALADO');
  }
  const browser = await chromium.launch({ headless: process.env.ARCA_ROBOT_HEADLESS !== '0' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let sr = page;
  try {
    const plan = planAcceso(acceso);
    await login(page, plan.cuitLogin, acceso.clave);
    if (plan.elegirRepresentado) await elegirRepresentado(page, plan.cuitRepresentado);
    sr = await abrirSimplificacion(context, page);
    await elegirEmpleadorSimplificacion(sr, plan.cuitRepresentado || plan.cuitLogin);
    await continuarDatosBasicosSiAparece(sr);
    await irACargaMasiva(sr);
    const filas = await leerFilasListado(sr);
    const decision = decidirNovedadAbierta({ filas, codigoLote });
    console.log(JSON.stringify({ decision, filas: filas.map((f) => ({ codigo: f.codigo, estado: f.estado })) }));
    if (decision.accion === 'ERROR') {
      await capturar(sr, loteId || envioId, intento, 'novedad-ajena');
      throw new Error(decision.mensaje);
    }
    await abrirNovedad(sr, decision);
    const codigo = await leerYGuardarCodigo(sr, { loteId, envioId });
    await clickCargarArchivo(sr);
    await subirYValidar(sr, archivo);
    const presentado = await presentarYLeerNro(sr, codigo, explorar);
    const hrefs = await sr.locator('a').evaluateAll((as) => as.map((a) => a.href || ''));
    const constanciaUrl = hrefs.find((h) => /constancia|acuse|comprobante/i.test(h)) || '';
    return { nros: presentado.nros, constanciaUrl, arcaCodigoNovedad: codigo, explorar: presentado.explorar };
  } catch (e) {
    await capturar(sr || page, loteId || envioId, intento).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modo = String(args.modo || '');
  const explorarCarga = modo === 'explorar-carga' || (modo === 'explorar' && args.archivo);
  if ((modo === 'anular' || modo === 'explorar') && !explorarCarga) {
    const { correrAnulacion } = await import('./anular.mjs');
    await correrAnulacion({
      args,
      terminar,
      resolverAcceso,
      login,
      elegirRepresentado,
    });
    return;
  }
  const loteId = args.lote || '';
  const envioId = args.envio || '';
  const tipo = String(args.tipo || '').toUpperCase();
  const cuit = String(args.cuit || '').replace(/\D/g, '');
  if (!(loteId || envioId) || !(tipo === 'AT' || tipo === 'BT')) {
    console.error('USO: --archivo --lote|--envio --cuit --tipo AT|BT --empresa [--modo explorar]');
    process.exit(2);
  }
  const baseBody = { loteId, envioId };
  const codigoLote = String(args.codigo || process.env.ARCA_CODIGO_NOVEDAD || '').trim();

  if (esSimulacion()) {
    const nro = nroSimulado(loteId || envioId);
    console.log(JSON.stringify({ simulacion: true, nroTransaccion: nro, tipo }));
    await terminar(bodyResultado({ ...baseBody, estado: 'CONFIRMADO', nroTransaccion: nro }));
  }

  let acceso = null;
  try {
    acceso = await resolverAcceso(String(args.empresa || ''), cuit);
  } catch (e) {
    await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: sanitizarTexto(e.message || 'CLAVE', '') }));
  }
  if (!acceso || !acceso.clave || !planAcceso(acceso).cuitLogin) {
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
      const subido = await subirReal({
        archivo,
        acceso,
        loteId,
        envioId,
        codigoLote,
        intento: i,
        explorar: explorarCarga,
      });
      if (subido.explorar) {
        console.log(JSON.stringify({ ok: true, explorar: true, arcaCodigoNovedad: subido.arcaCodigoNovedad, intento: i }));
        process.exit(0);
      }
      console.log(JSON.stringify({ ok: true, nros: subido.nros, arcaCodigoNovedad: subido.arcaCodigoNovedad, intento: i }));
      await terminar(bodyResultado({
        ...baseBody,
        estado: 'CONFIRMADO',
        nroTransaccion: subido.nros.join(','),
        constanciaUrl: subido.constanciaUrl,
        arcaCodigoNovedad: subido.arcaCodigoNovedad,
      }));
    } catch (e) {
      last = sanitizarTexto(String(e && e.message ? e.message : e), acceso && acceso.clave).slice(0, 500);
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
