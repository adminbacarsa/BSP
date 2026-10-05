import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LARGO_REGISTRO_ARCA, lineasCargaMasiva } from './arcaTxt.mjs';
import { calcularRemuneracionContrato } from './remuneracion.mjs';
import {
  AVISO_ACTIVIDAD_DOMICILIO, AVISO_CCT_PENDIENTE, validarParametrosArca, valoresArcaDe, vistaPreviaArca,
} from './arcaParametros.mjs';

const COMPLETO = {
  cctCodigo: '0422/05',
  categoria: '033104',
  modalidadContrato: '012',
  obraSocialDefault: '122807',
  situacionRevistaDesistimiento: '30',
  situacionRevistaBaja: '30',
  puesto: '5169',
  sucursal: '00000',
  actividad: '749210',
  tipoServicio: '500',
  agropecuario: 'N',
  nocturnoPct: '13.33',
};

describe('parámetros ARCA de la empresa', () => {
  it('rechaza formato y acepta el CCT vacío o NNNN/NN', () => {
    const corto = validarParametrosArca({ ...COMPLETO, categoria: '33104' });
    assert.equal(corto.ok, false);
    assert.equal(corto.errores.some((e) => e.id === 'categoria'), true);
    const malo = validarParametrosArca({ ...COMPLETO, cctCodigo: '42205' });
    assert.equal(malo.ok, false);
    assert.equal(malo.errores[0].id, 'cctCodigo');
    const largo = validarParametrosArca({ ...COMPLETO, cctCodigo: '0422/055' });
    assert.equal(largo.ok, false);
    const pct = validarParametrosArca({ ...COMPLETO, nocturnoPct: '150' });
    assert.equal(pct.ok, false);
    const vacio = validarParametrosArca({ ...COMPLETO, cctCodigo: '  ', nocturnoPct: '' });
    assert.equal(vacio.ok, true);
    assert.equal(vacio.doc.cctCodigo, '');
    assert.equal(vacio.doc.nocturnoPct, null);
    assert.equal(vacio.doc.categoriaProfesional, '033104');
    assert.equal(vacio.doc.situacionRevistaNoInicio, '30');
    const vista = vistaPreviaArca(vacio.doc);
    assert.equal(vista.avisoCct, AVISO_CCT_PENDIENTE);
    assert.equal(vista.avisoActividad, AVISO_ACTIVIDAD_DOMICILIO);
    assert.equal(vista.enviable, false);
    assert.equal(vista.advertencias.includes('CCT_CODIGO_PENDIENTE'), true);
    assert.equal(vista.linea.length, LARGO_REGISTRO_ARCA);
    const ok = validarParametrosArca(COMPLETO);
    assert.equal(ok.ok, true);
    assert.equal(ok.doc.cctCodigo, '0422/05');
  });

  it('el TXT de alta y de baja usa los códigos editados', () => {
    const editado = validarParametrosArca({
      ...COMPLETO,
      cctCodigo: '0422/05',
      categoria: '033104',
      modalidadContrato: '012',
      obraSocialDefault: '122807',
      situacionRevistaBaja: '31',
      situacionRevistaDesistimiento: '30',
      puesto: '9152',
      sucursal: '00012',
      actividad: '749210',
      tipoServicio: '500',
      agropecuario: 'N',
    });
    assert.equal(editado.ok, true);
    const out = lineasCargaMasiva({
      contrato: { fechaAlta: '2026-10-02', fechaBaja: '2026-10-03' },
      cuil: '20111111112',
      bruto: 1000,
      obraSocial: editado.doc.obraSocialDefault,
      empresa: { arcaEventuales: editado.doc },
    });
    const [alta, baja] = out.lineas;
    assert.equal(out.enviable, true);
    assert.equal(alta.slice(15, 16), 'N');
    assert.equal(alta.slice(16, 19), '012');
    assert.equal(alta.slice(39, 45), '122807');
    assert.equal(alta.slice(45, 47), '  ');
    assert.equal(alta.slice(73, 78), '00012');
    assert.equal(alta.slice(78, 84), '749210');
    assert.equal(alta.slice(84, 88), '9152');
    assert.equal(alta.slice(88, 90), '  ');
    assert.equal(alta.slice(90, 100), '0422/05   ');
    assert.equal(alta.slice(100, 106), '033104');
    assert.equal(alta.slice(106, 109), '500');
    assert.equal(alta.slice(129, 130), ' ');
    assert.equal(baja.slice(45, 47), '31');
    const previa = vistaPreviaArca(editado.doc);
    assert.equal(previa.linea, alta);
    assert.equal(previa.enviable, true);
    assert.equal(previa.avisoCct, '');
    assert.equal(previa.avisoActividad, AVISO_ACTIVIDAD_DOMICILIO);
  });

  it('una empresa del grupo muestra los defaults validados por ARCA', () => {
    const valores = valoresArcaDe({ id: 'bacarsa', arcaEventuales: {} });
    assert.equal(valores.categoria, '033104');
    assert.equal(valores.obraSocialDefault, '122807');
    assert.equal(valores.modalidadContrato, '012');
    assert.equal(valores.cctCodigo, '0422/05');
    assert.equal(valores.puesto, '5169');
    assert.equal(valores.actividad, '749210');
    assert.equal(valores.tipoServicio, '500');
    assert.equal(valores.agropecuario, 'N');
    assert.equal(valores.sucursal, '00000');
    assert.equal(valores.nocturnoPct, '');
  });

  it('el anexo usa el % de la empresa si la escala no trae nocturnidad', () => {
    const escala = {
      convenio: 'CCT_422_05',
      categoria: 'VIGILADOR_GENERAL',
      categoriaLabel: 'Vigilador General',
      vigenciaDesde: '2026-04-01',
      basicoMensual: 200000,
      divisorHoras: 200,
      jornadaOrdinariaHoras: 8,
      recargos: { nocturnoPct: null, extra50Pct: 50, extra100Pct: 100 },
      status: 'ACTIVE',
    };
    const jornada = { fecha: '2026-10-02', horaInicio: '22:00', horaFin: '06:00', horas: 8 };
    const sin = calcularRemuneracionContrato({ jornadas: [jornada], categoria: 'VIGILADOR_GENERAL', escalas: [escala], incluirCierre: false });
    assert.equal(sin.advertencias.some((a) => a.codigo === 'RECARGO_NOCTURNO_SIN_PORCENTAJE'), true);
    const con = calcularRemuneracionContrato({
      jornadas: [jornada], categoria: 'VIGILADOR_GENERAL', escalas: [escala], incluirCierre: false, nocturnoPct: 20,
    });
    assert.equal(con.jornadas[0].recargoNocturno, 1600);
    assert.equal(con.advertencias.some((a) => a.codigo === 'RECARGO_NOCTURNO_SIN_PORCENTAJE'), false);
    const mandaLaEscala = calcularRemuneracionContrato({
      jornadas: [jornada],
      categoria: 'VIGILADOR_GENERAL',
      escalas: [{ ...escala, recargos: { ...escala.recargos, nocturnoPct: 20 } }],
      incluirCierre: false,
      nocturnoPct: 50,
    });
    assert.equal(mandaLaEscala.jornadas[0].recargoNocturno, 1600);
  });
});
