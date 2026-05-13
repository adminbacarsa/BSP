/**
 * Mapeo de tipos de ausencia (texto humano que guarda RRHH) a códigos COSP
 * usados en la grilla de planificación y en los reportes.
 *
 * Centralizado acá para que la lógica de carga de ausencias (autoscheduler,
 * verificación, UI) sea consistente y robusta frente a docs antiguos.
 */

export const ABSENCE_TYPE_TO_CODE: Record<string, string> = {
    // Vacaciones
    'vacaciones': 'V',
    'vacacion': 'V',
    'v': 'V',
    // Enfermedad
    'enfermedad': 'E',
    'enferma': 'E',
    'enfermo': 'E',
    'e': 'E',
    // ART
    'art': 'A',
    'a': 'A',
    'autorizada': 'A',
    // Licencia especial
    'licencia esp.': 'L',
    'licencia especial': 'L',
    'licencia': 'L',
    'l': 'L',
    // Permiso gremial
    'pg permiso gremial': 'PG',
    'permiso gremial': 'PG',
    'gremial': 'PG',
    'pg': 'PG',
    // Injustificada (default seguro)
    'injustificada': 'AA',
    'falta injustificada': 'AA',
    'aa': 'AA',
};

/** Códigos válidos de ausencia/licencia para grilla. */
export const ABSENCE_VALID_CODES = new Set(['V', 'E', 'A', 'L', 'PG', 'AA']);

/** Códigos de licencias pagas (computan horas y bloquean planificación). */
export const PAID_LEAVE_CODES = new Set(['V', 'L', 'A', 'E', 'PG']);

/**
 * Infiere el código de ausencia desde un documento de la colección `ausencias`.
 * Prioridad:
 *   1. `absenceType` si está y es válido.
 *   2. `code` si está y es válido (algunos docs viejos lo usan).
 *   3. `type` mapeado por nombre.
 *   4. Fallback: `'AA'` (injustificada) — el más seguro porque bloquea.
 */
export function inferAbsenceCode(doc: any): string {
    const direct = String(doc?.absenceType || '').toUpperCase().trim();
    if (ABSENCE_VALID_CODES.has(direct)) return direct;

    const code = String(doc?.code || '').toUpperCase().trim();
    if (ABSENCE_VALID_CODES.has(code)) return code;

    const t = String(doc?.type || '').toLowerCase().trim();
    if (t && ABSENCE_TYPE_TO_CODE[t]) return ABSENCE_TYPE_TO_CODE[t];

    // último intento: por keyword
    if (t.includes('vacac')) return 'V';
    if (t.includes('enferm')) return 'E';
    if (t.includes('art')) return 'A';
    if (t.includes('gremial')) return 'PG';
    if (t.includes('licen')) return 'L';
    if (t.includes('injust') || t.includes('aa')) return 'AA';

    return 'AA';
}

/**
 * Devuelve true si el documento de ausencia debe ser considerado
 * para planificación. Excluye las rechazadas.
 */
export function isActiveAbsence(doc: any): boolean {
    const st = String(doc?.status || '').toLowerCase().trim();
    if (!st) return true; // legacy: sin status → la respetamos
    if (st === 'rechazada' || st === 'rejected' || st === 'cancelada' || st === 'cancelled') {
        return false;
    }
    return true;
}
