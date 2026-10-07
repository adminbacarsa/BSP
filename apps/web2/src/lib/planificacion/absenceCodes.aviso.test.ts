import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isActiveAbsence } from './absenceCodes';
import {
  esPorRevisar,
  esVacacionesDeAviso,
  patchActivacionAviso,
} from '../rrhh/avisoPortal.mjs';
import { estadoModulo } from '../movil/menuLayout';

const aviso = {
  source: 'EMPLEADO',
  type: 'Ausencia con aviso',
  status: 'Pendiente',
  reason: 'Me duele la panza',
};

test('el aviso del portal pendiente ya es ausencia activa', () => {
  assert.equal(isActiveAbsence(aviso), true);
  assert.equal(isActiveAbsence({ ...aviso, status: 'Avisada' }), true);
  assert.equal(isActiveAbsence({ ...aviso, status: 'Rechazada' }), false);
});

test('unas vacaciones pendientes no se activan solas', () => {
  assert.equal(isActiveAbsence({ source: 'EMPLEADO', type: 'Vacaciones', status: 'Pendiente' }), false);
  assert.equal(isActiveAbsence({ type: 'Llegada Tarde', status: 'Confirmada', absenceType: 'LT' }), false);
});

test('la revisión es aparte del ausente', () => {
  assert.equal(esPorRevisar(aviso), true);
  assert.equal(esPorRevisar({ ...aviso, status: 'Avisada', revisionEstado: 'POR_REVISAR' }), true);
  assert.equal(esPorRevisar({ type: 'Enfermedad', status: 'En verificación' }), true);
  assert.equal(esPorRevisar({ ...aviso, status: 'Avisada', revisionEstado: 'JUSTIFICADA' }), false);
  assert.equal(esPorRevisar({ ...aviso, status: 'Avisada', revisionEstado: 'INJUSTIFICADA' }), false);
});

test('vacaciones del mismo día con turno son un aviso mal tipado', () => {
  assert.equal(esVacacionesDeAviso({
    source: 'EMPLEADO', type: 'Vacaciones', absenceCase: 'CORTO_PLAZO', shiftId: 'turno1',
  }), true);
  assert.equal(esVacacionesDeAviso({
    source: 'EMPLEADO', type: 'Vacaciones', absenceCase: 'PROGRAMADA',
  }), false);
  const patch = patchActivacionAviso(aviso);
  assert.equal(patch?.status, 'Avisada');
  assert.equal(patch?.type, 'Ausencia con aviso');
  assert.equal(patch?.absenceType, 'AA');
});

test('el menú de RRHH cuenta lo que hay por revisar', () => {
  assert.deepEqual(estadoModulo('rrhh', { ausentesHoy: 1, porRevisar: 2 }), {
    texto: '2 por revisar · 1 ausencia hoy',
    tono: 'ambar',
  });
  assert.equal(estadoModulo('rrhh', { ausentesHoy: 0 })?.texto, 'Sin ausencias hoy');
});

test('la lógica del aviso es la misma en el servidor', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
  const web = readFileSync(path.join(root, 'apps/web2/src/lib/rrhh/avisoPortal.mjs'), 'utf8');
  const fn = readFileSync(path.join(root, 'apps/functions/src/attendance/avisoPortal.mjs'), 'utf8');
  assert.equal(web, fn);
});
