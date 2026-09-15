
import { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp, doc, serverTimestamp, addDoc, setDoc, getDocs, runTransaction, getDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';
import { useEmpresa } from '@/context/EmpresaContext';
import { shouldScopeQueriesToEmpresa, belongsToEmpresaView, updateDocForEmpresa, stampEmpresaId, planificacionPublishLookupKey, parsePlanificacionEstadoDocId, empresaCollectionQuery, filterSlaRowsByEmpresa, buildAuditLogsRecentQuery, auditLogTimestampMs, sortAuditLogRows } from '@/lib/multiempresa';
import { combinedContiguousRangeLabel, isTuraContiguousToParent, findParentShiftForTura } from '@/lib/refuerzo/turaContiguity';
import { pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import { logOpsBackgroundWarn, logOpsListenerWarn } from '@/lib/operaciones/logOpsError';
import { countPositionClosedUnitsFromShifts } from '@/lib/planificacion/positionCoverageUnits';
import { isOperationalOriginShift } from '@/lib/shifts/operationalShift';

const registerPublishedState = (
    map: Record<string, boolean>,
    objectiveId: string,
    year: number,
    month: number,
) => {
    const oid = String(objectiveId ?? '').trim();
    if (!oid || !Number.isFinite(year) || !Number.isFinite(month)) return;
    map[planificacionPublishLookupKey(oid, year, month)] = true;
};

const getSafeDate = (val: any) => { if (!val) return null; try { if (val.toDate) return val.toDate(); if (val.seconds) return new Date(val.seconds * 1000); return new Date(val); } catch (e) { return null; } };
const isSameDay = (d1: Date, d2: Date) => d1 && d2 && d1.toLocaleDateString('en-CA') === d2.toLocaleDateString('en-CA');
const getDuration = (start: Date, end: Date) => {
    if (!start || !end) return 0;
    let diff = (end.getTime() - start.getTime()) / 3600000;
    // Mismo instante (00:00→00:00) no es 24h
    if (Math.abs(diff) < 1 / 60) return 0;
    if (diff < 0) diff += 24;
    return diff;
};

/** Solo overnight real (23:00→07:00). start===end NO suma 24h. */
const overnightEndMs = (startMs: number, endMs: number): number => {
    if (startMs > 0 && endMs > 0 && endMs < startMs) return endMs + 86400000;
    return endMs;
};

const OPS_BAND_CLOCK: Record<string, { startH: number; startM: number; endH: number; endM: number }> = {
    M: { startH: 7, startM: 0, endH: 15, endM: 0 },
    T: { startH: 15, startM: 0, endH: 23, endM: 0 },
    N: { startH: 23, startM: 0, endH: 7, endM: 0 },
    D12: { startH: 7, startM: 0, endH: 19, endM: 0 },
    N12: { startH: 19, startM: 0, endH: 7, endM: 0 },
};

/** 00:00→00:00 o wrap fantasma ~24h con misma hora de reloj. */
export function isPlaceholderOpsWindow(start: Date | null | undefined, end: Date | null | undefined): boolean {
    if (!start || !end) return false;
    const diff = Math.abs(end.getTime() - start.getTime());
    if (diff < 60_000) return true;
    if (Math.abs(diff - 86_400_000) < 120_000) {
        return start.getHours() === end.getHours() && start.getMinutes() === end.getMinutes();
    }
    return false;
}

function applyCctBandWindow(base: Date, code: string): { start: Date; end: Date } | null {
    const band = OPS_BAND_CLOCK[String(code || '').toUpperCase()];
    if (!band) return null;
    const start = new Date(base);
    start.setHours(band.startH, band.startM, 0, 0);
    const end = new Date(base);
    end.setHours(band.endH, band.endM, 0, 0);
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
    return { start, end };
}

/** Corrige start/end basura antes de lógica Ops (activo, retención, HOY, display). */
export function sanitizeOpsShiftDates<T extends { shiftDateObj?: Date | null; endDateObj?: Date | null; code?: unknown; type?: unknown; opsBandSanitized?: boolean }>(shift: T): T {
    const start = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : null;
    const end = shift.endDateObj instanceof Date ? shift.endDateObj : null;
    if (!isPlaceholderOpsWindow(start, end)) return shift;
    const code = String(shift.code || shift.type || '').toUpperCase();
    const base = start || end;
    if (!base) return shift;
    const band = applyCctBandWindow(base, code);
    if (!band) return shift;
    return { ...shift, shiftDateObj: band.start, endDateObj: band.end, opsBandSanitized: true };
}

const createDateFromTime = (timeStr: string, baseDate: Date) => { if (!timeStr) return null; const [hours, minutes] = timeStr.split(':').map(Number); const d = new Date(baseDate); d.setHours(hours, minutes, 0, 0); return d; };
const getDayCode = (date: Date) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][date.getDay()];

const FRANCO_REST_CODES = new Set(['F', 'FF', 'FP']);

/** Franco de descanso (F/FF/FP), no FT ni franco ya convocado a trabajar. */
export function isRestFrancoShift(shift: any): boolean {
    if (!shift || shift.isFrancoTrabajado) return false;
    const code = String(shift.code || shift.type || '').toUpperCase();
    if (FRANCO_REST_CODES.has(code)) return true;
    if (shift.isFrancoCompensatorio) return true;
    if (shift.isFranco || shift.objectiveName === 'FRANCO') return true;
    return false;
}

/**
 * Ventana operativa del CC (no solo “día calendario”).
 * Sin lookahead, un 00:00→08:00 de mañana no aparece en PLAN a la noche
 * y parece que nadie releva / no hay continuidad.
 */
export const OPS_PLAN_LOOKAHEAD_MS = 16 * 60 * 60 * 1000;

/** Objetivo donde “opera” el turno (FT/cobertura puede diferir del objectiveId del franco origen). */
export function opsShiftCoverageObjectiveId(s: {
    objectiveId?: unknown;
    francoObjectiveId?: unknown;
    coverageRedirectedTo?: unknown;
    isFrancoTrabajado?: unknown;
} | null | undefined): string {
    if (!s) return '';
    const franco = String(s.francoObjectiveId || '').trim();
    if (s.isFrancoTrabajado && franco) return franco;
    const redirected = String(s.coverageRedirectedTo || '').trim();
    if (redirected) return redirected;
    return String(s.objectiveId || '').trim();
}

export function shiftBelongsToOpsObjective(
    s: {
        objectiveId?: unknown;
        francoObjectiveId?: unknown;
        coverageRedirectedTo?: unknown;
        isFrancoTrabajado?: unknown;
    } | null | undefined,
    objectiveId: string,
): boolean {
    const oid = String(objectiveId || '').trim();
    if (!s || !oid) return false;
    if (String(s.objectiveId || '').trim() === oid) return true;
    if (String(s.francoObjectiveId || '').trim() === oid) return true;
    if (String(s.coverageRedirectedTo || '').trim() === oid) return true;
    return false;
}

export function isOpsShiftHoy(s: any, now: Date = new Date()): boolean {
    if (!s) return false;
    const effectiveNow = now instanceof Date ? now : new Date();
    if (s.isCompleted && !s.isRetention && !isRestFrancoShift(s)) return false;
    const sStart = s.shiftDateObj instanceof Date ? s.shiftDateObj : (s.shiftDateObj ? new Date(s.shiftDateObj) : null);
    const sEnd = s.endDateObj instanceof Date ? s.endDateObj : (s.endDateObj ? new Date(s.endDateObj) : null);
    if (s.isVirtual && sEnd && (!sStart || !isSameDay(sStart, effectiveNow)) && sEnd.getTime() < effectiveNow.getTime()) return false;
    if (sStart && isSameDay(sStart, effectiveNow)) return true;

    const nowMs = effectiveNow.getTime();
    const startMs = sStart?.getTime() ?? 0;
    let endMs = sEnd?.getTime() ?? 0;
    endMs = overnightEndMs(startMs, endMs);

    // Presentes/retenidos de días anteriores (zombies acotados a 48h)
    if ((s.isPresent || s.isRetention) && !s.isCompleted) {
        return startMs > 0 && (nowMs - startMs) <= 48 * 60 * 60 * 1000;
    }

    // Turno en curso por horario (p.ej. N que empezó ayer y termina hoy) — continuidad
    // Placeholder 00:00=00:00: no inventar ventana 24h
    if (startMs > 0 && endMs > startMs && endMs > nowMs && startMs <= nowMs) return true;

    // Próximos turnos (madrugada / primer turno de mañana) aunque el start sea “mañana”
    if (startMs > nowMs && startMs - nowMs <= OPS_PLAN_LOOKAHEAD_MS) return true;

    return false;
}

/** Etiqueta de día para turnos en ventana operativa (lookahead incluye mañana). */
export function opsShiftDayLabel(shiftDate: any, now: Date = new Date()): {
    key: 'hoy' | 'manana' | 'otro';
    label: string;
} {
    const d = shiftDate instanceof Date ? shiftDate : getSafeDate(shiftDate);
    if (!d) return { key: 'otro', label: '—' };
    if (isSameDay(d, now)) return { key: 'hoy', label: 'HOY' };
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (isSameDay(d, tomorrow)) return { key: 'manana', label: 'MAÑANA' };
    try {
        const label = d.toLocaleDateString('es-AR', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            timeZone: 'America/Argentina/Cordoba',
        }).toUpperCase();
        return { key: 'otro', label };
    } catch {
        return { key: 'otro', label: '--/--' };
    }
}

/** Fracción del slot ya transcurrida (≥1 = turno terminado). Null si faltan fechas. */
export const VACANCY_DESCUBIERTO_RATIO = 0.55;

export function getVacancyElapsedRatio(s: any, now: Date = new Date()): number | null {
    const start = s?.shiftDateObj instanceof Date ? s.shiftDateObj : getSafeDate(s?.shiftDateObj);
    const end = s?.endDateObj instanceof Date ? s.endDateObj : getSafeDate(s?.endDateObj);
    if (!start || !end) return null;
    let startMs = start.getTime();
    let endMs = end.getTime();
    if (Math.abs(endMs - startMs) < 60_000) return null;
    endMs = overnightEndMs(startMs, endMs);
    const dur = endMs - startMs;
    if (dur <= 0) return null;
    return (now.getTime() - startMs) / dur;
}

/** Vacante ya no accionable: slot terminado o >55% del turno, o doc SIN COBERTURA. */
export function isVacancyDescubierto(s: any, now: Date = new Date()): boolean {
    if (!s?.isUnassigned) return false;
    if (s.isSinCobertura || s.status === 'SIN_COBERTURA') return true;
    if (typeof s.isDescubierto === 'boolean') return s.isDescubierto;
    const ratio = getVacancyElapsedRatio(s, now);
    if (ratio == null) return false;
    return ratio >= VACANCY_DESCUBIERTO_RATIO;
}

/**
 * Vacante viva para Ops (tab VAC / sirena / mapa rojo / botón CUBRIR):
 * sin devolver a planificación, no cubierta y cuyo horario de turno no haya finalizado aún.
 */
export function isActionableOpsVacancy(s: any, now: Date = new Date()): boolean {
    if (!s?.isUnassigned) return false;
    if (s.isSinCobertura || s.status === 'SIN_COBERTURA') return false;
    if (s.isReportedToPlanning || s.status === 'REPORTED_TO_PLANNING' || s.isReported === true) return false;
    if (s.status === 'COVERED' || s.status === 'CANCELLED') return false;
    const end = s?.endDateObj instanceof Date ? s.endDateObj : getSafeDate(s?.endDateObj);
    if (end && end.getTime() < now.getTime()) return false;
    return true;
}

export function shiftMatchesOpsViewTab(s: any, viewTab: string): boolean {
    switch (viewTab) {
        case 'TODOS':
            // En TODOS solo se excluyen las devueltas a planificación y francos
            if (s.isUnassigned && (s.isReportedToPlanning || s.status === 'REPORTED_TO_PLANNING' || s.isReported === true)) return false;
            return !s.isFranco;
        case 'PRIORIDAD':
            return (s.isImminent || s.isRetention || s.isPendingRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn || s.isPlannedExtensionImminent || s.isPlannedLiberationRet || s.isRRHHUrgent) && !s.isFranco;
        case 'NO_LLEGO':
            return (s.isLateNotified || s.isLateUnnotified || s.isPotentialAbsence) && !s.isFranco && !s.isAbsent && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn && !s.hasRRHHNovedad;
        case 'PLAN':
            return (s.isFuture || s.isRRHHPlanned) && !s.isFranco && !s.isUnassigned && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn && !s.isPlannedLiberationRet;
        case 'ACTIVOS':
            return s.isPresent && !s.isCompleted && !s.isRetention && !s.isPendingRetention;
        case 'RETENIDOS':
            return s.isRetention;
        case 'VACANTES':
            // Solo vacantes vivas (no DEVUELTO, no COVERED, horario no finalizado)
            return isActionableOpsVacancy(s);
        case 'AUSENTES':
            // RET stand-by no "falta": no ficha hasta convertirse al turno real.
            // ESC/REF sí se controlan (fichan / ausentan como turno de puesto).
            if (s.isPassiveStandby || s.isRetention || s.origin === 'RETEN' || s.isReten
                || String(s.code || '').toUpperCase() === 'RET') return false;
            return s.isAbsent || s.isPotentialAbsence;
        case 'FRANCOS':
            return s.isFranco;
        case 'RETEN':
            // Pool de retención pasiva del día (información operativa, como FRANCOS).
            {
                const codeU = String(s.code || '').toUpperCase();
                if (s.isFranco || s.isCompleted) return false;
                if (String(s.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return false;
                return codeU === 'RET' || s.isReten === true || s.origin === 'RETEN';
            }
        default:
            return !s.isFranco;
    }
}

// HELPER: GAPS (SOLO FALLBACK)
const findTimeGaps = (shifts: any[], baseDate: Date) => {
    const timeline = new Int8Array(1440).fill(0); 
    shifts.forEach(s => {
        const start = s.shiftDateObj;
        const end = s.endDateObj;
        let sMin = start.getHours() * 60 + start.getMinutes();
        let eMin = end.getHours() * 60 + end.getMinutes();
        if (isSameDay(start, baseDate)) { if (!isSameDay(end, baseDate)) eMin = 1440; } 
        else if (isSameDay(end, baseDate)) { sMin = 0; } 
        else { if (start < baseDate && end > new Date(baseDate.getTime() + 86400000)) { sMin = 0; eMin = 1440; } else return; }
        if (eMin < sMin) eMin = 1440;
        for (let i = sMin; i < eMin; i++) if (i >= 0 && i < 1440) timeline[i] = 1;
    });
    const gaps = [];
    let inGap = false, gapStart = 0;
    for (let i = 0; i < 1440; i++) {
        if (timeline[i] === 0) { if (!inGap) { inGap = true; gapStart = i; } }
        else { if (inGap) { inGap = false; if (i - gapStart > 60) gaps.push({ start: gapStart, end: i }); } }
    }
    if (inGap && (1440 - gapStart > 60)) gaps.push({ start: gapStart, end: 1440 });
    return gaps.map(g => {
        const s = new Date(baseDate); s.setHours(Math.floor(g.start/60), g.start%60, 0, 0);
        const e = new Date(baseDate); e.setHours(Math.floor(g.end/60), g.end%60, 0, 0);
        if (g.end === 1440) e.setMinutes(59); 
        return { start: s, end: e, duration: (g.end - g.start)/60 };
    });
};

// HELPER: SLOT COVERAGE (EL VERDADERO MOTOR V124)
const checkSlotCoverage = (slotStart: Date, slotEnd: Date, shifts: any[]) => {
    let tStart = slotStart.getTime(); let tEnd = slotEnd.getTime();
    tEnd = overnightEndMs(tStart, tEnd);
    if (tEnd <= tStart) return false;
    const duration = tEnd - tStart; let covered = 0;
    shifts.forEach(s => {
        let sStart = s.shiftDateObj.getTime(); let sEnd = s.endDateObj.getTime();
        if (Math.abs(sEnd - sStart) < 60_000) return;
        sEnd = overnightEndMs(sStart, sEnd);
        
        // Alineación inteligente: Si el turno cubre el rango, suma.
        // No forzamos dias, solo superposición de timestamps.
        const overlapStart = Math.max(tStart, sStart); 
        const overlapEnd = Math.min(tEnd, sEnd);
        
        if (overlapEnd > overlapStart) covered += (overlapEnd - overlapStart);
    });
    // Tolerancia 90% cubierto
    return (covered / duration) > 0.90;
};

/** Horas de solapamiento entre un turno y un slot SLA (puede cruzar medianoche). */
const overlapHoursWithSlot = (s: any, slotStart: Date, slotEnd: Date): number => {
    if (!s?.shiftDateObj || !s?.endDateObj || !slotStart || !slotEnd) return 0;
    let tStart = slotStart.getTime();
    let tEnd = slotEnd.getTime();
    tEnd = overnightEndMs(tStart, tEnd);
    let sStart = s.shiftDateObj.getTime();
    let sEnd = s.endDateObj.getTime();
    // Placeholder mismo instante: no inventar 24h de cobertura fantasma
    if (Math.abs(sEnd - sStart) < 60_000) return 0;
    sEnd = overnightEndMs(sStart, sEnd);
    const overlapStart = Math.max(tStart, sStart);
    const overlapEnd = Math.min(tEnd, sEnd);
    if (overlapEnd <= overlapStart) return 0;
    return (overlapEnd - overlapStart) / 3600000;
};

/**
 * Un guardia cuenta para el slot si aporta cobertura real:
 * - ≥3h de solape, o
 * - ≥50% de su propio turno dentro del slot, o
 * - ≥50% del slot (regla clásica relajada desde 90% — evita que 08–16 no “cubra” un D12 08–20).
 */
const shiftContributesToVacancySlot = (s: any, slotStart: Date, slotEnd: Date, vacancyPos: string) => {
    if (!shiftMatchesVacancyPosition(s, vacancyPos)) return false;
    if (s.isAbsent || s.isPotentialAbsence || s.isFranco || s.isUnassigned) return false;
    const seg = getSegmentCoverageWindow(s, slotStart);
    const proxy = seg ? { shiftDateObj: seg.start, endDateObj: seg.end } : s;
    const overlapH = overlapHoursWithSlot(proxy, slotStart, slotEnd);
    if (overlapH < 0.25) return false;
    if (overlapH >= 3) return true;
    let slotDur = (slotEnd.getTime() - slotStart.getTime()) / 3600000;
    if (slotDur <= 0) slotDur += 24;
    let shiftDur = getDuration(proxy.shiftDateObj, proxy.endDateObj);
    if (shiftDur <= 0) shiftDur = overlapH;
    if (shiftDur > 0 && overlapH / shiftDur >= 0.5) return true;
    if (slotDur > 0 && overlapH / slotDur >= 0.5) return true;
    return false;
};

/** Ventana efectiva para cobertura split planificada (ext/adel con tramo horario). */
const getSegmentCoverageWindow = (s: any, baseDate: Date): { start: Date; end: Date } | null => {
    const from = s.segmentFromTime;
    const to = s.segmentToTime;
    if (typeof from === 'string' && typeof to === 'string' && /^\d{1,2}:\d{2}$/.test(from) && /^\d{1,2}:\d{2}$/.test(to)) {
        const start = createDateFromTime(from, baseDate);
        let end = createDateFromTime(to, baseDate);
        if (start && end) {
            if (end <= start) end = new Date(end.getTime() + 86400000);
            return { start, end };
        }
    }
    return null;
};

const shiftMatchesVacancyPosition = (s: any, vacancyPos: string) => {
    const vPos = normalizePosMatch(vacancyPos);
    if (normalizePosMatch(s.positionName) === vPos) return true;
    if (s.coversPositionName && normalizePosMatch(s.coversPositionName) === vPos) return true;
    return false;
};

/** Cobertura de slot considerando ext/adel planificados en otro puesto/tramo. */
const shiftCoversVacancySlot = (s: any, slotStart: Date, slotEnd: Date, vacancyPos: string) => {
    return shiftContributesToVacancySlot(s, slotStart, slotEnd, vacancyPos);
};

/**
 * Solape horario + puesto (sirve también para docs VACANTE / isUnassigned).
 * shiftCoversVacancySlot exige persona asignada y falla al deduplicar POR AUSENCIA vs virtual MAÑANA.
 */
const vacancySlotTimeOverlaps = (s: any, slotStart: Date, slotEnd: Date, vacancyPos: string): boolean => {
    if (!shiftMatchesVacancyPosition(s, vacancyPos)) return false;
    if (!s?.shiftDateObj || !s?.endDateObj || !slotStart || !slotEnd) return false;
    const overlapH = overlapHoursWithSlot(s, slotStart, slotEnd);
    if (overlapH < 0.25) return false;
    let slotDur = (slotEnd.getTime() - slotStart.getTime()) / 3600000;
    if (slotDur <= 0) slotDur += 24;
    if (overlapH >= 3) return true;
    if (slotDur > 0 && overlapH / slotDur >= 0.5) return true;
    return overlapH >= 1;
};

const isShiftOperativelyCovered = (s: any): boolean =>
    !!s?.operacionallyCovered
    || !!s?.coveredByEmployeeId
    || !!s?.coveredByEmployeeName
    || String(s?.coverageStatus || '').toUpperCase() === 'COVERED'
    || String(s?.status || '').toUpperCase() === 'COVERED';

const assessPlannedPackageStatus = (rows: any[]): 'COVERED' | 'PARTIAL' | 'NONE' => {
    if (!rows.length) return 'NONE';
    const hasExt = rows.some(r => r.coverageSegmentRole === 'EXTENSION');
    const hasAdel = rows.some(r => r.coverageSegmentRole === 'EARLY_START');
    if (!hasExt || !hasAdel) return 'PARTIAL';
    const explicit = rows.find(r => r.coverageStatus === 'COVERED' || r.coverageStatus === 'PARTIAL')?.coverageStatus;
    if (explicit === 'COVERED') return 'COVERED';
    if (explicit === 'PARTIAL') return 'PARTIAL';
    return 'COVERED';
};

const normPosName = (n: unknown) => String(n ?? '').trim().toLowerCase();

// Normalización agresiva para matching entre SLA y turnos:
// elimina acentos (á→a, é→e, í→i, ó→o, ú→u) y prefijo "Puesto " para que
// "Puesto Rondin" matchee "Rondín", "Puesto 1" matchee "1", etc.
const normalizePosMatch = (n: unknown): string => {
    let s = String(n ?? '').trim().toLowerCase();
    // eslint-disable-next-line no-misleading-character-class
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip diacríticos
    s = s.replace(/^puesto\s+/, '');                         // strip prefijo "puesto "
    return s;
};

/**
 * Auto-cierre atómico via Firestore transaction.
 * Si otro browser ya completó el turno, cancela silenciosamente (devuelve false).
 */
const autoCloseShiftTx = async (
    shiftId: string,
    fields: Record<string, unknown>,
    empresaId: string,
): Promise<boolean> => {
    const ref = doc(db, 'turnos', shiftId);
    let didWrite = false;
    await runTransaction(db, async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists() || snap.data()?.isCompleted === true) return; // ya cerrado
        t.update(ref, { ...fields, empresaId: empresaId || undefined });
        didWrite = true;
    });
    return didWrite;
};

const getPositionCapacity = (servicesSLA: any[], objectiveId: string, positionName: string): number => {
    const sla = servicesSLA.find((s: any) => s.objectiveId === objectiveId);
    const pos = sla?.positions?.find((p: any) => normPosName(p.name) === normPosName(positionName));
    return Math.max(1, Number(pos?.quantity) || 1);
};

const EMPTY_PROCESSED_DATA: any[] = [];

const foldSearch = (value: unknown) => String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const countPresentOnSlot = (
    shifts: any[],
    objectiveId: string,
    positionName: string,
    slotStart: Date,
    slotEnd: Date,
) => shifts.filter(s =>
    s.isPresent && !s.isCompleted &&
    s.objectiveId === objectiveId &&
    normPosName(s.positionName) === normPosName(positionName) &&
    checkSlotCoverage(slotStart, slotEnd, [s]),
).length;

export type OperacionesMonitorViewTab =
    | 'PRIORIDAD' | 'NO_LLEGO' | 'PLAN' | 'ACTIVOS' | 'RETENIDOS' | 'VACANTES' | 'AUSENTES' | 'FRANCOS' | 'RETEN' | 'TODOS';

export type OperacionesMonitorShared = {
    processedData: any[];
    publishStatusMap: Record<string, boolean>;
    recentLogs: any[];
    isReady: boolean;
    isStable: boolean;
    handleAction: (action: string, shiftId: string, payload?: any) => Promise<void>;
    uniqueClients: { id: string; name: string }[];
    employees: any[];
    servicesSLA: any[];
    rawShifts: any[];
    objectives: any[];
    now: Date;
};

export const OperacionesMonitorReactContext = createContext<OperacionesMonitorShared | null>(null);

export function useOperacionesMonitorContext(): OperacionesMonitorShared | null {
    return useContext(OperacionesMonitorReactContext);
}

/** Suscripciones Firestore + procesamiento + automatismos (una instancia por provider). */
export function useOperacionesMonitorCore({ enabled = true }: { enabled?: boolean } = {}): OperacionesMonitorShared {
    const [now, setNow] = useState(new Date());
    const [rawShifts, setRawShifts] = useState<any[]>([]);
    // RFZ/TURA se guardan con startTime/endTime como string ISO (no Timestamp), por lo que el
    // listener principal de `turnos` (que filtra por rango Timestamp) NO los devuelve. Se traen
    // en un listener aparte filtrando por `code` y se mergean en mergedRawShifts.
    const [rawRefuerzos, setRawRefuerzos] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [objectives, setObjectives] = useState<any[]>([]);
    const [servicesSLA, setServicesSLA] = useState<any[]>([]);
    const [recentLogs, setRecentLogs] = useState<any[]>([]);
    const [operatorInfo, setOperatorInfo] = useState<{ name: string; startTime: Date | null }>({ name: 'Operador', startTime: null });
    const [publishStatusMap, setPublishStatusMap] = useState<Record<string, boolean>>({});
    // isReady: true cuando los 3 listeners críticos (turnos, empleados, objetivos) recibieron su primer snapshot
    // isStable: true cuando processedData no cambió por 700ms después de isReady (evita ver actualizaciones intermedias)
    const [isReady, setIsReady] = useState(false);
    const [isStable, setIsStable] = useState(false);
    const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readyFlags = useRef({ shifts: false, employees: false, objectives: false });
    const checkReady = () => {
        if (readyFlags.current.shifts && readyFlags.current.employees && readyFlags.current.objectives) {
            setIsReady(true);
        }
    };
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

    // Fuerza re-suscripción de listeners al volver de background o reconectar red.
    // El intervalo periódico fue eliminado: Firestore gestiona la reconexión internamente
    // y el onError del listener de turnos ya llama setRefreshKey ante fallos de red.
    const [refreshKey, setRefreshKey] = useState(0);
    useEffect(() => {
        if (!enabled) return;
        const bump = () => setRefreshKey(k => k + 1);
        const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', bump);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', bump);
        };
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        setNow(new Date());
        const t = setInterval(() => setNow(new Date()), 30000);
        return () => clearInterval(t);
    }, [enabled]);

    // SUSCRIPCIONES
    useEffect(() => {
        if (!enabled || !empresaId || empresa === null) return; // esperar a que cargue el doc de empresa (migracionCompleta puede cambiar)
        const auth = getAuth();
        if (auth.currentUser) setOperatorInfo({ name: auth.currentUser.email?.split('@')[0] || 'Op', startTime: new Date() });
        const unsubs: Function[] = [];

        const mapEmps = (docs: any[]) => docs.map(d => ({ id: d.id, fullName: `${d.data().lastName} ${d.data().firstName}`, ...d.data() }));
        const empQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(empQ, snap => {
            const docs = snap.docs.filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta));
            setEmployees(mapEmps(docs));
            readyFlags.current.employees = true; checkReady();
        }));

        const buildObjectives = (docs: any[]) => { const objs: any[] = []; docs.forEach(d => { const data = d.data(); if (data.objetivos) data.objetivos.forEach((o: any) => objs.push({ ...o, clientName: data.name, clientId: d.id })); else objs.push({ id: d.id, name: data.name, clientName: data.name, clientId: d.id }); }); return objs; };
        const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(clientsQ, snap => {
            const docs = snap.docs.filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta));
            setObjectives(buildObjectives(docs));
            readyFlags.current.objectives = true; checkReady();
        }));

        const svcQ = query(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa), where('status', '==', 'active'));
        unsubs.push(onSnapshot(svcQ, snap => {
            const rows = snap.docs
                .map(d => ({ id: d.id, ...d.data() } as { id: string; empresaId?: unknown }))
                .filter(r => belongsToEmpresaView(r, empresaId, migracionCompleta));
            setServicesSLA(rows);
        }));
        const planifQ = empresaCollectionQuery('planificacion_estados', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(planifQ, snap => {
            const map: Record<string, boolean> = {};
            snap.docs.forEach(d => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                const data = d.data() as Record<string, unknown>;
                // Solo considerar publicado si el doc tiene publishedAt (un borrador o despublicado no lo tiene)
                if (!data.publishedAt) return;
                const parsed = parsePlanificacionEstadoDocId(d.id);
                if (parsed) {
                    registerPublishedState(map, parsed.objectiveId, parsed.year, parsed.month);
                }
                const objId = String(data.objectiveId ?? data.objetivoId ?? parsed?.objectiveId ?? '').trim();
                const y = Number(data.year ?? data.año ?? parsed?.year);
                const m = Number(data.month ?? data.mes ?? parsed?.month);
                if (objId) registerPublishedState(map, objId, y, m);
            });
            setPublishStatusMap(map);
        }));
        const startLog = new Date(); startLog.setDate(startLog.getDate() - 2);
        unsubs.push(onSnapshot(buildAuditLogsRecentQuery(empresaId, scopeEmpresa, { since: startLog, limit: 120 }), (snap) => {
            setRecentLogs(sortAuditLogRows(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        ...data,
                        timestamp: auditLogTimestampMs(data) || Date.now(),
                        formattedActor: data.actorName,
                        time: getSafeDate(data.timestamp),
                        fullDetail: data.details,
                        objectiveId: data.objectiveId || '',
                        objectiveName: data.objectiveName || '',
                        employeeId: data.employeeId || '',
                        employeeName: data.employeeName || '',
                        shiftId: data.shiftId || '',
                        module: data.module || 'OPERACIONES',
                        actorUid: data.actorUid || data.uid || '',
                    };
                }), 200));
        }));
        return () => { unsubs.forEach(u => u()); };
    }, [enabled, empresaId, empresa, migracionCompleta, scopeEmpresa, refreshKey]);

    useEffect(() => {
        if (!enabled || !empresaId || empresa === null) return; // esperar a que cargue el doc de empresa
        const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(12,0,0,0); // ayer al mediodía — cubre turnos nocturnos que arrancan a las 22-23hs
        const end = new Date(); end.setDate(end.getDate() + 1); end.setHours(23,59,59,999);   // mañana al final — cubre planificación del día siguiente
        const turnosBase = query(
            empresaCollectionQuery('turnos', empresaId, scopeEmpresa),
            where('startTime', '>=', Timestamp.fromDate(start)),
            where('startTime', '<=', Timestamp.fromDate(end)),
        );
        const unsub = onSnapshot(turnosBase, (snap) => {
            setRawShifts(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => ({ id: d.id, ...d.data(), shiftDateObj: getSafeDate(d.data().startTime), endDateObj: getSafeDate(d.data().endTime) })));
            readyFlags.current.shifts = true; checkReady();
        }, (err) => {
            logOpsListenerWarn('useOperacionesMonitor.turnos', err);
            setRefreshKey(k => k + 1);
        });

        // Refuerzos (RFZ) y turnos agregados (TURA): startTime/endTime son string ISO, así que el
        // rango Timestamp del listener principal los excluye. Listener aparte por `code`.
        // Con scopeEmpresa=true agrega empresaId para reducir lecturas (requiere índice compuesto
        // en Firestore: empresaId ASC, code ASC — crear desde la consola si aparece el error de índice).
        const startMs = start.getTime();
        const endMs = end.getTime();
        const refuerzosQ = scopeEmpresa
            ? query(empresaCollectionQuery('turnos', empresaId, true), where('code', 'in', ['RFZ', 'TURA']))
            : query(collection(db, 'turnos'), where('code', 'in', ['RFZ', 'TURA']));
        const unsubRfz = onSnapshot(refuerzosQ, (snap) => {
            setRawRefuerzos(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .filter(d => d.data().isDeleted !== true)
                .map(d => ({ id: d.id, ...d.data(), shiftDateObj: getSafeDate(d.data().startTime), endDateObj: getSafeDate(d.data().endTime) }))
                .filter((s: any) => {
                    const t = s.shiftDateObj instanceof Date ? s.shiftDateObj.getTime() : NaN;
                    return !isNaN(t) && t >= startMs && t <= endMs;
                }));
        }, (err) => {
            logOpsListenerWarn('useOperacionesMonitor.refuerzos', err);
        });

        return () => { unsub(); unsubRfz(); };
    }, [enabled, empresaId, empresa, migracionCompleta, scopeEmpresa, refreshKey]);

    // Unifica turnos regulares (Timestamp) + refuerzos RFZ/TURA (string ISO). Dedup por id.
    const mergedRawShifts = useMemo(() => {
        const map = new Map<string, any>();
        rawShifts.forEach(s => map.set(s.id, s));
        rawRefuerzos.forEach(s => { if (!map.has(s.id)) map.set(s.id, s); });
        return Array.from(map.values())
            .filter((s) => s.isDeleted !== true)
            .map((s) => sanitizeOpsShiftDates(s));
    }, [rawShifts, rawRefuerzos]);

    const uniqueClients = useMemo(() => { const map = new Map(); objectives.forEach(obj => map.set(obj.clientId, obj.clientName)); return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [objectives]);

    const processedData = useMemo(() => {
        if (!enabled) return EMPTY_PROCESSED_DATA;
        const currentTime = new Date(now.getTime());
        const yearMonth = `${now.getFullYear()}_${now.getMonth() + 1}`;
        const empMap = new Map(); employees.forEach(e => empMap.set(e.id, e.fullName));
        const empPhoneMap = new Map(); employees.forEach(e => empPhoneMap.set(e.id, e.phone || e.celular || ''));
        // Los objetivos usan "objectiveId" como ID, no "id" — mapear ambos para compatibilidad
        const objMap = new Map();
        objectives.forEach(o => {
            const key = o.id || o.objectiveId;
            if (key) objMap.set(key, { clientName: o.clientName, name: o.name, clientId: o.clientId });
        });
        // Filtrar SLAs por empresa usando clientId como fallback para docs legacy sin empresaId
        const clientIds = new Set(objectives.map((o: any) => o.clientId).filter(Boolean));
        const empresaSlas = filterSlaRowsByEmpresa(servicesSLA, empresaId, scopeEmpresa, clientIds);
        // Un SLA vigente por objetivo (evita vacantes duplicadas si hay varios contratos activos)
        const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
        const filteredSLA = pickVigenteSlasForPeriod(empresaSlas as any, dayStart, dayEnd) as typeof servicesSLA;
        const activeSlaMap = new Set(filteredSLA.map((s: any) => s.objectiveId));

        const suppressedTuraIds = new Set<string>();
        const parentTuraExt = new Map<string, { turaId: string; endDateObj: Date; tura: any }>();
        mergedRawShifts.forEach((row) => {
            const code = String(row.code || row.type || '').toUpperCase();
            if (code !== 'TURA') return;
            const parent = findParentShiftForTura(row, mergedRawShifts);
            if (!parent?.id) return;
            const parentKey = String(parent.id);
            const contiguous = row.turaContiguous === true
                || (row.turaContiguous !== false && isTuraContiguousToParent(parent, row));
            if (contiguous && row.endDateObj instanceof Date) {
                suppressedTuraIds.add(row.id);
                parentTuraExt.set(parentKey, { turaId: row.id, endDateObj: row.endDateObj, tura: row });
            }
        });

        const realShifts = mergedRawShifts.map(shift => {
            if (!shift.shiftDateObj) return null;
            if (shift.draft === true) return null;
            if (suppressedTuraIds.has(shift.id)) return null;
            // COVERED: solo descartar si es una vacante real (employeeId=VACANTE)
            // Si es una ausencia, mantener en processedData para tracking RRHH
            if (shift.status === 'COVERED' && !shift.isAbsent && (!shift.employeeId || shift.employeeId === 'VACANTE')) return null;
            const shiftCodeUpper = String(shift.code || shift.type || '').toUpperCase();
            const isFranco = isRestFrancoShift({ ...shift, code: shiftCodeUpper });
            const rawPos = (shift.positionName || shift.coversPositionName || '').trim();
            const isOpsCoverageRow = shift.isFrancoTrabajado === true
                || String(shift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE'
                || String(shift.resolvedBy || '').toUpperCase() === 'MODO_DEMO'
                || String(shift.resolvedBy || '').toUpperCase() === 'OPERACIONES'
                || String(shift.resolvedBy || '').toUpperCase() === 'AUTO';
            // No dropear FT/cobertura Ops aunque el puesto venga vacío/General (bug típico del FT front viejo).
            if ((!rawPos || rawPos === 'Sin Puesto' || rawPos === 'General') && !isFranco && !isOpsCoverageRow) return null;
            const displayPos = isFranco && (rawPos === 'General' || !rawPos)
                ? 'Franco'
                : (rawPos || shift.coversPositionName || 'Cobertura');

            // Solo mostrar turnos de objetivos con planificación publicada.
            // Excepción: turnos operativos (RETEN/OPERATIONS_COVERAGE/SLA_VIRTUAL/EVENTO) siempre visibles
            // porque no tienen doc en planificacion_estados.
            const isClientRefuerzoPlanificado = shift.origin === 'CLIENT_REQUEST'
                && (shiftCodeUpper === 'RFZ' || shiftCodeUpper === 'TURA');
            const isOperationalOrigin = isOperationalOriginShift(shift)
                || (shift.origin === 'CLIENT_REQUEST' && !isClientRefuerzoPlanificado)
                || shift.origin === 'EVENTO'
                || shift.eventoId;
            if (!isOperationalOrigin) {
                const shiftDate = shift.shiftDateObj!;
                const pubKey = planificacionPublishLookupKey(
                    shift.objectiveId,
                    shiftDate.getFullYear(),
                    shiftDate.getMonth() + 1,
                );
                if (!publishStatusMap[pubKey]) return null;
            }

            let info = objMap.get(shift.objectiveId);
            let finalClient = (info?.clientName) || shift.clientName || '';
            let finalObj = (info?.name) || shift.objectiveName || '';
            let finalEmpName = shift.employeeName;
            
            let isValidEmployee = false;
            const parentEmpleadoId = String(shift.parentEmpleadoId || '').trim();
            const effectiveEmployeeId = (shift.employeeId && shift.employeeId !== 'VACANTE')
                ? shift.employeeId
                : (parentEmpleadoId || null);

            if (effectiveEmployeeId && effectiveEmployeeId !== 'VACANTE') {
                const foundName = empMap.get(effectiveEmployeeId);
                if (foundName) finalEmpName = foundName;
                else if (shift.parentEmpleadoName && parentEmpleadoId) finalEmpName = shift.parentEmpleadoName;
                isValidEmployee = true; 
            } else { finalEmpName = 'VACANTE'; }

            const hasActiveSLA = activeSlaMap.has(shift.objectiveId);
            // isCustomPost: puesto custom (no 24h) → se auto-cierra al fin del turno sin retención
            const slaRowForPos = filteredSLA.find((sv: any) => sv.objectiveId === shift.objectiveId);
            const posRowForPos = slaRowForPos?.positions?.find((p: any) => normPosName(p.name) === normPosName(rawPos));
            const _posCV = String(posRowForPos?.coverageType || '').toLowerCase();
            const isCustomPost = !!_posCV && _posCV !== '24hs' && _posCV !== '24' && _posCV !== '24h';
            const isAbsent = !!shift.isAbsent;
            // isPresent solo si el turno arranca dentro de los próximos 60 min O ya inició
            // Evita el bug de turnos con isPresent=true que en realidad no empiezan en horas
            const isEarlyStartShift = shift.isEarlyStart === true || shift.isReten === true
                || shift.origin === 'RETEN' || shift.origin === 'OPERATIONS_COVERAGE';
            const shiftStartMs = shift.shiftDateObj ? shift.shiftDateObj.getTime() : 0;
            // withinWindow: extendido a 4h para no ocultar guardias que marcan entrada anticipada.
            // Antes era 60 min y causaba que guardias presentes "desaparecieran" al refrescar.
            // Solo oculta isPresent=true si el turno empieza en más de 4h (claramente dato incorrecto).
            const withinWindow = !shiftStartMs || isEarlyStartShift
                || (currentTime.getTime() + 4 * 60 * 60 * 1000) >= shiftStartMs;
            const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent && withinWindow;
            const isCompleted = !!shift.isCompleted;
            
            const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
            const isResolvedByOps = shift.origin === 'OPERATIONS_COVERAGE' || shift.resolvedBy === 'OPERACIONES';
            // countsForCoverage se calcula después de isPotentialAbsence (línea ~332)
            // para excluir guardias que no llegaron aunque isAbsent=false en Firestore

            const isUnassigned = !isValidEmployee;
            const shiftCode = String(shift.code || shift.type || '').toUpperCase();
            // Vacantes reales generadas operativamente (por ausencia detectada, corrección de plan, eventos, interrupción, etc.)
            const isRealOperativeVacancy = isUnassigned && (
                shift.origin === 'VACANTE_POR_AUSENCIA' ||
                shift.origin === 'VACANTE_CORRECCION' ||
                shift.origin === 'VACANTE_POR_EVENTO' ||
                shift.origin === 'INTERRUPTION' ||
                shift.origin === 'VACANTE_OPERATIVA' ||
                shift.vacancyOrigin === 'ABSENCE' ||
                !!shift.causedByShiftId ||
                !!shift.causedByEmployeeId
            );

            // RFZ publicado sin guardia = refuerzo por ausencia pendiente de asignar en Planificación
            const isRfzVacante = shiftCode === 'RFZ' && isUnassigned;
            const isTuraVacante = shiftCode === 'TURA' && isUnassigned && !parentEmpleadoId;
            if (isRfzVacante) finalEmpName = 'VACANTE: RFZ';
            if (isTuraVacante) {
                finalEmpName = shift.parentEmpleadoName
                    ? `TURA · ${shift.parentEmpleadoName}`
                    : 'VACANTE: TURA';
            }
            if (isRealOperativeVacancy && shift.causedByEmployeeName) {
                finalEmpName = `VACANTE · ${shift.causedByEmployeeName}`;
            }
            // isOperationalVacancy: usado para la generación de vacantes virtuales y deduplicación.
            // Display VAC / mapa rojo: solo isActionableOpsVacancy (no DEVUELTO ni >55%/fin).
            const isOperationalVacancy = isUnassigned && !isReportedToPlanning;

            const isSinCobertura = !!shift.isSinCobertura;
            // Descartar docs reales vacantes no-devueltos EXCEPTO autosinc_ SIN COBERTURA, RFZ, TURA (2º tramo cortado) y vacantes operativas reales
            if (isUnassigned && !isReportedToPlanning && !isSinCobertura && !isRfzVacante && !isTuraVacante && !isRealOperativeVacancy) return null;

            const turaExt = parentTuraExt.get(shift.id);
            const effectiveEndDateObj = (turaExt?.endDateObj instanceof Date ? turaExt.endDateObj : shift.endDateObj) as Date | undefined;
            const isDescubierto = isUnassigned && (
                isSinCobertura ||
                (() => {
                    const ratio = getVacancyElapsedRatio(
                        { shiftDateObj: shift.shiftDateObj, endDateObj: effectiveEndDateObj || shift.endDateObj },
                        currentTime,
                    );
                    return ratio != null && ratio >= VACANCY_DESCUBIERTO_RATIO;
                })()
            );

            const isEarlyStartScheduled = !!shift.isEarlyStart;
            const isPlannedSplitSegment = !!shift.coveragePackageId && (shift.coverageSegmentRole === 'EXTENSION' || shift.coverageSegmentRole === 'EARLY_START');
            const isPlannedLiberationRet = String(shift.code || '').toUpperCase() === 'RET'
                && (shift.coverageSegmentRole === 'LIBERATED' || !!shift.liberationReason);
            const plannedOperativelyCovered = !!shift.operacionallyCovered
                || (shift.coverageStatus === 'COVERED' && (shift.coverageSegmentRole === 'TARGET' || isAbsent))
                || (!!shift.coveredBy && shift.coverageStatus === 'COVERED' && (isAbsent || shift.coverageSegmentRole === 'TARGET'));
            const isEarlyStart = isEarlyStartScheduled && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco;
            const isConvocado = !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco &&
                (isEarlyStart || isPlannedLiberationRet || shift.origin === 'RETEN' || !!shift.isReten || shift.origin === 'OPERATIONS_COVERAGE');
            const extSegStart = (shift.coverageSegmentRole === 'EXTENSION' && shift.segmentFromTime)
                ? createDateFromTime(shift.segmentFromTime, shift.shiftDateObj)
                : null;
            const isPlannedExtensionImminent = !!shift.isExtended && shift.coverageSegmentRole === 'EXTENSION'
                && extSegStart && ((extSegStart.getTime() - currentTime.getTime()) / 60000) <= 15;

            let minutesUntilStart = (shift.shiftDateObj.getTime() - currentTime.getTime()) / 60000;
            // CONVOCADO: solo es accionable (PRIORIDAD) cuando está a ≤15 min o ya inició.
            // Si falta más tiempo, va a PLAN como cualquier turno futuro.
            const isAwaitingCoverageCheckIn = isConvocado && minutesUntilStart <= 15;
            if (isAwaitingCoverageCheckIn) minutesUntilStart = Math.min(minutesUntilStart, 0);
            let retentionMinutes = 0;
            // isRetention: por tiempo (pasó el horario) O por campo Firestore (retenido manualmente/automáticamente)
            const isRetentionByTime  = isPresent && !isCompleted && effectiveEndDateObj && currentTime > effectiveEndDateObj;
            // isRetentionByField: solo mostrar RECARGO si el turno ya terminó O si el operador
            // lo retuvo manualmente Y el turno ya pasó. Si el turno aún está vigente, el badge
            // se mostrará como "ATENCIÓN" pero no como retención activa hasta que pase el endTime.
            const shiftEnded = effectiveEndDateObj ? currentTime > effectiveEndDateObj : false;
            const isRetentionByField = isPresent && !isCompleted && shift.isRetention === true && shiftEnded;
            const isPendingRetention = isPresent && !isCompleted && shift.isRetention === true && !shiftEnded;
            const isRetention = isRetentionByTime || isRetentionByField;
            if (isRetentionByTime && effectiveEndDateObj) {
                retentionMinutes = Math.floor((currentTime.getTime() - effectiveEndDateObj.getTime()) / 60000);
            } else if (isRetentionByField && shift.autoRetentionAt?.seconds) {
                retentionMinutes = Math.floor((currentTime.getTime() - shift.autoRetentionAt.seconds * 1000) / 60000);
            }
            // totalMinutesWorked / ACTIVO: no contar desde 00:00 placeholder
            const rawCheckInMs = shift.realStartTime?.seconds
                ? shift.realStartTime.seconds * 1000
                : shift.checkInTime?.seconds
                    ? shift.checkInTime.seconds * 1000
                    : shift.presentAt?.seconds
                        ? shift.presentAt.seconds * 1000
                        : 0;
            const checkInLooksPlaceholder = (() => {
                if (!rawCheckInMs) return true;
                if (!shift.opsBandSanitized) return false;
                const d = new Date(rawCheckInMs);
                return d.getHours() === 0 && d.getMinutes() === 0;
            })();
            const checkInMs = (!checkInLooksPlaceholder && rawCheckInMs > 0)
                ? rawCheckInMs
                : (shift.opsBandSanitized ? 0 : (shift.shiftDateObj?.getTime?.() ?? 0));
            const totalMinutesWorked = checkInMs > 0 ? Math.floor((currentTime.getTime() - checkInMs) / 60000) : 0;
            const activeStartTime: Date | null = isPresent
                ? (checkInMs > 0 ? new Date(checkInMs) : null)
                : null;
            
            // ── Novedad RRHH: turno marcado por replicarAusenciaEnPlanificador ─────
            // absenceCreatedAt es ISO string guardado en el turno original al momento de
            // cargar la novedad en RRHH. Calculamos la anticipación respecto al inicio del turno.
            const hasRRHHNovedad = !!shift.hasNovedad && !!shift.absenceId && !shift.isFranco && shift.type !== 'NOVEDAD';
            const rrhhAnticipacionMinutes: number | null = (() => {
                if (!hasRRHHNovedad || !shift.absenceCreatedAt || !shift.shiftDateObj) return null;
                const createdAt = new Date(shift.absenceCreatedAt).getTime();
                return Math.round((shift.shiftDateObj.getTime() - createdAt) / 60000);
            })();
            // ≥720 min (12hs) → Planning puede actuar; <720 → Operaciones debe resolver
            const isRRHHPlanned = hasRRHHNovedad && rrhhAnticipacionMinutes !== null && rrhhAnticipacionMinutes >= 720;
            const isRRHHUrgent  = hasRRHHNovedad && rrhhAnticipacionMinutes !== null && rrhhAnticipacionMinutes < 720;

            // Solo RET = stand-by pasivo: no ficha ni genera ausencia/tardanza hasta convertirse al turno real.
            // ESC/REF van al puesto, fichan y pueden salir ACTIVO / ausente / tarde.
            const isPassiveStandby =
                (shiftCode === 'RET' || !!shift.isReten)
                && String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE';

            const isImminent = !isPassiveStandby && !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && !hasRRHHNovedad && minutesUntilStart <= 15 && minutesUntilStart > -5;
            const isFuture = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && !hasRRHHNovedad && minutesUntilStart > 15;
            const minutesPastStart = -minutesUntilStart;
            // Guardia tardanza: ventana T+5 → T+60 (sin novedad RRHH)
            const isLateNotified = !isPassiveStandby && !!(shift.lateArrivalAt) && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && !hasRRHHNovedad && minutesPastStart > 5 && minutesPastStart <= 30;
            const isLateUnnotified = !isPassiveStandby && !shift.lateArrivalAt && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && !hasRRHHNovedad && minutesPastStart > 5 && minutesPastStart <= 30;
            const minutesRemainingLate = isLateNotified ? Math.max(0, Math.round(30 - minutesPastStart)) : null;
            // Potencial ausencia: T+30 sin confirmar presencia — fallback si el cron no alcanzó a correr
            const isPotentialAbsence = !isPassiveStandby && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && !hasRRHHNovedad && minutesPastStart > 30;

            // Un ausente (confirmado o potencial) NO cubre el puesto — el slot queda descubierto y genera vacante
            // ⚠️ DEBE ir después de isPotentialAbsence para poder usarlo en la condición
            // isReportedToPlanning solo cuenta como cobertura cuando el turno es VACANTE NO-ASIGNADO reportado
            // MANUALMENTE por el operador (no si fue auto-notificación del sistema).
            // Los turnos origin==='SLA_VIRTUAL' son solo notificaciones hacia planificación:
            // el puesto sigue descubierto y NO cuentan como cobertura real.
            const isAutoNotification = shift.origin === 'SLA_VIRTUAL';
            // isSinCobertura / descubierto NO cuentan como cobertura real ni como VAC accionable.
            const countsForCoverage = !isAutoNotification && (
                (isValidEmployee && !isAbsent && !isPotentialAbsence && !hasRRHHNovedad) ||
                (isReportedToPlanning && !isValidEmployee) ||
                (isPlannedSplitSegment && !isAbsent && !isPotentialAbsence)
            );

            const phone = empPhoneMap.get(effectiveEmployeeId || shift.employeeId) || shift.phone || shift.celular || '';

            const isTuraCutSegment = shiftCode === 'TURA' && !suppressedTuraIds.has(shift.id)
                && (!!shift.parentShiftId || !!parentEmpleadoId);

            return {
                ...shift, employeeName: finalEmpName, clientName: finalClient, objectiveName: finalObj, positionName: displayPos,
                phone,
                employeeId: effectiveEmployeeId || shift.employeeId,
                isValidEmployee, isUnassigned, isPresent, isCompleted, isAbsent, isPotentialAbsence,
                isPassiveStandby,
                isLateNotified, isLateUnnotified, minutesRemainingLate,
                isReportedToPlanning, isOperationalVacancy, isResolvedByOps, isRetention, isPendingRetention, isFranco, isImminent, isFuture,
                isEarlyStart, isAwaitingCoverageCheckIn, isConvocado,
                isPlannedSplitSegment, isPlannedLiberationRet, isPlannedExtensionImminent, plannedOperativelyCovered,
                hasRRHHNovedad, isRRHHPlanned, isRRHHUrgent, rrhhAnticipacionMinutes,
                minutesUntilStart, minutesPastStart, retentionMinutes, totalMinutesWorked, activeStartTime, hasActiveSLA, isCustomPost,
                duration: getDuration(shift.shiftDateObj, effectiveEndDateObj),
                endDateObj: effectiveEndDateObj || shift.endDateObj,
                countsForCoverage, isRetentionByField, isSinCobertura, isDescubierto,
                isRfzVacante, isTuraVacante, isTuraCutSegment,
                turaRequiresSeparateCheckIn: isTuraCutSegment,
                isRefuerzoCliente: shiftCode === 'RFZ' || shiftCode === 'TURA',
                ...(turaExt ? {
                    linkedTuraId: turaExt.turaId,
                    turaContiguous: true,
                    turaImputationPos: turaExt.tura.positionName,
                    turaExtensionRange: combinedContiguousRangeLabel(shift, turaExt.tura),
                } : {}),
                vacancyOrigin: isRfzVacante ? 'ABSENCE' : (isRealOperativeVacancy ? (shift.vacancyOrigin || 'ABSENCE') : shift.vacancyOrigin),
                isRealOperativeVacancy,
                operacionallyCovered: plannedOperativelyCovered || !!shift.operacionallyCovered,
            };
        }).filter(Boolean);

        const virtualVacancies: any[] = [];
        const dayCode = getDayCode(now);

        filteredSLA.forEach(sla => {
            const objInfo = objMap.get(sla.objectiveId);
            if (!objInfo || !sla.positions) return;

            // Respetar rango de fechas del servicio: no generar vacantes antes de startDate ni después de endDate
            if (sla.startDate) {
                const serviceStart = new Date(sla.startDate + 'T00:00:00');
                if (now < serviceStart) return;
            }
            if (sla.endDate) {
                const serviceEnd = new Date(sla.endDate + 'T23:59:59');
                if (now > serviceEnd) return;
            }

            // Sin cronograma publicado para este objetivo/mes → el servicio aún no entró en operación.
            // No generar vacantes hasta que planificación publique el crono.
            const nowYear = now.getFullYear();
            const nowMonth = now.getMonth() + 1;
            if (!publishStatusMap[planificacionPublishLookupKey(sla.objectiveId, nowYear, nowMonth)]) return;

            // Vacantes "virtuales" = huecos del SLA vs turnos reales. Si no hay ningún documento
            // en `turnos` para este objetivo hoy (p. ej. base vaciada o aún sin planificar),
            // no generar tarjetas fantasma: el contador de vacantes reflejaba solo SLA activo.
            const hasRawShiftTodayForObjective = mergedRawShifts.some((s: any) => {
                if (!s.objectiveId || s.objectiveId !== sla.objectiveId) return false;
                const d = s.shiftDateObj || getSafeDate(s.startTime);
                return d && isSameDay(d, now);
            });
            if (!hasRawShiftTodayForObjective) return;

            const objShifts = realShifts.filter(s => {
                if (!isSameDay(s.shiftDateObj, now)) return false;
                if (s.objectiveId !== sla.objectiveId) return false;
                if (s.isFranco) return false;
                return true;
            });

            sla.positions.forEach((pos: any) => {
                if (pos.activeDays && Array.isArray(pos.activeDays) && pos.activeDays.length > 0) {
                    if (!pos.activeDays.includes(dayCode)) return;
                }

                const allowedShifts = pos.allowedShiftTypes || [];
                const targetPosName = normalizePosMatch(pos.name);
                // TODOS los turnos del puesto (incluye ausentes) — para saber si "opera hoy"
                const allPosShifts = objShifts.filter((s: any) => {
                    const sPos = normalizePosMatch(s.positionName);
                    return sPos === targetPosName || (sPos === 'general' && targetPosName === 'guardia');
                });
                // Solo los que cuentan como cobertura real (excluye ausentes)
                const posShifts = allPosShifts.filter((s: any) => s.countsForCoverage);

                // Detectar esquema real del día por CÓDIGO y por duración real (08–16 = 8h).
                // Un T/M/N con timestamps 00:00→+24h NO debe activar ciclo DIURNO/NOCTURNO 12H.
                const plannedCodes = allPosShifts
                    .map((s: any) => String(s.code || s.type || '').toUpperCase())
                    .filter(Boolean);
                const hasPlanned12Code = plannedCodes.some((c) => c === 'D12' || c === 'N12');
                const hasPlanned8Code = plannedCodes.some((c) => c === 'M' || c === 'T' || c === 'N');
                // Patrón operativo corto (ej. 08:00–16:00) aunque el código no sea M/T/N
                const shortBandShifts = allPosShifts.filter((s: any) => {
                    const d = Number(s.duration) || 0;
                    return d >= 6 && d <= 10;
                });
                const hasShortBandPattern = shortBandShifts.length >= Math.max(1, Math.ceil(allPosShifts.length * 0.4));
                const hasReal12hDuration = allPosShifts.some((s: any) => {
                    const code = String(s.code || s.type || '').toUpperCase();
                    if (code === 'M' || code === 'T' || code === 'N') return false;
                    const d = Number(s.duration) || 0;
                    if (d >= 6 && d <= 10) return false;
                    const storedH = Number(s.hours);
                    if (storedH > 10 && storedH <= 16) return true;
                    return d > 10 && d <= 16;
                });
                let relevantDefinitions = allowedShifts;
                let skipSlaVirtuals = false;
                if (hasPlanned12Code && !hasPlanned8Code && !hasShortBandPattern) {
                    relevantDefinitions = allowedShifts.filter((d: any) => (d.hours || 8) > 10);
                } else if ((hasPlanned8Code || hasShortBandPattern) && !hasPlanned12Code) {
                    // Cronograma 8h (M/T/N o 08–16): no inventar DIURNO/NOCTURNO 12H del SLA
                    const shortSlots = allowedShifts.filter((d: any) => (d.hours || 8) <= 10);
                    if (shortSlots.length > 0) {
                        relevantDefinitions = shortSlots;
                    } else {
                        // SLA solo declara 12h pero el día opera en bandas cortas → no generar virtuales
                        relevantDefinitions = [];
                        skipSlaVirtuals = true;
                    }
                } else if (hasReal12hDuration && allowedShifts.length > 0) {
                    relevantDefinitions = allowedShifts.filter((d: any) => (d.hours || 8) > 10);
                } else if (allowedShifts.length > 0) {
                    relevantDefinitions = allowedShifts.filter((d: any) => (d.hours || 8) < 12);
                }

                // 🛑 UNIFICACIÓN V124:
                // Si 'relevantDefinitions' TIENE DATOS, usamos lógica de SLOT (Checklist) incluso para 24HS.
                // Esto evita el problema de los huecos partidos.
                
                if (relevantDefinitions.length > 0) {
                    // Gap 5: origen de la vacante por slot
                    const slotVacancyOrigin = allPosShifts.some((s: any) => s.hasRRHHNovedad)
                        ? 'RRHH_NOVEDAD'
                        : allPosShifts.some((s: any) => s.isAbsent || s.isPotentialAbsence)
                            ? 'ABSENCE'
                            : 'NO_PLANNING';

                    const requiredCount = Math.max(1, Number(pos.quantity) || Number(pos.qty) || 1);

                    // Misma lógica que el pie 6/6 de Planificación: si el día ya cerró el
                    // esquema del puesto (M+T+N × qty), no inventar SIN PLANIFICAR.
                    const codeCounts: Record<string, number> = {};
                    for (const s of posShifts) {
                        const c = String(s.code || s.type || '').toUpperCase();
                        if (!c || c === 'VACANTE') continue;
                        codeCounts[c] = (codeCounts[c] || 0) + 1;
                    }
                    const posShiftsForUnits = (Array.isArray(pos.shifts) && pos.shifts.length > 0)
                        ? pos.shifts
                        : allowedShifts;
                    const dayUnits = countPositionClosedUnitsFromShifts(
                        {
                            positionName: pos.name,
                            qty: requiredCount,
                            coverageType: pos.coverageType || (posShiftsForUnits.length ? undefined : 'custom'),
                            shifts: posShiftsForUnits,
                            activeDays: pos.activeDays,
                        },
                        dayCode,
                        codeCounts,
                        undefined,
                        true,
                    );
                    const dayFullyCovered = dayUnits.required > 0 && dayUnits.closed >= dayUnits.required;
                    if (dayFullyCovered && slotVacancyOrigin === 'NO_PLANNING') {
                        return; // puesto completo en malla → sin vacantes fantasma
                    }

                    relevantDefinitions.forEach((slot: any) => {
                        // Respetar dias habilitados del turno (ej: RONDIN solo L-V)
                        if (slot.days && Array.isArray(slot.days) && slot.days.length > 0) {
                            if (!slot.days.includes(dayCode)) return;
                        }
                        const start = createDateFromTime(slot.startTime, now);
                        let end = createDateFromTime(slot.endTime, now);

                        if (start && end) {
                            if (end <= start) end = new Date(end.getTime() + 86400000);

                            const slotCode = String(slot.code || '').toUpperCase();
                            // Solape horario O match por código de banda (evita falso hueco si
                            // el SLA declara 14–22 y la malla tiene T 16–00).
                            const coveredByTime = posShifts.filter((s: any) =>
                                shiftCoversVacancySlot(s, start, end, pos.name)
                            ).length;
                            const coveredByCode = slotCode
                                ? posShifts.filter((s: any) => {
                                    const c = String(s.code || s.type || '').toUpperCase();
                                    return c === slotCode;
                                }).length
                                : 0;
                            const coveredCount = Math.max(coveredByTime, coveredByCode);
                            const missing = Math.max(0, requiredCount - coveredCount);

                            for (let i = 0; i < missing; i++) {
                                virtualVacancies.push({
                                    id: `V124_${sla.objectiveId}_${pos.name}_${slot.code}_${i}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    vacancyOrigin: slotVacancyOrigin,
                                    vacancyBand: (slot.name || slot.code).toUpperCase(),
                                    requiredQuantity: requiredCount,
                                    slotIndex: i,
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId,
                                    positionName: pos.name,
                                    employeeName: 'VACANTE',
                                    code: slot.code,
                                    shiftDateObj: start, endDateObj: end,
                                    minutesUntilStart: 0, isValidEmployee: false
                                });
                            }
                        }
                    });
                }
                // SOLO si no hay definiciones de turnos, usamos Gaps (Fallback para objetivos legacy)
                // ⚠️  Discriminamos según tipo de turno:
                //   - 24h (3×8h o 2×12h): findTimeGaps sobre la jornada completa
                //   - Custom (franjas parciales, ej. Rondín 08-18): verificar turno por turno
                // skipSlaVirtuals: plan 8h vs SLA solo 12h → no inventar huecos fantasma
                else if (!skipSlaVirtuals) {
                    // Turnos de franco del puesto: también necesitan reemplazo.
                    // objShifts excluye franco, los buscamos directamente en realShifts.
                    const posFrancoShifts = realShifts.filter((s: any) => {
                        if (!isSameDay(s.shiftDateObj, now)) return false;
                        if (s.objectiveId !== sla.objectiveId) return false;
                        if (!s.isFranco) return false;
                        const sPos = normalizePosMatch(s.positionName);
                        return sPos === targetPosName || (sPos === 'general' && targetPosName === 'guardia');
                    });

                    // Sin turnos NI francos → el puesto realmente no opera hoy
                    if (allPosShifts.length === 0 && posFrancoShifts.length === 0) return;

                    const guardQty = pos.quantity || 1;

                    // ─── MODO 24H: usa coverageType del SLA (Gap 4) ───────────────────────
                    if (pos.coverageType === '24hs') {
                        // Detectar brechas en la jornada completa (comportamiento original correcto)
                        const coveringShifts = posShifts.filter((s: any) => s.countsForCoverage);
                        const coveredHours = coveringShifts.reduce((acc: number, s: any) => acc + s.duration, 0);
                        const targetHours = guardQty * 24;

                        if (coveredHours < targetHours) {
                            const gaps = findTimeGaps(posShifts, now);
                            gaps.forEach(gap => {
                                const h = gap.start.getHours();
                                let bestName = "COBERTURA";
                                if (h>=6 && h<14) bestName = "MAÑANA"; else if (h>=14 && h<22) bestName = "TARDE"; else bestName = "NOCHE";

                                const gap24Origin = allPosShifts.some((s: any) => s.hasRRHHNovedad) ? 'RRHH_NOVEDAD'
                                    : allPosShifts.some((s: any) => s.isAbsent || s.isPotentialAbsence) ? 'ABSENCE' : 'NO_PLANNING';
                                virtualVacancies.push({
                                    id: `V124_GAP_${sla.objectiveId}_${pos.name}_${gap.start.getTime()}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    vacancyOrigin: gap24Origin,
                                    vacancyBand: bestName,
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                    employeeName: 'VACANTE',
                                    shiftDateObj: gap.start, endDateObj: gap.end,
                                    minutesUntilStart: 0, isValidEmployee: false
                                });
                            });
                        }
                    }
                    // ─── MODO CUSTOM (franjas parciales, ej. Rondín 08-18) ────────────────
                    else {
                        // Generar vacante por déficit de cobertura en cada slot:
                        //   • Agrupar ausentes por slot temporal (mismo start+end)
                        //   • Para cada slot: max(0, guardQty - coveredOnSlot) vacantes
                        //     → respeta quantity del puesto (ej: 9 activos + 8 ausentes
                        //       con guardQty=17 → 8 vacantes; con guardQty=9 → 0 vacantes)
                        //   • Para no-asignados (isUnassigned): siempre generan vacante
                        const unassignedShifts = allPosShifts.filter((s: any) => s.isUnassigned);

                        // Agrupar ausentes Y francos por slot (mismo start+end) para calcular déficit real
                        // Franco = el puesto opera pero la persona descansa → necesita reemplazo
                        const absentSlotMap = new Map<string, any>();
                        [...allPosShifts, ...posFrancoShifts]
                            .filter((s: any) => (s.isAbsent || s.isPotentialAbsence || s.isFranco) && !s.isCompleted)
                            .forEach((s: any) => {
                                const key = `${s.shiftDateObj?.getTime?.() ?? 0}_${s.endDateObj?.getTime?.() ?? 0}`;
                                if (!absentSlotMap.has(key)) absentSlotMap.set(key, s);
                            });

                        // Para cada slot con ausentes: generar tantas vacantes como el déficit
                        absentSlotMap.forEach((refShift: any) => {
                            if (refShift.plannedOperativelyCovered || refShift.coverageStatus === 'COVERED') return;
                            const coveredOnSlot = posShifts.filter((cover: any) =>
                                shiftCoversVacancySlot(cover, refShift.shiftDateObj, refShift.endDateObj, pos.name)
                            ).length;
                            const deficit = Math.max(0, guardQty - coveredOnSlot);
                            const pkgStatus = refShift.coveragePackageId
                                ? assessPlannedPackageStatus(allPosShifts.filter((s: any) => s.coveragePackageId === refShift.coveragePackageId))
                                : 'NONE';
                            if (pkgStatus === 'COVERED') return;
                            for (let i = 0; i < deficit; i++) {
                                const startMs = refShift.shiftDateObj instanceof Date ? refShift.shiftDateObj.getTime() : Date.now();
                                const shiftId = refShift.id || `${startMs}`;
                                const custOrigin = refShift.hasRRHHNovedad ? 'RRHH_NOVEDAD' : 'ABSENCE';
                                const isPartial = pkgStatus === 'PARTIAL' || refShift.coverageStatus === 'PARTIAL';
                                virtualVacancies.push({
                                    id: `V124_CUST_${sla.objectiveId}_${pos.name}_${shiftId}_${i}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    isPartialPlannedCoverage: isPartial,
                                    vacancyOrigin: custOrigin,
                                    vacancyBand: (pos.name || 'PUESTO').toUpperCase(),
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                    employeeName: 'VACANTE',
                                    shiftDateObj: refShift.shiftDateObj, endDateObj: refShift.endDateObj,
                                    minutesUntilStart: 0, isValidEmployee: false,
                                    relatedCoveragePackageId: refShift.coveragePackageId || null,
                                });
                            }
                        });

                        // No-asignados: siempre generan vacante independientemente del quantity
                        unassignedShifts.forEach((shift: any) => {
                            const startMs = shift.shiftDateObj instanceof Date ? shift.shiftDateObj.getTime() : Date.now();
                            const shiftId = shift.id || `${startMs}`;
                            virtualVacancies.push({
                                id: `V124_CUST_${sla.objectiveId}_${pos.name}_${shiftId}`,
                                isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                vacancyOrigin: 'NO_PLANNING',
                                vacancyBand: (pos.name || 'PUESTO').toUpperCase(),
                                clientName: objInfo.clientName, clientId: objInfo.clientId,
                                objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                employeeName: 'VACANTE',
                                shiftDateObj: shift.shiftDateObj, endDateObj: shift.endDateObj,
                                minutesUntilStart: 0, isValidEmployee: false
                            });
                        });
                    }
                }
            });
        });

        // ── Deduplicar realShifts por id (evita que un doc duplicado en Firestore se muestre dos veces)
        const seenIds = new Set<string>();
        const dedupByIdShifts = realShifts.filter(s => {
            if (seenIds.has(s.id)) return false;
            seenIds.add(s.id);
            return true;
        });

        // ── Deduplicar por (employeeId, objectiveId, startTime) para eliminar turnos
        //    OPERATIONS_COVERAGE duplicados que crea la cascada al procesar la misma vacante varias veces.
        //    Preferir el turno con isPresent:true o el primero encontrado.
        const seenEmpObjTime = new Map<string, boolean>();
        const dedupedRealShifts = dedupByIdShifts.filter(s => {
            if (!s.employeeId || s.employeeId === 'VACANTE') return true; // vacantes siempre
            const startMs = s.shiftDateObj?.getTime?.() ?? 0;
            const key = `${s.employeeId}|${s.objectiveId}|${startMs}`;
            if (seenEmpObjTime.has(key)) {
                // Ya hay uno — solo reemplazar si este tiene isPresent y el anterior no
                return false;
            }
            seenEmpObjTime.set(key, !!s.isPresent);
            return true;
        });

        // ── Ocultar DEVUELTO del display: ya tuvo tratamiento (Planificación).
        //    Siguen en dedupedRealShifts para cubrir/suprimir virtuales del mismo slot.
        //    Descubiertos (>55%/fin) salen del tab VAC vía isActionableOpsVacancy; el PDF
        //    puede seguir viéndolos en processedData como isDescubierto / isSinCobertura.
        const suppressedDevuelto = new Set<string>();
        dedupedRealShifts.forEach(s => {
            if (!s.isUnassigned || !s.shiftDateObj || !s.endDateObj) return;
            if (s.isReportedToPlanning) {
                suppressedDevuelto.add(s.id);
                return;
            }
            // Vacante real por ausencia: viva solo si el slot no terminó y no hay cobertura suficiente.
            if (s.isRealOperativeVacancy && (s.status === 'UNCOVERED' || !s.status)) {
                if (s.isSinCobertura || String(s.status || '') === 'SIN_COBERTURA') {
                    suppressedDevuelto.add(s.id);
                    return;
                }
                if (s.endDateObj.getTime() < now.getTime()) {
                    suppressedDevuelto.add(s.id);
                    return;
                }
                // Si el titular ausente ya figura cubierto en AUS, el doc hermano POR AUSENCIA no es cola viva.
                if (isShiftOperativelyCovered(s)) {
                    suppressedDevuelto.add(s.id);
                    return;
                }
                const causeId = String(s.causedByShiftId || '').trim();
                if (causeId) {
                    const titular = dedupedRealShifts.find((t) => t.id === causeId);
                    if (titular && isShiftOperativelyCovered(titular)) {
                        suppressedDevuelto.add(s.id);
                        return;
                    }
                }
                const cap = getPositionCapacity(filteredSLA, s.objectiveId, s.positionName);
                if (cap > 0) {
                    const coveringCount = dedupedRealShifts.filter(cover =>
                        !cover.isUnassigned && !cover.isAbsent && !cover.isPotentialAbsence && !cover.isCompleted &&
                        !cover.isFranco &&
                        cover.objectiveId === s.objectiveId &&
                        shiftCoversVacancySlot(cover, s.shiftDateObj, s.endDateObj, s.positionName)
                    ).length;
                    if (coveringCount >= cap) {
                        suppressedDevuelto.add(s.id);
                        return;
                    }
                }
                return;
            }

            // Slot ya terminado sin doc SIN_COBERTURA: no mostrar como cola viva
            if (!s.isSinCobertura && s.endDateObj.getTime() < now.getTime()) {
                suppressedDevuelto.add(s.id);
                return;
            }

            const cap = getPositionCapacity(filteredSLA, s.objectiveId, s.positionName);
            if (cap <= 0) return;
            const coveringCount = dedupedRealShifts.filter(cover =>
                !cover.isUnassigned && !cover.isAbsent && !cover.isPotentialAbsence && !cover.isCompleted &&
                !cover.isFranco &&
                cover.objectiveId === s.objectiveId &&
                shiftCoversVacancySlot(cover, s.shiftDateObj, s.endDateObj, s.positionName)
            ).length;
            if (coveringCount >= cap) suppressedDevuelto.add(s.id);
        });
        const visibleRealShifts = dedupedRealShifts.filter(s => !suppressedDevuelto.has(s.id));

        // ── Suprimir vacantes virtuales solo si están CUBIERTAS (no suprimir por ausencias)
        // Un ausente sigue generando una vacante — la posición necesita cobertura
        const filteredVirtualVacancies = virtualVacancies.filter(v => {
            if (!v.shiftDateObj || !v.endDateObj) return true;
            // Auto-expirar: slot de un día anterior que ya terminó → no mostrar
            const vacancyIsToday = isSameDay(v.shiftDateObj, now);
            if (!vacancyIsToday && v.endDateObj.getTime() < now.getTime()) return false;
            // Descubierto (>55% o fin de turno): no regenerar virtual como VAC
            if (isVacancyDescubierto(v, now)) return false;
            // Slot real (vacante/ausente) vs virtual: solape horario — no usar shiftCoversVacancySlot
            // (ese helper exige persona asignada y no deduplicaba POR AUSENCIA vs "VACANTE · MAÑANA").
            const sameSlotWindow = (s: any) =>
                s.objectiveId === v.objectiveId &&
                vacancySlotTimeOverlaps(s, v.shiftDateObj, v.endDateObj, v.positionName);
            // Suprimir si ya hay un DEVUELTO real para este slot (el doc ya representa la vacante)
            // Solo suprimir si el doc tiene startTime cercano al slot virtual (±2h) Y aún no expiró,
            // para evitar que docs expirados o con timestamps erróneos supriman slots correctos
            if (dedupedRealShifts.some(s => s.isUnassigned && s.isReportedToPlanning &&
                s.endDateObj && s.endDateObj.getTime() > now.getTime() &&
                Math.abs((s.shiftDateObj?.getTime() || 0) - (v.shiftDateObj?.getTime() || 0)) < 7200000 &&
                sameSlotWindow(s))) return false;
            // Suprimir si ya existe el doc autosinc_ SIN COBERTURA para este slot
            if (dedupedRealShifts.some(s => s.isSinCobertura && sameSlotWindow(s))) return false;
            // Doc real VACANTE_POR_AUSENCIA / ops vacante = misma cola (no inventar "MAÑANA" encima)
            if (dedupedRealShifts.some(s => s.isOperationalVacancy && sameSlotWindow(s))) return false;
            // Ausencia del slot ya cubierta en AUS → no regenerar virtual
            if (dedupedRealShifts.some(s =>
                !s.isUnassigned && (s.isAbsent || s.isPotentialAbsence) && isShiftOperativelyCovered(s) && sameSlotWindow(s)
            )) return false;
            // Suprimir si hay guardias plan O presentes suficientes para el slot
            const cap = getPositionCapacity(filteredSLA, v.objectiveId, v.positionName);
            const coveringCount = dedupedRealShifts.filter((cover: any) =>
                !cover.isUnassigned && !cover.isAbsent && !cover.isPotentialAbsence && !cover.isCompleted &&
                !cover.isFranco &&
                cover.objectiveId === v.objectiveId &&
                shiftCoversVacancySlot(cover, v.shiftDateObj, v.endDateObj, v.positionName)
            ).length;
            if (coveringCount >= cap) return false;
            return true;
        }).map(v => ({
            ...v,
            isDescubierto: isVacancyDescubierto(v, now),
        }));

        // Deduplicar virtuales por slot (objetivo+puesto+inicio+fin+banda) por si quedó más de un SLA
        const seenVirtualSlots = new Set<string>();
        const dedupedVirtualVacancies = filteredVirtualVacancies.filter((v) => {
            const startMs = v.shiftDateObj?.getTime?.() ?? 0;
            const endMs = v.endDateObj?.getTime?.() ?? 0;
            const key = `${v.objectiveId}|${normalizePosMatch(v.positionName)}|${startMs}|${endMs}|${v.vacancyBand || ''}`;
            if (seenVirtualSlots.has(key)) return false;
            seenVirtualSlots.add(key);
            return true;
        });

        // Deduplicar vacantes reales idénticas (mismo puesto+ventana+origen) — cascada/reintentos
        const seenRealVacSlots = new Set<string>();
        const dedupedVisibleReals = visibleRealShifts.filter((s) => {
            if (!s.isUnassigned || !s.isRealOperativeVacancy) return true;
            const startMs = s.shiftDateObj?.getTime?.() ?? 0;
            const endMs = s.endDateObj?.getTime?.() ?? 0;
            const key = `${s.objectiveId}|${normalizePosMatch(s.positionName)}|${startMs}|${endMs}|${s.origin || ''}|${s.causedByShiftId || s.causedByEmployeeId || ''}`;
            if (seenRealVacSlots.has(key)) return false;
            seenRealVacSlots.add(key);
            return true;
        });

        return [...dedupedVisibleReals, ...dedupedVirtualVacancies].sort((a:any, b:any) => a.shiftDateObj - b.shiftDateObj);
    }, [enabled, mergedRawShifts, now, employees, objectives, servicesSLA, publishStatusMap]);

    const handleAction = async (action: string, shiftId: string, payload?: any) => {
        if (!enabled) return;
        try {
            if (action === 'CHECKOUT') {
                const shift = processedData.find((s: any) => s.id === shiftId);
                await updateDocForEmpresa('turnos', shiftId, {
                    status: 'COMPLETED', isCompleted: true, isPresent: false,
                    realEndTime: serverTimestamp(), checkoutNote: payload || null,
                }, empresaId, migracionCompleta);
                // Bitácora
                const actor = getAuth().currentUser?.displayName || getAuth().currentUser?.email?.split('@')[0] || 'Operador';
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'CHECKOUT',
                    module: 'OPERACIONES',
                    actorName: actor,
                    timestamp: serverTimestamp(),
                    employeeId: shift?.employeeId,
                    employeeName: shift?.employeeName,
                    objectiveId: shift?.objectiveId,
                    objectiveName: shift?.objectiveName,
                    shiftId,
                    details: `${shift?.employeeName || 'Guardia'} finalizó turno en ${shift?.objectiveName || ''}${payload ? ` — ${payload}` : ''}.`,
                }, String(shift?.empresaId || empresaId || '').trim())).catch(() => {});
                // Auto-descartar novedades de retención/recargo del turno finalizado
                getDocs(query(
                    collection(db, 'novedades'),
                    where('shiftId', '==', shiftId),
                    where('status', '==', 'pending'),
                    limit(20)
                )).then(snap => {
                    if (snap.empty) return;
                    const AUTO_DISMISS_TYPES = ['RETENCION_LARGA', 'RECARGO_12H', 'RETENCION_DETECTADA'];
                    const toUpdate = snap.docs.filter(d => AUTO_DISMISS_TYPES.includes(d.data().type));
                    if (!toUpdate.length) return;
                    const batch = writeBatch(db);
                    toUpdate.forEach(d => batch.update(d.ref, {
                        status: 'ATENDIDA',
                        atendidaAt: serverTimestamp(),
                        atendidaPor: 'AUTO_CHECKOUT',
                    }));
                    batch.commit().catch(() => {});
                }).catch(() => {});
            }
        } catch (e: any) { toast.error('Error: ' + e.message); }
    };
    // Auto-gestión de vacantes virtuales:
    //   > 4h:  auto-devolver a planificación (crear turno real + novedad)
    //   < 4h y > 0: alerta PROTOCOLO para que el operador use CUBRIR
    //   ya iniciada: alerta PROTOCOLO escalada
    const alertedVacancyIds = useRef<Set<string>>(new Set());
    const autoAbsentedIds = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!enabled) return;
        const virtualVacs = processedData.filter((s: any) => s.isVirtual && isSameDay(s.shiftDateObj, now));
        if (!virtualVacs.length) return;
        const nowMs = now.getTime();
        for (const v of virtualVacs) {
            const startMs = v.shiftDateObj?.getTime?.() ?? 0;
            if (!startMs) continue;
            const minutesUntil = (startMs - nowMs) / 60000;

            // ── PASO 1: avisar a Planificación apenas se detecta el hueco ────
            // Materializa vacante real ACCIONABLE (no DEVUELTA): Ops sigue pudiendo CUBRIR.
            // Planificación recibe novedad PENDIENTE. No esperar T-3h.
            // Ausencias: no auto-materializar (Plan ya sabe; Ops maneja cobertura).
            const autoKey = `${v.id}_VACANTE_A_PLANIFICACION`;
            if (v.vacancyOrigin !== 'ABSENCE' && !alertedVacancyIds.current.has(autoKey)) {
                alertedVacancyIds.current.add(autoKey);
                getDocs(query(collection(db, 'novedades'), where('virtualVacancyId', '==', v.id), where('type', '==', 'VACANTE_A_PLANIFICACION'), limit(1)))
                    .then(async snap => {
                        if (!snap.empty) return;
                        const shiftEmpresaId = String(v.empresaId || empresaId || '').trim();
                        const safeId = v.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
                        const newRef = doc(db, 'turnos', `autodev_${safeId}`);
                        const existingVac = await getDoc(newRef);
                        if (!existingVac.exists()) {
                            await setDoc(newRef, stampEmpresaId({
                                clientId: v.clientId, clientName: v.clientName,
                                objectiveId: v.objectiveId, objectiveName: v.objectiveName,
                                positionName: v.positionName,
                                employeeId: 'VACANTE', employeeName: 'VACANTE',
                                code: v.code || v.vacancyBand || 'T',
                                startTime: Timestamp.fromDate(v.shiftDateObj),
                                endTime: Timestamp.fromDate(v.endDateObj),
                                plannedStartTime: Timestamp.fromDate(v.shiftDateObj),
                                plannedEndTime: Timestamp.fromDate(v.endDateObj),
                                status: 'UNCOVERED',
                                isUnassigned: true,
                                isReportedToPlanning: false,
                                vacancyOrigin: v.vacancyOrigin || 'NO_PLANNING',
                                origin: 'SLA_VIRTUAL',
                                virtualVacancyId: v.id,
                                requiredQuantity: Number(v.requiredQuantity) > 0 ? Number(v.requiredQuantity) : 1,
                                slotIndex: typeof v.slotIndex === 'number' ? v.slotIndex : null,
                                createdAt: serverTimestamp(),
                                reportedBy: 'SYSTEM_AUTO',
                            }, shiftEmpresaId));
                        }
                        const cuando = minutesUntil > 0
                            ? `Faltan ${Math.round(minutesUntil)} min.`
                            : `Turno inició hace ${Math.round(Math.abs(minutesUntil))} min (sin cobertura).`;
                        const novedadRef = doc(db, 'novedades', `autodev_nov_${safeId}`);
                        await setDoc(novedadRef, stampEmpresaId({
                            type: 'VACANTE_A_PLANIFICACION', status: 'pending',
                            priority: 'high',
                            actionTarget: 'PLANIFICACION',
                            autoProcessed: true,
                            virtualVacancyId: v.id, shiftId: newRef.id,
                            objectiveId: v.objectiveId, objectiveName: v.objectiveName || '',
                            clientId: v.clientId || null, positionName: v.positionName || '',
                            title: 'Hueco sin planificar',
                            description: `[AUTO] Hueco sin planificar: ${v.positionName} en ${v.objectiveName}. ${cuando} Asignar en Planificación o cubrir en Ops.`,
                            minutesUntilStart: Math.round(minutesUntil),
                            createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                            viewed: false,
                        }, shiftEmpresaId));
                    })
                    .catch(e => logOpsBackgroundWarn('autoAlertVacante:plan', e));
            }

            // ── PASO 3: T+120 → auto-declarar SIN COBERTURA ─────────────────
            // Si pasaron 2h desde el inicio del turno y sigue sin cobertura,
            // se crea un doc "autosinc_*" en turnos con isSinCobertura:true.
            // Ese doc cuenta como cobertura en el SLA (suprime la vacante virtual)
            // y deshabilita las acciones CUBRIR. Motivo: ausencia o falta de planificacion.
            if (minutesUntil <= -120) {
                const sinCobKey = `${v.id}_SIN_COBERTURA_FINAL`;
                if (!alertedVacancyIds.current.has(sinCobKey)) {
                    alertedVacancyIds.current.add(sinCobKey);
                    const sinCobSafeId = v.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
                    const sinCobRef = doc(db, 'turnos', `autosinc_${sinCobSafeId}`);
                    const sinCobEmpresaId = String(v.empresaId || empresaId || '').trim();
                    getDoc(sinCobRef).then(snap => {
                        if (snap.exists()) return; // ya declarado
                        const motivo = v.vacancyOrigin === 'ABSENCE'
                            ? `Ausencia sin cobertura — ${v.positionName} en ${v.objectiveName}`
                            : `Falta de planificacion — ${v.positionName} en ${v.objectiveName}`;
                        setDoc(sinCobRef, stampEmpresaId({
                            clientId: v.clientId, clientName: v.clientName,
                            objectiveId: v.objectiveId, objectiveName: v.objectiveName,
                            positionName: v.positionName,
                            employeeId: 'SIN_COBERTURA', employeeName: 'SIN COBERTURA',
                            startTime: Timestamp.fromDate(v.shiftDateObj),
                            endTime: Timestamp.fromDate(v.endDateObj),
                            status: 'SIN_COBERTURA', isSinCobertura: true,
                            vacancyOrigin: v.vacancyOrigin || 'NO_PLANNING',
                            motivo,
                            createdAt: serverTimestamp(),
                        }, sinCobEmpresaId))
                        .then(() => toast.info(`Sin cobertura: ${v.positionName} en ${v.objectiveName}`))
                        .catch(e => {
                            alertedVacancyIds.current.delete(sinCobKey);
                            logOpsBackgroundWarn('autoSinCobertura', e);
                        });
                    }).catch(() => alertedVacancyIds.current.delete(sinCobKey));
                }
                continue; // no generar alerta PROTOCOLO para vacantes ya vencidas
            }

            // ── PASO 2: alerta PROTOCOLO Ops (T-2h o ya iniciado) ────────────
            // Escalera: Planificación temprana → Ops alerta T-2h → cascada T-1h (cron).
            // Cambio de última hora (<2h al detectar) cae acá de inmediato.
            if (minutesUntil > 120) continue;
            const protKey = `${v.id}_VACANTE_PROTOCOLO_COBERTURA`;
            if (alertedVacancyIds.current.has(protKey)) continue;
            alertedVacancyIds.current.add(protKey);

            const protSafeId = v.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
            const protRef = doc(db, 'novedades', `autodev_prot_${protSafeId}`);
            const shiftEmpresaIdProt = String(v.empresaId || empresaId || '').trim();

            getDoc(protRef).then(snap => {
                if (snap.exists() && (snap.data()?.status === 'ATENDIDA' || snap.data()?.status === 'atendida')) {
                    return;
                }
                const desc = minutesUntil <= 0
                    ? `⚠️ PROTOCOLO: Puesto ${v.positionName} en ${v.objectiveName} sin cobertura. Turno inició hace ${Math.round(Math.abs(minutesUntil))} min. Requiere CUBRIR inmediato.`
                    : minutesUntil <= 60
                        ? `⚠️ PROTOCOLO URGENTE: Puesto ${v.positionName} en ${v.objectiveName} sin cubrir. Faltan ${Math.round(minutesUntil)} min (ventana cascada).`
                        : `⚠️ PROTOCOLO: Puesto ${v.positionName} en ${v.objectiveName} sin planificar/cubrir. Faltan ${Math.round(minutesUntil)} min (alerta T-2h).`;
                const shiftStart = v.shiftDateObj instanceof Date ? Timestamp.fromDate(v.shiftDateObj) : null;
                setDoc(protRef, stampEmpresaId({
                    type: 'VACANTE_PROTOCOLO_COBERTURA', status: 'PENDIENTE',
                    virtualVacancyId: v.id,
                    shiftId: `autodev_${protSafeId}`,
                    objectiveId: v.objectiveId, objectiveName: v.objectiveName || '',
                    clientId: v.clientId || null, positionName: v.positionName || '',
                    ...(shiftStart ? { shiftStart } : {}),
                    description: desc,
                    minutesUntilStart: Math.round(minutesUntil),
                    alertWindow: minutesUntil <= 60 ? 'T1H' : 'T2H',
                    createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                }, shiftEmpresaIdProt), { merge: false })
                    .catch(e => logOpsBackgroundWarn('autoAlertVacante:prot', e));
            }).catch(() => {
                alertedVacancyIds.current.delete(protKey);
            });
        }

        // ── RETENCIÓN LARGA (>2h retenido) ──────────────────────────────
        const retainedShifts = processedData.filter((s: any) => s.isRetention && !s.isCompleted);
        for (const s of retainedShifts) {
            const endMs = s.endDateObj?.getTime?.() ?? 0;

            // ── PUESTO CUSTOM: cerrar inmediatamente al terminar (sin relevo ni espera) ──
            // Solo si NO hay retención manual del operador (manualRetentionType está seteado)
            const isOperatorRetention = s.isRetentionByField && !!s.manualRetentionType;
            if (s.isCustomPost && !isOperatorRetention) {
                const autoCustomKey = `${s.id}_AUTO_END_CUSTOM_POST`;
                if (!alertedVacancyIds.current.has(autoCustomKey)) {
                    alertedVacancyIds.current.add(autoCustomKey);
                    autoCloseShiftTx(s.id, {
                        status: 'COMPLETED', isCompleted: true, isPresent: false,
                        completedAt: serverTimestamp(), completedBy: 'Sistema',
                        completionReason: 'AUTO_SHIFT_END_CUSTOM',
                    }, empresaId).then(ok => {
                        if (ok) toast.success(`Turno finalizado: ${s.employeeName || 'Guardia'}`);
                    }).catch(e => {
                        alertedVacancyIds.current.delete(autoCustomKey);
                        logOpsBackgroundWarn('autoEndCustomPost', e);
                    });
                }
                continue;
            }

            // ── RELEVO CON TARDANZA REGISTRADA (lateETA): respetar hora acordada ──────────────
            // Si hay un turno de relevo en el mismo puesto con lateETA registrado,
            // el sistema NO auto-cierra al retenido hasta pasado el ETA + buffer.
            // A T-5min del ETA lanza alerta "relevo inminente — preparar handover".
            if (!isOperatorRetention) {
                const relevoShift = processedData.find((other: any) => {
                    if (other.id === s.id || other.isPresent || other.isCompleted) return false;
                    if (other.objectiveId !== s.objectiveId) return false;
                    if (normPosName(other.positionName) !== normPosName(s.positionName)) return false;
                    if (!other.lateETA) return false;
                    const otherStart = other.shiftDateObj?.getTime?.() ?? 0;
                    return otherStart >= endMs - 30 * 60000 && otherStart <= endMs + 4 * 60 * 60000;
                });

                if (relevoShift?.lateETA) {
                    // Parsear "HH:MM" al timestamp de hoy (usando la fecha del endDateObj del retenido)
                    const [etaH, etaM] = (relevoShift.lateETA as string).split(':').map(Number);
                    const base = s.endDateObj instanceof Date ? s.endDateObj : new Date(endMs);
                    const etaDate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), etaH, etaM, 0);
                    // Si la hora ETA es anterior a endTime (ej: turno nocturno cruzando medianoche) sumar 1 día
                    if (etaDate.getTime() < endMs - 30 * 60000) etaDate.setDate(etaDate.getDate() + 1);
                    const etaMs = etaDate.getTime();
                    const minsToEta = (etaMs - nowMs) / 60000;

                    // Alerta 5 min antes del ETA
                    const etaAlertKey = `${s.id}_ETA_RELEVO_ALERT`;
                    if (minsToEta <= 5 && minsToEta > -10 && !alertedVacancyIds.current.has(etaAlertKey)) {
                        alertedVacancyIds.current.add(etaAlertKey);
                        const etaLabel = `${String(etaH).padStart(2,'0')}:${String(etaM).padStart(2,'0')}`;
                        toast.warning(`⏰ Relevo inminente: ${relevoShift.employeeName || 'Guardia'} llega a las ${etaLabel} — relevar a ${s.employeeName}`, { duration: 30000 });
                        addDoc(collection(db, 'novedades'), stampEmpresaId({
                            type: 'RELEVO_INMINENTE',
                            shiftId: s.id,
                            relevoShiftId: relevoShift.id,
                            employeeId: s.employeeId,
                            employeeName: s.employeeName,
                            relevorName: relevoShift.employeeName || '',
                            objectiveId: s.objectiveId,
                            objectiveName: s.objectiveName || '',
                            clientId: s.clientId || null,
                            positionName: s.positionName || '',
                            eta: relevoShift.lateETA,
                            status: 'pending',
                            title: 'Relevo inminente',
                            description: `${relevoShift.employeeName || 'Relevo'} llega a las ${etaLabel}. Relevar a ${s.employeeName} en ${s.objectiveName || s.positionName}.`,
                            createdAt: serverTimestamp(),
                            source: 'SYSTEM_SCHEDULER',
                        }, String(s.empresaId || empresaId || '').trim())).catch(e => logOpsBackgroundWarn('relevoInminente', e));
                    }

                    // Mientras el ETA + 15 min no haya pasado: no auto-cerrar (esperar al relevo)
                    const etaGraceMs = etaMs + 15 * 60000;
                    if (nowMs < etaGraceMs) continue;
                    // Si ya pasó el grace y el relevo no llegó → cae al bloque shouldAutoClose normal
                }
            }

            // ── AUTO-FIN RETENCIÓN: puesto cubierto por turnos regulares ──
            const autoEndKey = `${s.id}_AUTO_END_RETENTION`;
            if (!alertedVacancyIds.current.has(autoEndKey)) {
                const capacity = getPositionCapacity(servicesSLA, s.objectiveId, s.positionName);
                const coverageCount = processedData.filter((other: any) =>
                    other.id !== s.id &&
                    other.isPresent && !other.isCompleted && !other.isRetention &&
                    other.objectiveId === s.objectiveId &&
                    normPosName(other.positionName) === normPosName(s.positionName)
                ).length;
                if (coverageCount >= capacity) {
                    alertedVacancyIds.current.add(autoEndKey);
                    autoCloseShiftTx(s.id, {
                        status: 'COMPLETED', isCompleted: true, isPresent: false,
                        completedAt: serverTimestamp(), completedBy: 'Sistema',
                        completionReason: 'AUTO_COVERAGE_COMPLETE',
                    }, empresaId).then(ok => {
                        if (ok) toast.success(`✅ Recarga finalizada: ${s.employeeName || 'Guardia'} — puesto cubierto`);
                    }).catch(e => {
                        alertedVacancyIds.current.delete(autoEndKey);
                        logOpsBackgroundWarn('autoEndRetention', e);
                    });
                    continue; // no generar alerta de retención larga para este turno
                }
            }

            if (!endMs) continue;
            const minutesOvertime = (nowMs - endMs) / 60000;

            // ── AUTO-FIN TURNO ─────────────────────────────────────────────────────
            // Dos caminos:
            // 1. isRetentionByField=false (solo por tiempo): esperar relevo 60 min → cerrar
            // 2. isRetentionByField=true por CF (autoRetentionAt existe): cerrar a los 60 min
            //    Si la retención fue puesta por operador (sin autoRetentionAt) → NO tocar
            const autoShiftEndKey = `${s.id}_AUTO_END_SHIFT`;
            // isCFRetention: retenido por la CF (autoRetentionAt existe → retentionMinutes > 0)
            // vs retención manual del operador (isRetentionByField pero retentionMinutes == 0)
            const isCFRetention = s.isRetentionByField && (s.retentionMinutes ?? 0) > 0;
            const shouldAutoClose =
                (!s.isRetentionByField && minutesOvertime >= 1 && minutesOvertime < 720) ||
                (isCFRetention && (s.retentionMinutes ?? 0) >= 60 && (s.retentionMinutes ?? 0) < 720);

            if (shouldAutoClose && !alertedVacancyIds.current.has(autoShiftEndKey)) {
                // ¿Tiene continuidad o relevo planificado en este puesto?
                // Si existe un turno sucesor (esté pendiente, vacante, tarde o ausente) o si el puesto es 24h/continuo,
                // hay continuidad: el guardia saliente NO debe cerrarse automáticamente, debe permanecer retenido.
                const hasContinuity = !s.isCustomPost && (
                    processedData.some((other: any) => {
                        const otherStart = other.shiftDateObj?.getTime?.() ?? 0;
                        return (
                            other.id !== s.id &&
                            other.objectiveId === s.objectiveId &&
                            normPosName(other.positionName) === normPosName(s.positionName) &&
                            !other.isCompleted &&
                            otherStart >= endMs - 30 * 60000 &&
                            otherStart <= endMs + 120 * 60000
                        );
                    })
                );
                if (!hasContinuity) {
                    alertedVacancyIds.current.add(autoShiftEndKey);
                    autoCloseShiftTx(s.id, {
                        status: 'COMPLETED', isCompleted: true, isPresent: false,
                        completedAt: serverTimestamp(), completedBy: 'Sistema',
                        completionReason: isCFRetention ? 'AUTO_END_CF_RETENTION_TIMEOUT' : 'AUTO_SHIFT_END',
                    }, empresaId).then(ok => {
                        if (ok) toast.success(`Turno finalizado: ${s.employeeName || 'Guardia'}`);
                    }).catch(e => {
                        alertedVacancyIds.current.delete(autoShiftEndKey);
                        logOpsBackgroundWarn('autoEndShift', e);
                    });
                    continue;
                }
            }

            // ── AUTO-FIN POR TIEMPO EXCESIVO (>6h sin relevo) ─────────────────────
            // Cubre el caso en que nadie tuvo la plataforma abierta durante la noche
            // y los turnos del día anterior quedaron en isRetention sin auto-completarse.
            // Si el turno lleva >6h de retención, se cierra automáticamente.
            const autoTimeKey = `${s.id}_AUTO_END_OVERTIME`;
            if (minutesOvertime > 360 && !alertedVacancyIds.current.has(autoTimeKey)) {
                alertedVacancyIds.current.add(autoTimeKey);
                autoCloseShiftTx(s.id, {
                    status: 'COMPLETED', isCompleted: true, isPresent: false,
                    completedAt: serverTimestamp(), completedBy: 'Sistema',
                    completionReason: 'AUTO_OVERTIME_LIMIT',
                }, empresaId).then(ok => {
                    if (ok) toast.info(`ℹ️ Turno cerrado: ${s.employeeName || 'Guardia'} — retención > 6h`);
                }).catch(e => {
                    alertedVacancyIds.current.delete(autoTimeKey);
                    logOpsBackgroundWarn('autoEndRetentionTime', e);
                });
                continue;
            }

            if (minutesOvertime < 120) continue;
            const alertKey = `${s.id}_RETENCION_LARGA`;
            if (alertedVacancyIds.current.has(alertKey)) continue;
            alertedVacancyIds.current.add(alertKey);
            getDocs(query(collection(db, 'novedades'), where('shiftId', '==', s.id), where('type', '==', 'RETENCION_LARGA'), limit(1)))
                .then(snap => {
                    if (!snap.empty) return;
                    addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'RETENCION_LARGA',
                        shiftId: s.id,
                        employeeId: s.employeeId,
                        employeeName: s.employeeName,
                        objectiveId: s.objectiveId,
                        objectiveName: s.objectiveName,
                        positionName: s.positionName,
                        minutesOvertime,
                        status: 'pending',
                        title: 'Retención prolongada',
                        description: `${s.employeeName || 'Guardia'} lleva ${Math.round(minutesOvertime)} min retenido en ${s.objectiveName || 'su puesto'}.`,
                        createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                    }, String(s.empresaId || empresaId || '').trim()))
                    .catch(e => logOpsBackgroundWarn('retentionLarga', e));
                })
                .catch(e => logOpsBackgroundWarn('retentionLarga:check', e));
        }
    }, [enabled, processedData, empresaId, now, servicesSLA]);

    // isStable: se activa una sola vez cuando processedData se estabiliza después de isReady.
    // NO vuelve a false — evita que updates de Firestore muestren la pantalla de carga repetidamente.
    useEffect(() => {
        if (!enabled || !isReady) return;
        if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
        stableTimerRef.current = setTimeout(() => setIsStable(true), 700);
        return () => { if (stableTimerRef.current) clearTimeout(stableTimerRef.current); };
    }, [enabled, processedData, isReady]);

    // Fallback: fuerza isStable(true) si despues de 3 seg el monitor no se inicio.
    useEffect(() => {
        if (!enabled) return;
        const t = setTimeout(() => setIsStable(true), 3000);
        return () => clearTimeout(t);
    }, [enabled]);

    return {
        processedData,
        publishStatusMap,
        recentLogs,
        isReady,
        isStable,
        handleAction,
        uniqueClients,
        employees,
        servicesSLA,
        rawShifts: mergedRawShifts,
        objectives,
        now,
    };
}

function useOperacionesMonitorDerived(
    shared: OperacionesMonitorShared,
    forcedClientId?: string | null,
) {
    const [viewTab, setViewTab] = useState<OperacionesMonitorViewTab>('PRIORIDAD');
    const [selectedClientId, setSelectedClientId] = useState<string>(forcedClientId || '');
    const [filterText, setFilterText] = useState('');
    const [isCompact, setIsCompact] = useState(false);

    const {
        processedData,
        publishStatusMap,
        objectives,
        now,
    } = shared;

    const filteredObjectives = useMemo(() => {
        let list = selectedClientId ? objectives.filter((o: any) => o.clientId === selectedClientId) : objectives;
        const q = foldSearch(filterText);
        if (!q) return list;
        const idsFromShifts = new Set(
            processedData
                .filter((s: any) =>
                    foldSearch(s.objectiveName).includes(q) ||
                    foldSearch(s.positionName).includes(q) ||
                    foldSearch(s.employeeName).includes(q)
                )
                .flatMap((s: any) => [String(s.objectiveId || ''), String(s.objectiveName || '')])
        );
        return list.filter((o: any) => {
            const id = String(o.id || o.objectiveId || '');
            return foldSearch(o.name).includes(q) ||
                foldSearch(o.nombre).includes(q) ||
                foldSearch(o.objectiveName).includes(q) ||
                foldSearch(o.address).includes(q) ||
                foldSearch(o.direccion).includes(q) ||
                idsFromShifts.has(id) ||
                idsFromShifts.has(String(o.name || ''));
        });
    }, [objectives, selectedClientId, filterText, processedData]);

    const listData = useMemo(() => {
        const vy = now.getFullYear();
        const vm = now.getMonth() + 1;
        const isVisible = (s: any) => {
            if (publishStatusMap[`${s.objectiveId}_${vy}_${vm}`]) return true;
            return isOperationalOriginShift(s) || s.isVirtual === true;
        };
        let list = processedData.filter(isVisible);
        if (selectedClientId) list = list.filter((s: any) => s.clientId === selectedClientId);
        if (filterText) {
            const q = foldSearch(filterText);
            list = list.filter((s: any) =>
                foldSearch(s.employeeName).includes(q) ||
                foldSearch(s.clientName).includes(q) ||
                foldSearch(s.objectiveName).includes(q) ||
                foldSearch(s.positionName).includes(q)
            );
        }
        const hoy = list.filter((s: any) => isOpsShiftHoy(s, now));
        return hoy.filter((s: any) => shiftMatchesOpsViewTab(s, viewTab));
    }, [processedData, viewTab, filterText, selectedClientId, now, publishStatusMap]);

    const mapTabObjectives = useMemo(() => {
        const ids = new Set(
            listData.map((s: any) => String(s.objectiveId ?? '').trim()).filter(Boolean),
        );
        return filteredObjectives.filter((o: any) =>
            ids.has(String(o.id ?? o.objectiveId ?? '').trim()),
        );
    }, [listData, filteredObjectives]);

    const stats = useMemo(() => {
        const sy = now.getFullYear();
        const sm = now.getMonth() + 1;
        const hoy = processedData.filter((s) => isOpsShiftHoy(s, now)).filter((s: any) => {
            if (publishStatusMap[`${s.objectiveId}_${sy}_${sm}`]) return true;
            return isOperationalOriginShift(s) || s.isVirtual === true;
        });
        return {
            prioridad: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'PRIORIDAD')).length,
            no_llego: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'NO_LLEGO')).length,
            plan: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'PLAN')).length,
            activos: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'ACTIVOS')).length,
            retenidos: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'RETENIDOS')).length,
            vacantes: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'VACANTES')).length,
            devueltas: hoy.filter((s) => s.isUnassigned && s.isReportedToPlanning).length,
            ausentes: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'AUSENTES')).length,
            francos: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'FRANCOS')).length,
            reten: hoy.filter((s) => shiftMatchesOpsViewTab(s, 'RETEN')).length,
            rrhh_urgente: hoy.filter((s) => s.isRRHHUrgent && !s.isFranco).length,
            rrhh_planificado: hoy.filter((s) => s.isRRHHPlanned && !s.isFranco).length,
            total: hoy.length,
        };
    }, [processedData, now, publishStatusMap]);

    return {
        ...shared,
        filterText,
        setFilterText,
        isCompact,
        setIsCompact,
        viewTab,
        setViewTab,
        stats,
        listData,
        mapTabObjectives,
        selectedClientId,
        setSelectedClientId,
        filteredObjectives,
    };
}

/** Monitor operativo: usa el provider compartido en /admin/operaciones o instancia local fuera de él. */
export const useOperacionesMonitor = (forcedClientId?: string | null) => {
    const fromProvider = useOperacionesMonitorContext();
    const ownedCore = useOperacionesMonitorCore({ enabled: fromProvider === null });
    const shared = fromProvider ?? ownedCore;
    return useOperacionesMonitorDerived(shared, forcedClientId);
};
