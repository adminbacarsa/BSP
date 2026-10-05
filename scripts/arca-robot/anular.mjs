/**
 * Anulación de a una por la web de ARCA.
 * --modo anular confirma y lee el acuse. --modo explorar llega hasta la pantalla y no confirma.
 * ARCA_SIMULACION=1 no abre el navegador ni pide la clave: devuelve SIM-ANUL-…
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyResultado, esSimulacion, extraerNros, planAcceso, sanitizarTexto } from './flujo.mjs';
import { decidirTarjetaAnulacion, parseTarjetasRelacion } from './verificacionAlta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function nroAnulacionSimulado(envioId) {
  const limpio = String(envioId || 'ENVIO').replace(/[^a-zA-Z0-9]/g, '').slice(-12) || 'ENVIO';
  return `SIM-ANUL-${limpio}`;
}

export function bodyAnulacionSimulada(envioId) {
  return { envioId: String(envioId || ''), estado: 'ANULADO', acuse: nroAnulacionSimulado(envioId) };
}

export function extraerAcuse(texto) {
  const src = String(texto || '');
  const directo = src.match(/acuse[^0-9]{0,40}([0-9]{4,})/i) || src.match(/anulaci[oó]n[^0-9]{0,40}([0-9]{4,})/i);
  if (directo) return directo[1];
  return extraerNros(src)[0] || '';
}

export function cargarSelectores(file = path.join(__dirname, 'selectores.json')) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [clave, valor] of Object.entries(raw)) {
    if (clave.startsWith('_') || !valor || typeof valor !== 'object') continue;
    out[clave] = valor;
  }
  return out;
}

async function pedirDatos(envioId) {
  const base = String(process.env.ARCA_ENVIOS_URL || '').trim();
  const key = String(process.env.ARCA_ROBOT_KEY || '').trim();
  if (!base || !key || !envioId) return { ok: false, error: 'FALTA_ARCA_ENVIOS_URL_O_KEY' };
  const join = base.includes('?') ? '&' : '?';
  const res = await fetch(`${base}${join}action=anulacion&envioId=${encodeURIComponent(envioId)}`, {
    headers: { 'x-arca-key': key },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && (data.error === 'MANUAL' || data.error === 'PLAZO_VENCIDO' || data.error === 'YA_ANULADO')) {
    return { ok: false, omitir: true, error: data.error, motivo: data.motivo || '' };
  }
  if (!res.ok) return { ok: false, error: data.error || `HTTP_${res.status}` };
  return { ok: true, datos: data };
}

async function capturaPaso(page, envioId, paso) {
  if (!page) return '';
  const dir = process.env.ARCA_SHOTS_DIR || path.join(os.tmpdir(), 'arca-robot-shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(envioId || 'envio').replace(/[^\w.-]/g, '_')}-anul-${paso}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.error(JSON.stringify({ captura: file, paso }));
  return file;
}

async function clickPor(page, sel) {
  const name = new RegExp(String(sel?.name || sel?.label || ''), 'i');
  const role = sel?.role || 'link';
  await page.getByRole(role, { name }).first().click({ timeout: 20000 });
}

async function completar(page, sel, valor) {
  if (!valor || !sel?.label) return;
  await page.getByLabel(new RegExp(String(sel.label), 'i')).first().fill(String(valor), { timeout: 15000 });
}

async function navegar(page, datos, selectores, envioId, explorar) {
  await clickPor(page, selectores.simplificacionRegistral);
  await capturaPaso(page, envioId, 'simplificacion');
  await clickPor(page, selectores.relacionesLaborales);
  await capturaPaso(page, envioId, 'relaciones');
  await clickPor(page, selectores.anularRegistro);
  await capturaPaso(page, envioId, 'anular-registro');
  await completar(page, selectores.cuil, datos.cuil);
  await completar(page, selectores.fechaInicio, datos.fechaInicio);
  await completar(page, selectores.nroTransaccion, datos.nroTransaccionAlta);
  await capturaPaso(page, envioId, 'formulario');
  await clickPor(page, selectores.buscar);
  await capturaPaso(page, envioId, 'busqueda');
  const tarjetas = parseTarjetasRelacion(await page.locator('body').innerText());
  const eleccion = decidirTarjetaAnulacion({
    tarjetas,
    fechaInicio: datos.fechaInicio || datos.fechaAlta,
    modalidad: '012',
  });
  console.log(JSON.stringify({ eleccion, tarjetas }));
  if (eleccion.accion !== 'ANULAR') {
    throw new Error(`ANULACION_MANUAL:${eleccion.motivo || 'SIN_TARJETA_012'}`);
  }
  if (explorar) return '';
  // Ícono tacho (anular) de la tarjeta elegida — no el lápiz ni la baja.
  const fila = page.locator('tr, .card, div').filter({
    hasText: new RegExp(String(eleccion.tarjeta.fechaInicio || '').replace(/\//g, '\\/')),
  }).filter({ hasText: /012|Mod/i }).first();
  const anularIcon = fila.locator('[title*="Anul" i], a[title*="Anul" i], img[alt*="Anul" i]').or(
    page.getByRole('button', { name: /Anular/i }),
  );
  if (await anularIcon.count()) await anularIcon.first().click({ timeout: 15000 });
  else await clickPor(page, selectores.anular);
  await capturaPaso(page, envioId, 'anular');
  await clickPor(page, selectores.confirmar);
  await capturaPaso(page, envioId, 'acuse');
  const texto = await page.locator('body').innerText();
  const acuse = extraerAcuse(texto);
  if (acuse.length < 3) throw new Error('SIN_ACUSE');
  return acuse;
}

/** `deps` reutiliza login, credencial y el POST a COSP de subir.mjs. */
export async function correrAnulacion(deps) {
  const args = deps.args || {};
  const modo = args.modo === 'explorar' ? 'explorar' : 'anular';
  const envioId = String(args.envio || '').trim();
  if (modo === 'anular' && !envioId) {
    console.error('USO: --modo anular --envio ID --empresa EMPRESA');
    process.exit(2);
  }
  if (esSimulacion()) {
    if (modo === 'explorar') {
      console.log(JSON.stringify({ simulacion: true, explorar: false, motivo: 'ARCA_SIMULACION' }));
      process.exit(0);
    }
    const body = bodyAnulacionSimulada(envioId);
    console.log(JSON.stringify({ simulacion: true, acuse: body.acuse }));
    await deps.terminar(bodyResultado(body));
    return;
  }

  const pedido = await pedirDatos(envioId);
  if (pedido.omitir) {
    console.log(JSON.stringify({ omitido: true, error: pedido.error, motivo: pedido.motivo || '' }));
    process.exit(0);
  }
  if (!pedido.ok) {
    await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: pedido.error || 'SIN_DATOS_ANULACION', fallosRobot: 1 }));
    return;
  }
  const datos = pedido.datos;
  let acceso = null;
  try {
    acceso = await deps.resolverAcceso(String(args.empresa || datos.empresaId || ''), String(datos.cuitRepresentado || ''));
  } catch (e) {
    await deps.terminar(bodyResultado({
      envioId,
      estado: 'ERROR',
      error: sanitizarTexto(e.message || 'CLAVE', ''),
      fallosRobot: 1,
    }));
    return;
  }
  if (!acceso?.clave || !planAcceso(acceso).cuitLogin) {
    await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: 'FALTA_CLAVE_FISCAL', fallosRobot: 1 }));
    return;
  }

  const selectores = cargarSelectores();
  const tope = Math.min(2, Math.max(1, Number(process.env.ARCA_ROBOT_REINTENTOS || 2)));
  let last = 'ERROR_ROBOT';
  for (let i = 1; i <= tope; i += 1) {
    let browser;
    let page;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: process.env.ARCA_ROBOT_HEADLESS !== '0' });
      page = await browser.newPage();
      const plan = planAcceso(acceso);
      await deps.login(page, plan.cuitLogin, acceso.clave);
      await capturaPaso(page, envioId, 'login');
      if (plan.elegirRepresentado) await deps.elegirRepresentado(page, plan.cuitRepresentado);
      const acuse = await navegar(page, datos, selectores, envioId, modo === 'explorar');
      if (modo === 'explorar') {
        console.log(JSON.stringify({ explorar: true, envioId, confirmado: false }));
        process.exit(0);
      }
      console.log(JSON.stringify({ ok: true, acuse, intento: i }));
      await deps.terminar(bodyResultado({ envioId, estado: 'ANULADO', acuse }));
      return;
    } catch (e) {
      last = sanitizarTexto(String(e?.message || e), acceso.clave).slice(0, 500);
      console.error(JSON.stringify({ intento: i, error: last }));
      if (page) await capturaPaso(page, envioId, `error-${i}`).catch(() => {});
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
  if (String(last).startsWith('ANULACION_MANUAL:')) {
    await deps.terminar(bodyResultado({ envioId, estado: 'MANUAL', error: last }));
    return;
  }
  await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: last, fallosRobot: tope }));
}
