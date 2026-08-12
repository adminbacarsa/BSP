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
    // No Presentación (ausencia automática AA — hecho operativo, sin autorización)
    'no presentación': 'AA',
    'no presentacion': 'AA',
    'np': 'AA',
    // Injustificada (resultado de revisión RRHH)
    'injustificada': 'AA',
    'ausencia con aviso': 'AA',
    'falta injustificada': 'AA',
    'aa': 'AA',
    // Llegada Tarde
    'llegada tarde': 'LT',
    'tarde': 'LT',
    'lt': 'LT',
    // Licencias CCT especiales
    'matrimonio': 'L',
    'casamiento': 'L',
    'maternidad': 'L',
    'nacimiento': 'L',
    'paternidad': 'L',
    'nacimiento / paternidad': 'L',
    'fallecimiento familiar': 'L',
    'fallecimiento': 'L',
    'duelo': 'L',
    'examen': 'L',
    'examen / estudio': 'L',
    'estudio': 'L',
    'mudanza': 'L',
    'donacion de sangre': 'L',
    'donación de sangre': 'L',
    // MAVIC — mutual capacitación SUVICO (Córdoba)
    'mavic': 'L',
    // Sin goce de sueldo
    'sin goce de sueldo': 'SGS',
    'sin goce': 'SGS',
    'sgs': 'SGS',
    // Suspensión disciplinaria
    'suspensión': 'SUS',
    'suspension': 'SUS',
    'sus': 'SUS',
    // Callable manageAbsences (backend Nest)
    'vacation': 'V',
    'sick_leave': 'E',
};

/** Etiquetas exactas del formulario RRHH → código grilla. */
export const RRHH_ABSENCE_LABEL_TO_CODE: Record<string, string> = {
    'Vacaciones': 'V',
    'Enfermedad': 'E',
    'ART': 'A',
    'No Presentacion': 'AA',
    'No Presentación': 'AA',
    'Injustificada': 'AA',
    'Ausencia con aviso': 'AA',
    'Justificada': 'AA',
    'Llegada Tarde': 'LT',
    'Licencia Esp.': 'L',
    'PG Permiso Gremial': 'PG',
    // Licencias CCT especiales
    'Matrimonio': 'L',
    'Maternidad': 'L',
    'Nacimiento / Paternidad': 'L',
    'Fallecimiento Familiar': 'L',
    'Examen / Estudio': 'L',
    'Mudanza': 'L',
    'Donación de Sangre': 'L',
    'MAVIC': 'L',
    // Sin goce de sueldo
    'Sin Goce de Sueldo': 'SGS',
    // Suspensión disciplinaria
    'Suspensión': 'SUS',
};

/** Tipos disponibles para cargar manualmente en RRHH */
export const RRHH_ABSENCE_TYPES = [
    'No Presentacion',
    'Llegada Tarde',
    'Injustificada',
    'Justificada',
    'Enfermedad',
    'ART',
    'Vacaciones',
    'Matrimonio',
    'Maternidad',
    'Nacimiento / Paternidad',
    'Fallecimiento Familiar',
    'Examen / Estudio',
    'Mudanza',
    'Donación de Sangre',
    'MAVIC',
    'Licencia Esp.',
    'PG Permiso Gremial',
    'Sin Goce de Sueldo',
    'Suspensión',
] as const;

/**
 * Estados del ciclo de vida de una ausencia:
 *  - Confirmada:  hecho operativo automático (AA). No requiere autorización.
 *  - Pendiente:   ausencia solicitada (vacaciones, licencia) esperando aprobación.
 *  - Justificada: RRHH la clasificó como justificada (con certificado u otro).
 *  - Injustificada: RRHH la clasificó como injustificada.
 *  - Autorizada:  vacaciones/licencias aprobadas.
 *  - Rechazada:   solicitud denegada.
 *  - En verificación: médica pendiente de verificación.
 */
export const ABSENCE_STATUSES = [
    'Confirmada',
    'Pendiente',
    'Justificada',
    'Injustificada',
    'Autorizada',
    'Rechazada',
    'En verificación',
] as const;

/** Tipos que se originan automáticamente en operaciones (sin autorización) */
export const AUTO_ABSENCE_TYPES = new Set(['No Presentacion', 'No Presentación']);

/** Tipos que requieren autorización gerencial antes de impactar planificación */
export const REQUIRES_AUTHORIZATION_TYPES = new Set([
    'Vacaciones',
    'Licencia Esp.',
    'PG Permiso Gremial',
    'Matrimonio',
    'Maternidad',
    'Nacimiento / Paternidad',
    'Fallecimiento Familiar',
    'Examen / Estudio',
    'Mudanza',
    'Donación de Sangre',
    'MAVIC',
    'Sin Goce de Sueldo',
]);

/** Códigos válidos de ausencia/licencia para grilla. */
export const ABSENCE_VALID_CODES = new Set(['V', 'E', 'A', 'L', 'PG', 'AA', 'LT', 'SGS', 'SUS']);

/** Códigos de licencias pagas (computan horas y bloquean planificación). */
export const PAID_LEAVE_CODES = new Set(['V', 'L', 'A', 'E', 'PG']);

/** Tipos RRHH que van a verificación médica (no autorización con PIN). */
export const MEDICAL_VERIFICATION_ABSENCE_TYPES = new Set(['Enfermedad', 'ART']);

export function absenceNeedsMedicalVerification(doc: { type?: unknown } | null | undefined): boolean {
    const type = String(doc?.type ?? '').trim();
    return MEDICAL_VERIFICATION_ABSENCE_TYPES.has(type);
}

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

    const rawType = String(doc?.type || '').trim();
    if (rawType && RRHH_ABSENCE_LABEL_TO_CODE[rawType]) return RRHH_ABSENCE_LABEL_TO_CODE[rawType];

    const t = rawType.toLowerCase();
    if (t && ABSENCE_TYPE_TO_CODE[t]) return ABSENCE_TYPE_TO_CODE[t];

    // último intento: por keyword
    if (t.includes('tarde') || t === 'lt') return 'LT';
    if (t.includes('vacac')) return 'V';
    if (t.includes('enferm')) return 'E';
    if (t.includes('art')) return 'A';
    if (t.includes('gremial')) return 'PG';
    if (t.includes('mavic')) return 'L';
    if (t.includes('licen')) return 'L';
    if (t.includes('injust') || t.includes('aa')) return 'AA';
    if (t.includes('sin goce') || t === 'sgs') return 'SGS';
    if (t.includes('suspens') || t === 'sus') return 'SUS';

    return 'AA';
}

/**
 * Devuelve true si el documento de ausencia debe ser considerado
 * para planificación. Excluye las rechazadas.
 */
/** Devuelve true si el documento es una Llegada Tarde (el guardia SÍ trabajó el turno). */
function isLlegadaTarde(doc: any): boolean {
    const code = String(doc?.absenceType ?? '').trim().toUpperCase();
    const type = String(doc?.type ?? '').trim().toLowerCase();
    return code === 'LT' || type === 'llegada tarde';
}

export function isActiveAbsence(doc: any): boolean {
    // Llegada Tarde: el guardia llegó y cumplió el turno → no bloquea planificación
    if (isLlegadaTarde(doc)) return false;
    const st = String(doc?.status || '').toLowerCase().trim();
    if (!st) return true; // legacy: sin status → la respetamos
    if (st === 'rechazada' || st === 'rejected' || st === 'cancelada' || st === 'cancelled') return false;
    // Confirmada: hecho operativo automático (No Presentación AA) — siempre activo
    if (st === 'confirmada') return true;
    if (st === 'en verificación' || st === 'en verificacion') return true;
    // Pendiente: licencias/vacaciones esperan autorización; enfermedad/ART ya impactan planificación
    if (st === 'pendiente' || st === 'pending') return absenceNeedsMedicalVerification(doc);
    return true;
}

export function absenceReplicatesToPlanning(doc: { status?: unknown; type?: unknown; absenceType?: unknown } | null | undefined): boolean {
    // Llegada Tarde: el guardia trabajó el turno → no reemplaza la celda de planificación
    if (isLlegadaTarde(doc)) return false;
    const st = String(doc?.status ?? '').trim();
    if (st === 'Rechazada') return false;
    // Confirmada (No Presentación automática) siempre replica — es un hecho
    if (st === 'Confirmada') return true;
    if (st === 'Autorizada' || st === 'Justificada' || st === 'Injustificada') return true;
    if (st === 'En verificación') return true;
    if (st === 'Pendiente' && absenceNeedsMedicalVerification(doc)) return true;
    return false;
}

/** Normaliza startDate/endDate de Firestore a YYYY-MM-DD (calendario local). */
export function toCalendarDateStr(val: unknown): string | null {
    if (val == null || val === '') return null;
    if (typeof val === 'string') {
        const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        const dt = new Date(val);
        if (!isNaN(dt.getTime())) {
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
        return null;
    }
    if (typeof val === 'object' && val !== null) {
        const rec = val as { toDate?: () => Date; seconds?: number };
        if (typeof rec.toDate === 'function') {
            const dt = rec.toDate();
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
        if (typeof rec.seconds === 'number') {
            const dt = new Date(rec.seconds * 1000);
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
    }
    return null;
}

/** Compara dos fechas calendario YYYY-MM-DD. Devuelve -1 | 0 | 1. */
export function compareCalendarDateStr(a: string, b: string): number {
    return String(a).slice(0, 10).localeCompare(String(b).slice(0, 10));
}

/** Valida rango de ausencia/licencia (inicio ≤ fin). */
export function validateAbsenceDateRange(
    startVal: unknown,
    endVal: unknown,
): { ok: true; startDate: string; endDate: string } | { ok: false; message: string } {
    const startDate = toCalendarDateStr(startVal);
    const endDate = toCalendarDateStr(endVal);
    if (!startDate || !endDate) {
        return { ok: false, message: 'Ingrese fecha de inicio y fin válidas.' };
    }
    if (compareCalendarDateStr(endDate, startDate) < 0) {
        return { ok: false, message: 'La fecha fin no puede ser anterior a la fecha inicio.' };
    }
    return { ok: true, startDate, endDate };
}

/** Lista inclusive de fechas YYYY-MM-DD entre start y end. */
export function iterateCalendarDateRange(startStr: string, endStr: string): string[] {
    if (compareCalendarDateStr(endStr, startStr) < 0) return [];
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const [ey, em, ed] = endStr.split('-').map(Number);
    if (!sy || !ey) return [];
    const out: string[] = [];
    const cur = new Date(sy, sm - 1, sd, 12, 0, 0, 0);
    const end = new Date(ey, em - 1, ed, 12, 0, 0, 0);
    while (cur <= end) {
        out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
        cur.setDate(cur.getDate() + 1);
    }
    return out;
}

/**
 * Construye el mapa `${employeeId}_${dateKey}` usado por la grilla de planificación.
 * `formatDateKey` debe ser la misma función que usa la grilla (p. ej. getDateKey con TZ AR).
 */
export function buildAbsencesMapFromDocs(
    docs: Array<{ id: string; data: Record<string, unknown> }>,
    formatDateKey: (d: Date) => string,
    opts?: { filterActive?: boolean },
): Record<string, Record<string, unknown>> {
    const map: Record<string, Record<string, unknown>> = {};
    const filterActive = opts?.filterActive !== false;

    docs.forEach(({ id, data }) => {
        if (filterActive && !isActiveAbsence(data)) return;
        const empId = String(data.employeeId ?? '').trim();
        if (!empId) return;

        const range = validateAbsenceDateRange(data.startDate, data.endDate);
        if (!range.ok) return;
        const { startDate: startStr, endDate: endStr } = range;

        const inferredCode = inferAbsenceCode(data);
        iterateCalendarDateRange(startStr, endStr).forEach((dateStr) => {
            const [y, m, d] = dateStr.split('-').map(Number);
            const key = `${empId}_${formatDateKey(new Date(y, m - 1, d, 12, 0, 0, 0))}`;
            map[key] = { id, ...data, isAbsence: true, inferredCode };
        });
    });

    return map;
}

export const PLANNING_ABSENCE_GRID_CODES = new Set([
    'V', 'L', 'PG', 'A', 'E', 'AA', 'LT', 'F', 'FF', 'FT', 'PAST', 'LOCKED', 'RET', 'SGS', 'SUS',
]);

export type GridShiftLike = {
    code?: string;
    positionName?: string;
    objectiveId?: string;
    hours?: number;
    startTime?: unknown;
    name?: string;
};

/** Banda/puesto que cubriría el titular si no estuviera de vacación/licencia. */
