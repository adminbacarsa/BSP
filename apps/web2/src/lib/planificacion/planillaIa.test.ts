import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CuadroPlanilla } from './importarExcel';
import { claveEquivalencia } from './equivalenciaCodigo';
import { leerPlanillaConGemini } from '../../../../functions/src/planificacion/planillaIaGemini';
import {
  aplicarAceptadas,
  armarGrillaIa,
  compararLecturaIa,
  contieneNombrePersona,
  validarLecturaIa,
} from './planillaIa';
import type { PropuestaServicio } from './servicioDesdePlanilla';

const cuadro: CuadroPlanilla = {
  indice: 0,
  titulo: 'TADICOR OCTUBRE',
  letras: 'J',
  avisoMes: null,
  avisos: [],
  referencias: [{ codigo: 'P1M', desc: 'Mañana', inicio: '08:00', fin: '15:00', horas: 7, color: 'none' }],
  filas: [
    { fila: 8, nombre: 'GANDIA LUIS', legajo: '12345', puesto: 'PUESTO 1', celdas: [{ dia: 1, raw: 'M', color: 'none' }] },
    { fila: 9, nombre: 'BONILLA MARIA', legajo: '67890', puesto: 'PUESTO 1', celdas: [{ dia: 1, raw: 'T', color: 'none' }] },
  ],
};

const propuesta: PropuestaServicio = {
  franjas: [
    { id: 'p1m', puesto: 'Puesto 1', code: 'M', startTime: '08:00', endTime: '15:00', cantidad: 1, dias: [] },
    { id: 'cortina', puesto: 'Cortina', code: 'CS', startTime: '07:00', endTime: '15:00', cantidad: 1, dias: ['S'] },
  ],
  equivalencias: [],
  lectura: '',
  funciones: ['Relevante: cubre Puesto 2 y Puesto 1'],
};

const lecturaOk = {
  puestos: [
    { nombre: 'Puesto 1', filas: [8], tipo: 'PUESTO', confianza: 0.95 },
    { nombre: 'Relevante', filas: [10], tipo: 'FUNCION', confianza: 0.9 },
  ],
  leyenda: [
    { codigo: 'M', puesto: 'Puesto 1', banda: 'M', inicio: '08:00', fin: '15:00', tipo: 'TURNO', confianza: 0.96 },
    { codigo: 'C', color: 'verde', puesto: 'Cortina', banda: 'CS', inicio: '07:00', fin: '11:00', tipo: 'TURNO', confianza: 0.93 },
    { codigo: 'REF', puesto: 'Refuerzo', banda: 'REF', inicio: '11:00', fin: '23:00', tipo: 'REFUERZO', confianza: 0.8 },
    { codigo: 'RET', tipo: 'RETEN', inicio: '00:00', fin: '00:00', confianza: 0.9 },
  ],
  funciones: [{ nombre: 'Relevante', cubre: ['Puesto 1', 'Puesto 2'], confianza: 0.91 }],
  excepcionesPorDia: [{ dia: 2, codigo: 'REF', inicio: '11:00', fin: '23:00', fuente: 'nota', confianza: 0.84 }],
  dudas: ['El jueves de refuerzo aparece una sola vez'],
};

describe('planilla IA', () => {
  it('rechaza un JSON que no respeta el contrato', () => {
    assert.throws(() => validarLecturaIa({ puestos: [{ nombre: 'Puesto 1', filas: [1], tipo: 'OTRO', confianza: 1 }] }), /tipo inválido/);
    assert.throws(() => validarLecturaIa({ leyenda: [{ codigo: 'M', inicio: '', fin: '15:00', tipo: 'TURNO', confianza: 1 }] }), /horario/);
    assert.throws(() => validarLecturaIa({ excepcionesPorDia: [{ dia: 2, codigo: 'REF', inicio: '11:00', fin: '23:00', fuente: 'margen', confianza: 1 }] }), /fuente/);
  });

  it('saca un nombre si la respuesta lo trae y valida el resto', () => {
    const lectura = validarLecturaIa({
      ...lecturaOk,
      puestos: [{ nombre: 'GANDIA LUIS', filas: [8], tipo: 'PUESTO', confianza: 0.9 }],
    });
    assert.equal(lectura.puestos[0].nombre, 'fila');
    assert.equal(contieneNombrePersona(lectura), false);
    assert.throws(() => validarLecturaIa({ ...lecturaOk, puestos: [{ nombre: 'Puesto 1', filas: [1], tipo: 'PUESTO', confianza: 2 }] }), /confianza/);
  });

  it('la grilla que viaja no lleva nombres y sí el legajo', () => {
    const grilla = armarGrillaIa(cuadro, 2026, 10);
    const json = JSON.stringify(grilla);
    assert.equal(json.includes('GANDIA'), false);
    assert.equal(json.includes('BONILLA'), false);
    assert.equal(contieneNombrePersona(grilla), false);
    assert.equal(grilla.dotacion[0].etiqueta, 'fila 8');
    assert.equal(grilla.dotacion[0].legajo, '12345');
    assert.equal(grilla.bloquesPuesto[0].nombre, 'PUESTO 1');
    assert.equal(grilla.referencias[0].inicio, '08:00');
  });

  it('marca coincidencia, diferencia y lo que solo vio la IA', () => {
    const lectura = validarLecturaIa(lecturaOk);
    const items = compararLecturaIa(propuesta, lectura);
    const m = items.find((item) => item.id === 'leyenda:0');
    const cs = items.find((item) => item.id === 'leyenda:1');
    const ref = items.find((item) => item.id === 'leyenda:2');
    const reten = items.find((item) => item.id === 'leyenda:3');
    const funcion = items.find((item) => item.id === 'funcion:0');
    assert.equal(m?.clase, 'coincidencia');
    assert.equal(m?.aceptable, false);
    assert.equal(cs?.clase, 'diferencia');
    assert.match(cs?.lector || '', /07:00–15:00/);
    assert.match(cs?.ia || '', /07:00–11:00/);
    assert.equal(ref?.clase, 'agregado');
    assert.equal(reten?.clase, 'coincidencia');
    assert.equal(reten?.aceptable, false);
    assert.equal(funcion?.clase, 'coincidencia');
  });

  it('solo lo aceptado cambia la propuesta y entra a las equivalencias', () => {
    const lectura = validarLecturaIa(lecturaOk);
    const sinAceptar = aplicarAceptadas(propuesta, lectura, [], 2026, 10);
    assert.equal(sinAceptar.franjas.find((f) => f.code === 'CS')?.endTime, '15:00');
    assert.equal(sinAceptar.equivalencias.length, 0);
    const aplicado = aplicarAceptadas(propuesta, lectura, ['leyenda:1', 'leyenda:2', 'excepcion:0'], 2026, 10);
    assert.equal(aplicado.franjas.find((f) => f.code === 'CS')?.endTime, '11:00');
    assert.equal(aplicado.franjas.find((f) => f.code === 'M')?.startTime, '08:00');
    const refuerzo = aplicado.franjas.find((f) => f.code === 'REF');
    assert.ok(refuerzo);
    assert.equal(refuerzo?.startTime, '11:00');
    assert.deepEqual(refuerzo?.dias, ['V']);
    const eq = aplicado.equivalencias.find((e) => e.clave === claveEquivalencia('C', false));
    assert.equal(eq?.code, 'CS');
    assert.equal(eq?.endTime, '11:00');
    assert.equal(eq?.positionName, 'Cortina');
    assert.equal(JSON.stringify(aplicado).includes('GANDIA'), false);
    assert.equal(aplicado.franjas.some((f) => f.code === 'RET'), false);
  });

  it('una respuesta simulada de Gemini se valida y no acepta texto que no es JSON', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(lecturaOk) }] } }],
    }), { status: 200 })) as unknown as typeof fetch;
    const { lectura, modelo } = await leerPlanillaConGemini({
      grilla: armarGrillaIa(cuadro, 2026, 10),
      apiKey: 'test-key',
      model: 'simulado',
      fetchImpl,
    });
    assert.equal(modelo, 'simulado');
    assert.equal(lectura.leyenda[0].inicio, '08:00');
    assert.equal(contieneNombrePersona(lectura), false);
    const falla = (async () => new Response('no es json', { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(() => leerPlanillaConGemini({ grilla: armarGrillaIa(cuadro, 2026, 10), apiKey: 'test-key', fetchImpl: falla }), /Gemini 500/);
  });
});
