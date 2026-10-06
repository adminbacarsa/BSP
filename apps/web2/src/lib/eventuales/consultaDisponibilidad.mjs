/**
 * Consulta de disponibilidad (Planificación): lugares por orden de llegada.
 * El primero que dice que sí toma el lugar 1, el segundo el 2, y así.
 * Sin Firestore: el servidor y los tests usan estas mismas decisiones.
 */
import { textoAvisoMail, textoNoLlego } from './consultaCanal.mjs';

export const VENCE_DEFAULT_MIN = 120;
export const VENCE_MAX_MIN = 24 * 60;
export const MENSAJE_CUBIERTO = 'Ya se cubrió, gracias';

export function textoJornadas(jornadas) {
  const list = Array.isArray(jornadas) ? jornadas : [];
  return list.map((j) => {
    const fecha = String(j?.fecha || '');
    const partes = fecha.split('-');
    const dia = partes.length === 3 ? `${partes[2]}/${partes[1]}` : fecha;
    const ini = String(j?.horaInicio || '').slice(0, 5);
    const fin = String(j?.horaFin || '').slice(0, 5);
    const code = String(j?.code || '').trim();
    return `${dia}${code ? ` ${code}` : ''} ${ini}–${fin}`.replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join(', ');
}

const MESES_CONSULTA = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function contratosDelBloque(jornadas) {
  const meses = [...new Set((Array.isArray(jornadas) ? jornadas : []).map((j) => String(j?.fecha || '').slice(0, 7)).filter((m) => m.length >= 7))].sort();
  if (meses.length < 2) return '';
  const nombres = meses.map((mes) => {
    const [y, m] = mes.split('-');
    return `${MESES_CONSULTA[Number(m) - 1] || mes} ${y}`;
  });
  return meses.length === 2
    ? ` Son dos contratos (${nombres[0]} y ${nombres[1]}).`
    : ` Son ${meses.length} contratos (${nombres.join(', ')}).`;
}

export function textoConsulta({ cliente, objetivo, puesto, jornadas }) {
  const lugar = [cliente, objetivo, puesto].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
  const list = (Array.isArray(jornadas) ? jornadas : []).slice().sort((a, b) => String(a?.fecha || '').localeCompare(String(b?.fecha || '')));
  if (list.length > 1) {
    const desde = textoJornadas([list[0]]).split(' ')[0];
    const hasta = textoJornadas([list[list.length - 1]]).split(' ')[0];
    const detalle = textoJornadas(list);
    return `¿Podés cubrir ${list.length} días (${desde} → ${hasta})${lugar ? ` en ${lugar}` : ''}? ${detalle}.${contratosDelBloque(list)}`.replace(/\s+\./g, '.').trim();
  }
  const cuando = textoJornadas(list);
  return `¿Estás disponible${cuando ? ` ${cuando}` : ''}${lugar ? ` en ${lugar}` : ''}?`;
}

export function huecoKeyDe({ empresaId, objectiveId, positionName, jornadas }) {
  const dias = (Array.isArray(jornadas) ? jornadas : [])
    .map((j) => `${j.fecha}|${j.code || ''}|${j.horaInicio}|${j.horaFin}`)
    .sort()
    .join(';');
  return `${empresaId}|${objectiveId || ''}|${positionName || ''}|${dias}`;
}

/**
 * Plazo al enviar. Con minutos > 0, ese plazo, sin pasar del inicio del primer turno.
 * Con minutos <= 0, hasta ese inicio; si el turno ya empezó, 2 horas.
 */
export function venceEnMs({ ahoraMs, minutos, inicioPrimerTurnoMs }) {
  const ahora = Number(ahoraMs) || 0;
  const mins = Number(minutos);
  const pedido = Number.isFinite(mins) && mins > 0
    ? ahora + Math.min(mins, VENCE_MAX_MIN) * 60000
    : null;
  const inicio = Number(inicioPrimerTurnoMs);
  const hastaInicio = Number.isFinite(inicio) && inicio > ahora ? inicio : null;
  if (pedido && hastaInicio) return Math.min(pedido, hastaInicio);
  if (pedido) return pedido;
  if (hastaInicio) return hastaInicio;
  return ahora + VENCE_DEFAULT_MIN * 60000;
}

/**
 * @param {{ lugares: number, tomados: number, status: string, venceAtMs: number, ahoraMs: number, estadoInvitacion: string }} p
 * @returns {{ ok: boolean, codigo?: string, orden?: number | null, idempotente?: boolean }}
 */
export function reservarLugar(p) {
  const estado = String(p.estadoInvitacion || 'PENDIENTE');
  if (estado === 'ASIGNADO' || estado === 'RESERVADO') return { ok: true, idempotente: true, orden: null };
  if (estado === 'CUBIERTO') return { ok: false, codigo: 'COMPLETA' };
  if (estado !== 'PENDIENTE') return { ok: false, codigo: 'YA_RESPONDIO' };
  const status = String(p.status || '');
  if (status !== 'ABIERTA') {
    if (status === 'VENCIDA') return { ok: false, codigo: 'VENCIDA' };
    if (status === 'COMPLETA') return { ok: false, codigo: 'COMPLETA' };
    return { ok: false, codigo: 'CERRADA' };
  }
  if (Number(p.venceAtMs) && Number(p.ahoraMs) > Number(p.venceAtMs)) return { ok: false, codigo: 'VENCIDA' };
  const cupo = Math.max(0, Number(p.lugares) || 0);
  const usados = Math.max(0, Number(p.tomados) || 0);
  if (usados >= cupo) return { ok: false, codigo: 'COMPLETA' };
  return { ok: true, orden: usados + 1, idempotente: false };
}

/** Con el cupo lleno, los que siguen en PENDIENTE se cierran. */
export function pendientesACerrar(invitaciones, tomados, lugares) {
  if (Number(tomados) < Number(lugares)) return [];
  return (invitaciones || []).filter((i) => i && i.estado === 'PENDIENTE').map((i) => i.id);
}

/** Al fallar la revalidación ese lugar vuelve a estar libre: no cuenta como tomado. */
export function tomadosTrasNoElegible(respuestas, cuil) {
  return (respuestas || []).filter((r) => r.cuil !== cuil && (r.estado === 'ASIGNADO' || r.estado === 'RESERVADO')).length;
}

export function textoEstadoConsulta(respuestas) {
  const list = Array.isArray(respuestas) ? respuestas : [];
  const n = list.length;
  const sis = list.filter((r) => r.estado === 'ASIGNADO' || r.estado === 'SI' || r.estado === 'RESERVADO');
  const pend = list.filter((r) => r.estado === 'PENDIENTE');
  const no = list.filter((r) => r.estado === 'NO').length;
  const siTxt = sis.map((r) => {
    const apellido = String(r.nombre || '').split(',')[0].trim();
    return `${apellido}${r.hora ? ` ${r.hora}` : ''}`.trim();
  }).filter(Boolean).join(', ');
  const partes = [`${n} consultado${n === 1 ? '' : 's'}`];
  if (sis.length) partes.push(`${sis.length} sí${siTxt ? ` (${siTxt})` : ''}`);
  if (pend.length) partes.push(`${pend.length} pendiente${pend.length === 1 ? '' : 's'}`);
  if (no) partes.push(`${no} no`);
  for (const r of list) {
    if (r.estado === 'NO_LLEGO') partes.push(textoNoLlego(r.nombre, r.motivo));
    else if (r.estado === 'AVISO_MAIL') partes.push(textoAvisoMail(r.nombre));
    else if (r.entregaNota) partes.push(String(r.entregaNota));
  }
  return partes.join(' · ');
}

export function debeVencer({ status, ahoraMs, venceAtMs }) {
  return String(status || '') === 'ABIERTA' && Number(venceAtMs) > 0 && Number(ahoraMs) > Number(venceAtMs);
}

export function revalidacionFalla(motivo) {
  return { ok: false, codigo: 'NO_ELEGIBLE', motivo: String(motivo || 'Ya no es elegible.'), lugarLibre: true };
}
