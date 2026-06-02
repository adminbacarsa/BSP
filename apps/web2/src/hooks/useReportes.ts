import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import {
    belongsToEmpresa,
    belongsToEmpresaView,
    empresaScopedQuery,
    filterRowsByEmpresa,
    parsePlanificacionEstadoDocId,
    planificacionPublishLookupKey,
    shouldScopeQueriesToEmpresa,
} from '@/lib/multiempresa';
import { iterateCalendarDateRange, toCalendarDateStr } from '@/lib/planificacion/absenceCodes';

// --- CONSTANTES Y HELPERS ---
// Francos/licencias/retén: no computan horas de liquidación del empleado.
const NON_WORK_CODES = new Set(['F', 'FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'FP', 'RET']);
export const PAID_LEAVE_CODES = new Set(['V', 'L', 'PG', 'E', 'A']);
/** Vacaciones: marca el día/período, no suma horas en reportes. */
export const PERIOD_ONLY_CODES = new Set(['V']);
/** Licencias/enfermedad justificadas: computan jornada estándar (8h). */
export const PAID_DAY_LEAVE_CODES = new Set(['L', 'PG', 'E', 'A']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'AA', 'RET']);
// REF/ESC liquidan al empleado (8h) pero no son cobertura de puesto en reporte por objetivo.
const OBJECTIVE_NON_BILLABLE_CODES = new Set(['F', 'FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'FP', 'RET', 'REF', 'ESC']);
const isOperativeCode = (code: string) => !NON_WORK_CODES.has((code || '').trim().toUpperCase());
const isObjectiveBillableCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has((code || '').trim().toUpperCase());
const OPERATIVE_CODES = ['M', 'T', 'N', 'D12', 'N12', 'PU', 'GU', 'FT']; // kept for compat
const SHIFT_HOURS_LOOKUP: Record<string, number> = {
    'M':8, 'T':8, 'N':8, 'D12':12, 'N12':12, 'PU':12, 'GU':8, 'EN': 9, 'FT': 0,
    'F':0, 'V':0, 'L':8, 'PG':8, 'A':8, 'E':8, 'FF':0, 'RET': 0, 'REF': 8, 'ESC': 8,
};

const PAID_DAY_DEFAULT_HOURS = 8;

const isOperationalOriginShift = (shift: any): boolean => {
    const o = String(shift?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
    if (shift?.resolvedBy === 'OPERACIONES') return true;
    if (shift?.isReten === true) return true;
    return false;
};

const shiftHasRealCheckIn = (shift: any): boolean => {
    const st = String(shift?.status || '').toUpperCase();
    return !!(
        shift?.isPresent || shift?.isCompleted
        || shift?.checkInTime?.seconds || shift?.realStartTime?.seconds
        || st === 'COMPLETED' || st === 'PRESENT'
    );
};

/** Misma regla que operaciones: planificado sin publicar no entra a liquidación salvo fichada real u origen ops. */
export function isShiftEligibleForReports(shift: any, publishStatusMap: Record<string, boolean>): boolean {
    if (shift?.draft === true) return false;
    if (isOperationalOriginShift(shift)) return true;
    if (shift?.type === 'NOVEDAD') return true;

    const start = shift?.startTime?.toDate?.();
    const pubKey = start && shift?.objectiveId
        ? planificacionPublishLookupKey(shift.objectiveId, start.getFullYear(), start.getMonth() + 1)
        : '';
    const isPublished = pubKey ? !!publishStatusMap[pubKey] : false;

    if (shiftHasRealCheckIn(shift)) return true;

    const st = String(shift?.status || '').toUpperCase();
    if (shift?.isAbsent || st === 'ABSENT') return isPublished;

    if (!start || !shift?.objectiveId) return false;
    return isPublished;
}

export const LEAVE_REPORT_CODES = new Set(['V', 'L', 'PG', 'E', 'A', 'AA']);

export function mapAbsenceStatusLabel(status?: string | null): string {
    const s = String(status || '').trim();
    if (!s) return 'A verificar';
    if (s === 'En verificación' || s === 'Pendiente') return 'A verificar';
    if (s === 'Justificada' || s === 'Autorizada') return 'Justificada';
    if (s === 'Injustificada' || s === 'Rechazada') return 'Injustificada';
    return s;
}

/** Si hay licencia/ausencia RRHH en el día, ocultar turno M/T/N sin fichada duplicado. */
export function dedupeShiftsByAbsencePriority(shifts: any[]): any[] {
    const byDate: Record<string, any[]> = {};
    for (const s of shifts) {
        const key = s._dateKey || shiftCalendarDateKey(s);
        if (!key) { (byDate.__orphan ||= []).push(s); continue; }
        (byDate[key] ||= []).push(s);
    }
    const out: any[] = byDate.__orphan ? [...byDate.__orphan] : [];
    for (const [dateKey, dayShifts] of Object.entries(byDate)) {
        if (dateKey === '__orphan') continue;
        const hasLeave = dayShifts.some(s =>
            LEAVE_REPORT_CODES.has(String(s.code || '').toUpperCase()) || s.type === 'NOVEDAD',
        );
        for (const s of dayShifts) {
            const code = String(s.code || '').toUpperCase();
            const isWork = !NON_WORK_CODES.has(code);
            if (hasLeave && isWork && !shiftHasRealCheckIn(s)) continue;
            out.push(s);
        }
    }
    return out.sort((a, b) => (a.startTime?.seconds || 0) - (b.startTime?.seconds || 0));
}

function shiftCalendarDateKey(shift: any): string {
    const start = shift?.startTime?.toDate?.();
    if (!start) return '';
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

const REPORT_VIRTUAL_VACANCY_ORIGINS = new Set(['SLA_VIRTUAL', 'INTERRUPTION']);

export function isReportVacancyShift(shift: any, empMap: Record<string, string>): boolean {
    const eid = String(shift?.employeeId || '').trim();
    const empName = String(shift?.employeeName || '').trim().toUpperCase();
    if (!eid || eid === 'VACANTE') return true;
    if (empName === 'VACANTE' || empName.startsWith('VACANTE:')) return true;
    if (shift?.isUnassigned === true) return true;
    return !empMap[eid];
}

function objectiveReportSlotKey(shift: any): string {
    const start = shift?.startTime?.toDate?.();
    if (!start) return `id:${shift?.id || '?'}`;
    const dk = getArgentinaDate(shift.startTime);
    const pos = String(shift?.positionName || 'general').trim().toLowerCase();
    const code = String(shift?.code || '-').trim().toUpperCase();
    const startMin = start.getHours() * 60 + start.getMinutes();
    return `${dk}|${pos}|${code}|${startMin}`;
}

function registerSlaSlotCapacity(
    caps: Record<string, number>,
    objectiveId: string,
    sla: { positions?: unknown },
) {
    if (!objectiveId || !sla?.positions) return;
    const positions = Array.isArray(sla.positions)
        ? sla.positions
        : Object.values(sla.positions as Record<string, unknown>);
    for (const raw of positions) {
        const pos = raw as { name?: string; positionName?: string; quantity?: number; qty?: number; allowedShiftTypes?: unknown[]; shifts?: unknown[] };
        const posName = String(pos.name || pos.positionName || 'general').trim().toLowerCase();
        const qty = Math.max(1, Number(pos.quantity ?? pos.qty) || 1);
        const slots = pos.allowedShiftTypes ?? pos.shifts ?? [];
        if (!Array.isArray(slots) || slots.length === 0) continue;
        for (const slot of slots) {
            const s = slot as { code?: string };
            const code = String(s.code || '').trim().toUpperCase();
            if (!code) continue;
            const key = `${objectiveId}|${posName}|${code}`;
            caps[key] = Math.max(caps[key] || 0, qty);
        }
    }
}

/** Quita placeholders virtuales y vacantes huérfanas cuando el slot ya está cubierto. */
export function filterObjectiveReportShifts(
    shifts: any[],
    empMap: Record<string, string>,
    slaSlotCapacity: Record<string, number>,
    objectiveId: string,
): any[] {
    const withoutVirtual = shifts.filter(s =>
        !REPORT_VIRTUAL_VACANCY_ORIGINS.has(String(s?.origin || '').trim().toUpperCase()),
    );

    const bySlot = new Map<string, { staffed: any[]; vacant: any[] }>();
    for (const s of withoutVirtual) {
        const key = objectiveReportSlotKey(s);
        const bucket = bySlot.get(key) || { staffed: [], vacant: [] };
        if (isReportVacancyShift(s, empMap)) bucket.vacant.push(s);
        else bucket.staffed.push(s);
        bySlot.set(key, bucket);
    }

    const keepIds = new Set<string>();
    for (const [slotKey, bucket] of bySlot.entries()) {
        for (const s of bucket.staffed) keepIds.add(s.id);

        const parts = slotKey.split('|');
        const pos = parts[1] || 'general';
        const code = parts[2] || '-';
        const capKey = `${objectiveId}|${pos}|${code}`;
        const required = slaSlotCapacity[capKey] || 0;
        const maxVacant = required > 0
            ? Math.max(0, required - bucket.staffed.length)
            : (bucket.staffed.length > 0 ? 0 : bucket.vacant.length);

        bucket.vacant.slice(0, maxVacant).forEach(s => keepIds.add(s.id));
    }

    return withoutVirtual.filter(s => keepIds.has(s.id));
}

/** Horas a mostrar/liquidar: V = período (0h); E/L/PG/A = jornada estándar; ignora rango 00:00–23:59 de RRHH. */
export function resolveShiftDurationHours(
    shift: {
        code?: string;
        hours?: number;
        startTime?: { seconds?: number; _seconds?: number };
        endTime?: { seconds?: number; _seconds?: number };
        isAbsent?: boolean;
        status?: string;
    },
    lookup: Record<string, number> = SHIFT_HOURS_LOOKUP,
    opts?: { unjustifiedAbsent?: boolean; forObjectiveBilling?: boolean },
): number {
    const rawCode = (shift.code || '').trim().toUpperCase();
    const isUnjustAbsent = opts?.unjustifiedAbsent ?? (
        !PAID_LEAVE_CODES.has(rawCode) && (shift.isAbsent === true || (shift.status || '').toUpperCase() === 'ABSENT')
    );

    if (opts?.forObjectiveBilling && !isObjectiveBillableCode(rawCode)) return 0;
    if (ZERO_HOUR_CODES.has(rawCode) || PERIOD_ONLY_CODES.has(rawCode) || isUnjustAbsent) return 0;

    if (PAID_DAY_LEAVE_CODES.has(rawCode)) {
        if (typeof shift.hours === 'number' && shift.hours > 0) return shift.hours;
        const fromLookup = lookup[rawCode];
        return fromLookup && fromLookup > 0 ? fromLookup : PAID_DAY_DEFAULT_HOURS;
    }

    const startSec = shift.startTime?.seconds ?? shift.startTime?._seconds ?? 0;
    const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
    if (!startSec || !endSec) return lookup[rawCode] || PAID_DAY_DEFAULT_HOURS;

    let duration = Math.max(0, (endSec - startSec) / 3600);
    if (duration === 0 || duration >= 23.5 || duration > 24 || isNaN(duration)) {
        duration = lookup[rawCode] || PAID_DAY_DEFAULT_HOURS;
    }
    return duration;
}

// Helper seguro para fechas (Formato local Argentina)
const getArgentinaDate = (dateInput: any): string => {
    if (!dateInput) return '';
    try {
        const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return ''; 
    }
};

// Cálculo de horas nocturnas (21:00 a 06:00)
const getNightDuration = (start: Date, end: Date) => {
    let durationMins = 0;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

    let current = new Date(start.getTime());
    const endTime = end.getTime();
    
    // Seguridad anti-loop (max 24hs)
    let safety = 0;
    while (current.getTime() < endTime && safety < 1440) {
        const h = current.getHours();
        if (h >= 21 || h < 6) durationMins++;
        current.setMinutes(current.getMinutes() + 1);
        safety++;
    }
    return durationMins / 60;
};

// Calculadora CCT 507/07
const calculateStatsExact = (shifts: any[], holidaysMap: Record<string, boolean>) => {
    const validShifts = shifts.filter(s => s.startTime && s.endTime && s.startTime.seconds && s.endTime.seconds);
    const sortedDocs = [...validShifts].sort((a, b) => a.startTime.seconds - b.startTime.seconds);

    let hoursTotalOperativas = 0; // teóricas
    let totalDiurnas = 0;
    let totalNocturnas = 0;
    let hoursFT = 0;
    let hoursFeriado = 0;
    let horasRealesTotal = 0;   // reales (realStartTime/realEndTime)
    let turnosConDatosReales = 0;

    sortedDocs.forEach(d => {
        try {
            const st = (d.status || '').toLowerCase();
            if (st.includes('cancel') || st.includes('delet')) return;
            if (d.type === 'NOVEDAD') return;

            const rawCode = (d.code || '').trim().toUpperCase();
            if (['F', 'FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'RET'].includes(rawCode)) return;

            const start = d.startTime.toDate();
            const end = d.endTime.toDate();

            let duration = (end.getTime() - start.getTime()) / 3600000;
            if (duration < 0 || duration > 24 || isNaN(duration)) {
                duration = SHIFT_HOURS_LOOKUP[rawCode] || 8;
            }

            const night = getNightDuration(start, end);
            const day = Math.max(0, duration - night);
            const dateKey = getArgentinaDate(d.startTime);
            const isFeriado = holidaysMap[dateKey];
            const isFT = d.isFrancoTrabajado || rawCode === 'FT';

            if (isFeriado) hoursFeriado += duration;
            if (isFT) { hoursFT += duration; totalNocturnas += night; totalDiurnas += day; }
            else { hoursTotalOperativas += duration; totalNocturnas += night; totalDiurnas += day; }

            // Horas reales: solo turnos ya finalizados con fichada real (sin fallback a teórico)
            const isAbsent = d.isAbsent === true || st.includes('absent') || st.includes('ausent');
            if (isAbsent || end > new Date()) return;

            const clampS = (real: Date, plan: Date, tol = 5): Date =>
                (real.getTime() - plan.getTime()) / 60000 <= tol ? plan : real;
            const clampE = (real: Date, plan: Date, tol = 5): Date =>
                Math.abs((real.getTime() - plan.getTime()) / 60000) <= tol ? plan : real;

            const rStartRaw = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1000)
                            : d.checkInTime?.seconds   ? new Date(d.checkInTime.seconds * 1000)
                            : null;
            const rEndRaw   = d.realEndTime?.seconds   ? new Date(d.realEndTime.seconds * 1000)
                            : d.checkOutTime?.seconds  ? new Date(d.checkOutTime.seconds * 1000)
                            : null;

            const rStart = rStartRaw ? clampS(rStartRaw, start, 5) : null;
            const rEnd   = rEndRaw   ? clampE(rEndRaw,   end,   5) : null;
            if (rStart && rEnd) {
                const rDur = (rEnd.getTime() - rStart.getTime()) / 3600000;
                if (rDur >= 0 && rDur <= 36) {
                    horasRealesTotal += rDur;
                    turnosConDatosReales++;
                }
                // rDur fuera de rango (dato corrupto) → no sumar
            }
            // sin fichada → 0 reales (no fallback a teórico)
        } catch (err) {
            console.warn("Saltando turno corrupto:", d.id);
        }
    });

    const baseLimit = 200;
    const excess = Math.max(0, hoursTotalOperativas - baseLimit);
    const horasSimples = Math.min(hoursTotalOperativas, baseLimit);
    const horasTeoricas = hoursTotalOperativas + hoursFT;

    return {
        totalReal: horasTeoricas,        // nombre legacy, mantener por compat
        horasTeoricas,
        horasReales: horasRealesTotal,
        turnosConDatosReales,
        horasSimples,
        totalDiurnas,
        totalNocturnas,
        extra50: excess,
        extra100: hoursFT,
        plusFeriado: hoursFeriado,
        horasExtra: Math.max(0, horasRealesTotal - horasTeoricas),
    };
};

type ObjectiveMeta = {
    canonicalId: string;
    name: string;
    clientId: string;
    client: string;
};

function registerObjectiveAlias(
    aliases: Record<string, ObjectiveMeta>,
    meta: ObjectiveMeta,
    alias: string,
) {
    const key = String(alias || '').trim();
    if (!key) return;
    aliases[key] = meta;
}

/** Misma convención que Servicios: clientId + nombre cuando falta objectiveId. */
function fallbackObjectiveKey(clientId: string, objectiveName: string): string {
    return `${clientId}_${objectiveName}`;
}

function objectiveMatchCandidates(row: {
    objectiveId?: unknown;
    objectiveName?: unknown;
    clientId?: unknown;
}): string[] {
    const cid = String(row.clientId ?? '').trim();
    const oid = String(row.objectiveId ?? '').trim();
    const name = String(row.objectiveName ?? '').trim();
    const keys: string[] = [];
    if (oid) keys.push(oid);
    if (name) keys.push(name);
    if (cid && name) keys.push(fallbackObjectiveKey(cid, name));
    return keys;
}

function resolveCanonicalObjectiveId(
    row: { objectiveId?: unknown; objectiveName?: unknown; clientId?: unknown },
    aliases: Record<string, ObjectiveMeta>,
): string | null {
    for (const key of objectiveMatchCandidates(row)) {
        if (aliases[key]) return aliases[key].canonicalId;
    }
    const oid = String(row.objectiveId ?? '').trim();
    if (oid) return oid;
    const cid = String(row.clientId ?? '').trim();
    const name = String(row.objectiveName ?? '').trim();
    if (cid && name) return fallbackObjectiveKey(cid, name);
    if (name) return name;
    return null;
}

function registerObjectiveMetaAliases(
    aliases: Record<string, ObjectiveMeta>,
    meta: ObjectiveMeta,
    extraKeys: string[] = [],
) {
    registerObjectiveAlias(aliases, meta, meta.canonicalId);
    for (const key of extraKeys) registerObjectiveAlias(aliases, meta, key);
}

function slaOverlapsRange(sla: { startDate?: string; endDate?: string }, startDate: Date, endDate: Date): boolean {
    const sd = String(sla.startDate ?? '').trim().slice(0, 10);
    const ed = String(sla.endDate ?? '').trim().slice(0, 10);
    if (!sd || !ed) return false;
    const pad = (n: number) => String(n).padStart(2, '0');
    const rangeStart = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
    const rangeEnd = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`;
    return sd <= rangeEnd && ed >= rangeStart;
}

function resolveClientIdFromName(clientName: string, clientMap: Record<string, string>): string {
    const cn = String(clientName || '').trim().toLowerCase();
    if (!cn) return '';
    const exact = Object.entries(clientMap).find(([, n]) => String(n).trim().toLowerCase() === cn);
    if (exact) return exact[0];
    const partial = Object.entries(clientMap).find(([, n]) => {
        const nn = String(n).trim().toLowerCase();
        return nn.includes(cn) || cn.includes(nn);
    });
    return partial?.[0] || '';
}

export const useReportes = (forcedClientId?: string | null) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = (empresa as any)?.migracionCompleta === true;
    const scopeEmpresa = useMemo(
        () => shouldScopeQueriesToEmpresa(empresaId, migracionCompleta),
        [empresaId, migracionCompleta],
    );
    const [loading, setLoading] = useState(false);

    // Inicializamos fechas locales
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    const [dateRange, setDateRange] = useState({ start: todayStr, end: todayStr });
    
    const [employeeReport, setEmployeeReport] = useState<any[]>([]);
    const [objectiveReport, setObjectiveReport] = useState<any[]>([]);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    
    const [empMap, setEmpMap] = useState<Record<string, string>>({});
    const [objMap, setObjMap] = useState<Record<string, string>>({});
    const [objectiveAliases, setObjectiveAliases] = useState<Record<string, ObjectiveMeta>>({});
    const [clientMap, setClientMap] = useState<Record<string, string>>({});
    const [holidaysData, setHolidaysData] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!empresaId) return;
        const loadCatalogs = async () => {
            try {
                const [s, c, h] = await Promise.all([ 
                    getDocs(empresaScopedQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>),
                    getDocs(empresaScopedQuery('clients', empresaId, scopeEmpresa) as ReturnType<typeof query>),
                    getDocs(collection(db, 'feriados'))
                ]);
                
                const emps: any = {};
                s.forEach(d => {
                    const data = d.data();
                    emps[d.id] = data.name || (data.firstName ? `${data.lastName}, ${data.firstName}` : 'Sin Nombre');
                });
                setEmpMap(emps);
                
                const objs: any = {};
                const clis: any = {};
                const aliases: Record<string, ObjectiveMeta> = {};
                c.forEach(doc => {
                    const data = doc.data();
                    const clientName = data.name || doc.id;
                    clis[doc.id] = clientName;
                    if (data.objetivos) {
                        data.objetivos.forEach((obj: any) => {
                            const canonicalId = String(obj.id || obj.name || '').trim();
                            if (!canonicalId) return;
                            const displayName = String(obj.name || canonicalId);
                            objs[canonicalId] = displayName;
                            if (obj.name && obj.name !== canonicalId) objs[obj.name] = displayName;
                            const meta: ObjectiveMeta = {
                                canonicalId,
                                name: displayName,
                                clientId: doc.id,
                                client: clientName,
                            };
                            registerObjectiveAlias(aliases, meta, canonicalId);
                            if (obj.id) registerObjectiveAlias(aliases, meta, obj.id);
                            if (obj.name) registerObjectiveAlias(aliases, meta, obj.name);
                            registerObjectiveAlias(aliases, meta, fallbackObjectiveKey(doc.id, displayName));
                        });
                    }
                });
                setObjMap(objs);
                setObjectiveAliases(aliases);
                setClientMap(clis);

                const holidays: any = {};
                h.docs.forEach(d => {
                    const data = d.data();
                    const emp = String(data.empresaId ?? '').trim();
                    if (emp && emp !== empresaId) return;
                    if (data.date) holidays[data.date] = true;
                });
                setHolidaysData(holidays);

            } catch (e) { console.error("Error cargando catálogos:", e); }
        };
        loadCatalogs();
    }, [empresaId, scopeEmpresa]);

    const generateReports = async () => {
        if (!dateRange.start || !dateRange.end) return toast.error("Seleccione un rango de fechas");
        setLoading(true);
        setEmployeeReport([]);
        setObjectiveReport([]);

        try {
            // FIX CRÍTICO DE FECHAS: Usar formato ISO Local
            const startDate = new Date(`${dateRange.start}T00:00:00`);
            const endDate = new Date(`${dateRange.end}T23:59:59.999`);

            if (startDate > endDate) {
                toast.error("La fecha 'Desde' no puede ser mayor a 'Hasta'");
                setLoading(false);
                return;
            }

            // Cargar contratos de servicio para cruzar Hs. Vendidas por objetivo
            const slaSnap = await getDocs(empresaScopedQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>);
            const slaMap: Record<string, number> = {};
            const slaSlotCapacity: Record<string, number> = {};
            const slaObjectiveMetas = new Map<string, ObjectiveMeta>();
            const aliasLookup: Record<string, ObjectiveMeta> = { ...objectiveAliases };

            slaSnap.docs.forEach(d => {
                const sla = d.data();
                if (scopeEmpresa && !belongsToEmpresa(sla, empresaId, scopeEmpresa, migracionCompleta)) return;
                if (!slaOverlapsRange(sla, startDate, endDate)) return;

                const objName = String(sla.objectiveName ?? '').trim();
                let cid = String(sla.clientId || '').trim();
                if (!cid && sla.clientName) cid = resolveClientIdFromName(String(sla.clientName), clientMap);
                const matchKeys = objectiveMatchCandidates(sla);

                let canonicalId: string | null = null;
                for (const key of matchKeys) {
                    if (aliasLookup[key]) {
                        canonicalId = aliasLookup[key].canonicalId;
                        break;
                    }
                }
                if (!canonicalId) {
                    canonicalId = resolveCanonicalObjectiveId(sla, aliasLookup);
                }
                if (!canonicalId) canonicalId = d.id;

                const fromCatalog = aliasLookup[canonicalId];
                if (!cid && fromCatalog?.clientId) cid = fromCatalog.clientId;
                if (forcedClientId && cid && cid !== forcedClientId) return;

                const meta: ObjectiveMeta = fromCatalog ?? {
                    canonicalId,
                    name: objName || objMap[canonicalId] || canonicalId,
                    clientId: cid,
                    client: clientMap[cid] || String(sla.clientName || 'Sin Cliente'),
                };
                if (cid && !meta.clientId) meta.clientId = cid;
                if (objName && meta.name === canonicalId) meta.name = objName;
                if (cid && clientMap[cid]) meta.client = clientMap[cid];
                else if (sla.clientName) meta.client = String(sla.clientName);
                if (!meta.clientId && meta.client && meta.client !== 'Sin Cliente') {
                    meta.clientId = resolveClientIdFromName(meta.client, clientMap)
                        || `nm:${meta.client.toLowerCase().replace(/\s+/g, '_').slice(0, 48)}`;
                }

                slaObjectiveMetas.set(canonicalId, meta);
                slaMap[canonicalId] = Math.max(slaMap[canonicalId] || 0, sla.totalMonthlyHours || 0);
                registerSlaSlotCapacity(slaSlotCapacity, canonicalId, sla);
                registerObjectiveMetaAliases(aliasLookup, meta, [...matchKeys, d.id]);
            });

            // Consulta SIN indices complejos (filtrado en memoria si es necesario, o básico por fecha)
            const q = scopeEmpresa
                ? query(
                    collection(db, 'turnos'),
                    where('empresaId', '==', empresaId),
                    where('startTime', '>=', Timestamp.fromDate(startDate)),
                    where('startTime', '<=', Timestamp.fromDate(endDate)),
                  )
                : query(
                    collection(db, 'turnos'),
                    where('startTime', '>=', Timestamp.fromDate(startDate)),
                    where('startTime', '<=', Timestamp.fromDate(endDate)),
                  );

            const planifSnap = await getDocs(
                empresaScopedQuery('planificacion_estados', empresaId, scopeEmpresa) as ReturnType<typeof query>,
            );
            const publishStatusMap: Record<string, boolean> = {};
            planifSnap.docs.forEach(d => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                const parsed = parsePlanificacionEstadoDocId(d.id);
                if (parsed) {
                    publishStatusMap[planificacionPublishLookupKey(parsed.objectiveId, parsed.year, parsed.month)] = true;
                }
                publishStatusMap[d.id] = true;
            });

            const shiftsSnap = await getDocs(q);
            
            const rawShifts = shiftsSnap.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter((d: any) => {
                    if (!d.startTime || !d.endTime || typeof d.startTime.toDate !== 'function') return false;
                    if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return false;
                    if (forcedClientId && d.clientId !== forcedClientId) return false;
                    return isShiftEligibleForReports(d, publishStatusMap);
                });

            const ausSnap = await getDocs(
                empresaScopedQuery('ausencias', empresaId, scopeEmpresa) as ReturnType<typeof query>,
            );
            const absenceById: Record<string, any> = {};
            const absenceByEmpDate: Record<string, any> = {};
            ausSnap.docs.forEach(d => {
                const data = d.data();
                if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
                const absDoc = { id: d.id, ...data };
                absenceById[d.id] = absDoc;
                const startStr = toCalendarDateStr(data.startDate);
                const endStr = toCalendarDateStr(data.endDate || data.startDate);
                if (!startStr || !endStr) return;
                for (const dateStr of iterateCalendarDateRange(startStr, endStr)) {
                    if (dateStr < dateRange.start || dateStr > dateRange.end) continue;
                    absenceByEmpDate[`${data.employeeId}_${dateStr}`] = absDoc;
                }
            });

            const coverageByEmpDate: Record<string, string> = {};
            rawShifts.forEach((s: any) => {
                const comments = String(s.comments || '');
                const m = comments.match(/Cubriendo a (.+?) \(/);
                if (!m) return;
                const titularName = m[1].trim();
                const titularId = Object.keys(empMap).find(id => empMap[id] === titularName);
                if (!titularId) return;
                const dk = shiftCalendarDateKey(s);
                if (dk) coverageByEmpDate[`${titularId}_${dk}`] = s.employeeName || empMap[s.employeeId] || '—';
            });

            const enrichShift = (s: any) => {
                const dk = shiftCalendarDateKey(s);
                const abs = s.absenceId ? absenceById[s.absenceId] : (dk ? absenceByEmpDate[`${s.employeeId}_${dk}`] : null);
                return {
                    ...s,
                    _dateKey: dk,
                    _absenceType: abs?.type || null,
                    _absenceStatus: abs?.status || null,
                    _absenceReason: abs?.reason || null,
                    _coveredBy: s.coveredBy || (dk ? coverageByEmpDate[`${s.employeeId}_${dk}`] : null) || null,
                };
            };

            if (rawShifts.length === 0) {
                toast.info("No se encontraron turnos válidos en este rango.");
            }

            // 3. Procesamiento por Empleado (excluir vacantes/desconocidos)
            const empGroups: any = {};
            rawShifts.forEach((s: any) => {
                if (!s.employeeId || !empMap[s.employeeId]) return;
                if(!empGroups[s.employeeId]) empGroups[s.employeeId] = [];
                empGroups[s.employeeId].push(enrichShift(s));
            });

            const empRows = Object.keys(empGroups).map(empId => {
                const shifts = dedupeShiftsByAbsencePriority(empGroups[empId]);
                const stats = calculateStatsExact(shifts, holidaysData);

                const ftCount = shifts.filter((s:any) => s.isFrancoTrabajado || s.code === 'FT').length;
                const ffCount = shifts.filter((s:any) => s.isFrancoCompensatorio || s.code === 'FF').length;

                return {
                    id: empId,
                    type: 'EMPLOYEE',
                    name: empMap[empId] || 'Desconocido',
                    shifts: shifts.filter((s:any) => isOperativeCode(s.code)).length,
                    total: stats.horasTeoricas,
                    horasTeoricas: stats.horasTeoricas,
                    horasReales: stats.horasReales,
                    horasExtra: stats.horasExtra,
                    turnosConDatosReales: stats.turnosConDatosReales,
                    diurnas: stats.totalDiurnas,
                    nocturnas: stats.totalNocturnas,
                    extra50: stats.extra50,
                    extra100: stats.extra100,
                    plusFeriado: stats.plusFeriado,
                    ftCount,
                    ffCount,
                    rawShifts: shifts
                };
            });

            // Ajustes de horas manuales — sumar/restar del total teórico del empleado
            const ajustesSnap = await getDocs(
                query(collection(db, 'ajustes_horas'), where('empresaId', '==', empresaId))
            );
            const ajustesByEmp: Record<string, number> = {};
            ajustesSnap.docs.forEach(d => {
                const data = d.data();
                if (data.tipo !== 'AJUSTE_HORAS') return;
                const fechaDate = data.fecha?.toDate ? data.fecha.toDate() : null;
                if (!fechaDate || fechaDate < startDate || fechaDate > endDate) return;
                ajustesByEmp[data.employeeId] = (ajustesByEmp[data.employeeId] || 0) + (data.horas || 0);
            });
            const finalEmpRows = empRows.map(row => {
                const adj = ajustesByEmp[row.id] || 0;
                if (adj === 0) return row;
                return { ...row, total: row.total + adj, horasTeoricas: row.horasTeoricas + adj };
            });

            setEmployeeReport(finalEmpRows.sort((a,b) => b.total - a.total));

            // 4. Procesamiento por Objetivo
            const objGroups: Record<string, { shifts: any[]; clientId?: string }> = {};
            rawShifts.forEach((s: any) => {
                if (s.type === 'NOVEDAD' || !isObjectiveBillableCode(s.code)) return;

                const objId = resolveCanonicalObjectiveId(s, aliasLookup);
                if (!objId) return;

                if (!objGroups[objId]) objGroups[objId] = { shifts: [], clientId: s.clientId };
                objGroups[objId].shifts.push(s);
                if (s.clientId) objGroups[objId].clientId = s.clientId;
            });

            for (const objId of Object.keys(objGroups)) {
                objGroups[objId].shifts = filterObjectiveReportShifts(
                    objGroups[objId].shifts,
                    empMap,
                    slaSlotCapacity,
                    objId,
                );
            }

            const allObjectiveIds = new Set<string>([
                ...slaObjectiveMetas.keys(),
                ...Object.keys(objGroups),
            ]);

            const objRows = [...allObjectiveIds].map(objId => {
                const meta = slaObjectiveMetas.get(objId)
                    || aliasLookup[objId]
                    || {
                        canonicalId: objId,
                        name: objMap[objId] || objId,
                        clientId: String(objGroups[objId]?.clientId || ''),
                        client: clientMap[String(objGroups[objId]?.clientId || '')] || 'Sin Cliente',
                    };

                if (!meta.clientId && objGroups[objId]?.clientId) {
                    meta.clientId = String(objGroups[objId].clientId);
                    meta.client = clientMap[meta.clientId] || meta.client;
                }
                if (!meta.clientId && meta.client && meta.client !== 'Sin Cliente') {
                    meta.clientId = resolveClientIdFromName(meta.client, clientMap)
                        || `nm:${meta.client.toLowerCase().replace(/\s+/g, '_').slice(0, 48)}`;
                }
                if (forcedClientId && meta.clientId && meta.clientId !== forcedClientId && !meta.clientId.startsWith('nm:')) return null;
                if (!meta.client || meta.client === 'Sin Cliente') return null;

                const data = objGroups[objId] || { shifts: [], clientId: meta.clientId };
                const staffedShifts = data.shifts.filter((s: any) => !isReportVacancyShift(s, empMap));
                const vacantRawShifts = data.shifts.filter((s: any) => isReportVacancyShift(s, empMap));
                const vacantHours = vacantRawShifts.reduce((acc: number, s: any) =>
                    acc + resolveShiftDurationHours(s, SHIFT_HOURS_LOOKUP, { forObjectiveBilling: true }), 0);
                const stats = calculateStatsExact(
                    staffedShifts.filter((s: any) => isObjectiveBillableCode(s.code)),
                    holidaysData,
                );
                const annotatedShifts = data.shifts.map((s: any) => ({
                    ...s,
                    employeeName: empMap[s.employeeId] || null
                }));
                return {
                    id: objId,
                    type: 'OBJECTIVE',
                    name: meta.name,
                    clientId: meta.clientId,
                    client: meta.client || clientMap[meta.clientId] || 'Sin Cliente',
                    shifts: staffedShifts.length,
                    vacantShifts: vacantRawShifts.length,
                    vacantHours,
                    vendidas: slaMap[objId] || 0,
                    total: stats.totalReal,
                    diurnas: stats.totalDiurnas,
                    nocturnas: stats.totalNocturnas,
                    extra50: stats.extra50,
                    extra100: stats.extra100,
                    plusFeriado: stats.plusFeriado,
                    rawShifts: annotatedShifts
                };
            }).filter((row): row is NonNullable<typeof row> => row !== null);
            setObjectiveReport(objRows.sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name)));

        } catch (error: any) {
            console.error("Error generando reporte:", error);
            if(error.message?.includes("index")) {
                toast.error("Falta índice en Firebase. Revisa la consola.");
            } else {
                toast.error("Error al procesar datos.");
            }
        } finally {
            setLoading(false);
        }
    };

    const loadAudit = async () => {
        setLoading(true);
        try {
            const startDate = new Date(`${dateRange.start}T00:00:00`);
            const endDate = new Date(`${dateRange.end}T23:59:59.999`);

            const q = query(
                collection(db, 'audit_logs'), 
                where('timestamp', '>=', Timestamp.fromDate(startDate)), 
                where('timestamp', '<=', Timestamp.fromDate(endDate))
            );
            
            const snap = await getDocs(q);
            const logs = filterRowsByEmpresa(
                snap.docs.map(d => ({ id: d.id, ...d.data() })),
                empresaId,
                scopeEmpresa,
                migracionCompleta,
            );
            
            setAuditLogs(logs.sort((a:any, b:any) => b.timestamp.seconds - a.timestamp.seconds));
            
        } catch(e) { console.error(e); } finally { setLoading(false); }
    };

    return {
        loading,
        dateRange, setDateRange,
        generateReports,
        loadAudit,
        employeeReport,
        objectiveReport,
        auditLogs,
        objMap,
        empMap,
        holidaysData,
        SHIFT_HOURS_LOOKUP,
        OPERATIVE_CODES
    };
};