import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canalCodigo, CUENTA_DRIVE_EVENTUALES, datosTrabajador, destinoGuardado, DRIVE_ROOT_EVENTUALES_DEFAULT, hashCodigo,
  MENSAJE_SIN_CANAL, mensajeEnvioCodigo,
  MOTIVO_SIN_MARCO, nombreArchivo, nombreCarpetaPersona, planCarpetaEventuales, planConfirmarAnexo, planMarco,
  planRenombre, sha256, textoMarco,
} from './marcoAnexo.mjs';
import { parsearQrMarco } from './marcosLote.mjs';
import { pdfAnexo, pdfMarco } from './marcoPdf.mjs';

async function extraerPdf(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, isEvalSupported: false }).promise;
  const partes = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    partes.push(content.items.map((item) => item.str).join(' '));
  }
  return partes.join('\n');
}

const hoy = '2026-10-01';

describe('contrato marco y anexo', () => {
  it('el marco dura un año, avisa a los 30 días y vence', () => {
    const vigente = planMarco({ firmado: true, fechaFirma: '2026-09-10', hoy });
    assert.equal(vigente.estado, 'MARCO_VIGENTE');
    assert.equal(vigente.vencimiento, '2027-09-10');
    assert.equal(vigente.avisar, false);
    assert.equal(planMarco({ firmado: true, fechaFirma: '2025-10-20', hoy }).avisar, true);
    assert.equal(planMarco({ firmado: true, fechaFirma: '2025-09-01', hoy }).estado, 'VENCIDO');
    assert.equal(planMarco({ firmado: false, hoy }).estado, 'SIN_MARCO');
  });

  // «Sin marco vigente no es candidato» vive en candidatosUnificados.test.mjs (motor único `eventualesParaHueco`).

  it('el PDF del marco trae las 12 cláusulas, con acentos, y los datos de las partes', async () => {
    const datos = {
      empresaId: 'nandu',
      empresaNombre: 'Transporte del Ñandú S.A.',
      empresaCuit: '30668134978',
      empresaDomicilio: 'Santiago del Estero 263, Córdoba',
      trabajadorNombre: 'PÉREZ, Juan',
      trabajadorDni: '30123456',
      trabajadorCuil: '20301234567',
      trabajadorDomicilio: 'Calle Ñuñoa 12',
      telefono: '3515550000',
      mail: 'juan@ejemplo.com',
      fecha: '2026-10-01',
    };
    const texto = textoMarco(datos);
    for (const titulo of ['PRIMERA – Naturaleza.', 'SEGUNDA – Causa.', 'TERCERA – Jornadas.', 'CUARTA – Remuneración.', 'QUINTA – Obligaciones.', 'SEXTA – Instrucciones.', 'SÉPTIMA – Normas internas.', 'OCTAVA – Registración.', 'NOVENA – Anexos por convocatoria.', 'DÉCIMA – Medios digitales.', 'UNDÉCIMA – Vigencia.', 'DUODÉCIMA – Domicilios y jurisdicción.']) {
      assert.ok(texto.includes(titulo), titulo);
    }
    assert.match(texto, /arts\. 99, 100/);
    assert.match(texto, /conformidad expresa/);
    assert.match(texto, /Transporte del Ñandú S\.A\./);
    assert.match(texto, /Calle Ñuñoa 12/);
    assert.match(texto, /3515550000/);
    const pdf = await pdfMarco(datos);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(sha256(pdf.bytes).length, 64);
    const extraido = await extraerPdf(pdf.bytes);
    assert.match(extraido, /Ñandú/);
    assert.match(extraido, /Ñuñoa/);
    assert.match(extraido, /jurisdicción/);
    assert.match(extraido, /PÉREZ/);
    assert.match(extraido, /DUODÉCIMA/);
    assert.match(extraido, /30-66813497-8/);
    assert.match(extraido, /20-30123456-7/);
    assert.match(extraido, /teléfono\s+3515550000/);
    assert.match(extraido, /correo electrónico\s+juan@ejemplo\.com/);
    assert.doesNotMatch(extraido, /teléfono\s+—/);
    assert.equal(parsearQrMarco(pdf.payload).bolsaCuil, '20301234567');
    assert.equal(pdf.payload.includes('20-30123456-7'), false);
    assert.match(extraido, /Plantilla marco v/);
    const anexo = await pdfAnexo({
      numero: '000123',
      empresaNombre: 'Transporte del Ñandú S.A.',
      empresaCuit: '30668134978',
      trabajadorNombre: 'PÉREZ, Juan',
      trabajadorDni: '30123456',
      trabajadorCuil: '20301234567',
      marcoFecha: '2026-10-01',
      marcoVencimiento: '2027-10-01',
      causa: 'evento extraordinario',
      lugar: 'Estadio Mario A. Kempes, Av. Cárcano s/n',
      jornadas: [{ fecha: '2026-10-10', horaInicio: '21:00', horaFin: '03:00', horas: 6, observacion: '6 h nocturnas' }],
      bruto: '$ 120.000',
      constancia: { numero: '000123', marcoFecha: '2026-10-01', trabajadorNombre: 'PÉREZ, Juan', cuil: '20301234567', hashAnexo: 'abc123', codigoVerificado: true, fechaHora: '2026-10-08T20:45:03.000Z' },
    });
    const anexoTexto = await extraerPdf(anexo.bytes);
    assert.match(anexoTexto, /ANEXO N/);
    assert.match(anexoTexto, /Cárcano/);
    assert.match(anexoTexto, /CONSTANCIA DE ACEPTACIÓN ELECTRÓNICA/);
    assert.match(anexoTexto, /Modalidad\s+012/);
    assert.match(anexoTexto, /30-66813497-8/);
    assert.match(anexoTexto, /20-30123456-7/);
    const deBolsa = datosTrabajador({ nombre: 'PÉREZ, Juan', dni: '30123456', domicilio: 'Calle 1', localidad: 'Córdoba', telefono: '3515550000', mail: 'juan@ejemplo.com' }, '20-30123456-7');
    assert.equal(deBolsa.telefono, '3515550000');
    assert.equal(deBolsa.mail, 'juan@ejemplo.com');
    assert.equal(deBolsa.trabajadorCuil, '20301234567');
    assert.match(textoMarco({ ...datos, ...deBolsa, trabajadorCuil: deBolsa.trabajadorCuil }), /teléfono 3515550000/);
    assert.equal(DRIVE_ROOT_EVENTUALES_DEFAULT, '1zjzDGcAbavPaJJS5jObA0syu1SsDCakq');
    assert.equal(CUENTA_DRIVE_EVENTUALES, 'comtroldata@appspot.gserviceaccount.com');
    assert.equal(nombreCarpetaPersona({ cuil: '20999999991', nombre: 'PEREZ, JUAN' }), '20999999991 - PEREZ, JUAN');
    assert.equal(nombreCarpetaPersona({ cuil: '20999999991', nombre: 'PEREZ, JUAN', legajo: '1402' }), 'Legajo 1402 - PEREZ, JUAN - 20999999991');
    assert.equal(planRenombre('20999999991 - PEREZ, JUAN', 'Legajo 1402 - PEREZ, JUAN - 20999999991').renombrar, true);
    assert.equal(planCarpetaEventuales('Eventuales').usarRaiz, true);
    assert.equal(planCarpetaEventuales(' eventuales ').usarRaiz, true);
    assert.equal(planCarpetaEventuales('Backups COSP').usarRaiz, false);
    assert.equal(nombreArchivo({ tipo: 'MARCO', fecha: '2026-10-01', empresa: 'Bacar' }), 'Bacar-Marco-2026-10-01.pdf');
    assert.equal(nombreArchivo({ tipo: 'ANEXO', fecha: '2026-10-05', lugar: 'Peaje', empresa: 'Bacar' }), 'Bacar-Anexo-2026-10-05-Peaje.pdf');
    assert.equal(nombreArchivo({ tipo: 'ARCA', fecha: '2026-10-05', empresa: 'Bacar' }), 'Bacar-ARCA-2026-10-05.pdf');
    assert.equal(destinoGuardado(''), 'STORAGE');
    assert.equal(destinoGuardado('folder-1'), 'DRIVE');
  });

  it('el código del anexo es de un solo uso y no usa OTP de teléfono', () => {
    const salt = 's';
    const hash = hashCodigo('123456', salt);
    const ahora = 1_000;
    assert.equal(planConfirmarAnexo({ codigo: '123456', salt, hash, usado: false, venceMs: 2_000, ahoraMs: ahora }).ok, true);
    assert.equal(planConfirmarAnexo({ codigo: '000000', salt, hash, usado: false, venceMs: 2_000, ahoraMs: ahora }).codigo, 'CODIGO_INVALIDO');
    assert.equal(planConfirmarAnexo({ codigo: '123456', salt, hash, usado: true, venceMs: 2_000, ahoraMs: ahora }).codigo, 'CODIGO_USADO');
    assert.equal(planConfirmarAnexo({ codigo: '123456', salt, hash, usado: false, venceMs: 500, ahoraMs: ahora }).codigo, 'CODIGO_VENCIDO');
    const ambos = canalCodigo({ mail: 'ana.perez@bacar.com.ar', tienePush: true });
    assert.deepEqual(ambos.canales, ['PUSH', 'MAIL']);
    assert.equal(ambos.mensaje, 'Te enviamos un código de 6 dígitos a tu app y a tu mail terminado en bacar.com.ar.');
    assert.equal(canalCodigo({ mail: 'ana.perez@bacar.com.ar', tienePush: false }).canales.join(','), 'MAIL');
    assert.equal(canalCodigo({ mail: '', tienePush: true }).mensaje, 'Te enviamos un código de 6 dígitos a tu app.');
    const vacio = canalCodigo({ mail: '', tienePush: false });
    assert.equal(vacio.codigo, 'SIN_CANAL');
    assert.equal(vacio.mensaje, MENSAJE_SIN_CANAL);
    assert.equal(mensajeEnvioCodigo({ canales: [], mail: '' }), MENSAJE_SIN_CANAL);
    assert.equal(JSON.stringify(ambos).includes('WHATSAPP'), false);
  });
});
