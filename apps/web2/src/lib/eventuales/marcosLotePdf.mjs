/**
 * PDF de impresión de marcos en lote: por persona, dos ejemplares (texto + hoja de firmas con QR y CUIL).
 * Corre en el navegador (RRHH → Eventuales) y en Node (tests). Helvetica, A4, sin librerías de PDF.
 */
import QRCode from 'qrcode';
import { MARCO_VERSION } from './marcoAnexoConst.mjs';
import { textoMarco } from './marcoTexto.mjs';
import { formatearCuil, payloadQrMarco } from './marcosLote.mjs';

export const EJEMPLARES_POR_PERSONA = 2;
const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;
const LINEAS_POR_PAGINA = 48;
const ANCHO_LINEA = 90;
const MODULO_QR = 3;

export function matrizQr(texto) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, data: Array.from(qr.modules.data) };
}

function ascii(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x0A\x20-\x7E]/g, ' ');
}

function pdfEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function envolver(linea, ancho) {
  const palabras = linea.split(' ');
  const salida = [];
  let actual = '';
  for (const palabra of palabras) {
    if (!actual) {
      actual = palabra;
    } else if (`${actual} ${palabra}`.length <= ancho) {
      actual += ` ${palabra}`;
    } else {
      salida.push(actual);
      actual = palabra;
    }
    while (actual.length > ancho) {
      salida.push(actual.slice(0, ancho));
      actual = actual.slice(ancho);
    }
  }
  salida.push(actual);
  return salida;
}

/** Corta el texto en páginas de líneas. */
export function paginasDeTexto(texto, { lineasPorPagina = LINEAS_POR_PAGINA, anchoLinea = ANCHO_LINEA } = {}) {
  const lineas = ascii(texto).split('\n').flatMap((l) => envolver(l, anchoLinea));
  const paginas = [];
  for (let i = 0; i < lineas.length; i += lineasPorPagina) paginas.push(lineas.slice(i, i + lineasPorPagina));
  return paginas.length ? paginas : [[]];
}

function streamTexto(lineas) {
  const comandos = ['BT', '/F1 10 Tf', `${MARGEN} ${ALTO - 42} Td`, '14 TL'];
  lineas.forEach((linea, i) => {
    if (i) comandos.push('T*');
    comandos.push(`(${pdfEscape(linea)}) Tj`);
  });
  comandos.push('ET');
  return comandos.join('\n');
}

function texto(x, y, fuente, tam, cadena) {
  return `BT /${fuente} ${tam} Tf ${x} ${y} Td (${pdfEscape(ascii(cadena))}) Tj ET`;
}

function linea(x1, y1, x2, y2) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

/** Rectángulos negros por módulo. Esquina inferior izquierda en (x, y). */
export function streamQr(matriz, x, y, modulo = MODULO_QR) {
  const partes = ['q 0 g'];
  const { size, data } = matriz;
  for (let fila = 0; fila < size; fila += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!data[fila * size + col]) continue;
      const px = x + col * modulo;
      const py = y + (size - 1 - fila) * modulo;
      partes.push(`${px} ${py} ${modulo} ${modulo} re f`);
    }
  }
  partes.push('Q');
  return partes.join('\n');
}

function streamFirmas({ empresaNombre, persona, empresaId, ejemplar, matriz, marcoVersion }) {
  const cuil = formatearCuil(persona.cuil);
  const lado = matriz.size * MODULO_QR;
  const qrX = ANCHO - MARGEN - lado;
  const qrY = 120;
  const partes = [
    texto(MARGEN, ALTO - 60, 'F2', 13, 'HOJA DE FIRMAS - CONTRATO MARCO DE TRABAJO EVENTUAL'),
    texto(MARGEN, ALTO - 85, 'F1', 10, `Empleador: ${empresaNombre}`),
    texto(MARGEN, ALTO - 100, 'F1', 10, `Trabajador: ${persona.nombre || ''}   DNI ${persona.dni || '-'}`),
    texto(MARGEN, ALTO - 125, 'F2', 16, `CUIL ${cuil}`),
    texto(MARGEN, ALTO - 145, 'F1', 10, `Ejemplar ${ejemplar} de ${EJEMPLARES_POR_PERSONA}. Fecha de firma: ____ / ____ / ________`),
    texto(MARGEN, ALTO - 175, 'F1', 10, 'Las partes firman de conformidad el contrato marco que antecede.'),
    'q 0.5 w',
    linea(MARGEN, 520, 270, 520),
    linea(ANCHO - MARGEN - 220, 520, ANCHO - MARGEN, 520),
    linea(MARGEN, 430, 270, 430),
    linea(ANCHO - MARGEN - 220, 430, ANCHO - MARGEN, 430),
    'Q',
    texto(MARGEN, 508, 'F1', 9, 'Firma EL EMPLEADOR'),
    texto(ANCHO - MARGEN - 220, 508, 'F1', 9, 'Firma EL TRABAJADOR'),
    texto(MARGEN, 418, 'F1', 9, 'Aclaracion y DNI'),
    texto(ANCHO - MARGEN - 220, 418, 'F1', 9, 'Aclaracion y DNI'),
    streamQr(matriz, qrX, qrY),
    texto(qrX, qrY - 14, 'F2', 9, `CUIL ${cuil}`),
    texto(qrX, qrY - 26, 'F1', 7, `${empresaId} - marco v${marcoVersion} - COSP`),
    texto(MARGEN, qrY + lado - 10, 'F1', 8, 'El QR identifica esta hoja para el escaneo en lote.'),
    texto(MARGEN, qrY + lado - 22, 'F1', 8, 'No lo tapes ni escribas encima.'),
  ];
  return partes.join('\n');
}

function bytesLatin1(cadena) {
  const out = new Uint8Array(cadena.length);
  for (let i = 0; i < cadena.length; i += 1) out[i] = cadena.charCodeAt(i) & 0xff;
  return out;
}

/**
 * personas: [{ cuil, nombre, dni, domicilio }]. empresa: { id, nombre, cuit, domicilio }.
 * Devuelve Uint8Array del PDF y la lista de hojas con QR (para tests).
 */
export function pdfMarcosLote({ empresa, personas, fecha, marcoVersion = MARCO_VERSION, qr = matrizQr }) {
  const empresaNombre = String(empresa?.nombre || empresa?.id || 'LA EMPRESA');
  const paginas = [];
  const hojasQr = [];
  for (const persona of personas || []) {
    const cuerpo = textoMarco({
      empresaNombre,
      empresaCuit: empresa?.cuit,
      empresaDomicilio: empresa?.domicilio,
      trabajadorNombre: persona.nombre,
      trabajadorDni: persona.dni,
      trabajadorDomicilio: persona.domicilio,
      fecha,
    });
    const payload = payloadQrMarco({ bolsaCuil: persona.cuil, empresaId: empresa?.id, marcoVersion });
    const matriz = qr(payload);
    for (let ejemplar = 1; ejemplar <= EJEMPLARES_POR_PERSONA; ejemplar += 1) {
      for (const lineas of paginasDeTexto(cuerpo)) paginas.push(streamTexto(lineas));
      paginas.push(streamFirmas({ empresaNombre, persona, empresaId: empresa?.id, ejemplar, matriz, marcoVersion }));
      hojasQr.push({ cuil: String(persona.cuil), ejemplar, pagina: paginas.length, payload });
    }
  }
  if (!paginas.length) paginas.push(streamTexto(['Sin marcos pendientes para imprimir.']));

  const objetos = [];
  const agregar = (cuerpo) => { objetos.push(cuerpo); return objetos.length; };
  agregar('<< /Type /Catalog /Pages 2 0 R >>');
  agregar('PENDIENTE_PAGES');
  const fuente1 = agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fuente2 = agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const idsPaginas = [];
  for (const stream of paginas) {
    const contenido = agregar(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    idsPaginas.push(agregar(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Contents ${contenido} 0 R /Resources << /Font << /F1 ${fuente1} 0 R /F2 ${fuente2} 0 R >> >> >>`));
  }
  objetos[1] = `<< /Type /Pages /Kids [${idsPaginas.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsPaginas.length} >>`;

  let body = '%PDF-1.4\n';
  const offsets = [];
  objetos.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = body.length;
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { xref += `${String(off).padStart(10, '0')} 00000 n \n`; });
  body += `${xref}trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return { bytes: bytesLatin1(body), paginas: paginas.length, hojasQr };
}
