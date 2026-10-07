/**
 * Canal de una consulta de disponibilidad.
 * La bandeja de la app es el canal: se escribe siempre, tenga o no la app instalada.
 * Push = uid + token + pushEstado activo (si el campo no está, el token alcanza).
 * El mail suma, no reemplaza la bandeja.
 */

export const ENTREGA_PUSH = 'push enviado';
export const ENTREGA_SIN_PUSH = 'sin push (no tiene la app instalada)';
export const ENTREGA_MAIL = 'mail enviado';
export const TOOLTIP_SIN_PUSH = 'No tiene la app instalada: lo ve al entrar a la app; si es urgente, llamalo';

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
  const canales = ['BANDEJA'];
  if (app) canales.push('PUSH');
  if (mail) canales.push('MAIL');
  return {
    app,
    mail,
    canales,
    sinApp: !app,
    codigoApp: codigo,
    motivoApp: motivo,
    puedeRecibir: true,
    sinCanal: false,
    sinPush: !app,
    chip: null,
    porMail: false,
  };
}

/** Dato de entrega. La bandeja no entra acá: siempre existe. */
export function entregaDeConsulta({ app, mailOk }) {
  return {
    pushEnviado: !!app,
    entregaPush: app ? ENTREGA_PUSH : ENTREGA_SIN_PUSH,
    entregaMail: mailOk ? ENTREGA_MAIL : null,
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

/**
 * La bandeja siempre existe: no cerrar `SIN_DESTINATARIOS` porque no haya push ni mail.
 * El estado queda para consultas viejas que el cierre de invitaciones todavía entiende.
 */
export function cierreSiNadieRecibio() {
  return { cerrar: false, status: 'ABIERTA' };
}

/** El FCM falló después de escribir la bandeja. La persona igual la ve al abrir la app. */
export function entregaTrasFcm({ fcmOk }) {
  return { llego: true, pushFallo: !fcmOk };
}
