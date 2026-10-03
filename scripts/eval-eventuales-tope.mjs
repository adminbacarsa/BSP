/**
 * Tope mensual en el motor único: no ofrece si el turno pasa el tope, ámbar desde el 80%,
 * y las dos copias de eventoCoverage.ts siguen idénticas.
 *   node --experimental-strip-types scripts/eval-eventuales-tope.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chipTopeHoras, evaluarEventualParaHueco, eventualesParaHueco, separarOcultosPorTope, textoOcultosPorTope } from '../packages/ops-core/src/eventoCoverage.ts';

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

// Margen: con tope 50 y margen 2, quien tiene 48 h no se ofrece aunque el turno de 1 h entre.
const cerca = evaluarEventualParaHueco(fila({ usadas: 48, tope: 50, horasTurno: 1, margen: 2 }), hueco, []);
assert.equal(cerca.elegible, false);
assert.equal(cerca.motivoCodigo, 'TOPE_CERCA');
assert.equal(cerca.motivo, 'Cerca del tope mensual (48/50 h, margen 2 h)');
assert.equal(cerca.horasMes?.cerca, true);
assert.equal(cerca.horasMes?.alcanzado, false);
assert.equal(chipTopeHoras(cerca.horasMes), 'Cerca del tope');
const alcanzado = evaluarEventualParaHueco(fila({ usadas: 50, tope: 50, horasTurno: 1, margen: 2 }), hueco, []);
assert.equal(alcanzado.motivoCodigo, 'TOPE_HORAS');
assert.equal(chipTopeHoras(alcanzado.horasMes), 'Tope alcanzado');
const bajoMargen = evaluarEventualParaHueco(fila({ usadas: 47, tope: 50, horasTurno: 1, margen: 2 }), hueco, []);
assert.equal(bajoMargen.elegible, true);
assert.equal(bajoMargen.horasMes?.aviso, true);
assert.equal(chipTopeHoras(bajoMargen.horasMes), null);

// Los selectores: el motor no los lista (sin incluirNoElegibles) y con incluirNoElegibles se separan para la línea «N ocultos».
const bolsa = [
  { ...fila({ usadas: 48, tope: 50, horasTurno: 1, margen: 2 }), cuil: '20111111119', nombre: 'Cerca, Uno' },
  { ...fila({ usadas: 10, tope: 50, horasTurno: 1, margen: 2 }), cuil: '20222222228', nombre: 'Libre, Dos' },
  { ...fila({ usadas: 50, tope: 50, horasTurno: 1, margen: 2 }), cuil: '20333333337', nombre: 'Lleno, Tres' },
];
const soloElegibles = eventualesParaHueco({ bolsa, hueco, otrasJornadas: [] });
assert.deepEqual(soloElegibles.map((c) => c.cuil), ['20222222228']);
const { visibles, ocultos } = separarOcultosPorTope(eventualesParaHueco({ bolsa, hueco, otrasJornadas: [], incluirNoElegibles: true }));
assert.deepEqual(visibles.map((c) => c.cuil), ['20222222228']);
assert.equal(ocultos.length, 2);
assert.equal(textoOcultosPorTope(ocultos.length), '2 eventuales ocultos por tope de horas');

console.log('OK\ttope y margen en el motor único, ocultos por tope y paridad de eventoCoverage.ts');
