/**
 * Ventana externa del cronograma: orden de la grilla principal, quién tiene turno
 * en el mes que se está viendo, alineación por día y el portapapeles compartido.
 */

import type { FuenteTurno } from './copiarTurno';

export type { FuenteTurno };

export const CANAL_PORTAPAPELES = 'cosp-planif-portapapeles';
export const KEY_PORTAPAPELES = 'cosp-planif-portapapeles';
export const CANAL_ORDEN = 'cosp-planif-orden';

export const keyOrden = (objectiveId: string) => `cosp-planif-orden:${objectiveId}`;

/** Hora HH:MM en Argentina, desde un string o un Timestamp de Firestore. */
export function hhmmCrono(v: unknown): string | undefined {
    if (v == null || v === '') return undefined;
    if (typeof v === 'string') {
        const m = v.match(/(\d{1,2}):(\d{2})/);
        if (!m) return undefined;
        return `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    const seconds = (v as { seconds?: number }).seconds;
    if (typeof seconds !== 'number') return undefined;
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Argentina/Cordoba',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(seconds * 1000));
    const h = parts.find((p) => p.type === 'hour')?.value;
    const min = parts.find((p) => p.type === 'minute')?.value;
    return h && min ? `${h}:${min}` : undefined;
}

export type CeldaPortapapeles = FuenteTurno | null;

export type PortapapelesCrono = {
    tsv: string;
    celdas: CeldaPortapapeles[][];
    /** Si viene, cada fila se pega por el nombre del guardia. Si no, por posición. */
    nombres?: string[];
};

export type OrdenCrono = { main: string; ids: string[]; month?: string };

export function armarFilasVentana<T extends { id: string }>(
    ordenIds: string[],
    personas: T[],
    tieneTurno: (id: string) => boolean,
): { conTurno: T[]; sinTurno: T[] } {
    const byId = new Map(personas.map((p) => [p.id, p]));
    const conTurno: T[] = [];
    const sinTurno: T[] = [];
    const vistos = new Set<string>();
    for (const id of ordenIds) {
        if (!id || vistos.has(id)) continue;
        vistos.add(id);
        const p = byId.get(id);
        if (!p) continue;
        (tieneTurno(id) ? conTurno : sinTurno).push(p);
    }
    return { conTurno, sinTurno };
}

export type ColumnaCrono = { date: Date | null };

/**
 * `semana` alinea el día 1 con un día de la semana.
 * Sin ancla, el lunes queda primero. Con el `getDay()` del día 1 del cronograma
 * principal, la columna 1 de la ventana es el mismo día de la semana que la columna 1 de allá.
 */
export function columnasCrono(days: Date[], modo: 'mes' | 'semana', anclaDow?: number): ColumnaCrono[] {
    if (modo === 'mes') return days.map((date) => ({ date }));
    if (!days.length) return [];
    const ancla = anclaDow == null ? 1 : ((anclaDow % 7) + 7) % 7;
    const dow = days[0].getDay();
    const lead = (dow - ancla + 7) % 7;
    const cols: ColumnaCrono[] = [];
    for (let i = 0; i < lead; i++) cols.push({ date: null });
    for (const date of days) cols.push({ date });
    while (cols.length % 7 !== 0) cols.push({ date: null });
    return cols;
}

export function armarPortapapeles(input: {
    filas: Array<{ nombre: string; celdas: CeldaPortapapeles[] }>;
    incluyeNombres: boolean;
}): PortapapelesCrono {
    const celdas = input.filas.map((f) => f.celdas.map((c) => (c && c.code ? {
        code: String(c.code).trim().toUpperCase(),
        startTime: c.startTime,
        endTime: c.endTime,
        hours: c.hours,
        name: c.name,
        positionName: c.positionName,
    } : null)));
    const nombres = input.incluyeNombres ? input.filas.map((f) => f.nombre) : undefined;
    const tsv = input.filas.map((f, i) => {
        const codes = celdas[i].map((c) => c?.code || '');
        return (nombres ? [nombres[i], ...codes] : codes).join('\t');
    }).join('\n');
    return { tsv, celdas, nombres };
}

export function guardarPortapapeles(p: PortapapelesCrono): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY_PORTAPAPELES, JSON.stringify(p)); } catch { /* cuota */ }
    try {
        const ch = new BroadcastChannel(CANAL_PORTAPAPELES);
        ch.postMessage(p);
        ch.close();
    } catch { /* sin canal */ }
}

export function leerPortapapeles(): PortapapelesCrono | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(KEY_PORTAPAPELES);
        if (!raw) return null;
        const p = JSON.parse(raw) as PortapapelesCrono;
        if (!p || !Array.isArray(p.celdas) || typeof p.tsv !== 'string') return null;
        return p;
    } catch {
        return null;
    }
}

export function publicarOrdenCrono(main: string, ids: string[], month?: string): void {
    if (!main || typeof localStorage === 'undefined') return;
    const payload: OrdenCrono = { main, ids, month };
    try { localStorage.setItem(keyOrden(main), JSON.stringify(payload)); } catch { /* cuota */ }
    try {
        const ch = new BroadcastChannel(CANAL_ORDEN);
        ch.postMessage(payload);
        ch.close();
    } catch { /* sin canal */ }
}

export function leerOrdenCrono(main: string): string[] {
    return leerOrdenMeta(main).ids;
}

export function leerOrdenMeta(main: string): { ids: string[]; month: string } {
    if (!main || typeof localStorage === 'undefined') return { ids: [], month: '' };
    try {
        const raw = localStorage.getItem(keyOrden(main));
        if (!raw) return { ids: [], month: '' };
        const p = JSON.parse(raw) as OrdenCrono;
        return {
            ids: Array.isArray(p?.ids) ? p.ids.map(String) : [],
            month: typeof p?.month === 'string' ? p.month : '',
        };
    } catch {
        return { ids: [], month: '' };
    }
}

const ORIGEN_OPERATIVO = new Set(['RETEN', 'OPERATIONS_COVERAGE', 'SLA_VIRTUAL']);

/** Turno planificado de ese objetivo en el mes (yyyy-mm). Un franco cuenta; una cobertura de Operaciones no. */
export function empleadoTieneTurno(
    empId: string,
    objectiveId: string,
    month: string,
    shiftsMap: Record<string, any>,
): boolean {
    if (!empId || !objectiveId || !month) return false;
    for (const [key, shift] of Object.entries(shiftsMap || {})) {
        if (!shift || shift.isDeleted) continue;
        if (String(shift.objectiveId || '') !== objectiveId) continue;
        const origin = String(shift.origin || '').toUpperCase();
        if (ORIGEN_OPERATIVO.has(origin) || shift.resolvedBy === 'OPERACIONES') continue;
        const corte = key.lastIndexOf('_');
        const id = String(shift.employeeId || (corte > 0 ? key.slice(0, corte) : ''));
        const date = String(shift.scheduleDate || (corte > 0 ? key.slice(corte + 1) : ''));
        if (id === empId && date.startsWith(`${month}-`)) return true;
    }
    return false;
}
