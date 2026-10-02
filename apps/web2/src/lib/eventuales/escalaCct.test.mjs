import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aplicarCambios, aprobadasSolapadas, celdasBajaConfianza, derivadosFila, diffEscalas, elegirEscalaAprobada,
  escalasSalarialesDesdeAprobada, parametrosDe, resumenEscala, rotuloFuente, validarParaAprobar,
} from './escalaCct.mjs';
import { calcularRemuneracionContrato, escalaConRespaldo, textoEscalaAplicada } from './remuneracion.mjs';
import { brutoParaTxt } from './arcaTxt.mjs';
import { modeloAnexo } from './marcoTexto.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(dir, '../../../../../scripts/escalas-cct/fixtures/disp-120-2026.extraido.json'), 'utf8'));
const propuesta = () => ({ id: 'CCT_422_05_2026-01-01_33fa9b5b', ...JSON.parse(JSON.stringify(fixture)) });
const vig = (e, mes) => e.tramos.find((t) => t.mes === mes).categorias.find((c) => c.codigo === 'VIGILADOR');

describe('escala CCT 422/05 — edición y versionado', () => {
  it('exige motivo y rechaza cambios sobre meses o categorías inexistentes', () => {
    const p = propuesta();
    assert.equal(aplicarCambios(p, [{ mes: '2026-01', codigo: 'VIGILADOR', campo: 'basico', valor: 1 }], { motivo: '' }).codigo, 'MOTIVO_REQUERIDO');
    assert.equal(aplicarCambios(p, [], { motivo: 'prueba' }).codigo, 'SIN_CAMBIOS');
    assert.equal(aplicarCambios(p, [{ mes: '2027-01', codigo: 'VIGILADOR', campo: 'basico', valor: 1 }], { motivo: 'prueba' }).codigo, 'MES_INEXISTENTE');
    assert.equal(aplicarCambios(p, [{ mes: '2026-01', codigo: 'NADIE', campo: 'basico', valor: 1 }], { motivo: 'prueba' }).codigo, 'CATEGORIA_INEXISTENTE');
    assert.equal(aplicarCambios(p, [{ mes: '2026-01', codigo: 'VIGILADOR', campo: 'basico', valor: -5 }], { motivo: 'prueba' }).codigo, 'VALOR_INVALIDO');
    assert.equal(aplicarCambios(p, [{ campo: 'parametros.sac.divisor', valor: 10 }], { motivo: 'prueba' }).codigo, 'CAMPO_INVALIDO');
  });

  it('edita una celda, la deja en ALTA con motivo, recalcula la suma y guarda historial sin mutar la original', () => {
    const p = propuesta();
    const r = aplicarCambios(p, [
      { mes: '2026-01', codigo: 'VIGILADOR', campo: 'basico', valor: '867.300' },
      { mes: '2026-01', codigo: '*', campo: 'aeroportuario', valor: 117500 },
      { campo: 'parametros.recargos.nocturnoPct', valor: 13.33 },
    ], { motivo: 'Corrección contra el acta firmada', uid: 'u1', email: 'rrhh@x', ahora: '2026-10-02T12:00:00.000Z' });
    assert.equal(r.ok, true);
    assert.equal(vig(p, '2026-01').basico.valor, 867200);
    const f = vig(r.escala, '2026-01');
    assert.equal(f.basico.valor, 867300);
    assert.equal(f.basico.confianza, 'ALTA');
    assert.equal(f.basico.motivo, 'EDITADO_RRHH');
    assert.equal(f.totalCalculado, 1516100);
    assert.equal(f.sumaCierra, false);
    assert.equal(r.escala.tramos[0].aeroportuario.valor, 117500);
    assert.equal(parametrosDe(r.escala).recargos.nocturnoPct, 13.33);
    assert.equal(r.escala.historial.length, 1);
    assert.equal(r.escala.historial[0].por, 'u1');
    assert.equal(r.escala.historial[0].motivo, 'Corrección contra el acta firmada');
    assert.deepEqual(r.escala.historial[0].cambios.map((c) => c.campo), ['basico', 'aeroportuario', 'parametros.recargos.nocturnoPct']);
    assert.equal(r.escala.historial[0].cambios[0].antes, 867200);
    assert.equal(r.escala.historial[0].cambios[0].despues, 867300);
    const otra = aplicarCambios(r.escala, [{ mes: '2026-02', codigo: 'VIGILADOR', campo: 'total', valor: 1539800 }], { motivo: 'sin cambio real' });
    assert.equal(otra.codigo, 'SIN_CAMBIOS');
  });

  it('muestra qué cambió contra la anterior (celdas y parámetros) y resalta baja confianza', () => {
    const a = propuesta();
    const b = aplicarCambios(a, [{ mes: '2026-03', codigo: 'VIGILADOR', campo: 'viatico', valor: 474000 }, { campo: 'parametros.recargos.nocturnoPct', valor: 20 }], { motivo: 'ajuste' }).escala;
    const d = diffEscalas(a, b);
    assert.deepEqual(d.map((x) => `${x.mes || '-'}|${x.codigo || '-'}|${x.campo}|${x.antes}|${x.despues}`), [
      '2026-03|VIGILADOR|viatico|473800|474000',
      '-|-|parametros.recargos.nocturnoPct|null|20',
    ]);
    assert.equal(diffEscalas(null, a).filter((x) => x.campo === 'tramo').length, 6);
    const baja = celdasBajaConfianza(a);
    assert.equal(baja.filter((c) => c.campo === 'mes').length, 6);
    const c = propuesta();
    c.tramos[0].categorias[0].basico = { valor: 867200, confianza: 'BAJA', motivo: 'BORROSO' };
    assert.ok(celdasBajaConfianza(c).some((x) => x.codigo === 'VIGILADOR' && x.campo === 'basico' && x.confianza === 'BAJA'));
    assert.equal(resumenEscala(c).bajaConfianza, 7);
    assert.equal(rotuloFuente(a), 'Disp. 120/2026 · Acuerdo 305/26');
  });

  it('valida la aprobación y detecta aprobadas que solapan', () => {
    const p = propuesta();
    assert.equal(validarParaAprobar(p).ok, true);
    assert.equal(validarParaAprobar({ ...p, estado: 'APROBADA' }).codigo, 'NO_ES_PROPUESTA');
    const sinBasico = propuesta();
    vig(sinBasico, '2026-04').basico.valor = null;
    assert.equal(validarParaAprobar(sinBasico).codigo, 'VIGILADOR_SIN_BASICO');
    const vieja = { id: 'v1', estado: 'APROBADA', vigenciaDesde: '2025-07-01', vigenciaHasta: '2026-01-31' };
    const otra = { id: 'v0', estado: 'APROBADA', vigenciaDesde: '2025-01-01', vigenciaHasta: '2025-06-30' };
    assert.deepEqual(aprobadasSolapadas([vieja, otra], p).map((e) => e.id), ['v1']);
  });
});

describe('escala CCT 422/05 — bruto del anexo', () => {
  const aprobada = { ...propuesta(), estado: 'APROBADA', version: 1 };
  const filas = escalasSalarialesDesdeAprobada(aprobada, { escalaCctId: aprobada.id, version: 1, uid: 'u1', ahora: '2026-10-02T12:00:00.000Z' });

  it('traduce la aprobada a escalas_salariales por categoría y mes (presentismo fijo, viático y no rem. mensuales)', () => {
    assert.equal(filas.length, 6 * 14);
    const ene = filas.find((f) => f.id === 'CCT_422_05_VIGILADOR_2026-01-01');
    assert.equal(ene.status, 'ACTIVE');
    assert.equal(ene.basicoMensual, 867200);
    assert.equal(ene.divisorHoras, 200);
    assert.deepEqual(ene.aliases, ['VIGILADOR_GENERAL']);
    assert.equal(ene.codigoArca, '033104');
    assert.equal(ene.vigenciaHasta, '2026-01-31');
    assert.deepEqual(ene.presentismo, { monto: 165000, modo: 'FIJO_MENSUAL', divisorDias: 30, tipo: 'REMUNERATIVO' });
    assert.deepEqual(ene.adicionales.map((a) => [a.codigo, a.monto, a.modo, a.tipo]), [
      ['VIATICO_ART106', 473800, 'MENSUAL_PRORRATEO', 'VIATICO'],
      ['NO_REM_ACUERDO', 10000, 'MENSUAL_PRORRATEO', 'NO_REMUNERATIVO'],
    ]);
    assert.equal(ene.extras.totalConformado, 1516000);
    assert.equal(ene.extras.aeroportuarioMensual, 117490);
    assert.equal(ene.escalaCctId, aprobada.id);
    assert.equal(ene.escalaVersion, 1);
    assert.equal(ene.fuente.disposicion, 'DI-2026-120-APN-DNRYRT#MCH');
    assert.equal(derivadosFila(vig(aprobada, '2026-01'), parametrosDe(aprobada)).valorHora, 4336);
    assert.equal(derivadosFila(vig(aprobada, '2026-01'), parametrosDe(aprobada)).horaExtra50, 6504);
  });

  it('calcula el bruto de una jornada diurna de 8 h en enero 2026 con la escala aprobada (categoría del contrato VIGILADOR_GENERAL)', () => {
    const r = calcularRemuneracionContrato({
      jornadas: [{ fecha: '2026-01-14', horaInicio: '08:00', horaFin: '16:00' }],
      categoria: 'VIGILADOR_GENERAL',
      escalas: filas,
      incluirCierre: false,
      hoy: '2026-01-20',
    });
    assert.equal(r.ok, true);
    assert.equal(r.jornadas[0].valorHora, 4336);
    assert.equal(r.jornadas[0].base, 34688);
    const concepto = (c) => r.conceptos.find((x) => x.codigo === c)?.monto;
    assert.equal(concepto('PRESENTISMO'), 5500);
    assert.equal(concepto('VIATICO_ART106'), 15793.33);
    assert.equal(concepto('NO_REM_ACUERDO'), 333.33);
    assert.equal(r.bruto, 56314.66);
    assert.equal(r.escalaRespaldo, false);
    assert.deepEqual(r.escalas, ['CCT_422_05_VIGILADOR_2026-01-01']);
    assert.match(r.clausula, /Escala aplicada: Disp\. 120\/2026 · Acuerdo 305\/26 v1 \(01\/01\/2026–31\/01\/2026\)/);
    assert.equal(r.advertencias.some((a) => a.codigo === 'RECARGO_NOCTURNO_SIN_PORCENTAJE'), false);
  });

  it('cada jornada toma la escala de su mes y la nocturna avisa si el acta no fija el recargo', () => {
    const r = calcularRemuneracionContrato({
      jornadas: [
        { fecha: '2026-01-31', horaInicio: '22:00', horaFin: '06:00' },
        { fecha: '2026-06-10', horaInicio: '08:00', horaFin: '16:00' },
      ],
      categoria: 'VIGILADOR',
      escalas: filas,
      incluirCierre: false,
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.escalas, ['CCT_422_05_VIGILADOR_2026-01-01', 'CCT_422_05_VIGILADOR_2026-06-01']);
    assert.equal(r.jornadas[1].valorHora, 4558.25);
    assert.ok(r.advertencias.some((a) => a.codigo === 'RECARGO_NOCTURNO_SIN_PORCENTAJE'));
  });

  it('sin escala en la fecha del servicio usa la vigente hoy y lo avisa en el anexo', () => {
    const r = calcularRemuneracionContrato({
      jornadas: [{ fecha: '2026-09-05', horaInicio: '08:00', horaFin: '16:00' }],
      categoria: 'VIGILADOR_GENERAL',
      escalas: filas,
      incluirCierre: false,
      hoy: '2026-06-15',
    });
    assert.equal(r.ok, true);
    assert.equal(r.escalaRespaldo, true);
    assert.deepEqual(r.escalas, ['CCT_422_05_VIGILADOR_2026-06-01']);
    assert.equal(r.advertencias[0].codigo, 'ESCALA_RESPALDO');
    assert.equal(r.advertencias[0].motivo, 'SIN_ESCALA_EN_FECHA_USA_HOY');
    assert.match(textoEscalaAplicada(r), /Aviso: para 05\/09\/2026 no hay escala aprobada vigente/);
    const ultima = escalaConRespaldo(filas, 'VIGILADOR_GENERAL', '2026-09-05', '2026-09-05');
    assert.equal(ultima.motivo, 'SIN_ESCALA_EN_FECHA_USA_ULTIMA');
    assert.equal(ultima.escala.vigenciaDesde, '2026-06-01');
    const sinHoy = calcularRemuneracionContrato({ jornadas: [{ fecha: '2026-09-05', horaInicio: '08:00', horaFin: '16:00' }], categoria: 'VIGILADOR_GENERAL', escalas: filas, incluirCierre: false });
    assert.equal(sinHoy.ok, true);
    assert.equal(sinHoy.advertencias[0].motivo, 'SIN_ESCALA_EN_FECHA_USA_ULTIMA');
    assert.equal(calcularRemuneracionContrato({ jornadas: [{ fecha: '2026-09-05', horaInicio: '08:00', horaFin: '16:00' }], categoria: 'OTRA', escalas: filas }).codigo, 'SIN_ESCALA');
  });

  it('el TXT de ARCA y el anexo usan el mismo bruto y el anexo dice de qué escala salió', () => {
    const contrato = { jornadas: [{ fecha: '2026-01-14', horaInicio: '08:00', horaFin: '16:00' }], categoria: 'VIGILADOR_GENERAL' };
    const b = brutoParaTxt({ contrato, escalas: filas, hoy: '2026-01-20' });
    assert.equal(b.ok, true);
    assert.equal(b.bruto, 56314.66);
    assert.equal(b.escalaRespaldo, false);
    const r = calcularRemuneracionContrato({ ...contrato, escalas: filas, incluirCierre: false, hoy: '2026-01-20' });
    const anexo = modeloAnexo({ numero: 'A1', jornadas: contrato.jornadas, bruto: '$56.314,66', escalaTexto: textoEscalaAplicada(r) });
    assert.match(anexo.remuneracion, /\$56\.314,66/);
    assert.match(anexo.remuneracion, /Escala aplicada: Disp\. 120\/2026 · Acuerdo 305\/26 v1/);
    assert.match(anexo.plano, /Escala aplicada/);
  });

  it('elige la aprobada vigente a la fecha del servicio o cae a la de hoy / la última', () => {
    const v1 = { id: 'a', estado: 'APROBADA', vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-06-30' };
    const v2 = { id: 'b', estado: 'APROBADA', vigenciaDesde: '2026-07-01', vigenciaHasta: '2026-12-31' };
    const prop = { id: 'c', estado: 'PROPUESTA', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-06-30' };
    assert.equal(elegirEscalaAprobada([v1, v2, prop], '2026-03-10', '2026-10-02').escala.id, 'a');
    const hoy = elegirEscalaAprobada([v1, v2, prop], '2027-02-10', '2026-10-02');
    assert.equal(hoy.escala.id, 'b');
    assert.equal(hoy.fallback, true);
    assert.equal(hoy.motivo, 'SIN_ESCALA_EN_FECHA_USA_HOY');
    assert.equal(elegirEscalaAprobada([v1], '2027-02-10', '2027-02-10').motivo, 'SIN_ESCALA_EN_FECHA_USA_ULTIMA');
    assert.equal(elegirEscalaAprobada([prop], '2027-02-10', '2027-02-10').escala, null);
  });
});
