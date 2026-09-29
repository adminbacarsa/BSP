import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcularRemuneracionContrato, escalaVigente } from './remuneracion.mjs';

const ESCALA = {
  convenio: 'CCT_422_05',
  categoria: 'VIGILADOR_GENERAL',
  categoriaLabel: 'Vigilador General',
  vigenciaDesde: '2026-04-01',
  basicoMensual: 200000,
  divisorHoras: 200,
  jornadaOrdinariaHoras: 8,
  recargos: { nocturnoPct: 20, extra50Pct: 50, extra100Pct: 100, sabado13Pct: 100, domingoPct: 100, feriadoPct: 100 },
  presentismo: null,
  adicionales: [],
  status: 'ACTIVE',
};

const diurna = { fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
const nocturna = { fecha: '2026-10-02', horaInicio: '22:00', horaFin: '06:00', horas: 8 };
const domingo = { fecha: '2026-10-04', horaInicio: '08:00', horaFin: '16:00', horas: 8 };
const feriado = { fecha: '2026-10-12', horaInicio: '08:00', horaFin: '16:00', horas: 8 };

describe('remuneración del contrato', () => {
  it('paga la jornada diurna al valor hora del básico / 200', () => {
    const r = calcularRemuneracionContrato({
      jornadas: [diurna],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [ESCALA],
      incluirCierre: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.jornadas[0].valorHora, 1000);
    assert.equal(r.jornadas[0].horasDiurnas, 8);
    assert.equal(r.jornadas[0].horasNocturnas, 0);
    assert.equal(r.bruto, 8000);
    assert.match(r.clausula, /CCT 422\/05/);
    assert.match(r.clausula, /\$8\.000,00/);
  });

  it('separa la nocturna que cruza medianoche y no trata la madrugada del sábado como sábado >13', () => {
    const r = calcularRemuneracionContrato({
      jornadas: [nocturna],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [ESCALA],
      incluirCierre: false,
    });
    assert.equal(r.jornadas[0].horasNocturnas, 8);
    assert.equal(r.jornadas[0].horasDiurnas, 0);
    assert.equal(r.jornadas[0].horasSabado13, 0);
    assert.equal(r.jornadas[0].recargoNocturno, 1600);
    assert.equal(r.bruto, 9600);
  });

  it('recarga domingo y feriado al 100% dentro de la jornada', () => {
    const dom = calcularRemuneracionContrato({
      jornadas: [domingo],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [ESCALA],
      incluirCierre: false,
    });
    assert.equal(dom.jornadas[0].horasDomingo, 8);
    assert.equal(dom.jornadas[0].recargoEspecial, 8000);
    assert.equal(dom.bruto, 16000);

    const fer = calcularRemuneracionContrato({
      jornadas: [feriado],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [ESCALA],
      feriados: ['2026-10-12'],
      incluirCierre: false,
    });
    assert.equal(fer.jornadas[0].horasFeriado, 8);
    assert.equal(fer.jornadas[0].horasDomingo, 0);
    assert.equal(fer.bruto, 16000);
  });

  it('al cierre suma SAC sobre lo remunerativo y vacaciones de 1 día cada 20, sin el viático', () => {
    const escala = {
      ...ESCALA,
      presentismo: { pct: 10, divisorDias: 30 },
      adicionales: [{ codigo: 'VIATICO', nombre: 'Viático', tipo: 'VIATICO', modo: 'POR_JORNADA', monto: 1000 }],
    };
    const r = calcularRemuneracionContrato({
      jornadas: [diurna, domingo],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [escala],
    });
    assert.equal(r.jornadas[0].monto, 8000);
    assert.equal(r.jornadas[1].monto, 16000);
    assert.equal(r.noRemunerativo, 2000);
    assert.equal(r.remunerativo, 25333.33);
    assert.equal(r.cierre.sac, 2111.11);
    assert.equal(r.cierre.vacacionesDias, 0.1);
    assert.equal(r.cierre.vacaciones, 666.67);
    assert.equal(r.cierre.brutoConCierre, 30111.11);
    assert.equal(escalaVigente([escala, { ...escala, vigenciaDesde: '2026-11-01', basicoMensual: 999 }], 'VIGILADOR_GENERAL', '2026-10-02').basicoMensual, 200000);
  });
});
