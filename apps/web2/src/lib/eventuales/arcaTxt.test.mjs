import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LARGO_REGISTRO_ARCA, brutoParaTxt, lineasCargaMasiva } from './arcaTxt.mjs';
import { calcularRemuneracionContrato, escalaVigente } from './remuneracion.mjs';
import { aprobarEscala, parsearEscalaSuvico, planJobEscalaSuvico } from './escalaPropuesta.mjs';

const contrato = { fechaAlta: '2026-10-02', fechaBaja: '2026-10-04' };
const cuil = '20999999991';

describe('TXT ARCA posiciones fijas', () => {
  it('arma AT y BT de 130 con modalidad 012, revista 30 y puestos fijos', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '123456',
      empresa: { arcaEventuales: { cctCodigo: '42205', categoriaProfesional: '000001' } },
    });
    const [alta, baja] = out.lineas;
    assert.equal(alta.length, LARGO_REGISTRO_ARCA);
    assert.equal(baja.length, LARGO_REGISTRO_ARCA);
    assert.equal(alta.slice(0, 2), '01');
    assert.equal(alta.slice(2, 4), 'AT');
    assert.equal(alta.slice(4, 15), cuil);
    assert.equal(alta.slice(16, 19), '012');
    assert.equal(alta.slice(19, 29), '2026/10/02');
    assert.equal(alta.slice(29, 39), '2026/10/04');
    assert.equal(alta.slice(39, 45), '123456');
    assert.equal(alta.slice(45, 47), '01');
    assert.equal(alta.slice(57, 72), '000000000800000');
    assert.equal(alta.slice(72, 73), '5');
    assert.equal(alta.slice(73, 78), '00000');
    assert.equal(alta.slice(78, 84), '801000');
    assert.equal(alta.slice(84, 88), '5414');
    assert.equal(alta.slice(90, 100), '42205     ');
    assert.equal(baja.slice(2, 4), 'BT');
    assert.equal(baja.slice(45, 47), '30');
    assert.equal(out.enviable, true);
    assert.equal(out.advertencias.includes('PUESTO_A_VERIFICAR'), true);
  });

  it('no se envía si faltan el código de convenio y la categoría', () => {
    const out = lineasCargaMasiva({ contrato, cuil, bruto: 0, empresa: {} });
    assert.equal(out.lineas[0].slice(16, 19), '012');
    assert.equal(out.enviable, false);
    assert.equal(out.advertencias.includes('CCT_CODIGO_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('CATEGORIA_PROFESIONAL_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('RNOS_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('CCT_CODIGO_PENDIENTE'), true);
  });

  it('Vigilador es 033104 en las posiciones 101-106 y el CCT sigue pendiente', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '112233',
      empresa: { id: 'bacarsa' },
    });
    assert.equal(out.lineas[0].slice(100, 106), '033104');
    assert.equal(out.lineas[1].slice(100, 106), '033104');
    assert.equal(out.advertencias.includes('CCT_CODIGO_PENDIENTE'), true);
    assert.equal(out.enviable, false);
    const editada = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '112233',
      empresa: { id: 'grupos_bacar_sa', arcaEventuales: { categoria: '999999', cctCodigo: '42205' } },
    });
    assert.equal(editada.lineas[0].slice(100, 106), '999999');
    assert.equal(editada.advertencias.includes('CCT_CODIGO_PENDIENTE'), false);
  });
});

describe('propuesta de escala', () => {
  it('un texto sin tabla no crea propuesta y una pendiente no liquida', () => {
    const aviso = planJobEscalaSuvico([{ url: 'https://www.suvico.org.ar/', cuerpo: '<html>Escala Salarial Vigente</html>' }]);
    assert.equal(aviso.accion, 'AVISO');
    assert.equal(parsearEscalaSuvico('conformado inicial 1644650'), null);

    const job = planJobEscalaSuvico([{
      url: 'https://ejemplo.test/acta',
      cuerpo: 'ESCALA_SUVICO_TABLA\nVIGILADOR_GENERAL|2026-01-01|900000|Vigilador General',
    }]);
    assert.equal(job.accion, 'PROPUESTA');
    assert.equal(job.propuestas[0].status, 'PENDIENTE_APROBACION');
    assert.equal(escalaVigente(job.propuestas, 'VIGILADOR_GENERAL', '2026-10-02'), null);
    const aprobada = aprobarEscala(job.propuestas[0]);
    assert.equal(aprobada.ok, true);
    const r = calcularRemuneracionContrato({
      jornadas: [{ fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 }],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [aprobada.escala],
      incluirCierre: false,
    });
    assert.equal(r.jornadas[0].valorHora, 4500);
    const contrato = { categoria: 'VIGILADOR_GENERAL', jornadas: [{ fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 }] };
    assert.equal(brutoParaTxt({ contrato, escalas: job.propuestas }).codigo, 'RETRIBUCION_PENDIENTE');
    const conEscala = brutoParaTxt({ contrato, escalas: [aprobada.escala] });
    assert.equal(conEscala.ok, true);
    assert.equal(conEscala.bruto, 8 * 4500);
    const linea = lineasCargaMasiva({
      contrato: { fechaAlta: '2026-10-02', fechaBaja: '2026-10-02' },
      cuil,
      bruto: conEscala.bruto,
      obraSocial: '123456',
      empresa: { arcaEventuales: { cctCodigo: '42205', categoriaProfesional: '000001' } },
    });
    assert.equal(linea.lineas[0].slice(57, 72), String(Math.round(conEscala.bruto * 100)).padStart(15, '0'));
  });
});
