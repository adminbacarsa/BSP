/**
 * Estados, lectura y certificado de «Mis novedades» para nómina y eventual.
 * Importa el archivo, no el barrel de portal-core.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clavesDeLectura,
  estadoNovedadEnPalabras,
  historialVisible,
  ordenarNovedades,
  puedeSubirCertificado,
  rangoDias,
} from '../../../../packages/portal-core/src/absences/misNovedades.ts';

test('estado registrada mientras RRHH revisa', () => {
  assert.equal(
    estadoNovedadEnPalabras({ status: 'Avisada', type: 'Ausencia con aviso', revisionEstado: 'POR_REVISAR' }),
    'Registrada · RRHH revisando',
  );
});

test('estado justificada nombra el tipo', () => {
  assert.equal(
    estadoNovedadEnPalabras({ status: 'Justificada', type: 'Enfermedad' }),
    'Justificada (Enfermedad)',
  );
});

test('injustificada por estado o por revision', () => {
  assert.equal(estadoNovedadEnPalabras({ status: 'Avisada', revisionEstado: 'INJUSTIFICADA' }), 'Injustificada');
  assert.equal(estadoNovedadEnPalabras({ status: 'Injustificada' }), 'Injustificada');
});

test('falta certificado en enfermedad sin archivo', () => {
  assert.equal(estadoNovedadEnPalabras({ status: 'Pendiente', type: 'Enfermedad' }), 'Falta certificado');
});

test('el eventual ve certificado recibido y no una licencia', () => {
  assert.equal(
    estadoNovedadEnPalabras({ status: 'Avisada', type: 'Ausencia con aviso', certificadoIa: { decision: 'RECIBIDO' } }),
    'Certificado recibido',
  );
});

test('certificado en verificacion', () => {
  assert.equal(
    estadoNovedadEnPalabras({ status: 'En verificación', type: 'Enfermedad', hasCertificate: true }),
    'Certificado en verificación',
  );
});

test('subir certificado si falta o sigue en verificacion', () => {
  assert.equal(puedeSubirCertificado({ status: 'Avisada', type: 'Ausencia con aviso' }), true);
  assert.equal(puedeSubirCertificado({ status: 'En verificación', hasCertificate: true }), true);
  assert.equal(puedeSubirCertificado({ status: 'Justificada', type: 'Enfermedad', hasCertificate: true }), false);
  assert.equal(puedeSubirCertificado({ status: 'Rechazada' }), false);
});

test('el historial no muestra codigos internos', () => {
  const lineas = historialVisible({
    status: 'Justificada',
    type: 'Enfermedad',
    historial: [
      { texto: 'Registrada · RRHH revisando', por: 'Ana', at: '2026-10-07T12:00:00.000Z' },
      { texto: 'revisionEstado POR_REVISAR ausenciaId x', por: 'sistema', at: '2026-10-07T12:00:00.000Z' },
      { texto: 'Justificada (Enfermedad)', por: 'RRHH', at: '2026-10-07T15:00:00.000Z' },
    ],
  });
  assert.equal(lineas.length, 2);
  assert.equal(lineas[1]?.por, 'RRHH');
});

test('mas nuevas primero', () => {
  const orden = ordenarNovedades([
    { id: 'vieja', createdAt: '2026-10-01T10:00:00.000Z' },
    { id: 'nueva', createdAt: { seconds: Math.floor(Date.parse('2026-10-07T10:00:00.000Z') / 1000) } },
  ]);
  assert.equal(orden[0]?.id, 'nueva');
});

test('rango de dias en dd/mm/aaaa', () => {
  assert.equal(rangoDias({ startDate: '2026-10-07', endDate: '2026-10-09' }), '07/10/2026 → 09/10/2026');
  assert.equal(rangoDias({ startDate: '2026-10-07', endDate: '2026-10-07' }), '07/10/2026');
});

test('guardia consulta uid y legajo', () => {
  const claves = clavesDeLectura({ uid: 'auth1', empDocId: 'leg1', preview: false });
  assert.deepEqual(claves.employeeIds, ['auth1', 'leg1']);
  assert.equal(claves.bolsaCuil, null);
});

test('eventual consulta sus legajos y el cuil', () => {
  const claves = clavesDeLectura({
    uid: 'authE',
    empDocId: 'legA',
    legajoIds: ['legA', 'legB'],
    bolsaCuil: '20-11111111-2',
  });
  assert.deepEqual(claves.employeeIds, ['authE', 'legA', 'legB']);
  assert.equal(claves.bolsaCuil, '20111111112');
});

test('vista previa no consulta el uid del superadmin', () => {
  const claves = clavesDeLectura({
    uid: 'adminUid',
    empDocId: 'legG',
    bolsaCuil: '20111111112',
    preview: true,
  });
  assert.deepEqual(claves.employeeIds, ['legG']);
  assert.equal(claves.bolsaCuil, '20111111112');
  assert.equal(claves.employeeIds.includes('adminUid'), false);
});
