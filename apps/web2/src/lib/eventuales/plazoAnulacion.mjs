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
  const code = String(cfg?.situacionRevistaDesistimiento || cfg?.situacionRevistaNoInicio || '30').trim();
  return code || '30';
}

/**
 * Anulación pendiente que ya no entra en la ventana → baja.
 * No toca envíos ya subidos ni los que no son anulación.
 */
export function convertirAnulacionVencida(envio, { ahoraMs, feriados = [], revistaDesistimiento = '30' } = {}) {
  if (!envio || envio.tipo !== 'ANULACION') return { convertir: false };
  if (envio.quitadoDelLote === true) return { convertir: false };
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
      revista: String(revistaDesistimiento || '30'),
      fechaBaja: fechaInicio,
      constanciaInterna: CONSTANCIA_NO_SE_PRESENTO,
      convertidoDe: 'ANULACION',
      convertidoPor: 'VENTANA_VENCIDA',
      confirmarConContador: false,
      regenerarTxt: true,
    },
  };
}
