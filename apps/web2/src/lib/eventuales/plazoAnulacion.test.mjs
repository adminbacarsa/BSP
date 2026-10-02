import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MOTIVO_BAJA_SIN_EFECTIVIZACION,
  PASOS_ANULACION_MANUAL,
  acuseAnulacionValido,
  convertirAnulacionVencida,
  cuentaRegresivaAnulacion,
  datosAnulacionManual,
  devengamientoExportable,
  plazoAnulacionAlta,
} from './plazoAnulacion.mjs';

const feriados2026 = [
  { date: '2026-01-00', name: 'CONFIG_YEAR', type: 'System' },
  { date: '2026-01-01', name: 'Año Nuevo', type: 'Nacional' },
  { date: '2026-10-12', name: 'Día del Respeto a la Diversidad Cultural', type: 'Nacional' },
];
const ar = (iso) => Date.parse(iso);

describe('anulación manual y baja sin devengamiento', () => {
  it('arma los datos de Anular Registro y la cuenta regresiva', () => {
    const datos = datosAnulacionManual({
      bolsaCuil: '20-11111111-2',
      fechaInicio: '2026-10-05',
      nroTransaccionAlta: ' 7788 ',
    });
    assert.equal(datos.cuil, '20111111112');
    assert.equal(datos.fechaInicio, '20261005');
    assert.equal(datos.nroTransaccionAlta, '7788');
    assert.equal(datos.pasos[1].includes('Anular Registro'), true);
    assert.equal(PASOS_ANULACION_MANUAL.length, 5);
    const vence = ar('2026-10-06T00:00:00-03:00');
    const abierta = cuentaRegresivaAnulacion(vence, vence - 90 * 60000);
    assert.equal(abierta.vencido, false);
    assert.match(abierta.texto, /1 h 30 min/);
    assert.equal(cuentaRegresivaAnulacion(vence, vence + 1000).vencido, true);
    assert.equal(acuseAnulacionValido('  ').codigo, 'FALTA_ACUSE');
    assert.equal(acuseAnulacionValido('ACUSE-99').ok, true);
  });

  it('el no presentado no devenga haberes ni ART', () => {
    assert.deepEqual(devengamientoExportable({ bruto: 56000, sinEfecto: true }), { bruto: 0, art: false, motivo: 'SIN_EFECTIVIZACION' });
    assert.deepEqual(devengamientoExportable({ bruto: 56000, pagaJornada: false }), { bruto: 0, art: false, motivo: 'SIN_EFECTIVIZACION' });
    assert.deepEqual(devengamientoExportable({ bruto: 56000, sinDevengamiento: true }), { bruto: 0, art: false, motivo: 'SIN_EFECTIVIZACION' });
    assert.deepEqual(devengamientoExportable({ bruto: 1200 }), { bruto: 1200, art: true, motivo: null });
  });
});

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
    assert.equal(vencida.patch.observacionesInternas, 'Sin efectivización de tareas / No presentación al primer turno');
    assert.equal(vencida.patch.sinDevengamiento, true);
    assert.equal(vencida.patch.devengaArt, false);
    assert.equal(vencida.patch.bruto, 0);
    const porDefecto = convertirAnulacionVencida(envio, { ahoraMs: ar('2026-10-06T00:01:00-03:00'), feriados: feriados2026 });
    assert.equal(porDefecto.patch.revista, '30');
    assert.equal(convertirAnulacionVencida({ ...envio, estado: 'ANULADO' }, { ahoraMs: ar('2026-10-06T00:01:00-03:00') }).convertir, false);
    assert.equal(convertirAnulacionVencida({ ...envio, acuseAnulacion: 'ACUSE-1' }, { ahoraMs: ar('2026-10-06T00:01:00-03:00') }).convertir, false);
  });
});
