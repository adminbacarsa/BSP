import {
    collection,
    doc,
    getDocs,
    query,
    Timestamp,
    updateDoc,
    where,
    writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import type {
    AjusteCronoInput,
    BandaAjuste,
    BandaDoce,
    BandaOcho,
    CambioBanda,
    EstrategiaCobertura,
    FilaGuardiaAjuste,
    RetenAjuste,
    ValidacionAjuste,
} from '@/types/ajustesCrono.types';

const WORK_8 = new Set(['M', 'T', 'N']);
const WORK_12 = new Set(['D12', 'N12']);

/** Firestore rechaza `undefined`; limpia objetos antes de batch.set. */
function stripUndefinedDeep<T>(value: T): T {
    if (value === undefined || value === null) return value;
    if (value instanceof Timestamp) return value;
    if (Array.isArray(value)) {
        return value.map(item => stripUndefinedDeep(item)) as T;
    }
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v !== undefined) out[k] = stripUndefinedDeep(v);
        }
        return out as T;
    }
    return value;
}

function setAjusteCronoDoc(
    batch: ReturnType<typeof writeBatch>,
    ajusteRef: ReturnType<typeof doc>,
    ajuste: AjusteCronoInput,
    empresaId: string,
) {
    batch.set(
        ajusteRef,
        stripUndefinedDeep(stampEmpresaId({ ...ajuste, createdAt: Timestamp.now() }, empresaId)),
    );
}

export type ObjetivoOption = { id: string; nombre: string; clientId: string };

export type GridTurnoSnapshot = {
    shiftsMap: Record<string, any>;
    pendingChanges: Record<string, any>;
};

/** Misma clave YYYY-MM-DD que la grilla de planificación (AR). */
export function dateKeyAr(dateInput: Date | { toDate?: () => Date }): string {
    const d = dateInput instanceof Date ? dateInput : dateInput.toDate?.() ?? new Date(dateInput as any);
    const options: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    };
    const parts = new Intl.DateTimeFormat('es-AR', options).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    return `${year}-${month}-${day}`;
}

/** Lee turnos del día desde la grilla (shiftsMap + pendingChanges), igual que la UI. */
export function turnosObjetivoDiaFromGrid(
    objectiveId: string,
    fecha: Date,
    grid: GridTurnoSnapshot,
): TurnoDiaRow[] {
    const dateStr = dateKeyAr(fecha);
    const empIds = new Set<string>();
    for (const key of Object.keys(grid.shiftsMap)) {
        if (key.endsWith(`_${dateStr}`)) empIds.add(key.slice(0, key.length - dateStr.length - 1));
    }
    for (const key of Object.keys(grid.pendingChanges)) {
        if (key.endsWith(`_${dateStr}`)) empIds.add(key.slice(0, key.length - dateStr.length - 1));
    }

    const rows: TurnoDiaRow[] = [];
    for (const empId of empIds) {
        const key = `${empId}_${dateStr}`;
        const pending = grid.pendingChanges[key];
        const existing = grid.shiftsMap[key];
        let shift: any = null;
        let fromPending = false;
        if (pending !== undefined) {
            if (pending?.isDeleted) continue;
            shift = pending;
            fromPending = true;
        } else {
            shift = existing;
        }
        if (!shift) continue;
        const shiftObjective = shift.objectiveId || (fromPending ? objectiveId : '');
        if (shiftObjective !== objectiveId && !fromPending) continue;
        if (shiftObjective && shiftObjective !== objectiveId && fromPending) continue;

        rows.push({
            id: String(shift.id || `grid_${empId}_${dateStr}`),
            employeeId: empId,
            employeeName: String(shift.employeeName || shift.name || empId),
            code: String(shift.code || shift.type || '').toUpperCase(),
            objectiveId,
            objectiveName: shift.objectiveName,
            startTime: shift.startTime,
            endTime: shift.endTime,
            draft: shift.draft === true || shift.isTemp === true,
            origin: shift.origin,
            isReten: shift.isReten === true,
            resolvedBy: shift.resolvedBy,
        });
    }
    return filterTurnosParaAjuste(rows);
}

export function gridHasPendingInRange(
    grid: GridTurnoSnapshot | undefined,
    objectiveId: string,
    fechaInicio: Date,
    fechaFin: Date,
): boolean {
    if (!grid) return false;
    const dias = eachDayInRange(fechaInicio, fechaFin);
    for (const dia of dias) {
        const dateStr = dateKeyAr(dia);
        for (const [key, pending] of Object.entries(grid.pendingChanges)) {
            if (!key.endsWith(`_${dateStr}`)) continue;
            if (pending?.isDeleted) continue;
            const obj = pending.objectiveId || objectiveId;
            if (obj === objectiveId) return true;
        }
    }
    return false;
}

export type TurnoDiaRow = {
    id: string;
    employeeId: string;
    employeeName: string;
    code: string;
    objectiveId: string;
    objectiveName?: string;
    startTime?: Timestamp;
    endTime?: Timestamp;
    draft?: boolean;
    origin?: string;
    isReten?: boolean;
    resolvedBy?: string;
};

function isOperationalTurno(data: {
    origin?: string;
    isReten?: boolean;
    resolvedBy?: string;
}): boolean {
    return data.origin === 'RETEN'
        || data.origin === 'OPERATIONS_COVERAGE'
        || data.origin === 'SLA_VIRTUAL'
        || !!data.isReten
        || data.resolvedBy === 'OPERACIONES';
}

function isWorkBandCode(code: string): boolean {
    return WORK_8.has(code) || WORK_12.has(code) || code === 'RET';
}

/** Incluye draft:true — la grilla de planificación muestra borradores no publicados. */
function filterTurnosParaAjuste(
    rows: TurnoDiaRow[],
    opts?: { includeDraft?: boolean; workBandsOnly?: boolean },
): TurnoDiaRow[] {
    const includeDraft = opts?.includeDraft !== false;
    const workBandsOnly = opts?.workBandsOnly !== false;
    return rows.filter(t => {
        if (!t.employeeId) return false;
        if (!includeDraft && t.draft) return false;
        if (isOperationalTurno(t)) return false;
        if (workBandsOnly && !isWorkBandCode(t.code)) return false;
        return true;
    });
}

export function flattenObjetivosFromClients(clients: any[]): ObjetivoOption[] {
    const out: ObjetivoOption[] = [];
    for (const c of clients || []) {
        for (const o of c.objetivos || []) {
            const id = String(o.id || o.name || '');
            if (!id) continue;
            out.push({
                id,
                nombre: String(o.name || o.nombre || id),
                clientId: c.id,
            });
        }
    }
    return out.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function normBandaOcho(code: string): BandaOcho | null {
    const c = String(code || '').toUpperCase();
    if (c === 'D12') return 'M';
    if (c === 'N12') return 'N';
    if (WORK_8.has(c)) return c as BandaOcho;
    return null;
}

export function build12hTimes(fecha: Date, band: BandaDoce): { startTime: Timestamp; endTime: Timestamp } {
    const y = fecha.getFullYear();
    const m = fecha.getMonth();
    const d = fecha.getDate();
    if (band === 'D12') {
        return {
            startTime: Timestamp.fromDate(new Date(y, m, d, 6, 0, 0, 0)),
            endTime: Timestamp.fromDate(new Date(y, m, d, 18, 0, 0, 0)),
        };
    }
    return {
        startTime: Timestamp.fromDate(new Date(y, m, d, 18, 0, 0, 0)),
        endTime: Timestamp.fromDate(new Date(y, m, d + 1, 6, 0, 0, 0)),
    };
}

export function build8hTimes(fecha: Date, band: BandaOcho): { startTime: Timestamp; endTime: Timestamp } {
    const y = fecha.getFullYear();
    const m = fecha.getMonth();
    const d = fecha.getDate();
    const map: Record<BandaOcho, [number, number, number, number]> = {
        M: [7, 0, 15, 0],
        T: [15, 0, 23, 0],
        N: [23, 0, 7, 0],
    };
    const [sh, sm, eh, em] = map[band];
    const start = new Date(y, m, d, sh, sm, 0, 0);
    const end = band === 'N'
        ? new Date(y, m, d + 1, eh, em, 0, 0)
        : new Date(y, m, d, eh, em, 0, 0);
    return { startTime: Timestamp.fromDate(start), endTime: Timestamp.fromDate(end) };
}

export function validateAjusteOperativo(filas: FilaGuardiaAjuste[]): ValidacionAjuste {
    const errores: string[] = [];
    const retenes = filas.filter(f => f.bandaAjuste === 'RET');
    const cambios = filas.filter(f => {
        if (f.bandaAjuste === 'RET') return false;
        if (WORK_12.has(f.bandaAjuste)) return f.bandaAjuste !== f.bandaOriginal;
        return f.bandaAjuste !== f.bandaOriginal;
    });
    const activas = filas.filter(f => f.bandaAjuste !== 'RET');
    const tieneD12 = activas.some(f => f.bandaAjuste === 'D12');
    const tieneN12 = activas.some(f => f.bandaAjuste === 'N12');

    const hayCambio = cambios.length > 0 || retenes.length > 0;
    if (!hayCambio) errores.push('No hay cambios para guardar.');

    if (retenes.length > 0) {
        if (!tieneD12 || !tieneN12) {
            errores.push('Con RET activo, el servicio debe quedar con al menos D12 y N12.');
        }
        if (activas.every(f => f.bandaAjuste === 'D12')) {
            errores.push('No se puede dejar el servicio sin cobertura nocturna (solo D12).');
        }
    }

    return {
        valido: errores.length === 0 && hayCambio,
        errores,
        tieneD12,
        tieneN12,
        retenes,
        cambios,
    };
}

export async function fetchTurnosObjetivoDia(
    objectiveId: string,
    fecha: Date,
    opts?: { includeDraft?: boolean },
): Promise<TurnoDiaRow[]> {
    const start = new Date(fecha);
    start.setHours(0, 0, 0, 0);
    const end = new Date(fecha);
    end.setHours(23, 59, 59, 999);
    const snap = await getDocs(query(
        collection(db, 'turnos'),
        where('objectiveId', '==', objectiveId),
        where('startTime', '>=', Timestamp.fromDate(start)),
        where('startTime', '<=', Timestamp.fromDate(end)),
    ));
    const rows = snap.docs.map(d => {
        const data = d.data() as any;
        return {
            id: d.id,
            employeeId: String(data.employeeId || ''),
            employeeName: String(data.employeeName || data.employeeId || ''),
            code: String(data.code || data.type || '').toUpperCase(),
            objectiveId: String(data.objectiveId || ''),
            objectiveName: data.objectiveName,
            startTime: data.startTime,
            endTime: data.endTime,
            draft: data.draft === true,
            origin: data.origin,
            isReten: data.isReten === true,
            resolvedBy: data.resolvedBy,
        };
    });
    return filterTurnosParaAjuste(rows, opts);
}

export async function fetchTurnosEmpleadoRango(
    employeeId: string,
    fechaInicio: Date,
    fechaFin: Date,
): Promise<TurnoDiaRow[]> {
    const start = new Date(fechaInicio);
    start.setHours(0, 0, 0, 0);
    const end = new Date(fechaFin);
    end.setHours(23, 59, 59, 999);
    const snap = await getDocs(query(
        collection(db, 'turnos'),
        where('employeeId', '==', employeeId),
        where('startTime', '>=', Timestamp.fromDate(start)),
        where('startTime', '<=', Timestamp.fromDate(end)),
    ));
    return snap.docs.map(d => {
        const data = d.data() as any;
        return {
            id: d.id,
            employeeId: String(data.employeeId || ''),
            employeeName: String(data.employeeName || ''),
            code: String(data.code || data.type || '').toUpperCase(),
            objectiveId: String(data.objectiveId || ''),
            objectiveName: data.objectiveName,
            startTime: data.startTime,
            endTime: data.endTime,
            draft: data.draft === true,
        };
    }).filter(t => !t.draft && t.employeeId);
}

export async function fetchTurnosObjetivoRango(
    objectiveId: string,
    fechaInicio: Date,
    fechaFin: Date,
    opts?: { includeDraft?: boolean },
): Promise<TurnoDiaRow[]> {
    const start = new Date(fechaInicio);
    start.setHours(0, 0, 0, 0);
    const end = new Date(fechaFin);
    end.setHours(23, 59, 59, 999);
    const snap = await getDocs(query(
        collection(db, 'turnos'),
        where('objectiveId', '==', objectiveId),
        where('startTime', '>=', Timestamp.fromDate(start)),
        where('startTime', '<=', Timestamp.fromDate(end)),
    ));
    const rows = snap.docs.map(d => {
        const data = d.data() as any;
        return {
            id: d.id,
            employeeId: String(data.employeeId || ''),
            employeeName: String(data.employeeName || ''),
            code: String(data.code || data.type || '').toUpperCase(),
            objectiveId: String(data.objectiveId || ''),
            objectiveName: data.objectiveName,
            startTime: data.startTime,
            endTime: data.endTime,
            draft: data.draft === true,
            origin: data.origin,
            isReten: data.isReten === true,
            resolvedBy: data.resolvedBy,
        };
    });
    return filterTurnosParaAjuste(rows, opts);
}

export async function existsActiveAjusteOperativo(
    empresaId: string,
    objectiveId: string,
    fecha: Date,
): Promise<boolean> {
    const snap = await getDocs(query(
        collection(db, 'ajustes_crono'),
        where('empresaId', '==', empresaId),
        where('tipo', '==', 'OPERATIVO'),
        where('origenObjetivoId', '==', objectiveId),
        where('estado', '==', 'ACTIVO'),
    ));
    const dayStr = fecha.toISOString().slice(0, 10);
    return snap.docs.some(d => {
        const data = d.data() as any;
        const ini = data.fechaInicio?.toDate?.() as Date | undefined;
        return ini && ini.toISOString().slice(0, 10) === dayStr;
    });
}

export async function existsActiveAjusteAusencia(
    empresaId: string,
    ausenciaId: string,
): Promise<boolean> {
    const snap = await getDocs(query(
        collection(db, 'ajustes_crono'),
        where('empresaId', '==', empresaId),
        where('ausenciaId', '==', ausenciaId),
        where('estado', '==', 'ACTIVO'),
    ));
    return !snap.empty;
}

function appendOperativoOps(
    batch: ReturnType<typeof writeBatch>,
    fecha: Date,
    objectiveId: string,
    empresaId: string,
    filas: FilaGuardiaAjuste[],
    cambiosBanda: CambioBanda[],
    retenes: RetenAjuste[],
) {
    for (const fila of filas) {
        const band = fila.bandaAjuste;
        if (band === 'RET') {
            const destId = fila.destinoObjetivoId;
            const destNombre = fila.destinoObjetivoNombre;
            batch.update(doc(db, 'turnos', fila.turnoId), {
                origin: 'RETEN',
                isReten: true,
                code: 'RET',
                name: 'Retén',
                hours: 0,
            });
            const reten: RetenAjuste = {
                employeeId: fila.employeeId,
                employeeName: fila.employeeName,
                turnoOrigenIds: [fila.turnoId],
                estado: destId ? 'ASIGNADO' : 'DISPONIBLE',
            };
            if (destId) {
                reten.destinoObjetivoId = destId;
                if (destNombre) reten.destinoObjetivoNombre = destNombre;
            }
            if (destId && destId !== objectiveId) {
                const { startTime, endTime } = build8hTimes(fecha, fila.bandaOriginal);
                const ref = doc(collection(db, 'turnos'));
                batch.set(ref, stampEmpresaId({
                    employeeId: fila.employeeId,
                    employeeName: fila.employeeName,
                    objectiveId: destId,
                    objectiveName: destNombre || destId,
                    code: fila.bandaOriginal,
                    name: fila.bandaOriginal,
                    hours: 8,
                    startTime,
                    endTime,
                    origin: 'RETEN',
                    isReten: true,
                    draft: false,
                }, empresaId));
                reten.destinoTurnoIds = [ref.id];
            }
            retenes.push(reten);
            continue;
        }

        if (band === fila.bandaOriginal) continue;

        if (WORK_12.has(band)) {
            const { startTime, endTime } = build12hTimes(fecha, band as BandaDoce);
            batch.update(doc(db, 'turnos', fila.turnoId), {
                code: band,
                name: band,
                hours: 12,
                startTime,
                endTime,
            });
            cambiosBanda.push({
                employeeId: fila.employeeId,
                employeeName: fila.employeeName,
                bandaAnterior: fila.bandaOriginal,
                bandaNueva: band as BandaDoce,
                turnoIds: [fila.turnoId],
            });
        } else if (WORK_8.has(band)) {
            const b = band as BandaOcho;
            const { startTime, endTime } = build8hTimes(fecha, b);
            batch.update(doc(db, 'turnos', fila.turnoId), {
                code: b,
                name: b,
                hours: 8,
                startTime,
                endTime,
            });
        }
    }
}

export async function applyAjusteOperativo(params: {
    empresaId: string;
    creadoPor: string;
    fecha: Date;
    objectiveId: string;
    objectiveNombre: string;
    motivo: string;
    filas: FilaGuardiaAjuste[];
}): Promise<string> {
    const { empresaId, creadoPor, fecha, objectiveId, objectiveNombre, motivo, filas } = params;
    const valid = validateAjusteOperativo(filas);
    if (!valid.valido) throw new Error(valid.errores.join(' '));

    if (await existsActiveAjusteOperativo(empresaId, objectiveId, fecha)) {
        throw new Error('Ya existe un ajuste activo para este objetivo y fecha.');
    }

    const batch = writeBatch(db);
    const cambiosBanda: CambioBanda[] = [];
    const retenes: RetenAjuste[] = [];
    appendOperativoOps(batch, fecha, objectiveId, empresaId, filas, cambiosBanda, retenes);

    const dayTs = Timestamp.fromDate(fecha);
    const ajusteRef = doc(collection(db, 'ajustes_crono'));
    const ajuste: AjusteCronoInput = {
        empresaId,
        tipo: 'OPERATIVO',
        fechaInicio: dayTs,
        fechaFin: dayTs,
        origenObjetivoId: objectiveId,
        origenObjetivoNombre: objectiveNombre,
        motivo,
        cambiosBanda,
        retenes,
        creadoPor,
        estado: 'ACTIVO',
    };
    setAjusteCronoDoc(batch, ajusteRef, ajuste, empresaId);

    await batch.commit();
    return ajusteRef.id;
}

export function eachDayInRange(start: Date, end: Date): Date[] {
    const days: Date[] = [];
    const cur = new Date(start);
    cur.setHours(12, 0, 0, 0);
    const last = new Date(end);
    last.setHours(12, 0, 0, 0);
    while (cur <= last) {
        days.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

export async function applyAjusteCobertura(params: {
    empresaId: string;
    creadoPor: string;
    ausenciaId: string;
    guardiaAusenteId: string;
    guardiaAusenteNombre: string;
    startDate: Date;
    endDate: Date;
    objectiveId: string;
    objectiveNombre: string;
    motivo: string;
    estrategia: EstrategiaCobertura;
    filasCompaneros?: FilaGuardiaAjuste[];
    retenExterno?: FilaGuardiaAjuste;
    origenObjetivoReten?: { id: string; nombre: string };
}): Promise<string> {
    const {
        empresaId, creadoPor, ausenciaId, guardiaAusenteId, guardiaAusenteNombre,
        startDate, endDate, objectiveId, objectiveNombre, motivo, estrategia,
        filasCompaneros = [], retenExterno, origenObjetivoReten,
    } = params;

    if (await existsActiveAjusteAusencia(empresaId, ausenciaId)) {
        throw new Error('Esta ausencia ya tiene un ajuste activo.');
    }

    const dias = eachDayInRange(startDate, endDate);
    const batch = writeBatch(db);
    const cambiosBanda: CambioBanda[] = [];
    const retenes: RetenAjuste[] = [];

    const allTurnos = await fetchTurnosObjetivoRango(objectiveId, startDate, endDate);
    const ausenteTurnos = allTurnos.filter(t => t.employeeId === guardiaAusenteId);

    for (const t of ausenteTurnos) {
        const payload: Record<string, unknown> = { isAbsent: true, ausenciaId };
        if (estrategia === 'VACANTE') payload.isReportedToPlanning = true;
        batch.update(doc(db, 'turnos', t.id), payload);
    }

    if (estrategia === 'COMPRIMIR_12H') {
        for (const t of allTurnos) {
            if (t.employeeId === guardiaAusenteId) continue;
            const fila = filasCompaneros.find(f => f.employeeId === t.employeeId);
            if (!fila) continue;
            const band = fila.bandaAjuste;
            if (!WORK_12.has(band) || band === fila.bandaOriginal) continue;
            const dia = t.startTime?.toDate?.() ?? startDate;
            const { startTime, endTime } = build12hTimes(dia, band as BandaDoce);
            batch.update(doc(db, 'turnos', t.id), {
                code: band,
                name: band,
                hours: 12,
                startTime,
                endTime,
            });
            let entry = cambiosBanda.find(c =>
                c.employeeId === fila.employeeId && c.bandaNueva === band,
            );
            if (!entry) {
                entry = {
                    employeeId: fila.employeeId,
                    employeeName: fila.employeeName,
                    bandaAnterior: fila.bandaOriginal,
                    bandaNueva: band as BandaDoce,
                    turnoIds: [],
                };
                cambiosBanda.push(entry);
            }
            entry.turnoIds.push(t.id);
        }
    } else if (estrategia === 'RETEN_EXTERNO' && retenExterno && origenObjetivoReten) {
        const templates: FilaGuardiaAjuste[] = [
            ...filasCompaneros,
            {
                ...retenExterno,
                bandaAjuste: 'RET',
                destinoObjetivoId: objectiveId,
                destinoObjetivoNombre: objectiveNombre,
            },
        ];
        for (const dia of dias) {
            const turnosDia = await fetchTurnosObjetivoDia(origenObjetivoReten.id, dia);
            const diaFilas = templates
                .map(f => {
                    const match = turnosDia.find(t => t.employeeId === f.employeeId);
                    if (!match) return null;
                    return {
                        ...f,
                        turnoId: match.id,
                        bandaOriginal: normBandaOcho(match.code) || f.bandaOriginal,
                    };
                })
                .filter(Boolean) as FilaGuardiaAjuste[];
            if (diaFilas.length > 0) {
                appendOperativoOps(
                    batch, dia, origenObjetivoReten.id, empresaId,
                    diaFilas, cambiosBanda, retenes,
                );
            }
        }
    }

    const coberturaEstado = estrategia === 'VACANTE' ? 'VACANTE' : 'GESTIONADA';
    const ajusteRef = doc(collection(db, 'ajustes_crono'));
    const ajuste: AjusteCronoInput = {
        empresaId,
        tipo: 'COBERTURA_AUSENCIA',
        fechaInicio: Timestamp.fromDate(startDate),
        fechaFin: Timestamp.fromDate(endDate),
        origenObjetivoId: objectiveId,
        origenObjetivoNombre: objectiveNombre,
        motivo,
        cambiosBanda,
        retenes,
        guardiaAusenteId,
        guardiaAusenteNombre,
        ausenciaId,
        estrategiaCobertura: estrategia,
        creadoPor,
        estado: 'ACTIVO',
    };
    setAjusteCronoDoc(batch, ajusteRef, ajuste, empresaId);
    batch.update(doc(db, 'ausencias', ausenciaId), {
        ajusteCronoId: ajusteRef.id,
        coberturaEstado,
    });

    await batch.commit();
    return ajusteRef.id;
}

export function suggestCompaneroBands(filas: FilaGuardiaAjuste[]): FilaGuardiaAjuste[] {
    return filas.map(f => {
        if (f.bandaOriginal === 'N') return { ...f, bandaAjuste: 'N12' };
        return { ...f, bandaAjuste: 'D12' };
    });
}

/** Comprime compañeros cuando uno del servicio está ausente (2 quedan → D12 + N12). */
export function autoComprimirCompanerosAusencia(companions: FilaGuardiaAjuste[]): AutoComprimirResult {
    if (companions.length < 2) {
        return {
            filas: companions,
            valido: false,
            errores: ['Se necesitan al menos 2 compañeros en el servicio para comprimir a 12h.'],
        };
    }
    const hasN = companions.some(f => f.bandaOriginal === 'N');
    const filas = companions.map(f => {
        if (f.bandaOriginal === 'N') return { ...f, bandaAjuste: 'N12' as BandaAjuste };
        if (f.bandaOriginal === 'M') return { ...f, bandaAjuste: 'D12' as BandaAjuste };
        if (f.bandaOriginal === 'T') {
            return { ...f, bandaAjuste: (hasN ? 'D12' : 'N12') as BandaAjuste };
        }
        return { ...f, bandaAjuste: 'D12' as BandaAjuste };
    });
    const tieneD12 = filas.some(f => f.bandaAjuste === 'D12');
    const tieneN12 = filas.some(f => f.bandaAjuste === 'N12');
    if (!tieneD12 || !tieneN12) {
        return {
            filas,
            valido: false,
            errores: ['No se puede armar cobertura D12+N12 con los compañeros disponibles.'],
        };
    }
    return { filas, valido: true, errores: [] };
}

export type AusenciaCoberturaContext = {
    objectiveId: string;
    objectiveNombre: string;
    bandaAusente: string;
    dias: number;
    turnosAusente: number;
    companeros: FilaGuardiaAjuste[];
    propuesta: AutoComprimirResult;
    turnosAComprimir: number;
};

export async function resolveAusenciaCoberturaContext(
    employeeId: string,
    startDate: Date,
    endDate: Date,
    objetivoNombres?: Map<string, string>,
): Promise<AusenciaCoberturaContext | null> {
    const ausenteTurnos = await fetchTurnosEmpleadoRango(employeeId, startDate, endDate);
    if (ausenteTurnos.length === 0) return null;

    const objectiveId = ausenteTurnos[0].objectiveId;
    const objectiveNombre = ausenteTurnos[0].objectiveName
        || objetivoNombres?.get(objectiveId)
        || objectiveId;
    const bandaAusente = normBandaOcho(ausenteTurnos[0].code) || '?';
    const dias = eachDayInRange(startDate, endDate).length;

    const firstDay = startDate.toISOString().slice(0, 10);
    const objTurnos = await fetchTurnosObjetivoRango(objectiveId, startDate, endDate);
    const firstDayTurnos = objTurnos.filter(t => {
        const d = t.startTime?.toDate?.();
        return d && d.toISOString().slice(0, 10) === firstDay;
    });
    const companions = filasFromTurnosDia(
        firstDayTurnos.filter(t => t.employeeId !== employeeId),
    );
    const propuesta = autoComprimirCompanerosAusencia(companions);
    const turnosAComprimir = propuesta.valido
        ? objTurnos.filter(t =>
            t.employeeId !== employeeId
            && propuesta.filas.some(f => f.employeeId === t.employeeId && f.bandaAjuste !== f.bandaOriginal),
        ).length
        : 0;

    return {
        objectiveId,
        objectiveNombre,
        bandaAusente,
        dias,
        turnosAusente: ausenteTurnos.length,
        companeros: propuesta.filas,
        propuesta,
        turnosAComprimir,
    };
}

export async function applyCoberturaAusenciaAutomatica(params: {
    empresaId: string;
    creadoPor: string;
    ausenciaId: string;
    employeeId: string;
    employeeName: string;
    startDate: Date;
    endDate: Date;
    tipo: string;
    estrategia?: EstrategiaCobertura;
    motivo?: string;
}): Promise<string> {
    const {
        empresaId, creadoPor, ausenciaId, employeeId, employeeName,
        startDate, endDate, tipo, estrategia = 'COMPRIMIR_12H', motivo,
    } = params;

    const ctx = await resolveAusenciaCoberturaContext(employeeId, startDate, endDate);
    if (!ctx) {
        const turnos = await fetchTurnosEmpleadoRango(employeeId, startDate, endDate);
        if (turnos.length === 0) {
            throw new Error('No se encontraron turnos del guardia en el período.');
        }
        if (estrategia !== 'VACANTE') {
            throw new Error('No se pudo determinar el servicio para comprimir.');
        }
        const objId = turnos[0].objectiveId;
        return applyAjusteCobertura({
            empresaId,
            creadoPor,
            ausenciaId,
            guardiaAusenteId: employeeId,
            guardiaAusenteNombre: employeeName,
            startDate,
            endDate,
            objectiveId: objId,
            objectiveNombre: turnos[0].objectiveName || objId,
            motivo: motivo?.trim() || `Cobertura ${mapAbsenceTypeToCobertura(tipo).toLowerCase()} — vacante`,
            estrategia: 'VACANTE',
            filasCompaneros: [],
        });
    }
    if (estrategia === 'COMPRIMIR_12H' && !ctx.propuesta.valido) {
        throw new Error(ctx.propuesta.errores.join(' ') || 'No se puede comprimir el servicio.');
    }

    const tipoLabel = mapAbsenceTypeToCobertura(tipo);
    return applyAjusteCobertura({
        empresaId,
        creadoPor,
        ausenciaId,
        guardiaAusenteId: employeeId,
        guardiaAusenteNombre: employeeName,
        startDate,
        endDate,
        objectiveId: ctx?.objectiveId || '',
        objectiveNombre: ctx?.objectiveNombre || '',
        motivo: motivo?.trim() || `Cobertura ${tipoLabel.toLowerCase()} — ajuste crono`,
        estrategia,
        filasCompaneros: ctx?.propuesta.filas || [],
    });
}

export type CoberturaMasivoResult = {
    aplicadas: number;
    omitidas: number;
    errores: string[];
};

export async function applyCoberturaPendientesMasivo(params: {
    empresaId: string;
    creadoPor: string;
    ausencias: Array<{
        id: string;
        employeeId: string;
        employeeName: string;
        startDate: string;
        endDate: string;
        type: string;
        coberturaEstado?: string;
        status: string;
    }>;
    estrategia?: EstrategiaCobertura;
    onProgress?: (msg: string) => void;
}): Promise<CoberturaMasivoResult> {
    const { empresaId, creadoPor, ausencias, estrategia = 'COMPRIMIR_12H', onProgress } = params;
    let aplicadas = 0;
    let omitidas = 0;
    const errores: string[] = [];

    const pendientes = ausencias.filter(a =>
        a.status !== 'Rechazada'
        && (!a.coberturaEstado || a.coberturaEstado === 'PENDIENTE'),
    );

    for (const a of pendientes) {
        if (await existsActiveAjusteAusencia(empresaId, a.id)) {
            omitidas++;
            continue;
        }
        onProgress?.(a.employeeName);
        try {
            await applyCoberturaAusenciaAutomatica({
                empresaId,
                creadoPor,
                ausenciaId: a.id,
                employeeId: a.employeeId,
                employeeName: a.employeeName,
                startDate: new Date(`${a.startDate}T12:00:00`),
                endDate: new Date(`${a.endDate}T12:00:00`),
                tipo: a.type,
                estrategia,
            });
            aplicadas++;
        } catch (e: any) {
            omitidas++;
            errores.push(`${a.employeeName}: ${e?.message || 'error'}`);
        }
    }

    return { aplicadas, omitidas, errores };
}

/** Guardia sugerido para liberar: preferir banda T (el típico "sobrante" al comprimir). */
export function sugerirLiberarDefault(filas: FilaGuardiaAjuste[]): string | null {
    const t = filas.find(f => f.bandaOriginal === 'T');
    if (t) return t.employeeId;
    const extra = filas.find(f => f.bandaOriginal !== 'M' && f.bandaOriginal !== 'N');
    if (extra) return extra.employeeId;
    const notN = filas.find(f => f.bandaOriginal !== 'N');
    return notN?.employeeId ?? filas[0]?.employeeId ?? null;
}

export type AutoComprimirResult = {
    filas: FilaGuardiaAjuste[];
    valido: boolean;
    errores: string[];
};

/**
 * Comprime automáticamente 3×8h → 2×12h + RET.
 * M (o quien cubra día) → D12, N → N12, elegido → RET.
 */
export function autoComprimir12h(
    base: FilaGuardiaAjuste[],
    liberarEmployeeId: string,
): AutoComprimirResult {
    if (base.length < 3) {
        return {
            filas: base,
            valido: false,
            errores: ['Se necesitan al menos 3 guardias (M+T+N) para comprimir y liberar uno a RET.'],
        };
    }
    const n = base.find(f => f.bandaOriginal === 'N');
    const liberar = base.find(f => f.employeeId === liberarEmployeeId);
    if (!n) {
        return { filas: base, valido: false, errores: ['No hay turno Noche (N). No se puede comprimir sin cobertura nocturna.'] };
    }
    if (!liberar) {
        return { filas: base, valido: false, errores: ['Guardia a liberar no encontrado.'] };
    }
    if (liberar.employeeId === n.employeeId) {
        return {
            filas: base,
            valido: false,
            errores: ['No podés liberar al de Noche — el servicio quedaría sin N12.'],
        };
    }
    const diurno = base.find(f => f.employeeId !== liberarEmployeeId && f.bandaOriginal === 'M')
        ?? base.find(f => f.employeeId !== liberarEmployeeId && f.bandaOriginal === 'T')
        ?? base.find(f => f.employeeId !== liberarEmployeeId && f.employeeId !== n.employeeId);
    if (!diurno) {
        return { filas: base, valido: false, errores: ['No se pudo asignar cobertura diurna D12.'] };
    }

    const filas = base.map(f => {
        if (f.employeeId === liberarEmployeeId) return { ...f, bandaAjuste: 'RET' as BandaAjuste };
        if (f.employeeId === n.employeeId) return { ...f, bandaAjuste: 'N12' as BandaAjuste };
        if (f.employeeId === diurno.employeeId) return { ...f, bandaAjuste: 'D12' as BandaAjuste };
        return { ...f, bandaAjuste: 'RET' as BandaAjuste };
    });
    const v = validateAjusteOperativo(filas);
    return { filas, valido: v.valido, errores: v.errores };
}

/** Comprime y elige automáticamente — soporta dotación multi-guardia (ej. 4M+4T+4N). */
export function autoComprimir12hAutomatico(base: FilaGuardiaAjuste[]): AutoComprimirResult {
    if (base.length === 0) {
        return { filas: base, valido: false, errores: ['No hay turnos planificados ese día.'] };
    }

    const countM = base.filter(f => f.bandaOriginal === 'M').length;
    const countT = base.filter(f => f.bandaOriginal === 'T').length;
    const countN = base.filter(f => f.bandaOriginal === 'N').length;
    const hasM = countM > 0;
    const hasT = countT > 0;
    const hasN = countN > 0;

    // Dotación 3 bandas (1 o más guardias por banda): M→D12, N→N12, T→RET
    if (hasM && hasT && hasN) {
        const filas = base.map(f => {
            if (f.bandaOriginal === 'M') return { ...f, bandaAjuste: 'D12' as BandaAjuste };
            if (f.bandaOriginal === 'N') return { ...f, bandaAjuste: 'N12' as BandaAjuste };
            if (f.bandaOriginal === 'T') return { ...f, bandaAjuste: 'RET' as BandaAjuste };
            return f;
        });
        const v = validateAjusteOperativo(filas);
        return { filas, valido: v.valido, errores: v.errores };
    }

    if (!hasT) {
        return {
            filas: base,
            valido: false,
            errores: [`Sin banda Tarde ese día (M:${countM} T:0 N:${countN}) — no hay guardias para liberar a RET.`],
        };
    }

    // Fallback clásico 3 guardias
    const liberarId = sugerirLiberarDefault(base);
    if (!liberarId) {
        return { filas: base, valido: false, errores: ['No se pudo determinar guardia a liberar.'] };
    }
    return autoComprimir12h(base, liberarId);
}

export function filasFromTurnosDia(turnos: TurnoDiaRow[]): FilaGuardiaAjuste[] {
    return turnos
        .map(t => {
            const band = normBandaOcho(t.code);
            if (!band) return null;
            return {
                employeeId: t.employeeId,
                employeeName: t.employeeName,
                turnoId: t.id,
                bandaOriginal: band,
                bandaAjuste: band,
            } as FilaGuardiaAjuste;
        })
        .filter(Boolean) as FilaGuardiaAjuste[];
}

export type AjusteOperativoPreviewSlot = {
    objectiveId: string;
    objectiveNombre: string;
    fecha: Date;
    valido: boolean;
    retenes: number;
    omitido?: string;
};

export type AjusteOperativoMasivoResult = {
    retenesLiberados: number;
    slotsAplicados: number;
    slotsOmitidos: number;
    servicios: number;
    ajusteIds: string[];
    errores: string[];
};

export async function previewAjusteOperativoMasivo(
    objectiveIds: string[],
    objetivoNombres: Map<string, string>,
    fechaInicio: Date,
    fechaFin: Date,
    grid?: GridTurnoSnapshot,
): Promise<{ slots: AjusteOperativoPreviewSlot[]; totalRetenes: number }> {
    const dias = eachDayInRange(fechaInicio, fechaFin);
    const slots: AjusteOperativoPreviewSlot[] = [];

    for (const objectiveId of objectiveIds) {
        const nombre = objetivoNombres.get(objectiveId) || objectiveId;
        for (const dia of dias) {
            const turnos = grid
                ? turnosObjetivoDiaFromGrid(objectiveId, dia, grid)
                : await fetchTurnosObjetivoDia(objectiveId, dia);
            const base = filasFromTurnosDia(turnos);
            const prop = autoComprimir12hAutomatico(base);
            const retenes = prop.valido ? prop.filas.filter(f => f.bandaAjuste === 'RET').length : 0;
            slots.push({
                objectiveId,
                objectiveNombre: nombre,
                fecha: dia,
                valido: prop.valido,
                retenes,
                omitido: prop.valido ? undefined : (prop.errores[0] || 'Sin dotación 3×8'),
            });
        }
    }

    const totalRetenes = slots.filter(s => s.valido).reduce((acc, s) => acc + s.retenes, 0);
    return { slots, totalRetenes };
}

export async function applyAjusteOperativoMasivo(params: {
    empresaId: string;
    creadoPor: string;
    fechaInicio: Date;
    fechaFin: Date;
    objectiveIds: string[];
    objetivoNombres: Map<string, string>;
    motivo: string;
    destinoObjetivoId?: string;
    destinoObjetivoNombre?: string;
    onProgress?: (msg: string) => void;
}): Promise<AjusteOperativoMasivoResult> {
    const {
        empresaId, creadoPor, fechaInicio, fechaFin, objectiveIds, objetivoNombres,
        motivo, destinoObjetivoId, destinoObjetivoNombre, onProgress,
    } = params;

    const dias = eachDayInRange(fechaInicio, fechaFin);
    let retenesLiberados = 0;
    let slotsAplicados = 0;
    let slotsOmitidos = 0;
    const ajusteIds: string[] = [];
    const errores: string[] = [];
    let serviciosConAjuste = 0;

    for (const objectiveId of objectiveIds) {
        const objectiveNombre = objetivoNombres.get(objectiveId) || objectiveId;
        const batch = writeBatch(db);
        const cambiosBanda: CambioBanda[] = [];
        const retenes: RetenAjuste[] = [];
        let opsEnObjetivo = 0;
        let retenesObjetivo = 0;
        let diasObjetivo = 0;

        for (const dia of dias) {
            if (await existsActiveAjusteOperativo(empresaId, objectiveId, dia)) {
                slotsOmitidos++;
                continue;
            }
            const turnos = await fetchTurnosObjetivoDia(objectiveId, dia);
            const base = filasFromTurnosDia(turnos);
            const prop = autoComprimir12hAutomatico(base);
            if (!prop.valido) {
                slotsOmitidos++;
                continue;
            }
            const filas = prop.filas.map(f => {
                if (f.bandaAjuste !== 'RET' || !destinoObjetivoId) return f;
                return {
                    ...f,
                    destinoObjetivoId,
                    ...(destinoObjetivoNombre ? { destinoObjetivoNombre } : {}),
                };
            });
            appendOperativoOps(batch, dia, objectiveId, empresaId, filas, cambiosBanda, retenes);
            retenesObjetivo += filas.filter(f => f.bandaAjuste === 'RET').length;
            diasObjetivo++;
            opsEnObjetivo++;
            slotsAplicados++;
        }

        if (diasObjetivo === 0) continue;

        serviciosConAjuste++;
        retenesLiberados += retenesObjetivo;
        onProgress?.(`${objectiveNombre} — ${diasObjetivo} día(s)`);

        const ajusteRef = doc(collection(db, 'ajustes_crono'));
        const ajuste: AjusteCronoInput = {
            empresaId,
            tipo: 'OPERATIVO',
            fechaInicio: Timestamp.fromDate(fechaInicio),
            fechaFin: Timestamp.fromDate(fechaFin),
            origenObjetivoId: objectiveId,
            origenObjetivoNombre: objectiveNombre,
            motivo,
            cambiosBanda,
            retenes,
            creadoPor,
            estado: 'ACTIVO',
        };
        setAjusteCronoDoc(batch, ajusteRef, ajuste, empresaId);
        ajusteIds.push(ajusteRef.id);

        try {
            await batch.commit();
        } catch (e: any) {
            errores.push(`${objectiveNombre}: ${e?.message || 'error al guardar'}`);
            retenesLiberados -= retenesObjetivo;
            slotsAplicados -= opsEnObjetivo;
            serviciosConAjuste--;
        }
    }

    return {
        retenesLiberados,
        slotsAplicados,
        slotsOmitidos,
        servicios: serviciosConAjuste,
        ajusteIds,
        errores,
    };
}

export function mapAbsenceTypeToCobertura(tipo: string): 'VACACIONES' | 'LICENCIA' | 'AUSENCIA' | 'ENFERMEDAD' {
    const t = String(tipo || '').toUpperCase();
    if (t.includes('VAC') || t === 'V') return 'VACACIONES';
    if (t.includes('ENFER') || t === 'E') return 'ENFERMEDAD';
    if (t.includes('LIC') || t === 'L') return 'LICENCIA';
    return 'AUSENCIA';
}
