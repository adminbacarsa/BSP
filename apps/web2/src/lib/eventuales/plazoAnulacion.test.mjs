import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MOTIVO_BAJA_SIN_EFECTIVIZACION,
  convertirAnulacionVencida,
  plazoAnulacionAlta,
} from './plazoAnulacion.mjs';

const feriados2026 = [
  { date: '2026-01-00', name: 'CONFIG_YEAR', type: 'System' },
  { date: '2026-01-01', name: 'Año Nuevo', type: 'Nacional' },
  { date: '2026-10-12', name: 'Día del Respeto a la Diversidad Cultural', type: 'Nacional' },
];
const ar = (iso) => Date.parse(iso);

describe('plazo de anulación de alta (RG 2988/2010 art. 9)', () => {
  it('inicio 08:00 en día hábil: hasta las 24:00 de ese día', () => {
    const base = { fechaInicio: '2026-10-05', horaInicio: '08:00', feriados: feriados2026 };
    const tarde = plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-05T23:59:00-03:00') });
    assert.equal(tarde.regla, 'MISMO_DIA');
    assert.equal(tarde.puedeAnular, true);
    assert.equal(tarde.avisoFeriados, null);
    const vencio = plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-06T00:01:00-03:00') });
    assert.equal(vencio.puedeAnular, false);
  });

  it('inicio 18:00 (turno noche): hasta las 12:00 del día siguiente', () => {
    const base = { fechaInicio: '2026-10-05', horaInicio: '18:00', feriados: feriados2026 };
    assert.equal(plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-06T12:00:00-03:00') }).puedeAnular, true);
    assert.equal(plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-06T12:00:00-03:00') }).regla, 'NOCHE');
    assert.equal(plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-06T12:01:00-03:00') }).puedeAnular, false);
  });

  it('inicio sábado: hasta las 12:00 del lunes, también si el turno es de noche', () => {
    const manana = plazoAnulacionAlta({ fechaInicio: '2026-10-03', horaInicio: '08:00', ahoraMs: ar('2026-10-05T12:00:00-03:00'), feriados: feriados2026 });
    assert.equal(manana.regla, 'INHABIL');
    assert.equal(manana.venceFecha, '2026-10-05');
    assert.equal(manana.puedeAnular, true);
    assert.equal(plazoAnulacionAlta({ fechaInicio: '2026-10-03', horaInicio: '18:00', ahoraMs: ar('2026-10-05T12:01:00-03:00'), feriados: feriados2026 }).puedeAnular, false);
    const sinCalendario = plazoAnulacionAlta({ fechaInicio: '2026-10-03', horaInicio: '08:00', ahoraMs: ar('2026-10-05T11:00:00-03:00'), feriados: [] });
    assert.equal(sinCalendario.puedeAnular, true);
    assert.match(sinCalendario.avisoFeriados, /2026/);
  });

  it('inicio en feriado nacional: hasta las 12:00 del primer hábil siguiente', () => {
    const plazo = plazoAnulacionAlta({ fechaInicio: '2026-10-12', horaInicio: '09:00', ahoraMs: ar('2026-10-13T12:00:00-03:00'), feriados: feriados2026 });
    assert.equal(plazo.regla, 'INHABIL');
    assert.equal(plazo.venceFecha, '2026-10-13');
    assert.equal(plazo.puedeAnular, true);
    assert.equal(plazoAnulacionAlta({ fechaInicio: '2026-10-12', horaInicio: '09:00', ahoraMs: ar('2026-10-13T12:01:00-03:00'), feriados: feriados2026 }).puedeAnular, false);
  });

  it('viernes noche 22:00: hasta las 12:00 del sábado', () => {
    const base = { fechaInicio: '2026-10-02', horaInicio: '22:00', feriados: feriados2026 };
    const plazo = plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-03T12:00:00-03:00') });
    assert.equal(plazo.regla, 'NOCHE');
    assert.equal(plazo.venceFecha, '2026-10-03');
    assert.equal(plazo.puedeAnular, true);
    assert.equal(plazoAnulacionAlta({ ...base, ahoraMs: ar('2026-10-03T12:01:00-03:00') }).puedeAnular, false);
  });

  it('una anulación pendiente que vence la ventana pasa a baja', () => {
    const envio = { tipo: 'ANULACION', estado: 'PENDIENTE', fechaInicio: '2026-10-05', horaInicio: '08:00', fechaAlta: '2026-10-05' };
    const abierta = convertirAnulacionVencida(envio, { ahoraMs: ar('2026-10-05T20:00:00-03:00'), feriados: feriados2026, revistaDesistimiento: '44' });
    assert.equal(abierta.convertir, false);
    const vencida = convertirAnulacionVencida(envio, { ahoraMs: ar('2026-10-06T00:01:00-03:00'), feriados: feriados2026, revistaDesistimiento: '44' });
    assert.equal(vencida.convertir, true);
    assert.equal(vencida.patch.tipo, 'BAJA_NO_PRESENTACION');
    assert.equal(vencida.patch.movimiento, 'BT');
    assert.equal(vencida.patch.fechaBaja, '2026-10-05');
    assert.equal(vencida.patch.motivo, MOTIVO_BAJA_SIN_EFECTIVIZACION);
    assert.equal(vencida.patch.revista, '44');
    assert.equal(vencida.patch.constanciaInterna, 'NO_SE_PRESENTO');
    assert.equal(vencida.patch.convertidoDe, 'ANULACION');
  });
});
