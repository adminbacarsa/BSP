/**
 * Tope mensual en el motor único: no ofrece si el turno pasa el tope, ámbar desde el 80%,
 * y las dos copias de eventoCoverage.ts siguen idénticas.
 *   node --experimental-strip-types scripts/eval-eventuales-tope.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluarEventualParaHueco } from '../packages/ops-core/src/eventoCoverage.ts';

const EMP = 'bacarsa';
const hoy = '2026-10-02';
const start = Date.parse('2026-10-20T11:00:00.000Z');
const end = start + 8 * 3600000;

function fila(topeHoras) {
  return {
    cuil: '20111111119',
    nombre: 'Perez, Ana',
    disponibilidad: 'DISPONIBLE',
    empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01',
    aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    marcos: { [EMP]: { firmado: true, fechaFirma: '2026-01-15', vigenciaDias: 365 } },
    ...(topeHoras ? { topeHoras } : {}),
  };
}

const hueco = { empresaId: EMP, startMs: start, endMs: end, hoyYmd: hoy };
const a = fs.readFileSync('packages/ops-core/src/eventoCoverage.ts');
const b = fs.readFileSync('apps/functions/src/eventos/eventoCoverage.ts');
assert.equal(a.equals(b), true, 'eventoCoverage.ts de ops-core y functions dejaron de ser iguales');

const bloqueado = evaluarEventualParaHueco(fila({ usadas: 48, tope: 50, horasTurno: 8 }), hueco, []);
assert.equal(bloqueado.elegible, false);
assert.equal(bloqueado.motivoCodigo, 'TOPE_HORAS');
assert.equal(bloqueado.motivo, 'Supera el tope mensual (48/50 h, este turno 8 h)');

const justo = evaluarEventualParaHueco(fila({ usadas: 42, tope: 50, horasTurno: 8 }), hueco, []);
assert.equal(justo.elegible, true, justo.motivo || '');

const aviso = evaluarEventualParaHueco(fila({ usadas: 40, tope: 50, horasTurno: 8 }), hueco, []);
assert.equal(aviso.elegible, true);
assert.equal(aviso.horasMes?.aviso, true);
assert.equal(aviso.horasMes?.texto, '40/50 h este mes');

const libre = evaluarEventualParaHueco(fila(null), hueco, []);
assert.equal(libre.elegible, true);
assert.equal(libre.horasMes, undefined);

console.log('OK\ttope en el motor único y paridad de eventoCoverage.ts');
