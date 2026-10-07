/**
 * Consulta de disponibilidad para guardias propios (nómina).
 * Franco del día = FT; RET y sin turno = cobertura normal. Sin contrato ni ARCA.
 * Misma decisión que `evaluateCoverageDayGuards`: licencia bloquea, descanso < 8 h bloquea,
 * descanso 8–12 h y tope > 200 h piden PIN. El PIN se concede al enviar y queda en la consulta.
 */
import { reservarLugar } from './consultaDisponibilidad.mjs';

export const FRANCO_CODES = ['F', 'FF', 'FP'];
export const LICENCIA_CODES = ['V', 'L', 'E', 'A', 'AA', 'PG', 'ART'];
const FRANCO = new Set(FRANCO_CODES);
const LICENCIA = new Set(LICENCIA_CODES);
const CAP_DEFAULT = 200;

/**
 * Regla de Mauro (06/10) para la cobertura en Planificación:
 * RET, guardia sin turno (libre), ESC y REF se ASIGNAN directo y reciben el aviso de turno asignado
 * al guardar; al franco (FT) y al eventual SOLO se les consulta. No hay asignación directa para ellos.
 */
export const TIPOS_ASIGNAN_DIRECTO = ['RET', 'LIBRE', 'ESC', 'REF'];
export const TIPOS_SOLO_CONSULTA = ['FT', 'EVENTUAL'];
export const MOTIVO_SE_ASIGNA_DIRECTO = 'Se asigna directo, no se consulta.';
export const MOTIVO_SOLO_CONSULTA = 'Solo se consulta, no se asigna directo.';

/** 'asignar' (RET · libre · ESC · REF) o 'preguntar' (franco · eventual). */
export function accionPorTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (TIPOS_SOLO_CONSULTA.includes(t)) return 'preguntar';
  if (TIPOS_ASIGNAN_DIRECTO.includes(t)) return 'asignar';
  return null;
}

export function seConsultaGuardia(tipo) {
  return accionPorTipo(tipo) === 'preguntar';
}

export function seAsignaDirecto(tipo) {
  return accionPorTipo(tipo) === 'asignar';
}

/** Motivo con el que el servidor y la pantalla rechazan consultar a quien se asigna directo. */
export function motivoNoConsultable(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (seConsultaGuardia(t)) return null;
  const quien = t === 'RET' ? 'El retén' : t === 'ESC' ? 'El turno escuela' : t === 'REF' ? 'El refuerzo' : t === 'LIBRE' ? 'El guardia sin turno' : 'Ese guardia';
  return `${quien} ${MOTIVO_SE_ASIGNA_DIRECTO.charAt(0).toLowerCase()}${MOTIVO_SE_ASIGNA_DIRECTO.slice(1)}`;
}

/** Aviso que recibe el guardia asignado directo cuando se guarda el cronograma (bandeja + push si hay app). */
export function textoAvisoAsignado({ fecha, code, horario, puesto }) {
  const banda = [String(code || '').trim(), String(horario || '').trim()].filter(Boolean).join(' ');
  const partes = [String(fecha || '').trim(), banda].filter(Boolean).join(' ');
  const donde = String(puesto || '').trim();
  return `Se te asignó cubrir ${partes}${donde ? ` · ${donde}` : ''}`.replace(/\s+/g, ' ').trim();
}

export function tipoDeTurnoPropio(shift) {
  if (!shift || shift.isDeleted) return 'LIBRE';
  const code = String(shift.code || '').toUpperCase();
  if (shift.isFrancoTrabajado === true || code === 'FT') return null;
  if (shift.isFranco === true || FRANCO.has(code)) return 'FT';
  if (code === 'RET' || shift.isReten === true) return 'RET';
  if (LICENCIA.has(code)) return 'LICENCIA';
  if (!code) return 'LIBRE';
  return null;
}

/** «¿Podés cubrir N días… como franco trabajado?» El resto de la nómina, sin esa cola. */
export function textoPushGuardia({ dias, tipo, lugar }) {
  const n = Math.max(1, Number(dias) || 1);
  const donde = String(lugar || '').trim();
  const base = `¿Podés cubrir ${n} día${n === 1 ? '' : 's'}${donde ? ` en ${donde}` : ''}`;
  return tipo === 'FT' ? `${base} como franco trabajado?` : `${base}?`;
}

function aMinutos(fecha, hhmm) {
  const [y, m, d] = String(fecha || '').split('-').map(Number);
  const [h, mi] = String(hhmm || '').split(':').map(Number);
  if (!y || !m || !d || !Number.isFinite(h)) return null;
  return Date.UTC(y, m - 1, d, h, mi || 0) / 60000;
}

function finAbsoluto(fecha, inicio, fin) {
  const a = aMinutos(fecha, inicio);
  let b = aMinutos(fecha, fin);
  if (a == null || b == null) return null;
  if (b <= a) b += 1440;
  return b;
}

function sumarDia(fecha, delta) {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function esTrabajo(t) {
  if (!t) return false;
  const code = String(t.code || '').toUpperCase();
  if (t.isFrancoTrabajado === true) return true;
  if (t.isFranco === true || FRANCO.has(code) || LICENCIA.has(code) || code === 'RET' || !code) return false;
  return true;
}

function bandaDescanso(gapHoras) {
  if (!Number.isFinite(gapHoras)) return 'blocked';
  if (gapHoras + 1e-6 >= 12) return 'ok';
  if (gapHoras + 1e-6 >= 8) return 'pin';
  return 'blocked';
}

function turnoEn(mapa, fecha) {
  return mapa.get(fecha) || null;
}

/** Horas del mes que ya tiene, sin contar los días que esta consulta va a reemplazar. */
export function horasMesSinDias(turnos, mes, diasReemplazo) {
  const fuera = new Set(diasReemplazo || []);
  let h = 0;
  for (const t of turnos || []) {
    const fecha = String(t.fecha || t.scheduleDate || '');
    if (!fecha.startsWith(mes) || fuera.has(fecha)) continue;
    if (!esTrabajo(t)) continue;
    const horas = Number(t.horas ?? t.hours);
    if (horas > 0) h += horas;
  }
  return h;
}

/**
 * Revalidación de un guardia para el bloque. `autorizaciones` son las que quedaron
 * concedidas al enviar ({ kind: 'DESCANSO' | 'TOPE' }). `topeMes` = { 'yyyy-mm': true }
 * si ya hay autorización mensual vigente.
 * @returns {{ ok: boolean, codigo?: string, motivo?: string, marcas?: { descansoReducido?: boolean, descansoHoras?: number, topeExcedido?: boolean, horasMes?: number, autorizacionMotivo?: string } }}
 */
export function evaluarGuardiaConsulta({ tipo, dias, turnos, autorizaciones = [], topeMes = {}, cap = CAP_DEFAULT }) {
  const lista = (Array.isArray(dias) ? dias : []).filter((d) => d?.fecha).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  if (!lista.length) return { ok: false, codigo: 'BLOQUEADO', motivo: 'Sin días para cubrir.' };
  const mapa = new Map();
  const peso = (t) => {
    const code = String(t?.code || '').toUpperCase();
    if (LICENCIA.has(code)) return 3;
    if (esTrabajo(t)) return 2;
    return 1;
  };
  for (const t of turnos || []) {
    const fecha = String(t.fecha || t.scheduleDate || '');
    if (!fecha) continue;
    const prev = mapa.get(fecha);
    if (!prev || peso(t) >= peso(prev)) mapa.set(fecha, t);
  }
  const concedido = new Set((autorizaciones || []).map((a) => String(a.kind || '').toUpperCase()));
  const motivoAuth = String((autorizaciones || []).find((a) => a.motivo)?.motivo || '');
  const blocked = [];
  let pideDescanso = null;
  const mesesTope = new Map();

  for (const dia of lista) {
    const actual = turnoEn(mapa, dia.fecha);
    const codeActual = String(actual?.code || '').toUpperCase();
    if (actual && LICENCIA.has(codeActual)) {
      blocked.push(`Licencia ${codeActual} el ${dia.fecha}.`);
      continue;
    }
    if (tipo === 'FT' && !(actual && (actual.isFranco === true || FRANCO.has(codeActual)))) {
      blocked.push(`Ya no está de franco el ${dia.fecha}.`);
      continue;
    }
    if (tipo === 'RET' && codeActual !== 'RET' && actual?.isReten !== true) {
      blocked.push(`Ya no está de retén el ${dia.fecha}.`);
      continue;
    }
    if (tipo === 'LIBRE' && actual && (esTrabajo(actual) || actual.isFranco === true || FRANCO.has(codeActual) || codeActual === 'RET')) {
      blocked.push(`Ya tiene turno el ${dia.fecha}.`);
      continue;
    }
    const propuesto = {
      fecha: dia.fecha,
      code: String(dia.code || 'M').toUpperCase(),
      horaInicio: dia.horaInicio,
      horaFin: dia.horaFin,
      horas: Number(dia.horas) || 0,
      isFrancoTrabajado: tipo === 'FT',
    };
    mapa.set(dia.fecha, propuesto);
    if (tipo !== 'FT') {
      let prev = null;
      for (let i = 1; i <= 4; i += 1) {
        const cand = turnoEn(mapa, sumarDia(dia.fecha, -i));
        if (esTrabajo(cand)) { prev = cand; break; }
      }
      const finPrev = prev ? finAbsoluto(prev.fecha || prev.scheduleDate, prev.horaInicio || prev.startHm, prev.horaFin || prev.endHm) : null;
      const ini = aMinutos(dia.fecha, dia.horaInicio);
      if (finPrev != null && ini != null) {
        const gap = (ini - finPrev) / 60;
        const banda = bandaDescanso(gap);
        if (banda === 'blocked') blocked.push(`Descanso de ${gap.toFixed(1)} h el ${dia.fecha} (mínimo 8).`);
        else if (banda === 'pin' && pideDescanso == null) pideDescanso = { gap, fecha: dia.fecha };
      }
    }
    const mes = String(dia.fecha).slice(0, 7);
    mesesTope.set(mes, (mesesTope.get(mes) || 0) + (Number(dia.horas) || 0));
  }

  if (blocked.length) return { ok: false, codigo: 'BLOQUEADO', motivo: blocked[0] };

  const marcas = {};
  if (pideDescanso && !concedido.has('DESCANSO')) {
    return { ok: false, codigo: 'PIN_DESCANSO', motivo: `Descanso de ${pideDescanso.gap.toFixed(1)} h: hace falta PIN de supervisor.` };
  }
  if (pideDescanso && concedido.has('DESCANSO')) {
    marcas.descansoReducido = true;
    marcas.descansoHoras = Math.round(pideDescanso.gap * 10) / 10;
    marcas.autorizacionMotivo = motivoAuth;
  }

  for (const [mes, add] of mesesTope) {
    const base = horasMesSinDias(turnos, mes, lista.map((d) => d.fecha));
    const total = base + add;
    if (!(add > 0) || !(total > cap + 0.05)) continue;
    const cubierto = concedido.has('TOPE') || topeMes?.[mes] === true;
    if (!cubierto) {
      return { ok: false, codigo: 'PIN_TOPE', motivo: `Quedaría en ${Math.round(total)} h en ${mes}. Tope ${cap}.` };
    }
    marcas.topeExcedido = true;
    marcas.horasMes = Math.round(total);
    marcas.autorizacionMotivo = marcas.autorizacionMotivo || motivoAuth;
  }
  return { ok: true, marcas };
}

/**
 * Antes de enviar: quién entra en la consulta.
 * `evaluaciones` sale de la grilla (`evaluateCoverageDayGuards` por día).
 * `autorizados` = { [employeeId]: { descanso?: boolean, tope?: boolean } } después del PIN.
 * `topeMes` = { [employeeId]: true } si el mes ya está autorizado.
 * Quien no se autoriza no se consulta; el resto sí.
 */
export function planEnvioGuardias({ candidatos, evaluaciones, autorizados = {}, topeMes = {}, puedeFt = true }) {
  const ev = new Map((evaluaciones || []).map((e) => [String(e.employeeId), e]));
  const consultables = [];
  const omitidos = [];
  for (const c of candidatos || []) {
    const id = String(c.employeeId || '');
    const noConsultable = motivoNoConsultable(c.tipo);
    if (noConsultable) {
      omitidos.push({ employeeId: id, motivo: noConsultable });
      continue;
    }
    if (c.tipo === 'FT' && !puedeFt) {
      omitidos.push({ employeeId: id, motivo: 'Sin permiso para franco trabajado.' });
      continue;
    }
    const row = ev.get(id) || { blocked: [], authorizations: [] };
    if ((row.blocked || []).length) {
      omitidos.push({ employeeId: id, motivo: row.blocked[0] });
      continue;
    }
    const aut = autorizados[id] || {};
    const pideDescanso = (row.authorizations || []).some((a) => a.kind === 'DESCANSO');
    const pideTope = (row.authorizations || []).some((a) => a.kind === 'TOPE');
    if (pideDescanso && !aut.descanso) {
      omitidos.push({ employeeId: id, motivo: 'Falta autorización de descanso (PIN).' });
      continue;
    }
    if (pideTope && !aut.tope && !topeMes[id]) {
      omitidos.push({ employeeId: id, motivo: 'Falta autorización de tope (PIN).' });
      continue;
    }
    consultables.push(c);
  }
  return { consultables, omitidos };
}

/** Campos del turno, alineados a la escritura de la grilla (FT = isFrancoTrabajado). */
export function camposTurnoGuardia({ tipo, code, nombreCubierto }) {
  const cubre = nombreCubierto ? `Cubriendo a ${nombreCubierto}. ` : '';
  if (tipo === 'FT') {
    return {
      code: String(code || 'M').toUpperCase(),
      isFranco: false,
      isFrancoTrabajado: true,
      coveredFromFranco: true,
      comments: `${cubre}Franco trabajado por consulta de disponibilidad`.trim(),
    };
  }
  const origen = tipo === 'RET' ? 'desde retén' : 'sin turno';
  return {
    code: String(code || 'M').toUpperCase(),
    isFranco: false,
    isFrancoTrabajado: false,
    coveredFromFranco: false,
    comments: `${cubre}Cobertura ${origen} por consulta de disponibilidad`.trim(),
  };
}

export function invitacionIdGuardia(consultaId, employeeId) {
  return `${consultaId}_emp_${employeeId}`;
}

/** El primero que acepta se queda el lugar; el siguiente, con el cupo lleno, no. */
export function lugarDeGuardia(p) {
  return reservarLugar(p);
}
