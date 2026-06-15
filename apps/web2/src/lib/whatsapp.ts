/**
 * Normaliza un teléfono argentino al formato internacional para wa.me
 * Ejemplos de entrada soportados:
 *   351-123-4567  →  5493511234567
 *   0351-1234567  →  5493511234567
 *   +543511234567 →  5493511234567
 *   9111234567    →  549111234567
 */
export const normalizeArgPhone = (phone: string): string => {
  if (!phone) return '';
  let p = phone.replace(/[\s\-().]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('54')) {
    if (!p.startsWith('549')) p = '549' + p.slice(2);
    return p;
  }
  if (p.startsWith('0')) p = p.slice(1);
  if (p.startsWith('9')) return '54' + p;
  return '549' + p;
};

export const openWhatsApp = (phone: string, text?: string) => {
  const n = normalizeArgPhone(phone);
  if (!n) return;
  const url = text
    ? `https://wa.me/${n}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${n}`;
  window.open(url, '_blank');
};

// ── Plantillas por contexto ───────────────────────────────────────────────────

export const waMensaje = {
  cobertura: (nombre: string, objetivo: string, horaInicio: string, horaFin: string) =>
    `Hola ${nombre} 👋, te contacta *Operaciones Crono*.\n\n¿Podés cubrir el puesto en *${objetivo}* de *${horaInicio}* a *${horaFin}*?\n\nConfirmá a la brevedad. Gracias.`,

  intercambio: (nombre: string, objetivoDestino: string) =>
    `Hola ${nombre} 👋, te contacta *Operaciones Crono*.\n\nNecesitamos que pases al objetivo *${objetivoDestino}*.\n\n¿Podés hacer el movimiento? Confirmá.`,

  adelanto: (nombre: string, objetivo: string, hora: string) =>
    `Hola ${nombre} 👋, te contacta *Operaciones Crono*.\n\nNecesitamos que adelantes tu ingreso al puesto *${objetivo}* a las *${hora}*.\n\n¿Podés llegar? Confirmá.`,

  turnoRecordatorio: (nombre: string, objetivo: string, fecha: string, horaInicio: string, horaFin: string) =>
    `Hola ${nombre} 👋, recordatorio de *Crono Operaciones*:\n\nTurno: *${fecha}*\nLugar: *${objetivo}*\nHorario: *${horaInicio} a ${horaFin}*\n\nConfirmá recibo por favor.`,

  ausencia: (nombre: string, fecha: string, objetivo: string) =>
    `Hola ${nombre}, registramos tu *ausencia* para el *${fecha}* en ${objetivo}.\n\nSi es un error, comunicarte con Operaciones a la brevedad.`,

  bienvenida: (nombre: string) =>
    `Hola ${nombre} 👋, te contacta *Operaciones Crono*. ¿Cómo estás?`,

  tardanza: (nombre: string, objetivo: string, horaInicio: string) =>
    `Hola ${nombre} 👋, te contacta *Operaciones Crono*.\n\nTu turno en *${objetivo}* comenzó a las *${horaInicio}*. ¿Estás en camino?\n\n¿A qué hora llegás? Confirmá a la brevedad. Gracias.`,
};
