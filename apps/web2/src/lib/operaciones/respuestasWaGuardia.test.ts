/**
 * npx tsx --tsconfig apps/web2/tsconfig.json --test apps/web2/src/lib/operaciones/respuestasWaGuardia.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clasificarIngresoWa,
  ingresoDemasiadoAnticipado,
  textoFueraDeRadioWa,
  textoIngresoAnticipadoWa,
  WA_VENTANA_INGRESO_MS,
  type TurnoClasificacionWa,
} from './respuestasWaGuardia.ts';


const ts = (iso: string) => ({ toMillis: () => new Date(iso).getTime() });

describe('respuestasWaGuardia', () => {
  it('detecta marca a más de 30 min del inicio', () => {
    const start = ts('2026-11-24T14:30:00-03:00');
    const msg = new Date('2026-11-24T13:31:00-03:00').getTime();
    assert.equal(ingresoDemasiadoAnticipado(start, msg), true);
    assert.equal(
      ingresoDemasiadoAnticipado(start, new Date('2026-11-24T14:05:00-03:00').getTime()),
      false,
    );
  });

  it('texto anticipado menciona la ventana de 30 min', () => {
    const startMs = new Date('2026-11-24T14:30:00-03:00').getTime();
    const msg = startMs - WA_VENTANA_INGRESO_MS - 20 * 60_000;
    const t = textoIngresoAnticipadoWa(
      'ACUÑA, JUAN MANUEL',
      { expected: '14:30', obj: 'Casa Matriz', startTimeRaw: ts('2026-11-24T14:30:00-03:00') },
      msg,
    );
    assert.match(t, /14:30/);
    assert.match(t, /30 min/);
    assert.match(t, /Juan/i);
  });

  it('texto fuera de radio incluye metros', () => {
    const t = textoFueraDeRadioWa('ALLASIA, GONZALO', 250, 'ingreso');
    assert.match(t, /250 m/);
    assert.match(t, /80 m/);
  });

  const nunca = () => false;
  const turno = (parcial: Partial<TurnoClasificacionWa>): TurnoClasificacionWa => ({
    rowId: 'doc1',
    phone: '3515465559',
    name: 'MARTINEZ, MAURO',
    turnoStatus: 'PENDING',
    obj: 'Guardia SP',
    expected: '18:00',
    startTimeRaw: ts('2026-11-24T18:00:00-03:00'),
    endTimeRaw: ts('2026-11-24T22:00:00-03:00'),
    ...parcial,
  });

  it('sin turno agendado', () => {
    const r = clasificarIngresoWa({
      turnos: [],
      name: 'Mauro',
      phone: '3515465559',
      msgMs: new Date('2026-11-24T15:02:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, true);
    assert.match(r.texto || '', /no encontramos un turno/);
  });

  it('ya presente, antes del fin', () => {
    const r = clasificarIngresoWa({
      turnos: [turno({ turnoStatus: 'PRESENT', realStartTime: '14:00', expected: '14:00', startTimeRaw: ts('2026-11-24T14:00:00-03:00') })],
      name: 'Mauro',
      phone: '3515465559',
      msgMs: new Date('2026-11-24T15:02:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, true);
    assert.match(r.texto || '', /ya estás presente/);
    assert.match(r.texto || '', /22:00/);
  });

  it('presente y ya pasó el fin: no avisa acá, sigue como salida', () => {
    const r = clasificarIngresoWa({
      turnos: [turno({ turnoStatus: 'PRESENT', startTimeRaw: ts('2026-11-24T09:00:00-03:00'), endTimeRaw: ts('2026-11-24T13:00:00-03:00') })],
      name: 'Mauro',
      phone: '3515465559',
      msgMs: new Date('2026-11-24T15:02:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, false);
    assert.equal(r.texto, null);
  });

  it('turno de hoy ya terminó', () => {
    const r = clasificarIngresoWa({
      turnos: [turno({ turnoStatus: 'COMPLETED', endTimeRaw: ts('2026-11-24T14:00:00-03:00') })],
      name: 'Mauro',
      phone: '3515465559',
      msgMs: new Date('2026-11-24T15:02:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, true);
    assert.match(r.texto || '', /no tenés un turno abierto/);
    assert.match(r.texto || '', /14:00/);
  });

  it('muy antes del inicio dice el horario', () => {
    const r = clasificarIngresoWa({
      turnos: [turno({})],
      name: 'Mauro',
      phone: '3515465559',
      msgMs: new Date('2026-11-24T15:02:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, true);
    assert.equal(r.aviso, 'anticipado');
    assert.match(r.texto || '', /18:00/);
    assert.match(r.texto || '', /30 min/);
  });

  it('apodo del celular no importa: el teléfono de Acosta confirma a Acosta', () => {
    const r = clasificarIngresoWa({
      turnos: [
        turno({
          rowId: 'acosta1',
          name: 'ACOSTA, JULIO',
          phone: '3515416836',
          expected: '10:30',
          startTimeRaw: ts('2026-11-24T10:30:00-03:00'),
          endTimeRaw: ts('2026-11-24T18:30:00-03:00'),
        }),
      ],
      name: 'Debora Quinteros',
      phone: '3515416836',
      msgMs: new Date('2026-11-24T10:35:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, false);
    assert.equal(r.texto, null);
    assert.equal(r.turno?.rowId, 'acosta1');
  });

  it('apodo Franco con tel de Nievas: salida automática del presente vencido', () => {
    const r = clasificarIngresoWa({
      turnos: [
        turno({
          name: 'NIEVAS, NAHUEL ALEJO',
          phone: '3517583423',
          turnoStatus: 'PRESENT',
          startTimeRaw: ts('2026-11-24T10:30:00-03:00'),
          endTimeRaw: ts('2026-11-24T16:30:00-03:00'),
        }),
      ],
      name: 'Franco Sartori',
      phone: '3517583423',
      msgMs: new Date('2026-11-24T16:36:00-03:00').getTime(),
      yaMarcado: nunca,
    });
    assert.equal(r.cortar, false);
    assert.equal(r.texto, null);
    assert.equal(r.turno?.name, 'NIEVAS, NAHUEL ALEJO');
  });
});
