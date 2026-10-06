/**
 * Canal de una consulta de disponibilidad.
 * App = uid + token de device_tokens + pushEstado activo (si el campo no está, el token alcanza).
 * Mail es el otro canal. Sin los dos, no hay a quién avisarle.
 */

export const LINK_APP_CONSULTA = 'https://comtroldata.web.app/app/';

export function mailDeConsulta(mail) {
  const s = String(mail || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

/** «Pérez, Ana» → Pérez. «ABALLAY ROLON» → ABALLAY. */
export function apellidoDe(nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) return 'esta persona';
  const antes = limpio.split(',')[0].trim();
  const primero = antes.split(/\s+/)[0];
  return primero || antes;
}

/**
 * @param {{ uid?: string, mail?: string, pushEstado?: string, tieneToken?: boolean }} [p]
 * `tieneToken` ausente = todavía no miramos device_tokens (la grilla): no bloquea si hay uid.
 */
export function canalDeConsulta(p = {}) {
  const uid = String(p.uid || '').trim();
  const estado = String(p.pushEstado ?? '').trim().toLowerCase();
  const tokenConocido = p.tieneToken === true || p.tieneToken === false;
  const token = p.tieneToken === true;
  let app = false;
  let codigo = null;
  let motivo = null;
  if (!uid) {
    codigo = 'SIN_UID';
    motivo = 'no tiene la app';
  } else if (estado && estado !== 'activo') {
    codigo = estado === 'denegado' ? 'PUSH_DENEGADO' : 'PUSH_INACTIVO';
    motivo = estado === 'denegado' ? 'permiso denegado' : 'sin token';
  } else if (tokenConocido && !token) {
    codigo = 'SIN_TOKEN';
    motivo = 'sin token';
  } else {
    app = true;
  }
  const mail = mailDeConsulta(p.mail);
  const canales = [];
  if (app) canales.push('PUSH');
  if (mail) canales.push('MAIL');
  return {
    app,
    mail,
    canales,
    sinApp: !app,
    codigoApp: codigo,
    motivoApp: motivo,
    puedeRecibir: canales.length > 0,
    sinCanal: canales.length === 0,
    chip: app ? null : 'Sin app',
    porMail: !app && !!mail,
  };
}

export function textoNoLlego(nombre, motivo) {
  return `A ${apellidoDe(nombre)} no le llegó: ${motivo || 'no tiene la app'}`;
}

export function textoAvisoMail(nombre) {
  return `A ${apellidoDe(nombre)} le avisamos por mail: no tiene la app`;
}

export function textoMailConsulta(texto, link = LINK_APP_CONSULTA) {
  return `${String(texto || '').trim()}\n\nRespondé desde la app: ${link}`;
}

/** Nadie recibió push ni mail → se cierra ya, sin esperar el vencimiento. */
export function cierreSiNadieRecibio(entregados) {
  return Number(entregados) > 0
    ? { cerrar: false, status: 'ABIERTA' }
    : { cerrar: true, status: 'SIN_DESTINATARIOS' };
}

/** El FCM falló después de escribir la bandeja. Si el mail salió, igual le llegó. */
export function entregaTrasFcm({ mailOk, fcmOk }) {
  if (mailOk) return { llego: true };
  if (fcmOk) return { llego: true };
  return { llego: false, motivo: 'error al enviar el aviso' };
}
