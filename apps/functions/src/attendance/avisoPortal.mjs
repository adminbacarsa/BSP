/**
 * Aviso del guardia desde la app («Ausencia con aviso»).
 * Operativamente es una ausencia activa al instante. La revisión de RRHH
 * (justificar a E/L/A o dejarla injustificada) va en `revisionEstado`, aparte.
 * Copia idéntica: apps/functions/src/attendance/avisoPortal.mjs
 */

export const TIPO_AVISO_PORTAL = 'Ausencia con aviso';
export const STATUS_AVISADA = 'Avisada';
export const REVISION_POR_REVISAR = 'POR_REVISAR';
export const REVISION_JUSTIFICADA = 'JUSTIFICADA';
export const REVISION_INJUSTIFICADA = 'INJUSTIFICADA';
export const DETECTED_BY_AVISO = 'AVISO_PORTAL';
export const NOVEDAD_REVISION_RRHH = 'AVISO_AUSENCIA_PORTAL';

const CERRADA = new Set(['rechazada', 'rejected', 'cancelada', 'cancelled', 'anulada', 'inactive', 'inactiva']);

export function ausenciaCerrada(doc) {
  return CERRADA.has(String(doc?.status || '').toLowerCase().trim());
}

/** Lo que la app guarda cuando el guardia avisa que no va. No es un pedido de vacaciones. */
export function esAvisoPortal(doc) {
  if (!doc || String(doc.source || '').toUpperCase() !== 'EMPLEADO') return false;
  if (doc.avisoPortal === true) return true;
  return String(doc.type || '').trim() === TIPO_AVISO_PORTAL;
}

/**
 * El formulario de RRHH no tenía «Ausencia con aviso» en el selector y, al guardar,
 * el navegador mostraba Vacaciones. Un pedido de vacaciones no trae el turno del día
 * ni el caso corto plazo / anticipada.
 */
export function esVacacionesDeAviso(doc) {
  if (!doc || String(doc.source || '').toUpperCase() !== 'EMPLEADO') return false;
  if (String(doc.type || '').trim() !== 'Vacaciones') return false;
  const caso = String(doc.absenceCase || '').toUpperCase();
  const shiftId = String(doc.shiftId || '').trim();
  return !!shiftId && (caso === 'CORTO_PLAZO' || caso === 'ANTICIPADA');
}

export function esAvisoParaActivar(doc) {
  return esAvisoPortal(doc) || esVacacionesDeAviso(doc);
}

/** La grilla y el CC la tratan como ausencia aunque siga «Pendiente» de una carga vieja. */
export function esAvisoPortalOperativo(doc) {
  if (!doc || ausenciaCerrada(doc)) return false;
  if (String(doc.status || '').trim() === STATUS_AVISADA) return true;
  return esAvisoPortal(doc);
}

export function esPorRevisar(doc) {
  if (!doc || ausenciaCerrada(doc)) return false;
  const st = String(doc.status || '').trim();
  if (st === 'En verificación') return true;
  const rev = String(doc.revisionEstado || '').toUpperCase();
  if (rev === REVISION_JUSTIFICADA || rev === REVISION_INJUSTIFICADA) return false;
  if (rev === REVISION_POR_REVISAR) return true;
  if (esAvisoParaActivar(doc) && (st === 'Pendiente' || st === STATUS_AVISADA || st === '')) return true;
  return false;
}

export function patchActivacionAviso(doc) {
  if (!doc || ausenciaCerrada(doc)) return null;
  const st = String(doc.status || '').trim();
  const rev = String(doc.revisionEstado || '').toUpperCase();
  if (st === 'Justificada' || st === 'En verificación' || st === 'Injustificada' || st === 'Autorizada') return null;
  if (rev === REVISION_JUSTIFICADA || rev === REVISION_INJUSTIFICADA) return null;
  return {
    type: TIPO_AVISO_PORTAL,
    absenceType: 'AA',
    avisoPortal: true,
    status: STATUS_AVISADA,
    revisionEstado: REVISION_POR_REVISAR,
  };
}

export function patchDejarInjustificada() {
  return { revisionEstado: REVISION_INJUSTIFICADA, status: STATUS_AVISADA, avisoPortal: true };
}

export function patchJustificarAviso({ code, label, tieneCertificado, requiereVerificacionMedica }) {
  const status = requiereVerificacionMedica && !tieneCertificado ? 'En verificación' : 'Justificada';
  return {
    type: label,
    absenceType: code,
    status,
    hasCertificate: !!tieneCertificado,
    revisionEstado: status === 'En verificación' ? REVISION_POR_REVISAR : REVISION_JUSTIFICADA,
    avisoPortal: true,
  };
}

export function fechaEnRango(fecha, start, end) {
  const f = String(fecha || '').slice(0, 10);
  const a = String(start || '').slice(0, 10);
  const b = String(end || a).slice(0, 10);
  return !!f && !!a && f >= a && f <= b;
}

/** El turno con aviso no recibe ¿Venís?, T−5 ni AA automática. */
export function bloqueaLlegadaYAa(shift) {
  if (!shift) return false;
  if (shift.isAbsent === true && String(shift.absenceDetectedBy || '') === DETECTED_BY_AVISO) return true;
  return String(shift.absenceDetectedBy || '') === DETECTED_BY_AVISO;
}
