import { calcularRemuneracionContrato } from './remuneracion.mjs';
import { CATEGORIA_VIGILADOR, EMPRESAS_CATEGORIA_VIGILADOR, RNOS_SUVICO } from './arcaConst.mjs';

/**
 * Registro de posiciones fijas, carga masiva ARCA (130 caracteres).
 * Fuente: docs/arca/CARGA-MASIVA-FORMATO.md y tablas descargadas el 29/09/2026.
 * El 14 de la tabla es período de prueba. Trabajo eventual es el código 12, en 3 posiciones: 012.
 */
export const ARCA_EVENTUALES_DEFAULT = {
  tipoRegistro: '01',
  movimientoAlta: 'AT',
  movimientoBaja: 'BT',
  agropecuario: ' ',
  modalidadContrato: '012',
  situacionRevistaAlta: '01',
  situacionRevistaBaja: '30',
  modalidadLiquidacion: '5',
  sucursal: '00000',
  actividad: '801000',
  puesto: '5414',
  rectificacion: '00',
  /**
   * La anulación de alta no usa un movimiento de baja: va por el módulo de Anulación de
   * Incorporaciones (`plazoAnulacion.mjs`). NA queda solo como código histórico del manual.
   */
  movimientoAnulacion: 'NA',
  /**
   * Revista de la baja cuando venció la anulación. El contador confirmó el código 30
   * (Rescisión / extinción antes del inicio). La retribución de esa baja va en 0:
   * no hay devengamiento de haberes ni de ART. `situacionRevistaDesistimiento` de la
   * empresa lo pisa. `situacionRevistaNoInicio` es el alias viejo.
   */
  situacionRevistaDesistimiento: '30',
  situacionRevistaNoInicio: '30',
  cctCodigo: '',
  categoria: '',
  categoriaProfesional: '',
  tipoServicio: '',
  marcaCovid: '0',
  obraSocialDefault: '',
};

export const LARGO_REGISTRO_ARCA = 130;

export { CATEGORIA_VIGILADOR, RNOS_SUVICO, EMPRESAS_CATEGORIA_VIGILADOR };

export function arcaEventualesDe(empresa) {
  const cfg = { ...ARCA_EVENTUALES_DEFAULT, ...(empresa?.arcaEventuales || {}) };
  const guardada = empresa?.arcaEventuales || {};
  const id = String(empresa?.id || empresa?.empresaId || '');
  const delGrupo = EMPRESAS_CATEGORIA_VIGILADOR.includes(id);
  const categoriaExplicita = 'categoria' in guardada || 'categoriaProfesional' in guardada;
  cfg.categoria = categoriaExplicita
    ? String(guardada.categoria ?? guardada.categoriaProfesional ?? '')
    : (delGrupo ? CATEGORIA_VIGILADOR : '');
  cfg.obraSocialDefault = 'obraSocialDefault' in guardada
    ? String(guardada.obraSocialDefault ?? '')
    : (delGrupo ? RNOS_SUVICO : '');
  return cfg;
}

function alfa(value, len) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').slice(0, len).padEnd(len, ' ');
}

function num(value, len) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.padStart(len, '0').slice(-len);
}

function fechaArca(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return ' '.repeat(10);
  const [y, m, d] = String(iso).split('-');
  return `${y}/${m}/${d}`;
}

function retribucion(bruto) {
  const cents = Math.round(Number(bruto || 0) * 100);
  return String(Math.max(0, cents)).padStart(15, '0').slice(-15);
}

function campoObraSocial(valor) {
  const digits = String(valor ?? '').replace(/\D/g, '');
  if (digits.length === 0) return { texto: ' '.repeat(6), falta: true };
  return { texto: digits.padStart(6, '0').slice(-6), falta: false };
}

function armarLinea({ movimiento, revista, cuil, fechaAlta, fechaBaja, bruto, obraSocial, cfg }) {
  const os = campoObraSocial(obraSocial || cfg.obraSocialDefault);
  const cct = alfa(cfg.cctCodigo, 10);
  const categoria = alfa(String(cfg.categoria || cfg.categoriaProfesional || '').replace(/\D/g, ''), 6);
  const linea = [
    num(cfg.tipoRegistro, 2),
    alfa(movimiento, 2),
    num(cuil, 11),
    alfa(cfg.agropecuario, 1),
    num(cfg.modalidadContrato, 3),
    fechaArca(fechaAlta),
    fechaArca(fechaBaja),
    os.texto,
    num(revista, 2),
    ' '.repeat(10),
    retribucion(bruto),
    num(cfg.modalidadLiquidacion, 1),
    num(cfg.sucursal, 5),
    num(cfg.actividad, 6),
    alfa(cfg.puesto, 4),
    num(cfg.rectificacion, 2),
    cct,
    categoria.trim() ? num(cfg.categoria || cfg.categoriaProfesional, 6) : ' '.repeat(6),
    cfg.tipoServicio ? num(cfg.tipoServicio, 3) : ' '.repeat(3),
    ' '.repeat(10),
    ' '.repeat(10),
    num(cfg.marcaCovid, 1),
  ].join('');
  return { linea, faltaObraSocial: os.falta, faltaCct: cct.trim() === '', faltaCategoria: categoria.trim() === '' };
}

/**
 * Retribución pactada del TXT (posiciones 58-72). Solo entra una escala ACTIVE.
 * Sin escala aprobada el envío no se manda.
 */
export function jornadasDevengables(jornadas) {
  return (jornadas || []).filter((j) => j && j.noSePresento !== true && j.pagaJornada !== false && j.sinDevengamiento !== true);
}

export function brutoParaTxt({ contrato, escalas }) {
  if (contrato?.sinDevengamiento === true || contrato?.noSePresento === true) {
    return { ok: true, codigo: 'SIN_DEVENGAMIENTO', bruto: 0, sinDevengamiento: true };
  }
  const activas = (escalas || []).filter((e) => e && e.status === 'ACTIVE');
  if (!activas.length) return { ok: false, codigo: 'RETRIBUCION_PENDIENTE', bruto: 0 };
  const r = calcularRemuneracionContrato({
    jornadas: jornadasDevengables(contrato?.jornadas),
    categoria: contrato?.categoria || 'VIGILADOR_GENERAL',
    escalas: activas,
    incluirCierre: false,
  });
  if (!r.ok || !(Number(r.bruto) > 0)) return { ok: false, codigo: 'RETRIBUCION_PENDIENTE', bruto: 0 };
  return { ok: true, bruto: r.bruto };
}

/**
 * Una línea suelta (anulación NA o baja por no presentación).
 * La anulación va con bruto 0. La baja por no inicio usa la revista configurable y la fecha de inicio.
 */
export function lineaMovimientoArca({ contrato, cuil, bruto, obraSocial, empresa, movimiento, revista, fechaBaja }) {
  const cfg = arcaEventualesDe(empresa);
  const armada = armarLinea({
    movimiento,
    revista: revista || cfg.situacionRevistaBaja,
    cuil,
    fechaAlta: contrato?.fechaAlta,
    fechaBaja: fechaBaja == null ? contrato?.fechaBaja : fechaBaja,
    bruto,
    obraSocial,
    cfg,
  });
  const advertencias = [];
  if (armada.faltaCct) advertencias.push('CCT_CODIGO_PENDIENTE');
  if (armada.faltaCategoria) advertencias.push('CATEGORIA_PROFESIONAL_PENDIENTE');
  if (armada.faltaObraSocial) advertencias.push('RNOS_PENDIENTE');
  if (String(cfg.puesto) === '5414') advertencias.push('PUESTO_A_VERIFICAR');
  if (movimiento === cfg.movimientoAnulacion) advertencias.push('ANULACION_A_CONFIRMAR_CON_CONTADOR');
  return {
    linea: armada.linea,
    advertencias,
    enviable: advertencias.filter((c) => c !== 'PUESTO_A_VERIFICAR' && c !== 'ANULACION_A_CONFIRMAR_CON_CONTADOR').length === 0
      && armada.linea.length === LARGO_REGISTRO_ARCA,
  };
}

/**
 * Un contrato → línea AT y línea BT. No se envía si faltan CCT, categoría u obra social.
 */
export function lineasCargaMasiva({ contrato, cuil, bruto, obraSocial, empresa }) {
  const cfg = arcaEventualesDe(empresa);
  const comun = {
    cuil,
    fechaAlta: contrato.fechaAlta,
    fechaBaja: contrato.fechaBaja,
    bruto,
    obraSocial,
    cfg,
  };
  const alta = armarLinea({ ...comun, movimiento: cfg.movimientoAlta, revista: cfg.situacionRevistaAlta });
  const baja = armarLinea({ ...comun, movimiento: cfg.movimientoBaja, revista: cfg.situacionRevistaBaja });
  const advertencias = [];
  if (alta.faltaCct) advertencias.push('CCT_CODIGO_PENDIENTE');
  if (alta.faltaCategoria) advertencias.push('CATEGORIA_PROFESIONAL_PENDIENTE');
  if (alta.faltaObraSocial) advertencias.push('RNOS_PENDIENTE');
  if (String(cfg.puesto) === '5414') advertencias.push('PUESTO_A_VERIFICAR');
  return {
    lineas: [alta.linea, baja.linea],
    advertencias,
    enviable: advertencias.filter((c) => c !== 'PUESTO_A_VERIFICAR').length === 0
      && alta.linea.length === LARGO_REGISTRO_ARCA
      && baja.linea.length === LARGO_REGISTRO_ARCA,
  };
}
