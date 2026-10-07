/**
 * Consulta de disponibilidad (Planificación): lugares por orden de llegada.
 * El primero que dice que sí toma el lugar 1, el segundo el 2, y así.
 * Sin Firestore: el servidor y los tests usan estas mismas decisiones.
 */

export const VENCE_DEFAULT_MIN = 120;
export const VENCE_MAX_MIN = 24 * 60;
export const MENSAJE_CUBIERTO = 'Ya se asignó a otra persona. ¡Gracias!';
export const MENSAJE_YA_NO_HACE_FALTA = 'Ya no hace falta, gracias';
export const MENSAJE_VENCIDA = 'La consulta venció.';

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
  // AVISO_MAIL: le llegó por correo y todavía no tiene la app; puede responder igual.
  if (estado !== 'PENDIENTE' && estado !== 'AVISO_MAIL') return { ok: false, codigo: 'YA_RESPONDIO' };
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

const CONSERVAR_AL_CERRAR = new Set(['ASIGNADO', 'NO', 'CUBIERTO', 'CANCELADA', 'VENCIDA']);

/** ASIGNADO y NO quedan. El resto (PENDIENTE, AVISO_MAIL, NO_LLEGO, RESERVADO) se cierra. */
export function invitacionHayQueCerrarla(estado) {
  return !CONSERVAR_AL_CERRAR.has(String(estado || ''));
}

/**
 * Estado final de cada invitación según el padre.
 * VENCIDA no avisa. CERRADA y el cupo completo sí. SIN_DESTINATARIOS cierra sin push.
 */
export function cierreDeConsulta(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'COMPLETA') {
    return { estado: 'CUBIERTO', motivo: MENSAJE_CUBIERTO, avisar: true, tipoAviso: 'CONSULTA_CUBIERTA', linea: 'Ya se asignó a otra persona' };
  }
  if (s === 'CERRADA') {
    return { estado: 'CANCELADA', motivo: MENSAJE_YA_NO_HACE_FALTA, avisar: true, tipoAviso: 'CONSULTA_CANCELADA', linea: 'Ya no hace falta' };
  }
  if (s === 'SIN_DESTINATARIOS') {
    return { estado: 'CANCELADA', motivo: MENSAJE_YA_NO_HACE_FALTA, avisar: false, tipoAviso: null, linea: 'Ya no hace falta' };
  }
  if (s === 'VENCIDA') {
    return { estado: 'VENCIDA', motivo: MENSAJE_VENCIDA, avisar: false, tipoAviso: null, linea: null };
  }
  return null;
}

/** Lo que ve el guardia si responde cuando la invitación ya cerró. Nunca un error crudo. */
export function mensajeRespuestaCerrada(estado, status, codigo) {
  const e = String(estado || '').toUpperCase();
  const s = String(status || '').toUpperCase();
  const c = String(codigo || '').toUpperCase();
  if (e === 'CUBIERTO' || s === 'COMPLETA' || c === 'COMPLETA') return MENSAJE_CUBIERTO;
  if (e === 'CANCELADA' || s === 'CERRADA' || s === 'SIN_DESTINATARIOS' || c === 'CERRADA') return MENSAJE_YA_NO_HACE_FALTA;
  if (e === 'VENCIDA' || s === 'VENCIDA' || c === 'VENCIDA') return MENSAJE_VENCIDA;
  return 'La consulta ya no está abierta.';
}

/** Con el cupo lleno se cierran las que todavía no son ASIGNADO ni NO. */
export function pendientesACerrar(invitaciones, tomados, lugares) {
  if (Number(tomados) < Number(lugares)) return [];
  return (invitaciones || []).filter((i) => i && invitacionHayQueCerrarla(i.estado)).map((i) => i.id);
}

/** Al fallar la revalidación ese lugar vuelve a estar libre: no cuenta como tomado. */
export function tomadosTrasNoElegible(respuestas, cuil) {
  return (respuestas || []).filter((r) => r.cuil !== cuil && (r.estado === 'ASIGNADO' || r.estado === 'RESERVADO')).length;
}

export function conAvisoPush(respuestas) {
  const list = Array.isArray(respuestas) ? respuestas : [];
  return list.filter((r) => r.pushEnviado === true).length;
}

export function textoEstadoConsulta(respuestas) {
  const list = Array.isArray(respuestas) ? respuestas : [];
  const n = list.length;
  const sis = list.filter((r) => r.estado === 'ASIGNADO' || r.estado === 'SI' || r.estado === 'RESERVADO');
  const no = list.filter((r) => r.estado === 'NO').length;
  const siTxt = sis.map((r) => {
    const apellido = String(r.nombre || '').split(',')[0].trim();
    return `${apellido}${r.hora ? ` ${r.hora}` : ''}`.trim();
  }).filter(Boolean).join(', ');
  const partes = [`Consultados: ${n} · ${conAvisoPush(list)} con aviso push`];
  if (sis.length) partes.push(`${sis.length} sí${siTxt ? ` (${siTxt})` : ''}`);
  if (no) partes.push(`${no} no`);
  return partes.join(' · ');
}

export function debeVencer({ status, ahoraMs, venceAtMs }) {
  return String(status || '') === 'ABIERTA' && Number(venceAtMs) > 0 && Number(ahoraMs) > Number(venceAtMs);
}

export function revalidacionFalla(motivo) {
  return { ok: false, codigo: 'NO_ELEGIBLE', motivo: String(motivo || 'Ya no es elegible.'), lugarLibre: true };
}
