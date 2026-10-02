/**
 * Tope de horas mensuales de un eventual, por empresa.
 * Mes calendario (1 → fin) o ciclo de liquidación 26→25. Las horas son las del turno
 * (las mismas del bruto/anexo): planificado o realizado cuenta; cancelado, rechazado,
 * vencido, cupo completo y no presentado no.
 */
import { horasDeJornada } from './jornadas.mjs';

export const TOPE_HORAS_DEFAULT = 50;
export const TOPE_AVISO_DESDE = 0.8;
export const TOPE_HORAS_MAX = 400;
export const RESERVA_TOPE_MS = 2 * 60 * 1000;

export const PERIODO_CALENDARIO = 'CALENDARIO';
export const PERIODO_CICLO = 'CICLO_26_25';

const STATUS_NO_CUENTA = new Set([
  'rechazada', 'rechazado', 'vencida', 'vencido', 'cupo_completo',
  'cancelada', 'cancelado', 'inactive', 'vacante',
]);

function pad(n) {
  return String(n).padStart(2, '0');
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** 48 → "48", 7.5 → "7.5". */
export function fmtHoras(n) {
  const r = round2(n);
  if (!Number.isFinite(r)) return '0';
  return String(r);
}

export function normalizarPeriodo(valor) {
  return String(valor || '') === PERIODO_CICLO ? PERIODO_CICLO : PERIODO_CALENDARIO;
}

/** Horas > 0 y ≤ 400. Si no es válido, el default (50) o null si `estricto`. */
export function normalizarTope(valor, fallback = TOPE_HORAS_DEFAULT) {
  const n = round2(valor);
  if (!Number.isFinite(n) || n <= 0 || n > TOPE_HORAS_MAX) return fallback;
  return n;
}

function ymd(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function ultimoDia(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Período que contiene `fecha` (YYYY-MM-DD), inclusive.
 * Calendario: 1 → último día. Ciclo: 26 del mes anterior → 25 (si el día es ≥ 26, arranca ese mes).
 */
export function rangoPeriodo(fecha, periodo) {
  const s = String(fecha || '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (normalizarPeriodo(periodo) === PERIODO_CALENDARIO) {
    return { desde: ymd(y, m, 1), hasta: ymd(y, m, ultimoDia(y, m)), clave: `${y}-${pad(m)}` };
  }
  if (d >= 26) {
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    return { desde: ymd(y, m, 26), hasta: ymd(next.y, next.m, 25), clave: `${y}-${pad(m)}-26` };
  }
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return { desde: ymd(prev.y, prev.m, 26), hasta: ymd(y, m, 25), clave: `${prev.y}-${pad(prev.m)}-26` };
}

/** Tope que manda: la excepción de esa empresa (con motivo) o el de la empresa (default 50). */
export function topeEfectivo(empresa, excepcion) {
  const periodo = normalizarPeriodo(empresa?.eventualesPeriodoHoras);
  const topeEmpresa = normalizarTope(empresa?.eventualesTopeHoras, TOPE_HORAS_DEFAULT);
  const horas = normalizarTope(excepcion?.horas, null);
  const motivo = String(excepcion?.motivo || '').trim();
  if (horas && motivo) return { tope: horas, periodo, excepcion: true, motivo, topeEmpresa };
  return { tope: topeEmpresa, periodo, excepcion: false, motivo: null, topeEmpresa };
}

export function textoHorasMes(usadas, tope) {
  return `${fmtHoras(usadas)}/${fmtHoras(tope)} h este mes`;
}

export function motivoTopeHoras(usadas, tope, horasTurno) {
  return `Supera el tope mensual (${fmtHoras(usadas)}/${fmtHoras(tope)} h, este turno ${fmtHoras(horasTurno)} h)`;
}

/** Horas del turno: el campo (bruto/anexo) y, si falta, el reloj de inicio a fin. */
export function horasDeTurnoEventual(turno) {
  const directo = Number(turno?.hours ?? turno?.horas);
  if (Number.isFinite(directo) && directo > 0) return round2(directo);
  return round2(horasDeJornada({
    horas: 0,
    horaInicio: turno?.horaInicio,
    horaFin: turno?.horaFin,
    fecha: turno?.scheduleDate || turno?.fecha,
  }));
}

/** Planificado o realizado en esa empresa. No cuenta baja, no presentado ni estados de convocatoria que no llegaron a turno. */
export function turnoCuentaParaTope(turno, empresaId) {
  if (!turno || String(turno.empresaId || '') !== String(empresaId || '')) return false;
  const code = String(turno.code || '').trim().toUpperCase();
  const origin = String(turno.origin || '').trim().toUpperCase();
  const esEv = turno.esEventual === true || code === 'EV' || origin === 'EVENTO';
  if (!esEv) return false;
  if (turno.isDeleted === true || turno.isUnassigned === true || turno.isFranco === true) return false;
  if (turno.isAbsent === true || turno.pagaJornada === false || turno.noSePresento === true) return false;
  const status = String(turno.status || '').trim().toLowerCase();
  if (STATUS_NO_CUENTA.has(status)) return false;
  return true;
}

function horaClave(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  return `${pad(Number(m[1]))}:${m[2]}`;
}

function claveTurno(turno) {
  const fecha = String(turno?.scheduleDate || turno?.fecha || '').slice(0, 10);
  const hora = horaClave(turno?.horaInicio);
  return fecha && hora ? `${fecha}|${hora}` : '';
}

/**
 * Horas ya comprometidas en [desde, hasta]: turnos que cuentan + reservas de aceptación
 * todavía vigentes que no tienen ya su turno (dos aceptaciones a la vez no se pisan).
 */
export function horasComprometidas({ turnos, reservas, empresaId, desde, hasta, excluirIds, ahoraMs, jornadasNuevas }) {
  const excluir = excluirIds instanceof Set ? excluirIds : new Set(excluirIds || []);
  const clavesNuevas = new Set((jornadasNuevas || []).map((j) => {
    const hora = horaClave(j.horaInicio);
    return hora ? `${String(j.fecha || '').slice(0, 10)}|${hora}` : '';
  }).filter(Boolean));
  const claves = new Set();
  let total = 0;
  for (const turno of turnos || []) {
    if (excluir.has(String(turno.id || ''))) continue;
    const fecha = String(turno.scheduleDate || turno.fecha || '').slice(0, 10);
    if (!fecha || fecha < desde || fecha > hasta) continue;
    if (!turnoCuentaParaTope(turno, empresaId)) continue;
    total += horasDeTurnoEventual(turno);
    const clave = claveTurno(turno);
    if (clave) claves.add(clave);
  }
  for (const reserva of reservas || []) {
    if (String(reserva?.empresaId || '') !== String(empresaId || '')) continue;
    const fecha = String(reserva.fecha || '').slice(0, 10);
    if (!fecha || fecha < desde || fecha > hasta) continue;
    if (reserva.venceAtMs && ahoraMs && Number(reserva.venceAtMs) < ahoraMs) continue;
    const hora = horaClave(reserva.horaInicio);
    const clave = hora ? `${fecha}|${hora}` : '';
    if (claves.has(clave) || clavesNuevas.has(clave)) continue;
    total += Number(reserva.horas) || 0;
  }
  return round2(total);
}

export function evaluarTope({ usadas, tope, horasTurno }) {
  const u = round2(usadas);
  const t = round2(tope);
  const h = round2(horasTurno);
  const proyectadas = round2(u + h);
  const supera = t > 0 && proyectadas > t + 1e-9;
  const aviso = t > 0 && !supera && u / t >= TOPE_AVISO_DESDE;
  return {
    usadas: u,
    tope: t,
    horasTurno: h,
    proyectadas,
    supera,
    aviso,
    texto: textoHorasMes(u, t),
    motivo: supera ? motivoTopeHoras(u, t, h) : null,
  };
}

/**
 * Jornadas nuevas agrupadas por período. Devuelve la evaluación que supera el tope,
 * o si ninguna lo hace, la del período más cargado (para el aviso del 80%).
 */
export function evaluarJornadasContraTope({ turnos, reservas, empresaId, jornadas, periodo, tope, excluirIds, ahoraMs }) {
  const grupos = new Map();
  for (const jornada of jornadas || []) {
    const fecha = String(jornada?.fecha || '').slice(0, 10);
    const rango = rangoPeriodo(fecha, periodo);
    if (!rango) continue;
    const g = grupos.get(rango.clave) || { ...rango, horasNuevas: 0 };
    g.horasNuevas += horasDeTurnoEventual(jornada);
    grupos.set(rango.clave, g);
  }
  let peor = null;
  for (const g of grupos.values()) {
    const usadas = horasComprometidas({
      turnos, reservas, empresaId, desde: g.desde, hasta: g.hasta, excluirIds, ahoraMs, jornadasNuevas: jornadas,
    });
    const ev = { ...evaluarTope({ usadas, tope, horasTurno: g.horasNuevas }), desde: g.desde, hasta: g.hasta, clave: g.clave };
    if (ev.supera) return ev;
    if (!peor || ev.proyectadas > peor.proyectadas) peor = ev;
  }
  return peor;
}

/** Reservas vigentes, sin la que ya tiene turno y sin las vencidas. */
export function reservasVigentes(reservas, ahoraMs) {
  return (reservas || []).filter((r) => !r?.venceAtMs || Number(r.venceAtMs) >= ahoraMs);
}
