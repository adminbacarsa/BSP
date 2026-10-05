/**
 * Verifica en ARCA (Consultas / Modificaciones y Bajas) que el alta eventual apareció.
 * --modo verificar --envio ID --empresa EMPRESA
 * Confirma solo si hay una tarjeta con Fecha de Inicio = fechaAlta y Mod. Contrato 012.
 * Si pasaron 48 h sin aparecer → VERIFICAR. Si no, sale sin cambiar (reintento).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bodyResultado, esSimulacion, planAcceso, sanitizarTexto } from './flujo.mjs';
import {
  decidirResultadoVerificacion,
  parseTarjetasRelacion,
  VENTANA_VERIFICACION_MS,
} from './verificacionAlta.mjs';
import { URLS_CARGA } from './cargaMasiva.mjs';

async function pedirEnvio(envioId) {
  const base = String(process.env.ARCA_ENVIOS_URL || '').trim();
  const key = String(process.env.ARCA_ROBOT_KEY || '').trim();
  if (!base || !key || !envioId) return { ok: false, error: 'FALTA_ARCA_ENVIOS_URL_O_KEY' };
  const join = base.includes('?') ? '&' : '?';
  // reutiliza anulacion para cuil/fecha/cuit; si no, lotes no aplica — GET custom via resultado no existe
  const res = await fetch(`${base}${join}action=verificacion&envioId=${encodeURIComponent(envioId)}`, {
    headers: { 'x-arca-key': key },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || `HTTP_${res.status}` };
  return { ok: true, datos: data };
}

async function captura(page, envioId, paso) {
  if (!page) return '';
  const dir = process.env.ARCA_SHOTS_DIR || path.join(os.tmpdir(), 'arca-robot-shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(envioId || 'envio').replace(/[^\w.-]/g, '_')}-verif-${paso}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.error(JSON.stringify({ captura: file, paso }));
  return file;
}

async function consultarTarjetas(page, cuil, elegirEmpleador, cuitRepresentado) {
  // Tras login ya en Simplificación: ir a Modificaciones y Bajas / Consultas
  await page.getByText(/Relaciones Laborales/i).first().hover().catch(() => {});
  const consultas = page.getByRole('link', { name: /Consultas|Modificaciones y Bajas/i })
    .or(page.getByText(/Modificaciones y Bajas|Consultas/i));
  await consultas.first().click({ timeout: 20000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
  const input = page.getByLabel(/CUIL/i).or(page.locator('input[name*="cuil" i], input[id*="cuil" i]')).first();
  if (await input.count()) {
    await input.fill(String(cuil).replace(/\D/g, ''));
    const buscar = page.getByRole('button', { name: /Buscar|Consultar|Aceptar/i });
    if (await buscar.count()) await buscar.first().click();
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
  }
  const texto = await page.locator('body').innerText();
  return parseTarjetasRelacion(texto);
}

export async function correrVerificacion(deps) {
  const args = deps.args || {};
  const envioId = String(args.envio || '').trim();
  if (!envioId) {
    console.error('USO: --modo verificar --envio ID --empresa EMPRESA');
    process.exit(2);
  }

  if (esSimulacion()) {
    // En simulación confirma (hay nro); la verificación real queda para prod.
    console.log(JSON.stringify({ simulacion: true, verificar: 'CONFIRMADO' }));
    await deps.terminar(bodyResultado({ envioId, estado: 'CONFIRMADO', nroTransaccion: `SIM-VERIF-${envioId.slice(-8)}` }));
    return;
  }

  const pedido = await pedirEnvio(envioId);
  if (!pedido.ok) {
    await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: pedido.error || 'SIN_DATOS_VERIFICACION' }));
    return;
  }
  const datos = pedido.datos;
  const decisionPrev = decidirResultadoVerificacion({
    tarjetas: [],
    fechaAlta: datos.fechaAlta,
    ahoraMs: Date.now(),
    enviadaAtMs: Number(datos.enviadaAtMs) || 0,
  });
  // si ya venció sin consultar, igual consultamos una vez

  let acceso;
  try {
    acceso = await deps.resolverAcceso(String(args.empresa || datos.empresaId || ''), String(datos.cuitRepresentado || ''));
  } catch (e) {
    await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: sanitizarTexto(e.message || 'CLAVE', '') }));
    return;
  }
  if (!acceso?.clave || !planAcceso(acceso).cuitLogin) {
    await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: 'FALTA_CLAVE_FISCAL' }));
    return;
  }

  let browser;
  let page;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: process.env.ARCA_ROBOT_HEADLESS !== '0' });
    const context = await browser.newContext();
    page = await context.newPage();
    const plan = planAcceso(acceso);
    await deps.login(page, plan.cuitLogin, acceso.clave);
    if (plan.elegirRepresentado && deps.elegirRepresentado) {
      await deps.elegirRepresentado(page, plan.cuitRepresentado);
    }
    // Simplificación + empleador
    await page.goto(URLS_CARGA.portal, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    const popupWait = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await page.getByText(/Simplificaci[oó]n Registral/i).first().click({ timeout: 20000 });
    const popup = await popupWait;
    const sr = popup || page;
    await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
    if (deps.elegirEmpleadorSimplificacion) {
      await deps.elegirEmpleadorSimplificacion(sr, plan.cuitRepresentado || plan.cuitLogin);
    }
    const tarjetas = await consultarTarjetas(sr, datos.cuil || datos.bolsaCuil, null, plan.cuitRepresentado);
    await captura(sr, envioId, 'consulta');
    const decision = decidirResultadoVerificacion({
      tarjetas,
      fechaAlta: datos.fechaAlta,
      ahoraMs: Date.now(),
      enviadaAtMs: Number(datos.enviadaAtMs) || 0,
      ventanaMs: Number(process.env.ARCA_VERIFICACION_MS || VENTANA_VERIFICACION_MS),
    });
    console.log(JSON.stringify({ decision, tarjetas, fechaAlta: datos.fechaAlta }));
    if (decision.accion === 'CONFIRMADO') {
      await deps.terminar(bodyResultado({
        envioId,
        estado: 'CONFIRMADO',
        nroTransaccion: String(datos.nroTransaccion || ''),
      }));
      return;
    }
    if (decision.accion === 'VERIFICAR') {
      await deps.terminar(bodyResultado({
        envioId,
        estado: 'VERIFICAR',
        error: decision.motivo || 'SIN_TARJETA_EN_48H',
        nroTransaccion: String(datos.nroTransaccion || ''),
      }));
      return;
    }
    if (decision.accion === 'MANUAL') {
      await deps.terminar(bodyResultado({
        envioId,
        estado: 'MANUAL',
        error: decision.motivo || 'VARIAS_TARJETAS',
        nroTransaccion: String(datos.nroTransaccion || ''),
      }));
      return;
    }
    console.log(JSON.stringify({ reintentar: true, motivo: decision.motivo }));
    process.exit(0);
  } catch (e) {
    const last = sanitizarTexto(String(e?.message || e), acceso.clave).slice(0, 500);
    if (page) await captura(page, envioId, 'error').catch(() => {});
    await deps.terminar(bodyResultado({ envioId, estado: 'ERROR', error: last }));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
