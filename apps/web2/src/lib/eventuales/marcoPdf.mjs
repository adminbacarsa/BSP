/**
 * PDF del contrato marco (Anexo A), del anexo por convocatoria (Anexo C)
 * y de la constancia (Anexo D). pdfkit + Tinos embebida: acentos y ñ.
 * Lo usa el servidor. El navegador solo descarga el PDF que devuelve la callable.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';
import { MARCO_VERSION } from './marcoAnexoConst.mjs';
import { formatearCuil, payloadQrMarco } from './marcosLote.mjs';
import {
  CIERRE_MARCO, TITULO_MARCO, clausulasMarco, encabezadoMarco, modeloAnexo, textoConstancia,
} from './marcoTexto.mjs';

const require = createRequire(import.meta.url);
const PDFDocument = require('pdfkit');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = path.join(DIR, 'fonts', 'Tinos-Regular.ttf');
const FUENTE_NEGRITA = path.join(DIR, 'fonts', 'Tinos-Bold.ttf');

const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 56;

function docNuevo() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: MARGEN, bottom: 64, left: MARGEN, right: MARGEN },
    bufferPages: true,
    autoFirstPage: true,
  });
}

function aBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function pie(doc, version) {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i += 1) {
    doc.switchToPage(rango.start + i);
    const margenInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(FUENTE).fontSize(8).fillColor('#444444').text(
      `Plantilla marco v${version}  ·  pág. ${i + 1} de ${rango.count}`,
      MARGEN,
      ALTO - 36,
      { width: ANCHO - MARGEN * 2, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = margenInferior;
  }
}

function tituloCentrado(doc, texto) {
  doc.font(FUENTE_NEGRITA).fontSize(13).fillColor('#111111').text(texto, { align: 'center' });
  doc.moveDown(0.8);
}

function parrafo(doc, texto) {
  doc.font(FUENTE).fontSize(11).fillColor('#111111').text(texto, { align: 'justify', lineGap: 2 });
  doc.moveDown(0.55);
}

function clausula(doc, item) {
  doc.font(FUENTE_NEGRITA).fontSize(11).fillColor('#111111').text(`${item.titulo} `, { continued: true, align: 'justify', lineGap: 2 });
  doc.font(FUENTE).text(item.cuerpo, { align: 'justify', lineGap: 2 });
  doc.moveDown(0.5);
}

async function qrPng(texto) {
  return QRCode.toBuffer(texto, { errorCorrectionLevel: 'M', margin: 0, width: 180 });
}

/** Bloque de firmas del modelo + QR y CUIL de la hoja de firmas del lote. */
function hojaFirmas(doc, { cuil, ejemplar, png }) {
  if (doc.y > ALTO - 280) doc.addPage();
  doc.moveDown(1.1);
  const y = doc.y + 8;
  const col = (ANCHO - MARGEN * 2 - 36) / 2;
  doc.lineWidth(0.6).strokeColor('#222222');
  doc.moveTo(MARGEN, y).lineTo(MARGEN + col, y).stroke();
  doc.moveTo(MARGEN + col + 36, y).lineTo(ANCHO - MARGEN, y).stroke();
  doc.font(FUENTE_NEGRITA).fontSize(10).fillColor('#111111');
  doc.text('Por el EMPLEADOR', MARGEN, y + 6, { width: col, lineBreak: false });
  doc.text('El TRABAJADOR', MARGEN + col + 36, y + 6, { width: col, lineBreak: false });
  doc.font(FUENTE).fontSize(9).fillColor('#333333');
  doc.text('Firma y aclaración', MARGEN, y + 22, { width: col, lineBreak: false });
  doc.text('Firma, aclaración y DNI', MARGEN + col + 36, y + 22, { width: col, lineBreak: false });
  const qrY = y + 52;
  doc.image(png, ANCHO - MARGEN - 78, qrY, { width: 78 });
  doc.font(FUENTE_NEGRITA).fontSize(11).fillColor('#111111').text(`CUIL ${formatearCuil(cuil)}`, MARGEN, qrY + 8, { width: 280, lineBreak: false });
  doc.font(FUENTE).fontSize(9).fillColor('#333333');
  doc.text(`Ejemplar ${ejemplar} de 2`, MARGEN, qrY + 26, { width: 280, lineBreak: false });
  doc.text('El QR identifica esta hoja para el escaneo en lote. No lo tapes ni escribas encima.', MARGEN, qrY + 42, { width: 300 });
}

function cuerpoMarco(doc, input) {
  tituloCentrado(doc, TITULO_MARCO);
  parrafo(doc, encabezadoMarco(input));
  for (const item of clausulasMarco(input)) clausula(doc, item);
  parrafo(doc, CIERRE_MARCO);
}

/**
 * Un marco, dos ejemplares. Devuelve el PDF y el payload del QR (el mismo en las dos hojas).
 */
export async function pdfMarco(input = {}) {
  const version = Number(input.marcoVersion) > 0 ? Number(input.marcoVersion) : MARCO_VERSION;
  const payload = payloadQrMarco({ bolsaCuil: input.trabajadorCuil, empresaId: input.empresaId, marcoVersion: version });
  const png = await qrPng(payload);
  const doc = docNuevo();
  for (let ejemplar = 1; ejemplar <= 2; ejemplar += 1) {
    if (ejemplar > 1) doc.addPage();
    cuerpoMarco(doc, input);
    hojaFirmas(doc, { cuil: input.trabajadorCuil, ejemplar, png });
  }
  const paginas = doc.bufferedPageRange().count;
  pie(doc, version);
  const bytes = await aBuffer(doc);
  return { bytes, paginas, payload };
}

/** Varias personas, dos ejemplares cada una. Misma forma que usaba la impresión en el navegador. */
export async function pdfMarcosLote({ empresa, personas, fecha, marcoVersion = MARCO_VERSION }) {
  const lista = personas || [];
  const hojasQr = [];
  if (!lista.length) {
    const doc = docNuevo();
    parrafo(doc, 'Sin marcos pendientes para imprimir.');
    pie(doc, marcoVersion);
    const bytes = await aBuffer(doc);
    return { bytes, paginas: 1, hojasQr };
  }
  const doc = docNuevo();
  let primero = true;
  for (const persona of lista) {
    const payload = payloadQrMarco({ bolsaCuil: persona.cuil, empresaId: empresa?.id, marcoVersion });
    const png = await qrPng(payload);
    const input = {
      fecha,
      empresaNombre: empresa?.nombre,
      empresaCuit: empresa?.cuit,
      empresaDomicilio: empresa?.domicilio,
      trabajadorNombre: persona.nombre,
      trabajadorDni: persona.dni,
      trabajadorCuil: persona.cuil,
      trabajadorDomicilio: persona.domicilio,
      telefono: persona.telefono,
      mail: persona.mail,
    };
    for (let ejemplar = 1; ejemplar <= 2; ejemplar += 1) {
      if (!primero) doc.addPage();
      primero = false;
      cuerpoMarco(doc, input);
      hojaFirmas(doc, { cuil: persona.cuil, ejemplar, png });
      hojasQr.push({ cuil: String(persona.cuil), ejemplar, payload });
    }
  }
  const paginas = doc.bufferedPageRange().count;
  pie(doc, marcoVersion);
  const bytes = await aBuffer(doc);
  return { bytes, paginas, hojasQr };
}

function tablaJornadas(doc, filas) {
  const columnas = [100, 150, 50, ANCHO - MARGEN * 2 - 300];
  const headers = ['Fecha', 'Horario', 'Horas', 'Observación'];
  const dibujarFila = (celdas, negrita) => {
    if (doc.y > ALTO - 90) doc.addPage();
    const y = doc.y;
    let x = MARGEN;
    const alto = 16;
    doc.font(negrita ? FUENTE_NEGRITA : FUENTE).fontSize(9).fillColor('#111111');
    celdas.forEach((celda, i) => {
      doc.text(String(celda || '—'), x + 2, y + 3, { width: columnas[i] - 4, height: alto, lineBreak: false });
      x += columnas[i];
    });
    doc.moveTo(MARGEN, y + alto).lineTo(ANCHO - MARGEN, y + alto).lineWidth(0.4).strokeColor('#888888').stroke();
    doc.y = y + alto;
  };
  dibujarFila(headers, true);
  const lista = filas.length ? filas : [['—', '—', '—', '—']];
  for (const fila of lista) dibujarFila(fila, false);
  doc.moveDown(0.6);
}

function bloque(doc, titulo, cuerpo) {
  doc.font(FUENTE_NEGRITA).fontSize(11).fillColor('#111111').text(`${titulo} `, { continued: true, align: 'justify', lineGap: 2 });
  doc.font(FUENTE).text(cuerpo, { align: 'justify', lineGap: 2 });
  doc.moveDown(0.4);
}

export const TEXTO_SIN_FIRMAR = 'SIN FIRMAR';

/** Marca de agua diagonal en todas las páginas (borrador del anexo que el eventual todavía no aceptó). */
function marcaAgua(doc, texto) {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i += 1) {
    doc.switchToPage(rango.start + i);
    doc.save();
    doc.rotate(-35, { origin: [ANCHO / 2, ALTO / 2] });
    doc.font(FUENTE_NEGRITA).fontSize(72).fillColor('#b91c1c').fillOpacity(0.16)
      .text(texto, 0, ALTO / 2 - 40, { width: ANCHO, align: 'center', lineBreak: false });
    doc.restore();
  }
}

/**
 * Anexo C + hoja de constancia (Anexo D).
 * Con `sinFirmar: true` sale el mismo anexo con la marca «SIN FIRMAR» y, en vez de la constancia,
 * una hoja que dice que el eventual todavía no lo aceptó (lo pide la ficha de RRHH para verlo).
 */
export async function pdfAnexo(input = {}) {
  const version = Number(input.marcoVersion) > 0 ? Number(input.marcoVersion) : MARCO_VERSION;
  const modelo = modeloAnexo(input);
  const doc = docNuevo();
  tituloCentrado(doc, modelo.titulo);
  for (const b of modelo.bloques) bloque(doc, b.titulo, b.cuerpo);
  doc.moveDown(0.2);
  tablaJornadas(doc, modelo.filas);
  parrafo(doc, modelo.remuneracion);
  parrafo(doc, modelo.arca);
  parrafo(doc, modelo.cierre);
  doc.addPage();
  if (input.sinFirmar) {
    tituloCentrado(doc, 'ANEXO SIN FIRMAR');
    parrafo(doc, 'Este anexo todavía no fue aceptado por el trabajador. La constancia de aceptación electrónica se emite recién cuando confirma el código de un solo uso desde la app o el mail.');
    parrafo(doc, `Generado el ${String(input.generadoEl || new Date().toISOString()).slice(0, 10)} desde la ficha del eventual para consulta de RRHH. No reemplaza al anexo firmado.`);
  } else {
    tituloCentrado(doc, 'CONSTANCIA DE ACEPTACIÓN ELECTRÓNICA');
    const cajaY = doc.y;
    const lineas = textoConstancia(input.constancia || {}).split('\n');
    doc.font(FUENTE).fontSize(10).fillColor('#111111');
    for (const linea of lineas) {
      doc.text(linea, MARGEN + 10, doc.y, { width: ANCHO - MARGEN * 2 - 20 });
      doc.moveDown(0.15);
    }
    doc.rect(MARGEN, cajaY - 8, ANCHO - MARGEN * 2, doc.y - cajaY + 16).lineWidth(0.6).strokeColor('#222222').stroke();
  }
  const paginas = doc.bufferedPageRange().count;
  pie(doc, version);
  if (input.sinFirmar) marcaAgua(doc, TEXTO_SIN_FIRMAR);
  const bytes = await aBuffer(doc);
  return { bytes, paginas };
}

