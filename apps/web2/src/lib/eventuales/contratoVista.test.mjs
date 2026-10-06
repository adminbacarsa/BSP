import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enviosDelContrato, estadoAnexoVista, nombrePdfAnexo, nombrePdfMarco, resumirDispositivo, textoEnvioArca, textoEscalaYBruto, textoEstadoContrato, textoJornada, textoPeriodoContrato,
} from './contratoVista.mjs';

const contrato = {
  id: 'c1', empresaId: 'pruebas_sa', estado: 'CONFIRMADO', fechaAlta: '2026-10-02', fechaBaja: '2026-10-02',
  jornadas: [{ fecha: '2026-10-02', horaInicio: '12:00', horaFin: '20:00', horas: 8 }],
};

describe('ficha del eventual · solapa Contratos', () => {
  it('período, estado y jornadas en palabras', () => {
    assert.equal(textoPeriodoContrato(contrato), '02/10/2026');
    assert.equal(textoPeriodoContrato({ fechaAlta: '2026-10-02', fechaBaja: '2026-10-04' }), '02/10/2026 → 04/10/2026');
    assert.equal(textoEstadoContrato('CONFIRMADO'), 'Confirmado');
    assert.equal(textoEstadoContrato('ACUSE_RECIBIDO'), 'Acuse recibido');
    assert.equal(textoJornada(contrato.jornadas[0]), '02/10/2026 · 12:00–20:00 (8 h)');
  });

  it('estado del anexo: firmado con hora y dispositivo, pendiente con reenviar, sin canal, no exigido', () => {
    const firmado = estadoAnexoVista({ contrato: { ...contrato, anexoEstado: 'FIRMADO' }, anexo: { fechaHora: '2026-10-02T14:05:00.000Z', dispositivo: 'Android · app' } });
    assert.equal(firmado.texto, 'Firmado 02/10 11:05 (Android · app)');
    assert.equal(firmado.reenviar, false);
    assert.equal(firmado.firmado, true);
    const pend = estadoAnexoVista({ contrato: { ...contrato, anexoEstado: 'PENDIENTE' }, ahoraMs: Date.parse('2026-10-02T10:00:00Z') });
    assert.equal(pend.texto, 'Pendiente de firma');
    assert.equal(pend.reenviar, true);
    const vig = estadoAnexoVista({ contrato: { ...contrato, anexoEstado: 'PENDIENTE', codigoVenceMs: Date.parse('2026-10-02T12:30:00Z') }, ahoraMs: Date.parse('2026-10-02T10:00:00Z') });
    assert.equal(vig.texto, 'Pendiente de firma · código vigente hasta 02/10 09:30');
    const sinCanal = estadoAnexoVista({ contrato: { ...contrato, anexoEstado: 'SIN_CANAL' } });
    assert.match(sinCanal.texto, /sin mail ni app/);
    assert.equal(sinCanal.reenviar, true);
    assert.equal(estadoAnexoVista({ contrato, exigirMarco: false }).texto, 'No exigido');
    assert.equal(estadoAnexoVista({ contrato: { ...contrato, anexoEstado: 'NO_EXIGIDO' } }).texto, 'No exigido');
    assert.equal(estadoAnexoVista({ contrato: { ...contrato, estado: 'ANULADO' } }).reenviar, false);
    assert.equal(estadoAnexoVista({ contrato: { ...contrato, anexoEstado: 'SIN_EFECTO' } }).texto, 'Sin efecto');
  });

  it('escala aplicada y bruto: el anexo firmado manda; sin escala se dice', () => {
    const t = textoEscalaYBruto({ contrato, anexo: { escalaTexto: 'Disp. 120/2026 · v1', brutoTexto: '$ 85.000,00', escalaRespaldo: true } });
    assert.equal(t.escala, 'Disp. 120/2026 · v1');
    assert.equal(t.bruto, 'Bruto $ 85.000,00');
    assert.match(t.aviso, /respaldo/);
    const sin = textoEscalaYBruto({ contrato });
    assert.match(sin.escala, /Sin escala aprobada/);
    assert.equal(sin.bruto, '');
    assert.equal(textoEscalaYBruto({ contrato: { ...contrato, anexoEscalaTexto: 'Acuerdo 305/26', anexoBrutoTexto: '$ 1' } }).bruto, 'Bruto $ 1');
  });

  it('ARCA del contrato: AT con estado y nº, constancia, anulación y baja', () => {
    const arca = [
      { id: 'a1', tipo: 'AT', estado: 'CONFIRMADO', nroTransaccion: '12345', constanciaUrl: 'https://x/c.pdf', fechaAlta: '2026-10-02', contratoIds: ['c1'] },
      { id: 'a2', tipo: 'ANULACION', estado: 'PENDIENTE', fechaAlta: '2026-10-02', contratoIds: ['c1'] },
      { id: 'a3', tipo: 'AT', estado: 'ENVIADO', nroTransaccion: '999', contratoIds: ['otro'] },
      { id: 'a4', tipo: 'BAJA_NO_PRESENTACION', estado: 'MANUAL', fechaBaja: '2026-10-02', contratoIds: ['c1'], quitadoDelLote: true },
    ];
    const lista = enviosDelContrato(arca, 'c1');
    assert.deepEqual(lista.map((e) => e.id), ['a1', 'a2', 'a4']);
    assert.equal(lista[0].tipo, 'Alta (AT)');
    assert.equal(lista[0].estado, 'Confirmado · nº 12345');
    assert.equal(lista[0].tono, 'ok');
    assert.equal(lista[0].constanciaUrl, 'https://x/c.pdf');
    assert.equal(lista[1].tipo, 'Anulación del alta');
    assert.equal(lista[1].estado, 'Pendiente');
    assert.equal(lista[2].tipo, 'Baja por no presentación');
    assert.equal(lista[2].estado, 'Manual · fuera del lote');
    assert.equal(lista[2].tono, 'malo');
    assert.equal(textoEnvioArca({ tipo: 'AT', estado: 'VERIFICAR', nroTransaccion: '7' }).estado, 'A verificar · nº 7');
    assert.equal(textoEnvioArca({ tipo: 'AT', estado: 'ANULADO' }).tono, 'neutro');
  });

  it('el dispositivo de la constancia es corto: lo que manda la app o un resumen del user-agent', () => {
    assert.equal(resumirDispositivo('Samsung A52 · app 1.4'), 'Samsung A52 · app 1.4');
    assert.equal(resumirDispositivo('', 'okhttp/4.9.2 Android'), 'app Android');
    assert.equal(resumirDispositivo('', 'COSP/12 CFNetwork/1404 Darwin/22.1.0'), 'app iPhone');
    assert.equal(resumirDispositivo(null, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari'), 'navegador iPhone');
    assert.equal(resumirDispositivo(null, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'), 'navegador');
    assert.equal(resumirDispositivo(null, ''), '');
  });

  it('nombres de los PDF', () => {
    assert.equal(nombrePdfAnexo({ empresa: 'Pruebas sa.', fecha: '2026-10-02', firmado: true }), 'Anexo-Pruebas-sa-2026-10-02.pdf');
    assert.equal(nombrePdfAnexo({ empresa: 'Pruebas sa.', fecha: '2026-10-02', firmado: false }), 'Anexo-Pruebas-sa-2026-10-02-SIN-FIRMAR.pdf');
    assert.equal(nombrePdfMarco({ empresa: 'Bacar S.A.', fecha: '2026-09-01' }), 'Marco-Bacar-S-A-2026-09-01.pdf');
  });
});
