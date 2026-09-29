import {
  deploymentShiftHours,
  isDeploymentOrPoolShift,
  isRegularLiquidationWorkShift,
} from '../planning/deploymentRoles';
import { RET_STANDBY_REFERENCE_HOURS } from '../planning/constants';
import { calcPlanningBillableShiftHours } from '../planning/planningScheduledHours';
import {
  coalescePlannedCellBillableHours,
  coalescePlannedTurnosForCell,
} from '../planning/planningTurnoCoalesce';
import { isEmployeeOnLeave, RRHH_ABSENCE_TYPES } from '../planning/leaveCoverage';
import { arMinutesOfDay, arYearMonth, arYmd, withArClock } from '../../time/ar';

function planificacionPublishLookupKey(objectiveId: string, year: number, month: number): string {
  return `${String(objectiveId ?? '').trim()}_${year}_${month}`;
}

// --- CONSTANTES Y HELPERS ---
// Francos/licencias/retÃ©n: no computan horas de liquidaciÃ³n del empleado.
const NON_WORK_CODES = new Set(['F', 'FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'FP', 'RET']);
export const PAID_LEAVE_CODES = new Set(['V', 'L', 'PG', 'E', 'A']);
/** Vacaciones: marca el dÃ­a/perÃ­odo, no suma horas en reportes. */
export const PERIOD_ONLY_CODES = new Set(['V']);
/** Licencias/enfermedad justificadas: computan jornada estÃ¡ndar (8h). */
export const PAID_DAY_LEAVE_CODES = new Set(['L', 'PG', 'E', 'A']);
const ZERO_HOUR_CODES = new Set(['F', 'FF', 'FP', 'AA']);
// REF/ESC liquidan al empleado (8h) pero no son cobertura de puesto en reporte por objetivo.
const OBJECTIVE_NON_BILLABLE_CODES = new Set(['F', 'FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'FP', 'RET', 'REF', 'ESC', 'EV']);
const isOperativeCode = (code: string) => !NON_WORK_CODES.has((code || '').trim().toUpperCase());
const isObjectiveBillableCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has((code || '').trim().toUpperCase());

/** Titular con licencia RRHH: no suma horas al objetivo aunque el turno guarde M/T/N. */
export function shouldBillShiftToObjective(shift: any): boolean {
    const code = String(shift?.code || '').trim().toUpperCase();
    if (!isObjectiveBillableCode(code)) return false;
    if (isEmployeeOnLeave({ shiftCode: code, absenceType: shift?._absenceType, absence: shift?._absenceType ? { type: shift._absenceType } : null })) {
        return false;
    }
    if (shift?._absenceType && RRHH_ABSENCE_TYPES.has(String(shift._absenceType).trim()) && !shiftHasRealCheckIn(shift)) {
        return false;
    }
    return true;
}
const OPERATIVE_CODES = ['M', 'T', 'N', 'D12', 'N12', 'PU', 'GU', 'FT']; // kept for compat
const SHIFT_HOURS_LOOKUP: Record<string, number> = {
    'M':8, 'T':8, 'N':8, 'D12':12, 'N12':12, 'PU':12, 'GU':8, 'EN': 9, 'FT': 0,
    'F':0, 'V':0, 'L':8, 'PG':8, 'A':8, 'E':8, 'FF':0, 'RET': 0, 'REF': 8, 'RFZ': 8, 'TURA': 8, 'ESC': 8,
};

const PAID_DAY_DEFAULT_HOURS = 8;

function parseShiftInstant(val: unknown): Date | null {
    if (!val) return null;
    if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
        const d = (val as { toDate: () => Date }).toDate();
        return isNaN(d.getTime()) ? null : d;
    }
    const sec = (val as { seconds?: number; _seconds?: number }).seconds
        ?? (val as { _seconds?: number })._seconds;
    if (typeof sec === 'number' && sec > 0) return new Date(sec * 1000);
    if (typeof val === 'string') {
        const raw = val.trim();
        if (/^\d{1,2}:\d{2}$/.test(raw)) return null;
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

const isOperationalOriginShift = (shift: any): boolean => {
    const o = String(shift?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL' || o === 'CLIENT_REQUEST') return true;
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

/** Franco planificado (dÃ­a libre), aÃºn sin marcar FT en Firestore. */
function isPlainFrancoDayOff(s: any): boolean {
    const code = String(s?.code || '').trim().toUpperCase();
    if (code === 'F' || code === 'FP') return true;
    return s?.isFranco === true && code !== 'FT' && !s?.isFrancoTrabajado;
}

function isLiquidationWorkCandidate(s: any): boolean {
    const code = String(s?.code || '').trim().toUpperCase();
    if (['F', 'FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'FP'].includes(code)) return false;
    if (isLeaveReportShift(s)) return false;
    return true;
}

function isCoverageWorkShift(s: any): boolean {
    return !!(
        s?._coveringFor
        || s?.absenceShiftId
        || s?.francoObjectiveId
        || s?.francoObjectiveName
        || s?.type === 'EXTRA_FRANCO'
        || isOperationalOriginShift(s)
    );
}

/** Convocado desde operaciones/planificaciÃ³n: franco que cubre vacante/ausencia â†’ pago al 100% (FT). */
export function isFrancoTrabajadoShift(shift: any): boolean {
    if (shift?.isFrancoTrabajado === true) return true;
    if (shift?._inferredFrancoTrabajado === true) return true;
    const code = String(shift?.code || '').trim().toUpperCase();
    if (code === 'FT') return true;
    if (shift?.type === 'EXTRA_FRANCO') return true;
    if (String(shift?.coverageType || '').toUpperCase() === 'FRANCO') return true;
    if (shift?.francoObjectiveId) return true;
    return false;
}

/**
 * Operaciones marca isFrancoTrabajado en el doc F; la fichada puede quedar en el turno de cobertura del mismo dÃ­a.
 * Si el flag no llegÃ³ a Firestore, infiere FT cuando hay F + turno con fichada el mismo dÃ­a.
 */
export function propagateFrancoTrabajadoFlags(shifts: any[], opts?: { usePlannedHours?: boolean }): any[] {
    const usePlanned = opts?.usePlannedHours ?? false;
    const byDay = new Map<string, any[]>();
    for (const s of shifts) {
        const dk = shiftCalendarDateKey(s);
        if (!dk) continue;
        (byDay.get(dk) ?? (byDay.set(dk, []), byDay.get(dk)!)).push(s);
    }

    const propagateIds = new Set<string>();
    for (const dayShifts of byDay.values()) {
        const plainFrancoRest = dayShifts.some((s) => isPlainFrancoDayOff(s) && !shiftHasRealCheckIn(s));
        const ftMarkedOnFrancoDoc = dayShifts.some((s) => {
            const code = String(s.code || '').toUpperCase();
            return isFrancoTrabajadoShift(s) && code === 'F' && !shiftHasRealCheckIn(s);
        });

        if (!plainFrancoRest && !ftMarkedOnFrancoDoc) continue;

        const workCandidates = dayShifts.filter(
            (s) => isLiquidationWorkCandidate(s)
                && (usePlanned || shiftHasRealCheckIn(s))
                && !isFrancoTrabajadoShift(s),
        );
        if (workCandidates.length === 0) continue;

        const coverageWork = workCandidates.filter(isCoverageWorkShift);
        const toMark = coverageWork.length > 0
            ? coverageWork
            : (workCandidates.length === 1 ? workCandidates : []);

        for (const s of toMark) propagateIds.add(s.id);
    }

    if (propagateIds.size === 0) return shifts;
    return shifts.map((s) => (
        propagateIds.has(s.id)
            ? { ...s, isFrancoTrabajado: true, _inferredFrancoTrabajado: true, code: s.code || 'FT' }
            : s
    ));
}

/** Mismo tope que `shiftClose.ts` (12:59) — relevo tolerado, nunca una jornada de 13h ni 24h. */
const FT_FULL_DAY_HARD_CAP_HOURS = 12 + 59 / 60;

/**
 * Decisión Mauro H1 #4: FT de día completo (placeholder 00:00–23:59) nunca liquida 24 h. Usa la
 * ventana de cobertura explícita (`shift.hours`, seteada por Ops al asignar la cobertura) o, si no
 * hay, la fichada real (`realStartTime`/`realEndTime` o `checkInTime`/`checkOutTime`) con tope 12:59.
 */
function resolveFtLiquidationHours(shift: any, fallback = 8): number {
    const startSec = shift.startTime?.seconds ?? shift.startTime?._seconds ?? 0;
    const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
    const rawSpanH = startSec && endSec ? Math.max(0, (endSec - startSec) / 3600) : 0;
    if (rawSpanH > 0 && rawSpanH < 23.5) return rawSpanH;

    const explicitHours = Number(shift.hours);
    if (Number.isFinite(explicitHours) && explicitHours > 0 && explicitHours < 23.5) {
        return Math.min(explicitHours, FT_FULL_DAY_HARD_CAP_HOURS);
    }

    const rStart = shift.realStartTime?.seconds ? new Date(shift.realStartTime.seconds * 1000)
        : shift.checkInTime?.seconds ? new Date(shift.checkInTime.seconds * 1000) : null;
    const rEnd = shift.realEndTime?.seconds ? new Date(shift.realEndTime.seconds * 1000)
        : shift.checkOutTime?.seconds ? new Date(shift.checkOutTime.seconds * 1000) : null;
    if (rStart && rEnd) {
        const fichadaH = (rEnd.getTime() - rStart.getTime()) / 3600000;
        if (fichadaH > 0) return Math.min(fichadaH, FT_FULL_DAY_HARD_CAP_HOURS);
    }

    const code = String(shift.code || '').trim().toUpperCase();
    if (code && code !== 'F' && code !== 'FT') {
        const fromLookup = SHIFT_HOURS_LOOKUP[code];
        if (fromLookup && fromLookup > 0) return Math.min(fromLookup, FT_FULL_DAY_HARD_CAP_HOURS);
    }
    return Math.min(fallback > 0 && fallback < 23.5 ? fallback : 8, FT_FULL_DAY_HARD_CAP_HOURS);
}

function shiftEndedForLiquidation(shift: any): boolean {
    const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
    return !!(endSec && new Date(endSec * 1000) <= new Date());
}

/** Evita duplicar FT cuando el doc F y el turno de cobertura coexisten el mismo día. */
export function buildFrancoDocLiquidationSkipIds(shifts: any[], opts?: { usePlannedHours?: boolean }): Set<string> {
    const usePlanned = opts?.usePlannedHours ?? false;
    const byDay = new Map<string, { francoIds: string[]; hasWorkCheckIn: boolean }>();
    for (const s of shifts) {
        const dk = shiftCalendarDateKey(s);
        if (!dk || !s.id) continue;
        const bucket = byDay.get(dk) ?? { francoIds: [], hasWorkCheckIn: false };
        const code = String(s.code || '').trim().toUpperCase();
        if (isFrancoTrabajadoShift(s) && code === 'F' && !shiftHasRealCheckIn(s)) {
            bucket.francoIds.push(s.id);
        } else if (
            isLiquidationWorkCandidate(s)
            && (usePlanned || shiftHasRealCheckIn(s))
            && isFrancoTrabajadoShift(s)
        ) {
            bucket.hasWorkCheckIn = true;
        }
        byDay.set(dk, bucket);
    }
    const skip = new Set<string>();
    for (const { francoIds, hasWorkCheckIn } of byDay.values()) {
        if (hasWorkCheckIn) francoIds.forEach((id) => skip.add(id));
    }
    return skip;
}

/** Total trabajado para liquidaciÃ³n: fichada real, o jornada FT/cobertura ya finalizada. */
export function resolveLiquidationWorkedHours(
    shift: any,
    opts: {
        rDur?: number | null;
        duration?: number;
        isAbsent?: boolean;
        isFT?: boolean;
        skipFrancoDoc?: boolean;
    } = {},
): number {
    if (opts.skipFrancoDoc) return 0;
    if (opts.isAbsent ?? (shift.isAbsent === true)) return 0;
    if (!shiftEndedForLiquidation(shift)) return 0;
    if (opts.rDur != null && opts.rDur >= 0 && opts.rDur <= 36) return opts.rDur;
    const isFT = opts.isFT ?? isFrancoTrabajadoShift(shift);
    if (!isFT) return 0;
    const dur = opts.duration ?? resolveShiftDurationHours(shift);
    return dur > 0 ? dur : 0;
}

export function liquidacion200FromWorkedHours(totalTrabajado: number) {
    const t = Math.max(0, totalTrabajado);
    return {
        horasSimples: Math.min(t, 200),
        excedente50: Math.max(0, t - 200),
    };
}

/** Misma regla que operaciones: planificado sin publicar no entra a liquidaciÃ³n salvo fichada real u origen ops. */
export type ReportPublishFilter = 'published' | 'unpublished' | 'all';

/** Alcance para acotar consulta Firestore (pestaña Planificado). */
export type ReportFetchScope = {
    clientId?: string;
    objectiveId?: string;
    employeeId?: string;
    /** Objetivos del cliente: los turnos a menudo no tienen clientId. */
    clientObjectiveIds?: string[];
};

export function isShiftPublishedForReports(shift: any, publishStatusMap: Record<string, boolean>): boolean {
    const start = parseShiftInstant(shift?.startTime);
    if (!start || !shift?.objectiveId) return false;
    const { year, month } = arYearMonth(start);
    const pubKey = planificacionPublishLookupKey(shift.objectiveId, year, month);
    return pubKey ? !!publishStatusMap[pubKey] : false;
}

export function isShiftEligibleForReports(
    shift: any,
    publishStatusMap: Record<string, boolean>,
    publishFilter: ReportPublishFilter = 'published',
): boolean {
    if (!shift?.startTime || !shift?.endTime) return false;

    const isDraft = shift?.draft === true;
    const isPublished = isShiftPublishedForReports(shift, publishStatusMap);
    const isOps = isOperationalOriginShift(shift);
    const isNovedad = shift?.type === 'NOVEDAD';

    // Todos: incluye borradores (draft) = crono planificado aÃºn no publicado
    if (publishFilter === 'all') return true;

    if (publishFilter === 'unpublished') {
        if (isOps || isNovedad) return false;
        if (isDraft) return true;
        if (!shift?.objectiveId) return false;
        return !isPublished;
    }

    // published â€” liquidaciÃ³n oficial (sin borradores)
    // Los turnos de operaciones son siempre reales, nunca se excluyen por draft
    if (isOps) return true;
    if (isNovedad) return true;
    if (isDraft) return false;

    if (shiftHasRealCheckIn(shift)) return true;

    const st = String(shift?.status || '').toUpperCase();
    if (shift?.isAbsent || st === 'ABSENT') return isPublished;

    if (!shift?.objectiveId) return false;
    return isPublished;
}

export const LEAVE_REPORT_CODES = new Set(['V', 'L', 'PG', 'E', 'A', 'AA']);

export function isLeaveReportShift(shift: any): boolean {
    const code = String(shift?.code || '').trim().toUpperCase();
    if (LEAVE_REPORT_CODES.has(code)) return true;
    if (shift?.type === 'NOVEDAD' && (LEAVE_REPORT_CODES.has(code) || PERIOD_ONLY_CODES.has(code))) return true;
    if (shift?._absenceType && RRHH_ABSENCE_TYPES.has(String(shift._absenceType).trim())) return true;
    return false;
}

function leaveReportShiftScore(s: any): number {
    const code = String(s.code || '').toUpperCase();
    let score = 0;
    if (LEAVE_REPORT_CODES.has(code)) score += 50;
    if (s.type !== 'NOVEDAD') score += 30;
    if (s.coveredBy || s._coveredBy) score += 10;
    if (s.absenceId) score += 5;
    return score;
}

/** Si hay licencia/ausencia RRHH en el dÃ­a, ocultar turno M/T/N sin fichada duplicado. */
export function dedupeShiftsByAbsencePriority(shifts: any[], opts?: { usePlannedHours?: boolean }): any[] {
    const usePlanned = opts?.usePlannedHours ?? false;
    const byEmpDate: Record<string, any[]> = {};
    for (const s of shifts) {
        const dk = s._dateKey || shiftCalendarDateKey(s);
        const key = dk ? `${s.employeeId || ''}_${dk}` : `__orphan_${s.id || Math.random()}`;
        (byEmpDate[key] ||= []).push(s);
    }
    const out: any[] = [];
    for (const [bucketKey, dayShifts] of Object.entries(byEmpDate)) {
        if (bucketKey.startsWith('__orphan_')) {
            out.push(...dayShifts);
            continue;
        }
        const leaveRows = dayShifts.filter(isLeaveReportShift);
        const hasLeave = leaveRows.length > 0;
        if (leaveRows.length > 0) {
            const sorted = [...leaveRows].sort((a, b) => leaveReportShiftScore(b) - leaveReportShiftScore(a));
            const primary = { ...sorted[0] };
            const coveredBy = sorted.map((r) => r.coveredBy || r._coveredBy).find(Boolean);
            if (coveredBy && !primary.coveredBy) {
                primary.coveredBy = coveredBy;
                primary._coveredBy = primary._coveredBy || coveredBy;
            }
            out.push(primary);
        }
        for (const s of dayShifts) {
            if (isLeaveReportShift(s)) continue;
            const code = String(s.code || '').toUpperCase();
            const isWork = !NON_WORK_CODES.has(code);
            const onLeave = isEmployeeOnLeave({ shiftCode: code, absenceType: s._absenceType });
            if (!usePlanned && (hasLeave || onLeave) && isWork && !shiftHasRealCheckIn(s)) continue;
            out.push(s);
        }
    }
    return out.sort((a, b) => (a.startTime?.seconds || 0) - (b.startTime?.seconds || 0));
}

export function mapAbsenceStatusLabel(status?: string | null): string {
    const s = String(status || '').trim();
    if (!s) return 'A verificar';
    if (s === 'En verificación' || s === 'Pendiente') return 'A verificar';
    if (s === 'Justificada' || s === 'Autorizada') return 'Justificada';
    if (s === 'Injustificada' || s === 'Rechazada') return 'Injustificada';
    return s;
}

export function shiftCalendarDateKey(shift: any): string {
    const start = parseShiftInstant(shift?.startTime);
    if (!start) return '';
    return arYmd(start);
}

/** Tramo base+EXT/ADV: mismo criterio que `planningTurnoCoalesce` para decidir si un doc aporta al merge. */
function isLiquidationTramoDoc(t: any): boolean {
    if (!t) return false;
    if (t.isExtended || t.isEarlyStart) return true;
    const role = String(t.coverageSegmentRole || '').toUpperCase();
    if (role === 'EXTENSION' || role === 'EARLY_START') return true;
    const ex = Number(t.extExtraHours ?? t.extensionExtraHours);
    return Number.isFinite(ex) && ex > 0;
}

function liquidationDocsOverlapInTime(a: any, b: any): boolean {
    const sa = parseShiftInstant(a?.startTime);
    const ea = parseShiftInstant(a?.endTime);
    const sb = parseShiftInstant(b?.startTime);
    const eb = parseShiftInstant(b?.endTime);
    if (!sa || !ea || !sb || !eb) return false;
    return sa.getTime() < eb.getTime() && sb.getTime() < ea.getTime();
}

/** Decisión Mauro H1 #2: solo se juntan docs que se pisan en horario o son base + tramo EXT/ADV. */
function shouldMergeLiquidationDocs(a: any, b: any): boolean {
    if (liquidationDocsOverlapInTime(a, b)) return true;
    return isLiquidationTramoDoc(a) || isLiquidationTramoDoc(b);
}

/** Agrupa por adyacencia (overlap u tramo) dentro del mismo legajo/día — Union-Find simple. */
function clusterLiquidationDocsForDay(group: any[]): any[][] {
    const n = group.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const union = (x: number, y: number) => {
        const rx = find(x);
        const ry = find(y);
        if (rx !== ry) parent[rx] = ry;
    };
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (shouldMergeLiquidationDocs(group[i], group[j])) union(i, j);
        }
    }
    const clusters = new Map<number, any[]>();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        (clusters.get(root) ?? (clusters.set(root, []), clusters.get(root)!)).push(group[i]);
    }
    return [...clusters.values()];
}

/**
 * Misma regla que CRM/proforma para el tramo base+EXT/ADV: esos docs se juntan en una jornada
 * billable. Decisión Mauro H1 #2: dos jornadas independientes el mismo día (que no se pisan en
 * horario ni son tramo del mismo turno) se pagan las DOS por separado. Si la suma del día supera
 * 12 h se marca `_liquidationDayExceeds12h` para revisión, sin recortar el pago.
 */
export function collapseShiftsByEmployeeDayForLiquidation(
    shifts: any[],
    slaHoursHint: Record<string, number> = SHIFT_HOURS_LOOKUP,
): any[] {
    const singles: any[] = [];
    const groups = new Map<string, any[]>();
    for (const s of shifts) {
        const emp = String(s.employeeId ?? '').trim();
        const dk = shiftCalendarDateKey(s);
        if (!emp || !dk) {
            singles.push(s);
            continue;
        }
        const key = `${emp}__${dk}`;
        const list = groups.get(key) || [];
        list.push(s);
        groups.set(key, list);
    }
    const out: any[] = [...singles];
    for (const group of groups.values()) {
        if (group.length === 1) {
            out.push(group[0]);
            continue;
        }
        const clusters = clusterLiquidationDocsForDay(group);
        const clusterHours = clusters.map((cl) => (
            cl.length === 1
                ? liquidationBillableHoursForShift(cl[0], slaHoursHint)
                : coalescePlannedCellBillableHours(cl, slaHoursHint)
        ));
        const dayTotalHours = clusterHours.reduce((sum, h) => sum + (Number.isFinite(h) ? h : 0), 0);
        const exceeds12h = dayTotalHours > 12 + 0.01;

        clusters.forEach((cl, i) => {
            if (cl.length === 1) {
                out.push(exceeds12h ? { ...cl[0], _liquidationDayExceeds12h: true } : cl[0]);
                return;
            }
            const merged = coalescePlannedTurnosForCell(cl, slaHoursHint);
            out.push({
                ...merged,
                id: merged?.id || cl.map((g) => g.id).join('_'),
                _liquidationCoalescedIds: cl.map((g) => g.id),
                _liquidationBillableHours: clusterHours[i],
                ...(exceeds12h ? { _liquidationDayExceeds12h: true } : {}),
            });
        });
    }
    return out;
}

export function liquidationBillableHoursForShift(
    shift: any,
    slaHoursHint: Record<string, number> = SHIFT_HOURS_LOOKUP,
): number {
    if (typeof shift?._liquidationBillableHours === 'number' && shift._liquidationBillableHours > 0) {
        return shift._liquidationBillableHours;
    }
    return calcPlanningBillableShiftHours(shift, slaHoursHint);
}

function applyHHmmToShiftDate(base: Date, hhmm: string): Date {
    const m = String(hhmm).trim().slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return new Date(base);
    return withArClock(base, Number(m[1]), Number(m[2]));
}

function hhmmToMinutes(hhmm: string): number | null {
    const m = String(hhmm).trim().slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

/** Tramo de cobertura que cierra antes del inicio de banda (ej. 18–22 antes de NO 22–06) → adelanto, no extensión al final. */
function coverageSegmentIsPreBandAdelanto(shift: any, bandStart: Date): boolean {
    const segFrom = shift?.segmentFromTime
        || (shift?.isEarlyStart ? shift.adjustedStartTime : null);
    const segTo = shift?.segmentToTime
        || (shift?.isExtended ? (shift.adjustedEndTime || shift.extensionEndTime) : null);
    if (!segFrom || !segTo) return false;
    const bandMin = arMinutesOfDay(bandStart);
    const fromM = hhmmToMinutes(String(segFrom));
    const toM = hhmmToMinutes(String(segTo));
    if (fromM == null || toM == null) return false;
    const tol = 35;
    if (Math.abs(toM - bandMin) <= tol) return true;
    if (fromM < bandMin && toM <= bandMin && toM > fromM) return true;
    return false;
}

/** Horario mostrado en liquidación: banda publicada + adelanto/extensión (alineado a CRM/planificador). */
export function resolveLiquidationPlannedWindow(
    shift: any,
    plannedStart: Date,
    plannedEnd: Date,
    slaHoursHint: Record<string, number> = SHIFT_HOURS_LOOKUP,
): {
    start: Date;
    end: Date;
    bandStart: Date;
    bandEnd: Date;
    hasCoverageAdjust: boolean;
    isEarlyDisplay: boolean;
    isExtDisplay: boolean;
} {
    const bandStart = new Date(plannedStart);
    const bandEnd = new Date(plannedEnd);
    let dispStart = new Date(plannedStart);
    let dispEnd = new Date(plannedEnd);

    const role = String(shift?.coverageSegmentRole || '').toUpperCase();
    const preBandAdelanto = coverageSegmentIsPreBandAdelanto(shift, bandStart);
    const isEarly = shift?.isEarlyStart === true || role === 'EARLY_START' || preBandAdelanto;
    const isExt = (shift?.isExtended === true || role === 'EXTENSION') && !preBandAdelanto;

    if (isEarly) {
        const from = shift.adjustedStartTime || shift.segmentFromTime;
        if (from) dispStart = applyHHmmToShiftDate(plannedStart, String(from));
    }
    if (isExt) {
        const to = shift.adjustedEndTime || shift.extensionEndTime || shift.segmentToTime;
        if (to) {
            dispEnd = applyHHmmToShiftDate(plannedEnd, String(to));
            if (dispEnd.getTime() <= dispStart.getTime()) {
                dispEnd = new Date(dispEnd.getTime() + 24 * 3600000);
            }
        }
    }

    const billable = liquidationBillableHoursForShift(shift, slaHoursHint);
    let spanH = Math.max(0, (dispEnd.getTime() - dispStart.getTime()) / 3600000);
    if (billable > spanH + 0.1) {
        if (preBandAdelanto || (isEarly && !isExt)) {
            // Adelanto + banda publicada: fin = egreso planificado (ej. 06:00), no start + horas CCT
            dispEnd = new Date(bandEnd);
            spanH = Math.max(0, (dispEnd.getTime() - dispStart.getTime()) / 3600000);
        } else {
            dispEnd = new Date(dispStart.getTime() + billable * 3600000);
            spanH = billable;
        }
    }

    const hasCoverageAdjust =
        isEarly
        || isExt
        || Math.abs(dispStart.getTime() - bandStart.getTime()) > 60_000
        || Math.abs(dispEnd.getTime() - bandEnd.getTime()) > 60_000
        || billable > spanH + 0.1;

    return {
        start: dispStart,
        end: dispEnd,
        bandStart,
        bandEnd,
        hasCoverageAdjust,
        isEarlyDisplay: isEarly,
        isExtDisplay: isExt,
    };
}

function effectiveEndForBillableDuration(start: Date, plannedEnd: Date, billableHours: number): Date {
    const plannedDur = Math.max(0, (plannedEnd.getTime() - start.getTime()) / 3600000);
    if (billableHours <= plannedDur + 0.15) return plannedEnd;
    return new Date(start.getTime() + billableHours * 3600000);
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
    const start = parseShiftInstant(shift?.startTime);
    if (!start) return `id:${shift?.id || '?'}`;
    const dk = getArgentinaDate(shift.startTime);
    const pos = String(shift?.positionName || 'general').trim().toLowerCase();
    const code = String(shift?.code || '-').trim().toUpperCase();
    const startMin = arMinutesOfDay(start);
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

/** Quita placeholders virtuales y vacantes huÃ©rfanas cuando el slot ya estÃ¡ cubierto. */
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

/** RET stand-by se omite si el mismo dÃ­a hay turno operativo (M/T/Nâ€¦) â€” liquida ese turno. */
export function prepareShiftsForEmployeeLiquidation(shifts: any[]): any[] {
    const byDay = new Map<string, any[]>();
    for (const s of shifts) {
        const dk = shiftCalendarDateKey(s) || `__${s.id || Math.random()}`;
        (byDay.get(dk) ?? (byDay.set(dk, []), byDay.get(dk)!)).push(s);
    }
    const operativeDays = new Set<string>();
    for (const [dk, dayShifts] of byDay) {
        if (dk.startsWith('__')) continue;
        if (dayShifts.some(isRegularLiquidationWorkShift)) operativeDays.add(dk);
    }
    return shifts.filter((s) => {
        const code = String(s.code || '').toUpperCase();
        const isRet = code === 'RET' || s.isReten === true;
        if (!isRet) return true;
        const dk = shiftCalendarDateKey(s);
        return !(dk && operativeDays.has(dk));
    });
}

/** Horas a mostrar/liquidar: V = perÃ­odo (0h); E/L/PG/A = jornada estÃ¡ndar; ignora rango 00:00â€“23:59 de RRHH. */
export function resolveShiftDurationHours(
    shift: {
        code?: string;
        hours?: number;
        startTime?: { seconds?: number; _seconds?: number; toDate?: () => Date } | string;
        endTime?: { seconds?: number; _seconds?: number; toDate?: () => Date } | string;
        isAbsent?: boolean;
        status?: string;
        isReten?: boolean;
        isRefuerzo?: boolean;
        isEscuela?: boolean;
        deploymentRole?: unknown;
        deploymentBand?: unknown;
    },
    lookup: Record<string, number> = SHIFT_HOURS_LOOKUP,
    opts?: { unjustifiedAbsent?: boolean; forObjectiveBilling?: boolean },
): number {
    const rawCode = (shift.code || '').trim().toUpperCase();
    const isUnjustAbsent = opts?.unjustifiedAbsent ?? (
        !PAID_LEAVE_CODES.has(rawCode) && (shift.isAbsent === true || (shift.status || '').toUpperCase() === 'ABSENT')
    );

    if (opts?.forObjectiveBilling && !isObjectiveBillableCode(rawCode)) return 0;

    const endTimeObj = shift.endTime as { seconds?: number; _seconds?: number } | string | undefined;
    const endSecFromShift = typeof endTimeObj === 'object' && endTimeObj
        ? (endTimeObj.seconds ?? endTimeObj._seconds ?? 0)
        : 0;

    const isRet = rawCode === 'RET' || shift.isReten === true;
    if (isRet) {
        if (opts?.forObjectiveBilling) return 0;
        const endSec = endSecFromShift;
        if (endSec && new Date(endSec * 1000) > new Date()) return 0;
        return RET_STANDBY_REFERENCE_HOURS;
    }

    if (!opts?.forObjectiveBilling && isDeploymentOrPoolShift(shift)) {
        const deployH = deploymentShiftHours(shift);
        if (deployH > 0) {
            const endSec = endSecFromShift;
            if (endSec && new Date(endSec * 1000) > new Date()) return 0;
            return deployH;
        }
    }

    const isFT = (shift as { isFrancoTrabajado?: boolean }).isFrancoTrabajado === true || rawCode === 'FT';
    if ((ZERO_HOUR_CODES.has(rawCode) || PERIOD_ONLY_CODES.has(rawCode) || isUnjustAbsent) && !isFT) return 0;

    if (PAID_DAY_LEAVE_CODES.has(rawCode)) {
        if (typeof shift.hours === 'number' && shift.hours > 0) return shift.hours;
        const fromLookup = lookup[rawCode];
        return fromLookup && fromLookup > 0 ? fromLookup : PAID_DAY_DEFAULT_HOURS;
    }

    const startAt = parseShiftInstant(shift.startTime);
    const endAt = parseShiftInstant(shift.endTime);
    if (!startAt || !endAt) return lookup[rawCode] || PAID_DAY_DEFAULT_HOURS;

    let duration = Math.max(0, (endAt.getTime() - startAt.getTime()) / 3600000);
    if (duration === 0 || duration >= 23.5 || duration > 24 || isNaN(duration)) {
        duration = lookup[rawCode] || PAID_DAY_DEFAULT_HOURS;
    }
    if (isFT && duration >= 23.5) duration = resolveFtLiquidationHours(shift, PAID_DAY_DEFAULT_HOURS);

    // Si el shift tiene extensión/adelanto pero los timestamps no fueron actualizados,
    // sumar las horas extra del tramo de cobertura (misma regla que planificador/CRM).
    const billable = calcPlanningBillableShiftHours(shift, lookup);
    if (billable > duration + 0.1) return billable;

    return duration;
}

// Helper seguro para fechas (Formato local Argentina)
const getArgentinaDate = (dateInput: any): string => {
    const d = parseShiftInstant(dateInput);
    return d ? arYmd(d) : '';
};

// CÃ¡lculo de horas nocturnas (21:00 a 06:00)
const getNightDuration = (start: Date, end: Date) => {
    let durationMins = 0;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

    let current = new Date(start.getTime());
    const endTime = end.getTime();
    
    // Seguridad anti-loop (max 24hs)
    let safety = 0;
    while (current.getTime() < endTime && safety < 1440) {
        const h = new Date(current.getTime() - 3 * 3600 * 1000).getUTCHours();
        if (h >= 21 || h < 6) durationMins++;
        current.setMinutes(current.getMinutes() + 1);
        safety++;
    }
    return durationMins / 60;
};

/** Calculadora CCT de horas teóricas/reales por legajo (misma regla que Reportes → Liquidación). */
export function calculateLiquidationHoursStats(
    shifts: any[],
    holidaysMap: Record<string, boolean> = {},
    opts?: { usePlannedHours?: boolean },
) {
    return calculateStatsExact(shifts, holidaysMap, opts);
}

// Calculadora CCT 507/07
const calculateStatsExact = (shifts: any[], holidaysMap: Record<string, boolean>, opts?: { usePlannedHours?: boolean }) => {
    const usePlannedHours = opts?.usePlannedHours ?? false;
    const validShifts = shifts.filter(s => parseShiftInstant(s.startTime) && parseShiftInstant(s.endTime));
    const sortedDocs = collapseShiftsByEmployeeDayForLiquidation(
        [...validShifts].sort((a, b) => (parseShiftInstant(a.startTime)?.getTime() || 0) - (parseShiftInstant(b.startTime)?.getTime() || 0)),
    );
    const francoDocSkipIds = buildFrancoDocLiquidationSkipIds(sortedDocs, { usePlannedHours });

    let hoursTotalOperativas = 0; // teóricas cobertura (sin RET/REF/ESC)
    let horasDespliegue = 0;     // teóricas RET + REF + ESC (fuera de cobertura)
    let totalDiurnas = 0;
    let totalNocturnas = 0;
    let hoursFT = 0;           // teóricas FT (para horasTeoricas)
    let horasFTReal = 0;       // reales FT trabajadas (para extra100 y extra50)
    let hoursFeriado = 0;
    let horasRealesTotal = 0;   // reales (realStartTime/realEndTime)
    let horasRealesCobertura = 0;
    let horasRealesDespliegue = 0;
    let turnosConDatosReales = 0;
    let desglosePlan = 0;
    let desgloseExt = 0;
    let desgloseAdv = 0;
    let desgloseCobertura = 0;
    let desgloseFt = 0;
    let desgloseTura = 0;
    let desgloseEventos = 0;
    const warnings: string[] = [];
    const exceeds12hDaysWarned = new Set<string>();
    const parts: LiquidationShiftPart[] = [];

    sortedDocs.forEach(d => {
        try {
            const st = (d.status || '').toLowerCase();
            if (st.includes('cancel') || st.includes('delet')) return;
            if (d.type === 'NOVEDAD') return;
            if (d._liquidationDayExceeds12h) {
                const dk = shiftCalendarDateKey(d) || '?';
                if (!exceeds12hDaysWarned.has(dk)) {
                    exceeds12hDaysWarned.add(dk);
                    warnings.push(`Día ${dk} supera 12 h (jornadas independientes) — se paga completo, requiere revisión.`);
                }
            }
            if (
                d.coverageHoursOnSource === true
                || (String(d.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE'
                    && ['EXTEND', 'ADVANCE'].includes(String(d.coverageType || '').toUpperCase()))
            ) {
                return;
            }

            const rawCode = (d.code || '').trim().toUpperCase();
            const isFT = isFrancoTrabajadoShift(d);
            if (['FF', 'V', 'L', 'PG', 'A', 'E', 'AA'].includes(rawCode) && !isFT) return;
            if (rawCode === 'F' && !isFT) return;
            // Doc F sin fichada: liquida en el turno de cobertura si ese día tiene fichada
            if (isFT && rawCode === 'F' && !shiftHasRealCheckIn(d) && francoDocSkipIds.has(d.id)) return;

            // Fallback a tiempos reales si no hay planificado (ej: turno RET sin endTime)
            const rStartFB = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1000)
                           : d.checkInTime?.seconds  ? new Date(d.checkInTime.seconds  * 1000) : null;
            const rEndFB   = d.realEndTime?.seconds   ? new Date(d.realEndTime.seconds   * 1000)
                           : d.checkOutTime?.seconds  ? new Date(d.checkOutTime.seconds  * 1000) : null;
            const start = parseShiftInstant(d.startTime) || rStartFB;
            const end   = parseShiftInstant(d.endTime) || rEndFB;
            if (!start || !end) return;
            const isRet = rawCode === 'RET' || d.isReten === true;
            const isDespliegue = isRet || isDeploymentOrPoolShift(d);
            let duration: number;

            if (isRet) {
                if (!usePlannedHours && end > new Date()) return;
                duration = RET_STANDBY_REFERENCE_HOURS;
            } else if (isDeploymentOrPoolShift(d)) {
                duration = deploymentShiftHours(d);
                if (duration <= 0) return;
                if (!usePlannedHours && end > new Date()) return;
            } else {
                duration = (end.getTime() - start.getTime()) / 3600000;
                if (duration < 0 || duration > 24 || isNaN(duration)) {
                    duration = SHIFT_HOURS_LOOKUP[rawCode] || 8;
                }
                const billable = liquidationBillableHoursForShift(d);
                if (billable > duration + 0.1) duration = billable;
            }

            const statsEnd = effectiveEndForBillableDuration(start, end, duration);
            const night = getNightDuration(start, statsEnd);
            const day = Math.max(0, duration - night);
            const dateKey = getArgentinaDate(d.startTime);
            const isFeriado = holidaysMap[dateKey];
            // Decisión Mauro H1 #4: placeholder de día completo (00:00–23:59) — nunca 24 h, ni en
            // teóricas (`duration`) ni en la fichada real (`worked`, más abajo).
            const isFtFullDayPlaceholder = isFT && (duration <= 0 || duration >= 23.5);
            if (isFtFullDayPlaceholder) {
                duration = resolveFtLiquidationHours(d, duration > 0 && duration < 23.5 ? duration : 8);
            }

            // Fix 4: feriado solo aplica a turnos no-FT (no doble acumulación)
            if (isFeriado && !isFT) hoursFeriado += duration;
            // Solo sumar a teóricas si el turno tiene tiempos planificados reales
            const hasPlannedTimes = !!(parseShiftInstant(d.startTime) && parseShiftInstant(d.endTime));
            if (isFT) {
                hoursFT += duration;
            } else if (isDespliegue && hasPlannedTimes) {
                horasDespliegue += duration;
            } else if (hasPlannedTimes) {
                hoursTotalOperativas += duration;
            }

            // Horas reales: solo turnos ya finalizados con fichada real (sin fallback a teórico)
            const isAbsent = d.isAbsent === true || st.includes('absent') || st.includes('ausent');
            if (isAbsent || (!usePlannedHours && end > new Date())) return;

            // Regla de liquidación:
            // - Inicio: adelanto autorizado → hora real; llegada tarde → hora real (descuenta, decisión
            //   Mauro H1 #5 — la tolerancia T+5 ya la aplicó el servidor al fichar, no se reaplica aquí);
            //   llegó a tiempo o antes sin autorización → hora planificada (sin regalo).
            // - Fin: hora planificada, salvo relevo anticipado (da horas completas) o retención formal
            const isEarlyStartShift = d.isEarlyStart === true;
            const isRetentionShift  = d.isRetention === true || (d.retentionMinutes ?? 0) > 0;
            // Decisión Mauro H1 #3: relevo registrado por `registrarPresencia` (RELEVO_PRESENTE /
            // relievedBy) en el turno saliente. Sin ese registro, la salida anticipada no es un relevo.
            const hasRegisteredRelevo = !!(d.relievedBy || d.relievedByName);

            const clampS = (real: Date, plan: Date): Date => {
                if (isEarlyStartShift) return real; // adelanto autorizado -> hora real
                if (real.getTime() > plan.getTime()) return real; // llegada tarde -> descuenta
                return plan; // llegó a tiempo o antes sin autorización -> hora planificada
            };

            const plannedWindow = resolveLiquidationPlannedWindow(d, start, end);
            const authorizedEnd = plannedWindow.isExtDisplay ? plannedWindow.end : null;

            const clampE = (real: Date, plan: Date): Date => {
                if (!plan || isNaN(plan.getTime())) return real; // sin planificado -> usar real
                if (real < plan) {
                    // Decisión Mauro H1 #3: CON relevo registrado se completa la jornada;
                    // SIN relevo, salida anticipada paga lo real.
                    return hasRegisteredRelevo ? plan : real;
                }
                if (isRetentionShift)   return real;         // retencion formal -> hora real
                if (authorizedEnd && authorizedEnd > plan) {
                    return real < authorizedEnd ? real : authorizedEnd; // extensión autorizada: solo lo trabajado
                }
                return plan;                                  // salida tardia sin retencion -> clampear
            };

            const rStartRaw = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1000)
                            : d.checkInTime?.seconds   ? new Date(d.checkInTime.seconds * 1000)
                            : null;
            const rEndRaw   = d.realEndTime?.seconds   ? new Date(d.realEndTime.seconds * 1000)
                            : d.checkOutTime?.seconds  ? new Date(d.checkOutTime.seconds * 1000)
                            : null;

            const rStart = (!usePlannedHours && rStartRaw) ? clampS(rStartRaw, start) : null;
            const rEnd   = (!usePlannedHours && rEndRaw)   ? clampE(rEndRaw,   end)   : null;
            let worked = 0;
            if (rStart && rEnd) {
                const rDur = (rEnd.getTime() - rStart.getTime()) / 3600000;
                if (rDur >= 0) {
                    // Fix 3: cap a 24h en lugar de descartar; FT de día completo, tope 12:59 (decisión #4).
                    worked = Math.min(rDur, isFtFullDayPlaceholder ? FT_FULL_DAY_HARD_CAP_HOURS : 24);
                    turnosConDatosReales++;
                }
            } else if (isFT && !francoDocSkipIds.has(d.id)) {
                worked = resolveFtLiquidationHours(d, duration);
            } else if (isRet) {
                worked = duration; // Fix 5: RET sin fichada usa horas referenciales
            } else if (usePlannedHours) {
                worked = liquidationBillableHoursForShift(d);
                if (worked <= 0) worked = Math.min(Math.max(0, duration), 24);
                turnosConDatosReales++;
            }
            // Fix 1: acumular horas FT reales (solo trabajadas)
            if (isFT && worked > 0) horasFTReal += worked;
            horasRealesTotal += worked;
            if (worked > 0) {
                const codeUp = rawCode.includes('/') ? rawCode.split('/')[0] : rawCode;
                const band = SHIFT_HOURS_LOOKUP[codeUp] > 0 ? SHIFT_HOURS_LOOKUP[codeUp] : Math.max(0, duration);
                const planPart = Math.min(worked, band || worked);
                const extraPart = Math.max(0, Math.round((worked - planPart) * 100) / 100);
                const origin = String(d.origin || '').toUpperCase();
                const isCobertura = origin === 'OPERATIONS_COVERAGE'
                    && d.coverageHoursOnSource !== true
                    && !['EXTEND', 'ADVANCE'].includes(String(d.coverageType || '').toUpperCase());
                let partExt = 0;
                let partAdv = 0;
                const originUp = String(d.origin || '').toUpperCase();
                const isEvento = codeUp === 'EV' || codeUp === 'EVT' || originUp === 'EVENTO';
                if (isFT) desgloseFt += worked;
                else if (isEvento) desgloseEventos += worked;
                else if (codeUp === 'TURA' || codeUp === 'RFZ') desgloseTura += worked;
                else if (isCobertura) desgloseCobertura += worked;
                else if (d.isEarlyStart === true) {
                    desglosePlan += planPart;
                    desgloseAdv += extraPart;
                    partAdv = extraPart;
                } else if (d.isExtended === true || d.isRetention === true || String(d.coverageSegmentRole || '').toUpperCase() === 'EXTENSION') {
                    desglosePlan += planPart;
                    desgloseExt += extraPart;
                    partExt = extraPart;
                } else {
                    desglosePlan += worked;
                }
                parts.push({
                    employeeId: String(d.employeeId || ''),
                    objectiveId: String(d.objectiveId || '').trim(),
                    date: dateKey || (start ? arYmd(start) : ''),
                    worked,
                    ft: isFT ? worked : 0,
                    ext: partExt,
                    adv: partAdv,
                });
            }
            if (worked > 0) {
                if (isDespliegue && !isFT) horasRealesDespliegue += worked;
                else horasRealesCobertura += worked;
            }
            // Acumular diurnas/nocturnas basado en horas reales trabajadas
            if (worked > 0) {
                const effS = rStart || start;
                const effE = rEnd || effectiveEndForBillableDuration(effS, end, worked);
                const nightWorked = getNightDuration(effS, effE);
                totalNocturnas += nightWorked;
                totalDiurnas += Math.max(0, worked - nightWorked);
            }
        } catch (err) {
            console.warn("Saltando turno corrupto:", d.id);
        }
    });

    const baseLimit = 200; // techo CCT persona (no 204)
    // Fix 2: extra50 solo sobre horas regulares (excluye FT real para no empujarlas al 50%)
    const regularReal = Math.max(0, horasRealesTotal - horasFTReal);
    const excess = Math.max(0, regularReal - baseLimit);
    const horasSimples = Math.min(Math.max(0, horasRealesTotal), baseLimit);
    const horasCobertura = hoursTotalOperativas + hoursFT;
    const horasTeoricas = horasCobertura + horasDespliegue;

    return {
        totalReal: horasTeoricas,        // nombre legacy, mantener por compat
        horasTeoricas,
        horasCobertura,
        horasDespliegue,
        horasReales: horasRealesTotal,
        horasRealesCobertura,
        horasRealesDespliegue,
        turnosConDatosReales,
        horasSimples,
        totalDiurnas,
        totalNocturnas,
        extra50: excess,
        extra100: horasFTReal, // Fix 1: usar horas FT reales, no teóricas
        plusFeriado: hoursFeriado,
        horasExtra: Math.max(0, horasRealesTotal - horasTeoricas),
        /** Número principal del libro persona (trabajadas, incluye FT). */
        totales: horasRealesTotal,
        /** Columna de seguimiento; no es el número principal. */
        planificadas: horasTeoricas,
        desglose: {
            plan: desglosePlan,
            ext: desgloseExt,
            adv: desgloseAdv,
            cobertura: desgloseCobertura,
            ft: desgloseFt,
            tura: desgloseTura,
            eventos: desgloseEventos,
        },
        /** Decisión Mauro H1 #2: días con jornadas independientes que suman >12 h (revisar, no se recorta el pago). */
        warnings,
        requiresReview: warnings.length > 0,
        parts,
    };
};

export type LiquidationShiftPart = {
    employeeId: string;
    objectiveId: string;
    date: string;
    worked: number;
    ft: number;
    ext: number;
    adv: number;
};