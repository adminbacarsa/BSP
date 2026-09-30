/**
 * QR ida y vuelta del lote de marcos, con el mismo código del servidor:
 * hoja de firmas (qrcode) → JPEG "escaneado" → PDF de varias hojas → extraerImagenesDePdf → leerQr → agruparPaginas.
 * Uso: npm run eval:marcos-lote
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as zlib from 'node:zlib';
import { extraerImagenesDePdf } from '../apps/functions/src/marcosLote/imagenesPdf';
import { aJpeg, decodificarImagen, infoJpeg, leerQr } from '../apps/functions/src/marcosLote/leerQr';
import { pdfDeJpegs } from '../apps/functions/src/marcosLote/pdfDeJpegs';

const requireWeb = createRequire(new URL('../apps/web2/package.json', import.meta.url));
const lote = await import('../apps/web2/src/lib/eventuales/marcosLote.mjs');
const pdfLib = await import('../apps/web2/src/lib/eventuales/marcosLotePdf.mjs');
const QRCode = requireWeb('qrcode');

const ana = '20111111119';
const luis = '20222222228';

/** Hoja A4 "escaneada" a ~100 dpi: blanco, ruido suave, texto simulado y el QR abajo a la derecha. */
function hojaEscaneada(payload: string | null, ancho = 826, alto = 1169) {
  const data = new Uint8ClampedArray(ancho * alto * 4);
  for (let i = 0; i < ancho * alto; i += 1) {
    const v = 235 + Math.floor(Math.random() * 20);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  for (let fila = 0; fila < 40; fila += 1) {
    const y = 80 + fila * 22;
    for (let x = 80; x < ancho - 80; x += 1) {
      if (Math.random() < 0.6) { const i = (y * ancho + x) * 4; data[i] = 40; data[i + 1] = 40; data[i + 2] = 40; }
    }
  }
  if (payload) {
    const q = QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules;
    const modulo = 5;
    const lado = q.size * modulo;
    const x0 = ancho - 70 - lado;
    const y0 = alto - 170 - lado;
    for (let f = 0; f < q.size; f += 1) {
      for (let c = 0; c < q.size; c += 1) {
        const negro = q.data[f * q.size + c];
        for (let dy = 0; dy < modulo; dy += 1) {
          for (let dx = 0; dx < modulo; dx += 1) {
            const i = ((y0 + f * modulo + dy) * ancho + (x0 + c * modulo + dx)) * 4;
            const v = negro ? 15 : 250;
            data[i] = v; data[i + 1] = v; data[i + 2] = v;
          }
        }
      }
    }
    for (let y = y0 - modulo * 4; y < y0 + lado + modulo * 4; y += 1) {
      for (let x = x0 - modulo * 4; x < x0 + lado + modulo * 4; x += 1) {
        const dentro = y >= y0 && y < y0 + lado && x >= x0 && x < x0 + lado;
        if (!dentro) { const i = (y * ancho + x) * 4; data[i] = 250; data[i + 1] = 250; data[i + 2] = 250; }
      }
    }
  }
  return { data, width: ancho, height: alto };
}

const qrAna = lote.payloadQrMarco({ bolsaCuil: ana, empresaId: 'bacarsa' });
const qrLuis = lote.payloadQrMarco({ bolsaCuil: luis, empresaId: 'bacarsa' });

// 1) La hoja de firmas impresa (vector) trae el payload correcto
const impreso = pdfLib.pdfMarcosLote({
  empresa: { id: 'bacarsa', nombre: 'Bacar S.A.', cuit: '30-11111111-1', domicilio: 'Córdoba' },
  personas: [{ cuil: ana, nombre: 'PEREZ, ANA', dni: '11111111', domicilio: 'Calle 1' }],
  fecha: '2026-10-01',
});
assert.equal(impreso.hojasQr.length, 2);
assert.deepEqual(lote.parsearQrMarco(impreso.hojasQr[0].payload), { bolsaCuil: ana, empresaId: 'bacarsa', marcoVersion: 1 });

// 2) Escaneo: 5 hojas (texto, firmas Ana, texto, texto, firmas Luis) en un PDF con JPEG (DCTDecode)
const hojas = [null, qrAna, null, null, qrLuis].map((p) => hojaEscaneada(p));
const jpegs = hojas.map((h) => { const jpeg = aJpeg(h, 80); const info = infoJpeg(jpeg)!; return { jpeg, ...info }; });
assert.equal(jpegs[0].width, 826);
const pdfEscaneado = pdfDeJpegs(jpegs);
assert.ok(pdfEscaneado.toString('latin1').startsWith('%PDF-1.4'));

const imagenes = extraerImagenesDePdf(pdfEscaneado);
assert.equal(imagenes.length, 5, 'una imagen por hoja');
assert.ok(imagenes.every((i) => i.legible && i.jpeg));
const paginas = imagenes.map((img, i) => {
  const rgba = decodificarImagen(img.jpeg!)!;
  return { id: `lote_p${i + 1}`, archivo: 'lote.pdf', pagina: i + 1, qr: leerQr(rgba) };
});
assert.deepEqual(paginas.map((p) => p.qr), [null, qrAna, null, null, qrLuis], 'el QR se lee en las hojas de firmas y no en las de texto');

const agrupado = lote.agruparPaginas({ paginas, empresaId: 'bacarsa', cuilsEnBolsa: new Set([ana, luis]) });
assert.equal(agrupado.reconocidos, 2);
assert.deepEqual(agrupado.grupos.map((g) => [g.cuil, g.paginas]), [[ana, ['lote_p1', 'lote_p2']], [luis, ['lote_p3', 'lote_p4', 'lote_p5']]]);
assert.equal(agrupado.sinAsignar.length, 0);

// 3) PDF con imagen FlateDecode RGB + predictor PNG (escáner que no usa JPEG)
function pdfFlate(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const rowLen = img.width * 3;
  const raw = Buffer.alloc((rowLen + 1) * img.height);
  for (let y = 0; y < img.height; y += 1) {
    raw[y * (rowLen + 1)] = 0;
    for (let x = 0; x < img.width; x += 1) {
      const si = (y * img.width + x) * 4;
      const di = y * (rowLen + 1) + 1 + x * 3;
      raw[di] = img.data[si]; raw[di + 1] = img.data[si + 1]; raw[di + 2] = img.data[si + 2];
    }
  }
  const comprimido = zlib.deflateSync(raw);
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /Columns ${img.width} >> /Length 6 0 R >>\nstream\n`, 'latin1'), comprimido, Buffer.from('\nendstream', 'latin1')]),
    '<< /Length 35 >>\nstream\nq 595 0 0 842 0 0 cm /Im1 Do Q\nendstream',
    `${comprimido.length}`,
  ];
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  objs.forEach((o, i) => { partes.push(Buffer.from(`${i + 1} 0 obj\n`, 'latin1')); partes.push(typeof o === 'string' ? Buffer.from(o, 'latin1') : o); partes.push(Buffer.from('\nendobj\n', 'latin1')); });
  partes.push(Buffer.from('trailer << /Root 1 0 R >>\n%%EOF', 'latin1'));
  return Buffer.concat(partes);
}
const hojaFlate = hojaEscaneada(qrLuis, 600, 850);
const imgsFlate = extraerImagenesDePdf(pdfFlate(hojaFlate));
assert.equal(imgsFlate.length, 1);
assert.equal(imgsFlate[0].filtro, 'FlateDecode');
assert.ok(imgsFlate[0].rgba, 'la imagen Flate se decodifica a píxeles');
assert.equal(leerQr(imgsFlate[0].rgba!), qrLuis);

// 4) Foto JPG suelta sin QR legible → cae al CUIL del nombre del archivo
const foto = aJpeg(hojaEscaneada(null, 600, 850), 70);
const sinQr = leerQr(decodificarImagen(foto)!);
assert.equal(sinQr, null);
const porNombre = lote.agruparPaginas({
  paginas: [{ id: 'f1', archivo: 'marco 20-22222222-8.jpg', pagina: 1, qr: sinQr }, { id: 'f2', archivo: 'IMG_0001.jpg', pagina: 1, qr: null }],
  empresaId: 'bacarsa',
  cuilsEnBolsa: new Set([ana, luis]),
});
assert.deepEqual(porNombre.grupos, [{ cuil: luis, paginas: ['f1'], fuente: 'ARCHIVO' }]);
assert.deepEqual(porNombre.sinAsignar.map((h) => h.motivo), ['SIN_QR']);

console.log('OK eval-marcos-lote-qr: impresión, escaneo DCT (5 hojas → 2 personas), Flate+predictor, foto sin QR por nombre de archivo');
