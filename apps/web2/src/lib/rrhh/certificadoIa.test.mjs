import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compararCertificado,
  cuentaComoFaltaSinAviso,
  decidirCertificado,
  lecturaLimpia,
  parseRespuestaGemini,
  nombreArchivoCertificado,
  nombreCarpetaLegajo,
} from './certificadoIa.mjs';

const lecturaOk = {
  fechaEmision: '2026-10-07',
  medico: 'Gomez',
  matricula: '1234',
  reposoDesde: '2026-10-07',
  reposoHasta: '2026-10-08',
  tipo: 'enfermedad',
  firmaVisible: true,
  selloVisible: false,
  legible: true,
  nombre: 'CARDO ANALIA',
  dni: '30111222',
  confianza: { tipo: 0.95, reposoDesde: 0.95, reposoHasta: 0.95, medico: 0.9, matricula: 0.9, legible: 1, firmaVisible: 1 },
};

const ausencia = {
  employeeName: 'CARDO Analia Veronica',
  dni: '30111222',
  startDate: '2026-10-07',
  endDate: '2026-10-08',
};

test('la lectura descarta el diagnóstico', () => {
  const limpia = lecturaLimpia({ ...lecturaOk, diagnostico: 'gastroenteritis', textoClinico: 'dolor' });
  assert.equal('diagnostico' in limpia, false);
  assert.equal('textoClinico' in limpia, false);
  assert.equal(limpia.medico, 'Gomez');
  assert.equal(limpia.tipo, 'enfermedad');
});

test('el mock de Gemini no deja pasar el diagnóstico', () => {
  const crudo = '```json\n{"medico":"Gomez","tipo":"enfermedad","diagnostico":"gastroenteritis","reposoDesde":"2026-10-07","reposoHasta":"2026-10-08","firmaVisible":true,"selloVisible":true,"legible":true,"confianza":{"tipo":0.95,"reposoDesde":0.95,"reposoHasta":0.95}}\n```';
  const limpia = parseRespuestaGemini(crudo);
  assert.equal('diagnostico' in limpia, false);
  assert.equal(limpia.medico, 'Gomez');
  assert.equal(limpia.tipo, 'enfermedad');
  assert.deepEqual(parseRespuestaGemini('no es json'), lecturaLimpia({}));
});

test('propuesta no toca la ausencia', () => {
  const cmp = compararCertificado(ausencia, lecturaLimpia(lecturaOk));
  const decision = decidirCertificado({ modo: 'PROPUESTA', lectura: lecturaOk, comparacion: cmp, esEventual: false });
  assert.equal(decision.accion, 'PROPUESTA');
  assert.equal(decision.tocaAusencia, false);
  assert.match(decision.texto, /Justificar como E · 2 días · Dr\. Gomez MP 1234/);
});

test('automático justifica si coincide', () => {
  const cmp = compararCertificado(ausencia, lecturaLimpia(lecturaOk));
  const decision = decidirCertificado({ modo: 'AUTOMATICO', lectura: lecturaOk, comparacion: cmp, esEventual: false });
  assert.equal(decision.accion, 'JUSTIFICAR');
  assert.equal(decision.justificadaPor, 'IA');
  assert.equal(decision.ajustarRango, false);
  assert.equal(decision.code, 'E');
});

test('automático ajusta el rango si el reposo difiere y no hay otras dudas', () => {
  const lectura = { ...lecturaOk, reposoDesde: '2026-10-07', reposoHasta: '2026-10-09' };
  const cmp = compararCertificado(ausencia, lecturaLimpia(lectura));
  assert.equal(cmp.rangoDifiere, true);
  assert.equal(cmp.confianzaAlta, true);
  const decision = decidirCertificado({ modo: 'AUTOMATICO', lectura, comparacion: cmp, esEventual: false });
  assert.equal(decision.accion, 'JUSTIFICAR');
  assert.equal(decision.ajustarRango, true);
  assert.equal(decision.reposoHasta, '2026-10-09');
});

test('con dudas no toca nada, ni en automático', () => {
  const lectura = { ...lecturaOk, legible: false, firmaVisible: false, selloVisible: false };
  const cmp = compararCertificado(ausencia, lecturaLimpia(lectura));
  assert.equal(cmp.confianzaAlta, false);
  const decision = decidirCertificado({ modo: 'AUTOMATICO', lectura, comparacion: cmp, esEventual: false });
  assert.equal(decision.accion, 'DUDA');
  assert.equal(decision.tocaAusencia, false);
});

test('el eventual no se justifica con E/L/A', () => {
  const cmp = compararCertificado(ausencia, lecturaLimpia(lecturaOk));
  const decision = decidirCertificado({ modo: 'AUTOMATICO', lectura: lecturaOk, comparacion: cmp, esEventual: true });
  assert.equal(decision.accion, 'RECIBIDO');
  assert.equal(decision.texto, 'Certificado recibido');
  assert.equal(decision.paga, false);
  assert.equal(decision.tocaAusencia, false);
});

test('la persona que no coincide es una duda', () => {
  const cmp = compararCertificado({ ...ausencia, employeeName: 'LOPEZ Juan', dni: '20999888' }, lecturaLimpia(lecturaOk));
  assert.equal(cmp.coincidePersona, false);
  assert.ok(cmp.dudas.includes('No coincide la persona'));
});

test('carpeta y archivo del legajo', () => {
  assert.equal(
    nombreCarpetaLegajo({ apellido: 'CARDO', nombre: 'Analia', cuil: '27-30111222-4', legajo: '1402' }),
    'CARDO Analia · 27301112224 · Legajo 1402',
  );
  assert.equal(
    nombreArchivoCertificado({ fecha: '2026-10-07', tipo: 'Enfermedad', desde: '2026-10-07', hasta: '2026-10-08', ext: 'pdf' }),
    '2026-10-07 · Enfermedad · 2026-10-07–2026-10-08.pdf',
  );
});

test('falta con aviso o certificado no es falta sin aviso', () => {
  assert.equal(cuentaComoFaltaSinAviso({ esEventual: true, code: 'AA', conAviso: true }), false);
  assert.equal(cuentaComoFaltaSinAviso({ esEventual: true, code: 'AA', conCertificado: true }), false);
  assert.equal(cuentaComoFaltaSinAviso({ esEventual: true, code: 'AA' }), true);
  assert.equal(cuentaComoFaltaSinAviso({ esEventual: false, code: 'E' }), false);
  assert.equal(cuentaComoFaltaSinAviso({ esEventual: false, code: 'AA' }), true);
});
