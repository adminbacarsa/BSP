import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
  agruparPaginas, asignarHoja, cuilDeNombreArchivo, formatearCuil, MOTIVOS_SIN_ASIGNAR, parsearQrMarco,
  payloadQrMarco, pendientesDeMarco, resumenLote,
} from './marcosLote.mjs';
import { matrizQr, streamQr } from './marcosLotePdf.mjs';
import { pdfMarcosLote } from './marcoPdf.mjs';
import { MARCO_VERSION } from './marcoAnexoConst.mjs';

const requireFunctions = createRequire(new URL('../../../../functions/package.json', import.meta.url));

const ana = '20111111119';
const luis = '20222222228';
const hoja = (id, archivo, pagina, qr) => ({ id, archivo, pagina, qr });

function rgbaDeMatriz(matriz, modulo = 4, margen = 4) {
  const lado = (matriz.size + margen * 2) * modulo;
  const data = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let fila = 0; fila < matriz.size; fila += 1) {
    for (let col = 0; col < matriz.size; col += 1) {
      if (!matriz.data[fila * matriz.size + col]) continue;
      for (let dy = 0; dy < modulo; dy += 1) {
        for (let dx = 0; dx < modulo; dx += 1) {
          const x = (col + margen) * modulo + dx;
          const y = (fila + margen) * modulo + dy;
          const i = (y * lado + x) * 4;
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: lado, height: lado };
}

describe('marcos en lote', () => {
  it('el QR va y vuelve con CUIL, empresa y versión', () => {
    const payload = payloadQrMarco({ bolsaCuil: '20-11111111-9', empresaId: 'bacarsa', marcoVersion: MARCO_VERSION });
    assert.deepEqual(parsearQrMarco(payload), { bolsaCuil: ana, empresaId: 'bacarsa', marcoVersion: MARCO_VERSION });
    assert.equal(parsearQrMarco('hola'), null);
    assert.equal(parsearQrMarco(JSON.stringify({ t: 'OTRO', bolsaCuil: ana })), null);
    assert.equal(parsearQrMarco(JSON.stringify({ t: 'COSP_MARCO', bolsaCuil: '123' })), null);

    const jsQR = requireFunctions('jsqr');
    const imagen = rgbaDeMatriz(matrizQr(payload));
    const leido = jsQR(imagen.data, imagen.width, imagen.height);
    assert.ok(leido, 'jsQR tiene que leer el QR generado con qrcode');
    assert.equal(leido.data, payload);
    assert.deepEqual(parsearQrMarco(leido.data), parsearQrMarco(payload));
  });

  it('saca el CUIL del nombre del archivo', () => {
    assert.equal(cuilDeNombreArchivo('Marco 20-11111111-9 Perez.pdf'), ana);
    assert.equal(cuilDeNombreArchivo('IMG_20111111119.jpg'), ana);
    assert.equal(cuilDeNombreArchivo('scan_0001.pdf'), '');
    assert.equal(cuilDeNombreArchivo('IMG_20260930_123456.jpg'), '');
    assert.equal(formatearCuil(ana), '20-11111111-9');
  });

  it('agrupa las hojas por persona: las hojas sin QR van con la siguiente hoja de firmas', () => {
    const qrAna = payloadQrMarco({ bolsaCuil: ana, empresaId: 'bacarsa' });
    const qrLuis = payloadQrMarco({ bolsaCuil: luis, empresaId: 'bacarsa' });
    const r = agruparPaginas({
      empresaId: 'bacarsa',
      cuilsEnBolsa: new Set([ana, luis]),
      paginas: [
        hoja('p1', 'lote.pdf', 1, null),
        hoja('p2', 'lote.pdf', 2, qrAna),
        hoja('p3', 'lote.pdf', 3, null),
        hoja('p4', 'lote.pdf', 4, null),
        hoja('p5', 'lote.pdf', 5, qrLuis),
      ],
    });
    assert.equal(r.reconocidos, 2);
    assert.deepEqual(r.grupos.find((g) => g.cuil === ana).paginas, ['p1', 'p2']);
    assert.deepEqual(r.grupos.find((g) => g.cuil === luis).paginas, ['p3', 'p4', 'p5']);
    assert.equal(r.sinAsignar.length, 0);
    assert.equal(resumenLote(r), '2 personas reconocidas (5 hojas)');
  });

  it('sin QR cae al CUIL del nombre del archivo; sin nada queda sin asignar', () => {
    const r = agruparPaginas({
      empresaId: 'bacarsa',
      cuilsEnBolsa: new Set([ana, luis]),
      paginas: [
        hoja('f1', 'foto 20-22222222-8.jpg', 1, null),
        hoja('s1', 'scan.pdf', 1, null),
        hoja('s2', 'scan.pdf', 2, payloadQrMarco({ bolsaCuil: ana, empresaId: 'bacarsa' })),
        hoja('s3', 'scan.pdf', 3, null),
        { ...hoja('s4', 'scan.pdf', 4, null), sinImagen: true },
        hoja('x1', 'otro 20-33333333-7.jpg', 1, null),
      ],
    });
    assert.deepEqual(r.grupos.find((g) => g.cuil === luis), { cuil: luis, paginas: ['f1'], fuente: 'ARCHIVO' });
    assert.deepEqual(r.grupos.find((g) => g.cuil === ana).paginas, ['s1', 's2']);
    assert.deepEqual(r.sinAsignar.map((h) => [h.id, h.motivo]), [['s3', 'SIN_QR'], ['s4', 'SIN_IMAGEN'], ['x1', 'NO_EN_BOLSA']]);
    assert.equal(resumenLote(r), '2 personas reconocidas (3 hojas) · 3 hojas sin asignar');
    assert.ok(MOTIVOS_SIN_ASIGNAR.SIN_QR);

    const manual = asignarHoja(r, 's3', ana);
    assert.deepEqual(manual.grupos.find((g) => g.cuil === ana).paginas, ['s1', 's2', 's3']);
    assert.equal(manual.sinAsignar.length, 2);
    const nuevo = asignarHoja(manual, 'x1', '20-44444444-6');
    assert.deepEqual(nuevo.grupos.find((g) => g.cuil === '20444444446'), { cuil: '20444444446', paginas: ['x1'], fuente: 'MANUAL' });
    assert.equal(asignarHoja(nuevo, 'no-existe', ana), nuevo);
  });

  it('un QR de otra empresa no se asigna', () => {
    const r = agruparPaginas({
      empresaId: 'bacarsa',
      paginas: [hoja('p1', 'a.pdf', 1, payloadQrMarco({ bolsaCuil: ana, empresaId: 'pruebas_sa' }))],
    });
    assert.equal(r.grupos.length, 0);
    assert.deepEqual(r.sinAsignar[0], { id: 'p1', archivo: 'a.pdf', pagina: 1, motivo: 'OTRA_EMPRESA', cuil: ana });
  });

  it('pendientes de marco: SIN_MARCO y VENCIDO de la empresa, no los vigentes', () => {
    const fichas = [
      { id: ana, empresasHabilitadas: ['bacarsa'], disponibilidad: 'DISPONIBLE', marcos: {} },
      { id: luis, empresasHabilitadas: ['bacarsa'], disponibilidad: 'DISPONIBLE', marcos: { bacarsa: { firmado: true, fechaFirma: '2024-01-01', vigenciaDias: 365 } } },
      { id: '3', empresasHabilitadas: ['bacarsa'], disponibilidad: 'DISPONIBLE', marcos: { bacarsa: { firmado: true, fechaFirma: '2026-09-01', vigenciaDias: 365 } } },
      { id: '4', empresasHabilitadas: ['pruebas_sa'], disponibilidad: 'DISPONIBLE', marcos: {} },
      { id: '5', empresasHabilitadas: ['bacarsa'], disponibilidad: 'NO_DISPONIBLE', marcos: {} },
    ];
    assert.deepEqual(pendientesDeMarco({ fichas, empresaId: 'bacarsa', hoy: '2026-10-01' }).map((f) => f.id), [ana, luis]);
  });

  it('el PDF trae dos ejemplares por persona, hoja de firmas con QR y CUIL impreso', async () => {
    const personas = [
      { cuil: ana, nombre: 'PEREZ, ANA', dni: '11111111', domicilio: 'Calle 1', telefono: '3515550000', mail: 'ana@ejemplo.com' },
      { cuil: luis, nombre: 'LOPEZ, LUIS', dni: '22222222', domicilio: 'Calle 2' },
    ];
    const empresa = { id: 'bacarsa', nombre: 'Bacar S.A.', cuit: '30-11111111-1', domicilio: 'Córdoba' };
    const out = await pdfMarcosLote({ empresa, personas, fecha: '2026-10-01' });
    assert.equal(out.hojasQr.length, personas.length * 2);
    assert.equal(out.hojasQr.filter((h) => h.cuil === ana).map((h) => h.ejemplar).join(','), '1,2');
    assert.ok(out.bytes.subarray(0, 5).toString() === '%PDF-');
    assert.equal(out.hojasQr.every((h) => parsearQrMarco(h.payload).bolsaCuil === h.cuil), true);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(out.bytes), disableWorker: true, isEvalSupported: false }).promise;
    assert.equal(doc.numPages, out.paginas);
    const trozos = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      trozos.push(content.items.map((item) => item.str).join(' '));
    }
    const texto = trozos.join('\n');
    assert.ok(texto.includes('CUIL 20-11111111-9'));
    assert.ok(texto.includes('CUIL 20-22222222-8'));
    assert.equal((texto.match(/Ejemplar 1 de 2/g) || []).length, 2);
    assert.equal((texto.match(/Ejemplar 2 de 2/g) || []).length, 2);
    assert.match(texto, /teléfono\s+3515550000/);
    assert.match(texto, /ana@ejemplo\.com/);
    assert.ok(texto.includes('Por el EMPLEADOR'));
    assert.ok(texto.includes('El TRABAJADOR'));
    const q = streamQr({ size: 2, data: [1, 0, 0, 1] }, 10, 20, 3);
    assert.equal(q, 'q 0 g\n10 23 3 3 re f\n13 20 3 3 re f\nQ');
    const vacio = await pdfMarcosLote({ empresa, personas: [] });
    assert.equal(vacio.paginas, 1);
  });
});
