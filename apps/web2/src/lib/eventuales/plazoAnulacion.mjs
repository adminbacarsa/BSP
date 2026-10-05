/**
 * Plazo para anular un alta ya informada (RG 2988/2010 art. 9, Simplificación Registral).
 * Fechas en hora de Argentina (UTC−3, sin horario de verano).
 *
 * - Día hábil y el turno empieza antes de las 17:00: hasta las 24:00 de ese mismo día.
 * - Turno noche (inicio ≥ 17:00) en día hábil: hasta las 12:00 del día siguiente.
 * - Fecha de inicio inhábil (sábado, domingo o feriado nacional): hasta las 12:00
 *   del primer día hábil siguiente. Esta regla gana sobre el turno noche.
 *
 * La anulación es el módulo de Anulación de Incorporaciones: no es una baja y no lleva
 * código de motivo. Vencida la ventana, la baja usa la fecha prevista de inicio.
 */

export const HORA_CORTE_TURNO_NOCHE = 17 * 60;
export const MODULO_ANULACION_INCORPORACIONES = 'ANULACION_INCORPORACIONES';
export const MOTIVO_BAJA_SIN_EFECTIVIZACION = 'desistimiento / sin efectivización de tareas';
export const CONSTANCIA_NO_SE_PRESENTO = 'NO_SE_PRESENTO';
/** Código de motivo confirmado por el contador: 30 = Rescisión / extinción antes del inicio. */
export const CODIGO_MOTIVO_BAJA_NO_PRESENTACION = '30';
/** Observación interna del envío y del legajo. No sale en el TXT. */
export const OBSERVACION_INTERNA_NO_PRESENTACION = 'Sin efectivización de tareas / No presentación al primer turno';
/** El TXT por lote no se arma: la anula el robot, o RRHH si quedó MANUAL. */
export const CARGA_ANULACION_MANUAL = 'MANUAL_WEB';
export const PASOS_ANULACION_MANUAL = [
  'Entrá a ARCA con la clave fiscal de la empresa.',
  'Abrí Simplificación Registral → Relaciones Laborales → Anular Registro.',
  'Cargá el CUIL de 11 dígitos, la fecha de inicio AAAAMMDD (la misma del alta) y el número de transacción del alta original.',
  'Confirmá. ARCA entrega el acuse en el acto.',
  'Pegá ese acuse acá. El envío queda ANULADO. Si el plazo vence sin acuse, pasa solo a baja código 30.',
];

function pad(n) {
  return String(n).padStart(2, '0');
}

export function sumarDias(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function diaSemana(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Sábado o domingo. */
export function esFinDeSemana(ymd) {
  const dia = diaSemana(ymd);
  return dia === 0 || dia === 6;
}

/**
 * Fechas YYYY-MM-DD de feriados nacionales. Ignora el marcador de sistema
 * (`CONFIG_YEAR`, `type: System`, `YYYY-01-00`) y los que no son nacionales.
 */
export function fechasFeriadosNacionales(feriados) {
  const out = [];
  for (const raw of feriados || []) {
    const row = typeof raw === 'string' ? { date: raw } : (raw || {});
    const date = String(row.date || row.fecha || '').slice(0, 10);
    const type = String(row.type || row.tipo || 'Nacional');
    const name = String(row.name || row.nombre || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date.endsWith('-01-00')) continue;
    if (type === 'System' || name === 'CONFIG_YEAR') continue;
    if (type !== 'Nacional') continue;
    out.push(date);
  }
  return out;
}

export function avisoFeriadosAnio(fechas, anio) {
  const year = String(anio || '');
  if (!year) return null;
  if ((fechas || []).some((f) => String(f).startsWith(year))) return null;
  return `No hay feriados nacionales cargados para ${year} (RRHH → Feriados). El plazo no contempla feriados hasta importarlos.`;
}

function esInhabil(ymd, set) {
  return esFinDeSemana(ymd) || set.has(ymd);
}

function primerHabilSiguiente(ymd, set) {
  let f = sumarDias(ymd, 1);
  while (esInhabil(f, set)) f = sumarDias(f, 1);
  return f;
}

function minutosDeHora(horaInicio) {
  const m = String(horaInicio || '08:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 8 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Instante inclusive de cierre. `24:00` es las 00:00 del día siguiente. */
export function instanteAr(ymd, hora) {
  if (hora === '24:00') return new Date(`${sumarDias(ymd, 1)}T00:00:00.000-03:00`).getTime();
  const m = String(hora).match(/^(\d{1,2}):(\d{2})$/);
  const hh = pad(m ? Number(m[1]) : 0);
  const mm = pad(m ? Number(m[2]) : 0);
  return new Date(`${ymd}T${hh}:${mm}:00.000-03:00`).getTime();
}

/**
 * @returns {{ puedeAnular: boolean, venceMs: number, venceFecha: string, venceHora: string, regla: 'MISMO_DIA'|'NOCHE'|'INHABIL', avisoFeriados: string|null }}
 */
export function plazoAnulacionAlta({ fechaInicio, horaInicio = '08:00', ahoraMs, feriados = [] }) {
  const fecha = String(fechaInicio || '').slice(0, 10);
  const fechas = fechasFeriadosNacionales(feriados);
  const set = new Set(fechas);
  const avisoFeriados = avisoFeriadosAnio(fechas, fecha.slice(0, 4));
  let regla;
  let venceFecha;
  let venceHora;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { puedeAnular: false, venceMs: 0, venceFecha: '', venceHora: '', regla: 'MISMO_DIA', avisoFeriados };
  }
  if (esInhabil(fecha, set)) {
    regla = 'INHABIL';
    venceFecha = primerHabilSiguiente(fecha, set);
    venceHora = '12:00';
  } else if (minutosDeHora(horaInicio) >= HORA_CORTE_TURNO_NOCHE) {
    regla = 'NOCHE';
    venceFecha = sumarDias(fecha, 1);
    venceHora = '12:00';
  } else {
    regla = 'MISMO_DIA';
    venceFecha = fecha;
    venceHora = '24:00';
  }
  const venceMs = instanteAr(venceFecha, venceHora);
  return {
    puedeAnular: Number(ahoraMs) <= venceMs,
    venceMs,
    venceFecha,
    venceHora,
    regla,
    avisoFeriados,
  };
}

export function revistaDesistimientoDe(cfg) {
  const code = String(cfg?.situacionRevistaDesistimiento || cfg?.situacionRevistaNoInicio || CODIGO_MOTIVO_BAJA_NO_PRESENTACION).trim();
  return code || CODIGO_MOTIVO_BAJA_NO_PRESENTACION;
}

/** YYYY-MM-DD → AAAAMMDD. Vacío si la fecha no es la del alta. */
export function fechaAaaammdd(iso) {
  const ymd = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd.replace(/-/g, '') : '';
}

export function cuil11(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : '';
}

/** Datos que el contador carga en «Anular Registro». */
export function datosAnulacionManual(envio) {
  return {
    cuil: cuil11(envio?.bolsaCuil || envio?.cuil),
    fechaInicio: fechaAaaammdd(envio?.fechaInicio || envio?.fechaAlta),
    nroTransaccionAlta: String(envio?.nroTransaccionAlta || '').trim(),
    venceMs: Number(envio?.venceAnulacionMs) || 0,
    pasos: PASOS_ANULACION_MANUAL,
  };
}

/** Cuenta regresiva del plazo RG 2988. `ms` es lo que falta. */
export function cuentaRegresivaAnulacion(venceMs, ahoraMs) {
  const vence = Number(venceMs) || 0;
  if (!vence) return { vencido: false, texto: 'Sin plazo cargado', ms: 0 };
  const ms = vence - (Number(ahoraMs) || 0);
  if (ms <= 0) return { vencido: true, texto: 'Plazo vencido: pasa a baja código 30', ms: 0 };
  const totalMin = Math.floor(ms / 60000);
  const dias = Math.floor(totalMin / (60 * 24));
  const horas = Math.floor((totalMin % (60 * 24)) / 60);
  const min = totalMin % 60;
  const partes = [];
  if (dias > 0) partes.push(`${dias} d`);
  if (horas > 0 || dias > 0) partes.push(`${horas} h`);
  partes.push(`${String(min).padStart(2, '0')} min`);
  return { vencido: false, texto: partes.join(' '), ms };
}

export function motivoAnulacionLegible(codigo) {
  if (codigo === 'ROBOT_FALLO_2') return 'el robot falló 2 veces';
  if (codigo === 'MENOS_DE_2H') return 'faltan menos de 2 horas';
  if (codigo === 'FALTAN_DATOS') return 'faltan CUIL, fecha o la empresa representada';
  if (!codigo) return 'revisar en ARCA';
  return String(codigo);
}

/** Texto de la pantalla ARCA pendientes. El acuse a mano queda solo en MANUAL. */
export function textoEstadoAnulacion(envio) {
  if (envio?.estado === 'ANULADO' || envio?.acuseAnulacion) {
    return `Anulada (acuse ${envio.acuseAnulacion || '—'})`;
  }
  if (envio?.estado === 'MANUAL') {
    return `Requiere acción manual (${motivoAnulacionLegible(envio.manualMotivo)})`;
  }
  return 'Anulación automática en curso';
}

export function acuseAnulacionValido(acuse) {
  const texto = String(acuse || '').trim();
  if (texto.length < 3) return { ok: false, codigo: 'FALTA_ACUSE' };
  if (texto.length > 120) return { ok: false, codigo: 'ACUSE_LARGO' };
  return { ok: true, acuse: texto };
}

export function observacionesConInasistencia(actual) {
  const prev = String(actual || '').trim();
  if (prev.includes(OBSERVACION_INTERNA_NO_PRESENTACION)) return prev;
  return prev ? `${prev}\n${OBSERVACION_INTERNA_NO_PRESENTACION}` : OBSERVACION_INTERNA_NO_PRESENTACION;
}

/**
 * Haberes y ART que se pueden exportar. El no presentado (anexo sin efecto, jornada
 * no pagada o baja por no efectivización) devenga 0 y no genera ART.
 */
export function devengamientoExportable(doc) {
  if (!doc || doc.sinEfecto === true || doc.sinDevengamiento === true || doc.pagaJornada === false || doc.noSePresento === true) {
    return { bruto: 0, art: false, motivo: 'SIN_EFECTIVIZACION' };
  }
  const bruto = Number(doc.bruto);
  const hay = Number.isFinite(bruto) && bruto > 0;
  return { bruto: hay ? bruto : 0, art: hay, motivo: null };
}

/**
 * Anulación pendiente que ya no entra en la ventana → baja.
 * No toca envíos ya subidos ni los que no son anulación.
 */
export function convertirAnulacionVencida(envio, { ahoraMs, feriados = [], revistaDesistimiento = CODIGO_MOTIVO_BAJA_NO_PRESENTACION } = {}) {
  if (!envio || envio.tipo !== 'ANULACION') return { convertir: false };
  if (envio.quitadoDelLote === true) return { convertir: false };
  if (envio.estado === 'ANULADO' || envio.acuseAnulacion) return { convertir: false };
  if (!['PENDIENTE', 'ERROR', 'MANUAL'].includes(String(envio.estado || ''))) return { convertir: false };
  const fechaInicio = String(envio.fechaInicio || envio.fechaAlta || '').slice(0, 10);
  const plazo = plazoAnulacionAlta({
    fechaInicio,
    horaInicio: envio.horaInicio || '08:00',
    ahoraMs,
    feriados,
  });
  if (plazo.puedeAnular) return { convertir: false, plazo };
  return {
    convertir: true,
    plazo,
    patch: {
      tipo: 'BAJA_NO_PRESENTACION',
      movimiento: 'BT',
      lote: 'BT',
      modulo: null,
      motivo: MOTIVO_BAJA_SIN_EFECTIVIZACION,
      revista: String(revistaDesistimiento || CODIGO_MOTIVO_BAJA_NO_PRESENTACION),
      fechaBaja: fechaInicio,
      constanciaInterna: CONSTANCIA_NO_SE_PRESENTO,
      observacionesInternas: OBSERVACION_INTERNA_NO_PRESENTACION,
      sinDevengamiento: true,
      devengaArt: false,
      bruto: 0,
      convertidoDe: 'ANULACION',
      convertidoPor: 'VENTANA_VENCIDA',
      confirmarConContador: false,
      regenerarTxt: true,
    },
  };
}
