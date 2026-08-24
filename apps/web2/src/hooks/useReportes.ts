import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, where, Timestamp, orderBy, limit } from 'firebase/firestore';
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
import { isEmployeeOnLeave, RRHH_ABSENCE_TYPES, resolveLeaveCode } from '@/lib/planificacion/leaveCoverage';
import {
    deploymentShiftHours,
    isDeploymentOrPoolShift,
    isRegularLiquidationWorkShift,
} from '@/lib/planificacion/deploymentRoles';
import { RET_STANDBY_REFERENCE_HOURS } from '@/lib/planificacion/constants';
import { getCctPayrollPeriodByOffset } from '@/lib/cctPayrollPeriod';
import { readSessionJson, writeSessionJson } from '@/lib/persistSession';
import {
    coalescePlannedCellBillableHours,
    coalescePlannedTurnosForCell,
} from '@/lib/planificacion/planningTurnoCoalesce';
import { calcPlanningBillableShiftHours } from '@/lib/planificacion/planningScheduledHours';
import {
    fetchReportAjustesHoras,
    fetchReportAusencias,
    fetchReportPlanificacionEstados,
} from '@/lib/reportFirestoreQueries';

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

function resolveFtLiquidationHours(shift: any, fallback = 8): number {
    const startSec = shift.startTime?.seconds ?? shift.startTime?._seconds ?? 0;
    const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
    if (startSec && endSec) {
        const span = Math.max(0, (endSec - startSec) / 3600);
        if (span > 0 && span < 23.5) return span;
    }
    const code = String(shift.code || '').trim().toUpperCase();
    if (code && code !== 'F' && code !== 'FT') {
        const fromLookup = SHIFT_HOURS_LOOKUP[code];
        if (fromLookup && fromLookup > 0) return fromLookup;
    }
    return fallback > 0 && fallback < 23.5 ? fallback : 8;
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
    const start = shift?.startTime?.toDate?.();
    if (!start || !shift?.objectiveId) return false;
    const pubKey = planificacionPublishLookupKey(
        shift.objectiveId,
        start.getFullYear(),
        start.getMonth() + 1,
    );
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

function shiftCalendarDateKey(shift: any): string {
    const start = shift?.startTime?.toDate?.();
    if (!start) return '';
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

/** Misma regla que CRM/proforma: varios docs mismo legajo/día (base + ext/adelanto) → una jornada billable. */
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
        const merged = coalescePlannedTurnosForCell(group, slaHoursHint);
        const billable = coalescePlannedCellBillableHours(group, slaHoursHint);
        out.push({
            ...merged,
            id: merged?.id || group.map((g) => g.id).join('_'),
            _liquidationCoalescedIds: group.map((g) => g.id),
            _liquidationBillableHours: billable,
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
    const d = new Date(base);
    if (!m) return d;
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
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
    const bandMin = bandStart.getHours() * 60 + bandStart.getMinutes();
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
                dispEnd.setDate(dispEnd.getDate() + 1);
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
        startTime?: { seconds?: number; _seconds?: number };
        endTime?: { seconds?: number; _seconds?: number };
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

    const isRet = rawCode === 'RET' || shift.isReten === true;
    if (isRet) {
        if (opts?.forObjectiveBilling) return 0;
        const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
        if (endSec && new Date(endSec * 1000) > new Date()) return 0;
        return RET_STANDBY_REFERENCE_HOURS;
    }

    if (!opts?.forObjectiveBilling && isDeploymentOrPoolShift(shift)) {
        const deployH = deploymentShiftHours(shift);
        if (deployH > 0) {
            const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
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

    const startSec = shift.startTime?.seconds ?? shift.startTime?._seconds ?? 0;
    const endSec = shift.endTime?.seconds ?? shift.endTime?._seconds ?? 0;
    if (!startSec || !endSec) return lookup[rawCode] || PAID_DAY_DEFAULT_HOURS;

    let duration = Math.max(0, (endSec - startSec) / 3600);
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

// CÃ¡lculo de horas nocturnas (21:00 a 06:00)
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
const calculateStatsExact = (shifts: any[], holidaysMap: Record<string, boolean>, opts?: { usePlannedHours?: boolean }) => {
    const usePlannedHours = opts?.usePlannedHours ?? false;
    const validShifts = shifts.filter(s => s.startTime && s.endTime && s.startTime.seconds && s.endTime.seconds);
    const sortedDocs = collapseShiftsByEmployeeDayForLiquidation(
        [...validShifts].sort((a, b) => a.startTime.seconds - b.startTime.seconds),
    );
    const francoDocSkipIds = buildFrancoDocLiquidationSkipIds(sortedDocs, { usePlannedHours });

    let hoursTotalOperativas = 0; // teÃ³ricas
    let totalDiurnas = 0;
    let totalNocturnas = 0;
    let hoursFT = 0;           // teÃ³ricas FT (para horasTeoricas)
    let horasFTReal = 0;       // reales FT trabajadas (para extra100 y extra50)
    let hoursFeriado = 0;
    let horasRealesTotal = 0;   // reales (realStartTime/realEndTime)
    let turnosConDatosReales = 0;

    sortedDocs.forEach(d => {
        try {
            const st = (d.status || '').toLowerCase();
            if (st.includes('cancel') || st.includes('delet')) return;
            if (d.type === 'NOVEDAD') return;

            const rawCode = (d.code || '').trim().toUpperCase();
            const isFT = isFrancoTrabajadoShift(d);
            if (['FF', 'V', 'L', 'PG', 'A', 'E', 'AA', 'EV'].includes(rawCode) && !isFT) return;
            if (rawCode === 'F' && !isFT) return;
            // Doc F sin fichada: liquida en el turno de cobertura si ese dÃ­a tiene fichada
            if (isFT && rawCode === 'F' && !shiftHasRealCheckIn(d) && francoDocSkipIds.has(d.id)) return;

            // Fallback a tiempos reales si no hay planificado (ej: turno RET sin endTime)
            const rStartFB = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1000)
                           : d.checkInTime?.seconds  ? new Date(d.checkInTime.seconds  * 1000) : null;
            const rEndFB   = d.realEndTime?.seconds   ? new Date(d.realEndTime.seconds   * 1000)
                           : d.checkOutTime?.seconds  ? new Date(d.checkOutTime.seconds  * 1000) : null;
            const start = d.startTime?.toDate ? d.startTime.toDate() : rStartFB;
            const end   = d.endTime?.toDate   ? d.endTime.toDate()   : rEndFB;
            if (!start || !end) return;
            const isRet = rawCode === 'RET' || d.isReten === true;
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
            if (isFT && (duration <= 0 || duration >= 23.5)) {
                duration = resolveFtLiquidationHours(d, duration > 0 && duration < 23.5 ? duration : 8);
            }

            // Fix 4: feriado solo aplica a turnos no-FT (no doble acumulaciÃ³n)
            if (isFeriado && !isFT) hoursFeriado += duration;
            // Solo sumar a teóricas si el turno tiene tiempos planificados reales
            const hasPlannedTimes = !!(d.startTime?.toDate) && !!(d.endTime?.toDate);
            if (isFT) { hoursFT += duration; }
            else if (hasPlannedTimes) { hoursTotalOperativas += duration; }

            // Horas reales: solo turnos ya finalizados con fichada real (sin fallback a teÃ³rico)
            const isAbsent = d.isAbsent === true || st.includes('absent') || st.includes('ausent');
            if (isAbsent || (!usePlannedHours && end > new Date())) return;

            // Regla de liquidaciÃ³n:
            // - Inicio: siempre hora planificada (salvo adelanto explÃ­cito)
            // - Fin: hora planificada, salvo relevo anticipado (da horas completas) o retenciÃ³n formal
            const isEarlyStartShift = d.isEarlyStart === true;
            const isRetentionShift  = d.isRetention === true || (d.retentionMinutes ?? 0) > 0;

            const clampS = (real: Date, plan: Date): Date =>
                isEarlyStartShift ? real : plan;  // adelanto â†’ hora real; normal â†’ hora planificada

            const clampE = (real: Date, plan: Date): Date => {
                if (!plan || isNaN(plan.getTime())) return real; // sin planificado -> usar real
                if (real < plan)        return plan;         // relevo anticipado -> horas completas
                if (isRetentionShift)   return real;         // retencion formal -> hora real
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
                    worked = Math.min(rDur, 24); // Fix 3: cap a 24h en lugar de descartar
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

    const baseLimit = 204; // CCT 422/05 SUVICO
    // Fix 2: extra50 solo sobre horas regulares (excluye FT real para no empujarlas al 50%)
    const regularReal = Math.max(0, horasRealesTotal - horasFTReal);
    const excess = Math.max(0, regularReal - baseLimit);
    // horasSimples = total real capeado a 204 (para HORAS TOTALES display)
    const horasSimples = Math.min(Math.max(0, horasRealesTotal), baseLimit);
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
        extra100: horasFTReal, // Fix 1: usar horas FT reales, no teÃ³ricas
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

/** Misma convenciÃ³n que Servicios: clientId + nombre cuando falta objectiveId. */
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

export type RrhhNovedades = {
    vacacionesDias: number;
    enfermedadDias: number;
    art: number;
    licenciaEspecialDias: number;
    permisoGremialDias: number;
    injustificadaDias: number;
};

export function countNovedadesRRHHFromShifts(shifts: any[]): RrhhNovedades {
    const rrhh: RrhhNovedades = {
        vacacionesDias: 0,
        enfermedadDias: 0,
        art: 0,
        licenciaEspecialDias: 0,
        permisoGremialDias: 0,
        injustificadaDias: 0,
    };
    for (const s of shifts) {
        const code = String(s.code || '').trim().toUpperCase();
        if (code === 'V') rrhh.vacacionesDias++;
        else if (code === 'E') rrhh.enfermedadDias++;
        else if (code === 'A') rrhh.art++;
        else if (code === 'L') rrhh.licenciaEspecialDias++;
        else if (code === 'PG') rrhh.permisoGremialDias++;
        else if (code === 'AA') rrhh.injustificadaDias++;
    }
    return rrhh;
}

/** JSON compatible con payrollApi (integraciones externas). */
export function buildPayrollExportPayload(
    rows: any[],
    opts: { start: string; end: string; empresaId?: string; publishFilter: ReportPublishFilter },
) {
    const bolsa = (r: any) => Math.max(0, r.horasReales ?? 0);
    return {
        exportVersion: '1',
        source: 'COSP_REPORTES_UI',
        cctVersion: '422/05',
        generatedAt: new Date().toISOString(),
        dateRange: { start: opts.start, end: opts.end },
        publishFilter: opts.publishFilter,
        empresaId: opts.empresaId || null,
        items: rows.map(row => {
            const b = bolsa(row);
            return {
                employee: {
                    id: row.id,
                    fileNumber: row.legajo || null,
                    fullName: row.name,
                },
                acumulado: {
                    hsTeoricas: row.horasTeoricas ?? row.total ?? 0,
                    hsReales: row.horasReales ?? 0,
                    diurnas: row.diurnas ?? 0,
                    nocturnas: row.nocturnas ?? 0,
                    al50: row.extra50 ?? 0,
                    al100FT: row.extra100 ?? 0,
                    plusFeriado: row.plusFeriado ?? 0,
                },
                liquidacion200: {
                    bolsa: b,
                    hsSimples: Math.min(b, 200),
                    al50: Math.max(0, b - 200),
                    nota: 'FT y Feriados se pagan aparte.',
                },
                novedadesRRHH: row.novedadesRRHH ?? countNovedadesRRHHFromShifts(row.rawShifts || []),
                turnosCount: row.shiftsTotal ?? row.shifts ?? 0,
                turnosConFichada: row.turnosConDatosReales ?? 0,
            };
        }),
    };
}

function collectObjectiveIdsForTurnosQuery(
    fetchScope: ReportFetchScope | undefined,
    aliasLookup: Record<string, ObjectiveMeta>,
): string[] {
    const wanted = new Set<string>();
    const single = String(fetchScope?.objectiveId ?? '').trim();
    const cliId = String(fetchScope?.clientId ?? '').trim();
    if (single) {
        wanted.add(aliasLookup[single]?.canonicalId || single);
    } else if (cliId) {
        (fetchScope?.clientObjectiveIds || []).forEach((id) => {
            const k = String(id || '').trim();
            if (k) wanted.add(aliasLookup[k]?.canonicalId || k);
        });
        Object.values(aliasLookup).forEach((m) => {
            if (m.clientId === cliId && m.canonicalId) wanted.add(m.canonicalId);
        });
    } else {
        Object.values(aliasLookup).forEach((m) => {
            if (m.canonicalId) wanted.add(m.canonicalId);
        });
    }
    const ids = new Set<string>();
    wanted.forEach((c) => ids.add(c));
    Object.entries(aliasLookup).forEach(([key, m]) => {
        if (m.canonicalId && wanted.has(m.canonicalId) && key) ids.add(key);
    });
    return [...ids].filter(Boolean);
}

async function fetchTurnosForReport(opts: {
    startDate: Date;
    endDate: Date;
    empresaId: string;
    scopeEmpresa: boolean;
    fetchScope?: ReportFetchScope;
    aliasLookup: Record<string, ObjectiveMeta>;
}): Promise<any[]> {
    const startTs = Timestamp.fromDate(opts.startDate);
    const endTs = Timestamp.fromDate(opts.endDate);
    const col = collection(db, 'turnos');
    const empId = String(opts.fetchScope?.employeeId ?? '').trim();

    if (empId) {
        const snap = await getDocs(query(
            col,
            where('employeeId', '==', empId),
            where('startTime', '>=', startTs),
            where('startTime', '<=', endTs),
        ));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    const objectiveIds = collectObjectiveIdsForTurnosQuery(opts.fetchScope, opts.aliasLookup);
    if (objectiveIds.length === 0) {
        const q = opts.scopeEmpresa
            ? query(col, where('empresaId', '==', opts.empresaId), where('startTime', '>=', startTs), where('startTime', '<=', endTs))
            : query(col, where('startTime', '>=', startTs), where('startTime', '<=', endTs));
        const snap = await getDocs(q);
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    const byId = new Map<string, any>();
    const chunkSize = 8;
    for (let i = 0; i < objectiveIds.length; i += chunkSize) {
        const chunk = objectiveIds.slice(i, i + chunkSize);
        const snaps = await Promise.all(chunk.map((oid) => getDocs(query(
            col,
            where('objectiveId', '==', oid),
            where('startTime', '>=', startTs),
            where('startTime', '<=', endTs),
        ))));
        snaps.forEach((snap) => {
            snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
        });
    }
    return [...byId.values()];
}

function shiftBelongsToClient(
    shift: any,
    cliId: string,
    objectiveAliases: Record<string, ObjectiveMeta>,
    clientObjectiveIds?: string[],
): boolean {
    if (!cliId) return true;
    const shiftCli = String(shift?.clientId ?? '').trim();
    if (shiftCli && shiftCli === cliId) return true;
    const shiftObj = String(shift?.objectiveId ?? '').trim();
    if (!shiftObj) return false;
    if (clientObjectiveIds?.includes(shiftObj)) return true;
    const meta = objectiveAliases[shiftObj];
    if (meta?.clientId === cliId) return true;
    if (meta?.canonicalId && clientObjectiveIds?.includes(meta.canonicalId)) return true;
    return false;
}

function shiftMatchesFetchScope(
    shift: any,
    fetchScope: ReportFetchScope | undefined,
    objectiveAliases: Record<string, ObjectiveMeta>,
): boolean {
    if (!fetchScope) return true;
    const empId = String(fetchScope.employeeId ?? '').trim();
    const objId = String(fetchScope.objectiveId ?? '').trim();
    const cliId = String(fetchScope.clientId ?? '').trim();
    if (empId && String(shift.employeeId ?? '') !== empId) return false;
    if (cliId && !shiftBelongsToClient(shift, cliId, objectiveAliases, fetchScope.clientObjectiveIds)) return false;
    if (objId) {
        const shiftObj = String(shift.objectiveId ?? '').trim();
        if (!shiftObj) return false;
        if (shiftObj === objId) return true;
        const picked = objectiveAliases[objId];
        const shiftMeta = objectiveAliases[shiftObj];
        if (picked && shiftMeta && picked.canonicalId === shiftMeta.canonicalId) return true;
        if (picked && (shiftObj === picked.name || shiftObj === picked.canonicalId)) return true;
        return false;
    }
    return true;
}

export const useReportes = (forcedClientId?: string | null) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = (empresa as any)?.migracionCompleta === true;
    const scopeEmpresa = useMemo(
        () => shouldScopeQueriesToEmpresa(empresaId, migracionCompleta),
        [empresaId, migracionCompleta],
    );
    const [loading, setLoading] = useState(false);
    const [loadingProgress, setLoadingProgress] = useState<{ pct: number; label: string } | null>(null);

    const reportProgress = (pct: number, label: string) => {
        setLoadingProgress({
            pct: Math.min(100, Math.max(0, Math.round(pct))),
            label,
        });
    };

    const initialCctPeriod = getCctPayrollPeriodByOffset(0);
    const savedRpt = typeof window !== 'undefined'
        ? readSessionJson<{ start?: string; end?: string; publishFilter?: ReportPublishFilter; usePlannedHours?: boolean }>('cosp:rpt:view')
        : null;
    const [dateRange, setDateRange] = useState({
        start: savedRpt?.start || initialCctPeriod.start,
        end: savedRpt?.end || initialCctPeriod.end,
    });
    
    const [employeeReport, setEmployeeReport] = useState<any[]>([]);
    const [objectiveReport, setObjectiveReport] = useState<any[]>([]);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    
    const [empMap, setEmpMap] = useState<Record<string, string>>({});
    const [empMetaMap, setEmpMetaMap] = useState<Record<string, {
        name: string;
        legajo: string;
        preferredObjectiveId?: string;
        experienciaObjetivos?: Record<string, unknown>;
        planificacionDotacion?: Record<string, unknown>;
    }>>({});
    const [publishFilter, setPublishFilter] = useState<ReportPublishFilter>(savedRpt?.publishFilter || 'all');
    const [usePlannedHours, setUsePlannedHours] = useState(savedRpt?.usePlannedHours ?? false);
    const [objMap, setObjMap] = useState<Record<string, string>>({});
    const [objectiveAliases, setObjectiveAliases] = useState<Record<string, ObjectiveMeta>>({});
    const [clientMap, setClientMap] = useState<Record<string, string>>({});
    const [holidaysData, setHolidaysData] = useState<Record<string, boolean>>({});

    useEffect(() => {
        writeSessionJson('cosp:rpt:view', {
            start: dateRange.start,
            end: dateRange.end,
            publishFilter,
            usePlannedHours,
        });
    }, [dateRange.start, dateRange.end, publishFilter, usePlannedHours]);

    useEffect(() => {
        if (!empresaId) return;
        const loadCatalogs = async () => {
            try {
                const [s, c, h] = await Promise.all([ 
                    getDocs(empresaScopedQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>),
                    getDocs(empresaScopedQuery('clients', empresaId, scopeEmpresa) as ReturnType<typeof query>),
                    getDocs(query(collection(db, 'feriados'), limit(400)))
                ]);
                
                const emps: any = {};
                const empsMeta: Record<string, {
                    name: string;
                    legajo: string;
                    preferredObjectiveId?: string;
                    experienciaObjetivos?: Record<string, unknown>;
                    planificacionDotacion?: Record<string, unknown>;
                }> = {};
                s.forEach(d => {
                    const data = d.data();
                    const name = data.name || (data.firstName ? `${data.lastName}, ${data.firstName}` : 'Sin Nombre');
                    emps[d.id] = name;
                    empsMeta[d.id] = {
                        name,
                        legajo: String(data.fileNumber || data.legajo || '').trim(),
                        preferredObjectiveId: data.preferredObjectiveId ? String(data.preferredObjectiveId) : undefined,
                        experienciaObjetivos: (data.experienciaObjetivos || {}) as Record<string, unknown>,
                        planificacionDotacion: (data.planificacionDotacion || {}) as Record<string, unknown>,
                    };
                });
                setEmpMap(emps);
                setEmpMetaMap(empsMeta);
                
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

            } catch (e) { console.error("Error cargando catÃ¡logos:", e); }
        };
        loadCatalogs();
    }, [empresaId, scopeEmpresa]);

    const generateReports = async (fetchScope?: ReportFetchScope) => {
        if (!dateRange.start || !dateRange.end) return toast.error("Seleccione un rango de fechas");
        setLoading(true);
        setLoadingProgress({ pct: 0, label: 'Iniciando…' });
        setEmployeeReport([]);
        setObjectiveReport([]);

        try {
            reportProgress(5, 'Validando período');
            // FIX CRÃTICO DE FECHAS: Usar formato ISO Local
            const startDate = new Date(`${dateRange.start}T00:00:00`);
            const endDate = new Date(`${dateRange.end}T23:59:59.999`);

            if (startDate > endDate) {
                toast.error("La fecha 'Desde' no puede ser mayor a 'Hasta'");
                setLoading(false);
                setLoadingProgress(null);
                return;
            }

            reportProgress(12, 'Cargando contratos de servicio');
            // Cargar contratos de servicio para cruzar Hs. Vendidas por objetivo
            const slaSnap = await getDocs(query(empresaScopedQuery('servicios_sla', empresaId, scopeEmpresa) as ReturnType<typeof query>, limit(500)));
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
                const scopeCli = String(fetchScope?.clientId ?? '').trim();
                const scopeObj = String(fetchScope?.objectiveId ?? '').trim();
                if (scopeCli && cid && cid !== scopeCli) return;
                if (scopeObj) {
                    const picked = aliasLookup[scopeObj];
                    const sameObj = canonicalId === scopeObj
                        || matchKeys.includes(scopeObj)
                        || (!!picked && picked.canonicalId === canonicalId);
                    if (!sameObj) return;
                }

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

            const scopeEmpId = String(fetchScope?.employeeId ?? '').trim();
            const scopeObjId = String(fetchScope?.objectiveId ?? '').trim();
            const rangeStartYmd = dateRange.start;
            const rangeEndYmd = dateRange.end;

            reportProgress(28, 'Descargando turnos, ausencias y planificación');
            const [planifDocs, fetchedTurnos, ausDocs, ajustesDocs] = await Promise.all([
                fetchReportPlanificacionEstados(
                    empresaId,
                    scopeEmpresa,
                    rangeStartYmd,
                    rangeEndYmd,
                    scopeObjId || undefined,
                ),
                fetchTurnosForReport({
                    startDate,
                    endDate,
                    empresaId,
                    scopeEmpresa,
                    fetchScope,
                    aliasLookup,
                }),
                fetchReportAusencias(
                    empresaId,
                    scopeEmpresa,
                    rangeStartYmd,
                    rangeEndYmd,
                    scopeEmpId || undefined,
                ),
                fetchReportAjustesHoras(
                    empresaId,
                    rangeStartYmd,
                    rangeEndYmd,
                    scopeEmpId || undefined,
                ),
            ]);

            reportProgress(45, 'Procesando turnos y novedades');
            const publishStatusMap: Record<string, boolean> = {};
            planifDocs.forEach(d => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                const parsed = parsePlanificacionEstadoDocId(d.id);
                if (parsed) {
                    publishStatusMap[planificacionPublishLookupKey(parsed.objectiveId, parsed.year, parsed.month)] = true;
                }
                publishStatusMap[d.id] = true;
            });

            // Base sin publishFilter: necesario para detectar FT (el turno F puede ser borrador)
            const allShiftsBase = fetchedTurnos
                .filter((d: any) => {
                    // Aceptar turno si tiene tiempos planificados O tiempos reales
                    const hasPlanned = d.startTime && typeof d.startTime.toDate === 'function';
                    const hasReal    = d.realStartTime && typeof d.realStartTime.toDate === 'function';
                    if (!hasPlanned && !hasReal) return false;
                    if (!belongsToEmpresaView(d, empresaId, migracionCompleta)) return false;
                    if (forcedClientId && d.clientId !== forcedClientId) return false;
                    if (!shiftMatchesFetchScope(d, fetchScope, aliasLookup)) return false;
                    return true;
                });
            // Pre-computar flags FT sobre el set completo (antes del filtro de publicacion)
            const ftShiftIds = new Set<string>();
            const _allByEmp: Record<string, any[]> = {};
            allShiftsBase.forEach((s: any) => {
                if (!s.employeeId) return;
                if (!_allByEmp[s.employeeId]) _allByEmp[s.employeeId] = [];
                _allByEmp[s.employeeId].push(s);
            });
            Object.values(_allByEmp).forEach((empShifts: any[]) => {
                propagateFrancoTrabajadoFlags(empShifts, { usePlannedHours }).forEach((s: any) => {
                    if (s.isFrancoTrabajado || s._inferredFrancoTrabajado) ftShiftIds.add(s.id);
                });
            });
            // rawShifts filtrado normalmente
            const rawShifts = allShiftsBase.filter((d: any) =>
                isShiftEligibleForReports(d, publishStatusMap, publishFilter)
            );

            const absenceById: Record<string, any> = {};
            const absenceByEmpDate: Record<string, any> = {};
            ausDocs.forEach(d => {
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
            const coveringForByEmpDate: Record<string, string> = {};
            rawShifts.forEach((s: any) => {
                const dk = shiftCalendarDateKey(s);
                const comments = String(s.comments || '');
                const m = comments.match(/Cubriendo a (.+?) \(/);
                if (m && dk) {
                    const titularName = m[1].trim();
                    const titularId = Object.keys(empMap).find(id => empMap[id] === titularName);
                    if (titularId) {
                        const covName = s.employeeName || empMap[s.employeeId] || 'â€”';
                        coverageByEmpDate[`${titularId}_${dk}`] = covName;
                        const coverCode = String(s.code || '').trim().toUpperCase();
                        coveringForByEmpDate[`${s.employeeId}_${dk}`] = coverCode
                            ? `${titularName} turno ${coverCode}`
                            : titularName;
                    }
                }
                if (s.coveredBy && dk) {
                    coverageByEmpDate[`${s.employeeId}_${dk}`] = String(s.coveredBy).replace(/\s*\([^)]*\)\s*$/, '').trim();
                }
            });

            // Mapa shiftId â†’ shift completo, para resolver absenceShiftId â†’ descripciÃ³n de lo cubierto
            const shiftIdToShift: Record<string, any> = {};
            rawShifts.forEach((s: any) => {
                if (s.id) shiftIdToShift[s.id] = s;
            });

            // Mapa inverso: coveredByEmployeeId+fecha â†’ nombre del ausente/vacante cubierto
            // Para ADELANTO/RETEN que no tienen absenceShiftId pero el turno ausente los referencia
            const coveringForByEmpIdDate: Record<string, string> = {};
            rawShifts.forEach((s: any) => {
                if (!s.coveredByEmployeeId) return;
                const dk = shiftCalendarDateKey(s);
                if (!dk) return;
                const key = `${s.coveredByEmployeeId}_${dk}`;
                const isVacancy = !s.employeeId || s.isUnassigned;
                const desc = isVacancy
                    ? `Vacante${s.positionName ? ' ' + s.positionName : ''}${s.code ? ' (' + s.code + ')' : ''}`
                    : (s.employeeName || 'Guardia');
                if (!coveringForByEmpIdDate[key]) coveringForByEmpIdDate[key] = desc;
            });

            // Resolver quÃ© cubrÃ­a un retÃ©n/adelanto a partir del shift referenciado
            const resolveCoveringFor = (s: any, dk: string | null): string | null => {
                const refId = s.absenceShiftId;
                if (refId && shiftIdToShift[refId]) {
                    const ref = shiftIdToShift[refId];
                    const isVacancy = !ref.employeeId || ref.employeeId === 'VACANTE' || ref.isUnassigned;
                    if (isVacancy) {
                        // Vacante: mostrar puesto y cÃ³digo
                        const pos = ref.positionName || '';
                        const code = (ref.code || '').toUpperCase();
                        return `Vacante${pos ? ' ' + pos : ''}${code ? ' (' + code + ')' : ''}`;
                    } else {
                        // Ausente: mostrar nombre del titular
                        return ref.employeeName || null;
                    }
                }
                // 2. Mapa inverso: ausente apunta al cubridore
                if (dk && coveringForByEmpIdDate[`${s.employeeId}_${dk}`]) {
                    return coveringForByEmpIdDate[`${s.employeeId}_${dk}`];
                }
                // 3. Relevo directo
                if (s.relievedEmployeeName) return s.relievedEmployeeName;
                // 4. Fallback: buscar ausente en mismo objetivo+puesto+dÃ­a
                if (dk && s.objectiveId && s.positionName) {
                    const sameSlotAbsent = rawShifts.find((r: any) =>
                        r.id !== s.id &&
                        (r.isAbsent || r.status === 'ABSENT') &&
                        r.objectiveId === s.objectiveId &&
                        (r.positionName || '').trim().toLowerCase() === (s.positionName || '').trim().toLowerCase() &&
                        shiftCalendarDateKey(r) === dk
                    );
                    if (sameSlotAbsent?.employeeName) return sameSlotAbsent.employeeName;
                    // Si no hay ausente, puede ser una vacante (turno no planificado)
                    const isOpsShift = ['RETEN','EARLY_START','OPERATIONS_COVERAGE'].includes((s.origin||'').toUpperCase());
                    if (isOpsShift) return `Vacante ${s.positionName || ''}`;
                }
                return null;
            };

            const enrichShift = (s: any) => {
                const dk = shiftCalendarDateKey(s);
                const abs = s.absenceId ? absenceById[s.absenceId] : (dk ? absenceByEmpDate[`${s.employeeId}_${dk}`] : null);

                // QuiÃ©n cubriÃ³ al guardia ausente / vacante
                const coveredByName = s.coveredByEmployeeName
                    || s.coveredBy
                    || (dk ? coverageByEmpDate[`${s.employeeId}_${dk}`] : null)
                    || null;

                // A quiÃ©n / quÃ© cubriÃ³ este turno operativo
                const coveringFor = resolveCoveringFor(s, dk)
                    || (dk ? coveringForByEmpDate[`${s.employeeId}_${dk}`] : null)
                    || null;

                return {
                    ...s,
                    _dateKey: dk,
                    _isPublished: isShiftPublishedForReports(s, publishStatusMap),
                    _absenceType: abs?.type || null,
                    _absenceStatus: abs?.status || null,
                    _absenceReason: abs?.reason || null,
                    _coveredBy: coveredByName,
                    _coveringFor: coveringFor,
                };
            };

            if (rawShifts.length === 0) {
                toast.info("No se encontraron turnos válidos en este rango.");
            }

            // 3. Procesamiento por Empleado (excluir vacantes/desconocidos)
            reportProgress(58, 'Calculando liquidación por legajo');
            const empGroups: any = {};
            rawShifts.forEach((s: any) => {
                if (!s.employeeId || !empMap[s.employeeId]) return;
                if(!empGroups[s.employeeId]) empGroups[s.employeeId] = [];
                // Aplicar flag FT pre-computado (detectado antes del filtro publishFilter)
                const sWithFT = ftShiftIds.has(s.id)
                    ? { ...s, isFrancoTrabajado: true, _inferredFrancoTrabajado: true, code: s.code || 'FT' }
                    : s;
                empGroups[s.employeeId].push(enrichShift(sWithFT));
            });

            const empIds = Object.keys(empGroups);
            const empRows: any[] = [];
            for (let i = 0; i < empIds.length; i++) {
                const empId = empIds[i]!;
                if (empIds.length > 1 && (i === 0 || i === empIds.length - 1 || i % Math.max(1, Math.floor(empIds.length / 8)) === 0)) {
                    reportProgress(
                        58 + Math.round(((i + 1) / empIds.length) * 14),
                        `Liquidando legajos (${i + 1}/${empIds.length})`,
                    );
                }
                const shifts = prepareShiftsForEmployeeLiquidation(
                    dedupeShiftsByAbsencePriority(
                        propagateFrancoTrabajadoFlags(empGroups[empId], { usePlannedHours }),
                        { usePlannedHours },
                    ),
                );
                const stats = calculateStatsExact(shifts, holidaysData, { usePlannedHours });

                const ftCount = shifts.filter((s: any) => isFrancoTrabajadoShift(s)).length;
                const ffCount = shifts.filter((s:any) => s.isFrancoCompensatorio || s.code === 'FF').length;
                const novedadesRRHH = countNovedadesRRHHFromShifts(shifts);

                empRows.push({
                    id: empId,
                    type: 'EMPLOYEE',
                    name: empMap[empId] || 'Desconocido',
                    legajo: empMetaMap[empId]?.legajo || '',
                    shiftsTotal: shifts.length,
                    shifts: shifts.length,
                    shiftsOperativos: shifts.filter((s:any) => isOperativeCode(s.code)).length,
                    novedadesRRHH,
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
                });
            }

            // Ajustes de horas manuales â€” sumar/restar del total teÃ³rico del empleado
            const ajustesByEmp: Record<string, number> = {};
            ajustesDocs.forEach(d => {
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

            const empCount = finalEmpRows.length;
            const shiftCount = rawShifts.length;
            if (empCount > 0) {
                const filterLbl = publishFilter === 'all' ? 'todos (incl. borrador)'
                    : publishFilter === 'unpublished' ? 'solo borrador'
                    : 'solo publicados';
                toast.success(`${empCount} empleado(s) · ${shiftCount} turnos · ${filterLbl}`);
            }

            // 4. Procesamiento por Objetivo
            reportProgress(78, 'Armando reporte por objetivo');
            const objGroups: Record<string, { shifts: any[]; clientId?: string }> = {};
            rawShifts.forEach((s: any) => {
                const enriched = enrichShift(s);
                if (enriched.type === 'NOVEDAD' || !shouldBillShiftToObjective(enriched)) return;

                const objId = resolveCanonicalObjectiveId(enriched, aliasLookup);
                if (!objId) return;

                if (!objGroups[objId]) objGroups[objId] = { shifts: [], clientId: enriched.clientId };
                objGroups[objId].shifts.push(enriched);
                if (enriched.clientId) objGroups[objId].clientId = enriched.clientId;
            });

            for (const objId of Object.keys(objGroups)) {
                objGroups[objId].shifts = filterObjectiveReportShifts(
                    objGroups[objId].shifts,
                    empMap,
                    slaSlotCapacity,
                    objId,
                );
            }

            const objLeaveShifts: Record<string, any[]> = {};
            rawShifts.forEach((s: any) => {
                const enriched = enrichShift(s);
                if (shouldBillShiftToObjective(enriched)) return;
                const objId = resolveCanonicalObjectiveId(enriched, aliasLookup);
                if (!objId) return;
                const leaveCode = resolveLeaveCode(enriched.code, enriched._absenceType);
                if (!leaveCode && !isEmployeeOnLeave({ shiftCode: enriched.code, absenceType: enriched._absenceType })) return;
                (objLeaveShifts[objId] ||= []).push({
                    ...enriched,
                    employeeName: empMap[enriched.employeeId] || null,
                    code: leaveCode || enriched.code,
                    _objectiveBillable: false,
                });
            });

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
                    staffedShifts.filter((s: any) => shouldBillShiftToObjective(s)),
                    holidaysData,
                    { usePlannedHours },
                );
                const annotatedShifts = (() => {
                    const merged = [
                        ...data.shifts.map((s: any) => ({
                            ...s,
                            employeeName: empMap[s.employeeId] || null,
                            _objectiveBillable: true,
                        })),
                        ...(objLeaveShifts[objId] || []),
                    ];
                    const byEmp: Record<string, any[]> = {};
                    merged.forEach((s) => {
                        const eid = s.employeeId || '_';
                        (byEmp[eid] ||= []).push(s);
                    });
                    return Object.values(byEmp).flatMap((g) => dedupeShiftsByAbsencePriority(g, { usePlannedHours }));
                })();
                return {
                    id: objId,
                    type: 'OBJECTIVE',
                    name: meta.name,
                    clientId: meta.clientId,
                    client: meta.client || clientMap[meta.clientId] || 'Sin Cliente',
                    shifts: staffedShifts.length,
                    vacantShifts: vacantRawShifts.length,
                    vacantHours,
                    total: stats.horasTeoricas,
                    horasTeoricas: stats.horasTeoricas,
                    horasReales: stats.horasReales,
                    diurnas: stats.totalDiurnas,
                    nocturnas: stats.totalNocturnas,
                    extra50: stats.extra50,
                    extra100: stats.extra100,
                    plusFeriado: stats.plusFeriado,
                    rawShifts: annotatedShifts,
                };
            });

            setObjectiveReport(objRows.filter(Boolean) as any[]);
            reportProgress(100, 'Listo');

        } catch (err) {
            console.error('Error generando reporte:', err);
            toast.error('Error al generar el reporte');
        } finally {
            setLoading(false);
            setLoadingProgress(null);
        }
    };

    const loadAudit = async () => {
        if (!empresaId) return;
        try {
            const since90 = new Date();
            since90.setDate(since90.getDate() - 90);
            const snap = await getDocs(
                query(
                    collection(db, 'audit_logs'),
                    where('empresaId', '==', empresaId),
                    where('timestamp', '>=', Timestamp.fromDate(since90)),
                    orderBy('timestamp', 'desc'),
                    limit(500),
                )
            );
            const logs = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            setAuditLogs(logs);
        } catch (err) {
            console.error('Error cargando auditoría:', err);
        }
    };

    return {
        loading,
        loadingProgress,
        dateRange,
        setDateRange,
        publishFilter,
        setPublishFilter,
        usePlannedHours,
        setUsePlannedHours,
        generateReports,
        loadAudit,
        employeeReport,
        objectiveReport,
        auditLogs,
        objMap,
        empMap,
        empMetaMap,
        clientMap,
        objectiveAliases,
        holidaysData,
        SHIFT_HOURS_LOOKUP,
        OPERATIVE_CODES,
    };
};
