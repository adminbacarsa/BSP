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
    // Callable manageAbsences (backend Nest)
    'vacation': 'V',
    'sick_leave': 'E',
};

/** Etiquetas exactas del formulario RRHH → código grilla. */
export const RRHH_ABSENCE_LABEL_TO_CODE: Record<string, string> = {
    'Vacaciones': 'V',
    'Enfermedad': 'E',
    'ART': 'A',
    'Injustificada': 'AA',
    'Licencia Esp.': 'L',
    'PG Permiso Gremial': 'PG',
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

    const rawType = String(doc?.type || '').trim();
    if (rawType && RRHH_ABSENCE_LABEL_TO_CODE[rawType]) return RRHH_ABSENCE_LABEL_TO_CODE[rawType];

    const t = rawType.toLowerCase();
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
    'V', 'L', 'PG', 'A', 'E', 'AA', 'F', 'FF', 'FT', 'PAST', 'LOCKED', 'RET',
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
export function inferWorkShiftForAbsenceDay(
    empId: string,
    dateStr: string,
    shiftsMap: Record<string, GridShiftLike>,
    pendingChanges: Record<string, GridShiftLike & { isDeleted?: boolean }>,
    nonWorkCodes: Set<string> = PLANNING_ABSENCE_GRID_CODES,
): GridShiftLike | null {
    const readKey = (ds: string) => {
        const k = `${empId}_${ds}`;
        const p = pendingChanges[k];
        if (p?.isDeleted) return null;
        return (p ?? shiftsMap[k]) || null;
    };

    const direct = readKey(dateStr);
    const directCode = String(direct?.code || '').toUpperCase();
    if (direct && directCode && !nonWorkCodes.has(directCode)) return direct;

    const [y, m, d] = dateStr.split('-').map(Number);
    const dim = new Date(y, m - 1, 0).getDate();
    const targetDow = new Date(y, m - 1, d, 12, 0, 0, 0).getDay();

    for (let dd = 1; dd <= dim; dd++) {
        const probe = new Date(y, m - 1, dd, 12, 0, 0, 0);
        if (probe.getDay() !== targetDow) continue;
        const ds = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        if (ds === dateStr) continue;
        const s = readKey(ds);
        const c = String(s?.code || '').toUpperCase();
        if (s && c && !nonWorkCodes.has(c)) return s;
    }

    for (let delta = 1; delta <= dim; delta++) {
        for (const sign of [-1, 1]) {
            const dd = d + sign * delta;
            if (dd < 1 || dd > dim) continue;
            const ds = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
            const s = readKey(ds);
            const c = String(s?.code || '').toUpperCase();
            if (s && c && !nonWorkCodes.has(c)) return s;
        }
    }
    return null;
}
