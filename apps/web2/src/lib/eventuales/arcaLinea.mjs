import { CATEGORIA_VIGILADOR, EMPRESAS_CATEGORIA_VIGILADOR, RNOS_SUVICO } from './arcaConst.mjs';
import { normalizeCuil } from './cuil.mjs';

/**
 * Formato puro del registro de carga masiva ARCA (130 caracteres). Sin dependencias de Node:
 * lo importan el front (vista previa en Parámetros), `arcaTxt.mjs` y el servidor.
 * Fuente: docs/arca/CARGA-MASIVA-FORMATO.md. Validado contra ARCA el 05/10/2026
 * (novedades 245743/245745, Bacar Transportadora).
 */
export const CCT_CODIGO_VIGILADOR = '0422/05';
export const PUESTO_VIGILADOR = '5169';
export const ACTIVIDAD_DOMICILIO_DEFAULT = '749210';
export const TIPO_SERVICIO_DEFAULT = '500';
/** Domicilio de explotación Bacar Transportadora (74-78). Validado ARCA 05/10 novedad 245745. */
export const DOMICILIO_DESEMPENO_DEFAULT = '00001';

export const ARCA_EVENTUALES_DEFAULT = {
  tipoRegistro: '01',
  movimientoAlta: 'AT',
  movimientoBaja: 'BT',
  /** S o N. ARCA exige uno de los dos; el blanco rechaza. */
  agropecuario: 'N',
  modalidadContrato: '012',
  /** En AT va en blanco (ARCA: no informar situación de baja en un alta). */
  situacionRevistaAlta: '',
  situacionRevistaBaja: '30',
  modalidadLiquidacion: '5',
  /** Domicilio de explotación (posiciones 74-78). Bacar Transportadora: 00001 (validado ARCA 05/10). */
  sucursal: DOMICILIO_DESEMPENO_DEFAULT,
  /** Actividad del domicilio de desempeño (79-84). Tiene que coincidir con la del domicilio en ARCA. */
  actividad: ACTIVIDAD_DOMICILIO_DEFAULT,
  puesto: PUESTO_VIGILADOR,
  /** En AT y BT va en blanco salvo una rectificación real. */
  rectificacion: '',
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
  tipoServicio: TIPO_SERVICIO_DEFAULT,
  /** En blanco: ARCA rechaza 0 («Marca de Covid / Tipo de Contrato CCG no permitido»). */
  marcaCovid: '',
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
  cfg.cctCodigo = 'cctCodigo' in guardada
    ? String(guardada.cctCodigo ?? '')
    : (delGrupo ? CCT_CODIGO_VIGILADOR : '');
  cfg.tipoServicio = 'tipoServicio' in guardada
    ? String(guardada.tipoServicio ?? '')
    : (delGrupo ? TIPO_SERVICIO_DEFAULT : String(cfg.tipoServicio || ''));
  cfg.sucursal = 'sucursal' in guardada
    ? String(guardada.sucursal ?? '')
    : (delGrupo ? DOMICILIO_DESEMPENO_DEFAULT : String(cfg.sucursal || ''));
  return cfg;
}

function alfa(value, len) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').slice(0, len).padEnd(len, ' ');
}

function num(value, len) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.padStart(len, '0').slice(-len);
}

/** Vacío → espacios (AT no admite 00 en revista/rectificación). */
function numOBlank(value, len) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return ' '.repeat(len);
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

function marcaCovidDe(cfg) {
  const v = String(cfg.marcaCovid ?? '').trim();
  if (!v) return ' ';
  return v.slice(0, 1);
}

function armarLinea({ movimiento, revista, cuil, fechaAlta, fechaBaja, bruto, obraSocial, cfg }) {
  const os = campoObraSocial(obraSocial || cfg.obraSocialDefault);
  const cct = alfa(cfg.cctCodigo, 10);
  const categoria = alfa(String(cfg.categoria || cfg.categoriaProfesional || '').replace(/\D/g, ''), 6);
  const cuilDigits = String(cuil ?? '').replace(/\D/g, '');
  const cuilOk = !!normalizeCuil(cuilDigits);
  const puesto = alfa(cfg.puesto, 4);
  const sucursal = String(cfg.sucursal ?? '').replace(/\D/g, '');
  const actividad = String(cfg.actividad ?? '').replace(/\D/g, '');
  const linea = [
    num(cfg.tipoRegistro, 2),
    alfa(movimiento, 2),
    num(cuilDigits, 11),
    alfa(cfg.agropecuario, 1),
    num(cfg.modalidadContrato, 3),
    fechaArca(fechaAlta),
    fechaArca(fechaBaja),
    os.texto,
    numOBlank(revista, 2),
    ' '.repeat(10),
    retribucion(bruto),
    num(cfg.modalidadLiquidacion, 1),
    sucursal ? num(sucursal, 5) : ' '.repeat(5),
    actividad ? num(actividad, 6) : ' '.repeat(6),
    puesto,
    numOBlank(cfg.rectificacion, 2),
    cct,
    categoria.trim() ? num(cfg.categoria || cfg.categoriaProfesional, 6) : ' '.repeat(6),
    cfg.tipoServicio ? num(cfg.tipoServicio, 3) : ' '.repeat(3),
    ' '.repeat(10),
    ' '.repeat(10),
    marcaCovidDe(cfg),
  ].join('');
  return {
    linea,
    faltaObraSocial: os.falta,
    faltaCct: cct.trim() === '',
    faltaCategoria: categoria.trim() === '',
    faltaPuesto: puesto.trim() === '',
    faltaDomicilio: sucursal.length !== 5,
    faltaActividad: actividad.length !== 6,
    cuilInvalido: !cuilOk,
  };
}

function advertenciasDe(armada, cfg, extras = []) {
  const advertencias = [...extras];
  if (armada.cuilInvalido) advertencias.push('CUIL_INVALIDO');
  if (armada.faltaCct) advertencias.push('CCT_CODIGO_PENDIENTE');
  if (armada.faltaCategoria) advertencias.push('CATEGORIA_PROFESIONAL_PENDIENTE');
  if (armada.faltaObraSocial) advertencias.push('RNOS_PENDIENTE');
  if (armada.faltaPuesto) advertencias.push('PUESTO_PENDIENTE');
  if (armada.faltaDomicilio) advertencias.push('DOMICILIO_DESEMPENO_PENDIENTE');
  if (armada.faltaActividad) advertencias.push('ACTIVIDAD_PENDIENTE');
  if (String(cfg.puesto).trim() === PUESTO_VIGILADOR) advertencias.push('PUESTO_A_VERIFICAR');
  return advertencias;
}

function esEnviable(advertencias, ...lineas) {
  const bloquean = advertencias.filter((c) => c !== 'PUESTO_A_VERIFICAR' && c !== 'ANULACION_A_CONFIRMAR_CON_CONTADOR');
  return bloquean.length === 0 && lineas.every((l) => l.length === LARGO_REGISTRO_ARCA);
}

/**
 * Una línea suelta (anulación NA o baja por no presentación).
 * La anulación va con bruto 0. La baja por no inicio usa la revista configurable y la fecha de inicio.
 */
export function lineaMovimientoArca({ contrato, cuil, bruto, obraSocial, empresa, movimiento, revista, fechaBaja }) {
  const cfg = arcaEventualesDe(empresa);
  const armada = armarLinea({
    movimiento,
    revista: revista == null ? cfg.situacionRevistaBaja : revista,
    cuil,
    fechaAlta: contrato?.fechaAlta,
    fechaBaja: fechaBaja == null ? contrato?.fechaBaja : fechaBaja,
    bruto,
    obraSocial,
    cfg,
  });
  const extras = [];
  if (movimiento === cfg.movimientoAnulacion) extras.push('ANULACION_A_CONFIRMAR_CON_CONTADOR');
  const advertencias = advertenciasDe(armada, cfg, extras);
  return {
    linea: armada.linea,
    advertencias,
    enviable: esEnviable(advertencias, armada.linea),
  };
}

/**
 * Un contrato → línea AT y línea BT. No se envía si faltan CCT, categoría, obra social,
 * puesto, domicilio de desempeño, actividad o si el CUIL no cierra.
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
  const advertencias = advertenciasDe(alta, cfg);
  return {
    lineas: [alta.linea, baja.linea],
    advertencias,
    enviable: esEnviable(advertencias, alta.linea, baja.linea),
  };
}
