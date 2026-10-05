import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LARGO_REGISTRO_ARCA, brutoParaTxt, lineaMovimientoArca, lineasCargaMasiva } from './arcaTxt.mjs';
import { calcularRemuneracionContrato, escalaVigente } from './remuneracion.mjs';
import { aprobarEscala, parsearEscalaSuvico, planJobEscalaSuvico } from './escalaPropuesta.mjs';

const contrato = { fechaAlta: '2026-10-02', fechaBaja: '2026-10-04' };
/** CUIL con dígito verificador válido. */
const cuil = '20111111112';
const cuilInvalido = '20999999991';

describe('TXT ARCA posiciones fijas', () => {
  it('arma AT y BT de 130 con los códigos validados por ARCA el 05/10', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '123456',
      empresa: {
        arcaEventuales: {
          cctCodigo: '0422/05',
          categoriaProfesional: '000001',
          puesto: '5169',
          actividad: '749210',
          tipoServicio: '500',
          agropecuario: 'N',
        },
      },
    });
    const [alta, baja] = out.lineas;
    assert.equal(alta.length, LARGO_REGISTRO_ARCA);
    assert.equal(baja.length, LARGO_REGISTRO_ARCA);
    assert.equal(alta.slice(0, 2), '01');
    assert.equal(alta.slice(2, 4), 'AT');
    assert.equal(alta.slice(4, 15), cuil);
    assert.equal(alta.slice(15, 16), 'N');
    assert.equal(alta.slice(16, 19), '012');
    assert.equal(alta.slice(19, 29), '2026/10/02');
    assert.equal(alta.slice(29, 39), '2026/10/04');
    assert.equal(alta.slice(39, 45), '123456');
    assert.equal(alta.slice(45, 47), '  ');
    assert.equal(alta.slice(47, 57), '          ');
    assert.equal(alta.slice(57, 72), '000000000800000');
    assert.equal(alta.slice(72, 73), '5');
    assert.equal(alta.slice(73, 78), '00000');
    assert.equal(alta.slice(78, 84), '749210');
    assert.equal(alta.slice(84, 88), '5169');
    assert.equal(alta.slice(88, 90), '  ');
    assert.equal(alta.slice(90, 100), '0422/05   ');
    assert.equal(alta.slice(106, 109), '500');
    assert.equal(alta.slice(109, 119), '          ');
    assert.equal(alta.slice(119, 129), '          ');
    assert.equal(alta.slice(129, 130), ' ');
    assert.equal(baja.slice(2, 4), 'BT');
    assert.equal(baja.slice(15, 16), 'N');
    assert.equal(baja.slice(45, 47), '30');
    assert.equal(baja.slice(88, 90), '  ');
    assert.equal(baja.slice(129, 130), ' ');
    assert.equal(out.enviable, true);
    assert.equal(out.advertencias.includes('PUESTO_A_VERIFICAR'), true);
  });

  it('rechaza CUIL con dígito verificador inválido', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil: cuilInvalido,
      bruto: 1000,
      obraSocial: '123456',
      empresa: { id: 'bacarsa' },
    });
    assert.equal(out.enviable, false);
    assert.equal(out.advertencias.includes('CUIL_INVALIDO'), true);
    assert.equal(out.lineas[0].slice(4, 15), cuilInvalido);
  });

  it('anulación NA sin remuneración y baja por no inicio el día fijado', () => {
    const empresa = { arcaEventuales: { cctCodigo: '0422/05', categoriaProfesional: '000001', situacionRevistaNoInicio: '30' } };
    const anula = lineaMovimientoArca({ contrato, cuil, bruto: 0, obraSocial: '123456', empresa, movimiento: 'NA', revista: '', fechaBaja: '' });
    assert.equal(anula.linea.length, LARGO_REGISTRO_ARCA);
    assert.equal(anula.linea.slice(2, 4), 'NA');
    assert.equal(anula.linea.slice(29, 39), '          ');
    assert.equal(anula.linea.slice(45, 47), '  ');
    assert.equal(anula.linea.slice(57, 72), '000000000000000');
    assert.equal(anula.advertencias.includes('ANULACION_A_CONFIRMAR_CON_CONTADOR'), true);
    const baja = lineaMovimientoArca({
      contrato, cuil, bruto: 8000, obraSocial: '123456', empresa, movimiento: 'BT', revista: '30', fechaBaja: '2026-10-02',
    });
    assert.equal(baja.linea.slice(2, 4), 'BT');
    assert.equal(baja.linea.slice(19, 29), '2026/10/02');
    assert.equal(baja.linea.slice(29, 39), '2026/10/02');
    assert.equal(baja.linea.slice(45, 47), '30');
    assert.equal(baja.enviable, true);
    const sinHaberes = lineaMovimientoArca({
      contrato, cuil, bruto: 0, obraSocial: '123456', empresa, movimiento: 'BT', revista: '30', fechaBaja: '2026-10-02',
    });
    assert.equal(sinHaberes.linea.slice(57, 72), '000000000000000');
    assert.equal(brutoParaTxt({ contrato: { ...contrato, sinDevengamiento: true }, escalas: [{ status: 'ACTIVE', basicoMensual: 1 }] }).bruto, 0);
  });

  it('no se envía si faltan el código de convenio y la categoría', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 0,
      empresa: { arcaEventuales: { cctCodigo: '', categoria: '', obraSocialDefault: '', puesto: '', sucursal: '', actividad: '' } },
    });
    assert.equal(out.lineas[0].slice(16, 19), '012');
    assert.equal(out.enviable, false);
    assert.equal(out.advertencias.includes('CCT_CODIGO_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('CATEGORIA_PROFESIONAL_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('RNOS_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('PUESTO_PENDIENTE'), true);
    assert.equal(out.advertencias.includes('DOMICILIO_DESEMPENO_PENDIENTE'), true);
  });

  it('Vigilador trae 033104, CCT 0422/05, puesto 5169 y actividad 749210', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '112233',
      empresa: { id: 'bacarsa' },
    });
    assert.equal(out.lineas[0].slice(90, 100), '0422/05   ');
    assert.equal(out.lineas[0].slice(100, 106), '033104');
    assert.equal(out.lineas[0].slice(78, 84), '749210');
    assert.equal(out.lineas[0].slice(84, 88), '5169');
    assert.equal(out.lineas[0].slice(106, 109), '500');
    assert.equal(out.advertencias.includes('CCT_CODIGO_PENDIENTE'), false);
    assert.equal(out.advertencias.includes('PUESTO_A_VERIFICAR'), true);
    assert.equal(out.enviable, true);
    const editada = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '112233',
      empresa: { id: 'grupos_bacar_sa', arcaEventuales: { categoria: '999999', cctCodigo: '0422/05', puesto: '9152' } },
    });
    assert.equal(editada.lineas[0].slice(100, 106), '999999');
    assert.equal(editada.lineas[0].slice(84, 88), '9152');
    assert.equal(editada.advertencias.includes('PUESTO_A_VERIFICAR'), false);
  });

  it('el RNOS default de SUVICO es 122807 y la persona lo pisa', () => {
    const out = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      empresa: { id: 'pruebas_sa' },
    });
    assert.equal(out.lineas[0].slice(39, 45), '122807');
    assert.equal(out.advertencias.includes('RNOS_PENDIENTE'), false);
    const personal = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      obraSocial: '999999',
      empresa: { id: 'bacarsa' },
    });
    assert.equal(personal.lineas[0].slice(39, 45), '999999');
    const sinNada = lineasCargaMasiva({
      contrato,
      cuil,
      bruto: 8000,
      empresa: { id: 'bacarsa', arcaEventuales: { obraSocialDefault: '' } },
    });
    assert.equal(sinNada.advertencias.includes('RNOS_PENDIENTE'), true);
    assert.equal(sinNada.enviable, false);
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
    const contratoLocal = { categoria: 'VIGILADOR_GENERAL', jornadas: [{ fecha: '2026-10-02', horaInicio: '08:00', horaFin: '16:00', horas: 8 }] };
    assert.equal(brutoParaTxt({ contrato: contratoLocal, escalas: job.propuestas }).codigo, 'RETRIBUCION_PENDIENTE');
    const conEscala = brutoParaTxt({ contrato: contratoLocal, escalas: [aprobada.escala] });
    assert.equal(conEscala.ok, true);
    assert.equal(conEscala.bruto, 8 * 4500);
    const linea = lineasCargaMasiva({
      contrato: { fechaAlta: '2026-10-02', fechaBaja: '2026-10-02' },
      cuil,
      bruto: conEscala.bruto,
      obraSocial: '123456',
      empresa: { arcaEventuales: { cctCodigo: '0422/05', categoriaProfesional: '000001' } },
    });
    assert.equal(linea.lineas[0].slice(57, 72), String(Math.round(conEscala.bruto * 100)).padStart(15, '0'));
  });
});
