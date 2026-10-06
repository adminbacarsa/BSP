/**
 * AT urgente por Altas Masivas (ArchivoAltas.aspx, capturas 245-250).
 * Entra igual que Carga Masiva hasta Simplificación Registral, pega hasta 10 líneas
 * y lee «Registro N: …». La pantalla de un Aceptar válido no está capturada:
 * esos selectores quedan «por confirmar» y explorar frena antes de Aceptar.
 */
import fs from 'node:fs';
import { bodyResultado, esSimulacion, nroSimulado, planAcceso, sanitizarTexto } from './flujo.mjs';
import { textoAltasMasivas } from '../../apps/web2/src/lib/eventuales/arcaLinea.mjs';

export const URL_ARCHIVO_ALTAS =
  'https://serviciossegsoc.afip.gob.ar/tramites_con_clave_fiscal/MiSimplificacion/app/Contribuyente/RelacionLaboral/ArchivoAltas.aspx';

export function parseErroresAltaTexto(texto) {
  const out = [];
  const re = /Registro\s+(\d+)\s*:\s*([^\n\r]+)/gi;
  let m = re.exec(String(texto || ''));
  while (m) {
    out.push({ registro: Number(m[1]), mensaje: m[2].trim() });
    m = re.exec(String(texto || ''));
  }
  return out;
}

/**
 * Lo que se pudo leer después de Aceptar. Selectores de nro/CAT/constancia: por confirmar.
 * @returns {{ nroTransaccion: string, cat: string, constanciaUrl: string }}
 */
export function extraerAcuseAltaTexto(texto) {
  const src = String(texto || '');
  const cat = (src.match(/\bCAT\s*[:\s#]*(\d{4,})/i) || [])[1] || '';
  const nro = (src.match(/Nro\.?\s*(?:de\s*)?(?:Alta|Transacci[oó]n)\s*[:\s]*(\d{4,})/i) || [])[1]
    || (src.match(/\b(?:alta|transacci[oó]n)\s*[:\s#]*(\d{6,})/i) || [])[1]
    || '';
  return { nroTransaccion: nro || cat, cat, constanciaUrl: '' };
}

async function irAAltasMasivas(sr) {
  const menu = sr.getByRole('link', { name: /Relaciones Laborales/i }).first();
  if (await menu.count()) {
    await menu.hover().catch(() => {});
    await menu.click({ timeout: 8000 }).catch(() => {});
  }
  const registrar = sr.getByRole('link', { name: /Registrar Nuevas Altas/i })
    .or(sr.getByText(/Registrar Nuevas Altas/i));
  if (await registrar.count()) {
    await registrar.first().click({ timeout: 12000 });
    await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  } else {
    await sr.goto(URL_ARCHIVO_ALTAS, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  const masivas = sr.getByRole('button', { name: /^Altas Masivas$/i })
    .or(sr.getByRole('link', { name: /^Altas Masivas$/i }));
  if (await masivas.count()) {
    await masivas.first().click({ timeout: 12000 });
    await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  }
  await sr.locator('textarea').first().waitFor({ timeout: 20000 });
}

async function navegarAltasTexto(sr, texto, { explorar, loteId, capturar }) {
  await irAAltasMasivas(sr);
  const area = sr.locator('textarea').first();
  await area.fill(texto);
  if (explorar) {
    await capturar(sr, loteId, 1, 'altas-texto-antes-aceptar');
    console.log(JSON.stringify({ explorar: true, aceptar: 'omitido', lineas: texto.split('\n').length }));
    return { explorar: true, nros: [], cat: '', constanciaUrl: '', constanciaBase64: '' };
  }
  const aceptar = sr.getByRole('button', { name: /^Aceptar$/i });
  await aceptar.first().click({ timeout: 15000 });
  await sr.waitForLoadState('domcontentloaded', { timeout: 45000 });
  await sr.waitForTimeout(800);
  const body = await sr.locator('body').innerText();
  const errores = parseErroresAltaTexto(body);
  console.log(JSON.stringify({ erroresAltaTexto: errores }));
  if (errores.length) {
    const err = new Error(errores.map((e) => `Registro ${e.registro}: ${e.mensaje}`).join('; ').slice(0, 500));
    err.noReintentar = true;
    throw err;
  }
  const acuse = extraerAcuseAltaTexto(body);
  const shot = await capturar(sr, loteId, 1, 'altas-texto-aceptar');
  let constanciaBase64 = '';
  if (shot && fs.existsSync(shot)) constanciaBase64 = fs.readFileSync(shot).toString('base64');
  if (!acuse.nroTransaccion) {
    const err = new Error('ALTA_TEXTO_SIN_NRO');
    err.noReintentar = true;
    throw err;
  }
  return {
    explorar: false,
    nros: [acuse.nroTransaccion],
    cat: acuse.cat,
    constanciaUrl: acuse.constanciaUrl,
    constanciaBase64,
  };
}

export async function correrAltasTexto({
  args,
  explorar,
  terminar,
  resolverAcceso,
  login,
  elegirRepresentado,
  elegirEmpleadorSimplificacion,
  abrirSimplificacion,
  continuarDatosBasicosSiAparece,
  capturar,
}) {
  const loteId = String(args.lote || '');
  const envioId = String(args.envio || '');
  const tipo = String(args.tipo || '').toUpperCase();
  const cuit = String(args.cuit || '').replace(/\D/g, '');
  if (!(loteId || envioId) || tipo !== 'AT') {
    console.error('USO: --modo altas-texto --archivo TXT --lote|--envio --cuit --tipo AT --empresa');
    process.exit(2);
  }
  const baseBody = { loteId, envioId, canalCarga: 'ALTAS_TEXTO' };
  const archivo = String(args.archivo || '');
  if (!explorar && esSimulacion()) {
    const nro = nroSimulado(loteId || envioId);
    console.log(JSON.stringify({ simulacion: true, nroTransaccion: nro, tipo, canalCarga: 'ALTAS_TEXTO' }));
    await terminar(bodyResultado({ ...baseBody, estado: 'ENVIADO', nroTransaccion: nro }));
  }
  if (explorar && esSimulacion()) {
    console.log(JSON.stringify({ simulacion: true, explorar: true, aceptar: 'omitido' }));
    process.exit(0);
  }
  if (!archivo || !fs.existsSync(archivo)) {
    await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: 'FALTA_TXT' }));
  }
  const crudo = fs.readFileSync(archivo, 'utf8');
  const armado = textoAltasMasivas(crudo.split(/\r?\n/));
  if (!armado.ok) {
    await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: armado.codigo }));
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
  const intentos = Math.min(5, Math.max(1, Number(process.env.ARCA_ROBOT_REINTENTOS || 3)));
  let last = 'ERROR_ROBOT';
  for (let i = 1; i <= intentos; i += 1) {
    let browser;
    let sr;
    try {
      let chromium;
      try {
        ({ chromium } = await import('playwright'));
      } catch {
        throw new Error('PLAYWRIGHT_NO_INSTALADO');
      }
      browser = await chromium.launch({ headless: process.env.ARCA_ROBOT_HEADLESS !== '0' });
      const context = await browser.newContext();
      const page = await context.newPage();
      const plan = planAcceso(acceso);
      await login(page, plan.cuitLogin, acceso.clave);
      if (plan.elegirRepresentado) await elegirRepresentado(page, plan.cuitRepresentado);
      sr = await abrirSimplificacion(context, page);
      await elegirEmpleadorSimplificacion(sr, plan.cuitRepresentado || plan.cuitLogin);
      await continuarDatosBasicosSiAparece(sr);
      const subido = await navegarAltasTexto(sr, armado.texto, { explorar, loteId: loteId || envioId, capturar });
      if (subido.explorar) {
        console.log(JSON.stringify({ ok: true, explorar: true, intento: i }));
        await browser.close().catch(() => {});
        browser = null;
        process.exit(0);
      }
      await browser.close().catch(() => {});
      browser = null;
      const body = bodyResultado({
        ...baseBody,
        estado: 'ENVIADO',
        nroTransaccion: subido.nros.join(','),
        constanciaUrl: subido.constanciaUrl,
        cat: subido.cat,
      });
      if (subido.constanciaBase64) body.constanciaBase64 = subido.constanciaBase64;
      await terminar(body);
    } catch (e) {
      last = sanitizarTexto(String(e && e.message ? e.message : e), acceso && acceso.clave).slice(0, 500);
      console.error(JSON.stringify({ intento: i, error: last }));
      if (sr) await capturar(sr, loteId || envioId, i, 'altas-texto-error').catch(() => {});
      if (e && e.noReintentar) break;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
  await terminar(bodyResultado({ ...baseBody, estado: 'ERROR', error: last }));
}

