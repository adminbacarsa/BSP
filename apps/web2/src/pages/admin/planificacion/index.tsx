import React, { useState, useEffect, useMemo, useRef, useTransition, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageHeader, SupervisorPinInput } from '@/components/ui';
import { openCronoPopout } from '@/lib/planificacion/openCronoPopout';
import { useSetPageHeader } from '@/context/PageHeaderContext';
import { 
    ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, Plus,
    Users, Clock, X, UserPlus, ArrowRight, Eye, EyeOff, 
    CheckCircle, Trash2, ShieldAlert, User, Briefcase, Layers,
    Bell, Calendar, CalendarX, Loader2, Stethoscope, MapPin, Lock, ShieldCheck, UserMinus,
    Save, Undo, History, MousePointer2, AlertTriangle, Grip, LayoutGrid, MonitorPlay,
    Printer, Download, Grid, RefreshCw, Edit3, Shield, ArrowRightCircle, Info, ArrowDownWideNarrow, ArrowDownAZ,
    BadgePercent, ArrowLeftRight, CalendarSearch, CheckSquare, XCircle, Search as SearchIcon, RefreshCcw, UserCheck, Split, Ban,
    FastForward, Rewind, AlertOctagon, Siren, FileText, Fingerprint, CalendarCheck, HelpCircle, MousePointerClick, Check, Database, Activity,
    PowerOff, LockKeyhole, Ghost, Maximize2, Maximize, Minimize2, Copy, ClipboardPaste, Wand2, BarChart3, BarChart2, PanelLeft, LayoutList,
    ChevronsUp, ChevronsDown, MoreHorizontal
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, orderBy, limit, serverTimestamp, Timestamp, where, getDocs, getDoc, updateDoc, writeBatch, setDoc, deleteField } from 'firebase/firestore';

type PlanificacionDotacionEntry = { positionName: string; shiftCode?: string };
type PlanificacionDotacionMap = Record<string, PlanificacionDotacionEntry>;

function buildDotacionMapsFromEmployees(employees: { id: string; planificacionDotacion?: PlanificacionDotacionMap }[]) {
    const pos: Record<string, string> = {};
    const shift: Record<string, string> = {};
    for (const e of employees) {
        const dot = e.planificacionDotacion;
        if (!dot) continue;
        for (const [objId, cfg] of Object.entries(dot)) {
            if (cfg?.positionName) pos[`${e.id}___${objId}`] = cfg.positionName;
            if (cfg?.shiftCode) shift[`${e.id}___${objId}`] = cfg.shiftCode;
        }
    }
    return { pos, shift };
}

const DOTACION_NEARBY_KM_DEFAULT = 10;
const DOTACION_NEARBY_KM_MIN = 5;
const DOTACION_NEARBY_KM_MAX = 100;
const NEARBY_KM_STORAGE_KEY = 'planif_nearby_km';

function clampNearbyKm(v: number): number {
    if (!Number.isFinite(v)) return DOTACION_NEARBY_KM_DEFAULT;
    return Math.min(DOTACION_NEARBY_KM_MAX, Math.max(DOTACION_NEARBY_KM_MIN, Math.round(v)));
}

function readStoredNearbyKm(): number {
    if (typeof window === 'undefined') return DOTACION_NEARBY_KM_DEFAULT;
    try {
        const stored = parseInt(localStorage.getItem(NEARBY_KM_STORAGE_KEY) || '', 10);
        if (Number.isFinite(stored)) return clampNearbyKm(stored);
    } catch { /* ignore */ }
    return DOTACION_NEARBY_KM_DEFAULT;
}

function formatKmLabel(km: number | null | undefined): string {
    if (km == null || !Number.isFinite(km) || km >= 9999) return '';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function employeeKmToObjective(emp: { lat?: number; lng?: number; latitude?: number; longitude?: number }, objLat: number, objLng: number): number | null {
    const empLat = Number(emp.lat ?? emp.latitude ?? 0);
    const empLng = Number(emp.lng ?? emp.longitude ?? 0);
    if (!empLat || !empLng || !objLat || !objLng) return null;
    return haversineKm(empLat, empLng, objLat, objLng);
}

function isEmpExcludedFromPlanningDotacion(emp: { planificacionDotacion?: PlanificacionDotacionMap }, objectiveId: string | null | undefined): boolean {
    if (!objectiveId || !emp?.planificacionDotacion) return false;
    return isDeploymentSurplusCode(emp.planificacionDotacion[objectiveId]?.shiftCode);
}
import { useEmpresa } from '@/context/EmpresaContext';
import {
    belongsToEmpresaView,
    shouldScopeQueriesToEmpresa,
    empresaCollectionQuery,
    buildAuditLogsRecentQuery,
    auditLogTimestampMs,
    sortAuditLogRows,
    filterRowsByEmpresa,
    dedupeClientsById,
    stampEmpresaId,
    buildPlanificacionEstadoDocId,
    planificacionPublishLookupKey,
    fetchPlanificacionEstadoDoc,
    fetchMergedPlanificacionEstadoData,
} from '@/lib/multiempresa';
import { toYyyyMmDd } from '@/lib/firestoreDates';
import {
    filterSlasForPlanningTenant,
    filterSlasForPlanningContext,
    formatSlaRangeHint,
    pickSlaForPlanningMonth,
    planningMonthHasActiveSla,
    slaBelongsToPlanningClient,
    buildPlanningPositionStructure,
    DEFAULT_PLANNING_SHIFTS,
    isPlanningPositionExcludedOnDate,
    isPlanningWorkShiftCode,
    planningPositionExclusionLabel,
    buildExcludedPositionsByDate,
    abbrevPlanningPositionName,
    excludedPositionsCellLabel,
    excludedPositionsTooltip,
} from '@/lib/slaPlanningMatch';
import { useAuth } from '@/context/AuthContext';
import { Toaster, toast } from 'sonner';
import { checkRestBetweenShifts, getAgreementRestConfig } from '@/lib/planificacion/restBetweenShifts';
import { generateScheduleV4, effectiveShiftsForPositionDay, positionIsActiveOn } from '@/lib/planificacion/autoScheduleEngineV4';
import {
    resolveAutoPlanningBrain,
    PLANNING_COVERAGE_RULES,
    type AutoPlanningBrainResult,
} from '@/lib/planificacion/autoPlanningBrain';
import {
    countPositionClosedUnitsFromShifts,
    PLANNING_NON_BILLABLE_CODES,
    buildCodeCountsByPositionForDay,
    collectSplitBandCreditsForDay,
    lookupSplitCreditsForPosition,
} from '@/lib/planificacion/positionCoverageUnits';
import {
    analyzeDayCoverageGaps,
    analyzeObjectiveCoverageGaps,
    flattenDayGapsForUi,
} from '@/lib/planificacion/coverageGapAnalysis';
import {
    buildObjectiveCoveragePreflight,
    formatDayDemandSummary,
    type ObjectiveCoveragePreflight,
} from '@/lib/planificacion/objectiveCoverageDemand';
import { inferAbsenceCode, isActiveAbsence, buildAbsencesMapFromDocs, toCalendarDateStr, iterateCalendarDateRange, validateAbsenceDateRange } from '@/lib/planificacion/absenceCodes';
import { isEmployeeOnLeave, shouldShowLeaveConflictSiren } from '@/lib/planificacion/leaveCoverage';
import {
    listDateRangeInclusive,
    applyVacancyCoverageToChanges,
    collectVacancyFrancoConflicts,
    VACANCY_NON_WORK_CODES,
    resolveVacancyDayCoverage,
    formatVacancyDayCoverageLabel,
    vacancyDayHasCoverage,
    resolveTitularVacancyWorkShift,
    describeVacancySplitPlan,
    type VacancyDayCoverage,
} from '@/lib/planificacion/vacancyCoverage';
import {
    listExtensionCandidates,
    listEarlyStartCandidates,
    defaultSplitForBand,
    neighborBandsForTarget,
    collectSplitFrancoConflicts,
    formatFrancoConflictSummary,
    type FrancoCoverageConflict,
} from '@/lib/planificacion/planningRecompositionApply';
import { verifyScheduleCoverage } from '@/lib/planificacion/coverageVerification';
import { runStrictSixTwoPipeline, runSixPlusOnePipeline } from '@/lib/planificacion/planningPipeline';
import { canUseFixedBandFloater } from '@/lib/planificacion/fixedBandFloaterScheduleEngine';
import { applyAbsenceCoverage } from '@/lib/planificacion/coverageEngine';
import PlanningCoverageModal from '@/components/planificacion/PlanningCoverageModal';
import PlanningRecompositionModal from '@/components/planificacion/PlanningRecompositionModal';
import PlanningCronogramasOverviewModal from '@/components/planificacion/PlanningCronogramasOverviewModal';
import type { PendingAbsenceNovedad, RecompositionPackage } from '@/lib/planificacion/planningRecomposition.types';
import { extractPackagesFromPending, emitRecompositionNotifications } from '@/lib/planificacion/planningRecompositionNotify';
import { canUseSixPlusOne } from '@/lib/planificacion/sixPlusOneEngine';
import { fixScheduleIssues } from '@/lib/planificacion/coverageFixer';
import {
    buildPlannerContextFromAutoRun,
    runPlanningAgentOptimizeStep,
    shouldRunGeminiOptimizeStep,
} from '@/lib/planificacion/planningAgentPipeline';
import { buildScheduleOptimizationSuggestions } from '@/lib/planificacion/scheduleOptimizationSuggestions';
import { verifyScheduleForm } from '@/lib/planificacion/scheduleFormValidator';
import { rebalanceScheduleForm, type FormRebalanceLogEntry } from '@/lib/planificacion/scheduleFormRebalancer';
import AjustarCronoOperativoModal from '@/components/admin/planificacion/AjustarCronoOperativoModal';
import EquilibrarCronoModal from '@/components/admin/planificacion/EquilibrarCronoModal';
import { usePlanningRules } from '@/hooks/usePlanningRules';
import { enabledPlanningCycles, planningHourLimits } from '@/lib/planning/planning-rules.runtime';
import {
    buildPlanningSnapshotFromGrid,
    diffPlanningSnapshots,
} from '@/lib/planificacion/planningSnapshotDiff';
import {
    buildDeploymentShiftConfig,
    cellLabelForDeployment,
    deploymentFieldsForFirestore,
    isDeploymentSurplusCode,
    shiftCountsForEmployeeCronoHours,
} from '@/lib/planificacion/deploymentRoles';
import { checkGeneroPuesto, getPreferenciaGeneroFromPositionStructure, getPreferenciaGeneroUi, preferenciaGeneroOptionSuffix, preferenciaGeneroLabel } from '@/lib/planificacion/genderPreference';
import { experienciaBadgeForReplacement, patchExperienciaForTurno } from '@/lib/planificacion/experienciaObjetivos';

const LEAVE_CELL_CODES = new Set(['V', 'L', 'PG', 'A', 'E', 'AA', 'LT']);

function resolveTitularCoverageName(
    titularEmpId: string,
    titularName: string,
    dateStr: string,
    shiftsMap: Record<string, any>,
    pendingChanges: Record<string, any>,
    empNameById: (id: string) => string | undefined,
    coveredByFromCell?: string | null,
): string | null {
    if (coveredByFromCell) {
        return String(coveredByFromCell).replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
    }
    const allSources = { ...shiftsMap, ...pendingChanges };
    for (const [k, raw] of Object.entries(allSources)) {
        if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${titularEmpId}_`)) continue;
        const s = raw as any;
        if (s?.isDeleted) continue;
        if (String(s.comments || '').includes(`Cubriendo a ${titularName}`)) {
            const covEmpId = k.replace(`_${dateStr}`, '');
            const name = empNameById(covEmpId);
            const covCode = String(s.code || '').toUpperCase();
            if (name && covCode && !LEAVE_CELL_CODES.has(covCode)) return `${name} turno ${covCode}`;
            return name || null;
        }
    }
    return null;
}

function buildLeaveCellTooltipLabel(opts: {
    absenceType?: string | null;
    reason?: string | null;
    coveredBy?: string | null;
}): string {
    const lines: string[] = [];
    if (opts.absenceType) lines.push(`Tipo: ${opts.absenceType}`);
    const reason = String(opts.reason || '').trim();
    if (reason && !reason.includes('gestionado desde planificador')) lines.push(`Motivo: ${reason}`);
    lines.push(`Cubierto por: ${opts.coveredBy || 'Sin cobertura registrada'}`);
    return lines.join('\n');
}

// --- CONFIGURACIÓN VISUAL ---
const SHIFT_STYLES: any = {
    'M':   'bg-white text-blue-700 border-blue-400 font-bold',
    'T':   'bg-white text-orange-600 border-orange-400 font-bold',
    'N':   'bg-white text-indigo-700 border-indigo-500 font-bold',
    'D12': 'bg-white text-cyan-700 border-cyan-400 font-bold',
    'N12': 'bg-white text-purple-700 border-purple-400 font-bold',
    'F':   'bg-green-500 text-white border-green-600 font-black shadow-sm',
    'PU':  'bg-white text-pink-700 border-pink-400 font-bold',
    'A':   'bg-white text-red-700 border-red-400 font-black pattern-diagonal',
    'V':   'bg-emerald-700 text-white border-emerald-800 font-black shadow-sm',
    'L':   'bg-white text-purple-700 border-purple-400 font-black',
    'E':   'bg-white text-rose-700 border-rose-400 font-black',
    'AA':  'bg-white text-amber-700 border-amber-400',
    'LT':  'bg-orange-50 text-orange-700 border-orange-400 font-black',
    'RET': 'bg-white text-slate-500 border border-slate-300 font-bold',
    'REF': 'bg-violet-100 text-violet-800 border-violet-500 font-black',
    'RFZ': 'bg-red-500 text-white border-red-600 font-black',
    'TURA': 'bg-red-600 text-white border-red-700 font-black',
    'ESC': 'bg-sky-100 text-sky-800 border-sky-500 font-black',
    'PG':  'bg-white text-blue-700 border-blue-400 font-black',
    'LOCKED': 'bg-slate-200 text-slate-500 border-slate-300 pattern-grid',
    'PAST':   'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed',
    'C':   'bg-white text-slate-600 border-slate-400 font-bold opacity-90',
    'FT':  'bg-violet-600 text-white border-violet-700 font-black shadow-sm',
    'FF':  'bg-green-600 text-white border-green-700 font-black shadow-sm',
    'SWAP':         'bg-cyan-50 text-cyan-700 border-cyan-300 border-dashed font-bold',
    'SWAP_PENDING': 'bg-amber-100 text-amber-700 border-amber-300 border-dashed font-bold'
};

const LEGEND_DESCRIPTIONS: Record<string, string> = {
    'M': 'Turno Mañana (Estándar)',
    'T': 'Turno Tarde (Estándar)',
    'N': 'Turno Noche (Estándar)',
    'D12': 'Jornada Diurna 12hs',
    'N12': 'Jornada Nocturna 12hs',
    'F': 'Franco Compensatorio',
    'RET': 'Guardia Retén',
    'REF': 'Refuerzo interno (no cuenta cobertura SLA)',
    'RFZ': 'Refuerzo solicitado por cliente (facturable)',
    'TURA': 'Turno Agregado por cliente (facturable)',
    'ESC': 'Escuela / formación (no cuenta cobertura SLA ni horas planificadas)',
    'PU': 'Puesto Único / Especial',
    'A': 'ART',
    'V': 'Vacaciones',
    'L': 'Licencia Esp.',
    'E': 'Enfermedad',
    'AA': 'No Presentó',
    'LT': 'Llegada Tarde',
    'LOCKED': 'Bloqueado (Cerrado/Pasado)',
    'PAST': 'Fecha Pasada',
    'C': 'Turno Consolidado (Fichado)',
    'FT': 'Franco Trabajado (Pago Doble)',
    'FF': 'Franco x Franco (Devolución)',
    'SWAP': 'Intercambio de Turno',
    'SWAP_PENDING': 'Intercambio pendiente de autorización'
};

const SHIFT_RANGES: Record<string, string> = {
    'M': '07:00 - 15:00',
    'T': '15:00 - 23:00',
    'N': '23:00 - 07:00',
    'D12': '07:00 - 19:00',
    'N12': '19:00 - 07:00',
    'PU': 'Horario Personalizado',
    'FT': 'Cobertura Extra (100%)'
};

const ABSENCE_STATUS_STYLES: Record<string, string> = {
    'Justificada': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Autorizada': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'En verificación': 'bg-violet-100 text-violet-700 border-violet-200',
    'Pendiente': 'bg-amber-100 text-amber-800 border-amber-200',
    'Injustificada': 'bg-rose-100 text-rose-700 border-rose-200',
    'Rechazada': 'bg-rose-100 text-rose-700 border-rose-200',
};

const absenceStatusBadgeClass = (status: string) =>
    ABSENCE_STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 border-slate-200';

const formatShiftScheduleLabel = (shift: any, bandCode: string): string => {
    if (typeof shift?.startTime === 'string' && typeof shift?.endTime === 'string') {
        return `${shift.startTime} - ${shift.endTime}`;
    }
    if (shift?.startTime && shift?.endTime && typeof shift.startTime !== 'string') {
        const s = formatTime(shift.startTime);
        const e = formatTime(shift.endTime);
        if (s !== '--:--' && e !== '--:--' && s !== e) return `${s} - ${e}`;
    }
    return SHIFT_RANGES[bandCode] || '—';
};

const DEFAULT_LIMITS = { weekly: 48, monthly: 200 };

/** Versión del motor de planificación — visible en UI durante generación para verificar deploy. */
const PLANNING_ENGINE_VERSION = '2.8';

const SHIFT_HOURS_LOOKUP: Record<string, number> = {
    'M': 8, 'T': 8, 'N': 8, 'D12': 12, 'N12': 12, 'PU': 12, 'EN': 9, 'F': 0, 'FF': 0, 'FP': 0, 'FT': 0, 'V': 0, 'L': 0, 'A': 0, 'E': 0, 'AA': 0, 'LT': 0, 'PG': 0, 'RET': 0, 'REF': 8, 'RFZ': 8, 'TURA': 8, 'ESC': 8, 'C': 8,
};

/**
 * Horas de banda para cupos 8h vs 12h.
 * Prioriza la definición del puesto en el SLA (ej. M custom 08–20 = 12h), no el lookup CCT estándar (M=8).
 */
const resolveBandHours = (
    code: string | undefined | null,
    shiftLike?: { hours?: unknown; startTime?: unknown; endTime?: unknown } | null,
    posShifts?: Array<{ code?: string; hours?: unknown; startTime?: unknown; endTime?: unknown }> | null,
): number => {
    const upper = String(code || '').toUpperCase();
    const fromSla = (posShifts || []).find((s) => String(s.code || '').toUpperCase() === upper);
    const slaH = Number(fromSla?.hours);
    if (slaH > 0) return slaH;
    const stored = Number(shiftLike?.hours);
    if (stored > 0) return stored;
    // Duración 08:00–20:00 si el turno la trae
    const st = fromSla?.startTime ?? shiftLike?.startTime;
    const en = fromSla?.endTime ?? shiftLike?.endTime;
    if (typeof st === 'string' && typeof en === 'string') {
        const parseH = (t: string) => {
            const m = t.match(/^(\d{1,2}):(\d{2})$/);
            return m ? +m[1] + +m[2] / 60 : null;
        };
        const s = parseH(st);
        const e = parseH(en);
        if (s !== null && e !== null) {
            let dur = e - s;
            if (dur <= 0) dur += 24;
            if (dur > 0 && dur <= 24) return dur;
        }
    }
    return SHIFT_HOURS_LOOKUP[upper] ?? 8;
};

const isShortBandHours = (hours: number) => hours < 12;

/** Puestos 24hs usan esquema CCT M+T+N / D12+N12. Custom: turnos con nombre libre. */
const is24hCoverageType = (pos: { coverageType?: unknown } | null | undefined): boolean => {
    const cov = String(pos?.coverageType || '').toLowerCase();
    return cov === '24hs' || cov === '24' || cov === '24h';
};

/** No computan como "hs planificadas de cobertura" en el objetivo (retén, francos, licencias). */
const OBJECTIVE_NON_BILLABLE_CODES = PLANNING_NON_BILLABLE_CODES;

const calcShiftHours = (shift: any, slaHoursHint?: Record<string, number>): number => {
    if (!shift) return 0;
    const code = String(shift.code || '').toUpperCase();
    if (OBJECTIVE_NON_BILLABLE_CODES.has(code)) return 0;
    const stored = Number(shift.hours);
    if (stored > 0) return stored;
    // Firestore Timestamp
    if (shift.startTime?.seconds && shift.endTime?.seconds) {
        return Math.max(0, Math.min((shift.endTime.seconds - shift.startTime.seconds) / 3600, 24));
    }
    // String times "HH:MM" → "HH:MM" (shifts generados por el motor automático)
    if (typeof shift.startTime === 'string' && typeof shift.endTime === 'string') {
        const parseH = (t: string) => { const m = t.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] + +m[2] / 60 : null; };
        const s = parseH(shift.startTime), e = parseH(shift.endTime);
        if (s !== null && e !== null) {
            let dur = e - s;
            if (dur <= 0) dur += 24;
            return Math.max(0, Math.min(dur, 24));
        }
    }
    const fromLookup = SHIFT_HOURS_LOOKUP[code];
    if (fromLookup !== undefined) return fromLookup;
    // Códigos custom (RO, RON, etc.): horas definidas en el SLA del servicio
    if (slaHoursHint?.[code] !== undefined) return slaHoursHint[code];
    return 8;
};

/** Turnos generados desde operaciones / reten — no son el crono planificado del objetivo. */
function isOperationalOriginShift(data: any): boolean {
    const o = String(data?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
    if (data?.resolvedBy === 'OPERACIONES') return true;
    if (data?.isReten === true) return true;
    return false;
}

/**
 * Publicado = tiene publishedAt. El doc planificacion_estados también guarda
 * defaultPositionByEmp (asignación de puestos) sin publicar el cronograma.
 */
function isPlanificacionPublished(
    status: { publishedAt?: unknown; publishedBy?: string } | null | undefined,
): boolean {
    return status != null && status.publishedAt != null && status.publishedAt !== '';
}

/**
 * Horas CCT / pie de grilla: solo turnos del objetivo en pantalla y NO operativos.
 * Importante: los borradores (draft:true) sí cuentan — son el crono planificado todavía
 * no publicado, hay que verlos en la grilla y sumarlos.
 * Evita "200h en abril" por turnos de OTRO objetivo o cobertura de ops mezclados en
 * `turnos` con la misma fecha+empleado.
 */
function turnoCuentaParaCronoPlanificado(data: any, objectiveId: string | undefined | null): boolean {
    if (!data || !objectiveId) return false;
    if (String(data.objectiveId || '') !== String(objectiveId)) return false;
    if (isOperationalOriginShift(data)) return false;
    return true;
}

const OTHER_OBJECTIVE_CELL_STYLE =
    'bg-slate-700 text-slate-200 border-slate-600 ring-2 ring-slate-500 ring-offset-2 dark:ring-offset-slate-900 font-bold opacity-90';

function isShiftAtOtherObjective(
    s: any,
    p: any,
    selectedObjective: string | null | undefined,
): boolean {
    if (!selectedObjective) return false;
    if (p?.isDeleted) return false;
    const active = p && !p.isDeleted ? p : s;
    if (!active) return false;
    const obj = active.objectiveId;
    if (obj == null || obj === '') return false;
    return String(obj) !== String(selectedObjective);
}

/** Turno visible en celda del crono para el objetivo activo (pending o publicado). */
function resolveCellShiftAtObjective(
    empId: string,
    dateStr: string,
    selectedObjective: string | undefined | null,
    pendingChanges: Record<string, any>,
    shiftsMap: Record<string, any>,
): any | null {
    if (!selectedObjective) return null;
    const key = `${empId}_${dateStr}`;
    const pending = pendingChanges[key];
    const existing = shiftsMap[key];
    if (pending?.isDeleted) return null;
    const activeShift = pending && !pending.isDeleted ? pending : existing;
    if (!activeShift) return null;
    if (pending && !pending.isDeleted) {
        const obj = activeShift.objectiveId;
        if (obj != null && obj !== '' && String(obj) !== String(selectedObjective)) return null;
        return activeShift;
    }
    if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return null;
    return activeShift;
}

const getDateKey = (dateInput: any) => {
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' };
    const parts = new Intl.DateTimeFormat('es-AR', options).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    return `${year}-${month}-${day}`;
};

const isDateLocked = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const cellDate = new Date(y, m - 1, d);
    cellDate.setHours(23, 59, 59, 999); 
    const startOfToday = new Date();
    startOfToday.setHours(0,0,0,0);
    return cellDate < startOfToday; 
};

const getDefaultStyle = (code: string) => SHIFT_STYLES[code] || 'bg-slate-100 text-slate-700 border-slate-300';

const formatTime = (dateInput: any) => {
    if (!dateInput) return '--:--';
    // String "HH:MM" — retornar directamente (new Date("HH:MM") → Invalid Date)
    if (typeof dateInput === 'string' && /^\d{1,2}:\d{2}$/.test(dateInput.trim())) return dateInput.trim();
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const ACTION_LABELS: Record<string, string> = {
    'ASIGNACION': 'Asignación', 'ELIMINACION': 'Eliminación', 'EDICION_MASIVA': 'Edición Masiva',
    'ASIGNACION_MASIVA': 'Asignación Múltiple', 'CAMBIO_FRANCO_TURNO': 'Franco x Turno (FT)', 'CAMBIO_TURNO_FRANCO': 'Turno x Franco (FF)',
    'Devolución a Planificación': 'Devolución desde Operaciones',
    'PUBLICACION_CRONOGRAMA': 'Publicación de cronograma',
    'DESPUBLICACION_CRONOGRAMA': 'Despublicación de cronograma',
    'CORRECCION_SUPERADMIN': 'Corrección (SuperAdmin)',
    'CORRECCION_PLANIFICACION': 'Corrección planificación',
    'CORRECCION_CODIGO': 'Corrección de código',
    'ELIMINACION_MASIVA': 'Eliminación masiva',
    'CAMBIO_DIAGRAMA': 'Cambio de diagrama',
    'TRANSFERENCIA_OBJETIVO': 'Transferencia de objetivo',
    'DESVINCULACION_OBJETIVO': 'Desvinculación de objetivo',
    'OVERRIDE_200H': 'Autorización >200h',
    'AUTORIZACION_FRANCO_COBERTURA': 'Autorización franco trabajado (cobertura)',
    'EQUILIBRAR_CRONOGRAMA': 'Equilibrar cronograma',
};

// Helper para día de la semana (0=Domingo -> 'D')
const getDayLetter = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    return days[date.getDay()];
};

const posAsEngineDef = (pos: any) => ({
    positionName: String(pos?.positionName ?? ''),
    qty: pos?.qty,
    shifts: pos?.shifts,
    activeDays: pos?.activeDays,
    coverageType: pos?.coverageType,
    excludedDates: pos?.excludedDates,
});

const isPosActiveOnDay = (pos: any, dayLetter: string): boolean =>
    positionIsActiveOn(posAsEngineDef(pos), dayLetter);

const isPosExcludedOnDate = (pos: any, dateStr: string): boolean =>
    isPlanningPositionExcludedOnDate(pos, dateStr);

interface Coords { r: number; c: number; }

const isShiftConsolidated = (shift: any) => {
    if (!shift) return false;
    if (shift.status === 'PRESENT' || shift.status === 'CHECK_IN' || shift.status === 'COMPLETED') return true;
    return false;
};

/** Normaliza documento RFZ para vista de celda / modal de turno. */
const rfzDocToShiftView = (rfz: any) => ({
    id: rfz.id,
    ...rfz,
    code: 'RFZ',
    type: rfz.type || 'Refuerzo Cliente',
    name: 'Refuerzo Cliente',
    objectiveId: rfz.objectiveId,
    startTime: rfz.startTime,
    endTime: rfz.endTime,
    positionName: rfz.positionName,
    draft: rfz.draft,
    hours: rfz.hours,
    isRfz: true,
    origin: rfz.origin || 'CLIENT_REQUEST',
    employeeId: rfz.employeeId,
    employeeName: rfz.employeeName,
});

export default function PlanificacionPage() {
    const { empresaId, empresa } = useEmpresa();
    const { rules: planningRules } = usePlanningRules(empresaId);
    const planningLimits = useMemo(
        () => planningHourLimits(planningRules),
        [planningRules],
    );
    const { isSuperAdmin, rolePermissions } = useAuth();
    const canPublishPlanning = isSuperAdmin || (rolePermissions['PLANNING'] || []).includes('publish');
    const canCorrectPlanning = isSuperAdmin || (rolePermissions['PLANNING'] || []).includes('correct');
    const migracionCompleta = (empresa as any)?.migracionCompleta === true;
    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

    // ============================================================================
    // 1. ESTADOS (NIVEL 0)
    // ============================================================================
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedClient, setSelectedClient] = useState('');
    const [selectedObjective, setSelectedObjective] = useState('');
    const [forceShowAll, setForceShowAll] = useState(false);
    const [nearbyKmRadius, setNearbyKmRadius] = useState(DOTACION_NEARBY_KM_DEFAULT);
    const [nearbyKmDraft, setNearbyKmDraft] = useState(String(DOTACION_NEARBY_KM_DEFAULT));
    const [isShowAllPending, startShowAllTransition] = useTransition();
    const [isFilterPending, startFilterTransition] = useTransition();
    const [showAjustarCronoModal, setShowAjustarCronoModal] = useState(false);
    const [showEquilibrarModal, setShowEquilibrarModal] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [sortBy, setSortBy] = useState<'name' | 'activity' | 'client' | 'band' | 'position'>('activity');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [sortDropOpen, setSortDropOpen] = useState(false);
    const [bandDropOpen, setBandDropOpen] = useState(false);
    const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
    const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
    const [cronoFullscreen, setCronoFullscreen] = useState(false);
    const [statsBarCollapsed, setStatsBarCollapsed] = useState(false);

    const [employees, setEmployees] = useState<any[]>([]);
    const [slaIdToObjId, setSlaIdToObjId] = useState<Record<string, string>>({});
    const [shiftsMap, setShiftsMap] = useState<Record<string, any>>({});
    const [turaMap, setTuraMap] = useState<Record<string, any>>({});       // parentShiftId → turno TURA
    const [rfzVacantes, setRfzVacantes] = useState<any[]>([]);             // RFZ sin guardia asignado
    const [rfzTodos, setRfzTodos] = useState<any[]>([]);                  // RFZ del mes (asignados + vacantes) para fila de refuerzos
    const [rfzAsignando, setRfzAsignando] = useState<any>(null);          // RFZ vacante abierto para asignación
    // allShiftIds[empId_dateKey] = array de TODOS los doc IDs para esa clave.
    // shiftsMap solo guarda el último (sobrescribe), pero necesitamos borrar TODOS al guardar.
    const [allShiftIds, setAllShiftIds] = useState<Record<string, string[]>>({});
    const [absencesMap, setAbsencesMap] = useState<Record<string, any>>({});
    const [clients, setClients] = useState<any[]>([]);
    const [agreements, setAgreements] = useState<any[]>([]);
    const [unifiedLogs, setUnifiedLogs] = useState<any[]>([]);
    const [notifLogs, setNotifLogs] = useState<any[]>([]);
    const [activityTab, setActivityTab] = useState<'cambios' | 'notifs'>('cambios');
    const [showActivityModal, setShowActivityModal] = useState(false);
    const [latestLog, setLatestLog] = useState<any>(null);
    const prevLatestLogId = useRef<string | null>(null);
    const latestLogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [customOrderMap, setCustomOrderMap] = useState<Record<string, string[]>>(() => {
        if (typeof window === 'undefined') return {};
        try { return JSON.parse(localStorage.getItem('planif_emp_order') || '{}'); } catch { return {}; }
    });
    const [dragOverVisual, setDragOverVisual] = useState<number | null>(null);
    const [shiftTooltip, setShiftTooltip] = useState<{ label: string | null; pos: string | null; range: string | null; x: number; y: number; restHours?: number | null } | null>(null);
    const [coverageTooltip, setCoverageTooltip] = useState<{
        dateStr: string;
        gaps: { positionName: string; code: string; missing: number; detail?: string }[];
        x: number;
        y: number;
    } | null>(null);
    const [showCoverageDiagnostic, setShowCoverageDiagnostic] = useState(false);
    const [columnSelectMode, setColumnSelectMode] = useState(false);
    const [columnSelectSource, setColumnSelectSource] = useState<number | null>(null);
    const [openDrop, setOpenDrop] = useState<'client' | 'objective' | null>(null);
    const longPressTimer = useRef<any>(null);
    const [empDefaultPos, setEmpDefaultPos] = useState<Record<string, string>>({});
    const [empDefaultShift, setEmpDefaultShift] = useState<Record<string, string>>({});
    const dotacionMigratedRef = useRef(false);
    const [empPosPicker, setEmpPosPicker] = useState<{ empId: string; x: number; y: number; maxHeight: number; floating?: boolean } | null>(null);
    const [deployBandPicker, setDeployBandPicker] = useState<'SURPLUS' | 'TRAINING' | null>(null);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [notifPanelTop, setNotifPanelTop] = useState(0);
    const notifBtnRef = useRef<HTMLButtonElement>(null);
    const diagnosticBtnRef = useRef<HTMLButtonElement>(null);
    const coverageDiagnosticBtnRef = useRef<HTMLButtonElement>(null);
    const [diagnosticPanelPos, setDiagnosticPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [coveragePanelPos, setCoveragePanelPos] = useState<{ x: number; y: number } | null>(null);
    const [hasUnread, setHasUnread] = useState(false);
    
    const [operatorName, setOperatorName] = useState('Cargando...');
    const [operatorEmail, setOperatorEmail] = useState('');
    const [usersMap, setUsersMap] = useState<Record<string, string>>({}); 

    const [positionStructure, setPositionStructure] = useState<any[]>([]);
    const [slaVendidas, setSlaVendidas] = useState<number>(0);
    const [showDiagnostic, setShowDiagnostic] = useState<boolean>(false);
    const [publishStatusMap, setPublishStatusMap] = useState<Record<string, { publishedAt: any; publishedBy: string } | null>>({});
    const [needsRepublishMap, setNeedsRepublishMap] = useState<Record<string, boolean>>({});
    const [isPublishing, setIsPublishing] = useState(false);
    const [isUnpublishing, setIsUnpublishing] = useState(false);
    const [isRefreshingCrono, setIsRefreshingCrono] = useState(false);
    const [dataRefreshNonce, setDataRefreshNonce] = useState(0);
    const [publishConfirmModal, setPublishConfirmModal] = useState<{
        isRepublish: boolean;
        warnings: string[];
        superAdminOverride: boolean;
        objectiveName: string;
        periodLabel: string;
    } | null>(null);
    const [publishConfirmPin, setPublishConfirmPin] = useState('');
    const [publishConfirmPinError, setPublishConfirmPinError] = useState('');
    const [publishConfirmPinChecking, setPublishConfirmPinChecking] = useState(false);
    const [correctionMode, setCorrectionMode] = useState(false);
    const [cellEditMode, setCellEditMode] = useState(false);
    // 🛑 SYNC-CORE: Estado activo inicial null para forzar limpieza
    const [activePosition, setActivePosition] = useState<string | null>(null);
    const [hasActiveSLA, setHasActiveSLA] = useState<boolean>(true);
    const [slaPlanningHint, setSlaPlanningHint] = useState('');

    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [bandFilter, setBandFilter] = useState<string | null>(null);
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const [selectedCell, setSelectedCell] = useState<any>(null);

    const [authModal, setAuthModal] = useState<{
        pendingFn: (() => Promise<void>) | null;
        employees: { name: string; hours: number; detail?: string }[];
        operatorName?: string;
        isSaveFlow?: boolean;
        description?: React.ReactNode;
        auditAction?: string;
        auditDetails?: string;
    }>({ pendingFn: null, employees: [] });
    const [authPin, setAuthPin] = useState('');
    const [authError, setAuthError] = useState('');
    const [authLoading, setAuthLoading] = useState(false);

    const [pendingAssignment, setPendingAssignment] = useState<any>(null); 
    const [authWarningMessage, setAuthWarningMessage] = useState('');

    const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
    const [pendingNovedades, setPendingNovedades] = useState<Record<string, any>>({});
    const [selection, setSelection] = useState<{start: Coords | null, end: Coords | null}>({ start: null, end: null });
    const [isDragging, setIsDragging] = useState(false);

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyVersions, setHistoryVersions] = useState<any[]>([]);
    const [comparingSnapshot, setComparingSnapshot] = useState<any | null>(null);
    const [compareShowOnlyDiffs, setCompareShowOnlyDiffs] = useState(false);
    const [compareLayout, setCompareLayout] = useState<'side' | 'stack'>('side');
    const [showCompareDiffModal, setShowCompareDiffModal] = useState(false);
    const [showCompareSummaryModal, setShowCompareSummaryModal] = useState(false);

    const [francoMode, setFrancoMode] = useState<'NONE' | 'FT_SELECTION' | 'FF_WIZARD'>('NONE');
    const [showSwapModal, setShowSwapModal] = useState(false);
    const [swapConfig, setSwapConfig] = useState<any>(null);
    const [selectedSwapTarget, setSelectedSwapTarget] = useState('');
    const [selectedSwapDate, setSelectedSwapDate] = useState('');
    const [swapSearchTerm, setSwapSearchTerm] = useState(''); 
    const [targetFrancos, setTargetFrancos] = useState<any[]>([]);
    const [coverageStep, setCoverageStep] = useState(false);
    const [coverShift1, setCoverShift1] = useState('M');
    const [coverShift2, setCoverShift2] = useState('M');
    const [isShift1Fixed, setIsShift1Fixed] = useState(false);
    const [isShift2Fixed, setIsShift2Fixed] = useState(false);

    const [showRRHHModal, setShowRRHHModal] = useState(false);
    const [rrhhData, setRrhhData] = useState({ type: 'Injustificada', reason: '' });
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [conflictNeighbors, setConflictNeighbors] = useState<{prev: any, next: any} | null>(null);

    // Clipboard para copy/paste de celdas
    const [clipboard, setClipboard] = useState<Array<{relRow: number; relCol: number; shift: any | null}> | null>(null);
    const [clipboardDim, setClipboardDim] = useState<{rows: number; cols: number} | null>(null);
    const [prevMonthLoading, setPrevMonthLoading] = useState(false);
    const [autoGeneratedReady, setAutoGeneratedReady] = useState(false);
    const [autoCycles, setAutoCycles] = useState<string[]>([]);
    const autoSelectedCyclesRef = useRef<string[]>([]);
    const [autoOverwrite, setAutoOverwrite] = useState(false);
    const [useSixPlusOne, setUseSixPlusOne] = useState(false);
    /** true = forzar siempre 6+2 (default). false = dejar que el cerebro elija entre 6+2/6+1/4+2. */
    /** Tópico activo en el panel de ayuda del modal AUTO (hover sobre opciones). */
    const [autoHelpTopic, setAutoHelpTopic] = useState<string>('default');
    /** false = banda fija (M/T/N todo el mes). true = rotación por bloque 6+2/4+2 (MMMMMMFF→siguiente banda). */
    /** null = Auto decide; true/false = forzar rotativo ON/OFF */
    const [autoRotateForce, setAutoRotateForce] = useState<boolean | null>(null);
    const [autoAjustarCrono, setAutoAjustarCrono] = useState(false);
    /** Fechas manuales Contingencia (Modo 12 para liberar guardias / RET). */
    const [autoContingenciaDias, setAutoContingenciaDias] = useState<Set<string>>(() => new Set());
    const [autoPlanningBrainReport, setAutoPlanningBrainReport] = useState<AutoPlanningBrainResult | null>(null);
    const autoPlanningBrainRef = React.useRef<AutoPlanningBrainResult | null>(null);
    const autoPlanningBrainInputRef = React.useRef<Parameters<typeof resolveAutoPlanningBrain>[0] | null>(null);

    useEffect(() => {
        if (autoRotateForce === false && autoAjustarCrono) setAutoAjustarCrono(false);
    }, [autoRotateForce, autoAjustarCrono]);

    // ── Automatización COSP (viabilidad + motor determinístico) ──
    const [showAutoV2Modal, setShowAutoV2Modal] = useState(false);
    const [autoV2Loading, setAutoV2Loading] = useState(false);
    const [autoV2Generating, setAutoV2Generating] = useState(false);
    /** Barra de progreso en el modal de automatización (viabilidad / generar). */
    const [autoV2Progress, setAutoV2Progress] = useState<{ pct: number; label: string } | null>(null);
    const [autoV2Report, setAutoV2Report] = useState<import('@/lib/planificacion/autoScheduleEngineV2').V2FeasibilityReport | null>(null);
    const autoV2ReportRef = React.useRef<import('@/lib/planificacion/autoScheduleEngineV2').V2FeasibilityReport | null>(null);
    const [autoV2CoveragePreflight, setAutoV2CoveragePreflight] = useState<ObjectiveCoveragePreflight | null>(null);
    const [autoAbsencesMap, setAutoAbsencesMap] = useState<Record<string, Map<string, string>>>({});
    const [autoV2BudgetMode, setAutoV2BudgetMode] = useState<'cct'|'calendar'>('cct');
    const [autoV2ShowEmpDetail, setAutoV2ShowEmpDetail] = useState(false);
    // Stats post-generación (capacidad CCT por empleado)
    const [autoV2GenStats, setAutoV2GenStats] = useState<{
        employeeMonthlyHours: Record<string, number>;
        employeeCycleHours: { current: Record<string, number>; next: Record<string, number> };
        targetHours: number;
        totalBillableHours: number;
        /** Horas que realmente ve la grilla (pending + celdas no sobreescritas). */
        gridBillableHours?: number;
        cellsSkippedOverwrite?: number;
        uncoveredSlots: number;
        idleEmployeeIds?: string[];
        strandedEmployeeIds?: string[];
        relocatedEmployeeIds?: string[];
        primaryShiftByEmp?: Record<string, string | null>;
        positionGroups?: Record<string, string[]>;
        employeeRetCount?: Record<string, number>;
        employeeRetHoursPotential?: Record<string, number>;
        totalRetCount?: number;
        totalRetHoursPotential?: number;
        overCoverageRetDays?: number;
        maxRetConcurrent?: number;
        ajustarCrono?: boolean;
        apretarCronoDays?: string[];
        uncoveredSlotsByDay?: Record<string, { positionName: string; code: string; missing: number }[]>;
        excessPositionEmployees?: { positionName: string; assigned: number; needed: number; excess: number }[];
        slaDeficitRemaining?: number;
        slaHoursClosed?: boolean;
    } | null>(null);
    const [showCapacityModal, setShowCapacityModal] = useState(false);
    // Reporte de verificación de cobertura post-generación (V2)
    const [autoV2Coverage, setAutoV2Coverage] = useState<import('@/lib/planificacion/coverageVerification').CoverageVerificationReport | null>(null);
    const [autoV2FormReport, setAutoV2FormReport] = useState<import('@/lib/planificacion/scheduleFormValidator').ScheduleFormValidationReport | null>(null);
    const [autoV2RebalanceLog, setAutoV2RebalanceLog] = useState<FormRebalanceLogEntry[]>([]);
    const [autoV2Rebalancing, setAutoV2Rebalancing] = useState(false);
    const [autoV2Suggestions, setAutoV2Suggestions] = useState<import('@/lib/planificacion/scheduleOptimizationSuggestions').ScheduleChangeSuggestion[] | null>(null);
    const [showCoverageModal, setShowCoverageModal] = useState(false);
    // Snapshot de la última generación para reprocesar errores sin volver a llamar al motor
    const [autoV2LastRun, setAutoV2LastRun] = useState<{
        assignments: import('@/lib/planificacion/autoScheduleEngineV2').V2Assignment[];
        stats: import('@/lib/planificacion/autoScheduleEngineV2').V2GenerateStats;
        ctx: import('@/lib/planificacion/autoScheduleEngineV2').V2EngineContext;
    } | null>(null);
    const [autoV2Fixing, setAutoV2Fixing] = useState(false);
    const [autoV2RunGemini, setAutoV2RunGemini] = useState(false);
    const [autoCoverAbsences, setAutoCoverAbsences] = useState(false);
    const [autoV2TrailDiag, setAutoV2TrailDiag] = useState<Array<{
        id: string; nombre: string; puesto: string; puestoQty: number;
        lastBand: string; trailWork: number; trailRest: number;
        julioSlot?: number; julioBand?: string; diasFranco?: number;
    }> | null>(null);
    const [autoV2ShowTrailDiag, setAutoV2ShowTrailDiag] = useState(false);
    const [autoCoverageGaps, setAutoCoverageGaps] = useState<import('@/lib/planificacion/coverageEngine').CoverageGap[]>([]);
    const [planCoverageModalGaps, setPlanCoverageModalGaps] = useState<(import('@/lib/planificacion/coverageEngine').CoverageGap & { absentName?: string })[]>([]);
    const [coverageSelectedDays, setCoverageSelectedDays] = useState<Set<string>>(new Set());
    const [autoV2GeminiLoading, setAutoV2GeminiLoading] = useState(false);
    const [autoV2GeminiSummary, setAutoV2GeminiSummary] = useState<string | null>(null);
    const [autoWizardStep, setAutoWizardStep] = useState<'configure'|'detecting'|'verified'|'sla_open'|'done'>('configure');
    // Empleados bloqueados por cap 200h en la última generación
    const [capOverflowEmps, setCapOverflowEmps] = useState<{ empId: string; nombre: string }[]>([]);
    // IDs autorizados por supervisor para superar 200h (ref = valor síncrono para el engine)
    const [authorizedOver200Ids, setAuthorizedOver200Ids] = useState<Set<string>>(new Set());
    const authorizedOver200IdsRef = React.useRef<Set<string>>(new Set());
    // Slots de apertura del último mes generado — permite continuar el ciclo al generar el mes siguiente sin publicar.
    const lastGenOpeningRef = React.useRef<{
        year: number; month: number; objectiveId: string;
        openingSlotByEmp: Record<string, number>; daysCount: number;
    } | null>(null);
    // UI de autorización 200h en el wizard
    const [over200AuthChecked, setOver200AuthChecked] = useState<Record<string, boolean>>({});
    const [over200AuthPin, setOver200AuthPin] = useState('');
    const [over200AuthError, setOver200AuthError] = useState('');
    const [autoWizardPersonalize, setAutoWizardPersonalize] = useState(false);
    const [slaDebug, setSlaDebug] = useState<{ id: string; data: any } | null>(null);
    const [slaDebugLoading, setSlaDebugLoading] = useState(false);
    const [hoursMode, setHoursMode] = useState<'mes' | 'cct'>('mes');
    const [nameColWidth, setNameColWidth] = useState(150);
    const nameColResizing = React.useRef<{ startX: number; startW: number } | null>(null);

    const [showVacancyModal, setShowVacancyModal] = useState(false);
    const [vacancyData, setVacancyData] = useState<any>(null);
    const [selectedReplacement, setSelectedReplacement] = useState('');
    const [vacancyActiveDates, setVacancyActiveDates] = useState<Set<string>>(new Set());
    const [vacancyDayCoverages, setVacancyDayCoverages] = useState<Record<string, VacancyDayCoverage>>({});
    const [vacancyEditingDay, setVacancyEditingDay] = useState<string | null>(null);
    const [vacancyReplacementSearch, setVacancyReplacementSearch] = useState('');
    const [vacancyReplacementOpen, setVacancyReplacementOpen] = useState(false);
    const [vacancyPickerTab, setVacancyPickerTab] = useState<'substitute' | 'split'>('substitute');
    const [vacancySplitExtId, setVacancySplitExtId] = useState('');
    const [vacancySplitAdelId, setVacancySplitAdelId] = useState('');
    const [vacancyApplyToAllSelected, setVacancyApplyToAllSelected] = useState(true);
    const [vacancyFrancoAuthApproved, setVacancyFrancoAuthApproved] = useState(false);
    const vacancyReplacementPanelRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!vacancyData?.startDate) {
            setVacancyActiveDates(new Set());
            setVacancyDayCoverages({});
            return;
        }
        const all = listDateRangeInclusive(vacancyData.startDate, vacancyData.endDate || vacancyData.startDate);
        const focus = vacancyData.focusDate as string | undefined;
        const initialDates = focus && all.includes(focus) ? [focus] : all;
        setVacancyActiveDates(new Set(initialDates.length ? initialDates : all));
        setVacancyDayCoverages({});
        const activeCount = (initialDates.length ? initialDates : all).length;
        setVacancyApplyToAllSelected(activeCount > 1);
        if (activeCount > 1) {
            setVacancyEditingDay(null);
            setVacancyReplacementOpen(true);
        } else {
            const onlyDay = initialDates[0] || all[0] || null;
            setVacancyEditingDay(onlyDay);
            setVacancyReplacementOpen(!!onlyDay);
        }
        setSelectedReplacement('');
        setVacancyPickerTab('substitute');
        setVacancySplitExtId('');
        setVacancySplitAdelId('');
        setVacancyFrancoAuthApproved(false);
    }, [vacancyData]);

    useEffect(() => {
        if (showVacancyModal) {
            setVacancyReplacementSearch('');
        }
    }, [showVacancyModal]);

    useEffect(() => {
        if (!vacancyReplacementOpen) return;
        const t = window.setTimeout(() => {
            vacancyReplacementPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 50);
        return () => window.clearTimeout(t);
    }, [vacancyReplacementOpen]);
    
    const [modifiers, setModifiers] = useState({ plannedNovedad: '' });
    const [recompositionModalOpen, setRecompositionModalOpen] = useState(false);
    const [pendingRecompositionPackages, setPendingRecompositionPackages] = useState<RecompositionPackage[]>([]);
    const [showCronogramasOverview, setShowCronogramasOverview] = useState(false);

    const [showLegend, setShowLegend] = useState(false);
    const [selectedRef, setSelectedRef] = useState<string | null>(null);

    const setPageHeader = useSetPageHeader();
    useEffect(() => {
        setPageHeader({ compactSidebar: true });
        return () => setPageHeader({ compactSidebar: false });
    }, [setPageHeader]);

    const floatingInitialObjective = useMemo(() => {
        if (!selectedClient || !selectedObjective) return '';
        const objs = (clients.find((c) => c.id === selectedClient)?.objetivos || []) as any[];
        const other = objs.find((o) => (o.id || o.name) !== selectedObjective);
        return other ? (other.id || other.name) : selectedObjective;
    }, [clients, selectedClient, selectedObjective]);

    const repositionDiagnosticPanel = useCallback(() => {
        const rect = diagnosticBtnRef.current?.getBoundingClientRect();
        if (rect) setDiagnosticPanelPos({ x: rect.left, y: rect.bottom + 4 });
    }, []);

    const repositionCoveragePanel = useCallback(() => {
        const rect = coverageDiagnosticBtnRef.current?.getBoundingClientRect();
        if (rect) setCoveragePanelPos({ x: rect.left, y: rect.bottom + 4 });
    }, []);

    useEffect(() => {
        if (!showDiagnostic) return;
        repositionDiagnosticPanel();
        window.addEventListener('scroll', repositionDiagnosticPanel, true);
        window.addEventListener('resize', repositionDiagnosticPanel);
        return () => {
            window.removeEventListener('scroll', repositionDiagnosticPanel, true);
            window.removeEventListener('resize', repositionDiagnosticPanel);
        };
    }, [showDiagnostic, repositionDiagnosticPanel]);

    useEffect(() => {
        if (!showCoverageDiagnostic) return;
        repositionCoveragePanel();
        window.addEventListener('scroll', repositionCoveragePanel, true);
        window.addEventListener('resize', repositionCoveragePanel);
        return () => {
            window.removeEventListener('scroll', repositionCoveragePanel, true);
            window.removeEventListener('resize', repositionCoveragePanel);
        };
    }, [showCoverageDiagnostic, repositionCoveragePanel]);

    useEffect(() => {
        setToolbarCollapsed(localStorage.getItem('planif_toolbar_collapsed') === '1');
        setStatsBarCollapsed(localStorage.getItem('planif_stats_collapsed') === '1');
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (cronoFullscreen) setCronoFullscreen(false);
                if (toolbarMoreOpen) setToolbarMoreOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [cronoFullscreen, toolbarMoreOpen]);

    // ============================================================================
    // 2. UTILIDADES Y HELPERS (NIVEL 1 - Definidos ANTES de usarse)
    // ============================================================================

    const activeActorName = useMemo(() => {
        return usersMap[operatorEmail] || operatorName;
    }, [usersMap, operatorEmail, operatorName]);

    const daysInMonth = useMemo(() => { 
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1); 
        const days = []; 
        while (d.getMonth() === currentDate.getMonth()) { 
            days.push(new Date(d)); 
            d.setDate(d.getDate() + 1); 
        } 
        return days; 
    }, [currentDate]);

    const getObjectiveName = (objId: string) => {
        if (!objId) return 'Desconocido';
        for (const client of clients) {
            if (client.objetivos) {
                const found = client.objetivos.find((o: any) => (o.id || o.name) === objId);
                if (found) return found.name;
            }
        }
        return objId;
    };

    // 🛑 Helpers de dotación — stats precalculados evitan re-escaneos O(n×días) en cada filtro/orden
    const BAND_FILTERABLE = useMemo(() => new Set(['M', 'T', 'N', 'D12', 'N12', 'RET', 'REF', 'ESC']), []);

    const activeGuestIdsForObjective = useMemo(() => {
        if (!selectedObjective) return new Set<string>();
        const ids = new Set<string>();
        const planYear = currentDate.getFullYear();
        const planMonth = currentDate.getMonth(); // 0-indexed
        for (const [key, shift] of Object.entries(shiftsMap) as [string, any][]) {
            if (shift?.objectiveId === selectedObjective && shift?.employeeId) {
                // Key format: "${employeeId}_YYYY-MM-DD" — date is always last 10 chars
                const [sy, sm] = key.slice(-10).split('-').map(Number);
                if (sy === planYear && sm - 1 === planMonth) {
                    ids.add(shift.employeeId);
                }
            }
        }
        // Incluir empleados asignados temporalmente via pendingChanges (cobertura externa de planificación)
        for (const [key, change] of Object.entries(pendingChanges) as [string, any][]) {
            if (change?.objectiveId === selectedObjective && change?.employeeId && !change?.isDeleted) {
                const [cy, cm] = key.slice(-10).split('-').map(Number);
                if (cy === planYear && cm - 1 === planMonth) {
                    ids.add(change.employeeId);
                }
            }
        }
        return ids;
    }, [shiftsMap, pendingChanges, selectedObjective, currentDate]);

    const selectedObjectiveData = useMemo(() => {
        if (!selectedObjective || !selectedClient) return null;
        const client = clients.find((c: any) => c.id === selectedClient);
        if (!client) return null;
        return client.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective) || null;
    }, [clients, selectedClient, selectedObjective]);

    useEffect(() => {
        const km = readStoredNearbyKm();
        setNearbyKmRadius(km);
        setNearbyKmDraft(String(km));
    }, []);

    const countEmployeesWithinKm = useCallback((km: number) => {
        if (!selectedObjective || !selectedObjectiveData) return 0;
        const objLat = Number(selectedObjectiveData.lat ?? 0);
        const objLng = Number(selectedObjectiveData.lng ?? 0);
        const hasCoords = !!(objLat && objLng);
        let count = 0;
        for (const e of employees) {
            if (e.status === 'inactivo') continue;
            if (
                e.preferredObjectiveId === selectedObjective ||
                slaIdToObjId[e.preferredObjectiveId] === selectedObjective ||
                activeGuestIdsForObjective.has(e.id)
            ) {
                count++;
                continue;
            }
            if (!hasCoords) continue;
            const d = employeeKmToObjective(e, objLat, objLng);
            if (d !== null && d <= km) count++;
        }
        return count;
    }, [employees, selectedObjective, selectedObjectiveData, slaIdToObjId, activeGuestIdsForObjective]);

    const isEmployeeOnSelectedObjective = useCallback((e: { id: string; preferredObjectiveId?: string }) => {
        if (!selectedObjective) return false;
        return (
            e.preferredObjectiveId === selectedObjective ||
            slaIdToObjId[e.preferredObjectiveId] === selectedObjective ||
            activeGuestIdsForObjective.has(e.id)
        );
    }, [selectedObjective, slaIdToObjId, activeGuestIdsForObjective]);

    /** Dotación propia del objetivo (sin invitados ni cobertura de otro servicio). */
    const isEmployeeNativeToObjective = useCallback((e: { preferredObjectiveId?: string }) => {
        if (!selectedObjective || !e?.preferredObjectiveId) return false;
        return (
            e.preferredObjectiveId === selectedObjective ||
            slaIdToObjId[e.preferredObjectiveId] === selectedObjective
        );
    }, [selectedObjective, slaIdToObjId]);

    const clearNearbyCustomOrder = useCallback(() => {
        if (!selectedObjective) return;
        setCustomOrderMap(m => {
            const nm = { ...m };
            delete nm[selectedObjective];
            try { localStorage.setItem('planif_emp_order', JSON.stringify(nm)); } catch { /* ignore */ }
            return nm;
        });
    }, [selectedObjective]);

    const applyNearbyKm = useCallback((raw: number, opts?: { silent?: boolean }) => {
        const km = clampNearbyKm(raw);
        setNearbyKmRadius(km);
        setNearbyKmDraft(String(km));
        try { localStorage.setItem(NEARBY_KM_STORAGE_KEY, String(km)); } catch { /* ignore */ }
        startShowAllTransition(() => {
            setForceShowAll(true);
            clearNearbyCustomOrder();
        });
        if (opts?.silent) return;
        const count = countEmployeesWithinKm(km);
        if (count === 0) {
            toast.warning(`Ningún empleado a ≤${km} km. Ampliá el radio y volvé a buscar.`);
        }
    }, [clearNearbyCustomOrder, countEmployeesWithinKm]);

    const activateNearbyMode = useCallback(() => {
        startShowAllTransition(() => {
            setForceShowAll(true);
            clearNearbyCustomOrder();
        });
        const count = countEmployeesWithinKm(nearbyKmRadius);
        if (count === 0) {
            toast.warning(`Ningún empleado a ≤${nearbyKmRadius} km. Ampliá el radio y volvé a buscar.`);
        }
    }, [clearNearbyCustomOrder, countEmployeesWithinKm, nearbyKmRadius]);

    const dotacionBaseEmployees = useMemo(() => {
        if (!selectedObjective && !forceShowAll) return [];
        let list = employees.filter(e => e.status !== 'inactivo');
        if (selectedObjective && !forceShowAll) {
            list = list.filter(e =>
                e.preferredObjectiveId === selectedObjective ||
                slaIdToObjId[e.preferredObjectiveId] === selectedObjective ||
                activeGuestIdsForObjective.has(e.id),
            );
        } else if (selectedObjective && forceShowAll) {
            const objLat = Number(selectedObjectiveData?.lat ?? 0);
            const objLng = Number(selectedObjectiveData?.lng ?? 0);
            const hasCoords = !!(objLat && objLng);
            list = list.filter(e => {
                if (isEmployeeOnSelectedObjective(e)) return true;
                if (!hasCoords) return false;
                const km = employeeKmToObjective(e, objLat, objLng);
                return km !== null && km <= nearbyKmRadius;
            });
        }
        return list;
    }, [employees, selectedObjective, forceShowAll, slaIdToObjId, activeGuestIdsForObjective, selectedObjectiveData, nearbyKmRadius, isEmployeeOnSelectedObjective]);

    const employeeMonthStats = useMemo(() => {
        const stats: Record<string, { shiftCount: number; dominantBand: string | null }> = {};
        for (const emp of dotacionBaseEmployees) {
            const counts: Record<string, number> = {};
            let shiftCount = 0;
            for (const day of daysInMonth) {
                const key = `${emp.id}_${getDateKey(day)}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const sh = pending && !pending.isDeleted ? pending : existing;
                if (!sh) continue;
                if (pending) {
                    if (!pending.isDeleted) shiftCount++;
                } else if (existing && existing.objectiveId === selectedObjective) {
                    shiftCount++;
                }
                const code = String(sh.code || sh.shiftCode || '').toUpperCase();
                if (BAND_FILTERABLE.has(code)) counts[code] = (counts[code] ?? 0) + 1;
            }
            stats[emp.id] = {
                shiftCount,
                dominantBand: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
            };
        }
        return stats;
    }, [dotacionBaseEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, BAND_FILTERABLE]);

    const displayedEmployees = useMemo(() => {
        let list = dotacionBaseEmployees;
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            list = list.filter(e => e.name.toLowerCase().includes(q));
        }
        if (bandFilter) {
            list = list.filter(e => employeeMonthStats[e.id]?.dominantBand === bandFilter);
        }
        if (forceShowAll && selectedObjective && selectedObjectiveData) {
            const objLat = Number(selectedObjectiveData.lat ?? 0);
            const objLng = Number(selectedObjectiveData.lng ?? 0);
            const hasCoords = !!(objLat && objLng);
            return [...list].sort((a, b) => {
                const aAssigned = isEmployeeOnSelectedObjective(a);
                const bAssigned = isEmployeeOnSelectedObjective(b);
                if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
                if (!aAssigned && hasCoords) {
                    const da = employeeKmToObjective(a, objLat, objLng) ?? Infinity;
                    const db = employeeKmToObjective(b, objLat, objLng) ?? Infinity;
                    if (da !== db) return da - db;
                }
                return a.name.localeCompare(b.name);
            });
        }
        const orderKey = selectedObjective || '__all__';
        const customOrder = customOrderMap[orderKey];
        if (customOrder && customOrder.length > 0) {
            const orderMap: Record<string, number> = {};
            customOrder.forEach((id: string, i: number) => { orderMap[id] = i; });
            return [...list].sort((a: any, b: any) => {
                const ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 9999;
                const bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 9999;
                return ai - bi;
            });
        }
        const BAND_ORDER: Record<string, number> = { M: 0, T: 1, N: 2, D12: 3, N12: 4, RET: 5 };
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...list].sort((a, b) => {
            if (sortBy === 'activity') {
                const countA = employeeMonthStats[a.id]?.shiftCount ?? 0;
                const countB = employeeMonthStats[b.id]?.shiftCount ?? 0;
                if (countA !== countB) return (countB - countA) * dir;
            }
            if (sortBy === 'client') {
                const clientA = getObjectiveName(a.preferredObjectiveId);
                const clientB = getObjectiveName(b.preferredObjectiveId);
                const cmp = clientA.localeCompare(clientB);
                if (cmp !== 0) return cmp * dir;
            }
            if (sortBy === 'band') {
                const bandA = employeeMonthStats[a.id]?.dominantBand;
                const bandB = employeeMonthStats[b.id]?.dominantBand;
                const oa = bandA ? (BAND_ORDER[bandA] ?? 99) : 99;
                const ob = bandB ? (BAND_ORDER[bandB] ?? 99) : 99;
                if (oa !== ob) return (oa - ob) * dir;
            }
            if (sortBy === 'position') {
                const posA = empDefaultPos[`${a.id}___${selectedObjective}`] ?? '';
                const posB = empDefaultPos[`${b.id}___${selectedObjective}`] ?? '';
                if (!posA && posB) return 1;
                if (posA && !posB) return -1;
                const cmp = posA.localeCompare(posB);
                if (cmp !== 0) return cmp * dir;
            }
            return a.name.localeCompare(b.name) * dir;
        });
    }, [dotacionBaseEmployees, searchTerm, bandFilter, employeeMonthStats, sortBy, sortDir, selectedObjective, customOrderMap, empDefaultPos, clients, forceShowAll, selectedObjectiveData, isEmployeeOnSelectedObjective]);

    /** Guardias activos en dotación (excluye REF/ESC asignados como rol — no entran al auto ni al conteo). */
    const planningDotacionEmployees = useMemo(
        () => displayedEmployees.filter((e: any) => !isEmpExcludedFromPlanningDotacion(e, selectedObjective)),
        [displayedEmployees, selectedObjective],
    );

    // Bell de planificación = novedades + vacantes RFZ derivadas de turnos (scope confiable, independiente del pipeline de novedades).
    const bellNotifications = useMemo(() => {
        const novedadSolIds = new Set(
            (notifications || [])
                .map((n: any) => n.solicitudRefuerzoId)
                .filter(Boolean)
                .map((x: any) => String(x)),
        );
        const sinteticas = (rfzVacantes || [])
            .filter((rfz: any) => !rfz.solicitudRefuerzoId || !novedadSolIds.has(String(rfz.solicitudRefuerzoId)))
            .map((rfz: any) => {
                const s = formatTime(rfz.startTime);
                const e = formatTime(rfz.endTime);
                return {
                    id: `rfzvac_${rfz.id}`,
                    source: 'NOVEDAD',
                    type: 'REFUERZO_CLIENTE_PENDIENTE',
                    tipoSolicitud: 'RFZ',
                    title: `RFZ · ${rfz.positionName || 'Refuerzo'} · ${rfz.objectiveName || ''}`.trim(),
                    msg: `Vacante de refuerzo sin asignar (${s}–${e}) del ${rfz.fecha}. Tocá para asignar guardia.`,
                    objectiveId: rfz.objectiveId,
                    objectiveName: rfz.objectiveName,
                    clientId: rfz.clientId,
                    clientName: rfz.clientName,
                    fecha: rfz.fecha,
                    startTime: rfz.startTime,
                    endTime: rfz.endTime,
                    solicitudRefuerzoId: rfz.solicitudRefuerzoId,
                    createdAt: rfz.autorizadoAt || rfz.createdAt,
                    __rfz: rfz,
                };
            });
        return [...notifications, ...sinteticas];
    }, [notifications, rfzVacantes]);

    const rfzDraftPendientesMes = useMemo(() => {
        if (!selectedObjective) return [];
        const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        return rfzTodos.filter(rfz =>
            rfz.objectiveId === selectedObjective &&
            String(rfz.fecha || '').startsWith(monthPrefix) &&
            rfz.draft === true,
        );
    }, [selectedObjective, currentDate, rfzTodos]);

    /** RFZ asignados indexados por empleado+fecha para mostrar en la fila del guardia. */
    const rfzByEmpDate = useMemo(() => {
        const m: Record<string, any> = {};
        if (!selectedObjective) return m;
        const monthPrefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        for (const rfz of rfzTodos) {
            if (rfz.objectiveId !== selectedObjective) continue;
            if (!String(rfz.fecha || '').startsWith(monthPrefix)) continue;
            if (!rfz.employeeId || rfz.employeeId === 'VACANTE') continue;
            m[`${rfz.employeeId}_${rfz.fecha}`] = rfz;
        }
        return m;
    }, [rfzTodos, selectedObjective, currentDate]);

    const addModalEmployeeCandidates = useMemo(() => {
        const q = addSearchTerm.toLowerCase();
        let list = employees.filter(e => e.status !== 'inactivo' && e.name.toLowerCase().includes(q));
        if (!selectedObjective || !selectedObjectiveData) return list;
        const objLat = Number(selectedObjectiveData.lat ?? 0);
        const objLng = Number(selectedObjectiveData.lng ?? 0);
        const hasCoords = !!(objLat && objLng);
        list = list.filter(e => {
            if (isEmployeeOnSelectedObjective(e)) return true;
            if (!hasCoords) return false;
            const km = employeeKmToObjective(e, objLat, objLng);
            return km !== null && km <= nearbyKmRadius;
        });
        return [...list].sort((a, b) => {
            const aAssigned = isEmployeeOnSelectedObjective(a);
            const bAssigned = isEmployeeOnSelectedObjective(b);
            if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
            if (!aAssigned && hasCoords) {
                const da = employeeKmToObjective(a, objLat, objLng) ?? Infinity;
                const db = employeeKmToObjective(b, objLat, objLng) ?? Infinity;
                if (da !== db) return da - db;
            }
            return a.name.localeCompare(b.name);
        });
    }, [employees, addSearchTerm, selectedObjective, selectedObjectiveData, nearbyKmRadius, isEmployeeOnSelectedObjective]);

    // Horas por código custom (RO, RON, etc.) según definición del SLA activo.
    // Fallback en calcShiftHours para turnos guardados sin campo `hours` explícito.
    const slaCodeHoursHint = useMemo(() => {
        const hint: Record<string, number> = {};
        const parseH = (t: string) => { const m = t.match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] + +m[2] / 60 : null; };
        positionStructure.forEach((pos: any) => {
            (pos.shifts || []).forEach((sh: any) => {
                const code = String(sh.code || '').toUpperCase();
                if (!code || OBJECTIVE_NON_BILLABLE_CODES.has(code)) return;
                const n = Number(sh.hours);
                if (n > 0) { hint[code] = n; return; }
                if (typeof sh.startTime === 'string' && typeof sh.endTime === 'string') {
                    const s = parseH(sh.startTime), e = parseH(sh.endTime);
                    if (s !== null && e !== null) {
                        let dur = e - s; if (dur <= 0) dur += 24;
                        if (dur > 0) hint[code] = dur;
                    }
                }
            });
        });
        return hint;
    }, [positionStructure]);

    const empMonthlyHours = useMemo(() => {
        const result: Record<string, number> = {};
        displayedEmployees.forEach((emp: any) => {
            let total = 0;
            daysInMonth.forEach(day => {
                const key = `${emp.id}_${getDateKey(day)}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending && !pending.isDeleted ? pending : existing;
                if (!activeShift) return;
                const dateStr = getDateKey(day);
                const shiftPos = String(activeShift.positionName || emp.assignedPosition || '').trim();
                const posConfig = shiftPos
                    ? positionStructure.find((p: any) => p.positionName === shiftPos)
                    : undefined;
                if (posConfig && isPosExcludedOnDate(posConfig, dateStr)) return;
                if (pending && !pending.isDeleted) {
                    if (selectedObjective && activeShift.objectiveId != null && activeShift.objectiveId !== '' &&
                        String(activeShift.objectiveId) !== String(selectedObjective)) return;
                } else if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return;
                if (!shiftCountsForEmployeeCronoHours(activeShift)) return;
                total += calcShiftHours(activeShift, slaCodeHoursHint);
            });
            result[emp.id] = total;
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, slaCodeHoursHint, positionStructure]);

    // Días RET por empleado (0 h planificadas — sobrante disponible en otro objetivo).
    const empRetDays = useMemo(() => {
        const result: Record<string, number> = {};
        displayedEmployees.forEach((emp: any) => {
            let count = 0;
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const activeShift = resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap);
                if (activeShift && String(activeShift.code || '').toUpperCase() === 'RET') count++;
            });
            result[emp.id] = count;
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective]);

    // Celdas con descanso insuficiente (<12h o <35h post-racha) respecto a turnos adyacentes.
    const restViolationCells = useMemo(() => {
        const violated = new Set<string>();
        if (!displayedEmployees.length || !daysInMonth.length) return violated;
        const NON_WORK = new Set(['F','FF','FP','FT','V','L','A','E','PG','AA','RET']);
        const getShift = (empId: string, ds: string) => {
            const k = `${empId}_${ds}`;
            const p = pendingChanges[k];
            if (p) return p.isDeleted ? null : p;
            return shiftsMap[k] || null;
        };
        const cfg = { minRestBetweenShiftsHours: 12, longRestAfterWorkedHours: 48, minLongRestHours: 35 };
        for (const emp of displayedEmployees as any[]) {
            for (const day of daysInMonth) {
                const dateStr = getDateKey(day);
                const sh = getShift(emp.id, dateStr);
                if (!sh || sh.isDeleted) continue;
                const code = String(sh.code || '').toUpperCase();
                if (NON_WORK.has(code)) continue;
                const violation = checkRestBetweenShifts({
                    empId: emp.id, targetDateStr: dateStr,
                    proposed: { code, startTime: sh.startTime || undefined, hours: Number(sh.hours) || undefined },
                    getShift, cfg,
                });
                if (violation) violated.add(`${emp.id}_${dateStr}`);
            }
        }
        return violated;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap]);

    // Horas en el ciclo CCT actual (corre del 26 del mes anterior al 25 del mes activo).
    // Suma:
    //   - Cola del mes anterior (días 26..fin) → tomada de shiftsMap (no editable acá).
    //   - Días 1..25 del mes activo → toma pendingChanges si existe, si no shiftsMap.
    // Filtra códigos que no suman horas planificadas (RET, REF, ESC, F, FF, FP, FT, V, L, etc.).
    const empCctCurrentHours = useMemo(() => {
        const result: Record<string, number> = {};
        const yr = currentDate.getFullYear();
        const mo = currentDate.getMonth();
        // Cola del mes anterior: 26..fin
        const prevMonthDate = new Date(yr, mo - 1, 1);
        const prevYr = prevMonthDate.getFullYear();
        const prevMo = prevMonthDate.getMonth();
        const prevLast = new Date(yr, mo, 0).getDate();
        const tailDays: Date[] = [];
        for (let d = 26; d <= prevLast; d++) tailDays.push(new Date(prevYr, prevMo, d));
        // Mes activo: días 1..25
        const headDays = daysInMonth.filter((d: Date) => d.getDate() <= 25);
        const acumular = (empId: string, key: string, useShiftsMap: boolean) => {
            const pending = pendingChanges[key];
            const existing = shiftsMap[key];
            let activeShift: any = null;
            if (useShiftsMap) {
                activeShift = existing;
                if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return;
            } else if (pending && !pending.isDeleted) {
                activeShift = pending;
                if (selectedObjective && activeShift.objectiveId != null && activeShift.objectiveId !== '' &&
                    String(activeShift.objectiveId) !== String(selectedObjective)) return;
            } else {
                activeShift = existing;
                if (activeShift && !turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return;
            }
            if (!activeShift) return;
            if (!shiftCountsForEmployeeCronoHours(activeShift)) return;
            result[empId] = (result[empId] || 0) + calcShiftHours(activeShift, slaCodeHoursHint);
        };
        displayedEmployees.forEach((emp: any) => {
            result[emp.id] = 0;
            tailDays.forEach((d) => acumular(emp.id, `${emp.id}_${getDateKey(d)}`, true));
            headDays.forEach((d) => acumular(emp.id, `${emp.id}_${getDateKey(d)}`, false));
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, currentDate, selectedObjective, slaCodeHoursHint]);

    /** Conteos del mes basados en turnos reales del objetivo (no tamaño de dotación asignada). */
    const objectiveMonthShiftMetrics = useMemo(() => {
        const withBillableHours = new Set<string>();
        const withRetAtObjective = new Set<string>();
        let totalRetDays = 0;
        if (!selectedObjective) {
            return { empCountWithTurnos: 0, empCountBillable: 0, totalRetDays: 0 };
        }
        displayedEmployees.forEach((emp: any) => {
            if (!isEmployeeNativeToObjective(emp)) return;
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const activeShift = resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap);
                if (!activeShift) return;
                const code = String(activeShift.code || activeShift.shiftCode || '').toUpperCase();
                if (code === 'RET') {
                    totalRetDays++;
                    withRetAtObjective.add(emp.id);
                    return;
                }
                if (shiftCountsForEmployeeCronoHours(activeShift) && calcShiftHours(activeShift, slaCodeHoursHint) > 0) {
                    withBillableHours.add(emp.id);
                }
            });
        });
        const withTurnos = new Set<string>([...withBillableHours, ...withRetAtObjective]);
        return {
            empCountWithTurnos: withTurnos.size,
            empCountBillable: withBillableHours.size,
            totalRetDays,
        };
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, slaCodeHoursHint, isEmployeeNativeToObjective]);

    const retCount = useMemo(() => objectiveMonthShiftMetrics.totalRetDays, [objectiveMonthShiftMetrics.totalRetDays]);

    /** Dotación estructural necesaria para 6+2, calculada desde positionStructure (sin correr el motor). */
    const staffingReq6x2 = useMemo(() => {
        if (!positionStructure.length) return null;
        const FACTOR = 8 / 6;
        const perPos = positionStructure.map((pos: any) => {
            const qty = Math.max(1, Number(pos.qty) || 1);
            const cov = String(pos.coverageType || '').toLowerCase();
            const is24h = cov === '24hs' || cov === '24' || cov === '24h';
            const bandsPerDay = is24h ? 3 : Math.max(1, (pos.shifts || []).length);
            const slotsPerDay = qty * bandsPerDay;
            const needed = is24h ? Math.ceil(slotsPerDay * FACTOR) : slotsPerDay;
            return { positionName: pos.positionName, qty, is24h, bandsPerDay, needed };
        });
        const totalNeeded = perPos.reduce((s: number, p: any) => s + p.needed, 0);
        return { perPos, totalNeeded };
    }, [positionStructure]);

    // Colchón disponible (horas): si hoy se ausenta alguien, ¿cuánto se podría cubrir
    // promoviendo RETs a turno facturable sin pasar 200h por empleado?
    // Estimación: 8h por RET (turno típico), limitada por la capacidad restante de
    // cada empleado hasta 200h. Pesimista pero segura.
    const retBufferHours = useMemo(() => {
        let total = 0;
        displayedEmployees.forEach((emp: any) => {
            let empRetCount = 0;
            daysInMonth.forEach(day => {
                const dateStr = getDateKey(day);
                const activeShift = resolveCellShiftAtObjective(emp.id, dateStr, selectedObjective, pendingChanges, shiftsMap);
                if (activeShift && String(activeShift.code || '').toUpperCase() === 'RET') empRetCount++;
            });
            if (empRetCount === 0) return;
            const monthH = empMonthlyHours[emp.id] || 0;
            const spareToCap = Math.max(0, 200 - monthH);
            total += Math.min(empRetCount * 8, spareToCap);
        });
        return total;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, empMonthlyHours, selectedObjective]);

    // Calcula las horas totales de descanso de un bloque de francos consecutivos.
    // Incluye: horas restantes tras el último turno trabajado + 24h × días de franco + horas hasta el próximo turno.
    const calcFrancoRestHours = (empId: string, di: number): number | null => {
        const REST_CODES = new Set(['F','FF','FP','FT','V','L','A','E','AA','PG','RET']);
        const getShiftAt = (dayIdx: number) => {
            const day = daysInMonth[dayIdx];
            if (!day) return null;
            const key = `${empId}_${getDateKey(day)}`;
            const p = pendingChanges[key];
            const s = shiftsMap[key];
            return (p && !p.isDeleted) ? p : (s || null);
        };
        const isRestAt = (dayIdx: number): boolean => {
            const sh = getShiftAt(dayIdx);
            if (!sh) return false;
            return REST_CODES.has(String(sh.code||'').toUpperCase());
        };
        // Extender el bloque de francos en ambas direcciones
        let blockStart = di;
        while (blockStart > 0 && isRestAt(blockStart - 1)) blockStart--;
        let blockEnd = di;
        while (blockEnd < daysInMonth.length - 1 && isRestAt(blockEnd + 1)) blockEnd++;
        // Turno trabajado anterior al bloque (cualquier código no-franco, independiente de hours)
        let prevShift: any = null;
        for (let d = blockStart - 1; d >= 0; d--) {
            const sh = getShiftAt(d);
            if (sh && !sh.isFranco && !REST_CODES.has(String(sh.code||'').toUpperCase())) { prevShift = sh; break; }
        }
        // Turno trabajado posterior al bloque
        let nextShift: any = null;
        for (let d = blockEnd + 1; d < daysInMonth.length; d++) {
            const sh = getShiftAt(d);
            if (sh && !sh.isFranco && !REST_CODES.has(String(sh.code||'').toUpperCase())) { nextShift = sh; break; }
        }
        const blockDays = blockEnd - blockStart + 1;
        // Si no hay ningún turno adyacente, mostrar al menos la duración del bloque
        if (!prevShift && !nextShift) return blockDays * 24;
        const END_DEF:   Record<string,number> = { M:15, T:23, N:7, D12:19, N12:7 };
        const START_DEF: Record<string,number> = { M:7,  T:15, N:23, D12:7, N12:19 };
        const parseHour = (t: any): number | null => {
            if (!t || t === '00:00') return null;
            const parts = String(t).split(':').map(Number);
            const h = parts[0], m = parts[1] ?? 0;
            return isNaN(h) ? null : h + (m / 60);
        };
        // Configuración canónica del turno según el SLA (fuente más confiable)
        const getSLAShiftConfig = (code: string): any => {
            for (const pos of positionStructure) {
                const s = (pos.shifts || []).find((s: any) => String(s.code||'').toUpperCase() === code);
                if (s) return s;
            }
            return null;
        };
        const getEndH = (sh: any): number => {
            const code = String(sh?.code||'').toUpperCase();
            // 1) endTime del propio registro
            const fromEnd = parseHour(sh?.endTime);
            if (fromEnd !== null) return fromEnd;
            // 2) startTime + hours del registro (solo si hours > 0)
            const fromStart = parseHour(sh?.startTime);
            const hrs = Number(sh?.hours);
            if (fromStart !== null && hrs > 0) return (fromStart + hrs) % 24;
            // 3) configuración canónica del SLA
            const cfg = getSLAShiftConfig(code);
            if (cfg) {
                const cfgEnd = parseHour(cfg.endTime);
                if (cfgEnd !== null) return cfgEnd;
                const cfgStart = parseHour(cfg.startTime);
                const cfgHrs = Number(cfg.hours);
                if (cfgStart !== null && cfgHrs > 0) return (cfgStart + cfgHrs) % 24;
            }
            return END_DEF[code] ?? 15;
        };
        const getStartH = (sh: any): number => {
            const code = String(sh?.code||'').toUpperCase();
            // 1) startTime del registro
            const fromRecord = parseHour(sh?.startTime);
            if (fromRecord !== null) return fromRecord;
            // 2) configuración canónica del SLA
            const cfg = getSLAShiftConfig(code);
            if (cfg) {
                const cfgStart = parseHour(cfg.startTime);
                if (cfgStart !== null) return cfgStart;
            }
            return START_DEF[code] ?? 7;
        };
        // Turnos nocturnos (N, N12) terminan en el día siguiente.
        // En ese caso el primer día del bloque ya está contado en hoursAfterPrev,
        // por lo que se resta 1 para evitar el doble-cómputo.
        const prevEndH   = prevShift ? getEndH(prevShift) : null;
        const prevStartH = prevShift ? getStartH(prevShift) : null;
        const prevIsOvernight = prevEndH !== null && prevStartH !== null && prevEndH < prevStartH;
        const effectiveBlockDays = (prevShift && prevIsOvernight) ? Math.max(0, blockDays - 1) : blockDays;
        const hoursAfterPrev  = prevShift && prevEndH != null && !isNaN(prevEndH) ? (24 - prevEndH) : 0;
        const hoursBeforeNext = nextShift ? getStartH(nextShift) : 0;
        const total = hoursAfterPrev + effectiveBlockDays * 24 + hoursBeforeNext;
        return isNaN(total) ? blockDays * 24 : Math.round(total);
    };

    // ============================================================================
    // 4. LÓGICA DERIVADA (NIVEL 3)
    // ============================================================================

    const dominantPosition = useMemo(() => {
        if (positionStructure.length === 0) return { qty: 1, positionName: 'General' };
        return positionStructure.reduce((prev, current) => (Number(prev.qty || 0) > Number(current.qty || 0)) ? prev : current, positionStructure[0]);
    }, [positionStructure]);

    const STANDARD_SHIFTS_BASE = [
        { code: 'M',   name: 'Mañana',       hours: 8,  startTime: '07:00', endTime: '15:00' },
        { code: 'T',   name: 'Tarde',         hours: 8,  startTime: '15:00', endTime: '23:00' },
        { code: 'N',   name: 'Noche',         hours: 8,  startTime: '23:00', endTime: '07:00' },
        { code: 'D12', name: 'Diurno 12h',    hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', name: 'Nocturno 12h',  hours: 12, startTime: '19:00', endTime: '07:00' },
    ];

    const uniqueSLAShifts = useMemo(() => {
        const targetPos = activePosition || (positionStructure.length > 0 ? positionStructure[0].positionName : 'General');
        const pos = positionStructure.find(p => p.positionName === targetPos);
        return pos ? pos.shifts : [];
    }, [positionStructure, activePosition]);

    const genderRestrictedPositionsCount = useMemo(
        () => positionStructure.filter((p: any) => getPreferenciaGeneroUi(p.preferenciaGenero)).length,
        [positionStructure],
    );

    const renderPositionGeneroBadge = (pref: unknown, extraClass = '') => {
        const ui = getPreferenciaGeneroUi(pref);
        if (!ui) return null;
        return <span className={`${ui.badgeClass} ${extraClass}`.trim()} title={ui.title}>{ui.label}</span>;
    };

    // Turnos para la barra flotante de selección múltiple.
    // Combina turnos de todas las posiciones; si un código es de un solo puesto, guarda positionName.
    // Si ninguna posición tiene M/T/N/D12/N12, agrega los estándar como base mínima.
    const bulkShifts = useMemo(() => {
        const STANDARD_CODES = new Set(['M', 'T', 'N', 'D12', 'N12']);
        const byCode = new Map<string, any>();
        for (const pos of positionStructure) {
            for (const s of (pos.shifts || []) as any[]) {
                const codeKey = String(s.code || '').toUpperCase();
                if (!codeKey) continue;
                const prev = byCode.get(codeKey);
                if (!prev) {
                    byCode.set(codeKey, {
                        code: s.code,
                        name: s.name,
                        hours: s.hours,
                        startTime: s.startTime,
                        endTime: s.endTime,
                        positionName: pos.positionName,
                        ownerCount: 1,
                    });
                } else {
                    prev.ownerCount = (prev.ownerCount || 1) + 1;
                    // Ambiguo entre puestos: resolver por empleado al aplicar
                    prev.positionName = undefined;
                }
            }
        }
        const deduped = [...byCode.values()];
        const base = deduped.length > 0 ? deduped : uniqueSLAShifts;
        const hasStandard = base.some((s: any) => STANDARD_CODES.has(String(s.code || '').toUpperCase()));
        if (hasStandard) return base;
        const existingCodes = new Set(base.map((s: any) => String(s.code || '').toUpperCase()));
        const missing = STANDARD_SHIFTS_BASE.filter(s => !existingCodes.has(s.code));
        return [...missing, ...base];
    }, [uniqueSLAShifts, positionStructure]);

    const objectivePublishLookupKey = useMemo(() => {
        if (!selectedObjective) return '';
        return planificacionPublishLookupKey(
            selectedObjective,
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
        );
    }, [selectedObjective, currentDate]);

    const isCronogramaPublicado = isPlanificacionPublished(publishStatusMap[objectivePublishLookupKey]);

    /** Slots cerrados y fechas pasadas bloqueadas solo con cronograma publicado (salvo modo corrección). */
    const enforcePlanningClosureRules = isCronogramaPublicado && !correctionMode;

    const isPlanningDateLocked = useCallback(
        (dateStr: string) => (enforcePlanningClosureRules ? isDateLocked(dateStr) : false),
        [enforcePlanningClosureRules],
    );

    // Bloqueo por puesto/día: no mezclar 8h con 12h; solo permitir turnos del mismo grupo; cap 24h/día por PAX.
    const shiftButtonDisabledMap = useMemo(() => {
        const disabled = new Set<string>();
        if (!selectedCell?.dateStr || !selectedObjective || !uniqueSLAShifts.length) return disabled;
        const dateStr = selectedCell.dateStr;
        const posName = activePosition || (positionStructure[0]?.positionName) || 'General';
        // RET y francos nunca se bloquean por días; solo los turnos laborales reales
        const isWorking = (code: string) => !['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET'].includes(String(code || '').toUpperCase());

        // PAX del puesto actual
        const posConfig = positionStructure.find((p: any) => p.positionName === posName) || positionStructure[0];
        const pax = Math.max(1, Number(posConfig?.qty) || 1);

        const dayLetter = getDayLetter(dateStr);

        // Si el puesto no está activo hoy → bloquear todos los turnos laborales
        if (!isPosActiveOnDay(posConfig, dayLetter)) {
            uniqueSLAShifts.forEach((s: any) => {
                const code = String(s.code || '').toUpperCase();
                if (isWorking(code)) disabled.add(code);
            });
            return disabled;
        }

        // Día excluido por SLA (Servicios → días excluidos): sin turnos laborales en este puesto
        if (isPosExcludedOnDate(posConfig, dateStr)) {
            uniqueSLAShifts.forEach((s: any) => {
                const code = String(s.code || '').toUpperCase();
                if (isPlanningWorkShiftCode(code)) disabled.add(code);
            });
            disabled.add('RET');
            disabled.add('REF');
            disabled.add('ESC');
            return disabled;
        }

        // Shift-level: bloquear cada turno que tenga days[] y no incluya el día actual
        uniqueSLAShifts.forEach((s: any) => {
            const code = String(s.code || '').toUpperCase();
            if (!isWorking(code)) return;
            if (Array.isArray(s.days) && s.days.length > 0 && !s.days.includes(dayLetter)) {
                disabled.add(code);
            }
        });
        // Si todos los turnos laborales quedaron bloqueados, retornar early
        const workingInSLA = uniqueSLAShifts.filter((s: any) => isWorking(String(s.code || '').toUpperCase()));
        if (workingInSLA.length > 0 && workingInSLA.every((s: any) => disabled.has(String(s.code || '').toUpperCase()))) {
            return disabled;
        }

        // Fallback de positionName igual que calculateCoverageStats
        const dominant = positionStructure.reduce((prev: any, curr: any) => ((prev?.qty || 0) >= (curr?.qty || 0) ? prev : curr), positionStructure[0]);

        const assigned: { code: string; hours: number }[] = [];
        const posShiftsForBand = (posConfig?.shifts || uniqueSLAShifts || []) as any[];
        displayedEmployees.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
            if (!shift) return;
            const shiftPos = shift.positionName || dominant?.positionName || 'General';
            if (shiftPos !== posName) return;
            if (!isWorking(shift.code)) return;
            const objectiveMatch = shift.objectiveId === selectedObjective || !!pendingChanges[key];
            if (!objectiveMatch) return;
            const code = String(shift.code || shift.type || '').toUpperCase();
            const hours = resolveBandHours(code, shift, posShiftsForBand);
            assigned.push({ code, hours });
        });

        const is24hPos = is24hCoverageType(posConfig);

        // Custom: turnos con nombre libre — solo cupo por código (hasta pax) y cierre de esquema.
        // No aplicar mezcla 8h/12h (eso es de puestos 24hs M+T+N vs D12+N12).
        if (!is24hPos) {
            const codeCounts: Record<string, number> = {};
            assigned.forEach(a => { codeCounts[a.code] = (codeCounts[a.code] || 0) + 1; });
            const units = countPositionClosedUnitsFromShifts(
                posConfig,
                dayLetter,
                codeCounts,
                autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles,
                true,
            );
            const schemeFull = units.required > 0 && units.closed >= units.required;
            uniqueSLAShifts.forEach((s: any) => {
                const code = String(s.code || '').toUpperCase();
                if (!isWorking(code)) return;
                if (schemeFull) { disabled.add(code); return; }
                if ((codeCounts[code] || 0) >= pax) disabled.add(code);
            });
            return disabled;
        }

        const assigned8h = assigned.filter(a => isShortBandHours(a.hours)).map(a => a.code);
        const assigned12h = assigned.filter(a => !isShortBandHours(a.hours)).map(a => a.code);
        const shifts8h = uniqueSLAShifts.filter((s: any) => isShortBandHours(resolveBandHours(s.code, s, posShiftsForBand)));
        const shifts12h = uniqueSLAShifts.filter((s: any) => !isShortBandHours(resolveBandHours(s.code, s, posShiftsForBand)));
        // 24hs: M+T+N (8h) o D12+N12 (12h); cada código hasta pax
        const max8hSlots = shifts8h.length * pax;
        const max12hSlots = shifts12h.length * pax;

        uniqueSLAShifts.forEach((s: any) => {
            const code = String(s.code || '').toUpperCase();
            const hours = resolveBandHours(code, s, posShiftsForBand);
            const is8h = isShortBandHours(hours);

            if (pax === 1) {
                // 1 pax: no mezclar M+T+N con D12+N12
                if (assigned8h.length > 0 && assigned12h.length > 0) { disabled.add(code); return; }
                if (assigned8h.length > 0 && !is8h) { disabled.add(code); return; }
                if (assigned12h.length > 0 && is8h) { disabled.add(code); return; }
                if (assigned8h.filter(c => c === code).length >= 1) { disabled.add(code); return; }
                if (assigned12h.filter(c => c === code).length >= 1) { disabled.add(code); return; }
            } else {
                if (assigned8h.length > 0 && !is8h) { disabled.add(code); return; }
                if (assigned12h.length > 0 && is8h) { disabled.add(code); return; }
                const codeCount = assigned.filter(a => a.code === code).length;
                if (codeCount >= pax) { disabled.add(code); return; }
                if (assigned.length >= max8hSlots + max12hSlots) { disabled.add(code); return; }
            }
        });
        return disabled;
    }, [selectedCell?.dateStr, selectedObjective, activePosition, positionStructure, displayedEmployees, pendingChanges, shiftsMap, uniqueSLAShifts, autoCycles]);

    // 🛑 RESTAURADO: swapCandidates
    const swapCandidates = useMemo(() => { 
        if (!showSwapModal) return []; 
        return employees.filter(e => e.id !== swapConfig?.empId)
                        .filter(e => e.name.toLowerCase().includes(swapSearchTerm.toLowerCase()))
                        .sort((a, b) => a.name.localeCompare(b.name)); 
    }, [employees, showSwapModal, swapSearchTerm, swapConfig]);

    // 🛑 RESTAURADO + FIX: targetFrancos (solo fechas válidas para enroque)
    useEffect(() => {
        if (!selectedSwapTarget || !selectedCell?.empId || !selectedCell?.dateStr) {
            setTargetFrancos([]);
            return;
        }

        const getShiftInfo = (empId: string, dateStr: string) => {
            const k = `${empId}_${dateStr}`;
            const pending = pendingChanges[k];
            if (pending) return pending.isDeleted ? null : pending;
            return shiftsMap[k] || null;
        };

        const isWorkingCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());

        const dates: any[] = [];
        const seen = new Set<string>();

        // Regla: solo ofrecer francos del target (emp2) donde emp1 NO tenga turno asignado
        Object.values(shiftsMap).forEach((s: any) => {
            if (s.employeeId !== selectedSwapTarget) return;
            const isTargetFranco = (s.code === 'F' || s.isFranco) && !s.isFrancoTrabajado;
            if (!isTargetFranco) return;

            const dateStr = getDateKey(s.startTime);
            if (seen.has(dateStr)) return;
            if (isPlanningDateLocked(dateStr)) return;

            // Si emp1 ya trabaja en dateStr, no es válida (evita doble turno / transferencias)
            const emp1Shift = getShiftInfo(selectedCell.empId, dateStr);
            if (emp1Shift && isWorkingCode(emp1Shift.code)) return;

            // Si emp2 ya trabaja en date1 en OTRO objetivo, evitamos ofrecer (enroque no debe mover turnos cross-objetivo)
            const emp2ShiftAtDate1 = getShiftInfo(selectedSwapTarget, selectedCell.dateStr);
            if (emp2ShiftAtDate1 && isWorkingCode(emp2ShiftAtDate1.code) && emp2ShiftAtDate1.objectiveId && emp2ShiftAtDate1.objectiveId !== selectedObjective) return;

            const [, m, d] = dateStr.split('-');
            seen.add(dateStr);
            dates.push({ dateStr, label: `${d}/${m}` });
        });

        setTargetFrancos(dates.sort((a, b) => a.dateStr.localeCompare(b.dateStr)));
    }, [selectedSwapTarget, shiftsMap, pendingChanges, selectedCell?.empId, selectedCell?.dateStr, selectedObjective, isPlanningDateLocked]);

    const activeServiceStatus = useMemo(() => {
        if (!selectedClient || !selectedObjective) return { status: 'IDLE', msg: '', icon: null };
        const client = clients.find(c => c.id === selectedClient);
        if (!client) return { status: 'DELETED', msg: 'CLIENTE NO ENCONTRADO', icon: <Ghost size={20}/> };
        
        const obj = client.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective) ||
                    client.objetivos?.find((o: any) => o.name === getObjectiveName(selectedObjective));
        
        if (!obj) return { status: 'DELETED', msg: '⚠️ OBJETIVO ELIMINADO / NO EXISTE', icon: <Ghost size={20}/> };
        if (obj.status === 'INACTIVE' || obj.active === false) return { status: 'INACTIVE', msg: '⛔ SERVICIO SUSPENDIDO / INACTIVO', icon: <PowerOff size={20}/> };
        if (!hasActiveSLA) {
            const hint = slaPlanningHint ? ` (${slaPlanningHint})` : '';
            return { status: 'DELETED', msg: `⛔ SIN SERVICIO ACTIVO PARA ESTE MES — No se puede planificar${hint}`, icon: <Database size={20}/> };
        }
        
        if (obj.endDate) {
            const [y, m, d] = obj.endDate.includes('-') ? obj.endDate.split('-').map(Number) : [0,0,0];
            if (y > 0) {
                const end = new Date(y, m - 1, d);
                end.setHours(23, 59, 59, 999); 
                const viewStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
                if (viewStart > end) return { status: 'EXPIRED', msg: `⛔ CONTRATO FINALIZADO EL ${obj.endDate}`, icon: <LockKeyhole size={20}/> };
            }
        }
        return { status: 'ACTIVE', msg: 'OK', icon: <CheckCircle size={20}/> };
    }, [selectedClient, selectedObjective, clients, currentDate, hasActiveSLA, slaPlanningHint]);

    const isServiceLocked = activeServiceStatus.status !== 'ACTIVE' && activeServiceStatus.status !== 'IDLE';

    // ============================================================================
    // 5. MOTORES DE CÁLCULO (NIVEL 4 - SLA INTELLIGENCE V9.00)
    // ============================================================================

    const calculateCoverageStats = (dateStr: string, positionName: string, structure: any[], employeesList: any[], changes: any, existing: any) => {
        const posConfig = structure.find((p: any) => p.positionName === positionName) || structure[0] || { qty: 1, shifts: [], coverageType: '24hs' };
        const pax = Number(posConfig.qty) > 0 ? Number(posConfig.qty) : 1;
        const coverageType = posConfig.coverageType || 'custom';

        // 🛑 SLA INTELLIGENCE: Determinación de Meta
        let dailyHoursTarget = 24;

        if (coverageType === '24hs') {
            // Si es 24hs, la meta es estricta: 24h * pax, sin importar la suma de variantes
            dailyHoursTarget = 24;
        } else {
            // Si es custom, sumamos los turnos configurados
            if (posConfig.shifts && Array.isArray(posConfig.shifts) && posConfig.shifts.length > 0) {
                const shiftsSum = posConfig.shifts.reduce((acc: number, s: any) => acc + (Number(s.hours) || 8), 0);
                dailyHoursTarget = shiftsSum > 0 ? shiftsSum : 8;
            } else {
                dailyHoursTarget = 8; // Fallback
            }
        }

        // Verificación de Días Activos y exclusiones SLA
        const dayLetter = getDayLetter(dateStr);
        const isDayActive = isPosActiveOnDay(posConfig, dayLetter);
        const isDayExcluded = isPosExcludedOnDate(posConfig, dateStr);
        
        // Meta Final
        const target = isDayActive && !isDayExcluded ? (pax * dailyHoursTarget) : 0;

        let current = 0;
        const dominant = structure.reduce((prev: any, current: any) => (prev.qty > current.qty) ? prev : current, structure[0] || { qty: 1, positionName: 'General' });

        employeesList.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const absence = absencesMap[key];
            if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || existing[key]?.code, absence })) return;
            const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
            if (shift && (shift.objectiveId === selectedObjective || changes[key])) {
                let shiftPos = shift.positionName || dominant?.positionName || 'General';
                if (shiftPos === positionName && !OBJECTIVE_NON_BILLABLE_CODES.has(String(shift.code || '').toUpperCase())) {
                    current += calcShiftHours(shift, slaCodeHoursHint);
                }
            }
        });
        return { current, target, pax, isActiveDay: isDayActive && !isDayExcluded, isExcludedDay: isDayExcluded };
    };

    /**
     * Puestos cerrados por día: 1 pax = esquema SLA completo del puesto.
     * 24hs: M+T+N (24h) o D12+N12 (24h); custom: todas las bandas del turno (ej. M+T = 16h).
     */
    const countPositionClosedUnits = (
        dateStr: string,
        pos: any,
        dayLetter: string,
        employeesList: any[],
        changes: any,
        existing: any,
        cycles?: string[],
    ): { closed: number; required: number; schemeLabel: string } => {
        if (!isPosActiveOnDay(pos, dayLetter)) return { closed: 0, required: 0, schemeLabel: '' };
        if (isPosExcludedOnDate(pos, dateStr)) return { closed: 0, required: 0, schemeLabel: 'EXCL' };

        const dominant = (positionStructure || []).reduce(
            (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
            positionStructure[0] || { qty: 1, positionName: 'General' },
        );
        const codeCounts: Record<string, number> = {};
        employeesList.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const absence = absencesMap[key];
            if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || existing[key]?.code, absence })) return;
            const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
            if (!shift || !(shift.objectiveId === selectedObjective || changes[key])) return;
            const code = String(shift.code || '').toUpperCase();
            if (OBJECTIVE_NON_BILLABLE_CODES.has(code)) return;
            const shiftPos = shift.positionName || dominant?.positionName || 'General';
            if (shiftPos !== pos.positionName) return;
            codeCounts[code] = (codeCounts[code] || 0) + 1;
        });

        const splitCredits = collectSplitBandCreditsForDay(
            employeesList,
            dateStr,
            (empId, ds) => {
                const k = `${empId}_${ds}`;
                const pending = changes[k];
                if (pending?.isDeleted) return null;
                return pending ? pending : existing[k] || null;
            },
            {
                selectedObjective,
                isPendingChange: (empId, ds) => !!changes[`${empId}_${ds}`],
                resolveOriginalShift: (empId, ds) => existing[`${empId}_${ds}`] || null,
                shiftsMap: existing,
                pendingChanges: changes,
            },
        );
        const posCredits = lookupSplitCreditsForPosition(splitCredits, pos.positionName);
        for (const [bandCode, n] of Object.entries(posCredits)) {
            codeCounts[bandCode] = (codeCounts[bandCode] || 0) + n;
        }

        return countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cycles);
    };

    // 🛑 MEMOIZACIÓN CRÍTICA PARA EL MODAL
    const modalCoverageStats = useMemo(() => {
        if (!selectedCell || !selectedObjective) return null;
        const currentPosName = activePosition || selectedCell.currentShift?.positionName || (positionStructure.length > 0 ? positionStructure[0].positionName : 'General');
        const dateStr = selectedCell.dateStr;
        const dayLetter = getDayLetter(dateStr);
        const hoursStats = calculateCoverageStats(dateStr, currentPosName, positionStructure, displayedEmployees, pendingChanges, shiftsMap);
        const posConfig = positionStructure.find((p: any) => p.positionName === currentPosName) || positionStructure[0];
        const cycles = autoSelectedCyclesRef.current?.length ? autoSelectedCyclesRef.current : autoCycles;
        const units = posConfig
            ? countPositionClosedUnits(dateStr, posConfig, dayLetter, displayedEmployees, pendingChanges, shiftsMap, cycles)
            : { closed: 0, required: 0, schemeLabel: '' };
        return {
            ...hoursStats,
            closedUnits: units.closed,
            requiredUnits: units.required,
            schemeLabel: units.schemeLabel,
            isPositionClosed: units.required > 0 && units.closed >= units.required,
            isExcludedDay: hoursStats.isExcludedDay,
        };
    }, [selectedCell, activePosition, displayedEmployees, pendingChanges, shiftsMap, positionStructure, selectedObjective, autoCycles]);

    const coverageCyclesForObjective = autoSelectedCyclesRef.current?.length
        ? autoSelectedCyclesRef.current
        : autoCycles;

    const buildDayCodeCountsByPosition = (dateStr: string) => buildCodeCountsByPositionForDay(
        positionStructure || [],
        dateStr,
        dotacionBaseEmployees,
        (empId, ds) => {
            const key = `${empId}_${ds}`;
            const pending = pendingChanges[key];
            if (pending?.isDeleted) return { isDeleted: true };
            const shift = pending ? pending : shiftsMap[key];
            return shift ?? null;
        },
        {
            selectedObjective,
            dominantPositionName: dominantPosition?.positionName || 'General',
            isPendingChange: (empId, ds) => !!pendingChanges[`${empId}_${ds}`],
            existingShiftsMap: shiftsMap,
            pendingChangesMap: pendingChanges,
        },
    );

    const objectiveCoverageGapReport = useMemo(() => {
        if (!selectedObjective || !(positionStructure?.length)) return null;
        const days = daysInMonth.map(day => {
            const dateStr = getDateKey(day);
            return { dateStr, dayLetter: getDayLetter(dateStr) };
        });
        const codeCountsByDay: Record<string, Record<string, Record<string, number>>> = {};
        for (const { dateStr } of days) {
            codeCountsByDay[dateStr] = buildDayCodeCountsByPosition(dateStr);
        }
        return analyzeObjectiveCoverageGaps(
            positionStructure,
            days,
            codeCountsByDay,
            coverageCyclesForObjective,
            isPosActiveOnDay,
        );
    }, [selectedObjective, positionStructure, daysInMonth, dotacionBaseEmployees, pendingChanges, shiftsMap, coverageCyclesForObjective, dominantPosition]);

    const buildDayCoverageReport = (dateStr: string) => {
        if (!positionStructure?.length) return null;
        const dayLetter = getDayLetter(dateStr);
        const codeCounts = buildDayCodeCountsByPosition(dateStr);
        return analyzeDayCoverageGaps(
            positionStructure,
            dateStr,
            dayLetter,
            codeCounts,
            coverageCyclesForObjective,
            isPosActiveOnDay,
        );
    };

    const renderDayCoverageClosures = (dateStr: string, opts?: { compact?: boolean }) => {
        const dayReport = buildDayCoverageReport(dateStr);
        if (!dayReport || dayReport.required === 0) return null;
        const isFull = dayReport.isFull;
        const openPositions = dayReport.positions.filter(p => p.missingUnits > 0);
        return (
            <div className={`rounded-xl border-2 mb-4 ${isFull ? 'border-emerald-200 bg-emerald-50/90' : 'border-rose-300 bg-rose-50/90'} ${opts?.compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className={`text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 ${isFull ? 'text-emerald-800' : 'text-rose-800'}`}>
                        <ShieldCheck size={12}/>
                        Cierres de cobertura · día {dateStr.slice(8, 10)}
                    </p>
                    <span className={`text-xs font-black px-2 py-0.5 rounded-lg ${isFull ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'}`}>
                        {dayReport.closed}/{dayReport.required} pax
                    </span>
                </div>
                {isFull ? (
                    <p className="text-[10px] font-bold text-emerald-700">Esquema SLA completo en todos los puestos activos.</p>
                ) : (
                    <div className="space-y-1">
                        {openPositions.map(pg => (
                            <div key={pg.positionName} className="text-[10px] font-bold text-rose-800 leading-snug">
                                <span className="font-black">{pg.positionName}</span>
                                {pg.summary && !pg.summary.includes(';') ? (
                                    <span className="text-rose-600"> — {pg.summary}</span>
                                ) : (
                                    <>
                                        <span className="text-rose-600"> — faltan {pg.missingUnits} pax</span>
                                        {pg.schemeLabel && <span className="text-rose-500 font-medium"> ({pg.schemeLabel})</span>}
                                        {pg.summary && <p className="text-[9px] text-rose-600/90 font-medium mt-0.5">{pg.summary}</p>}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const getPositionDailyCoverage = (dateStr: string, positionName: string) => {
        return calculateCoverageStats(dateStr, positionName, positionStructure, displayedEmployees, pendingChanges, shiftsMap);
    };

    // Sincronización Reactiva del Modal
    useEffect(() => {
        if (selectedCell) {
            const empPreferred = empDefaultPos[`${selectedCell.empId}___${selectedObjective}`];
            const smartDefault = selectedCell.currentShift?.positionName || empPreferred || dominantPosition.positionName || 'General';
            // Si no hay turno asignado y hay exactamente un puesto con faltante, pre-seleccionarlo
            if (!selectedCell.currentShift) {
                const dayReport = buildDayCoverageReport(selectedCell.dateStr);
                const openPositions = dayReport ? dayReport.positions.filter((p: any) => p.missingUnits > 0) : [];
                if (openPositions.length === 1) {
                    setActivePosition(openPositions[0].positionName);
                    return;
                }
            }
            setActivePosition(smartDefault);
        } else {
            setActivePosition(null);
        }
    }, [selectedCell, dominantPosition, empDefaultPos, selectedObjective]);

    const getPositionHoursCoverage = (dateStr: string) => {
        const coverage: Record<string, { coveredHours: number, count: number }> = {};
        if (!selectedObjective) return coverage;
        displayedEmployees.forEach(emp => {
            const key = `${emp.id}_${dateStr}`;
            const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
            if (shift && (shift.objectiveId === selectedObjective || pendingChanges[key])) {
                if (OBJECTIVE_NON_BILLABLE_CODES.has(String(shift.code || '').toUpperCase())) return;
                const posName = shift.positionName || 'General';
                const hours = calcShiftHours(shift);
                if (!coverage[posName]) coverage[posName] = { coveredHours: 0, count: 0 };
                coverage[posName].coveredHours += hours;
                coverage[posName].count += 1;
            }
        });
        return coverage;
    };

    const checkLaborRules = (
        empId: string,
        targetDate: Date,
        newHours: number,
        proposedShift?: { code: string; startTime?: string; endTime?: string; hours?: number }
    ) => {
        const emp = employees.find((e: any) => e.id === empId);
        if (!emp) return null;
        const dateKey = getDateKey(targetDate);
        const key = `${empId}_${dateKey}`;
        if (absencesMap[key]) {
            return `ALERTA CRÍTICA: El empleado tiene una Ausencia Registrada (${absencesMap[key].type}) para esta fecha.`;
        }
        const rule =
            agreements.find((a: any) => a.name === emp.laborAgreement) ||
            agreements.find((a: any) => a.name === 'General') || {
                maxHoursWeekly: planningLimits.weekly,
                maxHoursMonthly: planningLimits.monthly,
            };
        const limitMonthly = parseInt(String((rule as any).maxHoursMonthly), 10) || planningLimits.monthly;
        const pendingShift = pendingChanges[key];
        const existingShift = shiftsMap[key];
        const finalShift = pendingShift ? (pendingShift.isDeleted ? null : pendingShift) : existingShift;
        if (finalShift && (finalShift.code === 'F' || finalShift.isFranco)) {
            return `ALERTA CRÍTICA: El empleado ya tiene un FRANCO asignado este día.`;
        }
        let monthlyTotal = 0;
        const daysInCurrentMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
        for (let d = 1; d <= daysInCurrentMonth; d++) {
            const checkDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), d);
            const k = `${empId}_${getDateKey(checkDate)}`;
            const p = pendingChanges[k];
            const s = shiftsMap[k];
            const active = p ? (p.isDeleted ? null : p) : s;
            if (!active) continue;
            const activeCode = String(active.code || '').toUpperCase();
            // RET, francos, licencias y ausencias NO suman horas trabajadas (son hs tácitas / no facturables).
            if (OBJECTIVE_NON_BILLABLE_CODES.has(activeCode)) continue;
            monthlyTotal += SHIFT_HOURS_LOOKUP[activeCode] || active.hours || 8;
        }
        if (monthlyTotal + newHours > limitMonthly) {
            return `ALERTA MENSUAL: Límite de ${limitMonthly}hs superado.`;
        }

        const restCfg = getAgreementRestConfig(emp, agreements);
        if (restCfg && proposedShift && String(proposedShift.code || '').toUpperCase() !== 'F') {
            const assignStart: Record<string, string> = {
                M: '07:00', T: '15:00', N: '23:00', D12: '07:00', N12: '19:00',
            };
            const codeU = String(proposedShift.code || 'M').toUpperCase();
            const proposedForRest = {
                code: codeU,
                startTime: proposedShift.startTime || assignStart[codeU] || '07:00',
                endTime: proposedShift.endTime,
                hours: proposedShift.hours ?? newHours,
            };
            const getMergedForRest = (eid: string, ds: string) => {
                const k2 = `${eid}_${ds}`;
                const p2 = pendingChanges[k2];
                const fromPending = p2 && !p2.isDeleted ? p2 : null;
                if (eid === empId && ds === dateKey) {
                    return { ...proposedForRest };
                }
                return fromPending || shiftsMap[k2] || null;
            };
            const restMsg = checkRestBetweenShifts({
                empId,
                targetDateStr: dateKey,
                proposed: proposedForRest,
                getShift: getMergedForRest,
                cfg: restCfg,
            });
            if (restMsg) return restMsg;
        }

        return null;
    };
    
    const findNeighbors = (problemShift: any, dateStr: string) => {
        const candidates: any[] = [];
        Object.values(shiftsMap).forEach((s: any) => {
            if (s.objectiveId === problemShift.objectiveId && getDateKey(s.startTime) === dateStr && s.id !== problemShift.id) {
                const key = `${s.employeeId}_${dateStr}`;
                if (!absencesMap[key]) {
                    candidates.push({ ...s, employeeName: employees.find(e => e.id === s.employeeId)?.name || 'Desconocido' });
                }
            }
        });
        candidates.sort((a,b) => a.startTime.seconds - b.startTime.seconds);
        const myStart = problemShift.startTime.seconds;
        let prev = null; let next = null;
        for (const cand of candidates) {
            if (cand.startTime.seconds < myStart) prev = cand;
            if (cand.startTime.seconds > myStart && !next) next = cand;
        }
        setConflictNeighbors({ prev, next });
    };

    const handleContextChange = (newClient: string, newObjective: string) => { if (Object.keys(pendingChanges).length > 0) { if (!confirm(`⚠️ TIENES CAMBIOS SIN GUARDAR.\n¿Descartar y cambiar de objetivo?`)) return; setPendingChanges({}); setPendingNovedades({}); } setSelectedClient(newClient); setSelectedObjective(newObjective); setSearchTerm(''); setBandFilter(null); setSelection({start: null, end: null}); setComparingSnapshot(null); setOpenDrop(null); setAutoGeneratedReady(false); };

    const navigateToObjectiveFromOverview = useCallback((clientId: string, objectiveId: string, year: number, month: number) => {
        if (Object.keys(pendingChanges).length > 0) {
            if (!confirm('⚠️ Tenés cambios sin guardar. ¿Descartar y abrir el objetivo?')) return;
            setPendingChanges({});
            setPendingNovedades({});
        }
        setSelectedClient(clientId);
        setSelectedObjective(objectiveId);
        setCurrentDate(new Date(year, month - 1, 1));
        setSearchTerm('');
        setBandFilter(null);
        setSelection({ start: null, end: null });
        setComparingSnapshot(null);
        setOpenDrop(null);
        setAutoGeneratedReady(false);
    }, []);
    useEffect(() => { if (!openDrop) return; const h = () => setOpenDrop(null); document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, [openDrop]);

    // ============================================================================
    // 6. EFECTOS Y SUBSCRIPCIONES (NIVEL 5)
    // ============================================================================

    const renderLegend = () => {
        const legendGroups = [
            {
                title: 'Turnos de Trabajo',
                items: [
                    { code: 'M',   name: 'Mañana',         sub: '07:00–15:00 · 8h · computa SLA' },
                    { code: 'T',   name: 'Tarde',           sub: '15:00–23:00 · 8h · computa SLA' },
                    { code: 'N',   name: 'Noche',           sub: '23:00–07:00 · 8h · computa SLA' },
                    { code: 'D12', name: 'Diurno 12h',      sub: '07:00–19:00 · 12h · computa SLA' },
                    { code: 'N12', name: 'Nocturno 12h',    sub: '19:00–07:00 · 12h · computa SLA' },
                    { code: 'PU',  name: 'Puesto Único',    sub: 'Horario personalizado' },
                ],
            },
            {
                title: 'Francos / Descansos',
                items: [
                    { code: 'F',  name: 'Franco',               sub: 'Descanso planificado CCT (6+2)' },
                    { code: 'FF', name: 'Franco compensatorio',  sub: 'Devolución de día trabajado' },
                    { code: 'FT', name: 'Franco Trabajado',      sub: 'Cubre ausencia — pago doble CCT' },
                ],
            },
            {
                title: 'Ausencias / Licencias',
                items: [
                    { code: 'V',  name: 'Vacaciones',       sub: 'Período vacacional planificado · pago' },
                    { code: 'L',  name: 'Licencia',         sub: 'Licencia general (art. CCT) · pago' },
                    { code: 'E',  name: 'Enfermedad',       sub: 'Baja médica con certificado · pago' },
                    { code: 'A',  name: 'ART / Autorizada', sub: 'Ausencia autorizada o ART · pago' },
                    { code: 'PG', name: 'Permiso Gremial',  sub: 'Actividad sindical · pago' },
                    { code: 'AA', name: 'Injustificada',    sub: 'Sin justificación ni cert. · sin pago · punto rojo' },
                ],
            },
            {
                title: 'Operativos (no computan SLA)',
                items: [
                    { code: 'RET', name: 'Retén (stand-by)',     sub: 'Disponible para cubrir ausencias' },
                    { code: 'REF', name: 'Refuerzo',             sub: 'Cobertura extra programada · 8h' },
                    { code: 'ESC', name: 'Escuela / formación',  sub: 'Capacitación en puesto · 8h' },
                ],
            },
            {
                title: 'Sistema',
                items: [
                    { code: 'C',            name: 'Consolidado',       sub: 'Turno fichado por el guardia · 8h' },
                    { code: 'LOCKED',       name: 'Bloqueado',         sub: 'Período cerrado o fecha pasada' },
                    { code: 'SWAP',         name: 'Permuta activa',    sub: 'Intercambio de turno confirmado' },
                    { code: 'SWAP_PENDING', name: 'Permuta pendiente', sub: 'Aguarda autorización del supervisor' },
                ],
            },
        ];

        const SectionHeader = ({ title }: { title: string }) => (
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{title}</span>
                <span className="flex-1 h-px bg-slate-100"/>
            </div>
        );

        return (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowLegend(false)}>
                <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl relative border border-slate-100 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl shadow-sm">
                                <Info size={22} strokeWidth={2.5}/>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-slate-800 tracking-tight">Referencias Operativas</h3>
                                <p className="text-slate-400 text-xs">CCT 422/05 — Seguridad Privada</p>
                            </div>
                        </div>
                        <button onClick={() => setShowLegend(false)} className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>

                    <div className="overflow-y-auto custom-scrollbar px-5 py-4 flex flex-col gap-4">
                        {legendGroups.map(group => (
                            <div key={group.title}>
                                <SectionHeader title={group.title}/>
                                <div className="grid grid-cols-2 gap-1">
                                    {group.items.map(item => (
                                        <div key={item.code} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                                            <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-black border shadow-sm ${SHIFT_STYLES[item.code] || 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                                                {item.code === 'SWAP_PENDING' ? 'S!' : item.code}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-slate-700 leading-tight">{item.name}</p>
                                                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.sub}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        <div>
                            <SectionHeader title="Indicadores de Estado"/>
                            <div className="grid grid-cols-2 gap-1">
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shrink-0 flex items-center justify-center">
                                        <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm ring-1 ring-slate-100"/>
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Presente</p>
                                        <p className="text-[10px] text-slate-400">Guardia confirmó presencia</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shrink-0 flex items-center justify-center">
                                        <div className="w-3 h-3 rounded-full bg-rose-500 border-2 border-white shadow-sm ring-1 ring-slate-100"/>
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Ausente</p>
                                        <p className="text-[10px] text-slate-400">No registró presencia · también en AA</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shrink-0 flex items-center justify-center">
                                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"/>
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Conflicto</p>
                                        <p className="text-[10px] text-slate-400">Turnos superpuestos detectados</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[9px] font-black border ${OTHER_OBJECTIVE_CELL_STYLE}`}>M</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Otro objetivo</p>
                                        <p className="text-[10px] text-slate-400">Turno en objetivo diferente</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-sm font-black text-pink-700 bg-pink-100 border border-pink-200">♀</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Solo femenino</p>
                                        <p className="text-[10px] text-slate-400">Puesto requiere guardia femenina</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-sm font-black text-blue-700 bg-blue-100 border border-blue-200">♂</div>
                                    <div>
                                        <p className="text-xs font-black text-slate-700">Solo masculino</p>
                                        <p className="text-[10px] text-slate-400">Puesto requiere guardia masculino</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    useEffect(() => {
        const loadUsers = async () => { 
            try { 
                const snap = await getDocs(collection(db, 'system_users')); 
                const map: Record<string, string> = {}; 
                snap.docs.forEach(d => { 
                    const u = d.data(); 
                    const displayName = (u.firstName && u.lastName) ? `${u.lastName} ${u.firstName}`.trim() : (u.name || u.email || ''); 
                    if (u.email) map[u.email] = displayName || u.email; 
                    if (d.id) map[d.id] = displayName || u.email || d.id; 
                }); 
                setUsersMap(map); 
            } catch (e) { console.error("Error loading users", e); } 
        };
        loadUsers();
        const auth = getAuth();
        onAuthStateChanged(auth, (user) => { if (user) { setOperatorEmail(user.email || ''); setOperatorName(user.displayName || user.email || "Usuario"); } else { setOperatorName("No Logueado"); } });
    }, []);

    const tenantClientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);

    // 🛑 V8.60 - SELECCIÓN DE SERVICIO POR FECHA: usa la versión de servicios_sla vigente para el mes visualizado
    useEffect(() => {
        if (!selectedClient || !selectedObjective) {
            setPositionStructure([]);
            setHasActiveSLA(true);
            setSlaVendidas(0);
            setSlaPlanningHint('');
            return;
        }
        const fetchSLA = async () => {
            try {
                const snap = await getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa));
                const allDocs = filterSlasForPlanningTenant(
                    snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
                    empresaId,
                    scopeEmpresa,
                    tenantClientIds,
                );
                const clientDocs = allDocs.filter((d) =>
                    slaBelongsToPlanningClient(d, selectedClient, clients),
                );
                const matching = filterSlasForPlanningContext(
                    allDocs,
                    selectedClient,
                    selectedObjective,
                    clients,
                    slaIdToObjId,
                );

                const viewYear = currentDate.getFullYear();
                const viewMonth = currentDate.getMonth();
                const { vigente: srv, hasExactMatch, fallback } = pickSlaForPlanningMonth(matching, viewYear, viewMonth);
                const srvForStructure = srv ?? fallback;
                const monthHasSla = planningMonthHasActiveSla(matching, viewYear, viewMonth);

                if (!monthHasSla) {
                    if (matching.length > 0) {
                        setSlaPlanningHint(`contratos del objetivo: ${formatSlaRangeHint(matching)}`);
                    } else if (clientDocs.length > 0) {
                        setSlaPlanningHint(`${clientDocs.length} contrato(s) del cliente no vinculan a este objetivo — revisá Servicios`);
                    } else if (allDocs.length > 0) {
                        setSlaPlanningHint(`${allDocs.length} contrato(s) en Servicios no coinciden con este cliente (revisá clientId tras restore)`);
                    } else {
                        setSlaPlanningHint('sin contratos en Servicios para este cliente');
                    }
                } else {
                    setSlaPlanningHint('');
                }

                const { structure, usedSlaFallback } = buildPlanningPositionStructure(srvForStructure, {
                    monthHasSla,
                    hasExactMatch,
                });
                if (structure.length === 0) {
                    console.warn('CRONO: Sin contrato SLA para este mes; estructura mínima de respaldo.');
                    structure.push({
                        positionName: 'General',
                        shifts: DEFAULT_PLANNING_SHIFTS.map((s) => ({ ...s })),
                        qty: 1,
                        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
                        coverageType: '24hs',
                    });
                } else if (usedSlaFallback) {
                    console.info('CRONO: Contrato SLA vigente sin puestos/turnos configurados; usando M/T/N por defecto.');
                }
                setHasActiveSLA(monthHasSla);
                setPositionStructure(structure);
                setSlaVendidas(monthHasSla ? (Number(srvForStructure?.totalMonthlyHours) || 0) : 0);
            } catch (e) {
                console.error("CRONO SLA ERROR:", e);
                setPositionStructure([{ positionName: 'ERROR', shifts: [], qty: 1 }]);
                setHasActiveSLA(false);
                setSlaVendidas(0);
                setSlaPlanningHint('error al cargar contratos');
            }
        };
        fetchSLA();
    }, [selectedClient, selectedObjective, currentDate, empresaId, migracionCompleta, scopeEmpresa, clients, tenantClientIds, slaIdToObjId, dataRefreshNonce]);

    // LISTENER DE NOVEDADES Y OTROS DATOS
    useEffect(() => {
        getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa)).then(snap => {
            const m: Record<string, string> = {};
            snap.docs.forEach(d => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                if (d.data().objectiveId) m[d.id] = d.data().objectiveId;
            });
            setSlaIdToObjId(m);
        }).catch(() => {});

        const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
        const empleadosQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);

        const unsubC = onSnapshot(clientsQ, snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setClients(dedupeClientsById(filterRowsByEmpresa(rows, empresaId, scopeEmpresa, migracionCompleta)));
        }, (e) => console.error('[plan] clients error:', e));
        const unsubAg = onSnapshot(collection(db, 'convenios_colectivos'), snap => setAgreements(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error('[plan] convenios error:', e));
        const unsubE = onSnapshot(empleadosQ, snap => {
            const map = (s: typeof snap) => s.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        name: data.name || data.firstName + ' ' + data.lastName,
                        preferredObjectiveId: data.preferredObjectiveId,
                        planificacionDotacion: (data.planificacionDotacion || {}) as PlanificacionDotacionMap,
                        genero: data.genero || '',
                        experienciaObjetivos: data.experienciaObjetivos || {},
                        laborAgreement: data.laborAgreement,
                        status: data.status || 'activo',
                        lat: data.lat ?? data.latitude ?? null,
                        lng: data.lng ?? data.longitude ?? null,
                        address: data.address || '',
                        restriccionesObjetivo: data.restriccionesObjetivo || [],
                        restriccionesCliente: data.restriccionesCliente || [],
                        conflictosEmpleados: data.conflictosEmpleados || [],
                    };
                });
            setEmployees(map(snap));
        }, (e) => console.error('[plan] empleados error:', e));

        const turnosQ = empresaCollectionQuery('turnos', empresaId, scopeEmpresa);
        const unsubS = onSnapshot(turnosQ, snap => {
            const map: any = {};
            const allIds: Record<string, string[]> = {};
            const turaM: Record<string, any> = {};
            const rfzVacs: any[] = [];
            const rfzAll: any[] = [];
            snap.docs.forEach(d => {
                const data = d.data();
                if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
                const code = (data.code || data.type || '').toString().toUpperCase();

                // TURA: indexar por parentShiftId para mostrar indicador en celda padre
                if (code === 'TURA' && data.parentShiftId) {
                    turaM[data.parentShiftId] = { id: d.id, ...data };
                    return;
                }
                // RFZ: siempre como fila de refuerzo separada (asignado o vacante).
                // Su startTime suele ser string ISO → no entra en shiftsMap (grilla regular).
                if (code === 'RFZ') {
                    const rfzData = { id: d.id, ...data };
                    rfzAll.push(rfzData);
                    if (!data.employeeId || data.employeeId === 'VACANTE') rfzVacs.push(rfzData);
                    return;
                }

                if (data.startTime?.seconds) {
                    const dateKey = getDateKey(data.startTime);
                    const key = `${data.employeeId}_${dateKey}`;
                    // Rastrear TODOS los doc IDs para esta clave (puede haber duplicados en Firestore)
                    if (!allIds[key]) allIds[key] = [];
                    allIds[key].push(d.id);
                    // shiftsMap solo guarda el último (comportamiento original)
                    map[key] = {
                        id: d.id, ...data, code: data.code || data.type, objectiveId: data.objectiveId,
                        startTime: data.startTime, endTime: data.endTime, realStartTime: data.realStartTime,
                        status: data.status, isPresent: data.isPresent || false, isAbsent: data.isAbsent || false,
                        isExtended: data.isExtended, isEarlyStart: data.isEarlyStart || data.isEarlyEntry,
                        isFrancoTrabajado: data.isFrancoTrabajado || false, isFrancoCompensatorio: data.isFrancoCompensatorio || false,
                        swapWith: data.swapWith, swapDate: data.swapDate, hasNovedad: data.hasNovedad, plannedNovedad: data.plannedNovedad,
                        positionName: data.positionName,
                        coveredBy: data.coveredBy,
                        coveragePackageId: data.coveragePackageId,
                        coverageSegmentRole: data.coverageSegmentRole,
                        coversPositionName: data.coversPositionName,
                        coversEmployeeId: data.coversEmployeeId,
                        coversBandCode: data.coversBandCode,
                        coverageStatus: data.coverageStatus,
                        coverageNote: data.coverageNote,
                        deploymentRole: data.deploymentRole,
                        deploymentBand: data.deploymentBand,
                        surplusIntent: data.surplusIntent,
                        countsForCoverage: data.countsForCoverage,
                        isRefuerzo: data.isRefuerzo,
                        isEscuela: data.isEscuela,
                    };
                }
            });
            setShiftsMap(map);
            setAllShiftIds(allIds);
            setTuraMap(turaM);
            setRfzVacantes(rfzVacs);
            setRfzTodos(rfzAll);
        }, (e) => { console.error('[plan] turnos error:', e); toast.error(`Error cargando turnos: ${e.code || e.message}`); });

        // Actividad Reciente (audit_logs) — acotada por empresa activa del panel.
        const unsubLogs = onSnapshot(
            buildAuditLogsRecentQuery(empresaId, scopeEmpresa, { limit: 60 }),
            (snap) => {
                const rows = sortAuditLogRows(
                    snap.docs
                        .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                        .map((d) => {
                            const data: any = d.data();
                            const tsMs = auditLogTimestampMs(data) || Date.now();
                            return {
                                id: d.id,
                                timestamp: tsMs,
                                label: ACTION_LABELS[data.action] || data.action || 'CAMBIO',
                                detail: data.details || '',
                                objectiveName: data.objectiveName || '',
                                actorUid: data.actorUid || '',
                                actorEmail: data.actorEmail || '',
                                actorName: data.actorName || data.actor || '',
                                actor: data.actorName || data.actorEmail || data.actor || data.actorUid || '',
                                module: data.module || '',
                                action: data.action || '',
                            };
                        })
                        .filter((x) => {
                            const mod = (x.module || '').toString().toUpperCase();
                            if (mod === 'PLANIFICADOR') return true;
                            if (mod === 'OPERACIONES' && (x.action === 'Devolución a Planificación' || (x.label || '').includes('Devolución'))) return true;
                            return false;
                        }),
                    20,
                );
                setUnifiedLogs(rows);
                // Mostrar notificación inline si es un log nuevo (no en el mount inicial)
                const newest = rows[0];
                if (newest && newest.id !== prevLatestLogId.current) {
                    if (prevLatestLogId.current !== null) {
                        // Es realmente un log nuevo (no la carga inicial)
                        if (latestLogTimer.current) clearTimeout(latestLogTimer.current);
                        setLatestLog(newest);
                        latestLogTimer.current = setTimeout(() => setLatestLog(null), 60000);
                    }
                    prevLatestLogId.current = newest.id;
                }
            },
            () => setUnifiedLogs([])
        );

        const unsubNotifs = onSnapshot(
            scopeEmpresa && empresaId
                ? query(empresaCollectionQuery('user_notifications', empresaId, scopeEmpresa), limit(80))
                : query(collection(db, 'user_notifications'), orderBy('createdAt', 'desc'), limit(50)),
            (snap) => {
                const rows = snap.docs
                    .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                    .map(d => {
                    const data: any = d.data();
                    const ts = data.createdAt?.toDate ? data.createdAt.toDate()
                        : (data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000) : new Date());
                    const readTs = data.readAt?.toDate ? data.readAt.toDate()
                        : (data.readAt?.seconds ? new Date(data.readAt.seconds * 1000) : null);
                    return {
                        id: d.id,
                        timestamp: ts.getTime(),
                        employeeId: data.employeeId || '',
                        title: data.title || '',
                        body: data.body || '',
                        type: data.type || '',
                        read: !!data.read,
                        readAt: readTs ? readTs.getTime() : null,
                    };
                })
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 50);
                setNotifLogs(rows);
            },
            () => setNotifLogs([])
        );

        const ausenciasQ = empresaCollectionQuery('ausencias', empresaId, scopeEmpresa);
        const unsubA = onSnapshot(ausenciasQ, snap => {
            const docs = snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => ({ id: d.id, data: d.data() as Record<string, unknown> }));
            setAbsencesMap(buildAbsencesMapFromDocs(docs, getDateKey));
        }, (e) => console.error('[plan] ausencias error:', e));

        // novedades: equality + orderBy requires composite index (status ASC, createdAt DESC in firestore.indexes.json)
        const qNovedades = scopeEmpresa
            ? query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(40))
            : query(collection(db, 'novedades'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(40));
        const unsubN = onSnapshot(qNovedades, (snap) => {
            const alerts = snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .filter(d => !d.data().viewed)  // safety net: excluir ya vistas
                .filter(d => !d.data().priority || d.data().priority === 'high')
                .filter(d => d.data().actionTarget !== 'OPERACIONES')
                .map(d => {
                    const data = d.data();
                    const fallbackTitle = data.type === 'REFUERZO_CLIENTE_PENDIENTE'
                        ? `${data.tipoSolicitud || 'RFZ'} · ${data.positionName || data.objectiveName || 'Refuerzo cliente'}`
                        : (data.title || data.type || 'Novedad');
                    return {
                        id: d.id,
                        source: 'NOVEDAD',
                        ...data,
                        title: data.title || fallbackTitle,
                        msg: data.description || data.details || data.msg || '',
                    };
                });
            setNotifications(alerts);
            setHasUnread(alerts.length > 0);
        }, (e) => console.error('[plan] novedades error:', e));
        
        return () => { unsubC(); unsubE(); unsubS(); unsubLogs(); unsubNotifs(); unsubA(); unsubAg(); unsubN(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresaId, migracionCompleta, scopeEmpresa]);

    // Cargar estado de publicación cuando cambia objetivo o mes
    useEffect(() => {
        if (!selectedObjective) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        fetchPlanificacionEstadoDoc(empresaId, selectedObjective, year, month)
            .then(row => {
                // Solo publishedAt marca publicación. Asignar puestos crea el mismo doc sin publicar.
                if (row && row.data.publishedAt) {
                    setPublishStatusMap(prev => ({
                        ...prev,
                        [lookupKey]: {
                            publishedAt: row.data.publishedAt,
                            publishedBy: String(row.data.publishedBy ?? ''),
                        },
                    }));
                } else {
                    setPublishStatusMap(prev => ({ ...prev, [lookupKey]: null }));
                }
            }).catch(() => {});
    }, [selectedObjective, currentDate, empresaId, dataRefreshNonce]);

    // Carga asignaciones de puesto: base desde empleados + overlay mensual desde planificacion_estados.
    const activateRfzCorrectionFlow = useCallback((opts?: { republishOnly?: boolean }) => {
        if (!selectedObjective) return;
        const lookupKey = planificacionPublishLookupKey(
            selectedObjective,
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
        );
        if (!isPlanificacionPublished(publishStatusMap[lookupKey])) return;
        setNeedsRepublishMap(prev => ({ ...prev, [lookupKey]: true }));
        if (!opts?.republishOnly && canCorrectPlanning) setCorrectionMode(true);
    }, [selectedObjective, currentDate, publishStatusMap, canCorrectPlanning]);

    useEffect(() => {
        if (!selectedObjective) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        if (!isPlanificacionPublished(publishStatusMap[lookupKey])) return;
        const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
        const draftRfz = rfzTodos.filter(rfz =>
            rfz.objectiveId === selectedObjective &&
            String(rfz.fecha || '').startsWith(monthPrefix) &&
            rfz.draft === true,
        );
        if (draftRfz.length === 0) return;
        const asignadosSinPublicar = draftRfz.some(rfz => rfz.employeeId && rfz.employeeId !== 'VACANTE');
        if (asignadosSinPublicar) {
            setNeedsRepublishMap(prev => ({ ...prev, [lookupKey]: true }));
        }
        if (canCorrectPlanning) setCorrectionMode(true);
    }, [selectedObjective, currentDate, rfzTodos, publishStatusMap, canCorrectPlanning]);

    // Carga asignaciones de puesto: base desde empleados + overlay mensual desde planificacion_estados.
    // Si el mes actual no tiene datos propios, hereda del mes anterior (una sola vez al abrir el mes).
    useEffect(() => {
        const { pos: basePos, shift: baseShift } = buildDotacionMapsFromEmployees(employees);
        setEmpDefaultPos(basePos);
        setEmpDefaultShift(baseShift);
        if (!selectedObjective) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const stateKey = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
        const applyOverlay = (monthlyPos: Record<string,string>, monthlyShift: Record<string,string>) => {
            if (Object.keys(monthlyPos).length === 0) return false;
            const merged = { ...basePos };
            const mergedS = { ...baseShift };
            for (const [id, p] of Object.entries(monthlyPos)) merged[`${id}___${selectedObjective}`] = p;
            for (const [id, s] of Object.entries(monthlyShift)) mergedS[`${id}___${selectedObjective}`] = s;
            setEmpDefaultPos(merged);
            setEmpDefaultShift(mergedS);
            return true;
        };
        fetchMergedPlanificacionEstadoData(empresaId, selectedObjective, year, month).then((d) => {
            if (applyOverlay(
                (d.defaultPositionByEmp as Record<string, string>) || {},
                (d.defaultShiftByEmp as Record<string, string>) || {},
            )) return;
            // Sin datos propios → intentar heredar del mes anterior
            const prevMonth = month === 1 ? 12 : month - 1;
            const prevYear = month === 1 ? year - 1 : year;
            fetchMergedPlanificacionEstadoData(empresaId, selectedObjective, prevYear, prevMonth).then((prev) => {
                const prevPos: Record<string,string> = (prev.defaultPositionByEmp as Record<string, string>) || {};
                const prevSh: Record<string,string> = (prev.defaultShiftByEmp as Record<string, string>) || {};
                if (applyOverlay(prevPos, prevSh)) {
                    if (empresaId) {
                        setDoc(doc(db, 'planificacion_estados', stateKey), {
                            empresaId,
                            objectiveId: selectedObjective,
                            objetivoId: selectedObjective,
                            year,
                            month,
                            año: year,
                            mes: month,
                            defaultPositionByEmp: prevPos,
                            defaultShiftByEmp: prevSh,
                        }, { merge: true }).catch(() => {});
                    }
                }
            }).catch(() => {});
        }).catch(() => {});
    }, [employees, selectedObjective, currentDate, empresaId]);

    useEffect(() => {
        if (dotacionMigratedRef.current || typeof window === 'undefined' || !employees.length) return;
        dotacionMigratedRef.current = true;
        try {
            const lsPos: Record<string, string> = JSON.parse(localStorage.getItem('planif_emp_pos') || '{}');
            const lsShift: Record<string, string> = JSON.parse(localStorage.getItem('planif_emp_shift') || '{}');
            const allKeys = new Set([...Object.keys(lsPos), ...Object.keys(lsShift)]);
            for (const key of allKeys) {
                const sep = key.indexOf('___');
                if (sep <= 0) continue;
                const empId = key.slice(0, sep);
                const objId = key.slice(sep + 3);
                const emp = employees.find((e) => e.id === empId);
                if (!emp) continue;
                const existing = emp.planificacionDotacion?.[objId]?.positionName;
                const positionName = lsPos[key];
                if (existing || !positionName) continue;
                const nextDotacion: PlanificacionDotacionMap = { ...(emp.planificacionDotacion || {}) };
                nextDotacion[objId] = {
                    positionName,
                    ...(lsShift[key] ? { shiftCode: lsShift[key] } : {}),
                };
                updateDoc(doc(db, 'empleados', empId), { planificacionDotacion: nextDotacion }).catch(() => {});
            }
        } catch { /* noop */ }
    }, [employees]);

    // ============================================================================
    // 7. HANDLERS DE USUARIO (NIVEL 6) - DEFINIDOS UNA SOLA VEZ
    // ============================================================================

    // 🛑 V8.20: Handler Restaurado
    const handleNotificationClick = async (notif: any) => {
        setShowNotifications(false);
        // Vacante RFZ sintética (derivada de turnos): abrir directamente el modal de asignación.
        if (typeof notif?.id === 'string' && notif.id.startsWith('rfzvac_') && notif.__rfz) {
            if (notif.clientId) setSelectedClient(notif.clientId);
            if (notif.objectiveId) setSelectedObjective(notif.objectiveId);
            if (typeof notif.fecha === 'string') {
                const [y, m] = notif.fecha.split('-').map(Number);
                if (y && m) setCurrentDate(new Date(y, m - 1, 1));
            }
            setForceShowAll(true);
            activateRfzCorrectionFlow();
            setRfzAsignando(notif.__rfz);
            return;
        }
        if (notif.id) {
            try {
                // Las notificaciones siempre vienen de 'novedades' — nunca de 'ausencias'
                await updateDoc(doc(db, 'novedades', notif.id), { viewed: true, status: 'read' });
                setNotifications(prev => prev.filter(n => n.id !== notif.id));
                setHasUnread(false);
            } catch (e) { console.error("Error update view", e); }
        }

        // Navegar al cliente y objetivo del cronograma
        // Si la notificación no trae objectiveId, lo resolvemos desde el empleado
        const resolvedObjectiveId = notif.objectiveId || (() => {
            const emp = employees.find((e: any) => e.id === notif.employeeId);
            return emp?.preferredObjectiveId || '';
        })();
        const resolvedClientId = notif.clientId || (() => {
            if (!resolvedObjectiveId) return '';
            const c = clients.find((cl: any) => cl.objetivos?.some((o: any) => (o.id || o.name) === resolvedObjectiveId));
            return c?.id || '';
        })();
        const didNavigate = !!(resolvedClientId && resolvedObjectiveId);
        if (didNavigate) {
            setSelectedClient(resolvedClientId);
            setSelectedObjective(resolvedObjectiveId);
            setSearchTerm('');
            setForceShowAll(true);
            const objLabel = getObjectiveName(resolvedObjectiveId) || 'objetivo';
            toast.info(`Navegando a: ${objLabel}`);
        }

        // Refuerzo / agregado solicitado por cliente (portal → planificación)
        const isRefuerzoCliente = notif.type === 'REFUERZO_CLIENTE_PENDIENTE';

        // Ausencias que requieren gestión de cobertura
        const isVacancyAbsence = !isRefuerzoCliente && notif.type &&
            (notif.type === 'Vacaciones' || notif.type.includes('Licencia') || notif.type === 'PG Permiso Gremial');

        const rawFechaRefuerzo = isRefuerzoCliente ? (notif.fecha || notif.date) : null;

        if (rawFechaRefuerzo || notif.date || notif.startDate) {
            try {
                let targetDate: Date | null = null;
                const rawDate = rawFechaRefuerzo || notif.date || notif.startDate;

                if (typeof rawDate === 'string') {
                    const parts = rawDate.split('-');
                    if(parts.length === 3) targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                } else if (rawDate?.seconds) {
                    targetDate = new Date(rawDate.seconds * 1000);
                }

                if (targetDate) {
                    // Navegar al mes correcto SIEMPRE (antes de abrir cualquier modal)
                    setCurrentDate(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));

                    if (isRefuerzoCliente) {
                        const instruccion = notif.description || notif.msg
                            || `Asigná ${notif.tipoSolicitud === 'TURA' ? 'TURA' : 'REF/RFZ'} en el cronograma para el ${targetDate.toLocaleDateString('es-AR')}.`;
                        toast.info(instruccion, { duration: 9000 });
                        return;
                    }

                    const targetEmp = employees.find(e => e.id === notif.employeeId || e.name === notif.employeeName);

                    if (targetEmp) {
                        setSearchTerm(targetEmp.name);
                        setForceShowAll(true);

                        // Si navegamos a un nuevo cliente/objetivo necesitamos más tiempo para que cargue
                        setTimeout(() => {
                            const dateStr = getDateKey(targetDate!);
                            const key = `${targetEmp.id}_${dateStr}`;
                            const shift = pendingChanges[key] || shiftsMap[key];
                            const absence = absencesMap[key];

                            const absHandled = shift && ['V','L','PG','A','E','AA'].includes(shift.code || '');
                            if (isVacancyAbsence && !absHandled) {
                                setVacancyData(absence ? { ...absence, source: 'AUSENCIA' } : { ...notif, source: 'AUSENCIA' });
                                setSelectedReplacement('');
                                setShowVacancyModal(true);
                            } else if ((shift && absence) || (shift && shift.hasNovedad)) {
                                findNeighbors(shift, dateStr);
                                if (absence && absence.type) {
                                    setVacancyData({ ...absence, source: 'AUSENCIA' });
                                    setSelectedReplacement('');
                                    setShowVacancyModal(true);
                                } else {
                                    setShowConflictModal(true);
                                }
                            }

                            setSelectedCell({
                                empId: targetEmp.id,
                                dateStr: dateStr,
                                currentShift: shift,
                                absence: absence
                            });

                            const initialPos = shift?.positionName || (positionStructure.length > 0 ? positionStructure[0].positionName : 'General');
                            setActivePosition(initialPos);

                            toast.info(`Navegando a: ${targetEmp.name}`);
                        }, didNavigate ? 700 : 300);
                    } else if (isVacancyAbsence) {
                        // Empleado no visible en la grilla actual: navegar mes y abrir modal igual
                        setTimeout(() => {
                            setVacancyData({ ...notif, source: 'AUSENCIA' });
                            setSelectedReplacement('');
                            setShowVacancyModal(true);
                        }, 150);
                    }
                }
            } catch (e) { console.error("Error navegando", e); }
        } else if (isVacancyAbsence) {
            // Sin fecha: abrir modal directamente
            setVacancyData({ ...notif, source: 'AUSENCIA' });
            setSelectedReplacement('');
            setShowVacancyModal(true);
        }
    };

    const loadHistory = async () => { if (!selectedObjective) { toast.error("Seleccione un objetivo"); return; } try { const q = query(collection(db, 'planificaciones_historial'), where('period', '==', `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`)); const snap = await getDocs(q); const versions = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((v: any) => v.objectiveId === selectedObjective).sort((a:any, b:any) => b.timestamp.seconds - a.timestamp.seconds); setHistoryVersions(versions); setShowHistoryModal(true); } catch (e) { toast.error("Error historial"); } };
    const handleViewSnapshot = (v: any) => { try { const data = JSON.parse(v.snapshot); setComparingSnapshot({ id: v.id, date: new Date(v.timestamp.seconds*1000), user: v.user, data: data }); setShowHistoryModal(false); } catch(e) { toast.error("Error al cargar versión histórica"); } };
    const exitSnapshotMode = () => {
        setComparingSnapshot(null);
        setCompareShowOnlyDiffs(false);
        setShowCompareDiffModal(false);
        setShowCompareSummaryModal(false);
    };

    const handleRowDragStart = (e: React.DragEvent, idx: number) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
    };
    const handleRowDragOver = (e: React.DragEvent, idx: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverVisual(idx);
    };
    const handleRowDrop = (e: React.DragEvent, toIdx: number) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        setDragOverVisual(null);
        if (isNaN(fromIdx) || fromIdx === toIdx) return;
        const ids = displayedEmployees.map((emp: any) => emp.id);
        const [removed] = ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, removed);
        const key = selectedObjective || '__all__';
        const newMap = { ...customOrderMap, [key]: ids };
        setCustomOrderMap(newMap);
        try { localStorage.setItem('planif_emp_order', JSON.stringify(newMap)); } catch {}
    };
    const clearCustomOrder = () => {
        const key = selectedObjective || '__all__';
        const newMap = { ...customOrderMap };
        delete newMap[key];
        setCustomOrderMap(newMap);
        try { localStorage.setItem('planif_emp_order', JSON.stringify(newMap)); } catch {}
    };

    const getEmpDefaultPos = (empId: string) => empDefaultPos[`${empId}___${selectedObjective}`] || null;
    const getEmpDefaultShift = (empId: string) => empDefaultShift[`${empId}___${selectedObjective}`] || null;

    const clearAllPositions = async () => {
        if (!selectedObjective) return;
        if (!confirm('¿Quitar todos los puestos asignados de este objetivo?')) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const stateKey = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
        const prefix = `___${selectedObjective}`;
        const newPos = Object.fromEntries(Object.entries(empDefaultPos).filter(([k]) => !k.endsWith(prefix)));
        const newShift = Object.fromEntries(Object.entries(empDefaultShift).filter(([k]) => !k.endsWith(prefix)));
        setEmpDefaultPos(newPos);
        setEmpDefaultShift(newShift);
        try {
            const batch = writeBatch(db);
            const affected = employees.filter((e: any) => {
                const cfg = e.planificacionDotacion?.[selectedObjective];
                return !!cfg?.positionName || !!cfg?.shiftCode;
            });
            for (const emp of affected) {
                const nextDotacion: PlanificacionDotacionMap = { ...(emp.planificacionDotacion || {}) };
                delete nextDotacion[selectedObjective];
                batch.update(doc(db, 'empleados', emp.id), { planificacionDotacion: nextDotacion });
            }
            if (empresaId) {
                batch.set(doc(db, 'planificacion_estados', stateKey), {
                    empresaId,
                    objectiveId: selectedObjective,
                    objetivoId: selectedObjective,
                    year,
                    month,
                    año: year,
                    mes: month,
                    defaultPositionByEmp: {},
                    defaultShiftByEmp: {},
                }, { merge: true });
            }
            await batch.commit();
            toast.success('Puestos quitados');
        } catch {
            toast.error('No se pudo limpiar los puestos');
        }
    };

    const refreshCronogramaView = async () => {
        if (!selectedObjective) {
            toast.error('Seleccioná un objetivo');
            return;
        }
        setIsRefreshingCrono(true);
        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth() + 1;
            const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
            const lookupKey = planificacionPublishLookupKey(selectedObjective, year, month);

            const [estadoRow, turnosSnap] = await Promise.all([
                fetchPlanificacionEstadoDoc(empresaId, selectedObjective, year, month),
                getDocs(query(
                    collection(db, 'turnos'),
                    where('objectiveId', '==', selectedObjective),
                )),
            ]);

            if (estadoRow && estadoRow.data.publishedAt) {
                setPublishStatusMap(prev => ({
                    ...prev,
                    [lookupKey]: {
                        publishedAt: estadoRow.data.publishedAt,
                        publishedBy: String(estadoRow.data.publishedBy ?? ''),
                    },
                }));
            } else {
                setPublishStatusMap(prev => ({ ...prev, [lookupKey]: null }));
            }

            const mergedEstado = await fetchMergedPlanificacionEstadoData(empresaId, selectedObjective, year, month);
            const monthlyPos = (mergedEstado.defaultPositionByEmp as Record<string, string>) || {};
            const monthlyShift = (mergedEstado.defaultShiftByEmp as Record<string, string>) || {};
            const { pos: basePos, shift: baseShift } = buildDotacionMapsFromEmployees(employees);
            const mergedPos = { ...basePos };
            const mergedShift = { ...baseShift };
            for (const [id, p] of Object.entries(monthlyPos)) mergedPos[`${id}___${selectedObjective}`] = p;
            for (const [id, s] of Object.entries(monthlyShift)) mergedShift[`${id}___${selectedObjective}`] = s;
            setEmpDefaultPos(mergedPos);
            setEmpDefaultShift(mergedShift);

            setShiftsMap(prev => {
                const next = { ...prev };
                for (const key of Object.keys(next)) {
                    const s = next[key];
                    if (!s) continue;
                    if (String(s.objectiveId || '') !== String(selectedObjective)) continue;
                    const dateKey = key.includes('_') ? key.slice(key.indexOf('_') + 1) : '';
                    if (dateKey.startsWith(monthPrefix)) delete next[key];
                }
                turnosSnap.docs.forEach(d => {
                    const data = d.data();
                    if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
                    const code = String(data.code || data.type || '').toUpperCase();
                    if (code === 'RFZ' || code === 'TURA') return;
                    if (!data.startTime?.seconds) return;
                    const dateKey = getDateKey(data.startTime);
                    if (!dateKey.startsWith(monthPrefix)) return;
                    const empKey = `${data.employeeId}_${dateKey}`;
                    next[empKey] = {
                        id: d.id, ...data, code: data.code || data.type, objectiveId: data.objectiveId,
                        startTime: data.startTime, endTime: data.endTime, realStartTime: data.realStartTime,
                        status: data.status, isPresent: data.isPresent || false, isAbsent: data.isAbsent || false,
                        isExtended: data.isExtended, isEarlyStart: data.isEarlyStart || data.isEarlyEntry,
                        isFrancoTrabajado: data.isFrancoTrabajado || false, isFrancoCompensatorio: data.isFrancoCompensatorio || false,
                        swapWith: data.swapWith, swapDate: data.swapDate, hasNovedad: data.hasNovedad, plannedNovedad: data.plannedNovedad,
                        positionName: data.positionName,
                        coveredBy: data.coveredBy,
                        draft: data.draft,
                    };
                });
                return next;
            });

            setDataRefreshNonce(n => n + 1);
            toast.success('Cronograma actualizado');
        } catch (e) {
            console.error('[plan] refreshCronogramaView', e);
            toast.error('No se pudo actualizar el cronograma');
        } finally {
            setIsRefreshingCrono(false);
        }
    };

    const computeEmpPosPickerLayout = (anchorRect: DOMRect) => {
        const margin = 8;
        const width = 260;
        const vv = window.visualViewport;
        const vTop = vv?.offsetTop ?? 0;
        const vLeft = vv?.offsetLeft ?? 0;
        const vh = vv?.height ?? window.innerHeight;
        const vw = vv?.width ?? window.innerWidth;

        const summaryBar = document.querySelector('[data-planning-summary-bar]') as HTMLElement | null;
        const bottomReserve = summaryBar
            ? Math.max(summaryBar.getBoundingClientRect().height + margin, 64)
            : 72;
        const usableBottom = vTop + vh - bottomReserve;

        const headerH = 58;
        const rowH = 76;
        const footerBtnH = 40;
        const idealH = headerH + positionStructure.length * rowH + footerBtnH;
        const minH = 140;
        const capH = Math.min(idealH, 420);

        const spaceBelow = usableBottom - anchorRect.bottom - 4;
        const spaceAbove = anchorRect.top - vTop - margin;
        const anchorCenter = anchorRect.top + anchorRect.height / 2;
        const lowerHalf = anchorCenter > vTop + (vh - bottomReserve) * 0.42;

        const fitsBelow = spaceBelow >= minH;
        const fitsAbove = spaceAbove >= minH;

        let openDown: boolean;
        if (lowerHalf && fitsAbove) openDown = false;
        else if (!lowerHalf && fitsBelow) openDown = true;
        else if (fitsAbove && !fitsBelow) openDown = false;
        else if (fitsBelow && !fitsAbove) openDown = true;
        else openDown = spaceBelow >= spaceAbove;

        let maxHeight = Math.min(capH, Math.max(minH, openDown ? spaceBelow : spaceAbove));
        let y = openDown ? anchorRect.bottom + 4 : anchorRect.top - maxHeight - 4;
        y = Math.max(vTop + margin, Math.min(y, usableBottom - maxHeight));

        // Si no entra anclado al botón, panel flotante centrado en el área útil
        const anchoredClips = y + maxHeight > usableBottom + 1 || maxHeight < minH;
        let floating = false;
        if (anchoredClips) {
            floating = true;
            maxHeight = Math.min(capH, Math.max(minH, vh - bottomReserve - margin * 2));
            y = vTop + margin + Math.max(0, (vh - bottomReserve - maxHeight) / 2);
        }

        let x = floating ? vLeft + (vw - width) / 2 : anchorRect.left;
        if (x + width > vLeft + vw - margin) x = vLeft + vw - width - margin;
        x = Math.max(vLeft + margin, x);

        return { x, y, maxHeight, floating };
    };

    const openEmpPosPickerAt = (empId: string, anchorEl: HTMLElement) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const layout = computeEmpPosPickerLayout(anchorEl.getBoundingClientRect());
                setEmpPosPicker({ empId, ...layout });
            });
        });
    };

    useEffect(() => {
        if (!empPosPicker) return;
        const reposition = () => {
            const btn = document.querySelector(`[data-emp-pos-btn="${empPosPicker.empId}"]`) as HTMLElement | null;
            if (!btn) return;
            const layout = computeEmpPosPickerLayout(btn.getBoundingClientRect());
            setEmpPosPicker((prev) => (prev ? { ...prev, ...layout } : prev));
        };
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('scroll', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('scroll', reposition);
        };
    }, [empPosPicker?.empId, positionStructure.length]);

    const saveEmpPos = async (empId: string, posName: string | null, shiftCode?: string | null) => {
        if (!selectedObjective) return;
        if (!empresaId) {
            toast.error('Seleccioná una empresa antes de asignar puestos');
            return;
        }
        const key = `${empId}___${selectedObjective}`;
        const prevPosMap = { ...empDefaultPos };
        const prevShiftMap = { ...empDefaultShift };
        const newPosMap = { ...empDefaultPos };
        if (posName) { newPosMap[key] = posName; } else { delete newPosMap[key]; }
        setEmpDefaultPos(newPosMap);
        const newShiftMap = { ...empDefaultShift };
        if (shiftCode) { newShiftMap[key] = shiftCode.toUpperCase(); } else { delete newShiftMap[key]; }
        setEmpDefaultShift(newShiftMap);
        setEmpPosPicker(null);

        const emp = employees.find((e: any) => e.id === empId);
        const nextDotacion: PlanificacionDotacionMap = { ...(emp?.planificacionDotacion || {}) };
        if (posName) {
            nextDotacion[selectedObjective] = {
                positionName: posName,
                ...(shiftCode ? { shiftCode: shiftCode.toUpperCase() } : {}),
            };
        } else {
            delete nextDotacion[selectedObjective];
        }

        try {
            // 1) Persistencia durable en legajo (sobrevive despublicar / borrar estado mensual)
            await updateDoc(doc(db, 'empleados', empId), {
                planificacionDotacion: nextDotacion,
            });

            // 2) Overlay mensual (best-effort; no bloquea si falla)
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth() + 1;
            const stateKey = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
            const stateRef = doc(db, 'planificacion_estados', stateKey);
            const posField = `defaultPositionByEmp.${empId}`;
            const shiftField = `defaultShiftByEmp.${empId}`;
            const estadoPayload: Record<string, any> = {
                [posField]: posName ?? deleteField(),
                [shiftField]: shiftCode ? shiftCode.toUpperCase() : deleteField(),
                empresaId,
                objectiveId: selectedObjective,
                objetivoId: selectedObjective,
                year,
                month,
                año: year,
                mes: month,
            };
            try {
                await updateDoc(stateRef, estadoPayload);
            } catch (e: any) {
                if (e?.code === 'not-found') {
                    await setDoc(stateRef, {
                        empresaId,
                        objectiveId: selectedObjective,
                        objetivoId: selectedObjective,
                        year,
                        month,
                        año: year,
                        mes: month,
                        defaultPositionByEmp: posName ? { [empId]: posName } : {},
                        defaultShiftByEmp: shiftCode ? { [empId]: shiftCode.toUpperCase() } : {},
                    }, { merge: true });
                } else if (e?.code === 'permission-denied') {
                    console.warn('[plan] planificacion_estados sin permiso (puesto ya guardado en legajo)', e);
                } else {
                    console.warn('[plan] overlay mensual puestos', e);
                }
            }
        } catch (err: any) {
            setEmpDefaultPos(prevPosMap);
            setEmpDefaultShift(prevShiftMap);
            const permDenied = err?.code === 'permission-denied' || /permission/i.test(String(err?.message || ''));
            toast.error(permDenied
                ? 'Sin permiso para asignar puestos (revisá rol / empresa del usuario)'
                : 'No se pudo guardar el puesto asignado');
        }
    };

    const handleUnassignEmployee = async (emp: any) => {
        if (!selectedObjective) return;
        if (emp.preferredObjectiveId !== selectedObjective) { toast.error("Error asignación."); return; }
        if (!confirm(`¿CONFIRMAR DESVINCULACIÓN?`)) return;
        try {
            const nextDotacion: PlanificacionDotacionMap = { ...(emp.planificacionDotacion || {}) };
            delete nextDotacion[selectedObjective];
            await updateDoc(doc(db, 'empleados', emp.id), {
                preferredObjectiveId: null,
                planificacionDotacion: nextDotacion,
            });
            await addDoc(collection(db, 'audit_logs'), { action: 'DESVINCULACION_OBJETIVO', module: 'PLANIFICADOR', details: `Desvinculó a ${emp.name}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid, empresaId });
            toast.success("Desvinculado");
        } catch (e) { toast.error("Error"); }
    };
    const handleMarkAllRead = async () => { if (!confirm("¿Marcar todas como leídas?")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) { const ref = doc(db, 'novedades', n.id); batch.update(ref, { viewed: true, status: 'read' }); } }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Bandeja limpia"); };
    const handleDeleteAllNotifications = async () => { if (!confirm("¿Eliminar permanentemente todas las notificaciones? Esta acción no se puede deshacer.")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) batch.delete(doc(db, 'novedades', n.id)); }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Notificaciones eliminadas"); };

    const repositionNotifPanel = useCallback(() => {
        const rect = notifBtnRef.current?.getBoundingClientRect();
        if (rect) setNotifPanelTop(rect.bottom + 8);
    }, []);

    useEffect(() => {
        if (!showNotifications) return;
        repositionNotifPanel();
        window.addEventListener('scroll', repositionNotifPanel, true);
        window.addEventListener('resize', repositionNotifPanel);
        return () => {
            window.removeEventListener('scroll', repositionNotifPanel, true);
            window.removeEventListener('resize', repositionNotifPanel);
        };
    }, [showNotifications, repositionNotifPanel]);
    const handleTransferEmployee = async (emp: any) => { if (!selectedObjective) return; if (!confirm(`¿Transferir a ${emp.name} a este objetivo?`)) return; try { await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective }); await addDoc(collection(db, 'audit_logs'), stampEmpresaId({ action: 'TRANSFERENCIA_OBJETIVO', module: 'PLANIFICADOR', details: `Transfirió a ${emp.name} al objetivo ${getObjectiveName(selectedObjective)}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid, objectiveId: selectedObjective, objectiveName: getObjectiveName(selectedObjective) }, empresaId)); toast.success("Transferencia exitosa"); } catch (e) { toast.error("Error al transferir"); } };
    const handleDelete = async () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        if (!selectedCell) return;
        if (isPlanningDateLocked(selectedCell.dateStr)) { toast.warning("Bloqueado."); return; }
        if (isShiftConsolidated(selectedCell.currentShift)) { toast.warning("Turno consolidado/fichado: no se puede borrar desde el planificador."); return; }

        // Si es una ausencia registrada (colección 'ausencias'), no se borra con pendingChanges.
        // Permitimos borrar solo si era un cambio pendiente (ej: una marca en borrador).
        if (selectedCell.absence) {
            const keyAbs = `${selectedCell.empId}_${selectedCell.dateStr}`;
            const pending = pendingChanges[keyAbs];
            if (!pending) { toast.warning("Ausencia/vacaciones registrada: se gestiona desde RRHH."); return; }
        }

        const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
        const newChanges = { ...pendingChanges };
        newChanges[key] = { isDeleted: true };
        setPendingChanges(newChanges);
        setSelectedCell(null);
        toast.info("Marcado para borrar.");
    };
    const getSafeTime = (input: any) => { if (!input) return [6, 0]; if (typeof input === 'string') return input.split(':').map(Number); if (input.toDate) { const d = input.toDate(); return [d.getHours(), d.getMinutes()]; } if (input.seconds) { const d = new Date(input.seconds * 1000); return [d.getHours(), d.getMinutes()]; } if (input instanceof Date) return [input.getHours(), input.getMinutes()]; return [6, 0]; };
    
    const verifySupervisorPin = async (pin: string): Promise<{ ok: boolean; name: string }> => {
        if (!/^\d{4}$/.test(pin)) return { ok: false, name: '' };
        const snap = await getDocs(query(collection(db, 'system_users'), where('supervisorPin', '==', pin)));
        if (snap.empty) return { ok: false, name: '' };
        const u = snap.docs[0].data();
        return { ok: true, name: `${u.firstName} ${u.lastName}` };
    };

    const requestSupervisorFrancoAuth = (
        conflicts: FrancoCoverageConflict[],
        onAuthorized: () => void | Promise<void>,
        contextLabel = 'cobertura',
    ) => {
        if (conflicts.length === 0) {
            void onAuthorized();
            return;
        }
        const unique = [...new Map(conflicts.map((c) => [`${c.employeeId}_${c.dateStr}_${c.role}`, c])).values()];
        const details = formatFrancoConflictSummary(unique);
        setAuthModal({
            pendingFn: async () => { await onAuthorized(); },
            employees: unique.map((c) => ({
                name: c.employeeName,
                hours: 0,
                detail: `${c.role === 'SUBSTITUTE' ? 'Suplente' : c.role === 'EXTENSION' ? 'Extensión' : 'Adelanto'} · ${c.francoCode}`,
            })),
            description: (
                <>
                    La {contextLabel} involucra guardias en <strong>franco planificado (FT)</strong> — costo extra CCT.
                    Preferí RET, ESC o guardias libres. Si confirmás, queda registrado en auditoría.
                </>
            ),
            auditAction: 'AUTORIZACION_FRANCO_COBERTURA',
            auditDetails: details,
        });
    };

    const handleSaveAll = async () => {
        if (isProcessing) return;
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        const count = Object.keys(pendingChanges).length;
        if (count === 0) return;
        if (!confirm(`¿Confirmar y guardar ${count} cambios?`)) return;

        // Verificar si algún empleado superaría las 200h
        const overCap: { name: string; hours: number }[] = [];
        Object.keys(pendingChanges).forEach(key => {
            const empId = key.split('_')[0];
            const hours = empMonthlyHours[empId] || 0;
            if (hours > planningLimits.monthly) {
                const empName = displayedEmployees.find((e: any) => e.id === empId)?.name || empId;
                if (!overCap.some(e => e.name === empName)) overCap.push({ name: empName, hours: Math.round(hours) });
            }
        });

        const doSave = async () => {
            setIsProcessing(true);
            const batch = writeBatch(db);
            const auth = getAuth();
            const realActorName = activeActorName || 'Sistema';
            const pubYear = currentDate.getFullYear();
            const pubMonth = currentDate.getMonth() + 1;
            const publishLookupKey = planificacionPublishLookupKey(selectedObjective, pubYear, pubMonth);
            const isPublished = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
            const logData: any[] = [];
            const snapshotData: Record<string, any> = {};

            displayedEmployees.forEach(emp => {
                daysInMonth.forEach(day => {
                    const key = `${emp.id}_${getDateKey(day)}`;
                    const pending = pendingChanges[key];
                    const existing = shiftsMap[key];
                    if (pending) {
                        if (!pending.isDeleted) {
                            snapshotData[key] = { code: pending.code, isFranco: pending.isFranco, isFrancoTrabajado: pending.isFrancoTrabajado, isFrancoCompensatorio: pending.isFrancoCompensatorio, swapWith: pending.swapWith, objectiveId: selectedObjective, isExtended: pending.isExtended, isEarlyStart: pending.isEarlyStart };
                        }
                    } else if (existing) {
                        if(existing.objectiveId === selectedObjective) {
                            snapshotData[key] = { code: existing.code, isFranco: existing.isFranco, isFrancoTrabajado: existing.isFrancoTrabajado, isFrancoCompensatorio: existing.isFrancoCompensatorio, swapWith: existing.swapWith, objectiveId: selectedObjective, isExtended: existing.isExtended, isEarlyStart: existing.isEarlyStart };
                        }
                    }
                });
            });

            const registerPlanificacionCorreccion = (
                empId: string,
                empName: string,
                dateStr: string,
                actionDetail: string,
                codigoAntes: string,
                codigoDespues: string,
            ) => {
                if (!correctionMode) return;
                const [y, m, d] = dateStr.split('-').map(Number);
                const corrFechaTs = Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0));
                const tipoCorr =
                    codigoAntes && codigoDespues && codigoAntes !== codigoDespues && codigoDespues !== '(eliminado)'
                        ? 'CORRECCION_CODIGO'
                        : 'CORRECCION_PLANIFICACION';
                logData.push({ empId, date: dateStr, action: 'CORRECCION_SUPERADMIN' });
                batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
                    action: 'CORRECCION_SUPERADMIN',
                    module: 'PLANIFICADOR',
                    details: `[CORRECCIÓN] ${actionDetail}`,
                    timestamp: serverTimestamp(),
                    actorName: realActorName,
                    actorUid: auth.currentUser?.uid,
                    employeeId: empId,
                    employeeName: empName,
                    fecha: corrFechaTs,
                }, empresaId));
                batch.set(doc(collection(db, 'ajustes_horas')), stampEmpresaId({
                    employeeId: empId,
                    employeeName: empName,
                    tipo: tipoCorr,
                    fecha: corrFechaTs,
                    motivo: actionDetail,
                    codigoAntes,
                    codigoDespues,
                    objectiveId: selectedObjective,
                    objectiveName: getObjectiveName(selectedObjective),
                    origen: 'PLANIFICACION',
                    creadoPor: auth.currentUser?.uid || '',
                    creadoPorNombre: realActorName,
                    creadoEn: serverTimestamp(),
                }, empresaId));
            };

            try {
                for (const [key, change] of Object.entries(pendingChanges)) {
                    const [empId, dateStr] = key.split('_');
                    const existing = shiftsMap[key];
                    const empObj = employees.find(e => e.id === empId);
                    const empName = empObj ? empObj.name : 'Desconocido';
                    let actionType = 'ASIGNACION_MASIVA';
                    let actionDetail = change.coveredBy
                        ? `Cobertura ${change.code} — ${empName} cubierto por ${change.coveredBy} el ${dateStr}`
                        : change.comments?.startsWith('Cubriendo a')
                            ? `${change.code} — ${change.comments} el ${dateStr}`
                            : ['V','L','PG','A','E','AA'].includes(change.code)
                                ? `${change.name || change.code} — ${empName} el ${dateStr}`
                                : `Asignó ${change.code} a ${empName} el ${dateStr}`;

                    // Borrar TODOS los documentos existentes para este empId+fecha (evita docs huérfanos duplicados)
                    const allExistingIds = allShiftIds[key] ?? (existing?.id ? [existing.id] : []);
                    const deleteAllExisting = () => allExistingIds.forEach(docId => batch.delete(doc(db, 'turnos', docId)));

                    if (change.isDeleted) {
                        actionType = 'ELIMINACION_MASIVA';
                        actionDetail = `Borró turno de ${empName} el ${dateStr}`;
                        deleteAllExisting();
                        registerPlanificacionCorreccion(
                            empId,
                            empName,
                            dateStr,
                            actionDetail,
                            existing?.code || '',
                            '(eliminado)',
                        );
                    } else {
                        deleteAllExisting();

                        if (existing) {
                            if ((existing.code === 'F' || existing.isFranco) && change.code !== 'F') {
                                if (change.isFrancoTrabajado) { actionType = 'CAMBIO_FRANCO_TURNO'; actionDetail = `Asignó FT (${change.code}) a ${empName} el ${dateStr}`; }
                                else { actionType = 'CAMBIO_DIAGRAMA'; actionDetail = `Cambio de Diagrama (F x ${change.code}) a ${empName}`; }
                            } else if (existing.code !== 'F' && change.code === 'F') {
                                if (change.isFrancoCompensatorio) { actionType = 'CAMBIO_TURNO_FRANCO'; actionDetail = `Asignó FF a ${empName} el ${dateStr}`; }
                            }
                        }

                        const [y, m, d] = dateStr.split('-').map(Number);
                        const tDate = new Date(y, m-1, d);
                        const [sh, sm] = getSafeTime(change.startTime);
                        const start = new Date(tDate); start.setHours(sh, sm, 0);
                        const end = new Date(start);

                        if(change.code === 'F' || change.code === 'FF' || change.code === 'V') end.setHours(23,59,59);
                        else if (typeof change.endTime === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(change.endTime)) {
                            const [eh, em] = change.endTime.split(':').map(Number);
                            end.setHours(eh, em, 0);
                            if (end <= start) end.setTime(end.getTime() + 24 * 3600000); // turno nocturno
                        } else {
                            // endTime no disponible en el change: buscar en positionStructure (SLA)
                            const slaPos = positionStructure.find((p: any) => p.positionName === (change.positionName || ''));
                            const slaSh = slaPos?.shifts?.find((s: any) => String(s.code || '').toUpperCase() === String(change.code || '').toUpperCase());
                            const slaEnd = typeof slaSh?.endTime === 'string' ? slaSh.endTime : null;
                            const slaHours = Number(slaSh?.hours) > 0 ? Number(slaSh.hours) : null;
                            if (slaEnd && /^\d{1,2}:\d{2}(:\d{2})?$/.test(slaEnd)) {
                                const [eh, em] = slaEnd.split(':').map(Number);
                                end.setHours(eh, em, 0);
                                if (end <= start) end.setTime(end.getTime() + 24 * 3600000);
                            } else if (slaHours) {
                                end.setTime(start.getTime() + slaHours * 3600000);
                            } else {
                                end.setTime(start.getTime() + ((change.hours != null ? change.hours : 8)*3600000));
                            }
                        }

                        const safeSwapWith = change.swapWith || null;
                        const safeSwapDate = change.swapDate || null;

                        // FIX DE SEGURIDAD: Evitar undefined en positionName
                        const safePositionName = change.positionName || 'General';

                        const turnoPayload: Record<string, unknown> = {
                            employeeId: empId,
                            clientId: selectedClient,
                            objectiveId: selectedObjective,
                            code: change.isFrancoCompensatorio ? 'FF' : change.code,
                            type: change.name||change.code,
                            startTime: Timestamp.fromDate(start),
                            endTime: Timestamp.fromDate(end),
                            isFranco: change.code==='F' || change.isFrancoCompensatorio || change.isFranco === true,
                            isFrancoTrabajado: change.isFrancoTrabajado || false,
                            isFrancoCompensatorio: change.isFrancoCompensatorio || false,
                            swapWith: safeSwapWith,
                            swapDate: safeSwapDate,
                            createdAt: serverTimestamp(),
                            comments: change.comments || change.coverageNote || 'Carga Masiva',
                            isExtended: change.isExtended || false,
                            isEarlyStart: change.isEarlyStart || false,
                            plannedNovedad: change.plannedNovedad || null,
                            positionName: safePositionName,
                            coveredBy: change.coveredBy || null,
                            draft: correctionMode ? false : !isPublished,
                            ...deploymentFieldsForFirestore(change),
                        };

                        if (change.coveragePackageId) {
                            turnoPayload.coveragePackageId = change.coveragePackageId;
                            turnoPayload.coverageType = change.coverageType || null;
                            turnoPayload.coverageSegmentRole = change.coverageSegmentRole || null;
                            turnoPayload.coverageNote = change.coverageNote || null;
                            turnoPayload.coverageStatus = change.coverageStatus || null;
                            turnoPayload.coverageMode = change.coverageMode || null;
                            turnoPayload.liberationReason = change.liberationReason || null;
                            turnoPayload.redeployNote = change.redeployNote || null;
                            turnoPayload.coversEmployeeId = change.coversEmployeeId || null;
                            turnoPayload.coversPositionName = change.coversPositionName || null;
                            turnoPayload.coversBandCode = change.coversBandCode || null;
                            if (change.segmentFromTime) turnoPayload.segmentFromTime = change.segmentFromTime;
                            if (change.segmentToTime) turnoPayload.segmentToTime = change.segmentToTime;
                        }
                        if (change.isEarlyStart && typeof change.adjustedStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedStartTime)) {
                            const [ah, am] = change.adjustedStartTime.split(':').map(Number);
                            const adj = new Date(tDate);
                            adj.setHours(ah, am, 0, 0);
                            turnoPayload.adjustedStartTime = Timestamp.fromDate(adj);
                        }
                        if (change.isExtended && typeof change.adjustedEndTime === 'string' && /^\d{1,2}:\d{2}$/.test(change.adjustedEndTime)) {
                            turnoPayload.extensionEndTime = change.adjustedEndTime;
                        }

                        batch.set(doc(collection(db, 'turnos')), stampEmpresaId(turnoPayload, empresaId));

                        if (correctionMode) {
                            const codigoNuevo = change.isFrancoCompensatorio ? 'FF' : change.code;
                            registerPlanificacionCorreccion(
                                empId,
                                empName,
                                dateStr,
                                actionDetail,
                                existing?.code || '',
                                codigoNuevo,
                            );
                        } else {
                            logData.push({ empId, date: dateStr, action: actionType });
                            if (isPublished) {
                                batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
                                    action: actionType,
                                    module: 'PLANIFICADOR',
                                    details: actionDetail,
                                    timestamp: serverTimestamp(),
                                    actorName: realActorName,
                                    actorUid: auth.currentUser?.uid,
                                    objectiveId: selectedObjective,
                                    objectiveName: getObjectiveName(selectedObjective),
                                    clientId: selectedClient || undefined,
                                }, empresaId));
                            }
                        }
                    }
                }

                await addDoc(collection(db, 'planificaciones_historial'), { timestamp: serverTimestamp(), user: realActorName, period: `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`, objectiveId: selectedObjective, changes: logData, count, snapshot: JSON.stringify(snapshotData) });
                await batch.commit();

                if (isPublished && empresaId) {
                    const employeesById: Record<string, any> = {};
                    employees.forEach((e: any) => { employeesById[e.id] = e; });
                    const objName = getObjectiveName(selectedObjective);
                    const packages = [
                        ...pendingRecompositionPackages,
                        ...extractPackagesFromPending(pendingChanges, employeesById, selectedObjective),
                    ];
                    const seenPkg = new Set<string>();
                    for (const pkg of packages) {
                        if (seenPkg.has(pkg.id)) continue;
                        seenPkg.add(pkg.id);
                        const extName = employeesById[pkg.extension.employeeId]?.name || pkg.extension.employeeId;
                        const adelName = employeesById[pkg.earlyStart.employeeId]?.name || pkg.earlyStart.employeeId;
                        const targetName = employeesById[pkg.target.employeeId]?.name || pkg.target.employeeId;
                        try {
                            await emitRecompositionNotifications(pkg, {
                                empresaId,
                                clientId: selectedClient,
                                objectiveId: selectedObjective,
                                objectiveName: objName,
                                extName,
                                adelName,
                                targetName,
                            });
                        } catch (notifyErr) {
                            console.warn('[plan] cobertura notify', notifyErr);
                        }
                    }
                }

                const experienciaPatches = new Map<string, Record<string, unknown>>();
                for (const [key, change] of Object.entries(pendingChanges)) {
                    if (change.isDeleted) continue;
                    const code = String(change.code || '').toUpperCase();
                    if (code !== 'REF' && code !== 'ESC') continue;
                    const empId = key.split('_')[0];
                    const empObj = employees.find(e => e.id === empId);
                    if (!empObj || !selectedObjective) continue;
                    const prev = (empObj.experienciaObjetivos || {}) as Record<string, unknown>;
                    const next = patchExperienciaForTurno(
                        prev as any,
                        selectedObjective,
                        { ...change, ...deploymentFieldsForFirestore(change) },
                        empObj.preferredObjectiveId,
                    );
                    experienciaPatches.set(empId, next);
                }
                await Promise.all(
                    [...experienciaPatches.entries()].map(([empId, exp]) =>
                        updateDoc(doc(db, 'empleados', empId), { experienciaObjetivos: exp }).catch(() => {}),
                    ),
                );
                // Guardar ausencias pendientes (novedades RRHH)
                for (const novedad of Object.values(pendingNovedades)) {
                    await addDoc(collection(db, 'ausencias'), stampEmpresaId({ ...novedad, createdAt: serverTimestamp() }, empresaId));
                }
                setPendingChanges({});
                setPendingNovedades({});
                setPendingRecompositionPackages([]);
                if (isPublished) {
                    setNeedsRepublishMap(prev => ({ ...prev, [publishLookupKey]: true }));
                }
                toast.success("Guardado exitoso");
            } catch(e) {
                console.error(e);
                toast.error("Error al guardar");
            } finally {
                setIsProcessing(false);
            }
        };

        if (overCap.length > 0) {
            setAuthModal({ pendingFn: doSave, employees: overCap, operatorName: activeActorName || operatorName, isSaveFlow: true });
            setAuthPin('');
            setAuthError('');
            return;
        }

        await doSave();
    };

    const openPublishConfirm = () => {
        if (!selectedObjective || !canPublishPlanning) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const totalPlanned = Object.values(empMonthlyHours).reduce((a: number, b: number) => a + (b || 0), 0);
        const plannedRounded = Math.round(totalPlanned);
        const slaRounded = Math.round(slaVendidas);
        const slaHoursMismatch = slaVendidas > 0 && plannedRounded !== slaRounded;
        const coverageGapDays = objectiveCoverageGapReport
            ? objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty
            : 0;
        const hasCoverageGaps = coverageGapDays > 0;

        if (!isSuperAdmin && slaHoursMismatch) {
            const delta = slaRounded - plannedRounded;
            toast.error(
                delta > 0
                    ? `No se puede publicar: ${plannedRounded}h planificadas ≠ ${slaRounded}h vendidas (SLA). Faltan ${delta}h.`
                    : `No se puede publicar: ${plannedRounded}h planificadas superan ${slaRounded}h vendidas (SLA) en ${-delta}h.`,
                { duration: 9000 },
            );
            return;
        }

        const publishLookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        const isAlreadyPublished = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
        const warnings: string[] = [];
        if (isSuperAdmin && slaHoursMismatch) {
            const delta = slaRounded - plannedRounded;
            warnings.push(
                delta > 0
                    ? `SLA: ${plannedRounded}h planificadas vs ${slaRounded}h vendidas (faltan ${delta}h).`
                    : `SLA: ${plannedRounded}h planificadas vs ${slaRounded}h vendidas (excede ${-delta}h).`,
            );
        }
        if (isSuperAdmin && hasCoverageGaps) {
            warnings.push(`Cobertura: ${coverageGapDays} día(s) con huecos respecto al esquema SLA.`);
        }

        const objectiveName = getObjectiveName(selectedObjective) || selectedObjective;
        setPublishConfirmModal({
            isRepublish: isAlreadyPublished,
            warnings,
            superAdminOverride: isSuperAdmin && (slaHoursMismatch || hasCoverageGaps),
            objectiveName,
            periodLabel: `${String(month).padStart(2, '0')}/${year}`,
        });
        setPublishConfirmPin('');
        setPublishConfirmPinError('');
    };

    const executePublish = async () => {
        if (!selectedObjective || !canPublishPlanning) return;
        if (!empresaId) {
            toast.error('Seleccioná una empresa antes de publicar');
            return;
        }
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const publishLookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        const publishDocId = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
        const totalPlanned = Object.values(empMonthlyHours).reduce((a: number, b: number) => a + (b || 0), 0);
        const slaHoursMismatch = slaVendidas > 0 && Math.round(totalPlanned) !== Math.round(slaVendidas);
        const coverageGapDays = objectiveCoverageGapReport
            ? objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty
            : 0;
        const hasCoverageGaps = coverageGapDays > 0;
        setPublishConfirmModal(null);
        setIsPublishing(true);
        try {
            const auth = getAuth();
            const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';
            // 1. Registrar publicación (merge: no borrar defaultPositionByEmp / defaultShiftByEmp)
            await setDoc(doc(db, 'planificacion_estados', publishDocId), {
                objetivoId: selectedObjective,
                objectiveId: selectedObjective,
                año: year,
                mes: month,
                year,
                month,
                publishedAt: serverTimestamp(),
                publishedBy: actorName,
                empresaId,
            }, { merge: true });
            // 2. Buscar todos los turnos draft del objetivo+mes y actualizarlos a draft:false
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0, 23, 59, 59);
            const draftsSnap = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('draft', '==', true),
                where('startTime', '>=', Timestamp.fromDate(firstDay)),
                where('startTime', '<=', Timestamp.fromDate(lastDay))
            ));
            const batch = writeBatch(db);
            draftsSnap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .forEach(d => batch.update(d.ref, { draft: false }));
            // Refuerzos RFZ en borrador: guardan startTime como string ISO (no Timestamp), por lo que
            // no entran en la query por rango anterior. Se incluyen por objetivo + código + fecha del mes.
            let rfzPublished = 0;
            try {
                const rfzDraftSnap = await getDocs(query(
                    collection(db, 'turnos'),
                    where('objectiveId', '==', selectedObjective),
                    where('code', '==', 'RFZ'),
                    where('draft', '==', true),
                ));
                const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
                rfzDraftSnap.docs
                    .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                    .filter(d => String(d.data().fecha || '').startsWith(monthPrefix))
                    .forEach(d => { batch.update(d.ref, { draft: false }); rfzPublished++; });
            } catch (e) {
                console.warn('[plan] publish RFZ draft sweep error:', e);
            }
            await batch.commit();
            const objectiveName = getObjectiveName(selectedObjective) || selectedObjective;
            const clientName = clients.find((c: any) => c.id === selectedClient)?.name || selectedClient || '';
            // 3. Registrar en audit_logs
            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'PUBLICACION_CRONOGRAMA',
                module: 'PLANIFICADOR',
                details: isSuperAdmin && (slaHoursMismatch || hasCoverageGaps)
                    ? `[OVERRIDE SA] Cronograma publicado — ${objectiveName} · ${String(month).padStart(2, '0')}/${year} · ${draftsSnap.docs.length} turno(s)`
                    : `Cronograma publicado — ${objectiveName} · ${String(month).padStart(2, '0')}/${year} · ${draftsSnap.docs.length} turno(s) notificado(s)`,
                timestamp: serverTimestamp(),
                actorName,
                actorUid: getAuth().currentUser?.uid || null,
                objectiveId: selectedObjective,
                objectiveName,
                clientId: selectedClient || undefined,
                clientName: clientName || undefined,
                year,
                month,
            }, empresaId));
            // 4. Actualizar estado local
            setPublishStatusMap(prev => ({ ...prev, [publishLookupKey]: { publishedAt: new Date(), publishedBy: actorName } }));
            setNeedsRepublishMap(prev => ({ ...prev, [publishLookupKey]: false }));
            setCorrectionMode(false);
            const totalPublished = draftsSnap.docs.length + rfzPublished;
            toast.success(
                rfzPublished > 0
                    ? `Cronograma publicado — ${totalPublished} turno(s) notificado(s) (incluye ${rfzPublished} refuerzo/s RFZ)`
                    : `Cronograma publicado — ${totalPublished} turno(s) notificado(s)`,
            );
        } catch (e) {
            console.error(e);
            toast.error('Error al publicar');
        } finally {
            setIsPublishing(false);
        }
    };

    const handleUnpublish = async () => {
        if (!selectedObjective || !isSuperAdmin || isUnpublishing) return;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const objectiveName = getObjectiveName(selectedObjective) || selectedObjective;
        const publishLookupKey = planificacionPublishLookupKey(selectedObjective, year, month);
        const primaryDocId = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
        const legacyDocId = buildPlanificacionEstadoDocId('', selectedObjective, year, month);

        const confirmed = confirm(
            `[SUPERADMIN]\n\n¿Despublicar el cronograma de ${objectiveName} — ${String(month).padStart(2, '0')}/${year}?\n\n` +
            'Esto vuelve el objetivo/mes a BORRADOR y deja de mostrarlo como cronograma publicado. No borra turnos ni toca coberturas operativas.'
        );
        if (!confirmed) return;

        setIsUnpublishing(true);
        try {
            const auth = getAuth();
            const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0, 23, 59, 59, 999);
            const shiftSnap = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
            ));
            const batch = writeBatch(db);
            let restoredDrafts = 0;

            shiftSnap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .filter(d => {
                    const data = d.data();
                    const start = data.startTime?.toDate?.();
                    if (!start || start < firstDay || start > lastDay) return false;
                    if (isOperationalOriginShift(data)) return false;
                    const code = String(data.code || '').toUpperCase();
                    if (code === 'RFZ' || code === 'TURA') return false;
                    return data.draft !== true;
                })
                .forEach(d => {
                    batch.update(d.ref, { draft: true });
                    restoredDrafts++;
                });

            // Solo quitar flags de publicación — preservar defaultPositionByEmp / defaultShiftByEmp
            const clearPublish = {
                publishedAt: deleteField(),
                publishedBy: deleteField(),
            };
            const primaryRef = doc(db, 'planificacion_estados', primaryDocId);
            const primarySnap = await getDoc(primaryRef);
            if (primarySnap.exists()) {
                batch.update(primaryRef, clearPublish);
            }
            if (legacyDocId !== primaryDocId) {
                const legacyRef = doc(db, 'planificacion_estados', legacyDocId);
                const legacySnap = await getDoc(legacyRef);
                if (legacySnap.exists()) {
                    batch.update(legacyRef, clearPublish);
                }
            }
            batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
                action: 'DESPUBLICACION_CRONOGRAMA',
                module: 'PLANIFICADOR',
                details: `Cronograma despublicado — ${objectiveName} · ${month}/${year} · ${restoredDrafts} turno(s) vuelven a borrador (puestos conservados)`,
                timestamp: serverTimestamp(),
                actorName,
                actorUid: auth.currentUser?.uid || null,
                objectiveId: selectedObjective,
                objectiveName,
                year,
                month,
            }, empresaId));

            await batch.commit();
            setPublishStatusMap(prev => ({ ...prev, [publishLookupKey]: null }));
            setNeedsRepublishMap(prev => ({ ...prev, [publishLookupKey]: false }));
            setCorrectionMode(false);
            toast.success(`Cronograma despublicado — ${restoredDrafts} turno(s) vuelven a borrador`);
        } catch (e) {
            console.error(e);
            toast.error('Error al despublicar');
        } finally {
            setIsUnpublishing(false);
        }
    };

    const resolveConflict = async (type: 'SPLIT' | 'FULL_COVERAGE') => { if (!selectedCell?.currentShift) return; const batch = writeBatch(db); const shiftId = selectedCell.currentShift.id; if (selectedCell.absence) { batch.update(doc(db, 'turnos', shiftId), { status: 'ABSENT', comments: 'Cubierto por ausencia' }); } else { batch.update(doc(db, 'turnos', shiftId), { hasNovedad: false, comments: 'Novedad resuelta' }); } if (type === 'SPLIT') { if (conflictNeighbors?.prev) { batch.update(doc(db, 'turnos', conflictNeighbors.prev.id), { isExtended: true, comments: 'Extensión por cobertura' }); } if (conflictNeighbors?.next) { batch.update(doc(db, 'turnos', conflictNeighbors.next.id), { isEarlyStart: true, comments: 'Adelanto por cobertura' }); } toast.success("Cobertura aplicada: Extensión + Adelanto"); } else { setShowConflictModal(false); setFrancoMode('FT_SELECTION'); return; } await batch.commit(); setShowConflictModal(false); setSelectedCell(null); };
    const handleRRHHSubmit = () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        if (!selectedCell) return;
        const absenceCodes: Record<string, string> = { 'Vacaciones': 'V', 'Enfermedad': 'E', 'ART': 'A', 'Injustificada': 'AA', 'Licencia Esp.': 'L', 'PG Permiso Gremial': 'PG' };
        const code = absenceCodes[rrhhData.type] || 'AA';
        const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
        const empName = employees.find((e: any) => e.id === selectedCell.empId)?.name || '';
        setPendingChanges(prev => ({ ...prev, [key]: { code, name: rrhhData.type, isTemp: true, isNovedad: true, hours: 0, startTime: '00:00' } }));
        setPendingNovedades(prev => ({ ...prev, [key]: { employeeId: selectedCell.empId, employeeName: empName, startDate: selectedCell.dateStr, endDate: selectedCell.dateStr, type: rrhhData.type, reason: rrhhData.reason, status: 'APPROVED' } }));
        toast.success("Novedad pendiente — recordá guardar los cambios");
        setShowRRHHModal(false);
        setSelectedCell(null);
    };
    const finalizeVacancyModal = () => {
        setShowVacancyModal(false);
        setVacancyData(null);
        setVacancyReplacementSearch('');
        setVacancyReplacementOpen(false);
        setVacancyActiveDates(new Set());
        setVacancyDayCoverages({});
        setVacancyFrancoAuthApproved(false);
        setVacancyEditingDay(null);
        setVacancyPickerTab('substitute');
        setVacancySplitExtId('');
        setVacancySplitAdelId('');
        setVacancyApplyToAllSelected(true);
    };

    const handleProcessVacancy = () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        if (!vacancyData?.startDate) return;
        const activeDays = [...vacancyActiveDates].sort();
        if (activeDays.length === 0) { toast.error('Seleccioná al menos un día a procesar'); return; }
        const getTypicalShift = (empId: string) => {
            const yr = currentDate.getFullYear(); const mo = currentDate.getMonth();
            const days = new Date(yr, mo + 1, 0).getDate();
            const freq: Record<string, { count: number; shift: any }> = {};
            for (let d = 1; d <= days; d++) {
                const k = `${empId}_${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const s = shiftsMap[k];
                if (s?.code && !VACANCY_NON_WORK_CODES.has(String(s.code).toUpperCase())) {
                    if (!freq[s.code]) freq[s.code] = { count: 0, shift: s };
                    freq[s.code].count++;
                }
            }
            return Object.values(freq).sort((a, b) => b.count - a.count)[0]?.shift || null;
        };
        const employeesById: Record<string, any> = {};
        employees.forEach((e: any) => { if (e.id) employeesById[e.id] = e; });
        const days = activeDays.map((dateStr) => {
            const resolved = resolveVacancyDayCoverage(dateStr, vacancyDayCoverages, selectedReplacement);
            if (resolved.mode === 'substitute') {
                const emp = employees.find((e: any) => e.id === resolved.employeeId);
                return {
                    dateStr,
                    coverage: {
                        mode: 'substitute' as const,
                        employeeId: resolved.employeeId,
                        employeeName: emp?.name ?? null,
                    },
                };
            }
            if (resolved.mode === 'split') {
                const extRow = listExtensionCandidates(
                    resolved.gapBand,
                    dateStr,
                    selectedObjective,
                    employees,
                    shiftsMap,
                    pendingChanges,
                    [vacancyData.employeeId],
                ).find(c => c.id === resolved.extEmpId);
                const adelRow = listEarlyStartCandidates(
                    resolved.gapBand,
                    dateStr,
                    selectedObjective,
                    employees,
                    shiftsMap,
                    pendingChanges,
                    [vacancyData.employeeId, resolved.extEmpId],
                ).find(c => c.id === resolved.adelEmpId);
                return {
                    dateStr,
                    coverage: {
                        mode: 'split' as const,
                        extEmpId: resolved.extEmpId,
                        adelEmpId: resolved.adelEmpId,
                        gapBand: resolved.gapBand,
                        gapPosition: resolved.gapPosition,
                        extHomePosition: extRow?.positionName,
                        extBaseCode: extRow?.code,
                        adelBaseCode: adelRow?.code,
                    },
                };
            }
            return { dateStr, coverage: { mode: 'none' as const } };
        });

        const runApplyVacancy = (authorizeFranco: boolean) => {
            try {
                const { changes, count, covered, splitCovered, cleared } = applyVacancyCoverageToChanges(pendingChanges, {
                    vacancyData,
                    days,
                    selectedObjective,
                    activePosition,
                    shiftsMap,
                    getTypicalShift,
                    employeesById,
                    clientId: selectedClient || undefined,
                    defaultSplitForBand,
                    authorizeFrancoTrabajado: authorizeFranco,
                });
                const vd = vacancyData;
                const absCode = days.length ? (changes[`${vd.employeeId}_${days[0].dateStr}`]?.code || '—') : '—';
                setPendingChanges(changes);
                finalizeVacancyModal();
                const clearedMsg = cleared > 0 ? ` Se removieron ${cleared} turno(s) de cobertura anterior.` : '';
                const totalCovered = covered + splitCovered;
                if (totalCovered > 0) {
                    const splitMsg = splitCovered > 0 ? ` (${covered} suplente, ${splitCovered} ext+adel)` : '';
                    toast.success(`${absCode} en ${count} día(s) — ${totalCovered} con cobertura${splitMsg}.${clearedMsg} Guardá los cambios.`);
                } else {
                    toast.success(`${absCode} en ${count} día(s) — sin cobertura asignada.${clearedMsg} Guardá los cambios.`);
                }
            } catch (e: any) {
                const msg = String(e?.message || '');
                if (msg.includes('FRANCO_COVERAGE')) {
                    toast.error('Hay guardias en franco sin autorizar — revisá la cobertura o pedí PIN de supervisor.');
                } else {
                    toast.error('Error al aplicar cobertura de licencia');
                }
            }
        };

        const francoConflicts = collectVacancyFrancoConflicts(
            { days, shiftsMap, employeesById },
            pendingChanges,
        );
        if (francoConflicts.length > 0 && !vacancyFrancoAuthApproved) {
            requestSupervisorFrancoAuth(francoConflicts, () => {
                setVacancyFrancoAuthApproved(true);
                runApplyVacancy(true);
            }, 'cobertura de licencia');
            return;
        }
        runApplyVacancy(francoConflicts.length > 0 || vacancyFrancoAuthApproved);
    };
    
    // Bulk: inyecta el puesto dueño del código SLA (no el default "Puesto 1") y respeta cupos de cobertura.
    const applyBulkChange = (shiftConfig: any) => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; }
        if (!selection.start || !selection.end) return;
        const startDay = daysInMonth[Math.min(selection.start.c, selection.end.c)];
        if (isPlanningDateLocked(getDateKey(startDay))) {
            const c = String(shiftConfig?.code || '').toUpperCase();
            if (!['RET', 'ESC', 'F', 'FF', 'FP', 'FT'].includes(c)) {
                toast.warning('Periodo cerrado — solo podés asignar RET, ESC o Franco en masa.');
                return;
            }
        }
        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        const minC = Math.min(selection.start.c, selection.end.c);
        const maxC = Math.max(selection.start.c, selection.end.c);
        const newChanges = { ...pendingChanges };
        let count = 0;
        let francosReplaced = 0;
        let skippedExcluded = 0;
        let skippedCoverage = 0;

        const fallbackPos = activePosition || (positionStructure[0]?.positionName) || 'General';
        const cyclesForBulk = autoSelectedCyclesRef.current?.length
            ? autoSelectedCyclesRef.current
            : autoCycles;

        const ownersForCode = (code: string) => {
            const upper = String(code || '').toUpperCase();
            return (positionStructure || []).filter((p: any) =>
                (p.shifts || []).some((s: any) => String(s.code || '').toUpperCase() === upper),
            );
        };

        const resolveAssignPos = (emp: any, code: string, hintPos?: string | null) => {
            const upper = String(code || '').toUpperCase();
            if (upper === 'RET') return 'Retén';
            if (['F', 'FF', 'FP', 'FT'].includes(upper)) return 'General';
            const owners = ownersForCode(upper);
            const empPos = empDefaultPos[`${emp.id}___${selectedObjective}`] || null;
            if (owners.length === 0) {
                // Código custom sin dueño explícito: preferir hint / default emp / activo
                return hintPos || empPos || fallbackPos;
            }
            // Hint de la barra (código de un solo puesto en el SLA) — el usuario eligió ese turno
            if (hintPos && owners.some((p: any) => p.positionName === hintPos)) return hintPos;
            // Default del empleado si es dueño del código
            if (empPos && owners.some((p: any) => p.positionName === empPos)) return empPos;
            if (activePosition && owners.some((p: any) => p.positionName === activePosition)) return activePosition;
            return owners[0].positionName;
        };

        const shiftDefFor = (posName: string, code: string) => {
            const upper = String(code || '').toUpperCase();
            const pos = (positionStructure || []).find((p: any) => p.positionName === posName);
            return (pos?.shifts || []).find((s: any) => String(s.code || '').toUpperCase() === upper) || null;
        };

        const collectCodeCounts = (dateStr: string, posName: string, changes: Record<string, any>) => {
            const dominant = (positionStructure || []).reduce(
                (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
                positionStructure[0] || { qty: 1, positionName: 'General' },
            );
            const posShifts = ((positionStructure || []).find((p: any) => p.positionName === posName)?.shifts || []) as any[];
            const codeCounts: Record<string, number> = {};
            const assigned: { code: string; hours: number }[] = [];
            displayedEmployees.forEach((emp: any) => {
                const key = `${emp.id}_${dateStr}`;
                const absence = absencesMap[key];
                if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || shiftsMap[key]?.code, absence })) return;
                const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : shiftsMap[key];
                if (!shift || !(shift.objectiveId === selectedObjective || changes[key])) return;
                const code = String(shift.code || '').toUpperCase();
                if (OBJECTIVE_NON_BILLABLE_CODES.has(code)) return;
                const shiftPos = shift.positionName || dominant?.positionName || 'General';
                if (shiftPos !== posName) return;
                codeCounts[code] = (codeCounts[code] || 0) + 1;
                assigned.push({ code, hours: resolveBandHours(code, shift, posShifts) });
            });
            return { codeCounts, assigned };
        };

        const isCoverageBlocked = (dateStr: string, posName: string, code: string, hours: number, changes: Record<string, any>) => {
            const upperEarly = String(code || '').toUpperCase();
            // RET/ESC/REF no consumen cupo de cobertura SLA
            if (['RET', 'ESC', 'REF', 'RFZ'].includes(upperEarly)) return false;
            if (!isPlanningWorkShiftCode(code)) return false;
            const posCfg = (positionStructure || []).find((p: any) => p.positionName === posName) || positionStructure[0];
            if (!posCfg) return false;
            const dayLetter = getDayLetter(dateStr);
            if (!isPosActiveOnDay(posCfg, dayLetter)) return true;
            if (isPosExcludedOnDate(posCfg, dateStr)) return true;
            const shiftRow = (posCfg.shifts || []).find((s: any) => String(s.code || '').toUpperCase() === String(code).toUpperCase());
            if (Array.isArray(shiftRow?.days) && shiftRow.days.length > 0 && !shiftRow.days.includes(dayLetter)) return true;

            const pax = Math.max(1, Number(posCfg.qty) || 1);
            const { codeCounts, assigned } = collectCodeCounts(dateStr, posName, changes);
            const units = countPositionClosedUnitsFromShifts(
                posCfg,
                dayLetter,
                codeCounts,
                cyclesForBulk,
                true,
            );
            if (units.required > 0 && units.closed >= units.required) return true;

            const upper = String(code || '').toUpperCase();
            const paxLeft = (codeCounts[upper] || 0) >= pax;
            if (paxLeft) return true;

            // Custom: solo cupo por código / esquema cerrado (arriba). Sin mezcla 8h/12h.
            if (!is24hCoverageType(posCfg)) return false;

            const bandH = resolveBandHours(upper, { hours }, posCfg.shifts);
            const is8h = isShortBandHours(bandH);
            const assigned8h = assigned.filter(a => isShortBandHours(a.hours));
            const assigned12h = assigned.filter(a => !isShortBandHours(a.hours));
            const posShifts = posCfg.shifts || [];
            const shifts8h = posShifts.filter((s: any) => isShortBandHours(resolveBandHours(s.code, s, posShifts)));
            const shifts12h = posShifts.filter((s: any) => !isShortBandHours(resolveBandHours(s.code, s, posShifts)));
            const maxSlots = shifts8h.length * pax + shifts12h.length * pax;

            if (pax === 1) {
                if (assigned8h.length > 0 && assigned12h.length > 0) return true;
                if (assigned8h.length > 0 && !is8h) return true;
                if (assigned12h.length > 0 && is8h) return true;
                if (assigned.filter(a => a.code === upper).length >= 1) return true;
            } else {
                if (assigned8h.length > 0 && !is8h) return true;
                if (assigned12h.length > 0 && is8h) return true;
                if (assigned.length >= maxSlots && maxSlots > 0) return true;
            }
            return false;
        };

        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            for (let c = minC; c <= maxC; c++) {
                const day = daysInMonth[c];
                const key = `${emp.id}_${getDateKey(day)}`;
                const existing = shiftsMap[key];
                if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig && shiftConfig.code !== 'F') {
                    francosReplaced++;
                }
            }
        }
        let markAsFT = false;
        if (francosReplaced > 0) {
            if (confirm(`⚠️ Estás sobrescribiendo ${francosReplaced} Francos.\n¿Deseas marcarlos como FT?`)) {
                markAsFT = true;
            }
        }
        const blockedEmps = new Set<string>();
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            for (let c = minC; c <= maxC; c++) {
                const day = daysInMonth[c];
                const dateStr = getDateKey(day);
                const key = `${emp.id}_${dateStr}`;
                const existing = shiftsMap[key];
                if (isShiftConsolidated(existing)) continue;
                if (shiftConfig === null) {
                    newChanges[key] = { isDeleted: true };
                    count++;
                    continue;
                }
                const codeUpper = String(shiftConfig.code || '').toUpperCase();
                const assignPos = resolveAssignPos(emp, codeUpper, shiftConfig.positionName || null);
                const posCfg = positionStructure.find((p: any) => p.positionName === assignPos);
                if (isPosExcludedOnDate(posCfg, dateStr) && isPlanningWorkShiftCode(shiftConfig.code)) {
                    skippedExcluded++;
                    continue;
                }
                const def = shiftDefFor(assignPos, codeUpper);
                const hours = resolveBandHours(codeUpper, def || shiftConfig, (posCfg?.shifts || []) as any[]);
                if (isCoverageBlocked(dateStr, assignPos, codeUpper, hours, newChanges)) {
                    skippedCoverage++;
                    continue;
                }
                const { blocked, warnings } = checkRestricciones(emp, dateStr, assignPos, shiftConfig.code);
                if (blocked) {
                    blockedEmps.add(emp.name);
                    continue;
                }
                if (warnings.length > 0) warnings.forEach(w => toast.warning(w, { duration: 8000 }));
                let cellIsFT = false;
                if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') {
                    cellIsFT = markAsFT;
                }
                newChanges[key] = {
                    code: def?.code || shiftConfig.code,
                    name: def?.name || shiftConfig.name,
                    hours,
                    startTime: def?.startTime || shiftConfig.startTime,
                    endTime: def?.endTime || shiftConfig.endTime,
                    isTemp: true,
                    oldObjectiveId: existing?.objectiveId,
                    isFrancoTrabajado: cellIsFT,
                    positionName: assignPos,
                };
                count++;
            }
        }
        if (blockedEmps.size > 0) toast.error(`🚫 Bloqueados (objetivo excluido): ${[...blockedEmps].join(', ')}`, { duration: 10000 });
        if (skippedExcluded > 0) toast.warning(`${skippedExcluded} celda(s) omitida(s): puesto excluido por SLA ese día`, { duration: 8000 });
        if (skippedCoverage > 0) toast.warning(`${skippedCoverage} celda(s) omitida(s): cobertura SLA ya completa o cupo del turno lleno`, { duration: 9000 });
        setPendingChanges(newChanges);
        if (count > 0) {
            const codeLabel = shiftConfig ? String(shiftConfig.code || '').toUpperCase() : 'BORRAR';
            const samplePos = shiftConfig
                ? (() => {
                    // Mostrar el puesto realmente usado si es único en el lote
                    return shiftConfig.positionName || '';
                })()
                : '';
            toast.info(shiftConfig
                ? `${count} celda(s) · ${codeLabel}${samplePos ? ` → ${samplePos}` : ''}`
                : `${count} celda(s) marcadas para borrar`);
        } else if (skippedCoverage > 0 || skippedExcluded > 0) {
            toast.info('Ninguna celda aplicada');
        } else {
            toast.info(`${count} celdas`);
        }
    };

    /** Completa la selección forzando un puesto SLA (elige banda por emp / primer turno del puesto). */
    const applyBulkPositionFill = (posName: string) => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; }
        if (!selection.start || !selection.end) return;
        const pos = (positionStructure || []).find((p: any) => p.positionName === posName);
        const shifts = (pos?.shifts || []) as any[];
        if (!pos || shifts.length === 0) {
            toast.error(`El puesto "${posName}" no tiene turnos en el SLA`);
            return;
        }
        const minR = Math.min(selection.start.r, selection.end.r);
        const maxR = Math.max(selection.start.r, selection.end.r);
        const minC = Math.min(selection.start.c, selection.end.c);
        const maxC = Math.max(selection.start.c, selection.end.c);
        const startDay = daysInMonth[minC];
        if (isPlanningDateLocked(getDateKey(startDay))) {
            toast.warning('Periodo cerrado — no se puede completar puestos laborales en masa.');
            return;
        }

        const pickShiftForEmp = (emp: any) => {
            const pref = String(empDefaultShift[`${emp.id}___${selectedObjective}`] || '').toUpperCase();
            if (pref && shifts.some((s: any) => String(s.code || '').toUpperCase() === pref)) {
                return shifts.find((s: any) => String(s.code || '').toUpperCase() === pref);
            }
            for (const prefer of ['M', 'T', 'N', 'D12', 'N12', 'MA']) {
                const hit = shifts.find((s: any) => String(s.code || '').toUpperCase() === prefer);
                if (hit) return hit;
            }
            return shifts[0];
        };

        // Reutilizar applyBulkChange agrupando por código elegido (misma cobertura / reglas)
        const byCode = new Map<string, { empIds: Set<string>; shift: any }>();
        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            const sh = pickShiftForEmp(emp);
            if (!sh) continue;
            const ck = String(sh.code || '').toUpperCase();
            if (!byCode.has(ck)) byCode.set(ck, { empIds: new Set(), shift: sh });
            byCode.get(ck)!.empIds.add(emp.id);
        }

        if (byCode.size === 1) {
            const only = [...byCode.values()][0];
            applyBulkChange({
                code: only.shift.code,
                name: only.shift.name,
                hours: only.shift.hours,
                startTime: only.shift.startTime,
                endTime: only.shift.endTime,
                positionName: posName,
            });
            return;
        }

        // Varios códigos: aplicar en un solo pase forzado al puesto
        const newChanges = { ...pendingChanges };
        let count = 0;
        let skippedCoverage = 0;
        let skippedExcluded = 0;
        const cyclesForBulk = autoSelectedCyclesRef.current?.length
            ? autoSelectedCyclesRef.current
            : autoCycles;
        const dominant = (positionStructure || []).reduce(
            (prev: any, cur: any) => ((prev?.qty ?? 0) > (cur?.qty ?? 0) ? prev : cur),
            positionStructure[0] || { qty: 1, positionName: 'General' },
        );

        const collectCodeCounts = (dateStr: string, changes: Record<string, any>) => {
            const codeCounts: Record<string, number> = {};
            const assigned: { code: string; hours: number }[] = [];
            const posShifts = (pos.shifts || []) as any[];
            displayedEmployees.forEach((emp: any) => {
                const key = `${emp.id}_${dateStr}`;
                const absence = absencesMap[key];
                if (isEmployeeOnLeave({ shiftCode: changes[key]?.code || shiftsMap[key]?.code, absence })) return;
                const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : shiftsMap[key];
                if (!shift || !(shift.objectiveId === selectedObjective || changes[key])) return;
                const code = String(shift.code || '').toUpperCase();
                if (OBJECTIVE_NON_BILLABLE_CODES.has(code)) return;
                const shiftPos = shift.positionName || dominant?.positionName || 'General';
                if (shiftPos !== posName) return;
                codeCounts[code] = (codeCounts[code] || 0) + 1;
                assigned.push({ code, hours: resolveBandHours(code, shift, posShifts) });
            });
            return { codeCounts, assigned };
        };

        const isBlocked = (dateStr: string, code: string, hours: number, changes: Record<string, any>) => {
            if (!isPlanningWorkShiftCode(code)) return false;
            const dayLetter = getDayLetter(dateStr);
            if (!isPosActiveOnDay(pos, dayLetter)) return true;
            if (isPosExcludedOnDate(pos, dateStr)) return true;
            const pax = Math.max(1, Number(pos.qty) || 1);
            const { codeCounts, assigned } = collectCodeCounts(dateStr, changes);
            const units = countPositionClosedUnitsFromShifts(pos, dayLetter, codeCounts, cyclesForBulk, true);
            if (units.required > 0 && units.closed >= units.required) return true;
            const upper = String(code).toUpperCase();
            if ((codeCounts[upper] || 0) >= pax) return true;
            // Custom: sin mezcla 8h/12h
            if (!is24hCoverageType(pos)) return false;
            const bandH = resolveBandHours(upper, { hours }, pos.shifts);
            const is8h = isShortBandHours(bandH);
            const a8 = assigned.filter(a => isShortBandHours(a.hours));
            const a12 = assigned.filter(a => !isShortBandHours(a.hours));
            if (pax === 1) {
                if (a8.length > 0 && a12.length > 0) return true;
                if (a8.length > 0 && !is8h) return true;
                if (a12.length > 0 && is8h) return true;
                if (assigned.filter(a => a.code === upper).length >= 1) return true;
            } else {
                if (a8.length > 0 && !is8h) return true;
                if (a12.length > 0 && is8h) return true;
            }
            return false;
        };

        for (let r = minR; r <= maxR; r++) {
            const emp = displayedEmployees[r];
            if (!emp) continue;
            const sh = pickShiftForEmp(emp);
            if (!sh) continue;
            for (let c = minC; c <= maxC; c++) {
                const dateStr = getDateKey(daysInMonth[c]);
                const key = `${emp.id}_${dateStr}`;
                const existing = shiftsMap[key];
                if (isShiftConsolidated(existing)) continue;
                if (isPosExcludedOnDate(pos, dateStr)) { skippedExcluded++; continue; }
                const hours = Number(sh.hours) || SHIFT_HOURS_LOOKUP[String(sh.code || '').toUpperCase()] || 8;
                if (isBlocked(dateStr, String(sh.code || ''), hours, newChanges)) { skippedCoverage++; continue; }
                const { blocked, warnings } = checkRestricciones(emp, dateStr, posName, sh.code);
                if (blocked) continue;
                if (warnings.length > 0) warnings.forEach(w => toast.warning(w, { duration: 8000 }));
                newChanges[key] = {
                    code: sh.code,
                    name: sh.name,
                    hours,
                    startTime: sh.startTime,
                    endTime: sh.endTime,
                    isTemp: true,
                    oldObjectiveId: existing?.objectiveId,
                    positionName: posName,
                };
                count++;
            }
        }
        setPendingChanges(newChanges);
        if (skippedCoverage > 0) toast.warning(`${skippedCoverage} celda(s) omitida(s): cobertura completa`, { duration: 8000 });
        if (skippedExcluded > 0) toast.warning(`${skippedExcluded} celda(s) omitida(s): día excluido`, { duration: 8000 });
        toast.info(count > 0 ? `${count} celda(s) · puesto ${posName}` : 'Ninguna celda aplicada');
    };

    const checkRestricciones = (emp: any, dateStr: string, positionName?: string | null, shiftCode?: string | null): { blocked: boolean; warnings: string[] } => {
        const warnings: string[] = [];
        const currentObjName = getObjectiveName(selectedObjective);
        const posForGenero = positionName || activePosition || selectedCell?.currentShift?.positionName || null;
        const posCfg = positionStructure.find((p: any) => p.positionName === posForGenero);
        if (posForGenero && isPosExcludedOnDate(posCfg, dateStr) && (shiftCode == null || isPlanningWorkShiftCode(shiftCode))) {
            warnings.push(`🚫 Puesto "${posForGenero}" excluido por SLA (${planningPositionExclusionLabel(dateStr)}) — sin servicio ese día`);
            return { blocked: true, warnings };
        }
        const prefGenero = getPreferenciaGeneroFromPositionStructure(positionStructure, posForGenero);
        const generoCheck = checkGeneroPuesto(emp.genero, prefGenero);
        if (generoCheck.blocked && generoCheck.message) {
            const posLabel = posForGenero ? ` (${posForGenero})` : '';
            warnings.push(`🚫 ${emp.name}${posLabel}: ${generoCheck.message}`);
        }
        // Objetivo excluido (match por id o nombre como fallback)
        const objRestr = (emp.restriccionesObjetivo || []).find((r: any) =>
            r.objectiveId === selectedObjective || r.objectiveName === currentObjName
        );
        if (objRestr) warnings.push(`🚫 ${emp.name} está EXCLUIDO de este objetivo${objRestr.reason ? ` (${objRestr.reason})` : ''}`);
        // Cliente excluido
        const clientRestr = (emp.restriccionesCliente || []).find((r: any) => r.clientId === selectedClient);
        if (clientRestr) warnings.push(`🚫 ${emp.name} está EXCLUIDO del cliente completo${clientRestr.reason ? ` (${clientRestr.reason})` : ''}`);
        // Conflicto con compañero ya asignado ese día
        const conflictIds = new Set((emp.conflictosEmpleados || []).map((c: any) => c.employeeId));
        if (conflictIds.size > 0) {
            displayedEmployees.forEach((other: any) => {
                if (other.id === emp.id) return;
                const otherKey = `${other.id}_${dateStr}`;
                const otherShift = pendingChanges[otherKey] || shiftsMap[otherKey];
                if (!otherShift || otherShift.isDeleted) return;
                if (otherShift.objectiveId !== selectedObjective && !pendingChanges[otherKey]) return;
                if (conflictIds.has(other.id)) {
                    const conflict = (emp.conflictosEmpleados || []).find((c: any) => c.employeeId === other.id);
                    warnings.push(`⚠️ Conflicto con ${other.name}${conflict?.reason ? ` (${conflict.reason})` : ''}`);
                }
                // Chequeo recíproco
                if ((other.conflictosEmpleados || []).some((c: any) => c.employeeId === emp.id)) {
                    warnings.push(`⚠️ ${other.name} tiene conflicto registrado con ${emp.name}`);
                }
            });
        }
        return { blocked: !!(objRestr || clientRestr || generoCheck.blocked), warnings };
    };

    const applyToPending = (config: any) => {
        const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
        const emp = displayedEmployees.find((e: any) => e.id === selectedCell.empId);
        if (emp && config && !config.isDeleted) {
            const assignPos = config.positionName || activePosition || 'General';
            const { blocked, warnings } = checkRestricciones(emp, selectedCell.dateStr, assignPos, config.code);
            if (warnings.length > 0) warnings.forEach(w => toast.warning(w, { duration: 10000 }));
            if (blocked) return;
        }
        const newChanges = { ...pendingChanges };
        newChanges[key] = {
            ...config,
            isTemp: true,
            isFranco: config.code === 'F' || config.code === 'FF' || config.isFranco,
            swapWith: config.swapWith || null,
            swapDate: config.swapDate || null,
            positionName: config.positionName || activePosition || 'General'
        };
        setPendingChanges(newChanges);
        // Toast de alerta si el nuevo turno rompe el descanso mínimo de 12h
        const _rc = String(config.code || '').toUpperCase();
        const _nonWork = new Set(['F','FF','FP','FT','V','L','A','E','PG','AA','RET']);
        if (!config.isDeleted && !_nonWork.has(_rc)) {
            const _gs = (eid: string, ds: string) => { const k2 = `${eid}_${ds}`; const p2 = newChanges[k2]; if (p2) return p2.isDeleted ? null : p2; return shiftsMap[k2] || null; };
            const _v = checkRestBetweenShifts({ empId: selectedCell.empId, targetDateStr: selectedCell.dateStr, proposed: { code: _rc, startTime: config.startTime || undefined, hours: Number(config.hours) || undefined }, getShift: _gs, cfg: { minRestBetweenShiftsHours: 12, longRestAfterWorkedHours: 48, minLongRestHours: 35 } });
            if (_v) toast.warning(`⚠️ ${_v}`, { duration: 8000 });
        }
        setSelectedCell(null);
        setActivePosition(null);
        setFrancoMode('NONE');
        setPendingAssignment(null);
        setSwapConfig(null);
        setShowSwapModal(false);
        toast.info("Cambio aplicado");
    };

    const applyRecompositionPackage = (
        updates: Record<string, any>,
        pkg: RecompositionPackage,
        novedad?: PendingAbsenceNovedad,
    ) => {
        setPendingChanges(prev => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(updates)) {
                next[k] = { ...v, isTemp: true };
            }
            return next;
        });
        if (novedad) {
            const key = `${novedad.employeeId}_${novedad.startDate}`;
            setPendingNovedades(prev => ({ ...prev, [key]: novedad }));
        }
        setPendingRecompositionPackages(prev => [...prev.filter(p => p.id !== pkg.id), pkg]);
        setSelectedCell(null);
        setRecompositionModalOpen(false);
        toast.success(
            novedad
                ? 'Ausencia RRHH y cobertura aplicadas (pendiente de guardar)'
                : 'Paquete cobertura/liberación aplicado (pendiente de guardar)',
        );
    };

    const handleAssignDeployment = (intent: 'SURPLUS' | 'TRAINING') => {
        if (!activePosition || activePosition === 'General' || activePosition === 'Retén') {
            toast.error('Seleccioná un puesto en la grilla antes de asignar refuerzo o escuela');
            return;
        }
        setDeployBandPicker(intent);
    };

    const confirmDeploymentBand = (band: string) => {
        if (!deployBandPicker || !selectedCell) return;
        const config = buildDeploymentShiftConfig(deployBandPicker, band, activePosition || 'General');
        setDeployBandPicker(null);
        handleAssignShift(config, activePosition || 'General');
    };

    const handleAssignShift = async (shiftConfig: any, positionName: string) => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; } 
        if (!selectedCell) return; 
        if (isPlanningDateLocked(selectedCell.dateStr)) {
            // Días pasados: solo se permiten RET, ESC y francos (F/FF/FP/FT). Turnos bloqueados.
            const c = String(shiftConfig.code || '').toUpperCase();
            if (!['RET','ESC','F','FF','FP','FT'].includes(c)) { toast.error("Periodo cerrado — solo podés asignar RET, ESC o Franco."); return; }
        }
        if (isShiftConsolidated(selectedCell.currentShift)) { toast.warning("Turno consolidado/fichado: solo lectura."); return; }
        if (selectedCell.absence) { toast.warning("El empleado tiene una ausencia/vacaciones registrada: no se puede planificar encima."); return; }
        const posCfg = positionStructure.find((p: any) => p.positionName === positionName);
        if (isPosExcludedOnDate(posCfg, selectedCell.dateStr) && isPlanningWorkShiftCode(shiftConfig.code)) {
            toast.error(`Puesto "${positionName}" excluido por SLA (${planningPositionExclusionLabel(selectedCell.dateStr)}). Configurado en Servicios.`, { duration: 9000 });
            return;
        }
        const existingCode = String(selectedCell.currentShift?.code || selectedCell.currentShift?.type || '').toUpperCase();
        if (['V', 'L', 'A', 'E', 'AA'].includes(existingCode)) { toast.warning("Novedad RRHH (ausencia/vacaciones/licencia): no se puede planificar encima."); return; }
        const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
        const existing = selectedCell.currentShift;
        const isFT = !correctionMode && francoMode === 'FT_SELECTION';
        if (existing && existing.objectiveId !== selectedObjective && !existing.isFranco && !isFT) { const objName = getObjectiveName(existing.objectiveId); if(!confirm(`⚠️ ALERTA DE TRANSFERENCIA\n\nEl empleado ya tiene turno en "${objName}".\n\n¿Desea moverlo a este objetivo?`)) return; applyToPending({ ...shiftConfig, oldObjectiveId: existing.objectiveId, positionName }); return; }
        if (!correctionMode && existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F' && !isFT) { if(!confirm(`⚠️ ATENCIÓN: ESTÁ ELIMINANDO UN FRANCO\n\n¿Seguro que desea eliminar el Franco?`)) return; }
        if (correctionMode && existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') { if(!confirm(`⚠️ MODO CORRECCIÓN: Vas a reemplazar un Franco publicado.\n\n¿Confirmar corrección directa?`)) return; }
        const [y, m, d] = selectedCell.dateStr.split('-').map(Number); const targetDate = new Date(y, m-1, d); const hours = shiftConfig.hours || 8;
        if (shiftConfig.code !== 'F' && !isFT && !correctionMode) {
            const warning = checkLaborRules(selectedCell.empId, targetDate, hours, {
                code: shiftConfig.code,
                startTime: shiftConfig.startTime,
                endTime: shiftConfig.endTime,
                hours: shiftConfig.hours,
            });
            if (warning) {
                setAuthWarningMessage(warning);
                if (warning.includes('CRÍTICA')) { toast.error(warning); return; }
                setPendingAssignment({ shiftConfig, positionName, targetDate });
                return;
            }
        }
        applyToPending({ ...shiftConfig, positionName, isFrancoTrabajado: isFT, isFrancoCompensatorio: false, isExtended: false, isEarlyStart: false, plannedNovedad: modifiers.plannedNovedad });
    };

    const confirmPendingAssignment = () => { if (!pendingAssignment) return; applyToPending({ ...pendingAssignment.shiftConfig, positionName: pendingAssignment.positionName, isFrancoTrabajado: francoMode === 'FT_SELECTION', isExtended: false, isEarlyStart: false, plannedNovedad: modifiers.plannedNovedad }); setPendingAssignment(null); setAuthWarningMessage(''); };

    const getShiftFor = (empId: string, dateStr: string) => {
        const k = `${empId}_${dateStr}`;
        const pending = pendingChanges[k];
        if (pending) return pending.isDeleted ? null : pending;
        return shiftsMap[k] || null;
    };

    const toChangeConfig = (shift: any) => {
        const code = (shift?.code || shift?.type || '').toString().toUpperCase();
        const hours = Number(shift?.hours) || SHIFT_HOURS_LOOKUP[code] || 8;
        const startTime = typeof shift?.startTime === 'string' ? shift.startTime : (SHIFT_RANGES[code]?.split?.('-')?.[0]?.trim?.() || '07:00');
        return {
            code: shift?.code || code,
            name: shift?.name || shift?.type || shift?.code || code,
            hours,
            startTime,
            positionName: shift?.positionName || activePosition || dominantPosition?.positionName || 'General',
            isFranco: shift?.code === 'F' || shift?.isFranco || false,
            isFrancoTrabajado: !!shift?.isFrancoTrabajado,
            isFrancoCompensatorio: !!shift?.isFrancoCompensatorio,
            plannedNovedad: shift?.plannedNovedad || null,
            isExtended: !!shift?.isExtended,
            isEarlyStart: !!shift?.isEarlyStart
        };
    };

    const executeSwap = () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; }
        if (!selectedCell?.empId || !selectedCell?.dateStr || !selectedSwapTarget) return;

        const emp1 = selectedCell.empId;
        const date1 = selectedCell.dateStr;
        const emp2 = selectedSwapTarget;
        const date2 = selectedSwapDate || date1;

        const inCurrentMonth = (dateStr: string) => {
            const [y, m] = dateStr.split('-').map(Number);
            return y === currentDate.getFullYear() && m === (currentDate.getMonth() + 1);
        };
        // Regla pedida: ambas situaciones (turno↔turno y franco↔franco) solo dentro del mes visible
        if (!inCurrentMonth(date1) || !inCurrentMonth(date2)) {
            toast.error("El intercambio debe realizarse dentro del mes en curso.");
            return;
        }

        const shift1 = getShiftFor(emp1, date1);
        const shift2 = getShiftFor(emp2, date2);
        if (!shift1 || !shift2) {
            toast.error('Ambos empleados deben tener turno en ese día');
            return;
        }
        if ([shift1, shift2].some((s: any) => isShiftConsolidated(s))) {
            toast.error("No se puede intercambiar: hay celdas consolidadas/fichadas.");
            return;
        }

        const name1 = employees.find(e => e.id === emp1)?.name || 'Emp1';
        const name2 = employees.find(e => e.id === emp2)?.name || 'Emp2';

        const newChanges = { ...pendingChanges };

        const isFrancoLike = (s: any) => {
            const code = String(s?.code || s?.type || '').toUpperCase();
            return code === 'F' || code === 'FF' || !!s?.isFranco;
        };
        const isWorkingCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());

        // Caso especial pedido: Franco ↔ Franco (intercambio de días de franco dentro del mes)
        // Para que tenga efecto real, necesitamos los "turnos laborables" cruzados:
        // - emp2 en date1 (para que emp1 pueda trabajar ese día)
        // - emp1 en date2 (para que emp2 pueda trabajar ese día)
        if (isFrancoLike(shift1) && isFrancoLike(shift2)) {
            if (date2 === date1) {
                toast.error("Para Franco ↔ Franco seleccioná un día distinto del compañero.");
                return;
            }
            const emp2AtDate1 = getShiftFor(emp2, date1);
            const emp1AtDate2 = getShiftFor(emp1, date2);
            if (!emp2AtDate1 || !emp1AtDate2) {
                toast.error("Para Franco ↔ Franco ambos deben tener turnos asignados en las dos fechas.");
                return;
            }
            if (!isWorkingCode(emp2AtDate1.code) || !isWorkingCode(emp1AtDate2.code)) {
                toast.error("Para Franco ↔ Franco se requiere que en las fechas cruzadas haya turnos laborables (no licencias/francos).");
                return;
            }
            if ([emp2AtDate1, emp1AtDate2].some((s: any) => isShiftConsolidated(s))) {
                toast.error("No se puede intercambiar: hay celdas consolidadas/fichadas.");
                return;
            }

            // Emp1: deja de estar franco en date1 y toma el turno de Emp2 en date1
            newChanges[`${emp1}_${date1}`] = { ...toChangeConfig(emp2AtDate1), isTemp: true, isSwap: true, swapWith: name2, swapDate: date2 };
            // Emp2: pasa a estar franco en date1 (recibe el franco de Emp1)
            newChanges[`${emp2}_${date1}`] = { ...toChangeConfig(shift1), isTemp: true, isSwap: true, swapWith: name1, swapDate: date1 };

            // Emp2: deja de estar franco en date2 y toma el turno de Emp1 en date2
            newChanges[`${emp2}_${date2}`] = { ...toChangeConfig(emp1AtDate2), isTemp: true, isSwap: true, swapWith: name1, swapDate: date1 };
            // Emp1: pasa a estar franco en date2 (recibe el franco de Emp2)
            newChanges[`${emp1}_${date2}`] = { ...toChangeConfig(shift2), isTemp: true, isSwap: true, swapWith: name2, swapDate: date2 };
        } else {
            // Swap estándar (como build 5005): intercambia 2 celdas (emp1/date1 ↔ emp2/date2)
            newChanges[`${emp1}_${date1}`] = { ...toChangeConfig(shift2), isTemp: true, isSwap: true, swapWith: name2, swapDate: date2 };
            newChanges[`${emp2}_${date2}`] = { ...toChangeConfig(shift1), isTemp: true, isSwap: true, swapWith: name1, swapDate: date1 };
        }
        setPendingChanges(newChanges);

        setShowSwapModal(false);
        setSwapConfig(null);
        setCoverageStep(false);
        setSelectedSwapTarget('');
        setSelectedSwapDate('');
        setSwapSearchTerm('');
        toast.success("Enroque completado");
    };

    const handleSelectDate = (dateStr: string) => { setSelectedSwapDate(dateStr); };

    // Atajos de teclado: Ctrl+C copia selección, Ctrl+V pega, Escape limpia
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.ctrlKey && e.key === 'c' && selection.start) {
                const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r);
                const maxR = Math.max(selection.start.r, selection.end?.r ?? selection.start.r);
                const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c);
                const maxC = Math.max(selection.start.c, selection.end?.c ?? selection.start.c);
                const cells: Array<{relRow: number; relCol: number; shift: any | null}> = [];
                for (let r = minR; r <= maxR; r++) {
                    for (let c = minC; c <= maxC; c++) {
                        const emp = displayedEmployees[r];
                        if (!emp || c >= daysInMonth.length) continue;
                        const key = `${emp.id}_${getDateKey(daysInMonth[c])}`;
                        const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : (shiftsMap[key] || null);
                        cells.push({ relRow: r - minR, relCol: c - minC, shift });
                    }
                }
                setClipboard(cells);
                setClipboardDim({ rows: maxR - minR + 1, cols: maxC - minC + 1 });
                toast.success(`${maxR - minR + 1}×${maxC - minC + 1} copiado — Ctrl+V o botón para pegar (se mantiene)`);
                e.preventDefault();
            }
            if (e.ctrlKey && e.key === 'v' && clipboard && selection.start) {
                const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r);
                const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c);
                const newChanges = { ...pendingChanges };
                let pasted = 0;
                clipboard.forEach(({ relRow, relCol, shift }) => {
                    const r = minR + relRow; const c = minC + relCol;
                    if (r < 0 || r >= displayedEmployees.length || c < 0 || c >= daysInMonth.length) return;
                    const emp = displayedEmployees[r];
                    const dateStr = getDateKey(daysInMonth[c]);
                    if (isPlanningDateLocked(dateStr)) return;
                    const key = `${emp.id}_${dateStr}`;
                    if (!shift) { if (newChanges[key] || shiftsMap[key]) newChanges[key] = { isDeleted: true }; }
                    else { newChanges[key] = { ...shift, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective }; pasted++; }
                });
                setPendingChanges(newChanges);
                // Mantener portapapeles y selección para poder pegar de nuevo
                toast.success(`${pasted} turno(s) pegado(s) — portapapeles listo para repetir`);
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                setSelection({ start: null, end: null });
                // Escape solo limpia selección; el portapapeles vive hasta copiar otra cosa o cerrar con X
                setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selection, clipboard, displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, columnSelectMode, isPlanningDateLocked]);

    const handleMouseUp = () => {
        setIsDragging(false);
        clearTimeout(longPressTimer.current);
        if (columnSelectMode) return; // keep selection visible for copy action
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); setSelection({ start: null, end: null }); return; }
        if (selection.start && selection.end && selection.start.r === selection.end.r && selection.start.c === selection.end.c) {
            const emp = displayedEmployees[selection.start.r]; 
            const day = daysInMonth[selection.start.c]; 
            const dateStr = getDateKey(day); 
            const key = `${emp.id}_${dateStr}`; 
            const rfzOnCell = rfzByEmpDate[key];
            const shift = pendingChanges[key] || shiftsMap[key]; 
            const absence = absencesMap[key]; 
            if (selection.start.r === selection.end.r && selection.start.c === selection.end.c) { setSelection({ start: null, end: null }); } 
            {
                // Si la celda tiene borrado pendiente, tratar como vacía para permitir reasignar sin guardar
                const effectiveShift = pendingChanges[key]?.isDeleted
                    ? null
                    : (shift || (rfzOnCell ? rfzDocToShiftView(rfzOnCell) : null));
                const empPreferred = empDefaultPos[`${emp.id}___${selectedObjective}`];
                const defaultPos = effectiveShift?.positionName || empPreferred || dominantPosition.positionName;
                setActivePosition(defaultPos);
                if (isShiftConsolidated(effectiveShift)) { setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); return; }
                const isLocked = isPlanningDateLocked(dateStr);
                const absenceAlreadyHandled = effectiveShift && ['V','L','PG','A','E','AA'].includes(effectiveShift.code || '');
                if (!isLocked && ((effectiveShift && absence && !absenceAlreadyHandled) || (effectiveShift && effectiveShift.hasNovedad && !absenceAlreadyHandled))) { findNeighbors(effectiveShift, dateStr); setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); if (absence && absence.type) { setVacancyData({ ...absence, source: 'AUSENCIA', focusDate: dateStr }); setShowVacancyModal(true); } else { setShowConflictModal(true); } }
                else if (!isLocked && absence && !effectiveShift) { setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); setVacancyData({ ...absence, source: 'AUSENCIA', focusDate: dateStr }); setShowVacancyModal(true); }
                else { if (!isLocked) { setModifiers({ plannedNovedad: effectiveShift?.plannedNovedad || '' }); setFrancoMode('NONE'); }
                    const pubKey = planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1);
                    setCellEditMode(correctionMode && isPlanificacionPublished(publishStatusMap[pubKey]));
                    setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); }
            }
        } 
    };
    const handleMouseDown = (r: number, c: number) => { if (!selectedObjective || comparingSnapshot || isServiceLocked) return; setIsDragging(true); setSelection({ start: {r, c}, end: {r, c} }); };
    const handleMouseEnter = (r: number, c: number) => { if (!isDragging) return; setSelection(prev => ({ ...prev, end: {r, c} })); };
    const isCellSelected = (r: number, c: number) => selection.start && r >= Math.min(selection.start.r, selection.end!.r) && r <= Math.max(selection.start.r, selection.end!.r) && c >= Math.min(selection.start.c, selection.end!.c) && c <= Math.max(selection.start.c, selection.end!.c);

    // ── COLUMN SELECT (long press on day header) ──────────────────────────────
    const handleDayHeaderMouseDown = (dayIndex: number) => {
        if (!selectedObjective || comparingSnapshot || isServiceLocked) return;
        // Segundo clic en la misma fuente: cancela
        if (columnSelectMode && columnSelectSource === dayIndex) {
            setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false);
            setSelection({ start: null, end: null });
            return;
        }
        setColumnSelectMode(true);
        setColumnSelectSource(dayIndex);
        setIsDragging(true);
        setSelection({ start: { r: 0, c: dayIndex }, end: { r: displayedEmployees.length - 1, c: dayIndex } });
    };
    const handleDayHeaderMouseEnter = (dayIndex: number) => {
        if (!columnSelectMode || !isDragging) return;
        setSelection(prev => prev.start ? ({ start: prev.start, end: { r: displayedEmployees.length - 1, c: dayIndex } }) : prev);
    };
    const handleDayHeaderMouseUpOrLeave = () => { clearTimeout(longPressTimer.current); };

    // Seleccionar fila completa (click en nombre de empleado)
    const handleRowHeaderClick = (rowIndex: number) => {
        if (!selectedObjective || comparingSnapshot || isServiceLocked || columnSelectMode) return;
        setSelection({ start: { r: rowIndex, c: 0 }, end: { r: rowIndex, c: daysInMonth.length - 1 } });
    };

    // Copiar selección al clipboard
    const handleCopySelection = () => {
        if (!selection.start) return;
        const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r);
        const maxR = Math.max(selection.start.r, selection.end?.r ?? selection.start.r);
        const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c);
        const maxC = Math.max(selection.start.c, selection.end?.c ?? selection.start.c);
        const cells: Array<{relRow: number; relCol: number; shift: any | null}> = [];
        for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
                const emp = displayedEmployees[r];
                if (!emp || c >= daysInMonth.length) continue;
                const dateStr = getDateKey(daysInMonth[c]);
                const key = `${emp.id}_${dateStr}`;
                const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : (shiftsMap[key] || null);
                cells.push({ relRow: r - minR, relCol: c - minC, shift });
            }
        }
        setClipboard(cells);
        setClipboardDim({ rows: maxR - minR + 1, cols: maxC - minC + 1 });
        toast.success(`${maxR - minR + 1}×${maxC - minC + 1} copiado — seleccioná destino y pegá (se mantiene hasta copiar otra cosa)`);
    };

    // Pegar clipboard en posición objetivo
    const handlePasteAt = (targetRow: number, targetCol: number) => {
        if (!clipboard) return;
        const newChanges = { ...pendingChanges };
        let pasted = 0;
        clipboard.forEach(({ relRow, relCol, shift }) => {
            const r = targetRow + relRow;
            const c = targetCol + relCol;
            if (r < 0 || r >= displayedEmployees.length || c < 0 || c >= daysInMonth.length) return;
            const emp = displayedEmployees[r];
            const dateStr = getDateKey(daysInMonth[c]);
            if (isPlanningDateLocked(dateStr)) return;
            const key = `${emp.id}_${dateStr}`;
            if (!shift) {
                if (newChanges[key] || shiftsMap[key]) newChanges[key] = { isDeleted: true };
            } else {
                newChanges[key] = { ...shift, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective };
                pasted++;
            }
        });
        setPendingChanges(newChanges);
        // Mantener portapapeles y selección para pegar varias veces
        toast.success(`${pasted} turno(s) pegado(s) — portapapeles listo para repetir`);
    };

    // Importar mes anterior como plantilla (solo celdas vacías)
    const applyPrevMonthTemplate = async () => {
        if (!selectedObjective) return;
        setPrevMonthLoading(true);
        try {
            const prevStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
            const prevEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
            const snap = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('startTime', '>=', Timestamp.fromDate(prevStart)),
                where('startTime', '<=', Timestamp.fromDate(prevEnd))
            ));
            const prevShifts = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
            const newChanges = { ...pendingChanges };
            let applied = 0, skipped = 0;
            prevShifts.forEach((shift: any) => {
                const shiftDate = shift.startTime?.toDate ? shift.startTime.toDate() : new Date(shift.startTime?.seconds * 1000);
                const dayNum = shiftDate.getDate();
                const targetDay = daysInMonth.find(d => d.getDate() === dayNum);
                if (!targetDay) return;
                const targetDateStr = getDateKey(targetDay);
                if (isPlanningDateLocked(targetDateStr)) return;
                if (!displayedEmployees.find((e: any) => e.id === shift.employeeId)) return;
                const key = `${shift.employeeId}_${targetDateStr}`;
                if (pendingChanges[key] || shiftsMap[key]) { skipped++; return; }
                const { id: _id, ...rest } = shift;
                newChanges[key] = { ...rest, isTemp: true, employeeId: shift.employeeId, objectiveId: selectedObjective };
                applied++;
            });
            setPendingChanges(newChanges);
            toast.success(`Plantilla aplicada: ${applied} turnos importados${skipped > 0 ? `, ${skipped} omitidos (ya tenían turno)` : ''}`);
        } catch (e) {
            toast.error('Error al cargar el mes anterior');
        } finally {
            setPrevMonthLoading(false);
        }
    };


    /**
     * Carga las ausencias que SOLAPAN con el rango [monthStart, monthEnd], no solo
     * las que ARRANCAN dentro del mes. Esto soluciona el caso de vacaciones / ART
     * que empezaron antes y siguen vigentes en el mes a planificar.
     *
     * - Query: startDate dentro de [monthStart - 2 meses, monthEnd] para evitar
     *   pedir un índice nuevo sobre endDate y aún así capturar la cola.
     * - Filtra en cliente por endDate >= monthStart.
     * - Excluye ausencias rechazadas/canceladas (status).
     * - Infere el código (V/L/E/A/PG/AA) desde `absenceType`, `code` o `type`.
     */
    const loadAbsencesForRange = async (
        monthStart: Date,
        monthEnd: Date,
    ): Promise<Record<string, Map<string, string>>> => {
        const absSnap = await getDocs(empresaCollectionQuery('ausencias', empresaId, scopeEmpresa));
        const monthStartStr = toCalendarDateStr(monthStart) || getDateKey(monthStart);
        const monthEndStr = toCalendarDateStr(monthEnd) || getDateKey(monthEnd);
        const absences: Record<string, Map<string, string>> = {};
        absSnap.docs.forEach(d => {
            const data = d.data() as any;
            if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
            const empId = data.employeeId;
            if (!empId) return;
            if (!isActiveAbsence(data)) return;
            const startStr = toCalendarDateStr(data.startDate);
            const endStr = toCalendarDateStr(data.endDate);
            if (!startStr || !endStr) return;
            const range = validateAbsenceDateRange(startStr, endStr);
            if (!range.ok) return;
            if (range.endDate < monthStartStr || range.startDate > monthEndStr) return;
            const code = inferAbsenceCode(data);
            if (!absences[empId]) absences[empId] = new Map();
            iterateCalendarDateRange(range.startDate, range.endDate).forEach((dateStr) => {
                if (dateStr < monthStartStr || dateStr > monthEndStr) return;
                const [y, m, day] = dateStr.split('-').map(Number);
                absences[empId].set(getDateKey(new Date(y, m - 1, day, 12, 0, 0, 0)), code);
            });
        });
        return absences;
    };

    const RRHH_ABSENCE_GRID = new Set(['V', 'L', 'A', 'E', 'AA', 'PG']);

    /** Licencias/ausencias ya visibles en grilla o pendientes (no solo colección ausencias). */
    const mergeAbsencesFromLocalGrid = (
        absences: Record<string, Map<string, string>>,
        empIds: string[],
        monthStart: Date,
        monthEnd: Date,
    ) => {
        const idSet = new Set(empIds);
        const mergeCell = (empId: string, dateStr: string, code: string) => {
            if (!idSet.has(empId)) return;
            const d = new Date(`${dateStr}T12:00:00`);
            if (d < monthStart || d > monthEnd) return;
            if (!absences[empId]) absences[empId] = new Map();
            if (!absences[empId].has(dateStr)) absences[empId].set(dateStr, code);
        };
        const scan = (src: Record<string, any>) => {
            Object.entries(src).forEach(([key, cell]) => {
                if (!cell || cell.isDeleted) return;
                if (cell.objectiveId && cell.objectiveId !== selectedObjective) return;
                const code = String(cell.code || '').toUpperCase();
                if (!RRHH_ABSENCE_GRID.has(code)) return;
                const empId = String(cell.employeeId || key.split('_')[0] || '');
                const dateStr = String(cell.dateStr || key.slice(empId.length + 1) || '');
                if (!empId || !dateStr) return;
                mergeCell(empId, dateStr, code);
            });
        };
        scan(shiftsMap);
        scan(pendingChanges);
    };

    const bumpAutoV2Progress = async (pct: number, label: string) => {
        setAutoV2Progress({ pct, label });
        await new Promise<void>((r) => {
            requestAnimationFrame(() => requestAnimationFrame(() => r()));
        });
    };

    /**
     * Viabilidad del cronograma (motor COSP) antes de generar.
     */
    const generateAutoScheduleV2 = async (): Promise<{ ok: boolean; cycles: string[] }> => {
        if (!selectedObjective) return { ok: false, cycles: [] };
        if (!positionStructure.length) { toast.error('No hay puestos/SLA configurados para este objetivo'); return { ok: false, cycles: [] }; }
        if (!planningDotacionEmployees.length) { toast.error('No hay empleados activos en la dotación (REF/ESC no cuentan)'); return { ok: false, cycles: [] }; }

        setAutoV2Loading(true);
        setAutoV2Progress({ pct: 4, label: 'Iniciando análisis…' });
        try {
            const SHIFT_HRS_LOCAL: Record<string,number> = { M:8, T:8, N:8, D12:12, N12:12 };

            // Cargar ausencias que SOLAPAN con el mes (vacaciones, ART, licencias en curso)
            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const monthEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0, 23, 59, 59);
            await bumpAutoV2Progress(12, 'Cargando ausencias y licencias del mes…');
            const absences = await loadAbsencesForRange(monthStart, monthEnd);
            mergeAbsencesFromLocalGrid(absences, planningDotacionEmployees.map((e: any) => e.id), monthStart, monthEnd);
            setAutoAbsencesMap(absences);

            // Días V/L/E que el cerebro maneja automáticamente (modo12DaysAuto)
            const autoModo12AbsDays = new Set<string>();
            for (const map of Object.values(absences)) {
                if (!map) continue;
                map.forEach((code, ds) => { if (['V','L','E'].includes(String(code).toUpperCase())) autoModo12AbsDays.add(ds); });
            }
            // Limpiar contingencia manual que solapa con ausencias auto
            setAutoContingenciaDias(prev => {
                const next = new Set([...prev].filter(d => !autoModo12AbsDays.has(d)));
                return next.size !== prev.size ? next : prev;
            });

            // Acumular cola CCT del mes anterior (26 → fin) por empleado
            const empMonthlyInitial: Record<string,number> = {};
            planningDotacionEmployees.forEach((emp: any) => { empMonthlyInitial[emp.id] = 0; });
            const cyclePreStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 26);
            const cyclePreEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
            await bumpAutoV2Progress(32, 'Leyendo cola CCT (26 → fin mes anterior)…');
            const prevTailSnap  = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('startTime', '>=', Timestamp.fromDate(cyclePreStart)),
                where('startTime', '<=', Timestamp.fromDate(cyclePreEnd))
            ));
            prevTailSnap.docs.forEach(d => {
                const data = d.data() as any;
                if (!turnoCuentaParaCronoPlanificado(data, selectedObjective)) return;
                const empId = data.employeeId; if (!empId) return;
                if (OBJECTIVE_NON_BILLABLE_CODES.has(String(data.code||'').toUpperCase())) return;
                const h = Number(data.hours) || SHIFT_HRS_LOCAL[String(data.code||'').toUpperCase()] || 8;
                empMonthlyInitial[empId] = (empMonthlyInitial[empId] || 0) + h;
            });

            // Viabilidad: NO descontar la grilla actual (shiftsMap / pending).
            // Eso medía "cuánto cupo queda si no sobreescribo", no "si la dotación puede cumplir el SLA".
            // El generador clásico sí usa ese descuento para recortes; acá solo cola CCT + ausencias.

            const client = clients.find((c:any) => c.objetivos?.some((o:any) => (o.id || o.name) === selectedObjective));
            const objMeta: any = client?.objetivos?.find((o:any) => (o.id || o.name) === selectedObjective);
            await bumpAutoV2Progress(52, 'Cerebro Auto: esquema, dotación y Modo 12…');
            await new Promise<void>((r) => setTimeout(r, 0));
            const brainInput = {
                positions: positionStructure,
                employees: planningDotacionEmployees.map((e:any) => ({
                    id: e.id,
                    nombre: e.nombre || e.name,
                    lat: typeof e.lat === 'number' ? e.lat : null,
                    lng: typeof e.lng === 'number' ? e.lng : null,
                    preferredObjectiveId: e.preferredObjectiveId,
                })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                getDayLetter,
                getDateKey,
                contingencyDaysManual: [...autoContingenciaDias].filter(d => !autoModo12AbsDays.has(d)),
                rotateShiftsOverride: autoRotateForce ?? undefined,
                ajustarCronoOverride: autoAjustarCrono,
                cycleOverride: '6+2',
            };
            autoPlanningBrainInputRef.current = brainInput;
            const brain = resolveAutoPlanningBrain(brainInput);
            autoPlanningBrainRef.current = brain;
            setAutoPlanningBrainReport(brain);

            if (!brain.contingencyOk) {
                brain.contingencyMessages.forEach(msg => toast.error(msg, { duration: 9000 }));
                autoV2ReportRef.current = brain.feasibility;
                setAutoV2Report(brain.feasibility);
                return { ok: false, cycles: brain.cycles };
            }

            autoSelectedCyclesRef.current = brain.cycles;
            setAutoCycles(brain.cycles);

            await bumpAutoV2Progress(72, 'Leyendo demanda SLA del objetivo…');
            const preflightDays = daysInMonth.map(day => {
                const dateStr = getDateKey(day);
                return { dateStr, dayLetter: getDayLetter(dateStr) };
            });
            const preflight = buildObjectiveCoveragePreflight({
                positions: positionStructure,
                days: preflightDays,
                employees: planningDotacionEmployees.map((e: any) => ({ id: e.id, nombre: e.nombre, name: e.name })),
                absences,
                slaVendidas,
                cycles: brain.cycles,
                objectiveId: selectedObjective,
                isPosActiveOnDay,
                apretarCronoDays: brain.modo12DaysEngine,
            });
            setAutoV2CoveragePreflight(preflight);

            await bumpAutoV2Progress(100, `Esquema ${brain.pickedCycle} · ${brain.staffing.servicioDiarioModo8}+${brain.staffing.poolFrancos} · viabilidad`);
            await new Promise<void>((r) => setTimeout(r, 150));
            autoV2ReportRef.current = brain.feasibility;
            setAutoV2Report(brain.feasibility);
            if (brain.pickedCycle === '4+2') {
                toast.warning('Esquema 4+2 (D12/N12): ningún ciclo M/T/N 8h cerró con la dotación actual.', { duration: 8000 });
            }
            brain.warnings.forEach(w => toast.message(w, { duration: 6000 }));
            // Déficit de horas/dotación = advertencia, NO bloqueo. El motor puede generar igual.
            // Bloqueo duro = no se encontraron ciclos (brain.cycles vacío).
            return { ok: brain.cycles.length > 0, cycles: brain.cycles };
        } catch (e:any) {
            toast.error('Error al analizar viabilidad');
            console.error('[autoScheduleCOSP]', e);
            return { ok: false, cycles: [] };
        } finally {
            setAutoV2Loading(false);
            setAutoV2Progress(null);
        }
    };

    // Flujo completo: detectar esquema → si ok generar; si no ok, mostrar error
    const runFullGeneration = () => {
        setAutoWizardStep('detecting');
        generateAutoScheduleV2()
            .then(({ ok, cycles }) => {
                if (ok) return applyAutoScheduleV2(cycles);
                setAutoWizardStep('verified');
            })
            .catch(() => setAutoWizardStep('configure'));
    };

    // Reset al cerrar el wizard (no auto-ejecutar al abrir)
    useEffect(() => {
        if (!showAutoV2Modal) {
            setAutoWizardStep('configure');
            setAutoWizardPersonalize(true);
            autoV2ReportRef.current = null;
            autoPlanningBrainRef.current = null;
            autoPlanningBrainInputRef.current = null;
            setAutoV2Report(null);
            setAutoPlanningBrainReport(null);
            setAutoV2FormReport(null);
            setAutoRotateForce(null);
            setAutoV2GenStats(null);
            setAutoV2GeminiSummary(null);
            setAutoCoverageGaps([]);
            setPlanCoverageModalGaps([]);
            setCoverageSelectedDays(new Set());
        }
    }, [showAutoV2Modal]);

    /** Paso 4 del agente: ajuste fino Gemini sobre cronograma ya generado + fixer. */
    const runAutoV2PlanningAgentGemini = async (
        finalAssignments: import('@/lib/planificacion/autoScheduleEngineV2').V2Assignment[],
        coverage: import('@/lib/planificacion/coverageVerification').CoverageVerificationReport,
        verifyCtx: import('@/lib/planificacion/autoScheduleEngineV2').V2EngineContext,
        stats: import('@/lib/planificacion/autoScheduleEngineV2').V2GenerateStats,
        newChanges: Record<string, any>,
        force = false,
        partOfGenerate = false,
    ) => {
        if (!selectedObjective || (!autoV2RunGemini && !force)) {
            return { assignments: finalAssignments, changes: newChanges, coverage };
        }
        if (!force && !shouldRunGeminiOptimizeStep(coverage)) {
            return { assignments: finalAssignments, changes: newChanges, coverage };
        }
        setAutoV2GeminiLoading(true);
        try {
            if (partOfGenerate) {
                await bumpAutoV2Progress(92, 'Ajuste fino IA (Gemini)…');
            } else {
                setAutoV2Progress({ pct: 8, label: 'Ajuste fino IA (Gemini)…' });
            }
            const y = currentDate.getFullYear();
            const m = currentDate.getMonth();
            const mes = `${y}-${String(m + 1).padStart(2, '0')}`;
            const cutoff = autoV2ReportRef.current?.metrics?.cctCutoffDay ?? 25;
            const prevM = m === 0 ? 12 : m;
            const prevY = m === 0 ? y - 1 : y;
            const diasBloqueados = daysInMonth.map((d) => getDateKey(d)).filter((ds) => isDateLocked(ds));
            const plannerContext = buildPlannerContextFromAutoRun({
                mes,
                objetivo: getObjectiveName(selectedObjective),
                objectiveId: selectedObjective,
                slaVendidas,
                ctx: verifyCtx,
                assignments: finalAssignments,
                stats,
                diasBloqueados,
                cicloCCT: {
                    cortePrev: `${prevY}-${String(prevM).padStart(2, '0')}-26`,
                    corteActual: `${y}-${String(m + 1).padStart(2, '0')}-${String(cutoff).padStart(2, '0')}`,
                    descripcion: `Ciclo CCT: 26/${prevM} → ${cutoff}/${m + 1}; control 200h por ciclo`,
                },
            });
            const result = await runPlanningAgentOptimizeStep({
                plannerContext,
                empresaId: empresaId || undefined,
                baseChanges: newChanges,
                objectiveId: selectedObjective,
                assignments: finalAssignments,
                isDateLocked,
            });
            setAutoV2GeminiSummary(result.gemini.resumen || null);
            let assignments = result.assignments;
            let changes = result.changes;
            if (result.gemini.correcciones?.length) {
                toast.info(`Ajuste fino IA: ${result.applied} corrección(es).`, { duration: 6000 });
            } else if (result.blocked) {
                toast.warning(result.gemini.razonBloqueo || 'IA: no puede cerrar el cronograma con la dotación actual.', { duration: 8000 });
            } else {
                toast.success('IA: cronograma sin cambios adicionales.', { duration: 4000 });
            }
            const coverageAfter = verifyScheduleCoverage(verifyCtx, assignments, stats);
            return { assignments, changes, coverage: coverageAfter };
        } catch (e: any) {
            console.error('[planningAgentGemini]', e);
            const msg = String(e?.message || e?.code || '');
            if (/deadline-exceeded|timeout|timed out/i.test(msg)) {
                toast.error(
                    'Ajuste fino IA: tiempo agotado (~3 min). Se mantiene el cronograma ya generado. Podés desactivar Gemini y re-generar.',
                    { duration: 10000 },
                );
            } else {
                toast.error(msg || 'Error en ajuste fino IA');
            }
            return { assignments: finalAssignments, changes: newChanges, coverage };
        } finally {
            setAutoV2GeminiLoading(false);
            if (!partOfGenerate) {
                setAutoV2Progress(null);
            }
        }
    };

    /**
     * Genera asignaciones y las vuelca a pendingChanges (motor COSP).
     */
    const applyAutoScheduleV2 = async (cyclesOverride?: string[]) => {
        if (!selectedObjective) return;
        if (!autoV2ReportRef.current) { toast.error('Calculá viabilidad primero'); return; }
        const cyclesForGen = cyclesOverride ?? autoSelectedCyclesRef.current ?? autoCycles;
        if (!cyclesForGen.length) { toast.error('No se detectó esquema de ciclo'); return; }
        setAutoV2Generating(true);
        setAutoV2Progress({ pct: 4, label: 'Iniciando generación…' });
        try {
            const SHIFT_HRS_LOCAL: Record<string,number> = { M:8, T:8, N:8, D12:12, N12:12 };

            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const monthEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0, 23, 59, 59);
            await bumpAutoV2Progress(10, 'Cargando ausencias y licencias del mes…');
            const absences = await loadAbsencesForRange(monthStart, monthEnd);
            mergeAbsencesFromLocalGrid(absences, planningDotacionEmployees.map((e: any) => e.id), monthStart, monthEnd);
            setAutoAbsencesMap(absences);

            const autoModo12AbsDays = new Set<string>();
            for (const map of Object.values(absences)) {
                if (!map) continue;
                map.forEach((code, ds) => { if (['V','L','E'].includes(String(code).toUpperCase())) autoModo12AbsDays.add(ds); });
            }
            setAutoContingenciaDias(prev => {
                const next = new Set([...prev].filter(d => !autoModo12AbsDays.has(d)));
                return next.size !== prev.size ? next : prev;
            });

            const preflightDays = daysInMonth.map(day => {
                const dateStr = getDateKey(day);
                return { dateStr, dayLetter: getDayLetter(dateStr) };
            });
            setAutoV2CoveragePreflight(buildObjectiveCoveragePreflight({
                positions: positionStructure,
                days: preflightDays,
                employees: planningDotacionEmployees.map((e: any) => ({ id: e.id, nombre: e.nombre, name: e.name })),
                absences,
                slaVendidas,
                cycles: cyclesForGen,
                objectiveId: selectedObjective,
                isPosActiveOnDay,
                apretarCronoDays: autoPlanningBrainRef.current?.modo12DaysEngine ?? [...autoContingenciaDias],
            }));

            const empMonthlyInitial: Record<string,number> = {};
            displayedEmployees.forEach((emp: any) => { empMonthlyInitial[emp.id] = 0; });
            const cyclePreStart = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 26);
            const cyclePreEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0, 23, 59, 59);
            await bumpAutoV2Progress(24, 'Leyendo cola CCT (26 → fin mes anterior)…');
            const prevTailSnap  = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('startTime', '>=', Timestamp.fromDate(cyclePreStart)),
                where('startTime', '<=', Timestamp.fromDate(cyclePreEnd))
            ));
            prevTailSnap.docs.forEach(d => {
                const data = d.data() as any;
                if (!turnoCuentaParaCronoPlanificado(data, selectedObjective)) return;
                const empId = data.employeeId; if (!empId) return;
                if (OBJECTIVE_NON_BILLABLE_CODES.has(String(data.code||'').toUpperCase())) return;
                const h = Number(data.hours) || SHIFT_HRS_LOCAL[String(data.code||'').toUpperCase()] || 8;
                empMonthlyInitial[empId] = (empMonthlyInitial[empId] || 0) + h;
            });

            // ── Racha del mes anterior: calcula la fase de ciclo correcta para el día 1 ──
            // Consultamos los últimos 10 días del mes anterior (cubre 6+2 y 4+2).
            // Sin esto el motor asigna offsets ficticios y genera hasta 9 días seguidos (ej. trabajó
            // mayo 29-31 y el motor arranca el ciclo desde el día 1 de junio sin saberlo).
            const prevMonthEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0); // último día mes anterior
            const trailLookbackStart = new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), Math.max(1, prevMonthEndDate.getDate() - 9));
            const prevTrailSnap = await getDocs(query(
                collection(db, 'turnos'),
                where('objectiveId', '==', selectedObjective),
                where('startTime', '>=', Timestamp.fromDate(trailLookbackStart)),
                where('startTime', '<=', Timestamp.fromDate(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), prevMonthEndDate.getDate(), 23, 59, 59)))
            ));
            const prevTrailByEmp: Record<string, Record<string, string>> = {};
            const FRANCO_CODES_SET = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG']);
            prevTrailSnap.docs.forEach(d => {
                const data = d.data() as any;
                if (!turnoCuentaParaCronoPlanificado(data, selectedObjective)) return;
                if (!data.employeeId || !data.startTime) return;
                const dt: Date = (data.startTime as Timestamp).toDate();
                const dateStr = getDateKey(dt);
                const code = String(data.code || '').toUpperCase();
                if (!prevTrailByEmp[data.employeeId]) prevTrailByEmp[data.employeeId] = {};
                prevTrailByEmp[data.employeeId][dateStr] = code;
            });
            const prevMonthTrailingWorkDays: Record<string, number> = {};
            const prevMonthTrailingRestDays: Record<string, number> = {};
            const prevMonthLastShiftByEmp: Record<string, string> = {};
            const prevMonthLastWorkBandBeforeRest: Record<string, string> = {};
            const lastDayStr = getDateKey(prevMonthEndDate);
            displayedEmployees.forEach((emp: any) => {
                const empShifts = prevTrailByEmp[emp.id] || {};
                const lastCode = empShifts[lastDayStr];
                if (!lastCode) return; // sin datos, el motor usará offset distribuido
                // RET es día de trabajo en el ciclo CCT — contar como trabajo y buscar banda real
                if (lastCode === 'RET') {
                    prevMonthLastShiftByEmp[emp.id] = 'RET';
                    let workCount = 1;
                    let foundBand: string | null = null;
                    let consGap = 0;
                    for (let d = prevMonthEndDate.getDate() - 1; d >= 1; d--) {
                        const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                        const c = empShifts[ds];
                        if (!c) {
                            consGap++;
                            if (consGap > 1) break;
                            workCount++;
                            continue;
                        }
                        consGap = 0;
                        if (FRANCO_CODES_SET.has(c)) break;
                        if (c !== 'RET' && !foundBand) foundBand = c;
                        workCount++;
                    }
                    prevMonthTrailingWorkDays[emp.id] = workCount;
                    prevMonthTrailingRestDays[emp.id] = 0;
                    if (foundBand) prevMonthLastWorkBandBeforeRest[emp.id] = foundBand;
                    return;
                }
                prevMonthLastShiftByEmp[emp.id] = lastCode;
                if (FRANCO_CODES_SET.has(lastCode)) {
                    for (let d = prevMonthEndDate.getDate(); d >= 1; d--) {
                        const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                        const c = empShifts[ds];
                        if (!c) break;
                        if (!FRANCO_CODES_SET.has(c)) {
                            prevMonthLastWorkBandBeforeRest[emp.id] = c;
                            break;
                        }
                    }
                }
                const isFrancoLast = FRANCO_CODES_SET.has(lastCode);
                let count = 0;
                let consecutiveMissing = 0;
                for (let d = prevMonthEndDate.getDate(); d >= 1; d--) {
                    const ds = getDateKey(new Date(prevMonthEndDate.getFullYear(), prevMonthEndDate.getMonth(), d));
                    const c = empShifts[ds];
                    if (!c) {
                        // Día sin datos: probable RET en otro objetivo — puente de hasta 1 día consecutivo
                        consecutiveMissing++;
                        if (consecutiveMissing > 1) break;
                        count++;
                        continue;
                    }
                    consecutiveMissing = 0;
                    const isFranco = FRANCO_CODES_SET.has(c);
                    if (isFrancoLast && isFranco) { count++; }
                    else if (!isFrancoLast && !isFranco) { count++; }
                    else break;
                }
                if (isFrancoLast) prevMonthTrailingRestDays[emp.id] = count;
                else prevMonthTrailingWorkDays[emp.id] = count;
            });

            const client = clients.find((c:any) => c.objetivos?.some((o:any) => (o.id || o.name) === selectedObjective));
            const objMeta: any = client?.objetivos?.find((o:any) => (o.id || o.name) === selectedObjective);
            const defaultPositionByEmp: Record<string,string> = {};
            const defaultShiftByEmp: Record<string,string> = {};
            displayedEmployees.forEach((e:any) => {
                const pos = empDefaultPos[`${e.id}___${selectedObjective}`];
                if (pos) defaultPositionByEmp[e.id] = pos;
                const shift = empDefaultShift[`${e.id}___${selectedObjective}`];
                if (shift) defaultShiftByEmp[e.id] = shift;
            });
            // Flotantes de empresa: empleados activos sin objetivo asignado.
            // El motor V3 los usa como refuerzo (Fase 3) cuando quedan slots sin cubrir
            // tras los regulares y los FLEX del objetivo en curso.
            const displayedIds = new Set(displayedEmployees.map((e: any) => e.id));
            const globalRetPool = employees
                .filter((e: any) =>
                    e.status !== 'inactivo' &&
                    !displayedIds.has(e.id) &&
                    (!e.preferredObjectiveId || e.preferredObjectiveId === '')
                )
                .map((e: any) => ({ id: e.id, nombre: e.nombre || e.name }));

            const genBrain = autoPlanningBrainRef.current ?? resolveAutoPlanningBrain({
                positions: positionStructure,
                employees: planningDotacionEmployees.map((e:any) => ({
                    id: e.id,
                    nombre: e.nombre || e.name,
                    lat: typeof e.lat === 'number' ? e.lat : null,
                    lng: typeof e.lng === 'number' ? e.lng : null,
                    preferredObjectiveId: e.preferredObjectiveId,
                })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                getDayLetter,
                getDateKey,
                contingencyDaysManual: [...autoContingenciaDias].filter(d => !autoModo12AbsDays.has(d)),
                rotateShiftsOverride: autoRotateForce ?? undefined,
                ajustarCronoOverride: autoAjustarCrono,
                cycleOverride: '6+2',
            });
            autoPlanningBrainRef.current = genBrain;
            setAutoPlanningBrainReport(genBrain);
            if (!genBrain.contingencyOk) {
                toast.error(genBrain.contingencyMessages[0] || 'Contingencia no viable');
                setAutoV2Generating(false);
                setAutoV2Progress(null);
                return;
            }

            // Si el mes anterior fue generado en esta sesión (no publicado), usar sus slots para continuar el ciclo.
            const prevMonthGenKey = lastGenOpeningRef.current;
            const isPrevMonthGen = prevMonthGenKey !== null
                && prevMonthGenKey.objectiveId === selectedObjective
                && prevMonthGenKey.year === prevMonthEndDate.getFullYear()
                && prevMonthGenKey.month === prevMonthEndDate.getMonth();

            const baseGenCtx = {
                positions: positionStructure,
                employees: planningDotacionEmployees
                    .filter((e:any) => !selectedObjective || e.preferredObjectiveId === selectedObjective)
                    .map((e:any) => ({
                        id: e.id,
                        nombre: e.nombre || e.name,
                        lat: typeof e.lat === 'number' ? e.lat : null,
                        lng: typeof e.lng === 'number' ? e.lng : null,
                        preferredObjectiveId: e.preferredObjectiveId,
                    })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                autoCycles: cyclesForGen,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                defaultPositionByEmp,
                defaultShiftByEmp,
                getDayLetter,
                getDateKey,
                rotateShifts: genBrain.rotateShifts,
                codeHoursHint: slaCodeHoursHint,
                ajustarCrono: genBrain.ajustarCrono,
                modo12Days: genBrain.modo12DaysEngine,
                contingencyApretarDays: genBrain.contingencyOk ? genBrain.contingencyDaysManual : [],
                apretarCronoDays: genBrain.modo12DaysEngine,
                prevMonthTrailingWorkDays,
                prevMonthTrailingRestDays,
                prevMonthLastShiftByEmp,
                prevMonthLastWorkBandBeforeRest,
                prevMonthOpeningSlotByEmp: isPrevMonthGen ? prevMonthGenKey!.openingSlotByEmp : undefined,
                prevMonthDaysCount: isPrevMonthGen ? prevMonthGenKey!.daysCount : undefined,
                globalRetPool,
                strictSixTwo: genBrain.strictSixTwo,
                noFlexSchemeEmployees: true,
                authorizedOver200Ids: authorizedOver200IdsRef.current.size > 0 ? authorizedOver200IdsRef.current : undefined,
                cctMaxBillableHours: planningRules.cctMaxBillableHours,
                targetAvgHoursPerEmployee: planningRules.targetAvgHoursPerEmployee,
            };
            const can6x1 = useSixPlusOne && canUseSixPlusOne(baseGenCtx);
            const canFloater = !can6x1 && canUseFixedBandFloater(baseGenCtx);
            await bumpAutoV2Progress(40, can6x1
                ? `Generando cronograma (motor v${PLANNING_ENGINE_VERSION} · ciclo 6+1)…`
                : canFloater
                    ? `Generando cronograma (motor v${PLANNING_ENGINE_VERSION} · ciclo 24d)…`
                    : `Generando cronograma (motor v${PLANNING_ENGINE_VERSION} · V4)…`);
            await new Promise<void>((r) => setTimeout(r, 0));
            const useStrictPipeline = genBrain.strictSixTwo === true;
            const strictPipeline = can6x1
                ? (() => { try { return runSixPlusOnePipeline(baseGenCtx); } catch (e) { return null; } })()
                : canFloater
                    ? (() => { try { return runStrictSixTwoPipeline({ ...baseGenCtx, rotateShifts: false, demandDriven: false }); } catch (e) { return null; } })()
                    : null;
            const useFloaterPipeline = !!strictPipeline;
            const gen = strictPipeline?.generation ?? generateScheduleV4({
                ...baseGenCtx,
                ...(useStrictPipeline ? { rotateShifts: false, demandDriven: false } : {}),
            });

            // Guardar slots de apertura para que el siguiente mes pueda continuar el ciclo exactamente.
            if (gen.stats.openingSlotByEmp) {
                lastGenOpeningRef.current = {
                    year: currentDate.getFullYear(),
                    month: currentDate.getMonth(),
                    objectiveId: selectedObjective,
                    openingSlotByEmp: gen.stats.openingSlotByEmp,
                    daysCount: daysInMonth.length,
                };
            }
            // Diagnóstico de racha: trailing mes anterior + apertura mes generado por colaborador.
            {
                const _db = (s: number) => { const n=((s%24)+24)%24; if(n<=5)return'M'; if(n<=7)return'F'; if(n<=13)return'T'; if(n<=15)return'F'; if(n<=21)return'N'; return'F'; };
                const _dtf = (s: number) => { for(let d=0;d<24;d++){if(_db(s+d)==='F')return d;} return 0; };
                setAutoV2TrailDiag(displayedEmployees.map((emp: any) => {
                    const slot = gen.stats.openingSlotByEmp?.[emp.id];
                    const posName = defaultPositionByEmp[emp.id] ?? '—';
                    const posData = (positionStructure as any[]).find((p: any) => p.positionName === posName);
                    return {
                        id: emp.id,
                        nombre: (emp.nombre || emp.name || '').slice(0, 24),
                        puesto: posName,
                        puestoQty: Math.max(1, Number(posData?.qty) || 1),
                        lastBand: prevMonthLastShiftByEmp[emp.id] ?? '—',
                        trailWork: prevMonthTrailingWorkDays[emp.id] ?? 0,
                        trailRest: prevMonthTrailingRestDays[emp.id] ?? 0,
                        julioSlot: slot,
                        julioBand: slot !== undefined ? _db(slot) : undefined,
                        diasFranco: slot !== undefined ? _dtf(slot) : undefined,
                    };
                }));
            }

            // Análisis de cobertura de ausencias pre-declaradas (V/L/E/A/PG)
            // Siempre se analiza cuando el pipeline floater está disponible (para detectar francos
            // naturales incluidos en licencias y candidatos FT). La asignación solo modifica
            // el schedule si autoCoverAbsences está activo.
            let finalGenAssignments = gen.assignments;
            if (useFloaterPipeline && gen.stats.openingSlotByEmp) {
                await bumpAutoV2Progress(50, 'Analizando cobertura de ausencias…');
                const covResult = applyAbsenceCoverage(
                    gen.assignments,
                    baseGenCtx,
                    gen.stats.openingSlotByEmp,
                );

                // Enriquecer gaps con nombres (los ftCandidates ya vienen del motor)
                const empNameMap: Record<string, string> = {};
                planningDotacionEmployees.forEach((e: any) => { empNameMap[e.id] = e.nombre || e.name || e.id; });

                const enrichedGaps = covResult.gaps.map(g => ({
                    ...g,
                    absentName: empNameMap[g.absentEmpId] || g.absentEmpId,
                    coveredByName: g.coveredBy ? (empNameMap[g.coveredBy] || g.coveredBy) : undefined,
                    ftCandidates: g.ftCandidates?.map(c => ({
                        ...c,
                        nombre: empNameMap[c.empId] || c.empId,
                    })),
                }));

                setAutoCoverageGaps(enrichedGaps);

                if (autoCoverAbsences) {
                    finalGenAssignments = covResult.assignments;
                    if (covResult.gaps.length > 0) {
                        const stCount  = covResult.gaps.filter(g => g.coverageType === 'sin_turno').length;
                        const retCount = covResult.gaps.filter(g => g.coverageType === 'ret').length;
                        const escCount = covResult.gaps.filter(g => g.coverageType === 'esc').length;
                        const msgs: string[] = [];
                        if (stCount > 0)  msgs.push(`${stCount} ST`);
                        if (retCount > 0) msgs.push(`${retCount} RET`);
                        if (escCount > 0) msgs.push(`${escCount} ESC`);
                        if (covResult.ftRequiredCount > 0) msgs.push(`${covResult.ftRequiredCount} requieren FT manual`);
                        if (msgs.length > 0) toast.success(`Cobertura automática: ${msgs.join(' · ')}`, { duration: 6000 });
                    }
                }
            } else {
                setAutoCoverageGaps([]);
            }

            await bumpAutoV2Progress(58, 'Verificando cobertura…');
            // Volcamos a pendingChanges tras verificar; si SLA abierto = vista previa diagnóstica.
            const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
            let written = 0;
            let skipped = 0;
            for (const a of finalGenAssignments) {
                const key = `${a.empId}_${a.dateStr}`;
                // No se bloquean días pasados en auto-generación: el borrador planifica el mes completo.
                // isDateLocked aplica solo a edición manual, no al motor automático.
                if (!autoOverwrite && (pendingChanges[key] || shiftsMap[key])) { skipped++; continue; }
                newChanges[key] = {
                    isTemp: true,
                    employeeId: a.empId,
                    objectiveId: selectedObjective,
                    positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                    code: a.code,
                    name: a.name,
                    hours: a.hours,
                    startTime: a.startTime,
                    ...(a.endTime ? { endTime: a.endTime } : {}),
                    ...(a.isFranco ? { isFranco: true } : {}),
                };
                written++;
            }

            // Si hay slots que solo podrían cubrirse superando las 200h → guardar para panel de autorización
            if (gen.capOverflowSlots.length > 0) {
                const overSlots = gen.capOverflowSlots;
                const seenIds = new Set<string>();
                const overEmps: { empId: string; nombre: string }[] = [];
                for (const s of overSlots) {
                    if (seenIds.has(s.empId)) continue;
                    seenIds.add(s.empId);
                    const emp = displayedEmployees.find((e: any) => e.id === s.empId);
                    overEmps.push({ empId: s.empId, nombre: emp?.nombre || emp?.name || s.empId });
                }
                setCapOverflowEmps(overEmps);
                // Pre-marcar todos como chequeados
                const checked: Record<string, boolean> = {};
                overEmps.forEach(e => { checked[e.empId] = true; });
                setOver200AuthChecked(checked);
                setOver200AuthPin('');
                setOver200AuthError('');
            }
            // Guardamos las stats post-generación para el panel "Capacidad CCT" (tras verify si pipeline ciclo)
            await bumpAutoV2Progress(78, 'Verificando cobertura y reglas (descansos, licencias)…');
            // ── Verificación de cobertura (slots, descansos, licencias, >200h) ──
            const verifyCtx = {
                positions: positionStructure,
                employees: planningDotacionEmployees.map((e:any) => ({ id: e.id, nombre: e.nombre || e.name })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                autoCycles: cyclesForGen,
                getDayLetter,
                getDateKey,
                prevMonthTrailingWorkDays,
                prevMonthTrailingRestDays,
                prevMonthLastShiftByEmp,
                cctMaxBillableHours: planningRules.cctMaxBillableHours,
                targetAvgHoursPerEmployee: planningRules.targetAvgHoursPerEmployee,
            } as any;
            let finalAssignments = gen.assignments;
            let coverage = strictPipeline?.verification
                ?? verifyScheduleCoverage(verifyCtx, finalAssignments, gen.stats);

            setAutoV2GenStats({
                employeeMonthlyHours: gen.stats.employeeMonthlyHours,
                employeeCycleHours: gen.stats.employeeCycleHours,
                targetHours: gen.stats.targetHours,
                totalBillableHours: useFloaterPipeline
                    ? (coverage.hours?.billableHoursGenerated ?? gen.stats.totalBillableHours)
                    : gen.stats.totalBillableHours,
                uncoveredSlots: useFloaterPipeline
                    ? coverage.coverage.uncoveredSlots
                    : (gen.stats.uncoveredSlots ?? 0),
                idleEmployeeIds: gen.stats.idleEmployeeIds,
                strandedEmployeeIds: gen.stats.strandedEmployeeIds,
                relocatedEmployeeIds: gen.stats.relocatedEmployeeIds,
                primaryShiftByEmp: gen.stats.primaryShiftByEmp,
                positionGroups: gen.stats.positionGroups,
                employeeRetCount: gen.stats.employeeRetCount,
                employeeRetHoursPotential: gen.stats.employeeRetHoursPotential,
                totalRetCount: gen.stats.totalRetCount,
                totalRetHoursPotential: gen.stats.totalRetHoursPotential,
                overCoverageRetDays: gen.stats.overCoverageRetDays,
                maxRetConcurrent: gen.stats.maxRetConcurrent,
                ajustarCrono: gen.stats.ajustarCrono,
                apretarCronoDays: gen.stats.apretarCronoDays,
                uncoveredSlotsByDay: gen.stats.uncoveredSlotsByDay,
                excessPositionEmployees: gen.stats.excessPositionEmployees,
                slaDeficitRemaining: useFloaterPipeline
                    ? Math.max(0, Math.round((slaVendidas - (coverage.hours?.billableHoursGenerated ?? 0)) * 10) / 10)
                    : gen.stats.slaDeficitRemaining,
                slaHoursClosed: useFloaterPipeline
                    ? coverage.coverage.uncoveredSlots <= 0
                        && (slaVendidas <= 0 || (coverage.hours?.billableHoursGenerated ?? 0) >= slaVendidas - 0.5)
                    : gen.stats.slaHoursClosed,
            });

            // ── Auto-reproceso: solo en flujo legacy (demanda + parches). Etapa A+B: verify puro. ──
            const NON_BILLABLE_FIX = new Set(['RET', 'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'PG', 'AA']);
            const countIssues = (r: typeof coverage) =>
                r.coverage.uncoveredSlots + r.restViolations.length + r.licenseConflicts.length;

            let prevIssues = countIssues(coverage);
            const MAX_REPRO_PASSES = !useFloaterPipeline && coverage.coverage.uncoveredSlots > 0 ? 5 : 0;
            for (let pass = 0; pass < MAX_REPRO_PASSES && prevIssues > 0; pass++) {
                await bumpAutoV2Progress(
                    Math.min(97, 88 + pass * 2),
                    `Reprocesando (${pass + 1}/${MAX_REPRO_PASSES})…`,
                );
                await new Promise<void>((r) => setTimeout(r, 0));

                const fixResult = fixScheduleIssues(verifyCtx, finalAssignments, gen.stats, coverage, 5);
                finalAssignments = fixResult.assignments;
                coverage = fixResult.report;

                for (const a of fixResult.assignments) {
                    const key = `${a.empId}_${a.dateStr}`;
                    const existing = newChanges[key];
                    if (existing && !existing.isDeleted
                        && !NON_BILLABLE_FIX.has(String(existing.code || '').toUpperCase())
                        && NON_BILLABLE_FIX.has(String(a.code || '').toUpperCase())) continue;
                    newChanges[key] = {
                        isTemp: true,
                        employeeId: a.empId,
                        objectiveId: selectedObjective,
                        positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                        code: a.code,
                        name: a.name,
                        hours: a.hours,
                        startTime: a.startTime,
                        ...(a.endTime ? { endTime: a.endTime } : {}),
                        ...(a.isFranco ? { isFranco: true } : {}),
                        ...(a.isReten ? { isReten: true } : {}),
                    };
                }
                // No volcar a grilla hasta confirmar SLA cerrado (ver más abajo).

                const newIssues = countIssues(coverage);
                if (newIssues >= prevIssues) break; // sin progreso: detener
                prevIssues = newIssues;
            }

            setAutoV2Coverage(coverage);
            setAutoV2Suggestions(buildScheduleOptimizationSuggestions(verifyCtx, finalAssignments, gen.stats));
            setAutoV2LastRun({ assignments: finalAssignments, stats: gen.stats, ctx: verifyCtx });

            let finalChanges = newChanges;
            if (!useFloaterPipeline) {
                const geminiOut = await runAutoV2PlanningAgentGemini(
                    finalAssignments,
                    coverage,
                    verifyCtx,
                    gen.stats,
                    newChanges,
                    false,
                    true,
                );
                finalAssignments = geminiOut.assignments;
                coverage = geminiOut.coverage;
                finalChanges = { ...geminiOut.changes };
            }

            let formReport = verifyScheduleForm(verifyCtx, finalAssignments, gen.stats, {
                strictSixTwo: genBrain.strictSixTwo,
                rotateShifts: genBrain.rotateShifts,
            });
            setAutoV2RebalanceLog([]);

            const verifiedBillable = coverage.hours?.billableHoursGenerated ?? gen.stats.totalBillableHours;
            const verifiedUncovered = coverage.coverage.uncoveredSlots;
            const hrsDeficit = slaVendidas > 0
                ? Math.max(0, Math.round((slaVendidas - verifiedBillable) * 10) / 10)
                : 0;
            const slaClosed = slaVendidas <= 0 || (hrsDeficit <= 0.5 && verifiedUncovered <= 0);

            let statsAfterForm = gen.stats;
            const hourFormIssues = formReport.metrics.hoursSpread > 24
                || formReport.metrics.over192Count > 0
                || formReport.metrics.over200Count > 0
                || formReport.metrics.under168Count > 0;
            if (!useFloaterPipeline && slaClosed && hourFormIssues) {
                await bumpAutoV2Progress(94, 'Rebalanceando forma (swaps horas)…');
                await new Promise<void>((r) => setTimeout(r, 0));
                const reb = rebalanceScheduleForm(verifyCtx, finalAssignments, statsAfterForm, coverage, {
                    strictSixTwo: genBrain.strictSixTwo,
                    rotateShifts: genBrain.rotateShifts,
                });
                if (reb.improved && reb.swapsApplied > 0) {
                    finalAssignments = reb.assignments;
                    coverage = reb.coverageReport;
                    formReport = reb.formReport;
                    statsAfterForm = reb.stats;
                    setAutoV2RebalanceLog(reb.log);
                    const touched = new Set<string>();
                    for (const entry of reb.log) {
                        touched.add(`${entry.fromEmpId}__${entry.dateStr}`);
                        touched.add(`${entry.toEmpId}__${entry.dateStr}`);
                    }
                    for (const touchKey of touched) {
                        const sep = touchKey.indexOf('__');
                        const empId = touchKey.slice(0, sep);
                        const dateStr = touchKey.slice(sep + 2);
                        const a = finalAssignments.find(x => x.empId === empId && x.dateStr === dateStr);
                        if (!a) continue;
                        finalChanges[`${empId}_${dateStr}`] = {
                            isTemp: true,
                            employeeId: empId,
                            objectiveId: selectedObjective,
                            positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                            code: a.code,
                            name: a.name,
                            hours: a.hours,
                            startTime: a.startTime,
                            ...(a.endTime ? { endTime: a.endTime } : {}),
                            ...(a.isFranco ? { isFranco: true } : {}),
                            ...(a.isReten ? { isReten: true } : {}),
                        };
                    }
                    setAutoV2GenStats((prev) => prev ? {
                        ...prev,
                        employeeMonthlyHours: reb.stats.employeeMonthlyHours,
                    } : prev);
                }
            }
            setAutoV2FormReport(formReport);

            const verifiedBillableFinal = coverage.hours?.billableHoursGenerated ?? statsAfterForm.totalBillableHours;
            const verifiedUncoveredFinal = coverage.coverage.uncoveredSlots;

            let gridBillableHours = 0;
            displayedEmployees.forEach((emp: any) => {
                daysInMonth.forEach((day) => {
                    const key = `${emp.id}_${getDateKey(day)}`;
                    const pending = finalChanges[key];
                    const existing = shiftsMap[key];
                    const activeShift = pending && !pending.isDeleted ? pending : existing;
                    if (!activeShift || activeShift.isDeleted) return;
                    if (pending && !pending.isDeleted) {
                        if (selectedObjective && activeShift.objectiveId != null && activeShift.objectiveId !== ''
                            && String(activeShift.objectiveId) !== String(selectedObjective)) return;
                    } else if (!turnoCuentaParaCronoPlanificado(activeShift, selectedObjective)) return;
                    if (OBJECTIVE_NON_BILLABLE_CODES.has(String(activeShift.code || '').toUpperCase())) return;
                    gridBillableHours += calcShiftHours(activeShift, slaCodeHoursHint);
                });
            });

            setAutoV2GenStats((prev) => prev ? {
                ...prev,
                totalBillableHours: verifiedBillableFinal,
                gridBillableHours,
                cellsSkippedOverwrite: skipped,
                uncoveredSlots: verifiedUncoveredFinal,
                slaDeficitRemaining: hrsDeficit,
                slaHoursClosed: slaClosed,
            } : prev);
            setAutoV2Coverage(coverage);
            setAutoV2Suggestions(buildScheduleOptimizationSuggestions(verifyCtx, finalAssignments, statsAfterForm));
            setAutoV2LastRun({ assignments: finalAssignments, stats: statsAfterForm, ctx: verifyCtx });

            // Vista previa en grilla siempre (aunque el SLA quede abierto) para poder diagnosticar.
            setPendingChanges(finalChanges);
            setAutoGeneratedReady(true);

            await bumpAutoV2Progress(100, slaClosed ? 'Listo' : 'SLA sin cerrar — vista previa');
            await new Promise<void>((r) => setTimeout(r, 180));

            const gridGap = Math.abs(verifiedBillableFinal - gridBillableHours);

            if (!slaClosed) {
                const parts: string[] = [];
                if (hrsDeficit > 0.5) parts.push(`${Math.round(hrsDeficit)}h faltantes`);
                if (verifiedUncovered > 0) parts.push(`${verifiedUncovered} slots sin cubrir`);
                toast.warning(
                    `Vista previa en grilla: SLA abierto (${parts.join(' · ')}). Revisá la grilla detrás del modal; no publiques hasta cerrar.`,
                    { duration: 12000 },
                );
                setAutoWizardStep('sla_open');
                return;
            }

            if (written === 0 && skipped > 0) {
                toast.error(
                    `No se generó nada: las ${skipped} celdas calculadas ya estaban ocupadas. ` +
                    `Activá "Sobreescribir" en Personalizar y ejecutá de nuevo.`,
                    { duration: 8000 }
                );
            } else if (written === 0) {
                toast.error('No se generó el cronograma. Revisá ciclos, ausencias y dotación.', { duration: 6000 });
            } else if (!autoOverwrite && skipped > 0) {
                toast.warning(
                    `Solo se volcaron ${written} celdas; ${skipped} quedaron con datos viejos. ` +
                    `La grilla muestra ~${Math.round(gridBillableHours)}h, no ${Math.round(verifiedBillableFinal)}h. Activá Sobreescribir.`,
                    { duration: 10000 },
                );
                setAutoWizardStep('done');
            } else if (gridGap > 16) {
                toast.warning(
                    `El cronograma calculó ${Math.round(verifiedBillableFinal)}h pero la grilla refleja ~${Math.round(gridBillableHours)}h. Revisá celdas mezcladas o guardá tras corregir.`,
                    { duration: 9000 },
                );
                setAutoWizardStep('done');
            } else if (slaVendidas > 0 && hrsDeficit <= 0.5 && verifiedUncoveredFinal <= 0) {
                toast.success(`Cronograma cerrado: ${Math.round(verifiedBillableFinal)}h = ${slaVendidas}h vendidas.`, { duration: 5000 });
                setAutoWizardStep('done');
            } else {
                setAutoWizardStep('done');
            }
        } catch (e:any) {
            toast.error('Error al generar el cronograma automático');
            console.error('[applyAutoScheduleCOSP]', e);
        } finally {
            setAutoV2Generating(false);
            setAutoV2Progress(null);
        }
    };

    /**
     * Reprocesa los errores del reporte de cobertura: swap de descansos rotos
     * contra RETs disponibles, llena slots vacantes con RETs del grupo,
     * resuelve conflictos con licencias. No vuelve a correr el motor entero —
     * sólo opera sobre las celdas que ya generó.
     */
    const reprocessAutoIssues = async () => {
        if (!autoV2LastRun || !autoV2Coverage) {
            toast.error('No hay una generación reciente para reprocesar.');
            return;
        }
        setAutoV2Fixing(true);
        try {
            const result = fixScheduleIssues(
                autoV2LastRun.ctx,
                autoV2LastRun.assignments,
                autoV2LastRun.stats,
                autoV2Coverage,
                5,
            );

            // Volcamos las nuevas asignaciones a pendingChanges
            const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
            const NON_BILLABLE = new Set(['RET', 'F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'PG', 'AA']);
            let written = 0;
            for (const a of result.assignments) {
                const key = `${a.empId}_${a.dateStr}`;
                // No pisar un turno facturable autorizado (ej. overflow 200h) con un RET/F del fixer.
                const existing = pendingChanges[key];
                if (existing && !existing.isDeleted && !NON_BILLABLE.has(String(existing.code || '').toUpperCase())
                    && NON_BILLABLE.has(String(a.code || '').toUpperCase())) continue;
                newChanges[key] = {
                    isTemp: true,
                    employeeId: a.empId,
                    objectiveId: selectedObjective,
                    positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                    code: a.code,
                    name: a.name,
                    hours: a.hours,
                    startTime: a.startTime,
                    ...(a.endTime ? { endTime: a.endTime } : {}),
                    ...(a.isFranco ? { isFranco: true } : {}),
                    ...(a.isReten ? { isReten: true } : {}),
                };
                written++;
            }
            setPendingChanges(newChanges);
            setAutoV2Coverage(result.report);
            setAutoV2Suggestions(
                buildScheduleOptimizationSuggestions(autoV2LastRun.ctx, result.assignments, autoV2LastRun.stats),
            );
            setAutoV2LastRun({ ...autoV2LastRun, assignments: result.assignments });
            setAutoV2FormReport(verifyScheduleForm(
                autoV2LastRun.ctx,
                result.assignments,
                autoV2LastRun.stats,
                {
                    strictSixTwo: autoPlanningBrainRef.current?.strictSixTwo,
                    rotateShifts: autoPlanningBrainRef.current?.rotateShifts,
                },
            ));

            const s = result.summary;
            const baseMsg = `Reproceso en ${result.iterations} iteración(es). Descansos: -${s.restViolationsFixed}, licencias: -${s.licenseConflictsFixed}, slots: -${s.uncoveredFixed}.`;
            if (result.converged) {
                toast.success(`✓ Cobertura OK. ${baseMsg}`, { duration: 7000 });
            } else if (s.restViolationsFixed + s.licenseConflictsFixed + s.uncoveredFixed === 0) {
                toast.warning(
                    `Sin progreso: ${result.report.restViolations.length} descansos, ${result.report.licenseConflicts.length} licencias y ${s.uncoveredRemaining} slots siguen sin resolverse. Revisalos a mano.`,
                    { duration: 8000 },
                );
            } else {
                toast.warning(
                    `${baseMsg} Quedan ${result.report.restViolations.length} descansos, ${result.report.licenseConflicts.length} licencias y ${s.uncoveredRemaining} slots.`,
                    { duration: 8000 },
                );
            }
            console.info('[reprocessAutoIssues] log:', result.log);
            void written;
        } catch (e: any) {
            console.error('[reprocessAutoIssues]', e);
            toast.error('Error al reprocesar los errores.');
        } finally {
            setAutoV2Fixing(false);
        }
    };

    /**
     * Actualiza las métricas de cobertura/SLA cuando se asignan N slots manualmente.
     * extraHours: horas billables adicionales generadas (ej: extensiones D12 = d12Count×4h,
     *             cobertura externa = gaps×8h). Suma a totalBillableHours para cerrar el SLA.
     */
    const applyCoverageToStats = (coveredCount: number, extraHours = 0) => {
        setAutoV2Coverage(prev => {
            if (!prev) return prev;
            const newUncovered = Math.max(0, prev.coverage.uncoveredSlots - coveredCount);
            const newCovered = prev.coverage.coveredSlots + coveredCount;
            return {
                ...prev,
                coverage: {
                    ...prev.coverage,
                    uncoveredSlots: newUncovered,
                    coveredSlots: newCovered,
                    coverageRatio: prev.coverage.totalSlots > 0 ? newCovered / prev.coverage.totalSlots : 1,
                },
                ok: newUncovered === 0 && !prev.restViolations?.length && !prev.licenseConflicts?.length,
            };
        });
        setAutoV2GenStats(prev => {
            if (!prev) return prev;
            const newUncovered = Math.max(0, (prev.uncoveredSlots ?? 0) - coveredCount);
            const newBillable = prev.totalBillableHours + extraHours;
            const slaClosed = newUncovered === 0
                && (slaVendidas <= 0 || newBillable >= slaVendidas - 0.5);
            return { ...prev, uncoveredSlots: newUncovered, totalBillableHours: newBillable, slaHoursClosed: slaClosed };
        });
    };

    /** Rebalanceo manual de forma: swaps trabajo↔F/RET entre guardias (sin F→turno unilateral). */
    const rebalanceAutoForm = async () => {
        if (!autoV2LastRun || !autoV2Coverage || !selectedObjective) {
            toast.error('No hay una generación reciente para rebalancear.');
            return;
        }
        if (autoV2Coverage.coverage.uncoveredSlots > 0) {
            toast.error('Cerrá la cobertura antes de rebalancear forma.');
            return;
        }
        setAutoV2Rebalancing(true);
        try {
            const reb = rebalanceScheduleForm(
                autoV2LastRun.ctx,
                autoV2LastRun.assignments,
                autoV2LastRun.stats,
                autoV2Coverage,
                {
                    strictSixTwo: autoPlanningBrainRef.current?.strictSixTwo,
                    rotateShifts: autoPlanningBrainRef.current?.rotateShifts,
                },
            );
            if (!reb.improved || reb.swapsApplied === 0) {
                toast.info('No se encontraron swaps que mejoren el balance horario sin romper cobertura.');
                return;
            }

            const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
            const touched = new Set<string>();
            for (const entry of reb.log) {
                touched.add(`${entry.fromEmpId}__${entry.dateStr}`);
                touched.add(`${entry.toEmpId}__${entry.dateStr}`);
            }
            for (const touchKey of touched) {
                const sep = touchKey.indexOf('__');
                const empId = touchKey.slice(0, sep);
                const dateStr = touchKey.slice(sep + 2);
                const a = reb.assignments.find(x => x.empId === empId && x.dateStr === dateStr);
                if (!a) continue;
                newChanges[`${empId}_${dateStr}`] = {
                    isTemp: true,
                    employeeId: empId,
                    objectiveId: selectedObjective,
                    positionName: a.positionName || (positionStructure[0]?.positionName ?? 'General'),
                    code: a.code,
                    name: a.name,
                    hours: a.hours,
                    startTime: a.startTime,
                    ...(a.endTime ? { endTime: a.endTime } : {}),
                    ...(a.isFranco ? { isFranco: true } : {}),
                    ...(a.isReten ? { isReten: true } : {}),
                };
            }

            setPendingChanges(newChanges);
            setAutoV2Coverage(reb.coverageReport);
            setAutoV2FormReport(reb.formReport);
            setAutoV2RebalanceLog(reb.log);
            setAutoV2LastRun({ ...autoV2LastRun, assignments: reb.assignments, stats: reb.stats });
            setAutoV2Suggestions(buildScheduleOptimizationSuggestions(autoV2LastRun.ctx, reb.assignments, reb.stats));
            setAutoV2GenStats((prev) => prev ? {
                ...prev,
                employeeMonthlyHours: reb.stats.employeeMonthlyHours,
            } : prev);

            toast.success(
                `Rebalanceo: ${reb.swapsApplied} swap(s). Δ ${reb.formReport.metrics.hoursSpread}h · prom ${reb.formReport.metrics.avgBillableHours}h`,
                { duration: 7000 },
            );
            console.info('[rebalanceAutoForm] log:', reb.log);
        } catch (e: any) {
            console.error('[rebalanceAutoForm]', e);
            toast.error('Error al rebalancear forma.');
        } finally {
            setAutoV2Rebalancing(false);
        }
    };

    /** Debug: trae el doc de servicios_sla vigente para el mes en pantalla y lo muestra crudo. */
    const fetchSlaDebug = async () => {
        if (!selectedClient || !selectedObjective) { toast.error('Seleccioná cliente y objetivo'); return; }
        setSlaDebugLoading(true);
        try {
            const snap = await getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa));
            const allDocs = filterSlasForPlanningTenant(
                snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
                empresaId,
                scopeEmpresa,
                tenantClientIds,
            );
            const matching = filterSlasForPlanningContext(
                allDocs,
                selectedClient,
                selectedObjective,
                clients,
                slaIdToObjId,
            );
            const y = currentDate.getFullYear(), m = currentDate.getMonth();
            const { vigente, fallback } = pickSlaForPlanningMonth(matching, y, m);
            const srv = vigente ?? fallback;
            if (!srv) { toast.error('No se encontró ningún servicios_sla para este objetivo'); return; }
            const { id, ...rest } = srv;
            setSlaDebug({ id, data: rest });
        } catch (e:any) {
            toast.error('Error trayendo SLA');
            console.error('[slaDebug]', e);
        } finally {
            setSlaDebugLoading(false);
        }
    };


    const applyColumnCopy = () => {
        if (columnSelectSource === null || !selection.start || !selection.end) return;
        const startCol = Math.min(selection.start.c, selection.end.c);
        const endCol   = Math.max(selection.start.c, selection.end.c);
        const srcDate  = getDateKey(daysInMonth[columnSelectSource]);
        const newChanges = { ...pendingChanges };
        let copied = 0;
        displayedEmployees.forEach((emp: any) => {
            const srcKey = `${emp.id}_${srcDate}`;
            const srcShift = pendingChanges[srcKey] ? (pendingChanges[srcKey].isDeleted ? null : pendingChanges[srcKey]) : shiftsMap[srcKey];
            for (let c = startCol; c <= endCol; c++) {
                if (c === columnSelectSource) continue;
                const tgtDate = getDateKey(daysInMonth[c]);
                if (isDateLocked(tgtDate)) continue;
                const tgtKey = `${emp.id}_${tgtDate}`;
                if (!srcShift) {
                    if (pendingChanges[tgtKey] || shiftsMap[tgtKey]) newChanges[tgtKey] = { isDeleted: true };
                } else {
                    newChanges[tgtKey] = { ...srcShift, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective };
                    copied++;
                }
            }
        });
        setPendingChanges(newChanges);
        setSelection({ start: null, end: null });
        setColumnSelectMode(false);
        setColumnSelectSource(null);
        setIsDragging(false);
        toast.success(`Día copiado a ${endCol - startCol} día(s) — ${copied} turnos`);
    };

    // 🛑 V8.20: RENDERIZADO DUAL (SPLIT SCREEN) - RESTAURADO
    const calculatePlannedHoursForDate = (dateStr: string) => {
        let total = 0;
        const isWorkingCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        displayedEmployees.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const pending = pendingChanges[key];
            const existing = shiftsMap[key];
            const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
            if (!activeShift) return;
            const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
            if (!shiftObjective || shiftObjective !== selectedObjective) return;
            if (!isWorkingCode(activeShift.code)) return;
            total += calcShiftHours(activeShift);
        });
        return total;
    };

    const monthPlannedHours = useMemo(
        () => daysInMonth.reduce((acc, day) => acc + calculatePlannedHoursForDate(getDateKey(day)), 0),
        [daysInMonth, displayedEmployees, pendingChanges, shiftsMap, selectedObjective]
    );

    const avgHoursPerEmployee = useMemo(() => {
        const isWorkingCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        const empWithHours = new Set<string>();
        let nativePlannedHours = 0;
        daysInMonth.forEach((day) => {
            const dateStr = getDateKey(day);
            displayedEmployees.forEach((emp: any) => {
                if (!isEmployeeNativeToObjective(emp)) return;
                const key = `${emp.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                if (!activeShift) return;
                const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
                if (!shiftObjective || shiftObjective !== selectedObjective) return;
                if (!isWorkingCode(activeShift.code)) return;
                const h = calcShiftHours(activeShift);
                if (h > 0) {
                    empWithHours.add(emp.id);
                    nativePlannedHours += h;
                }
            });
        });
        const count = empWithHours.size;
        if (!count || !nativePlannedHours) return 0;
        return Math.round(nativePlannedHours / count);
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, isEmployeeNativeToObjective]);

    const monthPlannedHoursByPosition = useMemo(() => {
        const map: Record<string, number> = {};
        const isWorkingCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        daysInMonth.forEach((day) => {
            const dateStr = getDateKey(day);
            displayedEmployees.forEach((emp: any) => {
                const key = `${emp.id}_${dateStr}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                if (!activeShift) return;
                const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
                if (!shiftObjective || shiftObjective !== selectedObjective) return;
                if (!isWorkingCode(activeShift.code)) return;
                const pos = (activeShift.positionName || activePosition || dominantPosition?.positionName || 'General').toString();
                map[pos] = (map[pos] || 0) + calcShiftHours(activeShift);
            });
        });
        return map;
    }, [daysInMonth, displayedEmployees, pendingChanges, shiftsMap, selectedObjective, activePosition, dominantPosition]);

    const excludedPositionsByDate = useMemo(() => {
        const raw = buildExcludedPositionsByDate(positionStructure);
        const filtered: Record<string, string[]> = {};
        for (const day of daysInMonth) {
            const ds = getDateKey(day);
            if (raw[ds]?.length) filtered[ds] = raw[ds];
        }
        return filtered;
    }, [positionStructure, daysInMonth]);

    const hasSlaExcludedDatesInMonth = Object.keys(excludedPositionsByDate).length > 0;

    const planningCompareDiff = useMemo(() => {
        if (!comparingSnapshot?.data || !selectedObjective) return null;
        const dateKeys = daysInMonth.map((d) => getDateKey(d));
        const employeeIds = displayedEmployees.map((e: { id: string }) => e.id);
        const currentSnap = buildPlanningSnapshotFromGrid({
            employeeIds,
            dateKeys,
            shiftsMap,
            pendingChanges,
            objectiveId: selectedObjective,
        });
        return diffPlanningSnapshots(comparingSnapshot.data, currentSnap);
    }, [comparingSnapshot, daysInMonth, displayedEmployees, shiftsMap, pendingChanges, selectedObjective]);

    const compareGridEmployees = useMemo(() => {
        if (!comparingSnapshot || !compareShowOnlyDiffs || !planningCompareDiff?.changedKeys.size) {
            return displayedEmployees;
        }
        const ids = new Set<string>();
        for (const key of planningCompareDiff.changedKeys) {
            ids.add(key.split('_')[0]!);
        }
        return displayedEmployees.filter((e: { id: string }) => ids.has(e.id));
    }, [comparingSnapshot, compareShowOnlyDiffs, planningCompareDiff, displayedEmployees]);

    const renderGrid = (
        isSnapshotView: boolean,
        snapshotData?: any,
        compareChangedKeys?: Set<string> | null,
        employeesForRows?: typeof displayedEmployees,
        gridOpts?: { hideFooter?: boolean; compactRows?: boolean; minimalHeader?: boolean; highlightCoverageFooter?: boolean },
    ) => {
        const gridEmployees = employeesForRows ?? displayedEmployees;
        const compareMinimal = !!gridOpts?.minimalHeader;
        const compareCompact = !!gridOpts?.compactRows;
        return (
        <table className="planning-grid-table border-separate border-spacing-0 w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 shadow-md">
                {compareMinimal ? (
                <tr className="h-7">
                    <th className="planning-sticky-corner bg-slate-100 p-1.5 text-left border-b border-r relative select-none z-20" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                        <span className="text-[9px] font-black uppercase text-slate-500 flex items-center gap-1">
                            {isSnapshotView ? <History size={10} className="text-amber-600"/> : <Activity size={10} className="text-indigo-600"/>}
                            {isSnapshotView ? 'Histórico' : 'Actual'}
                        </span>
                    </th>
                    {daysInMonth.map((d) => {
                        const dateStr = getDateKey(d);
                        const letter = getDayLetter(dateStr);
                        const isWeekend = [0, 6].includes(d.getDay());
                        return (
                            <th key={`cmp_${d.toISOString()}`} className={`min-w-[22px] border-b border-r p-0 text-center ${isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : ''}`}>
                                <div className={`text-[7px] font-black leading-none ${isWeekend ? 'text-rose-500' : 'text-slate-400'}`}>{letter}</div>
                                <div className={`text-[10px] font-bold leading-none ${isWeekend ? 'text-rose-600' : 'text-slate-700'}`}>{d.getDate()}</div>
                            </th>
                        );
                    })}
                </tr>
                ) : (
                <>
                <tr className="h-6">
                    <th rowSpan={2} className="planning-sticky-corner bg-slate-100 p-2 text-left border-b border-r relative select-none z-20" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                        <span className="text-[10px] font-black uppercase"><Users size={12}/> Dotación</span>
                        {selectedObjective && !isSnapshotView && (
                            <span className="block text-[8px] font-bold text-slate-400 mt-0.5" title="Total guardias en dotación activa para este objetivo (sin REF/ESC de reserva)">
                                {planningDotacionEmployees.length} c/ turno
                            </span>
                        )}
                        {selectedObjective && !isSnapshotView && staffingReq6x2 && (() => {
                            const avail = planningDotacionEmployees.length;
                            const needed = staffingReq6x2.totalNeeded;
                            const ok = avail >= needed;
                            const tooltip = staffingReq6x2.perPos
                                .map((p: any) => `${p.positionName} (×${p.qty}${p.is24h ? ' 24hs' : ''}): ${p.needed} emp`)
                                .join('\n') + `\nTotal 6+2: ${needed} · Dotación: ${avail}`;
                            return (
                                <span
                                    className={`block text-[8px] font-bold mt-0.5 ${ok ? 'text-emerald-600' : 'text-rose-600'}`}
                                    title={tooltip}
                                >
                                    {ok ? '✓' : '↑'} 6+2: {needed} nec · {avail} asig
                                </span>
                            );
                        })()}
                        {hasSlaExcludedDatesInMonth && !isSnapshotView && (
                            <span className="block text-[7px] font-bold text-rose-500 mt-1 leading-tight" title="En el número del día aparece el puesto excluido (Servicios → Días excluidos)">
                                ⊘ = sin servicio SLA
                            </span>
                        )}
                        <div
                            className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-indigo-400/60 transition-colors"
                            title="Arrastrar para cambiar el ancho"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                nameColResizing.current = { startX: e.clientX, startW: nameColWidth };
                                const onMove = (ev: MouseEvent) => {
                                    if (!nameColResizing.current) return;
                                    setNameColWidth(Math.max(120, Math.min(400, nameColResizing.current.startW + ev.clientX - nameColResizing.current.startX)));
                                };
                                const onUp = () => {
                                    nameColResizing.current = null;
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                };
                                document.addEventListener('mousemove', onMove);
                                document.addEventListener('mouseup', onUp);
                            }}
                        />
                    </th>
                    {daysInMonth.map((d) => {
                        const dateStr = getDateKey(d);
                        const letter = getDayLetter(dateStr);
                        const isWeekend = [0, 6].includes(d.getDay());
                        const excludedNames = excludedPositionsByDate[dateStr];
                        const hasExclusion = !!excludedNames?.length;
                        return (
                            <th key={`dw_${d.toISOString()}`} className={`min-w-[25px] border-b border-r p-1 text-center ${hasExclusion ? 'border-t-2 border-t-rose-400' : isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : 'dark:border-slate-700'}`}
                                title={hasExclusion ? excludedPositionsTooltip(excludedNames, dateStr) : undefined}>
                                <span className={`text-[9px] font-black ${hasExclusion ? 'text-rose-600 dark:text-rose-400' : isWeekend ? 'text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>{letter}</span>
                            </th>
                        );
                    })}
                </tr>
                <tr className={hasSlaExcludedDatesInMonth ? 'h-11' : 'h-10'}>
                    {daysInMonth.map((d, dayIndex) => {
                        const dateStr = getDateKey(d);
                        const isSource = columnSelectMode && columnSelectSource === dayIndex;
                        const isInSel = !isSnapshotView && selection.start != null && dayIndex >= Math.min(selection.start.c, selection.end?.c ?? selection.start.c) && dayIndex <= Math.max(selection.start.c, selection.end?.c ?? selection.start.c);
                        const isWeekend = [0,6].includes(d.getDay());
                        const excludedNames = excludedPositionsByDate[dateStr];
                        const hasExclusion = !!excludedNames?.length;
                        const exTitle = hasExclusion ? excludedPositionsTooltip(excludedNames, dateStr) : undefined;
                        return (
                            <th
                                key={d.toISOString()}
                                onMouseDown={() => !isSnapshotView && handleDayHeaderMouseDown(dayIndex)}
                                onMouseEnter={() => !isSnapshotView && handleDayHeaderMouseEnter(dayIndex)}
                                onMouseUp={handleDayHeaderMouseUpOrLeave}
                                onMouseLeave={handleDayHeaderMouseUpOrLeave}
                                className={`min-w-[25px] border-b-2 border-r p-0.5 text-center select-none cursor-pointer transition-colors
                                    ${isSource ? 'bg-indigo-600 text-white' : isInSel && columnSelectMode ? 'bg-indigo-100 dark:bg-indigo-900/40' : hasExclusion ? 'bg-rose-100/90 dark:bg-rose-950/40 border-b-rose-300 dark:border-rose-800' : isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-700 dark:border-slate-700 border-b-slate-200'}`}
                                title={columnSelectMode ? (isSource ? 'Clic para cancelar copia' : 'Clic para extender destino') : exTitle || 'Clic para copiar este día'}
                            >
                                <span className={`text-[10px] font-bold leading-none ${isSource ? 'text-white' : hasExclusion ? 'text-rose-800 dark:text-rose-200 font-black' : isWeekend ? 'text-rose-600 dark:text-rose-400 font-black' : 'dark:text-slate-300'}`}>{d.getDate()}</span>
                                {hasExclusion && !isSource && (
                                    <div className="text-[6px] font-black text-rose-700 dark:text-rose-300 leading-tight mt-0.5 truncate max-w-[26px] mx-auto px-0.5" title={exTitle}>
                                        ⊘ {excludedPositionsCellLabel(excludedNames)}
                                    </div>
                                )}
                                {isSource && <div className="text-[7px] font-black opacity-80 leading-none mt-0.5">ORIG</div>}
                            </th>
                        );
                    })}
                </tr>
                </>
                )}
            </thead>
            <tbody>
                {gridEmployees.map((emp, idx) => {
                    const isGuest = selectedObjective && emp.preferredObjectiveId !== selectedObjective;
                    const homeObjectiveName = getObjectiveName(emp.preferredObjectiveId);
                    
                    return (
                        <React.Fragment key={emp.id}>
                            {/* FILA ACTUAL (Editable) - Solo se muestra si NO es vista de snapshot */}
                            {!isSnapshotView && (
                                <tr
                                    className={`group ${dragOverVisual === idx ? 'border-t-2 border-t-indigo-400' : ''} ${(empMonthlyHours[emp.id] || 0) >= planningLimits.monthly ? 'bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                                    onDragOver={forceShowAll ? undefined : (e) => handleRowDragOver(e, idx)}
                                    onDrop={forceShowAll ? undefined : (e) => handleRowDrop(e, idx)}
                                    onDragEnd={forceShowAll ? undefined : () => setDragOverVisual(null)}
                                >
                                    <td
                                        draggable={!forceShowAll}
                                        onDragStart={forceShowAll ? undefined : (e) => handleRowDragStart(e, idx)}
                                        onClick={() => !isSnapshotView && handleRowHeaderClick(idx)}
                                        title={forceShowAll ? 'Modo cercanos: ordenado por distancia' : 'Clic para seleccionar fila completa'}
                                        style={{ width: nameColWidth, minWidth: nameColWidth }}
                                        className={`sticky left-0 z-20 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 ${forceShowAll ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} dark:border-slate-700 ${(empMonthlyHours[emp.id] || 0) >= planningLimits.monthly ? 'bg-red-50 group-hover:bg-red-100 dark:bg-red-950/30 dark:group-hover:bg-red-900/30' : 'bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/60'}`}
                                    >
                                        {(() => {
                                            if (compareCompact) {
                                                return (
                                                    <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                                );
                                            }
                                            const empLat = Number(emp.lat ?? emp.latitude ?? 0);
                                            const empLng = Number(emp.lng ?? emp.longitude ?? 0);
                                            const objLat = Number(selectedObjectiveData?.lat ?? 0);
                                            const objLng = Number(selectedObjectiveData?.lng ?? 0);
                                            const distKm = (empLat && empLng && objLat && objLng) ? haversineKm(empLat, empLng, objLat, objLng) : null;
                                            const monthHours = empMonthlyHours[emp.id] || 0;
                                            const cctHours = empCctCurrentHours[emp.id] || 0;
                                            const retDays = empRetDays[emp.id] || 0;
                                            const displayHours = hoursMode === 'cct' ? cctHours : monthHours;
                                            const hoursColor = displayHours >= planningLimits.monthly ? 'text-red-600 font-black'
                                                : displayHours >= 185 ? 'text-orange-500 font-bold'
                                                : displayHours >= 160 ? 'text-amber-500'
                                                : displayHours > 0   ? 'text-slate-500 dark:text-slate-300'
                                                : retDays > 0          ? 'text-amber-800 font-bold'
                                                : 'text-slate-400 dark:text-slate-500';
                                            return (
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                                                        <Grip size={8} className="shrink-0 text-slate-200 group-hover:text-slate-400 transition-colors mr-0.5" />
                                                        <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                                        {isGuest && (<div className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[8px] font-black uppercase flex items-center gap-1 cursor-help shadow-sm" title={`Base: ${homeObjectiveName}`}><Briefcase size={8} /> EXT</div>)}
                                                        {/* Horas mensuales planificadas (facturables) + días RET sobrantes */}
                                                        <span
                                                            title={hoursMode === 'cct'
                                                                ? `${Math.round(cctHours)}h en el ciclo CCT actual (26 mes anterior → 25 de este mes). Tope 200h.\n${Math.round(monthHours)}h en el mes calendario.${retDays > 0 ? `\n${retDays} días RET (0 h planificadas; sobrante disponible en otro objetivo).` : ''}`
                                                                : `${Math.round(monthHours)}h planificadas en el mes calendario.\n${Math.round(cctHours)}h en el ciclo CCT actual (tope 200h).${retDays > 0 ? `\n${retDays} días RET (0 h planificadas; sobrante disponible en otro objetivo).` : ''}`}
                                                            className={`shrink-0 text-[8px] ${hoursColor}`}
                                                        >
                                                            {Math.round(displayHours)}h
                                                            {retDays > 0 && displayHours === 0 && <span className="ml-0.5 text-[7px] text-amber-700 font-bold" title={`${retDays} días RET (0 h planificadas)`}>+{retDays}RET</span>}
                                                            {hoursMode === 'cct' && <span className="ml-0.5 text-[7px] text-indigo-500 font-black">CCT</span>}
                                                        </span>
                                                        {/* Distancia al objetivo — solo si hay coordenadas */}
                                                        {distKm !== null ? (
                                                            <span title="Distancia al objetivo" className={`shrink-0 flex items-center gap-0.5 text-[8px] ${distKm >= 9 ? 'text-orange-500' : distKm >= 3 ? 'text-amber-400' : 'text-slate-400 dark:text-slate-400'}`}>
                                                                <MapPin size={7}/>{distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`}
                                                            </span>
                                                        ) : emp.address && !(empLat && empLng) ? (
                                                            <span title="Sin coordenadas — ir a RRHH y geolocalizar" className="shrink-0 flex items-center gap-0.5 text-[8px] text-amber-400 opacity-60 group-hover:opacity-100">
                                                                <MapPin size={7}/>?
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex gap-1 ml-1 shrink-0 items-center">
                                                        {positionStructure.length > 1 && !isServiceLocked && (
                                                            <button
                                                                draggable={false}
                                                                data-emp-pos-btn={emp.id}
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (empPosPicker?.empId === emp.id) setEmpPosPicker(null); else openEmpPosPickerAt(emp.id, e.currentTarget as HTMLElement); }}
                                                                className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-colors whitespace-nowrap ${
                                                                    isDeploymentSurplusCode(getEmpDefaultShift(emp.id))
                                                                        ? (getEmpDefaultShift(emp.id) === 'ESC' ? 'bg-sky-600 text-white' : 'bg-violet-600 text-white')
                                                                        : getEmpDefaultPos(emp.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100'
                                                                }`}
                                                                title={`Puesto: ${getEmpDefaultPos(emp.id) || 'sin asignar'} · Rol: ${getEmpDefaultShift(emp.id) || 'auto'}${isEmpExcludedFromPlanningDotacion(emp, selectedObjective) ? ' (excluido de auto/dotación)' : ''}`}
                                                            >
                                                                {(() => {
                                                                    const sc = getEmpDefaultShift(emp.id);
                                                                    if (sc === 'REF' || sc === 'ESC') return `${sc} · ${getEmpDefaultPos(emp.id) || '·'}`;
                                                                    if (sc) return sc;
                                                                    return getEmpDefaultPos(emp.id) || '···';
                                                                })()}
                                                            </button>
                                                        )}
                                                        {!isSnapshotView && selectedObjective && !isServiceLocked && (
                                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                {!isGuest && (<button onClick={(e) => { e.stopPropagation(); handleUnassignEmployee(emp); }} className="p-1 hover:bg-rose-100 text-rose-400 hover:text-rose-600 rounded transition-all" title="Desvincular"><UserMinus size={12}/></button>)}
                                                                {isGuest && (<button onClick={(e) => { e.stopPropagation(); handleTransferEmployee(emp); }} className="p-1 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600 rounded transition-all" title="Transferir a este Objetivo"><UserCheck size={12}/></button>)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </td>
                                    {daysInMonth.map((day, dayIndex) => {
                                        const key = `${emp.id}_${getDateKey(day)}`;
                                        const s = shiftsMap[key]; const p = pendingChanges[key];
                                        const rfzOnCell = rfzByEmpDate[key];
                                        const selected = !isSnapshotView && isCellSelected(idx, dayIndex);
                                        const isLockedDate = !isSnapshotView && isPlanningDateLocked(getDateKey(day));
                                        const isCellWeekend = [0, 6].includes(day.getDay());
                                        let content = null; let style = "";
                                        let isFT = s?.isFrancoTrabajado || p?.isFrancoTrabajado; let isFF = s?.isFrancoCompensatorio || p?.isFrancoCompensatorio;
                                        let isExtended = s?.isExtended || p?.isExtended; let isEarly = s?.isEarlyStart || p?.isEarlyStart; 
                                        const covRole = p?.coverageSegmentRole || s?.coverageSegmentRole;
                                        const covNote = p?.coverageNote || s?.coverageNote;
                                        let plannedNov = s?.plannedNovedad || p?.plannedNovedad; 
                                        let absence = absencesMap[key];
                                        if (absence && ((absence.inferredCode as string) || inferAbsenceCode(absence)) === 'AA' && !isPlanificacionPublished(publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)])) absence = null as any;
                                        const effectiveCode = p?.code || s?.code;
                                        const coveredByCell = p?.coveredBy || s?.coveredBy;
                                        let hasConflict = shouldShowLeaveConflictSiren({
                                            shiftCode: effectiveCode,
                                            absence,
                                            coveredBy: coveredByCell,
                                            hasNovedad: !!(s && s.hasNovedad),
                                            shiftStatus: s?.status,
                                        });
                                        let statusIndicator = null;
                                        const _planPublished = isPlanificacionPublished(publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)]);
                                        if (s && !isSnapshotView) { if (s.status === 'PRESENT' || s.status === 'COMPLETED' || s.isPresent) statusIndicator = 'bg-emerald-500'; else if (_planPublished && (s.status === 'ABSENT' || s.isAbsent)) statusIndicator = 'bg-rose-500'; }
                                        let isSwap = s?.swapWith || p?.swapWith;
                                        const swapPending = !!(
                                            isSwap &&
                                            (
                                                (s?.origin && s.origin !== 'PLANIFICADOR' && !s.swapAuthorized) ||
                                                (p?.origin && p.origin !== 'PLANIFICADOR' && !p.swapAuthorized)
                                            )
                                        );
                                        const swapStyle = swapPending ? SHIFT_STYLES['SWAP_PENDING'] : SHIFT_STYLES['SWAP'];
                                        if (isLockedDate && !p) { style = SHIFT_STYLES['PAST']; if (s) content = s.code; }
                                        else if (p) { if(p.isDeleted) { content=<X size={12}/>; style="bg-rose-50 text-rose-300"; } else { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { content=p.code; const baseStyle = SHIFT_STYLES[p.code]; style = baseStyle ? `${baseStyle} ring-2 ring-amber-400 ${isSwap ? swapStyle : ''}` : `bg-amber-100 text-amber-700 font-black ring-2 ring-amber-400 ${isSwap ? swapStyle : ''}`; if (content === 'REF' || content === 'ESC') content = cellLabelForDeployment(String(content), p.deploymentBand); } } }
                                        else if (s) { if (!isLockedDate) { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { style=`${getDefaultStyle(s.code)} ${isSwap ? swapStyle : ''}`; content=s.code; } } }
                                        else if (rfzOnCell && !p) {
                                            content = 'RFZ';
                                            style = `${SHIFT_STYLES['RFZ']}${rfzOnCell.draft ? ' ring-2 ring-amber-400' : ''}`;
                                        }
                                        const _deployBand = (p && !p.isDeleted ? p.deploymentBand : s?.deploymentBand);
                                        if (content === 'REF' || content === 'ESC') {
                                            content = cellLabelForDeployment(String(content), _deployBand);
                                        }
                                        if (isExtended) { style += ' ring-2 ring-violet-600 z-10'; }
                                        if (isEarly) { style += ' ring-2 ring-cyan-500 z-10'; }
                                        if (plannedNov === 'AVISO') { style += ' border-l-4 border-l-amber-500'; }
                                        if (plannedNov === 'LICENCIA') { style += ' border-l-4 border-l-purple-500'; }
                                        if (content === 'Ausencia con Aviso' || content === 'Injustificada') { content = 'AA'; style = SHIFT_STYLES['AA']; }
                                        if (isGuest && (s || p)) { style += ' border-t-2 border-t-amber-400'; }
                                        const activeShift = (p && !p.isDeleted) ? p : (s || (rfzOnCell ? rfzDocToShiftView(rfzOnCell) : null));
                                        // TURA: turno agregado por cliente → fondo rojo en celda padre
                                        if (activeShift?.id && turaMap[activeShift.id]) { style = 'bg-red-500 text-white border-red-600 font-black'; }
                                        const hasRfzOverlay = !!(rfzOnCell && (s || (p && !p.isDeleted)) && !absence);
                                        const isOtherObjectiveShift = isShiftAtOtherObjective(s, p, selectedObjective);
                                        if (absence) { const absCode = absence.inferredCode || inferAbsenceCode(absence); content = absCode; style = SHIFT_STYLES[absCode] || 'bg-rose-50 text-rose-700 font-bold border-rose-200'; }
                                        if (isOtherObjectiveShift && content != null) {
                                            style = String(content).toUpperCase() === 'RET'
                                                ? SHIFT_STYLES['RET']
                                                : OTHER_OBJECTIVE_CELL_STYLE;
                                        }
                                        if (compareChangedKeys?.has(key)) {
                                            style += isSnapshotView
                                                ? ' ring-2 ring-amber-600 ring-offset-1 z-20'
                                                : ' ring-2 ring-violet-600 ring-offset-1 z-20';
                                        }
                                        const cellPosName = (p && !p.isDeleted ? p.positionName : s?.positionName) || rfzOnCell?.positionName || null;
                                        const cellCode = (p && !p.isDeleted) ? (isFT ? 'FT' : isFF ? 'FF' : p.code) : s ? (isFT ? 'FT' : isFF ? 'FF' : s.code) : (rfzOnCell ? 'RFZ' : null);
                                        const _cellShift = (p && !p.isDeleted) ? p : s;
                                        const _cellActualRange = (_cellShift?.startTime && _cellShift?.endTime)
                                            ? `${formatTime(_cellShift.startTime)} - ${formatTime(_cellShift.endTime)}`
                                            : null;
                                        const cellRange = cellCode
                                            ? (_cellActualRange || SHIFT_RANGES[cellCode] || null)
                                            : null;
                                        const cellDateStr = getDateKey(day);
                                        const excludedOnDay = excludedPositionsByDate[cellDateStr];
                                        const isExclusionCol = !!excludedOnDay?.length;
                                        const cellPosExcluded = !!(cellPosName && excludedOnDay?.includes(cellPosName));
                                        const leaveCellCode = absence
                                            ? String(absence.inferredCode || inferAbsenceCode(absence) || content || '').toUpperCase()
                                            : String(cellCode || '').toUpperCase();
                                        const isLeaveCell = !!absence || LEAVE_CELL_CODES.has(leaveCellCode);
                                        const _covHint = covNote ? `\n📋 ${covNote}` : '';
                                        return <td key={key} onMouseDown={() => !isSnapshotView && handleMouseDown(idx, dayIndex)} onMouseEnter={(e) => { if (!isSnapshotView && isDragging) setSelection(pr => ({...pr, end:{r:idx, c:dayIndex}})); if (isLeaveCell) { const absType = absence?.type || activeShift?.name || LEGEND_DESCRIPTIONS[leaveCellCode] || leaveCellCode; const reason = absence?.reason || activeShift?.comments || p?.comments || ''; const covered = resolveTitularCoverageName(emp.id, emp.name || '', cellDateStr, shiftsMap, pendingChanges, (id) => employees.find((x: any) => x.id === id)?.name, coveredByCell); setShiftTooltip({ label: buildLeaveCellTooltipLabel({ absenceType: absType, reason, coveredBy: covered }), pos: null, range: null, x: e.clientX, y: e.clientY, restHours: null }); } else if ((s || p || rfzOnCell) && !absence) { const shiftLabel = cellCode ? (LEGEND_DESCRIPTIONS[cellCode] || cellCode) : (rfzOnCell ? 'Refuerzo cliente (RFZ)' : null); const _isFrancoTip = cellCode ? ['F','FF','FP','FT'].includes(String(cellCode).toUpperCase()) : false; const _restHrs = _isFrancoTip ? calcFrancoRestHours(emp.id, dayIndex) : null; const _isRet = String(cellCode || '').toUpperCase() === 'RET'; const _exclHint = cellPosExcluded ? `\n⚠ Puesto excluido por SLA este día` : ''; const _otherObjHint = isOtherObjectiveShift && activeShift?.objectiveId ? `\n📍 Otro objetivo: ${getObjectiveName(activeShift.objectiveId)}` : ''; const _rfzHint = rfzOnCell ? `\n🔴 RFZ ${formatTime(rfzOnCell.startTime)}–${formatTime(rfzOnCell.endTime)}${rfzOnCell.positionName ? ` · ${rfzOnCell.positionName}` : ''}` : ''; setShiftTooltip({ label: shiftLabel ? `${shiftLabel}${_exclHint}${_otherObjHint}${_rfzHint}${_covHint}` : (_exclHint || _otherObjHint || _rfzHint || _covHint || null), pos: _isRet ? null : (cellPosName || rfzOnCell?.positionName || null), range: _isRet ? null : (cellRange || (rfzOnCell ? `${formatTime(rfzOnCell.startTime)} - ${formatTime(rfzOnCell.endTime)}` : null)), x: e.clientX, y: e.clientY, restHours: _restHrs }); } else if (isExclusionCol) { setShiftTooltip({ label: excludedPositionsTooltip(excludedOnDay, cellDateStr), pos: null, range: null, x: e.clientX, y: e.clientY, restHours: null }); } else setShiftTooltip(null); }} onMouseLeave={() => setShiftTooltip(null)} className={`border-b border-r p-0.5 ${!isSnapshotView && !isLockedDate && !isServiceLocked ? 'cursor-pointer' : 'cursor-default'} text-center relative ${selected ? 'bg-indigo-200 dark:bg-indigo-800/50' : isExclusionCol ? 'bg-rose-50/50 dark:bg-rose-950/15 sla-excluded-day-col' : isCellWeekend ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`} title={isExclusionCol && !s && !p ? excludedPositionsTooltip(excludedOnDay, cellDateStr) : isOtherObjectiveShift && activeShift?.objectiveId ? `Turno en ${getObjectiveName(activeShift.objectiveId)}` : undefined}><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style} ${cellPosExcluded ? 'ring-1 ring-rose-400/70' : ''}`}>{content}{isExclusionCol && !content && (<span className="absolute bottom-0 left-0 w-1.5 h-1.5 rounded-full bg-rose-400/80" title="Día con puesto(s) excluido(s)"/>)}{isSwap && (<div className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${swapPending ? 'bg-amber-600 text-white' : 'bg-cyan-600 text-white'}`}>{swapPending ? 'S!' : 'S'}</div>)}{(isExtended || isEarly) && <div className="absolute -top-1 -right-1 text-[8px] bg-slate-800 text-white px-1 rounded-full">+</div>}{covRole === 'EXTENSION' && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-violet-600 text-white px-0.5 rounded">EXT</div>}{covRole === 'EARLY_START' && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-cyan-600 text-white px-0.5 rounded">ADEL</div>}{covRole === 'LIBERATED' && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-emerald-600 text-white px-0.5 rounded">RET</div>}{covRole === 'TARGET' && coveredByCell && <div className="absolute -bottom-0.5 left-0 text-[7px] font-black bg-indigo-600 text-white px-0.5 rounded">✓</div>}{statusIndicator && <div className={`absolute top-0 right-0 w-2 h-2 rounded-full border border-white ${statusIndicator}`}></div>}{hasConflict && ( <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center animate-pulse border-2 border-red-500 z-20"><Siren size={14} className="text-white drop-shadow-md"/></div> )}{isGuest && (s || p) && !absence && !isOtherObjectiveShift && (<div className="absolute bottom-0 left-0"><Briefcase size={8} className="text-amber-600 drop-shadow-sm"/></div>)}{isOtherObjectiveShift && content && (<div className="absolute bottom-0 left-0"><MapPin size={7} className="text-slate-300 drop-shadow-sm"/></div>)}{hasRfzOverlay && (<div className="absolute top-0 right-0 text-[7px] font-black bg-red-600 text-white px-0.5 rounded-bl">RFZ</div>)}{rfzOnCell && !s && !p && !absence && rfzOnCell.draft && (<div className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-amber-400 border border-white" title="Sin publicar"/>)}</div></td>;
                                    })}
                                </tr>
                            )}
                            
                            {/* FILA SNAPSHOT (HISTÓRICA) - Solo se muestra si hay snapshotData y estamos en modo snapshot */}
                            {isSnapshotView && snapshotData && (
                                <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                                    <td className="sticky left-0 z-20 bg-white dark:bg-slate-800 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                                        <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                    </td>
                                    {daysInMonth.map((day) => {
                                        const key = `${emp.id}_${getDateKey(day)}`;
                                        const snapShift = snapshotData[key];
                                        const isCellWeekend = [0, 6].includes(day.getDay());
                                        let content = null;
                                        let style = '';
                                        if (snapShift) {
                                            if (snapShift.isFrancoTrabajado) { content = 'FT'; style = SHIFT_STYLES['FT']; }
                                            else if (snapShift.isFrancoCompensatorio) { content = 'FF'; style = SHIFT_STYLES['FF']; }
                                            else {
                                                content = snapShift.code;
                                                style = getDefaultStyle(snapShift.code);
                                            }
                                        }
                                        if (compareChangedKeys?.has(key)) {
                                            style += ' ring-2 ring-amber-600 ring-offset-1 z-20';
                                        }
                                        return (
                                            <td key={`snap_${key}`} className={`border-b border-r p-0.5 text-center ${isCellWeekend ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`}>
                                                <div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style}`}>{content}</div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
                {/* ── Filas de refuerzo RFZ VACANTE — solo sin guardia asignado (asignados van en fila del empleado) ── */}
                {!isSnapshotView && rfzTodos.filter(rfz => {
                    if (rfz.objectiveId !== selectedObjective) return false;
                    if (rfz.employeeId && rfz.employeeId !== 'VACANTE') return false;
                    const mp = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                    return String(rfz.fecha || '').startsWith(mp);
                }).map((rfz) => {
                    const rfzStart = formatTime(rfz.startTime);
                    const rfzEnd   = formatTime(rfz.endTime);
                    const rfzFechaCorta = rfz.fecha ? String(rfz.fecha).split('-').reverse().slice(0, 2).join('/') : '';
                    const asignado = !!rfz.employeeId && rfz.employeeId !== 'VACANTE';
                    const guardiaNombre = asignado
                        ? (rfz.employeeName || employees.find(e => e.id === rfz.employeeId)?.name || 'Guardia')
                        : null;
                    const pendiente = asignado && rfz.draft === true;
                    return (
                        <tr key={`rfz_${rfz.id}`} className={asignado ? 'hover:bg-emerald-50/30' : 'hover:bg-red-50/30'}>
                            <td className={`sticky left-0 z-20 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 ${asignado ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}
                                style={{ width: nameColWidth, minWidth: nameColWidth }}>
                                <div className="flex flex-col min-w-0">
                                    <span className={`text-[9px] font-black uppercase tracking-wide leading-tight ${asignado ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {asignado ? (guardiaNombre as string) : 'VACANTE RFZ'}{rfzFechaCorta ? ` · ${rfzFechaCorta}` : ''}
                                    </span>
                                    <span className={`text-[8px] font-bold truncate ${asignado ? 'text-emerald-600' : 'text-red-500'}`} title={rfz.positionName || ''}>
                                        REFUERZO · {rfz.positionName || 'Sin puesto'} · {rfzStart}–{rfzEnd}{pendiente ? ' · sin publicar' : ''}
                                    </span>
                                </div>
                            </td>
                            {daysInMonth.map((day) => {
                                const dayStr = getDateKey(day);
                                const isRfzDay = rfz.fecha === dayStr;
                                const isCellWeekend = [0, 6].includes(day.getDay());
                                return (
                                    <td key={`rfz_${rfz.id}_${dayStr}`}
                                        onClick={() => {
                                            if (!isRfzDay) return;
                                            activateRfzCorrectionFlow();
                                            setRfzAsignando(rfz);
                                        }}
                                        className={`border-b border-r p-0.5 text-center ${isCellWeekend ? 'bg-rose-50/40' : ''} ${isRfzDay ? 'cursor-pointer' : ''}`}>
                                        {isRfzDay && (
                                            <div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black border transition-colors ${asignado
                                                ? (pendiente ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600' : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600')
                                                : 'bg-red-500 text-white border-red-600 hover:bg-red-600'}`}
                                                title={asignado ? `RFZ asignado a ${guardiaNombre}${pendiente ? ' (pendiente de publicar)' : ''}` : 'Vacante RFZ — tocá para asignar'}>
                                                RFZ
                                            </div>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    );
                })}
            </tbody>
            {!gridOpts?.hideFooter && (
            <tfoot className={`sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] border-t-2 ${gridOpts?.highlightCoverageFooter ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-300 ring-inset' : 'bg-slate-50 border-slate-300'}`}>
                <tr>
                    <td className={`sticky left-0 z-20 p-2 border-r border-b font-black text-[10px] uppercase shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 ${gridOpts?.highlightCoverageFooter ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-500'}`} style={{ width: nameColWidth, minWidth: nameColWidth }}>
                        <div className="flex items-center justify-between gap-2 w-full">
                            <button
                                type="button"
                                onClick={() => setHoursMode((m) => (m === 'mes' ? 'cct' : 'mes'))}
                                title={hoursMode === 'mes'
                                    ? 'Mostrando horas del mes calendario. Click para ver horas del ciclo CCT (26→25, tope 200h).'
                                    : 'Mostrando horas del ciclo CCT actual (26→25, tope 200h). Click para volver al mes calendario.'}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide transition-colors ${
                                    hoursMode === 'cct'
                                        ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
                                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                                }`}
                            >
                                <span>Hs:</span>
                                <span>{hoursMode === 'cct' ? 'CCT' : 'Mes'}</span>
                            </button>
                            <span className={`flex items-center gap-1 ${gridOpts?.highlightCoverageFooter ? 'text-rose-700' : 'text-slate-500'}`}>
                                <ShieldCheck size={12}/> Cobertura:
                            </span>
                        </div>
                    </td>
                    {daysInMonth.map(day => {
                        const dateStr = getDateKey(day);
                        const dayLetter = getDayLetter(dateStr);

                        // Puestos cerrados: 1 pax = esquema SLA completo (M+T+N, D12+N12, M+T, etc.).
                        let requiredPax = 0;
                        let closedPax = 0;
                        const cyclesForCoverage = autoSelectedCyclesRef.current?.length
                            ? autoSelectedCyclesRef.current
                            : autoCycles;
                        (positionStructure || []).forEach((pos: any) => {
                            const units = countPositionClosedUnits(
                                dateStr, pos, dayLetter,
                                dotacionBaseEmployees, pendingChanges, shiftsMap,
                                cyclesForCoverage,
                            );
                            requiredPax += units.required;
                            closedPax += units.closed;
                        });

                        const isCovered = requiredPax > 0 && closedPax >= requiredPax;
                        const cls = requiredPax === 0 ? 'bg-slate-50 text-slate-400' : (isCovered ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600 cursor-pointer');
                        return (
                            <td
                                key={dateStr}
                                className={`text-center border-r border-b text-[10px] font-black ${cls}`}
                                colSpan={1}
                                title={requiredPax > 0
                                    ? `${closedPax} de ${requiredPax} puestos cerrados (1 pax = esquema SLA completo del día)`
                                    : undefined}
                                onClick={(e) => {
                                    if (isCovered || requiredPax === 0) return;
                                    const codeCounts = buildDayCodeCountsByPosition(dateStr);
                                    const dayReport = analyzeDayCoverageGaps(
                                        positionStructure || [],
                                        dateStr,
                                        dayLetter,
                                        codeCounts,
                                        cyclesForCoverage,
                                        isPosActiveOnDay,
                                    );
                                    const gaps = dayReport.positions.length > 0
                                        ? flattenDayGapsForUi(dayReport)
                                        : (autoV2GenStats?.uncoveredSlotsByDay?.[dateStr] || []);
                                    if (gaps.length > 0) setCoverageTooltip(prev => prev?.dateStr === dateStr ? null : { dateStr, gaps, x: e.clientX, y: e.clientY });
                                }}
                            >
                                {requiredPax > 0 ? `${closedPax}/${requiredPax}` : '-'}
                            </td>
                        );
                    })}
                </tr>
            </tfoot>
            )}
        </table>
        );
    };

    const compareDiffKeys = planningCompareDiff?.changedKeys ?? null;
    const compareGridOpts = { hideFooter: true, minimalHeader: true, compactRows: true } as const;
    const compareSnapshotLabel = comparingSnapshot
        ? new Date(comparingSnapshot.date).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
    const selectedClientLabel = clients.find(c => c.id === selectedClient)?.name || '';
    const selectedObjectiveLabel = selectedClient && selectedObjective
        ? ((clients.find(c => c.id === selectedClient)?.objetivos || []).find((o: any) => (o.id || o.name) === selectedObjective)?.name || selectedObjective)
        : '';

    return (
        <DashboardLayout>
            <Head><title>Planificador</title></Head>
            <style>{`.pattern-grid { background-image: linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb); background-size: 10px 10px; background-position: 0 0, 5px 5px; } .sla-excluded-day-col { background-image: repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(251, 113, 133, 0.07) 4px, rgba(251, 113, 133, 0.07) 8px); } .planning-grid-table { border-collapse: separate; border-spacing: 0; } .planning-grid-table thead th { box-shadow: 0 1px 0 rgba(148,163,184,0.35); } .planning-grid-table .planning-sticky-corner { position: sticky; left: 0; top: 0; z-index: 50; } @media print { @page { size: A4 landscape; margin: 5mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background-color: white !important; } #printable-section { position: absolute; left: 0; top: 0; width: 100%; min-width: 100%; transform: none; background: white; } .no-print { display: none !important; } .custom-scrollbar { overflow: visible !important; height: auto !important; } }`}</style>
            <Toaster position="top-center" />
            {coverageTooltip && (
                <div
                    className="fixed z-[9999]"
                    style={{ left: Math.min(coverageTooltip.x + 8, window.innerWidth - 220), top: coverageTooltip.y + 10 }}
                    onClick={() => setCoverageTooltip(null)}
                >
                    <div className="bg-slate-900 text-white text-[10px] font-black px-3 py-2 rounded-lg shadow-sm flex flex-col gap-1.5 min-w-[240px] max-w-[320px]">
                        <div className="text-rose-300 text-[9px] uppercase tracking-wide mb-0.5">Puestos sin cerrar · {coverageTooltip.dateStr.slice(8)}</div>
                        {coverageTooltip.gaps.map((g, i) => (
                            <div key={i} className="flex flex-col gap-0.5 border-b border-slate-700/50 pb-1 last:border-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-200">{g.positionName}</span>
                                    <span className="text-rose-400 font-black shrink-0">{g.missing} pax</span>
                                </div>
                                {'detail' in g && g.detail && (
                                    <span className="text-[9px] text-slate-400 font-medium leading-snug">{g.detail}</span>
                                )}
                            </div>
                        ))}
                        <div className="text-slate-500 text-[8px] mt-1">Click para cerrar</div>
                    </div>
                </div>
            )}
            {shiftTooltip && (
                <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{ left: shiftTooltip.x + 10, top: shiftTooltip.y - 64 }}
                >
                    <div className={`bg-slate-900 text-white text-[10px] font-black px-2.5 py-2 rounded-lg shadow-sm flex flex-col gap-1 max-w-[240px] ${shiftTooltip.label?.includes('\n') ? 'whitespace-pre-line' : 'whitespace-nowrap'}`}>
                        {shiftTooltip.label && (
                            <div className="flex items-start gap-1.5 text-white font-medium">
                                {shiftTooltip.label.startsWith('Tipo:') ? (
                                    <Stethoscope size={9} className="text-rose-300 shrink-0 mt-0.5" />
                                ) : (
                                    <Clock size={9} className="text-indigo-300 shrink-0 mt-0.5" />
                                )}
                                <span>{shiftTooltip.label}</span>
                            </div>
                        )}
                        {shiftTooltip.pos && (
                            <div className="flex items-center gap-1.5 text-slate-300 font-medium text-[9px]">
                                <MapPin size={9} className="text-indigo-300 shrink-0" />
                                {shiftTooltip.pos}
                            </div>
                        )}
                        {shiftTooltip.range && (
                            <div className="flex items-center gap-1.5 text-slate-300 font-medium text-[9px]">
                                <span className="text-indigo-300">⏱</span>
                                {shiftTooltip.range}
                            </div>
                        )}
                        {shiftTooltip.restHours != null && (
                            <div className="flex items-center gap-1.5 text-green-300 font-medium text-[9px]">
                                <span className="text-green-400">⏸</span>
                                Descanso total: <span className="font-black text-green-200">{shiftTooltip.restHours}h</span>
                            </div>
                        )}
                        <div className="text-[8px] text-slate-500 font-medium pt-0.5 border-t border-slate-700">Click para ver detalle / Cambiar</div>
                    </div>
                    <div className="w-2 h-2 bg-slate-900 rotate-45 ml-2 -mt-1" />
                </div>
            )}
            {empPosPicker && typeof document !== 'undefined' && createPortal(
                <>
                <div
                    className="fixed inset-0 z-[9998] bg-black/20"
                    aria-hidden
                    onClick={() => setEmpPosPicker(null)}
                />
                <div
                    className="fixed z-[9999] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl overflow-hidden flex flex-col"
                    style={{
                        left: empPosPicker.x,
                        top: empPosPicker.y,
                        width: 260,
                        minWidth: 260,
                        height: empPosPicker.maxHeight,
                        maxHeight: empPosPicker.maxHeight,
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase border-b bg-slate-50 dark:bg-slate-900 tracking-wider shrink-0">
                        Puesto + Turno
                        {empPosPicker.floating && (
                            <span className="ml-1 text-indigo-500 normal-case font-bold">· flotante</span>
                        )}
                        <p className="text-[8px] font-bold normal-case text-slate-400 mt-0.5 tracking-normal">REF/ESC excluyen del auto y dotación · ♂/♀ = puesto con género definido</p>
                    </div>
                    <div className="overflow-y-auto overscroll-contain custom-scrollbar flex-1 min-h-0">
                    {positionStructure.map(p => {
                        const codes = [...new Set((p.shifts || []).map((s:any) => String(s.code || '').toUpperCase()).filter(Boolean))];
                        const isSelPos = getEmpDefaultPos(empPosPicker.empId) === p.positionName;
                        const selShift = getEmpDefaultShift(empPosPicker.empId);
                        const NORM: Record<string,string> = { D12: 'M', N12: 'N' };
                        const shiftColor: Record<string,string> = {
                            M: 'bg-sky-500 text-white', T: 'bg-amber-500 text-white',
                            N: 'bg-indigo-600 text-white',
                        };
                        const surplusActive = (role: string) => isSelPos && selShift === role;
                        return (
                                <div key={p.positionName} className={`border-b last:border-0 dark:border-slate-700 ${isSelPos ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                                <div className="px-3 pt-2 pb-1 text-[10px] font-black text-slate-600 dark:text-slate-200 flex items-center gap-1.5">
                                    <span>{p.positionName}</span>
                                    {renderPositionGeneroBadge(p.preferenciaGenero)}
                                </div>
                                <div className="flex flex-wrap gap-1 px-3 pb-2">
                                    <button
                                        onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, null)}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${isSelPos && !selShift ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}
                                        title="Asignar al puesto sin preferencia de turno — el auto-scheduler elige"
                                    >
                                        AUTO
                                    </button>
                                    {codes.map((sc:string) => {
                                        const saveCode = NORM[sc] ?? sc;
                                        const displayLabel = NORM[sc] ?? sc;
                                        const is12h = sc === 'D12' || sc === 'N12';
                                        const active = isSelPos && selShift === saveCode;
                                        return (
                                            <button key={sc}
                                                onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, saveCode)}
                                                className={`flex items-center gap-0.5 px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${active ? (shiftColor[saveCode] || 'bg-indigo-600 text-white') : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                                                {displayLabel}
                                                {is12h && <span className={`text-[8px] font-bold ml-0.5 ${active ? 'opacity-80' : 'text-slate-400'}`}>12h</span>}
                                            </button>
                                        );
                                    })}
                                    <button
                                        onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, 'REF')}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${surplusActive('REF') ? 'bg-violet-600 text-white' : 'bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-200'}`}
                                        title="Refuerzo: visible en grilla pero excluido del automatizar y del conteo de dotación"
                                    >
                                        REF
                                    </button>
                                    <button
                                        onClick={() => saveEmpPos(empPosPicker.empId, p.positionName, 'ESC')}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-black transition-colors ${surplusActive('ESC') ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-200'}`}
                                        title="Escuela: visible en grilla pero excluido del automatizar y del conteo de dotación"
                                    >
                                        ESC
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    </div>
                    {getEmpDefaultPos(empPosPicker.empId) && (
                        <button onClick={() => saveEmpPos(empPosPicker.empId, null, null)}
                            className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border-t dark:border-slate-700 transition-colors shrink-0">
                            Quitar prefijo
                        </button>
                    )}
                </div>
                </>,
                document.body,
            )}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out no-print ${selectedClient || comparingSnapshot ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-40 opacity-100'}`}>
                <PageHeader
                    title="Planificador"
                    subtitle="Gestión de turnos y asignaciones"
                    icon={CalendarCheck}
                    className="px-2 pt-2"
                />
            </div>
            <div className={`flex flex-col animate-in fade-in select-none transition-all duration-300 ease-in-out min-h-0 ${cronoFullscreen ? 'fixed inset-0 z-[1100] bg-white dark:bg-slate-900 overflow-hidden p-1 space-y-1' : comparingSnapshot && selectedObjective ? 'h-[calc(100dvh-3.75rem)] overflow-hidden p-0.5 space-y-0.5' : selectedClient ? 'h-[calc(100dvh-5.5rem)] lg:h-[calc(100dvh-6.5rem)] overflow-hidden p-1 space-y-1.5' : 'p-2 space-y-4 h-[calc(100vh-220px)] lg:h-[calc(100vh-160px)]'}`} onMouseUp={handleMouseUp} onClick={() => setEmpPosPicker(null)}>

                <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 shrink-0 relative z-40 ${comparingSnapshot ? 'py-1 px-2 border-amber-200 bg-amber-50/40' : selectedClient ? 'py-1.5 px-2' : 'p-3'}`}>
                    {comparingSnapshot ? (
                        <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-black text-slate-700 truncate max-w-[220px]" title={`${selectedClientLabel} · ${selectedObjectiveLabel}`}>
                                {selectedClientLabel}<span className="text-slate-400 mx-1">›</span>{selectedObjectiveLabel}
                            </span>
                            <div className="h-4 w-px bg-amber-200 shrink-0"/>
                            <div className="flex items-center bg-white rounded-lg p-0.5 border border-amber-200 shrink-0">
                                <button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1)); setAutoGeneratedReady(false); }} aria-label="Mes anterior" className="p-0.5 hover:bg-amber-50 rounded"><ChevronLeft size={14}/></button>
                                <span className="px-2 font-black text-[10px] w-20 text-center capitalize">{currentDate.toLocaleDateString('es-AR', {month:'short', year:'2-digit'})}</span>
                                <button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1)); setAutoGeneratedReady(false); }} aria-label="Mes siguiente" className="p-0.5 hover:bg-amber-50 rounded"><ChevronRight size={14}/></button>
                            </div>
                            <div className="h-4 w-px bg-amber-200 shrink-0"/>
                            <Split size={13} className="text-amber-600 shrink-0"/>
                            <span className="text-[10px] font-bold text-amber-900 truncate max-w-[140px]" title={compareSnapshotLabel}>{compareSnapshotLabel}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${planningCompareDiff?.changedCount ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
                                {planningCompareDiff?.changedCount ?? 0} dif.
                            </span>
                            <button
                                type="button"
                                onClick={() => setCompareShowOnlyDiffs((v) => !v)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold border shrink-0 ${compareShowOnlyDiffs ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-600 border-slate-200'}`}
                            >
                                Solo cambios
                            </button>
                            <button
                                type="button"
                                onClick={() => setCompareLayout((l) => (l === 'side' ? 'stack' : 'side'))}
                                className="p-1.5 rounded-lg border bg-white text-slate-600 border-slate-200 shrink-0"
                                title={compareLayout === 'side' ? 'Apilar verticalmente' : 'Ver lado a lado'}
                            >
                                {compareLayout === 'side' ? <PanelLeft size={14}/> : <LayoutList size={14}/>}
                            </button>
                            <button type="button" onClick={() => setShowCompareDiffModal(true)} className="px-2 py-1 rounded-lg text-[10px] font-bold border bg-white text-slate-600 border-slate-200 shrink-0 flex items-center gap-1" title="Listado de celdas distintas">
                                <ArrowLeftRight size={12}/> Detalle
                            </button>
                            <button type="button" onClick={() => setShowCompareSummaryModal(true)} className="p-1.5 rounded-lg border bg-white text-slate-600 border-slate-200 shrink-0" title="Resumen de horas y dotación"><BarChart3 size={14}/></button>
                            <button type="button" onClick={() => setShowActivityModal(true)} className="p-1.5 rounded-lg border bg-white text-slate-600 border-slate-200 shrink-0 relative" title="Actividad reciente">
                                <Clock size={14}/>
                                {unifiedLogs.length > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-indigo-600 text-white text-[8px] font-black flex items-center justify-center">{unifiedLogs.length > 9 ? '9+' : unifiedLogs.length}</span>}
                            </button>
                            <button onClick={exitSnapshotMode} className="ml-auto bg-amber-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-amber-700 shrink-0 flex items-center gap-1"><X size={12}/> Salir</button>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                            <div className="flex items-center gap-1.5 no-print">
                                {!selectedClient ? (
                                    /* Sin cliente: botón cuadrado que despliega lista custom al clic */
                                    <div className="relative" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => setOpenDrop(d => d === 'client' ? null : 'client')}
                                            className="flex items-center gap-1.5 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide hover:bg-slate-700 transition-colors"
                                        >
                                            Cliente <ChevronDown size={12}/>
                                        </button>
                                        {openDrop === 'client' && (
                                            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-sm min-w-[220px] max-h-64 overflow-y-auto">
                                                {[...clients].sort((a,b) => a.name.localeCompare(b.name)).map(c => (
                                                    <button key={c.id} onClick={() => { handleContextChange(c.id, ''); }} className="w-full text-left px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-slate-100 last:border-0">
                                                        {c.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Cliente seleccionado: etiqueta fija + objetivo con dropdown custom + X */
                                    <>
                                        {/* Cliente: fijo, solo se cambia con X */}
                                        <span className="flex items-center gap-1.5 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide cursor-default select-none">
                                            {clients.find(c => c.id === selectedClient)?.name || 'Cliente'}
                                        </span>
                                        <ChevronRight size={12} className="text-slate-400"/>
                                        {/* Objetivo: dropdown custom al clic */}
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setOpenDrop(d => d === 'objective' ? null : 'objective')}
                                                className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide hover:bg-indigo-500 transition-colors"
                                            >
                                                {(clients.find(c => c.id === selectedClient)?.objetivos || []).find((o: any) => (o.id || o.name) === selectedObjective)?.name || 'Objetivo'}
                                                <ChevronDown size={12}/>
                                            </button>
                                            {openDrop === 'objective' && (
                                                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-sm min-w-[220px] max-h-64 overflow-y-auto">
                                                    {[...(clients.find(c => c.id === selectedClient)?.objetivos||[])].sort((a:any,b:any) => a.name.localeCompare(b.name)).map((o:any) => (
                                                        <button key={o.id||o.name} onClick={() => { handleContextChange(selectedClient, o.id||o.name); }} className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-slate-100 last:border-0 ${(o.id||o.name) === selectedObjective ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'}`}>
                                                            {o.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        {/* Advertencia: objetivo sin coordenadas */}
                                        {selectedObjective && selectedObjectiveData && !Number(selectedObjectiveData?.lat ?? 0) && (
                                            <a href="/admin/crm" title="El objetivo no tiene coordenadas. Las distancias no se pueden calcular. Ir a CRM → Objetivo → Geolocalizar." className="flex items-center gap-1 px-2 py-1.5 bg-amber-50 border border-amber-300 rounded-lg text-amber-700 text-xs font-bold hover:bg-amber-100 transition-colors">
                                                <MapPin size={11} className="text-amber-500 shrink-0"/>
                                                Sin coords
                                            </a>
                                        )}
                                        {/* X: limpia cliente y objetivo */}
                                        <button onClick={() => handleContextChange('', '')} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors" title="Limpiar selección"><X size={13}/></button>
                                    </>
                                )}
                            </div>
                            
                            {/* CRONO: ALERTAS DE ESTADO DEL SERVICIO (V8.20) */}
                            {isServiceLocked && (
                                <div className={`flex-1 bg-rose-50 border-rose-200 border px-4 py-2 rounded-xl flex items-center gap-3 animate-in slide-in-from-top shadow-md`}>
                                    <div className="p-2 bg-rose-100 rounded-lg text-rose-600 animate-pulse"><PowerOff size={20}/></div>
                                    <div>
                                        <p className="text-xs font-black text-rose-700 uppercase">{activeServiceStatus.msg}</p>
                                        <p className="text-[10px] text-rose-600 font-medium">La planificación está bloqueada. No se pueden realizar cambios.</p>
                                    </div>
                                </div>
                            )}

                            {/* DIAGNÓSTICO DE ESTRUCTURA — expandible */}
                            {selectedObjective && !isServiceLocked && (
                                <div className="relative hidden md:block">
                                    <button
                                        ref={diagnosticBtnRef}
                                        onClick={() => {
                                            if (showDiagnostic) {
                                                setShowDiagnostic(false);
                                            } else {
                                                repositionDiagnosticPanel();
                                                setShowDiagnostic(true);
                                            }
                                        }}
                                        className="flex px-3 py-1.5 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl items-center gap-2 animate-in fade-in shadow-sm hover:border-indigo-300 dark:hover:border-indigo-500 transition-colors"
                                    >
                                        <Activity size={14} className="text-emerald-500 animate-pulse shrink-0"/>
                                        <div className="flex flex-col leading-none">
                                            <span className="text-[9px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">Diagnóstico de Estructura</span>
                                            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                                {positionStructure.length} Puestos
                                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                                <span className="text-emerald-600 font-black">{positionStructure.reduce((acc, curr) => acc + (curr.qty || 1), 0)} Pax</span>
                                                {genderRestrictedPositionsCount > 0 && (
                                                    <>
                                                        <span className="text-slate-300 dark:text-slate-600">|</span>
                                                        <span className="text-pink-600 font-black" title="Puestos con preferencia de género (M/F) definida en Servicios/SLA">
                                                            {genderRestrictedPositionsCount} c/ género
                                                        </span>
                                                    </>
                                                )}
                                                {slaVendidas > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span className="text-teal-600 font-black">{slaVendidas}h vend.</span></>}
                                            </span>
                                        </div>
                                        <ChevronDown size={12} className={`text-slate-400 transition-transform shrink-0 ${showDiagnostic ? 'rotate-180' : ''}`}/>
                                    </button>
                                </div>
                            )}

                            {/* DIAGNÓSTICO DE COBERTURA — qué falta por objetivo/mes */}
                            {selectedObjective && !isServiceLocked && objectiveCoverageGapReport && (
                                <div className="relative hidden md:block">
                                    <button
                                        ref={coverageDiagnosticBtnRef}
                                        onClick={() => {
                                            if (showCoverageDiagnostic) {
                                                setShowCoverageDiagnostic(false);
                                            } else {
                                                repositionCoveragePanel();
                                                setShowCoverageDiagnostic(true);
                                            }
                                        }}
                                        className={`flex px-3 py-1.5 border rounded-xl items-center gap-2 animate-in fade-in shadow-sm transition-colors ${
                                            objectiveCoverageGapReport.worstDays.length === 0
                                                ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
                                                : 'bg-rose-50 border-rose-200 hover:border-rose-300'
                                        }`}
                                    >
                                        <ShieldCheck size={14} className={objectiveCoverageGapReport.worstDays.length === 0 ? 'text-emerald-500' : 'text-rose-500 shrink-0'}/>
                                        <div className="flex flex-col leading-none">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Diagnóstico Cobertura</span>
                                            <span className="text-[10px] font-bold text-slate-700 flex items-center gap-1">
                                                <span className="text-emerald-600 font-black">{objectiveCoverageGapReport.daysFull} días OK</span>
                                                <span className="text-slate-300">|</span>
                                                <span className="text-rose-600 font-black">{objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty} con huecos</span>
                                            </span>
                                        </div>
                                        <ChevronDown size={12} className={`text-slate-400 transition-transform shrink-0 ${showCoverageDiagnostic ? 'rotate-180' : ''}`}/>
                                    </button>
                                </div>
                            )}

                            {selectedObjective && (() => {
                                const publishLookupKey = planificacionPublishLookupKey(
                                    selectedObjective,
                                    currentDate.getFullYear(),
                                    currentDate.getMonth() + 1,
                                );
                                const published = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
                                const needsRepublish = !!needsRepublishMap[publishLookupKey];
                                return (
                                    <div className="flex items-center gap-2 no-print">
                                        <button
                                            type="button"
                                            onClick={() => void refreshCronogramaView()}
                                            disabled={isRefreshingCrono}
                                            title="Actualizar turnos y puestos sin recargar la página"
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-black border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm disabled:opacity-60"
                                        >
                                            <RefreshCw size={12} className={isRefreshingCrono ? 'animate-spin' : ''}/>
                                            {isRefreshingCrono ? '…' : 'ACTUALIZAR'}
                                        </button>
                                        {published ? (
                                            <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                                                <CheckCircle size={12}/> PUBLICADO
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl">
                                                <Ghost size={12}/> BORRADOR
                                            </span>
                                        )}
                                        {canPublishPlanning && (!published || needsRepublish) && (
                                            <button
                                                onClick={openPublishConfirm}
                                                disabled={isPublishing}
                                                title={isSuperAdmin && (slaVendidas > 0 && Math.round(Object.values(empMonthlyHours).reduce((a: number, b: number) => a + (b || 0), 0)) !== Math.round(slaVendidas) || (objectiveCoverageGapReport && objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty > 0))
                                                    ? 'Super Admin: podés publicar aunque SLA o cobertura no coincidan'
                                                    : undefined}
                                                className={`flex items-center gap-1.5 disabled:opacity-60 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors shadow ${needsRepublish ? 'bg-amber-500 hover:bg-amber-600 animate-pulse' : isSuperAdmin ? 'bg-indigo-600 hover:bg-indigo-700 ring-1 ring-indigo-300/50' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                            >
                                                {isPublishing ? <Loader2 size={12} className="animate-spin"/> : <CalendarCheck size={12}/>}
                                                {published ? 'RE-PUBLICAR' : 'PUBLICAR'}
                                            </button>
                                        )}
                                        {published && canCorrectPlanning && (
                                            <button
                                                onClick={() => setCorrectionMode(v => !v)}
                                                title="Modo Corrección: permite editar cronograma publicado sin FT/FF"
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors border ${correctionMode ? 'bg-rose-600 text-white border-rose-700 shadow-lg' : 'bg-white text-rose-600 border-rose-300 hover:bg-rose-50'}`}
                                            >
                                                <ShieldAlert size={12}/>
                                                {correctionMode ? 'CORRECCIÓN ACTIVA' : 'CORREGIR'}
                                            </button>
                                        )}
                                        {published && isSuperAdmin && (
                                            <button
                                                onClick={handleUnpublish}
                                                disabled={isUnpublishing}
                                                title="SuperAdmin: despublica solo este objetivo y mes. No borra turnos."
                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors border bg-white text-slate-600 border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                                            >
                                                {isUnpublishing ? <Loader2 size={12} className="animate-spin"/> : <CalendarX size={12}/>}
                                                DESPUBLICAR
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}
                            {Object.keys(pendingChanges).length > 0 && !isServiceLocked && <div className="flex items-center gap-2 animate-in slide-in-from-top-2 bg-amber-50 p-1.5 rounded-xl border border-amber-200 shadow-lg no-print"><span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest hidden md:inline">Planificando como: {operatorName}</span><div className="h-4 w-px bg-amber-200 mx-1"></div><span className="text-xs font-black text-amber-700 px-1">{Object.keys(pendingChanges).length} cambios</span><button onClick={() => setPendingChanges({})} className="p-1.5 hover:bg-amber-100 rounded-lg text-amber-600"><Undo size={16}/></button><button onClick={handleSaveAll} disabled={isProcessing} className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 shadow">{isProcessing ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}{isProcessing ? 'GUARDANDO…' : 'GUARDAR'}</button></div>}
                            </div>

                            <div className="flex-shrink-0 flex items-center gap-2 no-print">
                                {/* CRONOGRAMAS — solo expandido */}
                                {!toolbarCollapsed && (
                                    <button
                                        type="button"
                                        onClick={() => setShowCronogramasOverview(true)}
                                        title="Ver estado de cronogramas de todos los objetivos"
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors border bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 shadow-sm"
                                    >
                                        <Database size={12}/>
                                        CRONOGRAMAS
                                    </button>
                                )}

                                {/* REFERENCIAS — solo expandido */}
                                {!toolbarCollapsed && (
                                    <button
                                        onClick={() => setShowLegend(!showLegend)}
                                        className={`p-2 rounded-xl transition-colors border ${showLegend ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-transparent hover:bg-white text-slate-500'}`}
                                        title="Ver Referencias de Colores"
                                    >
                                        <Info size={18}/>
                                    </button>
                                )}
                                {showLegend && renderLegend()}

                                {/* BELL — solo expandido */}
                                {!toolbarCollapsed && (
                                    <div className="relative">
                                        <button
                                            ref={notifBtnRef}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (showNotifications) {
                                                    setShowNotifications(false);
                                                } else {
                                                    repositionNotifPanel();
                                                    setShowNotifications(true);
                                                    setHasUnread(false);
                                                }
                                            }}
                                            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl relative"
                                        >
                                            <Bell size={18}/>{(hasUnread || bellNotifications.length > 0) && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white animate-pulse"></span>}
                                        </button>
                                    </div>
                                )}
                                {showNotifications && typeof document !== 'undefined' && createPortal(
                                    <>
                                        <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowNotifications(false)} />
                                        <div
                                            className="fixed z-[9999] w-96 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border overflow-hidden animate-in zoom-in-95"
                                            style={{ top: notifPanelTop, right: 16 }}
                                            onClick={e => e.stopPropagation()}
                                        >
                                            <div className="p-3 bg-slate-50 border-b flex justify-between items-center">
                                                <h3 className="font-black text-xs uppercase text-slate-500">Alertas</h3>
                                                <div className="flex items-center gap-2">
                                                    {notifications.length > 0 && (
                                                        <div className="flex items-center gap-1">
                                                            <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded">
                                                                <Check size={12}/> Leído
                                                            </button>
                                                            <button onClick={handleDeleteAllNotifications} className="text-[10px] font-bold text-rose-600 hover:text-rose-800 flex items-center gap-1 bg-rose-50 px-2 py-1 rounded">
                                                                <Trash2 size={12}/> Borrar
                                                            </button>
                                                        </div>
                                                    )}
                                                    <button onClick={() => setShowNotifications(false)}><X size={14}/></button>
                                                </div>
                                            </div>
                                            <div className="max-h-80 overflow-y-auto custom-scrollbar">
                                                {bellNotifications.length > 0 ? bellNotifications.map((notif, i) => (
                                                    <div key={i} className="p-3 border-b last:border-0 hover:bg-slate-50 flex gap-3 items-start cursor-pointer group" onClick={() => handleNotificationClick(notif)}>
                                                        <div className={`p-2 rounded-full ${notif.title?.includes('⚠️') ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                                                            {notif.source === 'NOVEDAD' ? <AlertTriangle size={16}/> : <CalendarX size={16}/>}
                                                        </div>
                                                        <div className="flex-1">
                                                            <p className="text-xs font-bold text-slate-800">{notif.title}</p>
                                                            <p className="text-[10px] text-slate-500">{notif.msg}</p>
                                                            <div className="flex justify-between mt-1">
                                                                <p className="text-[9px] font-mono text-slate-400">{notif.createdAt?.seconds ? new Date(notif.createdAt.seconds * 1000).toLocaleDateString('es-AR') : (notif.date || '--')}</p>
                                                                <span className="text-[9px] font-bold text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">Ir a detalle →</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )) : <div className="p-6 text-center text-slate-400 text-xs">Sin novedades recientes.</div>}
                                            </div>
                                        </div>
                                    </>,
                                    document.body,
                                )}

                                {/* < MES > — siempre visible */}
                                <div className="flex items-center bg-slate-100 rounded-xl p-1"><button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1)); setAutoGeneratedReady(false); }} aria-label="Mes anterior" className="p-1 hover:bg-white rounded-lg"><ChevronLeft size={16} aria-hidden="true"/></button><span className="px-3 font-black text-xs w-24 text-center capitalize">{currentDate.toLocaleDateString('es-AR', {month:'long'})}</span><button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1)); setAutoGeneratedReady(false); }} aria-label="Mes siguiente" className="p-1 hover:bg-white rounded-lg"><ChevronRight size={16} aria-hidden="true"/></button></div>

                                {/* AUTO — siempre visible */}
                                <div className="flex items-center gap-0.5" title="Automatización del cronograma (motor COSP)">
                                    <button
                                        onClick={applyPrevMonthTemplate}
                                        disabled={!selectedObjective || prevMonthLoading}
                                        title="Copiar planificación del mes anterior como plantilla"
                                        className="p-2 bg-slate-100 rounded-l-lg hover:bg-teal-50 hover:text-teal-600 transition-colors disabled:opacity-40 border-r border-slate-200"
                                    >
                                        {prevMonthLoading ? <Loader2 size={18} className="animate-spin text-teal-600"/> : <CalendarSearch size={18}/>}
                                    </button>
                                    {(() => {
                                        const _pubKey = selectedObjective ? planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1) : '';
                                        const _isPublished = !!(_pubKey && isPlanificacionPublished(publishStatusMap[_pubKey]));
                                        const _blocked = _isPublished && !correctionMode;
                                        return (
                                    <button
                                        onClick={() => {
                                            setAutoV2Report(null);
                                            setAutoWizardStep('configure');
                                            setAutoWizardPersonalize(true);
                                            setShowAutoV2Modal(true);
                                            setCapOverflowEmps([]);
                                            authorizedOver200IdsRef.current = new Set();
                                            setAuthorizedOver200Ids(new Set());
                                        }}
                                        disabled={!selectedObjective || autoV2Loading || _blocked}
                                        title={_blocked ? 'Crono publicado — entrá en CORREGIR para usar AUTO' : 'Automatizar: viabilidad + generación según SLA, CCT 200h, cobertura y dotación'}
                                        className="p-2 bg-slate-100 rounded-r-lg hover:bg-amber-50 hover:text-amber-600 transition-colors disabled:opacity-40 border-l border-slate-200 flex items-center gap-1.5 px-2.5"
                                    >
                                        {autoV2Loading
                                            ? <Loader2 size={18} className="animate-spin text-amber-600"/>
                                            : <><Wand2 size={16} className="text-amber-600 shrink-0"/><span className="text-[10px] font-black text-amber-700 uppercase tracking-tight hidden sm:inline">Auto</span></>}
                                    </button>
                                        ); })()}
                                </div>

                                {/* === ACCIONES SECUNDARIAS — se ocultan al colapsar === */}
                                {!toolbarCollapsed && (
                                    <>
                                        <button onClick={loadHistory} className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Ver Historial" disabled={!selectedObjective}><History size={18}/></button>

                                        {/* ⋯ MENÚ: Ventana externa + Ajustar + Equilibrar + Puestos */}
                                        <div className="relative" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => setToolbarMoreOpen(v => !v)}
                                                className={`p-2 rounded-xl transition-colors border ${toolbarMoreOpen ? 'bg-slate-200 border-slate-300 text-slate-700' : 'bg-slate-100 border-transparent hover:bg-slate-200 text-slate-500'}`}
                                                title="Más acciones"
                                            >
                                                <MoreHorizontal size={18}/>
                                            </button>
                                            {toolbarMoreOpen && (
                                                <>
                                                    <div className="fixed inset-0 z-40" onClick={() => setToolbarMoreOpen(false)}/>
                                                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1.5 min-w-[210px]">
                                                        <button
                                                            onClick={() => {
                                                                if (selectedClient) openCronoPopout({ clientId: selectedClient, objectiveId: floatingInitialObjective, month: currentDate, mainObjectiveId: selectedObjective });
                                                                setToolbarMoreOpen(false);
                                                            }}
                                                            disabled={!selectedClient}
                                                            className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2.5"
                                                        >
                                                            <Maximize2 size={14} className="text-indigo-500"/> Ventana externa
                                                        </button>
                                                        <div className="h-px bg-slate-100 mx-2 my-1"/>
                                                        {(() => {
                                                            const _pubKey2 = selectedObjective ? planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1) : '';
                                                            const _blocked2 = !!(_pubKey2 && isPlanificacionPublished(publishStatusMap[_pubKey2])) && !correctionMode;
                                                            return (
                                                                <>
                                                                    <button
                                                                        onClick={() => { setShowAjustarCronoModal(true); setToolbarMoreOpen(false); }}
                                                                        disabled={!selectedObjective || _blocked2}
                                                                        title={_blocked2 ? 'Crono publicado — entrá en CORREGIR para usar Ajustar' : 'Ajustar Crono: comprimir a 12h o liberar retenes para un rango de días'}
                                                                        className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2.5"
                                                                    >
                                                                        <ArrowLeftRight size={14} className="text-rose-500"/> Ajustar crono
                                                                    </button>
                                                                    <button
                                                                        onClick={() => { setShowEquilibrarModal(true); setToolbarMoreOpen(false); }}
                                                                        disabled={!selectedObjective || _blocked2}
                                                                        title={_blocked2 ? 'Crono publicado — entrá en CORREGIR para equilibrar' : 'Equilibrar horas: rotar posiciones por bloque para igualar horas entre todos los empleados'}
                                                                        className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2.5"
                                                                    >
                                                                        <BarChart2 size={14} className="text-emerald-500"/> Equilibrar horas
                                                                    </button>
                                                                </>
                                                            );
                                                        })()}
                                                        {selectedObjective && Object.keys(empDefaultPos).some(k => k.endsWith(`___${selectedObjective}`)) && (
                                                            <>
                                                                <div className="h-px bg-slate-100 mx-2 my-1"/>
                                                                <button
                                                                    onClick={() => { clearAllPositions(); setToolbarMoreOpen(false); }}
                                                                    className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-2.5"
                                                                    title="Quitar todos los puestos asignados en este mes"
                                                                >
                                                                    <X size={14} className="text-orange-500"/> Quitar puestos
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* SORT */}
                                        <div className="flex items-center gap-0.5">
                                            <div className="relative">
                                                {(() => {
                                                    const SORT_OPTIONS: { key: typeof sortBy; label: string; Icon: typeof ArrowDownWideNarrow }[] = [
                                                        { key: 'activity', label: 'Actividad', Icon: ArrowDownWideNarrow },
                                                        { key: 'name', label: 'Nombre', Icon: ArrowDownAZ },
                                                        { key: 'client', label: 'Cliente', Icon: Briefcase },
                                                        { key: 'band', label: 'Banda', Icon: Clock },
                                                        { key: 'position', label: 'Puesto', Icon: LayoutGrid },
                                                    ];
                                                    const activeSort = SORT_OPTIONS.find(o => o.key === sortBy) || SORT_OPTIONS[0];
                                                    const ActiveIcon = activeSort.Icon;
                                                    return (
                                                        <>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setBandDropOpen(false);
                                                                    setSortDropOpen(p => !p);
                                                                }}
                                                                className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-l-xl transition-colors border border-transparent hover:border-indigo-200 flex items-center gap-1"
                                                                title={`Orden: ${activeSort.label}`}
                                                            >
                                                                <ActiveIcon size={18}/>
                                                                <ChevronDown size={12} className={sortDropOpen ? 'rotate-180 transition-transform' : 'transition-transform'}/>
                                                            </button>
                                                            {sortDropOpen && (
                                                                <div className="absolute top-full right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 min-w-[168px]">
                                                                    <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-700 mb-1">
                                                                        Ordenar por
                                                                    </p>
                                                                    {SORT_OPTIONS.map(({ key, label, Icon }) => {
                                                                        const active = sortBy === key;
                                                                        return (
                                                                            <button
                                                                                key={key}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    startFilterTransition(() => setSortBy(key));
                                                                                    setSortDropOpen(false);
                                                                                }}
                                                                                className={`w-full px-3 py-2 text-left text-[11px] font-bold flex items-center gap-2 transition-colors ${active ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                                                                            >
                                                                                <Icon size={14} className="shrink-0"/>
                                                                                {label}
                                                                                {active && <Check size={12} className="ml-auto text-indigo-600"/>}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                            <button onClick={() => startFilterTransition(() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc'))} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-r-xl transition-colors border border-transparent hover:border-indigo-200" title={sortDir === 'asc' ? "Ascendente" : "Descendente"}>{sortDir === 'asc' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
                                        </div>

                                        {/* BAND FILTER */}
                                        <div className="relative" title="Filtrar por banda horaria">
                                            {(() => {
                                                const BAND_COLORS: Record<string, string> = {
                                                    M: 'text-blue-700 border-blue-400 bg-blue-50',
                                                    T: 'text-orange-600 border-orange-400 bg-orange-50',
                                                    N: 'text-indigo-700 border-indigo-500 bg-indigo-50',
                                                    D12: 'text-cyan-700 border-cyan-400 bg-cyan-50',
                                                    N12: 'text-purple-700 border-purple-500 bg-purple-50',
                                                    RET: 'text-amber-700 border-amber-500 bg-amber-50',
                                                };
                                                const activeCls = bandFilter ? BAND_COLORS[bandFilter] : 'text-slate-600 border-slate-300 bg-slate-100';
                                                return (<>
                                                    <button
                                                        onClick={() => { setSortDropOpen(false); setBandDropOpen(p => !p); }}
                                                        className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase border transition-colors flex items-center gap-1 ${activeCls}`}
                                                    >
                                                        {bandFilter ?? 'ALL'}
                                                        <ChevronDown size={10}/>
                                                    </button>
                                                    {bandDropOpen && (
                                                        <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[72px]">
                                                            {[null,'M','T','N','D12','N12','RET'].map(b => {
                                                                const label = b ?? 'ALL';
                                                                const active = bandFilter === b;
                                                                const textCls = b ? BAND_COLORS[b].split(' ')[0] : 'text-slate-600';
                                                                return (
                                                                    <button key={label}
                                                                        onClick={() => { startFilterTransition(() => setBandFilter(b)); setBandDropOpen(false); }}
                                                                        className={`w-full px-3 py-1.5 text-left text-[10px] font-black uppercase hover:bg-slate-50 transition-colors ${active ? textCls : 'text-slate-400'}`}
                                                                    >{label}</button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </>);
                                            })()}
                                        </div>

                                        {customOrderMap[selectedObjective || '__all__'] && !forceShowAll && (
                                            <button onClick={clearCustomOrder} className="p-2 bg-indigo-100 text-indigo-600 hover:bg-rose-100 hover:text-rose-600 rounded-xl transition-colors text-[9px] font-black uppercase flex items-center gap-1" title="Hay orden personalizado — click para restablecer orden automático"><Grip size={12}/><X size={10}/></button>
                                        )}
                                    </>
                                )}

                                {/* DOTACIÓN — siempre visible */}
                                {forceShowAll ? (
                                    <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl border bg-amber-100 text-amber-700 border-amber-200">
                                        <button
                                            type="button"
                                            onClick={() => startShowAllTransition(() => setForceShowAll(false))}
                                            className="p-1.5 rounded-lg hover:bg-amber-200/70 transition-colors"
                                            title="Volver a dotación del objetivo"
                                        >
                                            <Eye size={14}/>
                                        </button>
                                        <span className="text-[10px] font-black uppercase">≤</span>
                                        <input
                                            type="number"
                                            min={DOTACION_NEARBY_KM_MIN}
                                            max={DOTACION_NEARBY_KM_MAX}
                                            value={nearbyKmDraft}
                                            onChange={e => setNearbyKmDraft(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') applyNearbyKm(parseInt(nearbyKmDraft, 10));
                                            }}
                                            className="w-11 text-center text-xs font-black bg-white/90 border border-amber-300 rounded-lg px-1 py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            title={`Radio en km (${DOTACION_NEARBY_KM_MIN}–${DOTACION_NEARBY_KM_MAX})`}
                                        />
                                        <span className="text-[10px] font-black uppercase">km</span>
                                        <button
                                            type="button"
                                            onClick={() => applyNearbyKm(parseInt(nearbyKmDraft, 10))}
                                            className="p-1.5 rounded-lg hover:bg-amber-200/70 transition-colors"
                                            title="Buscar con este radio"
                                        >
                                            <Search size={13}/>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => applyNearbyKm(nearbyKmRadius + 5)}
                                            className="px-1.5 py-1 rounded-lg text-[9px] font-black uppercase hover:bg-amber-200/70 transition-colors"
                                            title={`Ampliar a ${clampNearbyKm(nearbyKmRadius + 5)} km`}
                                        >
                                            +5
                                        </button>
                                        {displayedEmployees.length > 0 && (
                                            <span className="px-1.5 text-[9px] font-black text-amber-800/80" title="Empleados visibles">
                                                {displayedEmployees.length}
                                            </span>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={activateNearbyMode}
                                        title={`Buscar personal a ≤${nearbyKmRadius} km del objetivo`}
                                        className="px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 border transition-colors bg-white border-slate-200 text-slate-500 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700"
                                    >
                                        <EyeOff size={14}/> Dotación
                                    </button>
                                )}
                                {forceShowAll && displayedEmployees.length === 0 && (
                                    <span className="text-[9px] font-bold text-amber-600 max-w-[140px] leading-tight">
                                        Sin personal a ≤{nearbyKmRadius} km
                                    </span>
                                )}

                                {/* ASIGNAR — siempre visible */}
                                <button onClick={() => setShowAddModal(true)} disabled={!selectedObjective || isServiceLocked} className="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50"><UserPlus size={14}/> Asignar</button>

                                {/* PANTALLA COMPLETA — siempre visible */}
                                <button
                                    onClick={() => setCronoFullscreen(v => !v)}
                                    title={cronoFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'}
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                >
                                    {cronoFullscreen ? <Minimize2 size={18}/> : <Maximize size={18}/>}
                                </button>

                                {/* COLAPSAR BARRA — siempre visible */}
                                <button
                                    onClick={() => setToolbarCollapsed(v => {
                                        const next = !v;
                                        if (typeof window !== 'undefined') localStorage.setItem('planif_toolbar_collapsed', next ? '1' : '0');
                                        return next;
                                    })}
                                    title={toolbarCollapsed ? 'Expandir barra de herramientas' : 'Colapsar barra de herramientas'}
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {toolbarCollapsed ? <ChevronsDown size={14}/> : <ChevronsUp size={14}/>}
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* --- ÁREA PRINCIPAL DE LA GRILLA (PLANIFICACIÓN + COMPARACIÓN SPLIT VIEW) --- */}
                <div className={`flex-1 min-h-0 overflow-hidden relative z-0 flex flex-col ${isServiceLocked ? 'opacity-75 grayscale-[0.5] pointer-events-none' : ''}`}>
                    {isProcessing && <div className="absolute inset-0 bg-white/50 z-50 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={40}/></div>}
                    
                    {!selectedObjective ? (
                        <div className="flex flex-col items-center justify-center flex-1 gap-3 select-none">
                            <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center">
                                <Calendar size={32} className="text-slate-300" aria-hidden="true"/>
                            </div>
                            <p className="font-bold text-base text-slate-400">Seleccioná un cliente y objetivo</p>
                            <p className="text-sm text-slate-300">La grilla de planificación aparecerá aquí</p>
                        </div>
                    ) : (
                        <>
                        {(() => {
                            const publishLookupKey = planificacionPublishLookupKey(
                                selectedObjective,
                                currentDate.getFullYear(),
                                currentDate.getMonth() + 1,
                            );
                            const cronogramaPublicado = isPlanificacionPublished(publishStatusMap[publishLookupKey]);
                            if (!cronogramaPublicado || rfzDraftPendientesMes.length === 0) return null;
                            const asignados = rfzDraftPendientesMes.filter(rfz => rfz.employeeId && rfz.employeeId !== 'VACANTE');
                            return (
                                <div className="mx-2 mb-1 flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-black no-print">
                                    <AlertTriangle size={14}/>
                                    {asignados.length > 0
                                        ? `${asignados.length} refuerzo(s) RFZ asignado(s) sin publicar — usá RE-PUBLICAR para notificar a los guardias.`
                                        : `${rfzDraftPendientesMes.length} refuerzo(s) RFZ pendiente(s) — asigná guardia y re-publicá el cronograma.`}
                                </div>
                            );
                        })()}
                        {correctionMode && (
                            <>
                            <div className="mx-2 mb-1 flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-black no-print">
                                <ShieldAlert size={14}/>
                                MODO CORRECCIÓN ACTIVO — Los cambios se guardan directamente sin FT/FF y quedan registrados como corrección de superadmin.
                                <button onClick={() => setCorrectionMode(false)} className="ml-auto underline text-rose-100 hover:text-white">Desactivar</button>
                            </div>
                            {objectiveCoverageGapReport && (
                                <div className="mx-2 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black no-print">
                                    <span className="flex items-center gap-1.5 text-emerald-300">
                                        <ShieldCheck size={12}/> Cierres: {objectiveCoverageGapReport.daysFull} días OK
                                    </span>
                                    {(objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty) > 0 && (
                                        <span className="text-rose-300">
                                            · {objectiveCoverageGapReport.daysPartial + objectiveCoverageGapReport.daysEmpty} con huecos
                                        </span>
                                    )}
                                    {objectiveCoverageGapReport.worstDays.slice(0, 4).map(wd => (
                                        <span key={wd.dateStr} className="text-rose-200 font-bold">
                                            {wd.dateStr.slice(8, 10)}: {wd.closed}/{wd.required}
                                        </span>
                                    ))}
                                    <span className="text-slate-400 font-bold ml-auto hidden sm:inline">Fila «Cobertura» abajo · click celda roja = detalle</span>
                                </div>
                            )}
                            </>
                        )}
                        {comparingSnapshot ? (
                            <div className={`flex h-full min-h-0 gap-1 p-0.5 ${compareLayout === 'side' ? 'flex-col xl:flex-row' : 'flex-col'}`}>
                                <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg border-2 border-amber-400 bg-white">
                                    <div className="shrink-0 px-2 py-0.5 bg-amber-100 border-b border-amber-200 flex items-center justify-between gap-2">
                                        <span className="text-[9px] font-black text-amber-900 uppercase flex items-center gap-1"><History size={10}/> Histórico</span>
                                        <span className="text-[8px] font-bold text-amber-700">Borde ámbar = cambió</span>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                                        {renderGrid(true, comparingSnapshot.data, compareDiffKeys, compareGridEmployees, compareGridOpts)}
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden rounded-lg border-2 border-indigo-500 bg-white">
                                    <div className="shrink-0 px-2 py-0.5 bg-indigo-600 border-b border-indigo-700 flex items-center justify-between gap-2">
                                        <span className="text-[9px] font-black text-white uppercase flex items-center gap-1"><Activity size={10}/> Actual (en vivo)</span>
                                        <span className="text-[8px] font-bold text-indigo-100">Borde violeta = cambió</span>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                                        {renderGrid(false, undefined, compareDiffKeys, compareGridEmployees, compareGridOpts)}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className={`flex-1 min-h-0 overflow-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 transition-opacity duration-150 ${(isFilterPending || isShowAllPending) ? 'opacity-60' : ''} ${correctionMode ? 'pb-2' : ''}`}>
                                {renderGrid(false, undefined, undefined, undefined, correctionMode ? { highlightCoverageFooter: true } : undefined)}
                            </div>
                        )}
                        </>
                    )}
                </div>

                {/* BARRA FLOTANTE */}
                {!comparingSnapshot && !isServiceLocked && (
                    (clipboard !== null) ||
                    (selection.start !== null && (selection.start.r !== selection.end?.r || selection.start.c !== selection.end?.c))
                ) && (
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-white p-2 rounded-xl shadow-2xl flex gap-1 animate-in zoom-in-95 items-center border border-slate-600 no-print">
                        {columnSelectMode ? (
                            <>
                                <span className="text-[10px] font-bold px-2 text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                                    <FastForward size={12}/> Copiar día {columnSelectSource !== null ? daysInMonth[columnSelectSource]?.getDate() : ''} →
                                </span>
                                <button
                                    onClick={applyColumnCopy}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-black text-xs flex items-center gap-1.5 shadow-sm"
                                >
                                    <ArrowRightCircle size={14}/> Pegar en selección
                                </button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => { setSelection({start:null, end:null}); setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false); }} className="p-2 hover:bg-slate-700 rounded-lg"><X size={16}/></button>
                            </>
                        ) : clipboard !== null ? (
                            <>
                                <ClipboardPaste size={14} className="text-emerald-400 ml-1"/>
                                <span className="text-[10px] font-bold px-1 text-emerald-300 uppercase tracking-wider">
                                    Portapapeles {clipboardDim ? `${clipboardDim.rows}×${clipboardDim.cols}` : ''} · se mantiene
                                </span>
                                <button
                                    onClick={() => { if (selection.start) { const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r); const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c); handlePasteAt(minR, minC); } }}
                                    disabled={!selection.start}
                                    title={selection.start ? 'Pegar en la selección (podés repetir)' : 'Seleccioná una celda o rango destino'}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-white font-black text-xs flex items-center gap-1.5 shadow-sm"
                                >
                                    <ArrowRightCircle size={14}/> Pegar aquí
                                </button>
                                <span className="text-[9px] text-slate-400 px-1">Ctrl+V</span>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => { setClipboard(null); setClipboardDim(null); }} className="p-2 hover:bg-slate-700 rounded-lg" title="Vaciar portapapeles"><X size={16}/></button>
                            </>
                        ) : (
                            <>
                                <span className="text-[10px] font-bold px-2 text-slate-300 uppercase tracking-wider">Asignar:</span>
                                {positionStructure.length > 0 && (
                                    <>
                                        {positionStructure.map((p: any) => (
                                            <button
                                                key={`bulkpos_${p.positionName}`}
                                                type="button"
                                                onClick={() => applyBulkPositionFill(p.positionName)}
                                                disabled={isServiceLocked}
                                                title={`Completar selección con puesto ${p.positionName} (${p.qty || 1} pax)`}
                                                className="px-2 h-8 rounded-lg font-black text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400 max-w-[72px] truncate"
                                            >
                                                {abbrevPlanningPositionName(p.positionName, 5)}
                                            </button>
                                        ))}
                                        <div className="h-6 w-px bg-slate-600 mx-0.5" />
                                    </>
                                )}
                                {bulkShifts.map((s: any) => (
                                    <button
                                        key={`${String(s.code || '').toUpperCase()}_${s.positionName || 'any'}`}
                                        onClick={() => applyBulkChange({
                                            code: s.code,
                                            name: s.name,
                                            hours: s.hours,
                                            startTime: s.startTime,
                                            endTime: s.endTime,
                                            positionName: s.positionName || undefined,
                                        })}
                                        disabled={isServiceLocked}
                                        title={s.positionName
                                            ? `${s.code} · puesto ${s.positionName}`
                                            : `${s.code} · se asigna al puesto dueño del turno en el SLA`}
                                        className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle(s.code)}`}
                                    >
                                        {s.code}
                                    </button>
                                ))}
                                <button
                                    onClick={() => applyBulkChange({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', positionName: 'Retén' })}
                                    disabled={isServiceLocked}
                                    title="Retén — guardia disponible sin turno asignado (no suma cobertura SLA)"
                                    className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle('RET') || 'bg-amber-100 text-amber-800 border border-amber-300'}`}
                                >
                                    RET
                                </button>
                                <button onClick={() => applyBulkChange({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' })} disabled={isServiceLocked} className="w-8 h-8 rounded-lg bg-green-500 text-white font-black text-xs border border-green-600">F</button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={handleCopySelection} title="Copiar selección (Ctrl+C)" className="p-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-indigo-200 hover:text-white transition-colors flex items-center gap-1">
                                    <Copy size={14}/><span className="text-[9px] font-bold">Copiar</span>
                                </button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => setShowRRHHModal(true)} disabled={isServiceLocked} className="p-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-white font-bold text-xs flex items-center gap-2 shadow-sm"><FileText size={12}/> +Ausencia</button>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => applyBulkChange(null)} disabled={isServiceLocked} className="p-2 hover:bg-rose-600 rounded-lg text-rose-300 hover:text-white transition-colors" title="Borrar"><Trash2 size={16}/></button>
                                <button onClick={() => setSelection({start:null, end:null})} className="ml-1 p-2 hover:bg-slate-700 rounded-lg"><X size={16}/></button>
                            </>
                        )}
                    </div>
                )}

                {/* RESUMEN DE HORAS PLANIFICADAS */}
                {selectedObjective && !comparingSnapshot && Object.keys(empMonthlyHours).length > 0 && (
                    statsBarCollapsed ? (
                        <div className="rounded-xl border shadow-sm shrink-0 no-print flex items-center justify-between px-3 py-1.5" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><BarChart2 size={11}/> Estadísticas ocultas</span>
                            <button onClick={() => { setStatsBarCollapsed(false); if (typeof window !== 'undefined') localStorage.setItem('planif_stats_collapsed', '0'); }} className="flex items-center gap-1 px-2 py-1 text-[9px] font-black text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-300 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors" title="Mostrar estadísticas"><ChevronUp size={10}/> Mostrar</button>
                        </div>
                    ) : (() => {
                    const sourceHours = hoursMode === 'cct' ? empCctCurrentHours : empMonthlyHours;
                    const totalHrs = Object.values(sourceHours).reduce((a: number, b: any) => a + (b || 0), 0);
                    const nativeAssignedHours = displayedEmployees
                        .filter((emp: any) => isEmployeeNativeToObjective(emp))
                        .reduce((sum: number, emp: any) => sum + (sourceHours[emp.id] || 0), 0);
                    const empCount = planningDotacionEmployees.length;
                    const empCountBillable = objectiveMonthShiftMetrics.empCountBillable;
                    const slaMismatch = slaVendidas > 0 && Math.round(totalHrs) !== Math.round(slaVendidas);
                    const hsLabel = hoursMode === 'cct' ? 'Hs. CCT' : 'Hs. Plan.';
                    const hsTitle = hoursMode === 'cct'
                        ? 'Suma del ciclo CCT actual (cola del mes anterior 26..fin + días 1..25 del mes activo). Solo turnos publicados de este objetivo, sin RET/REF/ESC/francos/licencias.'
                        : 'Suma de horas planificadas en el mes calendario para este objetivo (sin RET, REF, ESC, francos ni licencias). Compará con Vendidas del SLA.';
                    // Extras del mes (RFZ + TURA) de este objetivo — se facturan en CRM aparte del SLA base.
                    const monthPrefixExtras = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                    const extrasList = [
                        ...rfzTodos.filter((r: any) => r.objectiveId === selectedObjective && String(r.fecha || '').startsWith(monthPrefixExtras)),
                        ...Object.values(turaMap).filter((t: any) => t.objectiveId === selectedObjective && String(t.fecha || '').startsWith(monthPrefixExtras)),
                    ];
                    const extrasHrs = extrasList.reduce((a: number, t: any) => a + (Number(t.hours) || 0), 0);
                    const extrasCount = extrasList.length;
                    return (
                    <div className="rounded-xl border shadow-sm shrink-0 no-print px-3 py-2 flex items-center gap-3 divide-x divide-slate-100 dark:divide-slate-700" data-planning-summary-bar style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                        <div className="text-center pr-3" title="Total guardias en dotación activa para este objetivo (sin REF/ESC de reserva).">
                            <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Empl.</p>
                            <p className="text-sm font-black text-slate-700 dark:text-slate-200 leading-tight">{empCount}</p>
                        </div>
                        <div className="text-center px-3" title={hsTitle}>
                            <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none flex items-center justify-center gap-1">
                                {hsLabel}
                                {hoursMode === 'cct' && <span className="text-[7px] text-indigo-500">CCT</span>}
                            </p>
                            <p className={`text-sm font-black leading-tight ${slaMismatch ? 'text-rose-600' : 'text-indigo-600'}`}>{totalHrs.toFixed(0)}</p>
                            {slaMismatch && slaVendidas > 0 && (
                                <p className="text-[8px] font-black text-rose-500 leading-none mt-0.5">
                                    {Math.round(slaVendidas - totalHrs) > 0 ? `−${Math.round(slaVendidas - totalHrs)}h SLA` : `+${Math.round(totalHrs - slaVendidas)}h SLA`}
                                </p>
                            )}
                        </div>
                        {empCountBillable > 0 && (
                            <div className="text-center px-3" title={hoursMode === 'cct' ? 'Promedio de horas por empleado de dotación propia del objetivo en el ciclo CCT (excluye invitados/cobertura externa y guardias solo-RET).' : 'Promedio de horas por empleado de dotación propia del objetivo en el mes (excluye invitados/cobertura externa y guardias solo-RET).'}>
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Prom./Emp.</p>
                                <p className="text-sm font-black text-slate-500 dark:text-slate-300 leading-tight">{Math.round(nativeAssignedHours / empCountBillable)}h</p>
                            </div>
                        )}
                        {retCount > 0 && (
                            <div className="text-center px-3" title="Días RET: guardia sobrante en el objetivo (0 h planificadas/liquidables). Disponible para cubrir otro servicio.">
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Retenes</p>
                                <p className="text-sm font-black text-amber-600 leading-tight">{retCount} <span className="text-[9px] text-amber-500 font-bold">días</span></p>
                            </div>
                        )}
                        {retBufferHours > 0 && (
                            <div className="text-center px-3" title="Colchón teórico: suma de horas que cabrían promoviendo cada RET a ~8h facturables sin pasar 200h/mes por persona (cupo calendario). No implica que exista alguien libre en la banda correcta ni que el convenio deje ese swap: la Verificación mira slots, descansos 12h/35h y licencias.">
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Colchón</p>
                                <p className="text-sm font-black text-emerald-600 leading-tight">{retBufferHours}h</p>
                            </div>
                        )}
                        {autoV2GenStats && autoCycles.length > 0 && (
                            <div className="text-center px-3" title="Esquema(s) de ciclo aplicados en la generación automática.">
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Esquema</p>
                                <p className="text-sm font-black text-slate-600 dark:text-slate-300 leading-tight">{autoCycles.join(' · ')}</p>
                            </div>
                        )}
                        {autoV2GenStats?.excessPositionEmployees && autoV2GenStats.excessPositionEmployees.length > 0 && (
                            <div
                                className="text-center px-3 cursor-default"
                                title={autoV2GenStats.excessPositionEmployees.map(e => `${e.positionName}: ${e.assigned} asignados, necesita ${e.needed} (sobran ${e.excess})`).join('\n')}
                            >
                                <p className="text-[8px] font-black text-amber-500 uppercase leading-none">Personal</p>
                                <p className="text-sm font-black text-amber-600 leading-tight">
                                    +{autoV2GenStats.excessPositionEmployees.reduce((s, e) => s + e.excess, 0)} extra
                                </p>
                            </div>
                        )}
                        {autoV2GenStats && (
                            <button
                                onClick={() => setShowCapacityModal(true)}
                                className="text-center px-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded transition-colors"
                                title="Ver capacidad CCT por empleado: cuánto consumió cada uno del ciclo CCT (corte 25/26) en current y next."
                            >
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Cap. CCT</p>
                                <p className="text-sm font-black text-indigo-600 leading-tight underline decoration-dotted">Ver</p>
                            </button>
                        )}
                        {extrasCount > 0 && (
                            <div className="text-center px-3" title={`Refuerzos del mes (RFZ + TURA) de este objetivo: ${extrasCount} turno(s), ${extrasHrs.toFixed(0)}h. Se facturan en CRM/pre-factura aparte de las horas vendidas del SLA base; no entran en la validación de publicación.`}>
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Extras</p>
                                <p className="text-sm font-black text-rose-600 leading-tight">+{extrasHrs.toFixed(0)}h</p>
                                <p className="text-[8px] font-bold text-rose-400 leading-none mt-0.5">{extrasCount} ref.</p>
                            </div>
                        )}
                        {slaVendidas > 0 && (
                            <div className={`text-center pl-3 ${slaMismatch ? 'rounded-lg bg-rose-50 px-2 py-0.5' : ''}`}>
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Vendidas</p>
                                <p className="text-sm font-black text-teal-600 leading-tight">{slaVendidas}</p>
                            </div>
                        )}
                        <button onClick={() => { setStatsBarCollapsed(true); if (typeof window !== 'undefined') localStorage.setItem('planif_stats_collapsed', '1'); }} className="shrink-0 ml-2 flex items-center gap-1 px-2 py-1 text-[9px] font-black text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors" title="Ocultar estadísticas"><ChevronDown size={10}/></button>
                    </div>
                    );
                    })() )}

                {!comparingSnapshot && !statsBarCollapsed && (
                <div className="hidden lg:block rounded-xl border shadow-sm shrink-0 no-print overflow-hidden" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                    {/* Barra de título — siempre visible, clic abre el modal */}
                    <button
                        onClick={() => setShowActivityModal(true)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                        <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2">
                            <Clock size={11}/> Actividad Reciente
                            {unifiedLogs.length > 0 && (
                                <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded text-[9px]">{unifiedLogs.length}</span>
                            )}
                        </span>
                        <Maximize2 size={10} className="text-slate-400"/>
                    </button>
                    {/* Notificación de nueva actividad — aparece 60 s y luego se cierra */}
                    {latestLog && (
                        <div
                            className="border-t border-slate-100 dark:border-slate-700 px-3 py-1.5 flex items-center gap-2 text-[10px] cursor-pointer hover:bg-indigo-50 dark:hover:bg-slate-700 animate-in slide-in-from-bottom-1 transition-colors"
                            onClick={() => setShowActivityModal(true)}
                        >
                            <span className="font-mono text-slate-400 shrink-0">{new Date(latestLog.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            <span className="font-black uppercase bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded shrink-0">{latestLog.label}</span>
                            <span className="text-slate-600 dark:text-slate-300 truncate flex-1">{latestLog.detail}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); setLatestLog(null); if (latestLogTimer.current) clearTimeout(latestLogTimer.current); }}
                                className="shrink-0 text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-200"
                                title="Cerrar"
                            >
                                <X size={10}/>
                            </button>
                        </div>
                    )}
                </div>
                )}

                {showCompareDiffModal && comparingSnapshot && (
                    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowCompareDiffModal(false)}>
                        <div className="bg-white w-full max-w-2xl max-h-[75vh] rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-3 border-b bg-slate-50 flex justify-between items-center gap-2">
                                <h3 className="font-black text-sm flex items-center gap-2"><ArrowLeftRight className="text-indigo-600" size={16}/> Diferencias · histórico → actual</h3>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${planningCompareDiff?.changedCount ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                        {planningCompareDiff?.changedCount ?? 0} celda(s)
                                    </span>
                                    <button onClick={() => setShowCompareDiffModal(false)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={16}/></button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 text-[11px] space-y-1">
                                {!planningCompareDiff?.changedCount ? (
                                    <p className="text-emerald-700 font-bold py-4 text-center">Sin diferencias: la versión actual coincide con el snapshot.</p>
                                ) : planningCompareDiff.cells.map((c) => {
                                    const emp = displayedEmployees.find((e: { id: string }) => e.id === c.empId);
                                    const label = emp?.name || c.empId.slice(0, 8);
                                    const arrow = c.histLabel && c.currentLabel ? `${c.histLabel} → ${c.currentLabel}` : c.currentLabel ? `∅ → ${c.currentLabel}` : `${c.histLabel} → ∅`;
                                    return (
                                        <div key={c.key} className="flex justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0">
                                            <span className="truncate font-bold text-slate-800">{label} · {c.date.split('-').reverse().join('/')}</span>
                                            <span className="shrink-0 font-mono text-indigo-700">{arrow}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {showCompareSummaryModal && selectedObjective && Object.keys(empMonthlyHours).length > 0 && (() => {
                    const sourceHours = hoursMode === 'cct' ? empCctCurrentHours : empMonthlyHours;
                    const totalHrs = Object.values(sourceHours).reduce((a: number, b: any) => a + (b || 0), 0);
                    const nativeAssignedHours = displayedEmployees
                        .filter((emp: any) => isEmployeeNativeToObjective(emp))
                        .reduce((sum: number, emp: any) => sum + (sourceHours[emp.id] || 0), 0);
                    const empCount = planningDotacionEmployees.length;
                    const empCountBillable = objectiveMonthShiftMetrics.empCountBillable;
                    const slaMismatch = slaVendidas > 0 && Math.round(totalHrs) !== Math.round(slaVendidas);
                    const hsLabel = hoursMode === 'cct' ? 'Hs. CCT' : 'Hs. Plan.';
                    return (
                    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowCompareSummaryModal(false)}>
                        <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
                                <h3 className="font-black text-sm flex items-center gap-2"><BarChart3 className="text-indigo-600" size={16}/> Resumen del mes</h3>
                                <button onClick={() => setShowCompareSummaryModal(false)} className="p-1.5 hover:bg-slate-200 rounded-lg"><X size={16}/></button>
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-3 text-center">
                                <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">Empleados</p><p className="text-xl font-black text-slate-800">{empCount}</p></div>
                                <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">{hsLabel}</p><p className={`text-xl font-black ${slaMismatch ? 'text-rose-600' : 'text-indigo-600'}`}>{totalHrs.toFixed(0)}</p></div>
                                {empCountBillable > 0 && <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">Prom./Emp.</p><p className="text-xl font-black text-slate-600">{Math.round(nativeAssignedHours / empCountBillable)}h</p></div>}
                                {slaVendidas > 0 && <div className="rounded-lg border p-3"><p className="text-[9px] font-black text-slate-400 uppercase">Vendidas SLA</p><p className="text-xl font-black text-teal-600">{slaVendidas}</p></div>}
                            </div>
                            <p className="px-4 pb-4 text-[10px] text-slate-500">Snapshot: {compareSnapshotLabel} · {planningCompareDiff?.changedCount ?? 0} celda(s) distinta(s) vs actual.</p>
                        </div>
                    </div>
                    );
                })()}

                {showActivityModal && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowActivityModal(false)}>
                        <div className="bg-white w-full max-w-3xl h-[80vh] rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                                <h3 className="font-black text-lg flex items-center gap-2"><Clock className="text-indigo-600" size={18}/> Actividad Reciente</h3>
                                {empresaId && (
                                    <p className="text-[10px] font-bold text-slate-500 mt-0.5">Empresa: {(empresa as any)?.nombre || empresaId}</p>
                                )}
                                <button onClick={() => setShowActivityModal(false)} className="p-2 hover:bg-slate-200 rounded-lg"><X size={18}/></button>
                            </div>
                            {/* Tabs */}
                            <div className="flex border-b bg-white px-4 gap-1 pt-2">
                                <button
                                    onClick={() => setActivityTab('cambios')}
                                    className={`px-4 py-2 text-xs font-black uppercase rounded-t-lg transition-colors ${activityTab === 'cambios' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    Cambios cronograma {unifiedLogs.length > 0 && <span className="ml-1 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[9px]">{unifiedLogs.length}</span>}
                                </button>
                                <button
                                    onClick={() => setActivityTab('notifs')}
                                    className={`px-4 py-2 text-xs font-black uppercase rounded-t-lg transition-colors flex items-center gap-1 ${activityTab === 'notifs' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    <Bell size={11}/> Notificaciones
                                    {notifLogs.filter(n => !n.read).length > 0 && <span className="ml-1 bg-rose-500 text-white px-1.5 py-0.5 rounded-full text-[9px]">{notifLogs.filter(n => !n.read).length} sin leer</span>}
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                                {activityTab === 'cambios' ? (
                                    unifiedLogs.length === 0 ? (
                                        <div className="text-sm text-slate-400 italic">Sin actividad reciente.</div>
                                    ) : (
                                        unifiedLogs.map((log) => {
                                            const realName = usersMap[log.actorUid] || usersMap[log.actorEmail] || usersMap[log.actorName] || usersMap[log.actor] || log.actorName || log.actor || 'Sistema';
                                            return (
                                                <div key={log.id} className="p-3 border rounded-xl hover:bg-slate-50 transition-colors">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                                            <span className="text-xs font-mono text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                                                            <span className="text-[10px] font-black uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded border">{log.label}</span>
                                                            {log.objectiveName && (
                                                                <span className="text-[10px] font-bold text-indigo-600 truncate max-w-[140px]">{log.objectiveName}</span>
                                                            )}
                                                            <span className="text-xs text-slate-700 truncate">{log.detail}</span>
                                                        </div>
                                                        <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">{realName}</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )
                                ) : (
                                    notifLogs.length === 0 ? (
                                        <div className="text-sm text-slate-400 italic">Sin notificaciones recientes.</div>
                                    ) : (
                                        notifLogs.map((n) => {
                                            const emp = employees.find(e => e.id === n.employeeId);
                                            const empName = emp?.name || n.employeeId;
                                            const typeColors: Record<string, string> = {
                                                TURNO_NUEVO: 'bg-indigo-100 text-indigo-700',
                                                TURNO_MODIFICADO: 'bg-amber-100 text-amber-700',
                                                TURNO_ELIMINADO: 'bg-rose-100 text-rose-700',
                                                FRANCO_ASIGNADO: 'bg-emerald-100 text-emerald-700',
                                            };
                                            const typeLabel: Record<string, string> = {
                                                TURNO_NUEVO: 'Nuevo turno',
                                                TURNO_MODIFICADO: 'Modificado',
                                                TURNO_ELIMINADO: 'Eliminado',
                                                FRANCO_ASIGNADO: 'Franco',
                                            };
                                            return (
                                                <div key={n.id} className={`p-3 border rounded-xl transition-colors ${n.read ? 'bg-white' : 'bg-indigo-50 border-indigo-200'}`}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex items-start gap-2 min-w-0 flex-1">
                                                            <div className="mt-0.5 shrink-0">
                                                                {n.read
                                                                    ? <CheckCircle size={14} className="text-emerald-500"/>
                                                                    : <Bell size={14} className="text-indigo-500"/>
                                                                }
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${typeColors[n.type] || 'bg-slate-100 text-slate-600'}`}>
                                                                        {typeLabel[n.type] || n.type}
                                                                    </span>
                                                                    <span className="text-xs font-bold text-slate-700">{empName}</span>
                                                                </div>
                                                                <p className="text-xs text-slate-600 truncate">{n.body}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <p className="text-[10px] font-mono text-slate-400">{new Date(n.timestamp).toLocaleString()}</p>
                                                            {n.read && n.readAt && (
                                                                <p className="text-[9px] text-emerald-600 font-bold mt-0.5">
                                                                    ✓ Leído {new Date(n.readAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                                                </p>
                                                            )}
                                                            {!n.read && (
                                                                <p className="text-[9px] text-indigo-500 font-bold mt-0.5">Sin leer</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* MODALES Y MENÚS DE CONTEXTO (V9.10 - EXPANDIDOS Y ORDENADOS) */}

                {/* 1. MODAL SELECTOR DE TURNOS */}
                {selectedCell && !showConflictModal && !showSwapModal && !showRRHHModal && !showVacancyModal && !pendingAssignment && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedCell(null)}>
                        <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-[540px] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                            {(() => {
                                const employeeName = employees.find(e => e.id === selectedCell.empId)?.name || 'Empleado';
                                const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
                                const pending = pendingChanges[key];
                                const shift = selectedCell.currentShift;
                                const absence = selectedCell.absence;
                                const code = String(shift?.code || shift?.type || '').toUpperCase();
                                const isConsolidated = isShiftConsolidated(shift);
                                const isRRHHCode = ['V', 'L', 'PG', 'A', 'E', 'AA'].includes(code);
                                const isPastClosed = isPlanningDateLocked(selectedCell.dateStr);
                                const objectiveId = (shift?.objectiveId || selectedObjective || '').toString();
                                const serviceName = shift?.objectiveName || (objectiveId ? getObjectiveName(objectiveId) : '-');
                                const coveredPosition = (shift?.positionName || activePosition || 'General').toString();
                                const NON_ABSENCE_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'PU', 'GU', 'EN', 'FT', 'RET', 'REF', 'ESC', 'C']);
                                const resolveCoverageForAbsence = () => {
                                    const empName = employees.find(e => e.id === selectedCell.empId)?.name || '';
                                    const dateStr = selectedCell.dateStr;
                                    const allSources = { ...shiftsMap, ...pendingChanges };
                                    for (const [k, raw] of Object.entries(allSources)) {
                                        if (!k.endsWith(`_${dateStr}`) || k.startsWith(`${selectedCell.empId}_`)) continue;
                                        const s = raw as any;
                                        if (s?.isDeleted) continue;
                                        if (s?.comments?.includes(`Cubriendo a ${empName}`)) {
                                            const covEmpId = k.replace(`_${dateStr}`, '');
                                            const covEmp = employees.find((e: any) => e.id === covEmpId);
                                            const covCode = String(s.code || '').toUpperCase();
                                            return {
                                                employeeName: covEmp?.name || '—',
                                                code: covCode,
                                                shift: s,
                                                objectiveName: s.objectiveName || (s.objectiveId ? getObjectiveName(s.objectiveId) : serviceName),
                                            };
                                        }
                                    }
                                    const coveredByRaw = shift?.coveredBy || pending?.coveredBy;
                                    if (coveredByRaw) {
                                        const nameOnly = String(coveredByRaw).replace(/\s*\([^)]*\)\s*$/, '').trim();
                                        return { employeeName: nameOnly, code: '', shift: null, objectiveName: serviceName };
                                    }
                                    return null;
                                };
                                const coverageInfo = (absence || isRRHHCode) ? resolveCoverageForAbsence() : null;
                                const ABSENCE_FRANCO_CODES = new Set(['F', 'FF', 'FP', 'V', 'L', 'PG', 'A', 'E', 'AA']);
                                const isWorkCode = (c: string) => !!c && !ABSENCE_FRANCO_CODES.has(c.toUpperCase());
                                const resolveOriginalWorkShift = () => {
                                    if (coverageInfo?.shift && coverageInfo.code && NON_ABSENCE_CODES.has(coverageInfo.code)) {
                                        const h = Number(coverageInfo.shift.hours) || SHIFT_HOURS_LOOKUP[coverageInfo.code] || 8;
                                        return {
                                            code: coverageInfo.code,
                                            label: LEGEND_DESCRIPTIONS[coverageInfo.code] || coverageInfo.code,
                                            schedule: formatShiftScheduleLabel(coverageInfo.shift, coverageInfo.code),
                                            hours: h,
                                            service: coverageInfo.objectiveName || serviceName,
                                            position: coverageInfo.shift.positionName || coveredPosition,
                                        };
                                    }
                                    const pendingTitular = pending && !pending.isDeleted ? pending : null;
                                    if (pendingTitular?.coveredBy && code && NON_ABSENCE_CODES.has(code)) {
                                        const h = Number(pendingTitular.hours) || SHIFT_HOURS_LOOKUP[code] || 8;
                                        return {
                                            code,
                                            label: LEGEND_DESCRIPTIONS[code] || code,
                                            schedule: formatShiftScheduleLabel(pendingTitular, code),
                                            hours: h,
                                            service: serviceName,
                                            position: coveredPosition,
                                        };
                                    }
                                    // Fallback: el turno planificado del empleado ese día (ya disponible en `shift`)
                                    const shiftCode = String(shift?.code || '').toUpperCase();
                                    if (shift && isWorkCode(shiftCode)) {
                                        const h = Number(shift.hours) || SHIFT_HOURS_LOOKUP[shiftCode] || 8;
                                        return {
                                            code: shiftCode,
                                            label: LEGEND_DESCRIPTIONS[shiftCode] || shiftCode,
                                            schedule: formatShiftScheduleLabel(shift, shiftCode),
                                            hours: h,
                                            service: serviceName,
                                            position: shift.positionName || coveredPosition,
                                        };
                                    }
                                    return null;
                                };
                                const originalWorkShift = (absence || isRRHHCode) ? resolveOriginalWorkShift() : null;
                                const absenceTypeLabel = absence?.type || shift?.name || LEGEND_DESCRIPTIONS[code] || code || '—';
                                const ABSENCE_STATUS_ES: Record<string, string> = {
                                    APPROVED: 'Aprobada', PENDING: 'Pendiente', REJECTED: 'Rechazada',
                                    ACTIVE: 'Activa', CLOSED: 'Cerrada', REGISTERED: 'Registrada',
                                    VERIFIED: 'Verificada', JUSTIFIED: 'Justificada',
                                };
                                // Ausencias injustificadas/sin aviso: el estado APPROVED significa "registrada por RRHH",
                                // no que la ausencia fue aprobada — se muestra "Registrada" para no confundir.
                                const UNEXCUSED_CODES = new Set(['AA']);
                                const absenceRawStatus = absence?.status || (isRRHHCode ? 'APPROVED' : '');
                                const isUnexcused = UNEXCUSED_CODES.has(code) || absence?.type?.toLowerCase().includes('injustificada');
                                const absenceStatusLabel = (isUnexcused && absenceRawStatus?.toUpperCase() === 'APPROVED')
                                    ? 'Registrada'
                                    : (ABSENCE_STATUS_ES[absenceRawStatus?.toUpperCase?.()] || absenceRawStatus || '');
                                const coveringEmployee = coverageInfo
                                    ? (coverageInfo.code ? `${coverageInfo.employeeName} (${coverageInfo.code})` : coverageInfo.employeeName)
                                    : (shift?.coveredBy || pending?.coveredBy || null);
                                const hasSwap = !!(shift?.swapWith || shift?.swapDate);
                                const isSwapPersisted = hasSwap && !pending && !!shift?.id;
                                const showRrhhPanel = !!(absence || isRRHHCode);
                                const isReadOnly = isConsolidated || isSwapPersisted;

                                const plannedStart =
                                    (typeof shift?.startTime === 'string') ? shift.startTime
                                    : (shift?.startTime ? formatTime(shift.startTime) : '--:--');
                                const plannedEnd =
                                    (typeof shift?.endTime === 'string') ? shift.endTime
                                    : (shift?.endTime ? formatTime(shift.endTime) : '--:--');
                                const realStart = shift?.realStartTime ? formatTime(shift.realStartTime) : (shift?.checkInTime ? formatTime(shift.checkInTime) : '--:--');
                                const realEnd = shift?.realEndTime ? formatTime(shift.realEndTime) : (shift?.checkOutTime ? formatTime(shift.checkOutTime) : '--:--');
                                const rawStatus = (shift?.status || '').toString().toUpperCase();
                                const STATUS_LABELS: Record<string, string> = { PRESENT: 'Presente', COMPLETED: 'Completado', ABSENT: 'Ausente', LATE: 'Tarde', INTERRUPTED: 'Interrumpido', PENDING: 'Pendiente' };
                                const status = STATUS_LABELS[rawStatus] || rawStatus || '-';
                                const storedHours = Number(shift?.hours);
                                const calcHoursFromTs = (shift?.startTime && shift?.endTime && typeof shift.startTime !== 'string')
                                    ? Math.max(0, (formatTime(shift.endTime) !== '--:--' ? (shift.endTime.toDate ? shift.endTime.toDate().getTime() : new Date(shift.endTime.seconds * 1000).getTime()) - (shift.startTime.toDate ? shift.startTime.toDate().getTime() : new Date(shift.startTime.seconds * 1000).getTime()) : 0)) / 3600000
                                    : 0;
                                const hours = storedHours || calcHoursFromTs || (code ? (SHIFT_HOURS_LOOKUP[code] || 0) : 0);
                                const showRealTimes = isConsolidated;

                                if (isReadOnly || showRrhhPanel) {
                                    return (
                                        <>
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="min-w-0">
                                                    <h3 className="font-black text-lg text-slate-800 truncate">{employeeName}</h3>
                                                    <p className="text-xs text-slate-500 font-bold uppercase">{selectedCell.dateStr}</p>
                                                    <div className="mt-2 flex items-center gap-2">
                                                        {isConsolidated && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                                Consolidado
                                                            </span>
                                                        )}
                                                        {isPastClosed && !isConsolidated && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                                                                Cerrado
                                                            </span>
                                                        )}
                                                        {isSwapPersisted && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-cyan-50 text-cyan-800 border-cyan-200">
                                                                Intercambio
                                                            </span>
                                                        )}
                                                        {(absence || isRRHHCode) && (
                                                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
                                                                RRHH
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button onClick={() => setSelectedCell(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
                                            </div>

                                            <div className="space-y-3">
                                                {(absence || isRRHHCode) ? (
                                                    <div className="rounded-xl border-2 border-amber-200 bg-white overflow-hidden shadow-sm">
                                                        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
                                                            <span className="text-[10px] font-black uppercase tracking-wide text-amber-900">Novedad RRHH</span>
                                                            {absenceStatusLabel && (
                                                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border shrink-0 ${absenceStatusBadgeClass(absenceStatusLabel)}`}>
                                                                    {absenceStatusLabel}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="p-4 space-y-4">
                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">1 · Turno que tenía</p>
                                                                {originalWorkShift ? (
                                                                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            <span className="font-mono font-black text-sm text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{originalWorkShift.code}</span>
                                                                            <span className="text-sm font-bold text-slate-800">{originalWorkShift.label}</span>
                                                                            {originalWorkShift.hours > 0 && (
                                                                                <span className="text-xs font-mono text-slate-500">{originalWorkShift.hours}h</span>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-xs font-mono text-slate-600 mt-1.5">{originalWorkShift.schedule}</p>
                                                                        <p className="text-xs text-slate-500 mt-1">
                                                                            {originalWorkShift.service}
                                                                            {originalWorkShift.position && originalWorkShift.position !== 'General' && (
                                                                                <span className="text-slate-400"> · {originalWorkShift.position}</span>
                                                                            )}
                                                                        </p>
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-sm text-slate-400 italic">Sin turno de trabajo asignado ese día</p>
                                                                )}
                                                            </div>

                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">2 · Estado</p>
                                                                <span className={`inline-flex text-xs font-black px-3 py-1.5 rounded-lg border ${absenceStatusBadgeClass(absenceStatusLabel)}`}>
                                                                    {absenceStatusLabel || '—'}
                                                                </span>
                                                            </div>

                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">3 · Tipo de novedad</p>
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <span className="text-sm font-black text-slate-800">{absenceTypeLabel}</span>
                                                                    {code && (
                                                                        <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">{code}</span>
                                                                    )}
                                                                </div>
                                                                {absence?.reason && (
                                                                    <p className="text-xs text-amber-800/80 mt-1.5 font-medium">{absence.reason}</p>
                                                                )}
                                                            </div>

                                                            <div>
                                                                <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">4 · Cubierto por</p>
                                                                {coverageInfo?.employeeName ? (
                                                                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                                                                        <p className="text-sm font-black text-emerald-900">{coverageInfo.employeeName}</p>
                                                                        {coverageInfo.code && (
                                                                            <p className="text-xs text-emerald-700 mt-0.5">
                                                                                Turno asignado: <span className="font-mono font-bold">{coverageInfo.code}</span>
                                                                                {coverageInfo.shift && (
                                                                                    <span className="text-emerald-600/80"> · {formatShiftScheduleLabel(coverageInfo.shift, coverageInfo.code)}</span>
                                                                                )}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <p className="text-sm text-amber-700 font-bold">Sin cobertura asignada</p>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {pending ? (
                                                            <div className="px-4 pb-4">
                                                                <button onClick={handleDelete} className="w-full py-2 rounded-xl bg-white border border-amber-200 text-amber-900 font-black text-xs hover:bg-amber-100">
                                                                    Quitar marca (borrador)
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            coverageInfo?.employeeName ? (
                                                                <p className="px-4 pb-3 text-[10px] font-bold text-emerald-700 text-center">
                                                                    Licencia cubierta — en reportes/liquidación figura como novedad RRHH; las horas del puesto las computa {coverageInfo.employeeName}.
                                                                </p>
                                                            ) : (
                                                                <p className="px-4 pb-3 text-[10px] font-bold text-amber-800/80 text-center">
                                                                    Novedad RRHH — podés re-procesar cobertura abajo si el día no está consolidado.
                                                                </p>
                                                            )
                                                        )}
                                                        {isRRHHCode && !isConsolidated && !pending && absence && (
                                                            <div className="px-4 pb-4">
                                                                <button
                                                                    onClick={() => {
                                                                        const vd = { ...absence, source: 'AUSENCIA', employeeId: selectedCell.empId, employeeName, focusDate: selectedCell.dateStr };
                                                                        setSelectedCell(null);
                                                                        setVacancyData(vd);
                                                                        setShowVacancyModal(true);
                                                                    }}
                                                                    className="w-full py-2.5 rounded-xl bg-amber-600 text-white font-black text-xs hover:bg-amber-700"
                                                                >
                                                                    Re-procesar cobertura
                                                                </button>
                                                            </div>
                                                        )}
                                                        {isRRHHCode && !isConsolidated && !pending && !absence && (
                                                            <div className="px-4 pb-4">
                                                                <button
                                                                    onClick={() => {
                                                                        const newChanges = { ...pendingChanges };
                                                                        newChanges[`${selectedCell.empId}_${selectedCell.dateStr}`] = { isDeleted: true };
                                                                        setPendingChanges(newChanges);
                                                                        setSelectedCell(null);
                                                                        toast.info('Turno marcado para borrar — guardá los cambios.');
                                                                    }}
                                                                    className="w-full py-2.5 rounded-xl bg-slate-600 text-white font-black text-xs hover:bg-slate-700"
                                                                >
                                                                    Borrar turno asignado por error
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <>
                                                <div className="p-3 rounded-xl border bg-slate-50">
                                                    <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Planificado (Planificador)</div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        <div className="font-bold text-slate-600">Cubrió</div>
                                                        <div className="text-slate-800 font-bold">
                                                            <span className="font-mono">{code || '-'}</span>
                                                            <span className="mx-2 text-slate-300">|</span>
                                                            <span>{coveredPosition}</span>
                                                        </div>
                                                        <div className="font-bold text-slate-600">Servicio</div>
                                                        <div className="text-slate-800">{serviceName || '-'}</div>
                                                        <div className="font-bold text-slate-600">Horario</div>
                                                        <div className="font-mono text-slate-800">{plannedStart} - {plannedEnd}</div>
                                                        <div className="font-bold text-slate-600">Horas</div>
                                                        <div className="font-mono text-slate-800">{hours ? `${hours}h` : '-'}</div>
                                                    </div>
                                                </div>

                                                <div className="p-3 rounded-xl border bg-white">
                                                    <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Real / Estado</div>
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        <div className="font-bold text-slate-600">Estado</div>
                                                        <div className="font-mono text-slate-800">{status || '-'}</div>
                                                        <div className="font-bold text-slate-600">Ingreso</div>
                                                        <div className="font-mono text-slate-800">{showRealTimes ? realStart : '--:--'}</div>
                                                        <div className="font-bold text-slate-600">Egreso</div>
                                                        <div className="font-mono text-slate-800">{showRealTimes ? realEnd : '--:--'}</div>
                                                    </div>
                                                </div>
                                                    </>
                                                )}

                                                {isConsolidated && (absence || isRRHHCode) && (
                                                    <div className="p-3 rounded-xl border bg-white">
                                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Fichada real</div>
                                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                                            <div className="font-bold text-slate-600">Estado ops.</div>
                                                            <div className="font-mono text-slate-800">{status || '-'}</div>
                                                            <div className="font-bold text-slate-600">Ingreso</div>
                                                            <div className="font-mono text-slate-800">{realStart}</div>
                                                            <div className="font-bold text-slate-600">Egreso</div>
                                                            <div className="font-mono text-slate-800">{realEnd}</div>
                                                        </div>
                                                    </div>
                                                )}

                                                {hasSwap && (
                                                    <div className="p-3 rounded-xl border bg-cyan-50 border-cyan-200">
                                                        <div className="text-[10px] font-black uppercase text-cyan-800 mb-2">Intercambio / Enroque</div>
                                                        <div className="text-xs text-cyan-900 font-bold">
                                                            {shift?.swapWith ? <>Con: <span className="font-black">{shift.swapWith}</span></> : '—'}
                                                            {shift?.swapDate ? <span className="ml-2 font-mono">({shift.swapDate})</span> : null}
                                                        </div>
                                                        <div className="text-[10px] text-cyan-800 mt-1">
                                                            {shift?.isFrancoCompensatorio ? 'FxF (Franco Compensatorio / FF)' : (shift?.isSwap ? 'Swap' : '')}
                                                        </div>
                                                    </div>
                                                )}

                                                <button onClick={() => setSelectedCell(null)} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-xs hover:bg-slate-800">
                                                    Cerrar
                                                </button>
                                            </div>
                                        </>
                                    );
                                }

                                // Horas de descanso del franco (disponible en todos los branches del modal)
                                const modalFrancoCode = String(shift?.code || pending?.code || '').toUpperCase();
                                const modalIsFranco = ['F','FF','FP','FT'].includes(modalFrancoCode) || !!shift?.isFranco || !!pending?.isFranco;
                                const francoRestHModal = modalIsFranco ? (() => {
                                    try {
                                        const [yr, mo, dy] = selectedCell.dateStr.split('-').map(Number);
                                        const di = daysInMonth.findIndex((d: Date) =>
                                            d.getFullYear() === yr && d.getMonth() + 1 === mo && d.getDate() === dy
                                        );
                                        return di >= 0 ? calcFrancoRestHours(selectedCell.empId, di) : null;
                                    } catch { return null; }
                                })() : null;

                                // Vista previa: celda con turno asignado, sin cambios pendientes y sin modo edición activo
                                const hasPendingForCell = !!pending && !pending.isDeleted;
                                const previewPublishKey = planificacionPublishLookupKey(
                                    selectedObjective,
                                    currentDate.getFullYear(),
                                    currentDate.getMonth() + 1,
                                );
                                const previewIsPublished = isPlanificacionPublished(publishStatusMap[previewPublishKey]);
                                // Puede editar si: no está publicado, o está en modo corrección (superadmin)
                                const canEdit = !previewIsPublished || correctionMode;

                                if (shift && !cellEditMode && !hasPendingForCell) {
                                    const shiftStyle = SHIFT_STYLES[code] || 'bg-slate-100 text-slate-700 border-slate-200';
                                    const isFrancoShift = shift.code === 'F' || shift.isFranco;
                                    const isFrancoLike = isFrancoShift || ['F','FF','FP','FT'].includes(code);
                                    const francoRestH = francoRestHModal;
                                    const hasDraft = shift.draft === true;
                                    return (
                                        <>
                                            <div className="flex justify-between items-start mb-5">
                                                <div>
                                                    <h3 className="font-black text-lg text-slate-800">{employeeName}</h3>
                                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{selectedCell.dateStr}</p>
                                                </div>
                                                <button onClick={() => setSelectedCell(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
                                            </div>

                                            {/* Badge principal del turno */}
                                            <div className={`flex items-center gap-3 p-4 rounded-xl border mb-4 ${shiftStyle}`}>
                                                <span className="text-3xl font-black">{code || '—'}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-black text-base leading-tight">{shift.type || shift.name || (isFrancoShift ? 'Franco' : code)}</p>
                                                    {!isFrancoShift && (
                                                        <p className="text-xs font-bold opacity-70">{plannedStart} – {plannedEnd} · {hours > 0 ? `${hours}h` : ''}</p>
                                                    )}
                                                    {isFrancoShift && <p className="text-xs font-bold opacity-70">Día libre</p>}
                                                </div>
                                                {hasDraft && (
                                                    <span className="text-[9px] font-black uppercase bg-white/60 border border-current px-2 py-0.5 rounded-lg opacity-80">Borrador</span>
                                                )}
                                                {previewIsPublished && !hasDraft && (
                                                    <span className="text-[9px] font-black uppercase bg-white/60 border border-current px-2 py-0.5 rounded-lg opacity-80 flex items-center gap-1"><CheckCircle size={9}/> Publicado</span>
                                                )}
                                            </div>

                                            {/* TURA — turno agregado por cliente */}
                                            {turaMap[shift.id] && (() => {
                                                const tura = turaMap[shift.id];
                                                const tStart = tura.startTime ? formatTime(tura.startTime) : '--:--';
                                                const tEnd   = tura.endTime   ? formatTime(tura.endTime)   : '--:--';
                                                const tHours = Number(tura.hours) > 0 ? Number(tura.hours) : (SHIFT_HOURS_LOOKUP['TURA'] ?? 8);
                                                const tHoursLabel = Number.isInteger(tHours) ? `${tHours}` : tHours.toFixed(1);
                                                return (
                                                    <div className="flex items-start gap-3 p-3 rounded-xl border border-red-200 bg-red-50 mb-4">
                                                        <span className="shrink-0 text-[10px] font-black text-white bg-red-500 px-2 py-1 rounded-lg">TURA</span>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-black text-red-700 leading-tight">Turno Agregado — pedido del cliente</p>
                                                            <p className="text-[11px] text-red-500 font-bold">{tStart} – {tEnd} · {tHoursLabel}h</p>
                                                            {tura.autorizadoPorNombre && (
                                                                <p className="text-[10px] text-red-400 font-bold mt-0.5">Autorizó: {tura.autorizadoPorNombre}</p>
                                                            )}
                                                            {tura.solicitadoPorNombre && (
                                                                <p className="text-[10px] text-red-400 font-bold">Solicitó: {tura.solicitadoPorNombre}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                            {/* RFZ — refuerzo de cliente asignado a este guardia */}
                                            {code === 'RFZ' && (
                                                <div className="flex items-start gap-3 p-3 rounded-xl border border-red-200 bg-red-50 mb-4">
                                                    <span className="shrink-0 text-[10px] font-black text-white bg-red-500 px-2 py-1 rounded-lg">RFZ</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-black text-red-700 leading-tight">Refuerzo solicitado por cliente</p>
                                                        <p className="text-[11px] text-red-500 font-bold">{plannedStart} – {plannedEnd} · {hours > 0 ? `${hours}h` : ''}</p>
                                                        {shift?.autorizadoPorNombre && (
                                                            <p className="text-[10px] text-red-400 font-bold mt-0.5">Autorizó: {shift.autorizadoPorNombre}</p>
                                                        )}
                                                        {shift?.solicitadoPorNombre && (
                                                            <p className="text-[10px] text-red-400 font-bold">Solicitó: {shift.solicitadoPorNombre}</p>
                                                        )}
                                                        {shift?.isFrancoTrabajado && (
                                                            <p className="text-[10px] text-amber-600 font-black mt-0.5">Franco Trabajado (FT)</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Info adicional */}
                                            <div className="space-y-2 mb-5">
                                                {coveredPosition && coveredPosition !== 'General' && (
                                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                                        <Briefcase size={13}/> <span className="font-bold">{coveredPosition}</span>
                                                    </div>
                                                )}
                                                {coveringEmployee && (
                                                    <div className="flex items-center gap-2 text-xs text-indigo-600">
                                                        <UserCheck size={13}/> Cubierto por <span className="font-bold">{coveringEmployee}</span>
                                                    </div>
                                                )}
                                                {shift.isFrancoTrabajado && (
                                                    <div className="flex items-center gap-2 text-xs text-amber-600">
                                                        <AlertTriangle size={13}/> <span className="font-bold">Franco Trabajado (FT)</span>
                                                    </div>
                                                )}
                                                {shift.isFrancoCompensatorio && (
                                                    <div className="flex items-center gap-2 text-xs text-cyan-600">
                                                        <ArrowLeftRight size={13}/> <span className="font-bold">Franco Compensatorio (FF)</span>
                                                    </div>
                                                )}
                                                {francoRestH != null && (
                                                    <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                                        <Clock size={12}/>
                                                        <span>Descanso total: <span className="font-black text-emerald-700">{francoRestH}h</span></span>
                                                    </div>
                                                )}
                                                {hasSwap && (
                                                    <div className="flex items-center gap-2 text-xs text-cyan-600">
                                                        <ArrowLeftRight size={13}/> Swap {shift.swapWith ? `con ${shift.swapWith}` : ''} {shift.swapDate ? `(${shift.swapDate})` : ''}
                                                    </div>
                                                )}
                                                {previewIsPublished && !canEdit && (
                                                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                                        <LockKeyhole size={12}/> Cronograma publicado, usar modo corregir para realizar cambios.
                                                    </div>
                                                )}
                                            </div>

                                            {correctionMode && previewIsPublished && renderDayCoverageClosures(selectedCell.dateStr)}

                                            {/* Acciones */}
                                            {canEdit && !previewIsPublished && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => setCellEditMode(true)}
                                                        disabled={isServiceLocked}
                                                        className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                    >
                                                        <Edit3 size={14}/> Cambiar
                                                    </button>
                                                    <button
                                                        onClick={handleDelete}
                                                        disabled={isServiceLocked}
                                                        className="flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-500 px-4 py-2.5 rounded-xl text-sm font-black transition-colors border border-rose-200"
                                                    >
                                                        <Trash2 size={14}/>
                                                    </button>
                                                </div>
                                            )}
                                            {/* Publicado: acciones contextuales según tipo de turno */}
                                            {previewIsPublished && !correctionMode && (
                                                <div className="flex flex-col gap-2">
                                                    {isFrancoShift ? (
                                                        <button
                                                            onClick={() => { setFrancoMode('FT_SELECTION'); setCellEditMode(true); }}
                                                            disabled={isServiceLocked}
                                                            className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                        >
                                                            <ArrowRightCircle size={14}/> Asignar FT (Franco Trabajado)
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => { if (!confirm(`¿Dar Franco Compensatorio a ${employeeName} el ${selectedCell.dateStr}?`)) return; applyToPending({ code: 'FF', name: 'Franco Compensatorio', isFrancoCompensatorio: true, isFranco: true, hours: 0, startTime: '00:00', positionName: coveredPosition }); }}
                                                            disabled={isServiceLocked}
                                                            className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                        >
                                                            <ArrowLeftRight size={14}/> Dar FF (Franco Compensatorio)
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {/* Publicado + modo corrección superadmin */}
                                            {previewIsPublished && correctionMode && (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => setCellEditMode(true)}
                                                        disabled={isServiceLocked}
                                                        className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-black transition-colors"
                                                    >
                                                        <ShieldAlert size={14}/> Corregir
                                                    </button>
                                                    <button
                                                        onClick={handleDelete}
                                                        disabled={isServiceLocked}
                                                        className="flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-500 px-4 py-2.5 rounded-xl text-sm font-black transition-colors border border-rose-200"
                                                    >
                                                        <Trash2 size={14}/>
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    );
                                }

                                return (
                                    <>
                                        <div className="flex justify-between items-center mb-4">
                                            <div>
                                                <h3 className="font-black text-lg text-slate-800">{employeeName}</h3>
                                                <p className="text-xs text-slate-500 font-bold uppercase">{selectedCell.dateStr}</p>
                                                {hasSwap && (
                                                    <div className="mt-2 text-[10px] font-black uppercase text-cyan-700 flex items-center gap-1">
                                                        <ArrowLeftRight size={12}/> Swap {shift?.swapWith ? `con ${shift.swapWith}` : ''} {shift?.swapDate ? `(${shift.swapDate})` : ''}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {shift && <button onClick={() => setCellEditMode(false)} className="p-2 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200" title="Volver a vista previa"><ChevronLeft size={16}/></button>}
                                                <button onClick={handleDelete} className="p-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100" disabled={isServiceLocked}><Trash2 size={18}/></button>
                                            </div>
                                        </div>
                                        {francoRestHModal != null && (
                                            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-3">
                                                <Clock size={12}/>
                                                <span>Descanso total: <span className="font-black text-emerald-700">{francoRestHModal}h</span></span>
                                            </div>
                                        )}
                                        <div className="mb-2">
                                            <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block flex items-center gap-2">
                                                Puesto / Función
                                                {renderPositionGeneroBadge(
                                                    positionStructure.find((p: any) => p.positionName === (activePosition || positionStructure[0]?.positionName))?.preferenciaGenero,
                                                )}
                                            </label>
                                            <select 
                                                className="w-full bg-slate-50 border p-2 rounded-lg text-xs font-bold"
                                                value={activePosition || ''} 
                                                id="positionSelector"
                                                disabled={isServiceLocked}
                                                onChange={(e) => setActivePosition(e.target.value)}
                                            >
                                                {positionStructure.map(p => {
                                                    const excludedToday = isPosExcludedOnDate(p, selectedCell.dateStr);
                                                    return (
                                                    <option key={p.positionName} value={p.positionName} disabled={excludedToday}>
                                                        {p.positionName}{preferenciaGeneroOptionSuffix(p.preferenciaGenero)}{excludedToday ? ' — EXCLUIDO este día' : ''} ({p.qty} pax - Meta: {p.qty * (p.activeDays?.includes(getDayLetter(selectedCell.dateStr)) && !excludedToday ? (p.coverageType === '24hs' ? 24 : (p.shifts?.reduce((acc:number,s:any)=>acc+(Number(s.hours)||8),0)||0)) : 0)}h)
                                                    </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                        {(() => {
                                            const currentPosName = activePosition || positionStructure[0]?.positionName || 'General';
                                            const posCfg = positionStructure.find((p: any) => p.positionName === currentPosName);
                                            const generoUi = getPreferenciaGeneroUi(posCfg?.preferenciaGenero);
                                            if (!generoUi) return null;
                                            const emp = displayedEmployees.find((e: any) => e.id === selectedCell.empId);
                                            const generoCheck = emp ? checkGeneroPuesto(emp.genero, generoUi.pref) : { blocked: false };
                                            return (
                                                <div className={`mb-3 rounded-xl border-2 px-3 py-2.5 ${generoCheck.blocked ? 'border-rose-300 bg-rose-50' : generoUi.pref === 'F' ? 'border-pink-200 bg-pink-50' : 'border-blue-200 bg-blue-50'}`}>
                                                    <p className={`text-[10px] font-black uppercase flex items-center gap-1.5 ${generoCheck.blocked ? 'text-rose-800' : generoUi.pref === 'F' ? 'text-pink-800' : 'text-blue-800'}`}>
                                                        {renderPositionGeneroBadge(generoUi.pref)}
                                                        Puesto {preferenciaGeneroLabel(generoUi.pref)}
                                                    </p>
                                                    <p className={`text-[10px] font-bold mt-1 leading-snug ${generoCheck.blocked ? 'text-rose-700' : generoUi.pref === 'F' ? 'text-pink-700' : 'text-blue-700'}`}>
                                                        {generoCheck.blocked && generoCheck.message
                                                            ? `${emp?.name || 'Empleado'}: ${generoCheck.message}`
                                                            : `Solo se puede asignar personal ${generoUi.pref === 'F' ? 'femenino' : 'masculino'} a este puesto (definido en Servicios/SLA).`}
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {(() => {
                                            const currentPosName = activePosition || positionStructure[0]?.positionName || 'General';
                                            const posCfg = positionStructure.find((p: any) => p.positionName === currentPosName);
                                            const isExcludedToday = isPosExcludedOnDate(posCfg, selectedCell.dateStr);
                                            if (!isExcludedToday) return null;
                                            return (
                                                <div className="mb-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-3 py-2.5">
                                                    <p className="text-[10px] font-black uppercase text-rose-800 flex items-center gap-1.5">
                                                        <Ban size={12}/> Día excluido por SLA
                                                    </p>
                                                    <p className="text-[10px] font-bold text-rose-700 mt-1 leading-snug">
                                                        El puesto <span className="font-black">{currentPosName}</span> no tiene servicio el {planningPositionExclusionLabel(selectedCell.dateStr)}.
                                                        Definido en Servicios → Días excluidos. Solo podés asignar Franco (F).
                                                    </p>
                                                </div>
                                            );
                                        })()}
                                        {(() => {
                                            const coverageData = modalCoverageStats || {
                                                current: 0, target: 24, pax: 1, isActiveDay: true, isExcludedDay: false,
                                                closedUnits: 0, requiredUnits: 1, schemeLabel: '', isPositionClosed: false,
                                            };
                                            const currentPosName = activePosition || 'General';
                                            const posCfg = positionStructure.find((p: any) => p.positionName === currentPosName);
                                            const isExcludedDay = coverageData.isExcludedDay;
                                            const isHoursCovered = coverageData.current >= coverageData.target;
                                            const isUnitsCovered = coverageData.isPositionClosed;
                                            const coverageFull = coverageData.isActiveDay && coverageData.requiredUnits > 0 && isUnitsCovered;
                                            const percentage = coverageData.target > 0 ? Math.min(100, (coverageData.current / coverageData.target) * 100) : 100;
                                            const displayTarget = isExcludedDay
                                                ? 'Excluido SLA'
                                                : coverageData.isActiveDay ? `${coverageData.target}h` : `Sin cobertura`;
                                            const unitsLabel = coverageData.isActiveDay && coverageData.requiredUnits > 0
                                                ? `${coverageData.closedUnits}/${coverageData.requiredUnits} puesto${coverageData.requiredUnits > 1 ? 's' : ''}`
                                                : null;
                                            const bgClass = isExcludedDay
                                                ? 'bg-rose-100 text-rose-700'
                                                : coverageData.isActiveDay
                                                ? (isUnitsCovered ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600')
                                                : 'bg-slate-100 text-slate-500';
                                            const barColor = isExcludedDay
                                                ? 'bg-rose-300'
                                                : coverageData.isActiveDay
                                                ? (isHoursCovered ? 'bg-emerald-500' : 'bg-rose-500')
                                                : 'bg-slate-300';
                                            return (
                                                <>
                                                    {correctionMode && renderDayCoverageClosures(selectedCell.dateStr, { compact: true })}
                                                    <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <div className="flex items-center gap-2">
                                                                <Layers size={14} className="text-slate-400"/>
                                                                <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                                                                    Cobertura {currentPosName}
                                                                    {renderPositionGeneroBadge(posCfg?.preferenciaGenero)}
                                                                </span>
                                                            </div>
                                                            {unitsLabel && (
                                                                <div className={`text-xs font-black px-2 py-0.5 rounded ${bgClass}`}>
                                                                    {unitsLabel}
                                                                    {coverageData.schemeLabel ? ` (${coverageData.schemeLabel})` : ''}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-[9px] text-slate-400 font-bold">Horas SLA</span>
                                                            <span className={`text-[10px] font-black ${isHoursCovered ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                                {coverageData.current}h / {displayTarget}
                                                            </span>
                                                        </div>
                                                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }} />
                                                        </div>
                                                    </div>
                                                    <div className={`grid grid-cols-3 gap-2 mb-4 ${isServiceLocked || isExcludedDay ? 'opacity-50 pointer-events-none' : ''}`}>
                                                        {uniqueSLAShifts.map((s: any) => {
                                                            const isBlocked = shiftButtonDisabledMap.has(String(s.code).toUpperCase());
                                                            const disabledByCoverage = coverageFull;
                                                            const disabled = isServiceLocked || isBlocked || disabledByCoverage || isExcludedDay;
                                                            const timeRange = (s.startTime && s.endTime) ? `${s.startTime}–${s.endTime}` : null;
                                                            const gap = coverageData.current + (Number(s.hours) || 0) - coverageData.target;
                                                            const blockTitle = isExcludedDay
                                                                ? 'Puesto excluido por SLA este día'
                                                                : disabledByCoverage ? 'Puesto cerrado — esquema SLA completo (M+T+N o D12+N12).'
                                                                : isBlocked ? 'No se puede mezclar con turnos ya asignados en este puesto/día (solo 8h con 8h, 12h con 12h)' : undefined;
                                                            return (
                                                                <button
                                                                    key={s.code}
                                                                    onClick={() => !disabled && handleAssignShift(s, activePosition || 'General')}
                                                                    disabled={disabled}
                                                                    title={blockTitle}
                                                                    className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-transform relative ${disabled ? 'opacity-40 cursor-not-allowed grayscale' : 'hover:scale-105'} ${SHIFT_STYLES[s.code]}`}
                                                                >
                                                                    <span className="font-black text-sm">{s.code}</span>
                                                                    <span className="text-[9px] opacity-70">{s.hours}hs</span>
                                                                    {timeRange && <span className="text-[8px] opacity-60 font-mono leading-tight">{timeRange}</span>}
                                                                    {!selectedCell.currentShift && gap < 0 && !disabled && <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">{gap}h</div>}
                                                                </button>
                                                            );
                                                        })}
                                                        <button
                                                            onClick={() => { setFrancoMode('NONE'); handleAssignShift({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' }, 'General'); }}
                                                            disabled={isServiceLocked}
                                                            className={`p-2 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg flex flex-col items-center justify-center font-black ${isExcludedDay ? 'relative z-10 opacity-100 pointer-events-auto' : ''}`}
                                                            title="Asignar Franco (F)"
                                                        >
                                                            <span>F</span><span className="text-[8px]">Franco</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAssignShift({ code: 'RET', name: 'Retén', hours: 0, startTime: '00:00' }, 'Retén')}
                                                            disabled={isServiceLocked}
                                                            className="p-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-lg flex flex-col items-center justify-center font-black"
                                                            title="Retén — guardia disponible sin turno asignado (horas tácitas, no suman al límite)"
                                                        >
                                                            <span>RET</span><span className="text-[8px]">Retén</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAssignDeployment('SURPLUS')}
                                                            disabled={isServiceLocked || !activePosition || activePosition === 'General' || activePosition === 'Retén'}
                                                            className="p-2 bg-violet-100 text-violet-800 border border-violet-300 rounded-lg flex flex-col items-center justify-center font-black disabled:opacity-40"
                                                            title="Refuerzo — puesto ya cubierto; no suma cobertura SLA"
                                                        >
                                                            <span>REF</span><span className="text-[8px]">Refuerzo</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleAssignDeployment('TRAINING')}
                                                            disabled={isServiceLocked || !activePosition || activePosition === 'General' || activePosition === 'Retén'}
                                                            className="p-2 bg-sky-100 text-sky-800 border border-sky-300 rounded-lg flex flex-col items-center justify-center font-black disabled:opacity-40"
                                                            title="Escuela — formación en objetivo (3 turnos = conocido)"
                                                        >
                                                            <span>ESC</span><span className="text-[8px]">Escuela</span>
                                                        </button>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                        <div className={`flex flex-col gap-2 mb-4 ${isServiceLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <button
                                                type="button"
                                                onClick={() => setRecompositionModalOpen(true)}
                                                disabled={!selectedCell?.dateStr}
                                                className="w-full py-2.5 rounded-xl text-xs font-black border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center justify-center gap-2 disabled:opacity-40"
                                            >
                                                <Split size={14} /> Cobertura / Liberación (ext + adel)
                                            </button>
                                        </div>
                                        <button onClick={() => { setSwapConfig({ empId: selectedCell.empId }); setShowSwapModal(true); }} disabled={isServiceLocked} className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-indigo-100 hover:bg-indigo-100 disabled:opacity-50"><ArrowLeftRight size={16}/> Iniciar Enroque / Cambio de Turno</button>
                                        <div className="mt-2 px-2"><button onClick={() => applyBulkChange(null)} disabled={isServiceLocked} className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-rose-500 flex items-center justify-center gap-1 disabled:opacity-50">Aplicar a Selección (Borrar)</button></div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {pendingAssignment && createPortal(<div className="fixed inset-0 z-[9000] bg-amber-900/40 backdrop-blur-sm flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl border-2 border-amber-400 animate-in zoom-in-95"><div className="flex flex-col items-center text-center space-y-4"><div className="p-4 bg-amber-100 rounded-full text-amber-600"><AlertTriangle size={32} /></div><div><h3 className="font-black text-lg text-amber-800 uppercase">Advertencia Laboral</h3><p className="text-xs text-slate-600 mt-2 font-medium">{authWarningMessage}</p></div><div className="w-full pt-4 border-t flex gap-3"><button onClick={() => { setPendingAssignment(null); setAuthWarningMessage(''); }} className="flex-1 py-3 text-slate-500 font-bold text-xs rounded-xl hover:bg-slate-100">Cancelar</button><button onClick={() => {
                                        const cap = pendingAssignment;
                                        const empName = employees.find((e: any) => e.id === selectedCell?.empId)?.name || 'Empleado';
                                        setPendingAssignment(null);
                                        setAuthModal({
                                            pendingFn: async () => {
                                                applyToPending({ ...cap.shiftConfig, positionName: cap.positionName, isFrancoTrabajado: francoMode === 'FT_SELECTION', isExtended: false, isEarlyStart: false, plannedNovedad: modifiers.plannedNovedad });
                                                setAuthWarningMessage('');
                                            },
                                            employees: [empName],
                                            operatorName: activeActorName || operatorName
                                        });
                                    }} className="flex-1 py-3 bg-amber-500 text-white font-black text-xs rounded-xl hover:bg-amber-600 shadow-md">Autorizar con PIN</button></div></div></div></div>, document.body)}
                {publishConfirmModal && typeof document !== 'undefined' && createPortal(
                    <div
                        className="fixed inset-0 z-[9200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
                        onClick={() => !isPublishing && !publishConfirmPinChecking && setPublishConfirmModal(null)}
                    >
                        <div
                            className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="p-5 border-b bg-indigo-50/80">
                                <div className="flex items-start gap-3">
                                    <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl shrink-0">
                                        <CalendarCheck size={22}/>
                                    </div>
                                    <div>
                                        <h3 className="font-black text-base text-slate-900 uppercase tracking-wide">
                                            {publishConfirmModal.isRepublish ? 'Re-publicar cronograma' : 'Publicar cronograma'}
                                        </h3>
                                        <p className="text-[11px] font-bold text-indigo-700 mt-0.5">
                                            {publishConfirmModal.objectiveName} · {publishConfirmModal.periodLabel}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="p-5 space-y-3">
                                <p className="text-sm text-slate-700 leading-relaxed">
                                    {publishConfirmModal.isRepublish
                                        ? '¿Está seguro de re-publicar este cronograma? Se volverán a enviar notificaciones a los colaboradores con los turnos en borrador del mes.'
                                        : '¿Está seguro de publicar este cronograma? Los colaboradores del objetivo recibirán notificaciones con sus turnos asignados.'}
                                </p>
                                <ul className="text-[11px] text-slate-500 space-y-1.5 list-disc pl-4">
                                    <li>El cronograma quedará visible en el portal del guardia.</li>
                                    <li>Los turnos en borrador pasan a estado publicado.</li>
                                    <li>Esta acción no se puede deshacer con un clic (solo SuperAdmin puede despublicar).</li>
                                </ul>
                                {publishConfirmModal.superAdminOverride && publishConfirmModal.warnings.length > 0 && (
                                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
                                        <p className="text-[10px] font-black uppercase text-amber-800 flex items-center gap-1">
                                            <ShieldAlert size={12}/> SuperAdmin — publicación con advertencias
                                        </p>
                                        {publishConfirmModal.warnings.map((w, i) => (
                                            <p key={i} className="text-[11px] font-medium text-amber-900">{w}</p>
                                        ))}
                                    </div>
                                )}
                                {Object.keys(pendingChanges).length > 0 && (
                                    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 px-3 py-2.5">
                                        <p className="text-[11px] font-bold text-rose-800 flex items-center gap-1.5">
                                            <AlertTriangle size={13}/>
                                            Tenés {Object.keys(pendingChanges).length} cambio(s) sin guardar. Guardá antes de publicar para que entren en las notificaciones.
                                        </p>
                                    </div>
                                )}
                                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-3">
                                    <label className="text-[10px] font-black text-indigo-700 uppercase tracking-wider block mb-2 text-center">
                                        PIN de supervisor (obligatorio)
                                    </label>
                                    <input
                                        type="password"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={4}
                                        value={publishConfirmPin}
                                        onChange={(e) => {
                                            setPublishConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4));
                                            setPublishConfirmPinError('');
                                        }}
                                        placeholder="••••"
                                        className="w-full text-center text-2xl font-black tracking-[0.4em] py-2.5 rounded-xl border-2 border-indigo-200 focus:border-indigo-500 outline-none bg-white"
                                    />
                                    {publishConfirmPinError && (
                                        <p className="text-[11px] font-bold text-rose-600 text-center mt-2">{publishConfirmPinError}</p>
                                    )}
                                    <p className="text-[10px] text-slate-500 text-center mt-2">
                                        La asignación de puestos no publica el cronograma. Solo este paso lo hace.
                                    </p>
                                </div>
                            </div>
                            <div className="p-4 border-t bg-slate-50 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPublishConfirmModal(null);
                                        setPublishConfirmPin('');
                                        setPublishConfirmPinError('');
                                    }}
                                    disabled={isPublishing || publishConfirmPinChecking}
                                    className="flex-1 py-3 rounded-xl text-xs font-black text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (Object.keys(pendingChanges).length > 0) return;
                                        setPublishConfirmPinChecking(true);
                                        setPublishConfirmPinError('');
                                        try {
                                            const auth = await verifySupervisorPin(publishConfirmPin);
                                            if (!auth.ok) {
                                                setPublishConfirmPinError('PIN incorrecto. Intentá de nuevo.');
                                                return;
                                            }
                                            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                                                action: 'AUTORIZACION_PUBLICAR_CRONOGRAMA',
                                                module: 'PLANIFICADOR',
                                                details: `PIN OK (${auth.name}) · ${publishConfirmModal.isRepublish ? 're-publicar' : 'publicar'} · ${publishConfirmModal.objectiveName} · ${publishConfirmModal.periodLabel}`,
                                                timestamp: serverTimestamp(),
                                                actorName: activeActorName || operatorName,
                                                actorUid: getAuth().currentUser?.uid,
                                                objectiveId: selectedObjective,
                                                objectiveName: publishConfirmModal.objectiveName,
                                            }, empresaId));
                                            setPublishConfirmPin('');
                                            await executePublish();
                                        } catch {
                                            setPublishConfirmPinError('No se pudo validar el PIN.');
                                        } finally {
                                            setPublishConfirmPinChecking(false);
                                        }
                                    }}
                                    disabled={isPublishing || publishConfirmPinChecking || Object.keys(pendingChanges).length > 0 || publishConfirmPin.length !== 4}
                                    className="flex-1 py-3 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                >
                                    {(isPublishing || publishConfirmPinChecking) ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
                                    {publishConfirmModal.isRepublish ? 'Re-publicar' : 'Publicar'}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
                {deployBandPicker && createPortal(
                    <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDeployBandPicker(null)}>
                        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-2xl w-full max-w-xs border dark:border-slate-700" onClick={e => e.stopPropagation()}>
                            <h3 className="font-black text-sm uppercase mb-1 text-slate-800 dark:text-white">
                                {deployBandPicker === 'TRAINING' ? 'Escuela — elegir banda' : 'Refuerzo — elegir banda'}
                            </h3>
                            <p className="text-[10px] text-slate-500 mb-4 flex items-center gap-2 flex-wrap">
                                Puesto: <span className="font-bold text-indigo-600">{activePosition}</span>
                                {renderPositionGeneroBadge(
                                    positionStructure.find((p: any) => p.positionName === activePosition)?.preferenciaGenero,
                                )}
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                {['M', 'T', 'N', 'D12', 'N12'].map(b => (
                                    <button key={b} onClick={() => confirmDeploymentBand(b)} className={`p-3 rounded-lg border font-black text-sm ${SHIFT_STYLES[b] || 'bg-slate-100'}`}>{b}</button>
                                ))}
                            </div>
                            <button onClick={() => setDeployBandPicker(null)} className="w-full mt-4 py-2 text-xs font-bold text-slate-400 hover:text-slate-600">Cancelar</button>
                        </div>
                    </div>,
                    document.body,
                )}
                {showConflictModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-rose-900/20 backdrop-blur-sm"><div className="bg-white p-6 rounded-xl shadow-2xl w-[400px] border-2 border-rose-100"><div className="text-center mb-6"><div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3"><Siren size={24}/></div><h3 className="text-lg font-black text-slate-800">Conflicto Detectado</h3><p className="text-xs text-slate-500 mt-1">Hay una superposición entre Novedad y Turno.</p></div><div className="space-y-3"><button onClick={() => resolveConflict('SPLIT')} className="w-full p-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex items-center justify-center gap-2"><Split size={16}/> Dividir Turno (Extensión + Adelanto)</button><button onClick={() => resolveConflict('FULL_COVERAGE')} className="w-full p-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-50 flex items-center justify-center gap-2"><Shield size={16}/> Cobertura Total (Franco Trabajado)</button><button onClick={() => setShowConflictModal(false)} className="w-full p-3 text-slate-400 font-bold text-xs hover:text-slate-600">Cancelar</button></div></div></div>)}
                {showSwapModal && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-white p-6 rounded-xl shadow-2xl w-[500px]">
                            <h3 className="font-black text-lg mb-4 flex items-center gap-2">
                                <ArrowLeftRight size={20} className="text-indigo-500" /> Intercambio de Turno
                            </h3>
                            <>
                                <input
                                    type="text"
                                    placeholder="Buscar compañero..."
                                    className="w-full bg-slate-50 border p-3 rounded-xl mb-3 text-sm font-bold"
                                    value={swapSearchTerm}
                                    onChange={e => setSwapSearchTerm(e.target.value)}
                                />
                                <div className="max-h-60 overflow-y-auto custom-scrollbar border rounded-xl mb-4">
                                    {swapCandidates.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => { setSelectedSwapTarget(c.id); setSelectedSwapDate(''); }}
                                            className={`w-full p-3 text-left hover:bg-slate-50 border-b flex justify-between items-center ${selectedSwapTarget === c.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600'}`}
                                        >
                                            <span>{c.name}</span>
                                            {selectedSwapTarget === c.id && <CheckCircle size={16} />}
                                        </button>
                                    ))}
                                </div>

                                {selectedSwapTarget && (
                                    <div className="bg-white border rounded-xl p-3 mb-4">
                                        <div className="text-[10px] font-black uppercase text-slate-400 mb-2">Elegir día del compañero</div>
                                        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                                            {daysInMonth.map((d) => {
                                                const dateStr = getDateKey(d);
                                                if (isPlanningDateLocked(dateStr)) return null;
                                                const shift = getShiftFor(selectedSwapTarget, dateStr);
                                                if (!shift) return null;
                                                const selectedDay = selectedSwapDate === dateStr;
                                                return (
                                                    <button
                                                        key={dateStr}
                                                        onClick={() => handleSelectDate(dateStr)}
                                                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${selectedDay ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-indigo-50'}`}
                                                    >
                                                        {d.getDate()}/{d.getMonth() + 1} {(shift.code || shift.type) || '-'}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="bg-slate-50 p-3 rounded-xl border text-xs text-slate-600 mb-3">
                                    <div className="font-black text-slate-700 mb-1">Día: {selectedCell?.dateStr}</div>
                                    <div className="flex justify-between">
                                        <span>{employees.find(e => e.id === selectedCell?.empId)?.name || 'Empleado'}</span>
                                        <span className="font-mono">{(getShiftFor(selectedCell?.empId, selectedCell?.dateStr)?.code) || '-'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>{employees.find(e => e.id === selectedSwapTarget)?.name || 'Compañero'}</span>
                                        <span className="font-mono">{(getShiftFor(selectedSwapTarget, selectedSwapDate || selectedCell?.dateStr)?.code) || '-'}</span>
                                    </div>
                                </div>

                                <div className="flex gap-3">
                                    <button onClick={() => { setShowSwapModal(false); setSelectedSwapTarget(''); setSelectedSwapDate(''); setSwapSearchTerm(''); }} className="flex-1 py-3 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200">
                                        Cancelar
                                    </button>
                                    <button onClick={executeSwap} disabled={!selectedSwapTarget} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 disabled:opacity-50">
                                        Confirmar Intercambio
                                    </button>
                                </div>
                            </>
                        </div>
                    </div>
                )}
                {showAddModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)}><div className="bg-white p-6 rounded-xl shadow-2xl w-[420px]" onClick={e => e.stopPropagation()}><h3 className="font-black text-lg mb-1">Asignar Colaborador</h3><p className="text-xs text-slate-400 font-bold mb-4">Colaboradores a ≤{nearbyKmRadius} km de <span className="text-indigo-600">{getObjectiveName(selectedObjective)}</span> (más cerca primero). Al seleccionar se cambia su objetivo preferido.</p><input autoFocus className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl mb-4 text-sm font-bold" placeholder="Escriba nombre..." value={addSearchTerm} onChange={e => setAddSearchTerm(e.target.value)}/><div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">{addModalEmployeeCandidates.map(emp => { const alreadyAssigned = emp.preferredObjectiveId === selectedObjective; return (<button key={emp.id} onClick={async () => { if (!emp.id) return; await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective }); setAddSearchTerm(''); setShowAddModal(false); toast.success(`${emp.name} asignado a ${getObjectiveName(selectedObjective)}`); }} className="w-full p-3 text-left hover:bg-indigo-50 rounded-lg flex items-center gap-3 text-sm font-medium text-slate-700 group"><div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-black text-xs text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600">{emp.name.substring(0,2)}</div><div className="flex-1 min-w-0"><div className="font-bold truncate">{emp.name}</div>{alreadyAssigned && <div className="text-[10px] text-emerald-600 font-black">Ya asignado aquí</div>}</div>{alreadyAssigned && <CheckCircle size={14} className="text-emerald-500 shrink-0"/>}</button>); })}</div></div></div>)}
                {showVacancyModal && (() => {
                    const absType = vacancyData?.type || '';
                    const absenceDateRange = vacancyData?.startDate
                        ? listDateRangeInclusive(vacancyData.startDate, vacancyData.endDate || vacancyData.startDate)
                        : [];
                    const isVac = absType === 'Vacaciones';
                    const isEnf = absType === 'Enfermedad' || absType === 'ART';
                    const isPG = absType === 'PG Permiso Gremial';
                    const isLic = absType === 'Licencia Esp.' || isPG;
                    const isInj = absType === 'Injustificada';
                    const color = isVac ? 'teal' : isEnf ? 'rose' : isPG ? 'blue' : isLic ? 'purple' : 'amber';
                    const colorMap: any = { teal: 'border-l-teal-500 bg-teal-50 text-teal-700', rose: 'border-l-rose-500 bg-rose-50 text-rose-700', purple: 'border-l-purple-500 bg-purple-50 text-purple-700', blue: 'border-l-blue-500 bg-blue-50 text-blue-700', amber: 'border-l-amber-500 bg-amber-50 text-amber-700' };
                    const btnColor: any = { teal: 'bg-teal-600 hover:bg-teal-700 shadow-teal-200', rose: 'bg-rose-600 hover:bg-rose-700 shadow-rose-200', purple: 'bg-purple-600 hover:bg-purple-700 shadow-purple-200', blue: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200', amber: 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' };
                    const title = isVac ? 'Vacaciones — Planificar Cobertura' : isEnf ? 'Ausencia Médica — Cobertura Temporal' : isPG ? 'PG Permiso Gremial — Planificar Cobertura' : isLic ? 'Licencia Especial — Planificar Cobertura' : 'Ausencia Injustificada — Gestionar';
                    const hint = isVac
                        ? 'Elegí qué días procesar y quién cubre cada uno. Por día: traer suplente (RET/ESC/libre) o ext+adel con guardias del cronograma.'
                        : isEnf
                            ? 'Por día: suplente externo o ext+adel con personal ya en servicio ese día.'
                            : isPG
                                ? 'Asigná cobertura por día: suplente o ext+adel desde el cronograma.'
                                : isLic
                                    ? 'Suplente o ext+adel por día; ordenados por cercanía (suplentes).'
                                    : 'Podés asignar cobertura por día o dejar vacante.';
                    const sortedActiveDates = [...vacancyActiveDates].sort();
                    const candidateDate = vacancyEditingDay || sortedActiveDates[0] || vacancyData?.startDate;
                    const isBulkCoverageMode = vacancyReplacementOpen && !vacancyEditingDay;
                    const vacancyEmployeesById: Record<string, any> = {};
                    employees.forEach((e: any) => { if (e.id) vacancyEmployeesById[e.id] = e; });
                    const formatShortDay = (ymd: string) => {
                        const [, m, d] = ymd.split('-');
                        return `${d}/${m}`;
                    };
                    const formatTitularChip = (tit: NonNullable<ReturnType<typeof resolveTitularShiftForDay>>) => {
                        const band = tit.bandLabel !== tit.code ? tit.bandLabel : null;
                        const sched = tit.scheduleLabel && tit.scheduleLabel !== '—' ? tit.scheduleLabel : null;
                        return { code: tit.code, band, sched, position: tit.positionName };
                    };
                    const renderTitularChipLine = (tit: NonNullable<ReturnType<typeof resolveTitularShiftForDay>>) => {
                        const c = formatTitularChip(tit);
                        return (
                            <>
                                <span className="font-mono">{c.code}</span>
                                {c.band && <><span className="text-slate-300 mx-0.5">·</span><span>{c.band}</span></>}
                                <span className="text-slate-300 mx-0.5">·</span>
                                <span>{c.position}</span>
                                {c.sched && <><span className="text-slate-300 mx-0.5">·</span><span className="font-mono">{c.sched}</span></>}
                            </>
                        );
                    };
                    const toggleVacancyDate = (d: string) => {
                        setVacancyActiveDates((prev) => {
                            const next = new Set(prev);
                            if (next.has(d)) next.delete(d); else next.add(d);
                            return next;
                        });
                    };
                    const resolveDayCoverageForUi = (dateStr: string) =>
                        resolveVacancyDayCoverage(dateStr, vacancyDayCoverages, selectedReplacement);
                    const resolveDayCoverageLabel = (dateStr: string) =>
                        formatVacancyDayCoverageLabel(resolveDayCoverageForUi(dateStr), vacancyEmployeesById);
                    const willAssignAny = [...vacancyActiveDates].some((d) => vacancyDayHasCoverage(resolveDayCoverageForUi(d)));
                    const vacancyEmptyActiveDays = sortedActiveDates.filter((d) => !vacancyDayHasCoverage(resolveDayCoverageForUi(d))).length;
                    const vacancyConfiguredDays = sortedActiveDates.length - vacancyEmptyActiveDays;
                    const getTypicalShiftForTitular = (empId: string) => {
                        const yr = currentDate.getFullYear(); const mo = currentDate.getMonth();
                        const daysInMo = new Date(yr, mo + 1, 0).getDate();
                        const freq: Record<string, { count: number; shift: any }> = {};
                        for (let d = 1; d <= daysInMo; d++) {
                            const k = `${empId}_${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            const s = shiftsMap[k];
                            if (s?.code && !VACANCY_NON_WORK_CODES.has(String(s.code).toUpperCase())) {
                                if (!freq[s.code]) freq[s.code] = { count: 0, shift: s };
                                freq[s.code].count++;
                            }
                        }
                        return Object.values(freq).sort((a, b) => b.count - a.count)[0]?.shift || null;
                    };
                    const resolveTitularShiftForDay = (dateStr: string) => resolveTitularVacancyWorkShift(
                        vacancyData?.employeeId || '',
                        dateStr,
                        shiftsMap,
                        pendingChanges,
                        getTypicalShiftForTitular,
                    );
                    const openDayCoveragePicker = (d: string) => {
                        const existing = vacancyDayCoverages[d] ?? resolveVacancyDayCoverage(d, {}, selectedReplacement);
                        const configuredCount = sortedActiveDates.filter((date) =>
                            vacancyDayHasCoverage(vacancyDayCoverages[date] ?? { mode: 'none' }),
                        ).length;
                        if (sortedActiveDates.length > 1 && configuredCount === 0) {
                            setVacancyEditingDay(null);
                            setVacancyApplyToAllSelected(true);
                        } else {
                            setVacancyEditingDay(d);
                            setVacancyApplyToAllSelected(sortedActiveDates.length > 1);
                        }
                        setVacancyReplacementOpen(true);
                        if (existing.mode === 'split') {
                            setVacancyPickerTab('split');
                            setVacancySplitExtId(existing.extEmpId);
                            setVacancySplitAdelId(existing.adelEmpId);
                        } else {
                            setVacancyPickerTab('substitute');
                            setVacancySplitExtId('');
                            setVacancySplitAdelId('');
                        }
                    };
                    const resolveTitularForCoverageDay = (dateStr: string, refDate?: string) =>
                        resolveTitularShiftForDay(dateStr)
                        || (refDate ? resolveTitularShiftForDay(refDate) : null)
                        || (sortedActiveDates[0] ? resolveTitularShiftForDay(sortedActiveDates[0]) : null);
                    const shouldApplyCoverageToAllDays = () =>
                        isBulkCoverageMode
                        || (vacancyApplyToAllSelected && sortedActiveDates.length > 1);
                    const splitApplyButtonLabel = shouldApplyCoverageToAllDays()
                        ? `Aplicar ext + adel a ${sortedActiveDates.length} días`
                        : 'Aplicar ext + adel este día';
                    const replicateCoverageToEmptyDays = () => {
                        const templateDay = sortedActiveDates.find((d) =>
                            vacancyDayHasCoverage(vacancyDayCoverages[d] ?? { mode: 'none' }),
                        );
                        if (!templateDay) return;
                        const template = vacancyDayCoverages[templateDay]
                            ?? resolveVacancyDayCoverage(templateDay, {}, selectedReplacement);
                        if (!vacancyDayHasCoverage(template)) return;
                        const patch: Record<string, VacancyDayCoverage> = {};
                        for (const d of sortedActiveDates) {
                            if (vacancyDayHasCoverage(vacancyDayCoverages[d] ?? { mode: 'none' })) continue;
                            if (template.mode === 'substitute') {
                                patch[d] = { mode: 'substitute', employeeId: template.employeeId };
                            } else if (template.mode === 'split') {
                                const tit = resolveTitularForCoverageDay(d, templateDay);
                                if (!tit) continue;
                                patch[d] = {
                                    mode: 'split',
                                    extEmpId: template.extEmpId,
                                    adelEmpId: template.adelEmpId,
                                    gapBand: tit.code,
                                    gapPosition: tit.positionName,
                                };
                            }
                        }
                        const filled = Object.keys(patch).length;
                        if (filled === 0) {
                            toast.error('No quedan días vacíos para completar o falta inferir el turno del titular.');
                            return;
                        }
                        setVacancyDayCoverages((prev) => ({ ...prev, ...patch }));
                        toast.success(`Cobertura replicada en ${filled} día(s) restante(s).`);
                    };
                    // Calcular horas mensuales del mes en curso
                    const getEmpMonthHours = (empId: string): number => {
                        const yr = currentDate.getFullYear(); const mo = currentDate.getMonth();
                        const days = new Date(yr, mo + 1, 0).getDate(); let h = 0;
                        for (let d = 1; d <= days; d++) {
                            const key = `${empId}_${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                            const p = pendingChanges[key];
                            const s = shiftsMap[key];
                            const sh = p && !p.isDeleted ? p : s;
                            if (!sh?.code) continue;
                            if (!shiftCountsForEmployeeCronoHours(sh)) continue;
                            h += calcShiftHours(sh);
                        }
                        return h;
                    };
                    // Clasificar disponibilidad en la fecha de la ausencia
                    const NON_AVAILABLE = new Set(['F','FF','FP','FT','V','L','PG','A','E','AA','PAST','LOCKED']);
                    type VacancyDayRole = 'RETEN' | 'ESC' | 'FREE' | 'WORKING';
                    const getEmpDayRole = (empId: string, dateStr: string): VacancyDayRole => {
                        const key = `${empId}_${dateStr}`;
                        const s = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
                        if (!s || s.isDeleted) return 'FREE';
                        const code = String(s.code || '').toUpperCase();
                        if (code === 'RET') return 'RETEN';
                        if (code === 'ESC') return 'ESC';
                        if (NON_AVAILABLE.has(code)) return 'FREE';
                        return 'WORKING';
                    };
                    const objLat = Number(selectedObjectiveData?.lat ?? 0);
                    const objLng = Number(selectedObjectiveData?.lng ?? 0);
                    const sortKm = (a: { km: number }, b: { km: number }) => a.km - b.km;
                    const candidatos = employees
                        .filter(e => e.id !== vacancyData?.employeeId)
                        .map(e => ({
                            ...e,
                            monthHours: getEmpMonthHours(e.id),
                            dayRole: getEmpDayRole(e.id, candidateDate || vacancyData?.startDate || ''),
                            km: employeeKmToObjective(e, objLat, objLng) ?? 9999,
                            expBadge: experienciaBadgeForReplacement(e.id, selectedObjective || '', e.experienciaObjetivos, e.preferredObjectiveId),
                        }))
                        .filter(e => e.dayRole === 'RETEN' || e.dayRole === 'ESC' || e.dayRole === 'FREE');
                    const q = vacancyReplacementSearch.toLowerCase().trim();
                    const matchesSearch = (e: typeof candidatos[0]) => {
                        if (!q) return true;
                        return `${e.name || ''} ${e.lastName || ''} ${e.firstName || ''} ${e.legajo || ''}`.toLowerCase().includes(q);
                    };
                    const retenCandidatos = candidatos.filter(e => e.dayRole === 'RETEN' && matchesSearch(e)).sort(sortKm);
                    const escCandidatos = candidatos.filter(e => e.dayRole === 'ESC' && matchesSearch(e)).sort(sortKm);
                    const sinTurnoCandidatos = candidatos.filter(e => e.dayRole === 'FREE' && matchesSearch(e)).sort(sortKm);
                    const splitReferenceDate = vacancyEditingDay || candidateDate || '';
                    const splitTitularShift = splitReferenceDate ? resolveTitularShiftForDay(splitReferenceDate) : null;
                    const splitWorkBand = splitTitularShift
                        ? { code: splitTitularShift.code, positionName: splitTitularShift.positionName }
                        : null;
                    const splitPlan = splitTitularShift ? describeVacancySplitPlan(splitTitularShift) : null;
                    const splitNeighbors = splitWorkBand ? neighborBandsForTarget(splitWorkBand.code) : null;
                    const splitExtCandidates = splitWorkBand && splitReferenceDate
                        ? listExtensionCandidates(
                            splitWorkBand.code,
                            splitReferenceDate,
                            selectedObjective,
                            employees,
                            shiftsMap,
                            pendingChanges,
                            [vacancyData?.employeeId].filter(Boolean),
                        ).filter(c => !q || c.name.toLowerCase().includes(q))
                        : [];
                    const splitAdelCandidates = splitWorkBand && splitReferenceDate
                        ? listEarlyStartCandidates(
                            splitWorkBand.code,
                            splitReferenceDate,
                            selectedObjective,
                            employees,
                            shiftsMap,
                            pendingChanges,
                            [vacancyData?.employeeId, vacancySplitExtId].filter(Boolean),
                        ).filter(c => !q || c.name.toLowerCase().includes(q))
                        : [];
                    const splitFrancoPreview = (vacancySplitExtId && vacancySplitAdelId)
                        ? (() => {
                            const previewDays = shouldApplyCoverageToAllDays()
                                ? sortedActiveDates
                                : (vacancyEditingDay ? [vacancyEditingDay] : sortedActiveDates);
                            const rows: FrancoCoverageConflict[] = [];
                            for (const d of previewDays) {
                                rows.push(
                                    ...collectSplitFrancoConflicts(
                                        d,
                                        vacancySplitExtId,
                                        vacancySplitAdelId,
                                        vacancyEmployeesById,
                                        shiftsMap,
                                        pendingChanges,
                                    ),
                                );
                            }
                            return rows;
                        })()
                        : [];
                    const editingDayCov = vacancyEditingDay ? vacancyDayCoverages[vacancyEditingDay] : undefined;
                    const editingDaySubstituteId = vacancyEditingDay
                        ? (editingDayCov?.mode === 'substitute' ? editingDayCov.employeeId : selectedReplacement)
                        : selectedReplacement;
                    const selectedReplacementEmp = candidatos.find(e => e.id === editingDaySubstituteId);
                    const applySplitCoverage = () => {
                        if (!vacancySplitExtId || !vacancySplitAdelId) return;
                        if (vacancySplitExtId === vacancySplitAdelId) {
                            toast.error('Extensión y adelanto deben ser guardias distintos.');
                            return;
                        }
                        const applyAll = shouldApplyCoverageToAllDays();
                        const targetDays = applyAll
                            ? sortedActiveDates
                            : (vacancyEditingDay ? [vacancyEditingDay] : sortedActiveDates);
                        if (targetDays.length === 0) return;

                        const commitSplitPatch = () => {
                            const patch: Record<string, VacancyDayCoverage> = {};
                            let applied = 0;
                            for (const d of targetDays) {
                                const tit = resolveTitularForCoverageDay(d, splitReferenceDate || sortedActiveDates[0] || undefined);
                                if (!tit) continue;
                                patch[d] = {
                                    mode: 'split',
                                    extEmpId: vacancySplitExtId,
                                    adelEmpId: vacancySplitAdelId,
                                    gapBand: tit.code,
                                    gapPosition: tit.positionName,
                                };
                                applied++;
                            }
                            if (applied === 0) {
                                toast.error('No se pudo inferir el turno del titular en ningún día seleccionado.');
                                return;
                            }
                            setVacancyDayCoverages((prev) => ({ ...prev, ...patch }));
                            toast.success(`Ext+adel aplicado a ${applied} día(s).`);
                            setVacancyEditingDay(null);
                            setVacancyReplacementOpen(false);
                            setVacancyReplacementSearch('');
                        };

                        const francoConflicts: FrancoCoverageConflict[] = [];
                        for (const d of targetDays) {
                            francoConflicts.push(
                                ...collectSplitFrancoConflicts(
                                    d,
                                    vacancySplitExtId,
                                    vacancySplitAdelId,
                                    vacancyEmployeesById,
                                    shiftsMap,
                                    pendingChanges,
                                ),
                            );
                        }
                        if (francoConflicts.length > 0 && !vacancyFrancoAuthApproved) {
                            requestSupervisorFrancoAuth(francoConflicts, () => {
                                setVacancyFrancoAuthApproved(true);
                                commitSplitPatch();
                            }, 'extensión + adelanto');
                            return;
                        }
                        if (francoConflicts.length > 0) setVacancyFrancoAuthApproved(true);
                        commitSplitPatch();
                    };
                    const applySubstituteToActiveDays = (employeeId: string) => {
                        const applyAll = shouldApplyCoverageToAllDays();
                        const targetDays = applyAll
                            ? sortedActiveDates
                            : (vacancyEditingDay ? [vacancyEditingDay] : []);

                        const commitSubstitute = () => {
                            if (applyAll) {
                                setSelectedReplacement(employeeId);
                                setVacancyDayCoverages((prev) => {
                                    const next = { ...prev };
                                    for (const d of sortedActiveDates) {
                                        next[d] = { mode: 'substitute', employeeId };
                                    }
                                    return next;
                                });
                                toast.success(`Suplente asignado a ${sortedActiveDates.length} día(s).`);
                            } else if (vacancyEditingDay) {
                                setVacancyDayCoverages((prev) => ({ ...prev, [vacancyEditingDay]: { mode: 'substitute', employeeId } }));
                            } else {
                                setSelectedReplacement(employeeId);
                            }
                            setVacancyEditingDay(null);
                        };

                        if (targetDays.length > 0) {
                            const francoConflicts = collectVacancyFrancoConflicts({
                                days: targetDays.map((dateStr) => ({
                                    dateStr,
                                    coverage: { mode: 'substitute' as const, employeeId, employeeName: vacancyEmployeesById[employeeId]?.name || '' },
                                })),
                                shiftsMap,
                                employeesById: vacancyEmployeesById,
                            }, pendingChanges);
                            if (francoConflicts.length > 0 && !vacancyFrancoAuthApproved) {
                                requestSupervisorFrancoAuth(francoConflicts, () => {
                                    setVacancyFrancoAuthApproved(true);
                                    commitSubstitute();
                                }, 'suplencia sobre franco');
                                return;
                            }
                            if (francoConflicts.length > 0) setVacancyFrancoAuthApproved(true);
                        }
                        commitSubstitute();
                    };
                    const clearCoverageForScope = () => {
                        const applyAll = shouldApplyCoverageToAllDays();
                        if (applyAll) {
                            setSelectedReplacement('');
                            setVacancyDayCoverages((prev) => {
                                const next = { ...prev };
                                for (const d of sortedActiveDates) delete next[d];
                                return next;
                            });
                        } else if (vacancyEditingDay) {
                            setVacancyDayCoverages((prev) => {
                                const next = { ...prev };
                                delete next[vacancyEditingDay];
                                return next;
                            });
                            setVacancyEditingDay(null);
                        } else {
                            setSelectedReplacement('');
                        }
                    };
                    const renderVacancyCandidate = (e: typeof candidatos[0], suffix: string) => (
                        <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                                applySubstituteToActiveDays(e.id);
                                setVacancyReplacementOpen(false);
                            }}
                            className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-indigo-50 rounded-lg ${editingDaySubstituteId === e.id ? 'bg-indigo-50 ring-1 ring-indigo-300' : ''}`}
                        >
                            <span className="font-bold truncate flex-1 min-w-0">{e.expBadge} {e.name}</span>
                            {formatKmLabel(e.km) && (
                                <span className="text-[10px] text-slate-400 font-mono shrink-0 flex items-center gap-0.5">
                                    <MapPin size={10} />{formatKmLabel(e.km)}
                                </span>
                            )}
                            <span className="text-[10px] text-slate-400 shrink-0">{suffix}</span>
                        </button>
                    );
                    return (
                    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 bg-black/25 backdrop-blur-[2px]">
                        <div className={`bg-white p-6 rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[min(92vh,820px)] flex flex-col border-l-4 ${colorMap[color].split(' ')[0]}`}>
                            <div className="flex items-start justify-between mb-4 shrink-0">
                                <div>
                                    <h3 className="font-black text-lg text-slate-800">{title}</h3>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        <span className="font-bold text-slate-700">{vacancyData?.employeeName}</span>
                                        {vacancyData?.startDate && <span className="ml-2 text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">{vacancyData.startDate} → {vacancyData.endDate}</span>}
                                    </p>
                                </div>
                                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${colorMap[color]}`}>{absType}</span>
                            </div>
                            <p className="text-xs text-slate-400 mb-3 shrink-0">{hint}</p>
                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-3 mb-4">
                            {absenceDateRange.length > 1 && (
                                <div className="mb-3 shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-[10px] font-black uppercase text-slate-400">Días a procesar</label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => { setVacancyActiveDates(new Set(absenceDateRange)); setVacancyEditingDay(null); setVacancyApplyToAllSelected(true); setVacancyReplacementOpen(true); }} className="text-[10px] font-bold text-indigo-600 hover:underline">Todos</button>
                                            <button type="button" onClick={() => setVacancyActiveDates(new Set())} className="text-[10px] font-bold text-slate-400 hover:underline">Ninguno</button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                                        {absenceDateRange.map((d) => (
                                            <button
                                                key={d}
                                                type="button"
                                                onClick={() => toggleVacancyDate(d)}
                                                className={`px-2 py-1 rounded-lg text-[11px] font-bold font-mono border transition-colors ${vacancyActiveDates.has(d) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-indigo-300'}`}
                                            >
                                                {formatShortDay(d)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {vacancyActiveDates.size > 0 && (
                                <div className="mb-3 shrink-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-[10px] font-black uppercase text-slate-400">Cobertura por día</label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setVacancyEditingDay(null);
                                                setVacancyApplyToAllSelected(true);
                                                setVacancyPickerTab('substitute');
                                                setVacancyReplacementOpen(true);
                                            }}
                                            className="text-[10px] font-bold text-indigo-600 hover:underline"
                                        >
                                            Misma cobertura para todos
                                        </button>
                                    </div>
                                    {vacancyEmptyActiveDays > 0 && vacancyConfiguredDays > 0 && (
                                        <button
                                            type="button"
                                            onClick={replicateCoverageToEmptyDays}
                                            className="mb-2 w-full py-2 rounded-xl border border-violet-200 bg-violet-50 text-[10px] font-black text-violet-800 hover:bg-violet-100"
                                        >
                                            Completar {vacancyEmptyActiveDays} día(s) restante(s) con la misma cobertura
                                        </button>
                                    )}
                                    <p className="text-[10px] font-bold text-indigo-600 mb-2">
                                        <strong>Misma cobertura para todos</strong> aplica suplente o ext+adel a todos los días marcados. Tocá un día sólo si necesitás excepciones.
                                    </p>
                                    <div className="max-h-36 overflow-y-auto custom-scrollbar border rounded-xl divide-y">
                                        {[...vacancyActiveDates].sort().map((d) => {
                                            const cov = resolveDayCoverageForUi(d);
                                            const isEditing = vacancyEditingDay === d;
                                            return (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    onClick={() => openDayCoveragePicker(d)}
                                                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-colors ${isEditing ? 'bg-indigo-50 ring-2 ring-inset ring-indigo-300' : 'hover:bg-slate-50'}`}
                                                >
                                                    <span className="font-mono font-black text-slate-700 w-14 shrink-0">{formatShortDay(d)}</span>
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block truncate font-bold text-slate-700">{resolveDayCoverageLabel(d)}</span>
                                                        {(() => {
                                                            const tit = resolveTitularShiftForDay(d);
                                                            return tit ? (
                                                                <span className="block truncate text-[9px] font-bold text-amber-700 mt-0.5">
                                                                    Cubrir: {renderTitularChipLine(tit)}
                                                                </span>
                                                            ) : (
                                                                <span className="block text-[9px] font-bold text-rose-500 mt-0.5">Sin turno laboral inferido</span>
                                                            );
                                                        })()}
                                                    </span>
                                                    {cov.mode === 'split' && (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 shrink-0">ext+adel</span>
                                                    )}
                                                    {cov.mode === 'substitute' && (
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 shrink-0">suplente</span>
                                                    )}
                                                    <ChevronRight size={14} className={`shrink-0 ${isEditing ? 'text-indigo-600' : 'text-slate-300'}`} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {(vacancyReplacementOpen && (vacancyEditingDay || vacancyActiveDates.size > 0)) && (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mb-4 shrink-0 space-y-3">
                                <label className="text-[10px] font-black uppercase text-slate-400 block">
                                    {vacancyEditingDay
                                        ? `Configurar ${formatShortDay(vacancyEditingDay)}`
                                        : `Cobertura para todos los días (${vacancyActiveDates.size})`}
                                </label>
                                {(vacancyEditingDay || isBulkCoverageMode) && sortedActiveDates.length > 1 && (
                                    <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2.5">
                                        <input
                                            type="checkbox"
                                            checked={vacancyApplyToAllSelected || isBulkCoverageMode}
                                            disabled={isBulkCoverageMode}
                                            onChange={(e) => setVacancyApplyToAllSelected(e.target.checked)}
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-[10px] font-bold text-indigo-900">
                                            Aplicar a los {sortedActiveDates.length} días seleccionados
                                        </span>
                                    </label>
                                )}
                                {(vacancyEditingDay || isBulkCoverageMode) && splitTitularShift && (
                                    <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/90 px-3 py-3">
                                        <div className="text-[10px] font-black uppercase text-amber-900 mb-1.5 flex items-center gap-1">
                                            <Clock size={11} /> Turno del titular a cubrir
                                            {isBulkCoverageMode && splitReferenceDate && (
                                                <span className="normal-case font-bold text-amber-700/80 ml-1">· ref. {formatShortDay(splitReferenceDate)}</span>
                                            )}
                                        </div>
                                        <div className="text-sm font-black text-slate-800 flex flex-wrap items-center gap-1.5">
                                            <span className="font-mono bg-white px-2 py-0.5 rounded-lg border border-amber-300 text-amber-900">{splitTitularShift.code}</span>
                                            {splitTitularShift.bandLabel !== splitTitularShift.code && (
                                                <span>{splitTitularShift.bandLabel}</span>
                                            )}
                                            <span className="text-slate-400">·</span>
                                            <span>{splitTitularShift.positionName}</span>
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-600 mt-1">
                                            {splitTitularShift.scheduleLabel !== '—' ? (
                                                <>{splitTitularShift.scheduleLabel} · {splitTitularShift.hours}h</>
                                            ) : (
                                                <>{splitTitularShift.hours}h · horario según cronograma</>
                                            )}
                                        </div>
                                        <div className="text-[9px] font-bold text-amber-800/90 mt-1">{splitTitularShift.sourceLabel}</div>
                                        {vacancyPickerTab === 'split' && splitPlan && (
                                            <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[9px] font-bold text-violet-900">
                                                <div className="rounded-lg bg-white/70 px-2 py-1.5 border border-violet-100">
                                                    <div className="text-violet-600 uppercase text-[8px] mb-0.5">Hueco</div>
                                                    <div>{splitPlan.gapLabel}</div>
                                                </div>
                                                <div className="rounded-lg bg-white/70 px-2 py-1.5 border border-violet-100">
                                                    <div className="text-violet-600 uppercase text-[8px] mb-0.5">Ext · {splitPlan.extBand}</div>
                                                    <div>{splitPlan.extSegment}</div>
                                                </div>
                                                <div className="rounded-lg bg-white/70 px-2 py-1.5 border border-violet-100">
                                                    <div className="text-violet-600 uppercase text-[8px] mb-0.5">Adel · {splitPlan.adelBand}</div>
                                                    <div>{splitPlan.adelSegment}</div>
                                                </div>
                                            </div>
                                        )}
                                        {vacancyPickerTab === 'substitute' && (
                                            <div className="mt-2.5 pt-2.5 border-t border-amber-200/80 text-[9px] font-bold text-teal-800">
                                                El suplente heredará turno <strong>{splitTitularShift.code}</strong> en <strong>{splitTitularShift.positionName}</strong>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {(vacancyEditingDay || isBulkCoverageMode) && !splitTitularShift && (
                                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] font-bold text-rose-700">
                                        No se pudo inferir el turno laboral del titular. Revisá el cronograma previo a la licencia o usá suplente manual.
                                    </div>
                                )}
                                {(vacancyEditingDay || isBulkCoverageMode) && (
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setVacancyPickerTab('substitute')}
                                            className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border transition-colors ${vacancyPickerTab === 'substitute' ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-200'}`}
                                        >
                                            Traer suplente
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setVacancyPickerTab('split')}
                                            className={`flex-1 py-2.5 rounded-xl text-[11px] font-black border flex items-center justify-center gap-1 transition-colors ${vacancyPickerTab === 'split' ? 'bg-violet-600 text-white border-violet-600 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-violet-200'}`}
                                        >
                                            <Split size={12} /> Ext + Adel
                                        </button>
                                    </div>
                                )}
                                {isBulkCoverageMode && (
                                    <p className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
                                        La configuración se aplicará a los {vacancyActiveDates.size} días seleccionados arriba.
                                    </p>
                                )}
                                {vacancyPickerTab === 'substitute' && (
                                    <div ref={vacancyReplacementPanelRef} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                                        <p className="text-[10px] font-bold text-teal-800 bg-teal-50 border-b border-teal-100 px-3 py-2">
                                            Preferí <strong>RET</strong>, <strong>ESC</strong> o guardias <strong>sin turno</strong> — evitás franco trabajado (FT) y costo extra.
                                        </p>
                                        <div className="p-2 border-b bg-white">
                                            <div className="relative">
                                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus
                                                    className="w-full pl-9 pr-3 py-2.5 text-sm font-bold bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-400"
                                                    placeholder="Buscar por nombre o legajo..."
                                                    value={vacancyReplacementSearch}
                                                    onChange={e => setVacancyReplacementSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="overflow-y-auto custom-scrollbar p-1 max-h-[min(38vh,260px)]">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    clearCoverageForScope();
                                                    setVacancyReplacementOpen(false);
                                                }}
                                                className={`w-full px-3 py-2.5 text-left text-sm font-bold hover:bg-slate-50 rounded-lg ${!vacancyDayHasCoverage(vacancyEditingDay ? resolveDayCoverageForUi(vacancyEditingDay) : (selectedReplacement ? { mode: 'substitute', employeeId: selectedReplacement } : { mode: 'none' })) ? 'bg-slate-50 ring-1 ring-slate-300 text-slate-500' : 'text-slate-400'}`}
                                            >
                                                Sin cobertura — dejar vacante
                                            </button>
                                            {retenCandidatos.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 text-[10px] font-black uppercase text-amber-600">Retén — más cerca primero ({retenCandidatos.length})</div>
                                                    {retenCandidatos.map(e => renderVacancyCandidate(e, `Retén · ${e.monthHours}h`))}
                                                </>
                                            )}
                                            {escCandidatos.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 text-[10px] font-black uppercase text-sky-600">ESC — más cerca primero ({escCandidatos.length})</div>
                                                    {escCandidatos.map(e => renderVacancyCandidate(e, `ESC · ${e.monthHours}h`))}
                                                </>
                                            )}
                                            {sinTurnoCandidatos.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 text-[10px] font-black uppercase text-emerald-600">Sin turno — más cerca primero ({sinTurnoCandidatos.length})</div>
                                                    {sinTurnoCandidatos.map(e => renderVacancyCandidate(e, `Libre · ${e.monthHours}h`))}
                                                </>
                                            )}
                                            {retenCandidatos.length === 0 && escCandidatos.length === 0 && sinTurnoCandidatos.length === 0 && (
                                                <p className="px-3 py-6 text-xs text-slate-400 text-center">
                                                    {q ? `Sin resultados para "${vacancyReplacementSearch}"` : 'No hay RET, ESC ni guardias libres ese día cerca del objetivo.'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {vacancyPickerTab === 'split' && (vacancyEditingDay || isBulkCoverageMode) && (
                                    <div ref={vacancyReplacementPanelRef} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 space-y-3">
                                        {!splitTitularShift ? (
                                            <p className="text-xs text-slate-400 text-center py-4">
                                                No se pudo inferir la banda a cubrir. Revisá el turno habitual del titular en el cronograma.
                                            </p>
                                        ) : (
                                            <>
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                    <input
                                                        className="w-full pl-9 pr-3 py-2 text-sm font-bold bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-violet-400"
                                                        placeholder="Filtrar guardias..."
                                                        value={vacancyReplacementSearch}
                                                        onChange={e => setVacancyReplacementSearch(e.target.value)}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-1.5">
                                                        Extensión — turno {splitPlan?.extBand} ({splitPlan?.extSegment})
                                                    </label>
                                                    <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 p-1">
                                                        {splitExtCandidates.length === 0 ? (
                                                            <p className="text-[10px] text-slate-400 px-2 py-3 text-center">
                                                                Sin guardias en banda {splitNeighbors?.extensionBand} ese día.
                                                            </p>
                                                        ) : splitExtCandidates.map(c => (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                onClick={() => setVacancySplitExtId(c.id)}
                                                                className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border transition-colors ${vacancySplitExtId === c.id ? 'bg-violet-100 border-violet-400 text-violet-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                                                            >
                                                                {c.name} · {c.code} · {c.positionName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-1.5">
                                                        Adelanto — turno {splitPlan?.adelBand} ({splitPlan?.adelSegment})
                                                    </label>
                                                    <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar rounded-xl border border-slate-100 p-1">
                                                        {splitAdelCandidates.length === 0 ? (
                                                            <p className="text-[10px] text-slate-400 px-2 py-3 text-center">
                                                                Sin guardias en banda {splitNeighbors?.earlyStartBand} ese día.
                                                            </p>
                                                        ) : splitAdelCandidates.map(c => (
                                                            <button
                                                                key={c.id}
                                                                type="button"
                                                                onClick={() => setVacancySplitAdelId(c.id)}
                                                                className={`w-full px-2.5 py-2 text-left text-xs font-bold rounded-lg border transition-colors ${vacancySplitAdelId === c.id ? 'bg-violet-100 border-violet-400 text-violet-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                                                            >
                                                                {c.name} · {c.code} · {c.positionName}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                {splitFrancoPreview.length > 0 && (
                                                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-[10px] font-bold text-amber-900">
                                                        <div className="flex items-center gap-1.5 mb-1 text-amber-800">
                                                            <AlertTriangle size={12} /> Franco planificado — costo FT
                                                        </div>
                                                        <p className="leading-relaxed">
                                                            {formatFrancoConflictSummary(splitFrancoPreview)}.
                                                            Requiere <strong>PIN de supervisor</strong> o elegí guardias en servicio / RET / ESC (pestaña suplente).
                                                        </p>
                                                    </div>
                                                )}
                                                <div className="flex flex-col gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => applySplitCoverage()}
                                                        disabled={!vacancySplitExtId || !vacancySplitAdelId}
                                                        className="w-full py-3 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-40 hover:bg-violet-700 shadow-sm shadow-violet-200"
                                                    >
                                                        {splitApplyButtonLabel}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                                {vacancyEditingDay && (
                                    <div className="flex gap-2 pt-0.5 border-t border-slate-200/80">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const sorted = [...vacancyActiveDates].sort();
                                                const idx = sorted.indexOf(vacancyEditingDay);
                                                const next = sorted[idx + 1];
                                                if (next) openDayCoveragePicker(next);
                                                else {
                                                    setVacancyReplacementOpen(false);
                                                    setVacancyEditingDay(null);
                                                    setVacancyReplacementSearch('');
                                                }
                                            }}
                                            className="flex-1 py-2.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl transition-colors"
                                        >
                                            {(() => {
                                                const sorted = [...vacancyActiveDates].sort();
                                                const idx = sorted.indexOf(vacancyEditingDay);
                                                return idx < sorted.length - 1 ? 'Siguiente día →' : 'Listo';
                                            })()}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setVacancyReplacementOpen(false); setVacancyReplacementSearch(''); setVacancyEditingDay(null); }}
                                            className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                                        >
                                            Cerrar
                                        </button>
                                    </div>
                                )}
                            </div>
                            )}
                            </div>
                            <div className="flex gap-3 shrink-0">
                                <button onClick={finalizeVacancyModal} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-50 rounded-xl border">Cancelar</button>
                                <button onClick={handleProcessVacancy} disabled={vacancyActiveDates.size === 0} className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg disabled:opacity-40 ${btnColor[color]}`}>
                                    {willAssignAny ? 'Confirmar cobertura' : 'Marcar vacante'}
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 text-center mt-3 shrink-0">Los cambios quedan pendientes — recordá guardar el cronograma.</p>
                        </div>
                    </div>
                    );
                })()}
                {showRRHHModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"><div className="bg-white p-6 rounded-xl shadow-2xl w-[400px]"><h3 className="font-black text-lg mb-4">Registrar Novedad RRHH</h3><div className="space-y-4"><div><label className="text-xs font-bold text-slate-500 block mb-1">Tipo de Novedad</label><select className="w-full border p-2 rounded-lg" value={rrhhData.type} onChange={e => setRrhhData({...rrhhData, type: e.target.value})}><option>Vacaciones</option><option>Enfermedad</option><option>ART</option><option>Injustificada</option><option>Licencia Esp.</option></select></div><div><label className="text-xs font-bold text-slate-500 block mb-1">Detalle / Motivo</label><textarea className="w-full border p-2 rounded-lg h-24 text-sm" value={rrhhData.reason} onChange={e => setRrhhData({...rrhhData, reason: e.target.value})} placeholder="Especifique el motivo..."></textarea></div><button onClick={handleRRHHSubmit} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Guardar Novedad</button><button onClick={() => setShowRRHHModal(false)} className="w-full text-slate-400 text-xs font-bold py-2">Cancelar</button></div></div></div>)}
                {showHistoryModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistoryModal(false)}><div className="bg-white w-full max-w-3xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}><div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-black text-lg flex items-center gap-2"><History className="text-indigo-600"/> Historial de Versiones</h3><button onClick={() => setShowHistoryModal(false)}><X size={20}/></button></div><p className="px-4 py-2 text-[10px] text-slate-500 border-b bg-slate-50">Cada versión se compara con la <span className="font-bold text-indigo-600">planificación activa</span> (guardada + pendientes).</p><div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">{historyVersions.map(v => (<div key={v.id} className="border p-4 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-colors group"><div><p className="font-black text-slate-800 text-sm">{new Date(v.timestamp.seconds*1000).toLocaleString()}</p><p className="text-xs text-slate-500 font-mono mt-1">Modificado por: <span className="font-bold text-indigo-600">{v.user}</span></p><div className="mt-2 flex gap-2"><span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-600 border border-slate-200">{v.count} cambios</span></div></div><button onClick={() => handleViewSnapshot(v)} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all">Comparar vs actual</button></div>))}{historyVersions.length === 0 && <div className="text-center text-slate-400 py-10">No hay versiones guardadas para este periodo.</div>}</div></div></div>)}

                {/* MODAL AUTORIZACIÓN SUPERVISOR 200H */}
                {authModal.pendingFn && createPortal(
                    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
                        <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md p-8 shadow-2xl animate-in zoom-in-95 border dark:border-slate-700">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 bg-amber-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                                    <ShieldAlert size={32} className="text-amber-600"/>
                                </div>
                                <h3 className="font-black text-xl text-slate-900 dark:text-white">Autorización Requerida</h3>
                                <p className="text-sm text-slate-500 mt-1">{authModal.description || <>El siguiente empleado superará las <strong>200 hs</strong> mensuales:</>}</p>
                                <div className="mt-3 flex flex-col gap-1 items-center">
                                    {authModal.employees.map(e => (
                                        <span key={`${e.name}-${e.detail || e.hours}`} className="text-xs bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-bold">
                                            {e.name}
                                            {e.detail
                                                ? <> — <span className="text-amber-900">{e.detail}</span></>
                                                : e.hours
                                                    ? <> — <span className="text-amber-900">{e.hours}h</span></>
                                                    : null}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="mb-6">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2 text-center">PIN de Supervisor</label>
                                <SupervisorPinInput
                                    autoFocus
                                    maxLength={4}
                                    placeholder="••••"
                                    value={authPin}
                                    onChange={e => { setAuthPin(e.target.value.replace(/\D/g,'').slice(0,4)); setAuthError(''); }}
                                    className="w-full text-center text-3xl font-black tracking-[0.6em] bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-indigo-500 outline-none dark:text-white rounded-xl px-4 py-4"
                                />
                                {authError && <p className="text-rose-600 text-xs font-bold text-center mt-2">{authError}</p>}
                            </form>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setAuthModal({ pendingFn: null, employees: [] }); setAuthPin(''); setAuthError(''); }}
                                    className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    disabled={authPin.length !== 4 || authLoading}
                                    onClick={async () => {
                                        setAuthLoading(true);
                                        const result = await verifySupervisorPin(authPin);
                                        if (!result.ok) {
                                            setAuthError('PIN incorrecto. Intentá de nuevo.');
                                            setAuthPin('');
                                            setAuthLoading(false);
                                            return;
                                        }
                                        // PIN válido → ejecutar el guardado
                                        await authModal.pendingFn!();
                                        if (authModal.isSaveFlow) {
                                            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                                                timestamp: serverTimestamp(),
                                                action: 'OVERRIDE_200H',
                                                module: 'PLANIFICADOR',
                                                actorName: result.name,
                                                details: `${authModal.operatorName || 'Operador'} asignó turno a ${authModal.employees.map(e => `${e.name} (${e.hours}h)`).join(', ')} superando 200hs — autorizó: ${result.name}`,
                                                objectiveId: selectedObjective || undefined,
                                                objectiveName: selectedObjective ? getObjectiveName(selectedObjective) : undefined,
                                            }, empresaId));
                                        } else if (authModal.auditAction) {
                                            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                                                timestamp: serverTimestamp(),
                                                action: authModal.auditAction,
                                                module: 'PLANIFICADOR',
                                                actorName: result.name,
                                                actorUid: getAuth().currentUser?.uid || null,
                                                details: authModal.auditDetails || authModal.employees.map(e => e.name).join(', '),
                                                objectiveId: selectedObjective || undefined,
                                                objectiveName: selectedObjective ? getObjectiveName(selectedObjective) : undefined,
                                            }, empresaId));
                                        }
                                        setAuthModal({ pendingFn: null, employees: [] });
                                        setAuthPin('');
                                        setAuthLoading(false);
                                    }}
                                    className="flex-1 py-3 bg-indigo-600 disabled:bg-slate-300 text-white rounded-xl font-black uppercase text-xs hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                                >
                                    {authLoading ? <RefreshCw size={16} className="animate-spin"/> : <ShieldCheck size={16}/>}
                                    AUTORIZAR
                                </button>
                            </div>
                        </div>
                    </div>
                , document.body)}

                {/* ── MODAL CAPACIDAD CCT POR EMPLEADO ── */}
                {showCapacityModal && autoV2GenStats && createPortal(
                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCapacityModal(false)}>
                        <div className="bg-white p-6 rounded-xl shadow-2xl w-[860px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <h3 className="font-black text-lg mb-1 flex items-center gap-2">
                                <span className="text-indigo-600">Cap. CCT</span>
                                <span className="text-slate-700">Capacidad por empleado — ciclo CCT</span>
                            </h3>
                            {(() => {
                                const fmt = (d: Date) => {
                                    const dd = String(d.getDate()).padStart(2,'0');
                                    const mes = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][d.getMonth()];
                                    return `${dd}-${mes}-${d.getFullYear()}`;
                                };
                                const yr = currentDate.getFullYear();
                                const mo = currentDate.getMonth();
                                const lastDay = new Date(yr, mo + 1, 0).getDate();
                                const startCurr = new Date(yr, mo - 1, 26);
                                const endCurr = new Date(yr, mo, 25);
                                const startNext = new Date(yr, mo, 26);
                                const endNext = new Date(yr, mo + 1, 25);
                                const monthName = currentDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
                                return (
                                    <>
                                        <p className="text-xs text-slate-600 font-medium mb-1">
                                            Cronograma visualizado: <b className="text-indigo-700">{monthName}</b> (días 1..{lastDay}).
                                        </p>
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 text-[11px]">
                                                <div className="font-black text-indigo-800">Ciclo CCT actual (Current)</div>
                                                <div className="text-slate-700"><b>{fmt(startCurr)}</b> → <b>{fmt(endCurr)}</b></div>
                                                <div className="text-[10px] text-slate-500 mt-0.5">Cola del mes anterior (días 26..fin) + días 1..25 de este mes.</div>
                                            </div>
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px]">
                                                <div className="font-black text-amber-800">Ciclo CCT siguiente (Next)</div>
                                                <div className="text-slate-700"><b>{fmt(startNext)}</b> → <b>{fmt(endNext)}</b></div>
                                                <div className="text-[10px] text-slate-500 mt-0.5">Días 26..fin de este mes pertenecen al próximo ciclo.</div>
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-500 font-medium mb-4">
                                            Tope CCT 422/05: <b>{planningLimits.monthly}h por ciclo</b>. La tabla refleja la <b>última automatización</b> de este objetivo: si corregiste datos o filtros, volvé a <b>generar</b> para actualizarla.
                                            La cola del ciclo (26..mes anterior) solo suma turnos <b>de este objetivo</b> y <b>no operativos</b> (reten / cobertura ops. / SLA virtual), para no mezclar con otros cronogramas. Los borradores sí se cuentan (siguen siendo crono planificado).
                                        </p>
                                    </>
                                );
                            })()}
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="w-full text-[11px] bg-white">
                                    <thead className="bg-slate-50 text-slate-700">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-black uppercase tracking-wide">Empleado</th>
                                            <th className="text-left px-3 py-2 font-black uppercase tracking-wide">Puesto</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide">Hs. Mes</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide">CCT Current</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide">CCT Next</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide">Buffer Curr.</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide">Buffer Next</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide" title="Cantidad de RETs (retenido stand-by) que tiene asignados el empleado en el mes. Cada RET = potencial 8h de cobertura para otros objetivos.">RET</th>
                                            <th className="text-right px-3 py-2 font-black uppercase tracking-wide" title="Horas RET potenciales = cantidad de RETs × 8h. NO suman a horas trabajadas, son horas de stand-by disponibles para activar como cobertura.">Hs RET</th>
                                            <th className="text-left px-3 py-2 font-black uppercase tracking-wide">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(() => {
                                            const empMap: Record<string, any> = {};
                                            displayedEmployees.forEach((e:any) => { empMap[e.id] = e; });
                                            const idleSet = new Set(autoV2GenStats.idleEmployeeIds || []);
                                            const posByEmp: Record<string, string> = {};
                                            Object.entries(autoV2GenStats.positionGroups || {}).forEach(([pos, ids]) => {
                                                (ids as string[]).forEach(id => { posByEmp[id] = pos; });
                                            });
                                            const rows = displayedEmployees.map((emp:any) => {
                                                const monthH = autoV2GenStats.employeeMonthlyHours[emp.id] || 0;
                                                const curr = autoV2GenStats.employeeCycleHours.current[emp.id] || 0;
                                                const next = autoV2GenStats.employeeCycleHours.next[emp.id] || 0;
                                                const bufCurr = Math.max(0, 200 - curr);
                                                const bufNext = Math.max(0, 200 - next);
                                                const retCount = (autoV2GenStats.employeeRetCount || {})[emp.id] || 0;
                                                const retHours = (autoV2GenStats.employeeRetHoursPotential || {})[emp.id] || 0;
                                                const pos = posByEmp[emp.id] || (idleSet.has(emp.id) ? '—' : 'Sin puesto');
                                                const isIdle = idleSet.has(emp.id);
                                                const isCapped = curr >= planningLimits.monthly || next >= planningLimits.monthly;
                                                const isHigh = curr >= 192 || next >= 192;
                                                const status = isIdle ? 'Capacidad ociosa' :
                                                    isCapped ? `CAP ${planningLimits.monthly}h alcanzado` :
                                                    isHigh ? 'Cerca del cap (≥192h)' :
                                                    bufCurr + bufNext >= 40 ? 'Disponible para más' :
                                                    'Carga normal';
                                                const statusColor = isIdle ? 'text-slate-400' :
                                                    isCapped ? 'text-rose-600' :
                                                    isHigh ? 'text-amber-600' :
                                                    bufCurr + bufNext >= 40 ? 'text-emerald-600' :
                                                    'text-slate-600';
                                                return { emp, monthH, curr, next, bufCurr, bufNext, retCount, retHours, pos, status, statusColor };
                                            });
                                            // Ordenar: capped primero, después por buffer descendente
                                            rows.sort((a, b) => {
                                                const aCap = a.curr >= planningLimits.monthly || a.next >= planningLimits.monthly ? 0 : 1;
                                                const bCap = b.curr >= planningLimits.monthly || b.next >= planningLimits.monthly ? 0 : 1;
                                                if (aCap !== bCap) return aCap - bCap;
                                                return (b.bufCurr + b.bufNext) - (a.bufCurr + a.bufNext);
                                            });
                                            return rows.map((r) => (
                                                <tr key={r.emp.id} className="border-t border-slate-100 hover:bg-slate-50">
                                                    <td className="px-3 py-2 font-bold text-slate-700">{r.emp.name || r.emp.nombre}</td>
                                                    <td className="px-3 py-2 text-slate-500">{r.pos}</td>
                                                    <td className="px-3 py-2 text-right font-mono text-slate-700">{Math.round(r.monthH)}h</td>
                                                    <td className="px-3 py-2 text-right font-mono text-slate-700">{Math.round(r.curr)} / 200</td>
                                                    <td className="px-3 py-2 text-right font-mono text-slate-700">{Math.round(r.next)} / 200</td>
                                                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{Math.round(r.bufCurr)}h</td>
                                                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{Math.round(r.bufNext)}h</td>
                                                    <td className={`px-3 py-2 text-right font-mono ${r.retCount > 0 ? 'text-violet-700 font-bold' : 'text-slate-400'}`} title={r.retCount > 0 ? `${r.retCount} RET(s) en stand-by` : 'Sin RETs'}>{r.retCount}</td>
                                                    <td className={`px-3 py-2 text-right font-mono ${r.retHours > 0 ? 'text-violet-700' : 'text-slate-400'}`} title={r.retHours > 0 ? `Hasta ${r.retHours}h potenciales activables como cobertura` : ''}>{r.retHours}h</td>
                                                    <td className={`px-3 py-2 font-bold ${r.statusColor}`}>{r.status}</td>
                                                </tr>
                                            ));
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                                <div className="bg-slate-50 rounded-lg p-3">
                                    <div className="font-black text-slate-700 mb-1">Cómo leer la tabla</div>
                                    <ul className="text-slate-600 space-y-1 list-disc list-inside">
                                        <li><b>CCT Current</b>: horas ya consumidas en el ciclo CCT del mes actual (incluye cola del mes anterior).</li>
                                        <li><b>CCT Next</b>: horas asignadas al ciclo siguiente (días 26..fin de este mes).</li>
                                        <li><b>Buffer</b>: horas libres hasta llegar a 200h en cada ciclo.</li>
                                        <li><b>RET / Hs RET</b>: cantidad de días en stand-by (retenido) y horas potenciales (RET × 8h). NO suman a horas trabajadas — son capacidad disponible para cubrir ausencias en otros objetivos.</li>
                                    </ul>
                                </div>
                                <div className="bg-slate-50 rounded-lg p-3">
                                    <div className="font-black text-slate-700 mb-1">Estado</div>
                                    <ul className="text-slate-600 space-y-1 list-disc list-inside">
                                        <li><span className="text-rose-600 font-bold">CAP 200h</span>: no se le pueden agregar más turnos en ese ciclo.</li>
                                        <li><span className="text-amber-600 font-bold">≥192h</span>: cerca del cap, no apto para horas extras en otros objetivos.</li>
                                        <li><span className="text-emerald-600 font-bold">Disponible</span>: tiene buffer ≥40h para otros objetivos o emergencias.</li>
                                    </ul>
                                </div>
                            </div>
                            <div className="flex justify-end mt-4">
                                <button onClick={() => setShowCapacityModal(false)} className="px-5 py-2 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* ── Modal cobertura de ausencias (planificación) ── */}
                {planCoverageModalGaps.length > 0 && (() => {
                    const bandMeta: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
                        M:   { name: 'Mañana',   hours: 8,  startTime: '07:00', endTime: '15:00' },
                        T:   { name: 'Tarde',    hours: 8,  startTime: '15:00', endTime: '23:00' },
                        N:   { name: 'Noche',    hours: 8,  startTime: '23:00', endTime: '07:00' },
                        D12: { name: 'Diurno',   hours: 12, startTime: '07:00', endTime: '19:00' },
                        N12: { name: 'Nocturno', hours: 12, startTime: '19:00', endTime: '07:00' },
                    };
                    const objectiveEmpIds = new Set(planningDotacionEmployees.map((e: any) => e.id));
                    return (
                        <PlanningCoverageModal
                            gaps={planCoverageModalGaps}
                            objectiveEmpIds={objectiveEmpIds}
                            objLat={selectedObjectiveData?.lat ?? null}
                            objLng={selectedObjectiveData?.lng ?? null}
                            objectiveId={selectedObjective}
                            pendingChanges={pendingChanges}
                            shiftsMap={shiftsMap}
                            empresaId={empresaId || ''}
                            positionName={positionStructure[0]?.positionName ?? 'General'}
                            onAssignExternal={(empId, nombre) => {
                                const updates: Record<string, any> = {};
                                const gapKeys: string[] = [];
                                for (const gap of planCoverageModalGaps) {
                                    const meta = bandMeta[gap.band] ?? bandMeta.M;
                                    updates[`${empId}_${gap.dateStr}`] = {
                                        isTemp: true,
                                        employeeId: empId,
                                        objectiveId: selectedObjective,
                                        positionName: gap.positionName || positionStructure[0]?.positionName || 'General',
                                        code: gap.band,
                                        name: meta.name,
                                        hours: meta.hours,
                                        startTime: meta.startTime,
                                        endTime: meta.endTime,
                                        isFranco: false,
                                    };
                                    // Marcar la celda del ausente con quién lo cubre → aparece en "4. CUBIERTO POR"
                                    const absentKey = `${gap.absentEmpId}_${gap.dateStr}`;
                                    const existingAbsent = pendingChanges[absentKey] || shiftsMap[absentKey] || {};
                                    updates[absentKey] = { ...existingAbsent, coveredBy: nombre };
                                    gapKeys.push(absentKey);
                                }
                                const n = planCoverageModalGaps.length;
                                setPendingChanges(prev => ({ ...prev, ...updates }));
                                setAutoCoverageGaps(prev => prev.map(g =>
                                    gapKeys.includes(`${g.absentEmpId}_${g.dateStr}`)
                                        ? { ...g, coverageType: 'manual' as const, coveredBy: empId, coveredByName: nombre }
                                        : g
                                ));
                                setCoverageSelectedDays(prev => { const next = new Set(prev); gapKeys.forEach(k => next.delete(k)); return next; });
                                // Cobertura externa: cada día asignado agrega horas de la banda (N=8h, M=8h, T=8h)
                                const bandHrs = bandMeta[planCoverageModalGaps[0]?.band ?? 'N']?.hours ?? 8;
                                applyCoverageToStats(n, n * bandHrs);
                                toast.success(`${nombre.split(',')[0]} asignado a ${n} día(s) (+${n * bandHrs}h)`);
                                setPlanCoverageModalGaps([]);
                            }}
                            onAssignD12={() => {
                                // D12 interno: D12 + N12 = cubre las 24hs con 2 guardias en vez de 3 (M+T+N).
                                // Cada banda ausente requiere DOS cambios en la grilla:
                                //   N ausente → T→N12 (cubre 19-07) + M→D12 (cubre 07-19, reemplaza el T vacante)
                                //   M ausente → T→D12 (cubre 07-19) + N→N12 (cubre 19-07, reemplaza el T vacante)
                                //   T ausente → M→D12 (cubre 07-19) + N→N12 (cubre 19-07)
                                type Ext = { lookFor: string; code: string; name: string; hours: number; startTime: string; endTime: string };
                                const D12_PAIRS: Record<string, [Ext, Ext]> = {
                                    N: [
                                        { lookFor: 'T', code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
                                        { lookFor: 'M', code: 'D12', name: 'Diurno 12h',   hours: 12, startTime: '07:00', endTime: '19:00' },
                                    ],
                                    M: [
                                        { lookFor: 'T', code: 'D12', name: 'Diurno 12h',   hours: 12, startTime: '07:00', endTime: '19:00' },
                                        { lookFor: 'N', code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
                                    ],
                                    T: [
                                        { lookFor: 'M', code: 'D12', name: 'Diurno 12h',   hours: 12, startTime: '07:00', endTime: '19:00' },
                                        { lookFor: 'N', code: 'N12', name: 'Nocturno 12h', hours: 12, startTime: '19:00', endTime: '07:00' },
                                    ],
                                };
                                const gapKeys = planCoverageModalGaps.map(g => `${g.absentEmpId}_${g.dateStr}`);
                                const n = planCoverageModalGaps.length;
                                const d12Updates: Record<string, any> = {};
                                let d12Count = 0;
                                for (const gap of planCoverageModalGaps) {
                                    const pair = D12_PAIRS[gap.band];
                                    if (!pair) continue;
                                    const gapPosName = gap.positionName || '';
                                    const alreadyChanged = new Set<string>();
                                    for (const ext of pair) {
                                        // Buscar primer compañero del MISMO PUESTO con esa banda, sin contar ya modificados
                                        const emp = planningDotacionEmployees.find((e: any) => {
                                            if (alreadyChanged.has(e.id)) return false;
                                            const key = `${e.id}_${gap.dateStr}`;
                                            const asig = d12Updates[key] ?? pendingChanges[key] ?? shiftsMap[key];
                                            if (asig?.code !== ext.lookFor) return false;
                                            // Verificar que sea del mismo puesto
                                            if (gapPosName) {
                                                const empPos = asig?.positionName || empDefaultPos[`${e.id}___${selectedObjective}`] || '';
                                                if (empPos && empPos !== gapPosName) return false;
                                            }
                                            return true;
                                        }) as any | undefined;
                                        if (emp) {
                                            const key = `${emp.id}_${gap.dateStr}`;
                                            const existing = pendingChanges[key] ?? shiftsMap[key] ?? {};
                                            d12Updates[key] = { ...existing, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective, positionName: gapPosName || existing.positionName, code: ext.code, name: ext.name, hours: ext.hours, startTime: ext.startTime, endTime: ext.endTime, isFranco: false };
                                            alreadyChanged.add(emp.id);
                                            d12Count++;
                                        }
                                    }
                                }
                                // Marcar la celda del ausente con "D12+N12" → visible en "4. CUBIERTO POR"
                                for (const gap of planCoverageModalGaps) {
                                    const absentKey = `${gap.absentEmpId}_${gap.dateStr}`;
                                    const existingAbsent = pendingChanges[absentKey] || shiftsMap[absentKey] || {};
                                    d12Updates[absentKey] = { ...existingAbsent, coveredBy: 'D12+N12 (extensión)' };
                                }
                                if (Object.keys(d12Updates).length > 0) setPendingChanges(prev => ({ ...prev, ...d12Updates }));
                                setAutoCoverageGaps(prev => prev.map(g =>
                                    gapKeys.includes(`${g.absentEmpId}_${g.dateStr}`)
                                        ? { ...g, coverageType: 'manual' as const, coveredBy: 'D12', coveredByName: 'D12+N12 (extensión)' }
                                        : g
                                ));
                                setCoverageSelectedDays(prev => { const next = new Set(prev); gapKeys.forEach(k => next.delete(k)); return next; });
                                // Cada extensión (T→N12 o M→D12) agrega 4h billables (de 8h a 12h)
                                applyCoverageToStats(n, d12Count * 4);
                                toast.success(`D12+N12 aplicado: ${d12Count} turno(s) extendido(s) en ${n} día(s) (+${d12Count * 4}h)`);
                                setPlanCoverageModalGaps([]);
                            }}
                            onClose={() => setPlanCoverageModalGaps([])}
                        />
                    );
                })()}

                {recompositionModalOpen && selectedCell?.dateStr && typeof document !== 'undefined' && createPortal(
                    <PlanningRecompositionModal
                        dateStr={selectedCell.dateStr}
                        objectiveId={selectedObjective}
                        objectiveName={getObjectiveName(selectedObjective)}
                        clientId={selectedClient || undefined}
                        employees={planningDotacionEmployees}
                        shiftsMap={shiftsMap}
                        pendingChanges={pendingChanges}
                        absencesMap={absencesMap}
                        preselectedEmpId={selectedCell.empId}
                        preselectedEmployeeName={
                            planningDotacionEmployees.find(e => e.id === selectedCell.empId)?.name
                            || displayedEmployees.find((e: { id: string; name?: string }) => e.id === selectedCell.empId)?.name
                        }
                        onApply={applyRecompositionPackage}
                        onRequestSupervisorAuth={(conflicts, onAuthorized) => {
                            requestSupervisorFrancoAuth(conflicts, onAuthorized, 'cobertura / liberación');
                        }}
                        onClose={() => setRecompositionModalOpen(false)}
                        currentObjectiveLat={Number(selectedObjectiveData?.lat ?? selectedObjectiveData?.latitude ?? 0) || null}
                        currentObjectiveLng={Number(selectedObjectiveData?.lng ?? selectedObjectiveData?.longitude ?? 0) || null}
                        allObjectives={clients.flatMap((c: any) =>
                            (c.objetivos || []).map((o: any) => ({
                                id: o.id || o.name,
                                name: o.name || o.id || '',
                                lat: Number(o.lat ?? o.latitude ?? 0) || null,
                                lng: Number(o.lng ?? o.longitude ?? 0) || null,
                                clientName: c.name || c.razonSocial || c.businessName || '',
                            }))
                        ).filter((o: any) => o.id)}
                        allEmployees={employees}
                    />,
                    document.body,
                )}

                {showCronogramasOverview && typeof document !== 'undefined' && createPortal(
                    <PlanningCronogramasOverviewModal
                        isOpen={showCronogramasOverview}
                        onClose={() => setShowCronogramasOverview(false)}
                        year={currentDate.getFullYear()}
                        month={currentDate.getMonth() + 1}
                        onMonthChange={(y, m) => setCurrentDate(new Date(y, m - 1, 1))}
                        empresaId={empresaId || ''}
                        migracionCompleta={migracionCompleta}
                        scopeEmpresa={scopeEmpresa}
                        clients={clients}
                        onNavigateToObjective={navigateToObjectiveFromOverview}
                    />,
                    document.body,
                )}

                {/* ── Modal verificación de cobertura post-generación ── */}
                {showCoverageModal && autoV2Coverage && createPortal(
                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCoverageModal(false)}>
                        <div className="bg-white p-6 rounded-xl shadow-2xl w-[900px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <h3 className="font-black text-lg mb-1 flex items-center gap-2">
                                <span className={`${autoV2Coverage.ok ? 'text-emerald-600' : autoV2Coverage.warnings ? 'text-amber-600' : 'text-rose-600'}`}>
                                    {autoV2Coverage.ok ? '✓' : autoV2Coverage.warnings ? '⚠' : '✗'}
                                </span>
                                <span className="text-slate-800">Verificación de cobertura</span>
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ml-auto">
                                    Resultado de la última automatización
                                </span>
                            </h3>
                            <p className="text-xs text-slate-500 font-medium mb-4">{autoV2Coverage.summary}</p>

                            <div className="grid grid-cols-4 gap-2 mb-4">
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                    <p className="text-[9px] font-black text-slate-500 uppercase">Slots cubiertos</p>
                                    <p className={`text-base font-black ${autoV2Coverage.coverage.uncoveredSlots > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                        {autoV2Coverage.coverage.coveredSlots} / {autoV2Coverage.coverage.totalSlots}
                                    </p>
                                    <p className="text-[10px] text-slate-500">{Math.round(autoV2Coverage.coverage.coverageRatio * 100)}%</p>
                                </div>
                                <div className={`border rounded-lg p-2 text-center ${autoV2Coverage.hours.slaVendidas > 0 && autoV2Coverage.hours.billableHoursGenerated < autoV2Coverage.hours.slaVendidas ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'}`}>
                                    <p className="text-[9px] font-black text-slate-500 uppercase">Hs. planificadas</p>
                                    <p className={`text-base font-black ${autoV2Coverage.hours.slaVendidas > 0 && autoV2Coverage.hours.billableHoursGenerated < autoV2Coverage.hours.slaVendidas ? 'text-rose-600' : 'text-indigo-700'}`}>{Math.round(autoV2Coverage.hours.billableHoursGenerated)}h</p>
                                    <p className="text-[10px] text-slate-500">de {Math.round(autoV2Coverage.hours.slaVendidas)}h vendidas</p>
                                </div>
                                <div className={`border rounded-lg p-2 text-center ${autoV2Coverage.hours.deltaPct < 0 ? 'bg-rose-50 border-rose-300' : autoV2Coverage.hours.deltaPct > 0.05 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                                    <p className="text-[9px] font-black text-slate-500 uppercase">Cierre</p>
                                    <p className={`text-base font-black ${autoV2Coverage.hours.deltaPct < 0 ? 'text-rose-600' : autoV2Coverage.hours.deltaPct > 0.05 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                        {autoV2Coverage.hours.deltaPct >= 0 ? '+' : ''}{(autoV2Coverage.hours.deltaPct * 100).toFixed(1)}%
                                    </p>
                                    <p className="text-[10px] text-slate-500">{autoV2Coverage.hours.deltaPct < 0 ? `−${Math.round(autoV2Coverage.hours.slaVendidas - autoV2Coverage.hours.billableHoursGenerated)}h` : '≥ vendidas ✓'}</p>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-center">
                                    <p className="text-[9px] font-black text-slate-500 uppercase">Conflictos duros</p>
                                    <p className={`text-base font-black ${(autoV2Coverage.restViolations.length + autoV2Coverage.licenseConflicts.length) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                        {autoV2Coverage.restViolations.length + autoV2Coverage.licenseConflicts.length}
                                    </p>
                                    <p className="text-[10px] text-slate-500">descansos + licencias</p>
                                </div>
                            </div>

                            {autoV2Suggestions && autoV2Suggestions.length > 0 && (
                                <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
                                    <h4 className="font-black text-sm text-indigo-800 mb-2">Sugerencias de optimización ({autoV2Suggestions.length})</h4>
                                    <ul className="max-h-40 overflow-y-auto space-y-1.5 text-[11px] text-slate-700">
                                        {autoV2Suggestions.slice(0, 40).map((s, i) => (
                                            <li
                                                key={`${s.code}_${i}`}
                                                className={
                                                    s.severity === 'error'
                                                        ? 'text-rose-800 font-semibold'
                                                        : s.severity === 'warning'
                                                          ? 'text-amber-900'
                                                          : 'text-slate-600'
                                                }
                                            >
                                                <span className="font-mono text-[9px] uppercase text-indigo-500 mr-1">{s.code}</span>
                                                {s.message}
                                            </li>
                                        ))}
                                    </ul>
                                    {autoV2Suggestions.length > 40 && (
                                        <p className="text-[10px] text-slate-500 mt-1">Mostrando 40 de {autoV2Suggestions.length}.</p>
                                    )}
                                </div>
                            )}

                            {autoV2Coverage.uncovered.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="font-black text-sm text-rose-700 mb-2">Slots sin cubrir ({autoV2Coverage.uncovered.length})</h4>
                                    <div className="max-h-48 overflow-y-auto rounded-lg border border-rose-200">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-rose-50 text-rose-800 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Fecha</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Día</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Puesto</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Turno</th>
                                                    <th className="text-right px-2 py-1.5 font-black uppercase">Faltan</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {autoV2Coverage.uncovered.slice(0, 200).map((u, i) => (
                                                    <tr key={i} className="border-t border-rose-100">
                                                        <td className="px-2 py-1 font-mono text-slate-700">{u.dateStr}</td>
                                                        <td className="px-2 py-1 text-slate-500">{u.dayLetter}</td>
                                                        <td className="px-2 py-1 text-slate-700">{u.positionName}</td>
                                                        <td className="px-2 py-1 font-bold text-slate-800">{u.shiftCode}</td>
                                                        <td className="px-2 py-1 text-right font-mono text-rose-700">{u.qtyRequested - u.qtyAssigned} / {u.qtyRequested}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {autoV2Coverage.uncovered.length > 200 && (
                                        <p className="text-[10px] text-slate-400 mt-1">Mostrando primeros 200 de {autoV2Coverage.uncovered.length}.</p>
                                    )}
                                </div>
                            )}

                            {autoV2Coverage.restViolations.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="font-black text-sm text-rose-700 mb-2">Descansos rotos ({autoV2Coverage.restViolations.length})</h4>
                                    <div className="max-h-40 overflow-y-auto rounded-lg border border-rose-200">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-rose-50 text-rose-800 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Empleado</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Fecha</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Turno</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Motivo</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {autoV2Coverage.restViolations.slice(0, 100).map((r, i) => {
                                                    const emp = displayedEmployees.find((e:any) => e.id === r.empId);
                                                    return (
                                                        <tr key={i} className="border-t border-rose-100">
                                                            <td className="px-2 py-1 text-slate-700">{emp?.name || emp?.nombre || r.empId}</td>
                                                            <td className="px-2 py-1 font-mono text-slate-700">{r.dateStr}</td>
                                                            <td className="px-2 py-1 font-bold text-slate-800">{r.shiftCode}</td>
                                                            <td className="px-2 py-1 text-rose-700 text-[10px]">{r.reason}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {autoV2Coverage.licenseConflicts.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="font-black text-sm text-rose-700 mb-2">Conflictos con licencias ({autoV2Coverage.licenseConflicts.length})</h4>
                                    <div className="max-h-32 overflow-y-auto rounded-lg border border-rose-200">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-rose-50 text-rose-800 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Empleado</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Fecha</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Turno</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Licencia</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {autoV2Coverage.licenseConflicts.map((c, i) => {
                                                    const emp = displayedEmployees.find((e:any) => e.id === c.empId);
                                                    return (
                                                        <tr key={i} className="border-t border-rose-100">
                                                            <td className="px-2 py-1 text-slate-700">{emp?.name || emp?.nombre || c.empId}</td>
                                                            <td className="px-2 py-1 font-mono text-slate-700">{c.dateStr}</td>
                                                            <td className="px-2 py-1 font-bold text-slate-800">{c.shiftCode}</td>
                                                            <td className="px-2 py-1 font-bold text-amber-700">{c.absenceCode}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {autoV2Coverage.overHours.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="font-black text-sm text-amber-700 mb-2">Empleados &gt; 200h por ciclo ({autoV2Coverage.overHours.length})</h4>
                                    <div className="max-h-32 overflow-y-auto rounded-lg border border-amber-200">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-amber-50 text-amber-800 sticky top-0">
                                                <tr>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Empleado</th>
                                                    <th className="text-left px-2 py-1.5 font-black uppercase">Ciclo</th>
                                                    <th className="text-right px-2 py-1.5 font-black uppercase">Horas</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {autoV2Coverage.overHours.map((o, i) => {
                                                    const emp = displayedEmployees.find((e:any) => e.id === o.empId);
                                                    return (
                                                        <tr key={i} className="border-t border-amber-100">
                                                            <td className="px-2 py-1 text-slate-700">{emp?.name || emp?.nombre || o.empId}</td>
                                                            <td className="px-2 py-1 font-bold text-slate-800">{o.cycle === 'current' ? 'Actual' : 'Siguiente'}</td>
                                                            <td className="px-2 py-1 text-right font-mono text-amber-700">{Math.round(o.hours)}h</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="bg-slate-50 rounded-lg p-3 text-[11px] text-slate-600 mb-3">
                                <div className="font-black text-slate-700 mb-1">Cómo interpretar</div>
                                <ul className="space-y-0.5 list-disc list-inside">
                                    <li><b className="text-rose-700">Slots sin cubrir</b>: hay menos personas que las pedidas por SLA. Subí dotación o pasá puestos a 12h para reducir slots.</li>
                                    <li><b className="text-rose-700">Descansos rotos</b>: el motor no debería generar esto. Si aparece, marcá la línea y avisá al equipo.</li>
                                    <li><b className="text-rose-700">Conflictos con licencias</b>: empleado asignado en día con ausencia activa. Generalmente indica una licencia agregada después de planificar.</li>
                                    <li><b className="text-amber-700">&gt;200h</b>: revisá si conviene mover horas al ciclo siguiente.</li>
                                </ul>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[11px] text-slate-500">
                                    {autoV2Coverage.ok
                                        ? 'Cobertura sin errores duros. Podés guardar.'
                                        : `Se detectaron ${autoV2Coverage.uncovered.length} slots, ${autoV2Coverage.restViolations.length} descansos y ${autoV2Coverage.licenseConflicts.length} conflictos.`}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => setShowCoverageModal(false)} className="px-5 py-2 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* ── Modal automatizar cronograma (motor COSP) ── */}
                {showAutoV2Modal && createPortal(
                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { if (!autoV2Loading && !autoV2Generating) setShowAutoV2Modal(false); }}>
                        <div className="bg-white rounded-xl shadow-2xl w-[760px] max-w-[95vw] max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

                            {/* Header */}
                            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                                <div className="flex items-center gap-2">
                                    <Wand2 size={18} className="text-amber-600 shrink-0"/>
                                    <h3 className="font-black text-base text-slate-800">Automatizar cronograma</h3>
                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">COSP</span>
                                </div>
                                <button type="button" onClick={() => { if (!autoV2Loading && !autoV2Generating) setShowAutoV2Modal(false); }} disabled={autoV2Loading || autoV2Generating} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 transition-colors">
                                    <X size={18}/>
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-3">

                                {/* preflight configure — se muestra en panel derecho del layout 2 paneles */}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2CoveragePreflight && (
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1">Objetivo pedía (SLA)</p>
                                        <p className="text-[10px] text-slate-700 font-bold">
                                            {Object.entries(autoV2CoveragePreflight.monthBandDemand).map(([c, n]) => `${n}×${c}`).join(' · ')} en el mes
                                        </p>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            Ej. día tipo: {formatDayDemandSummary(autoV2CoveragePreflight.dayDemands.find(d => d.totalPaxUnits > 0) || autoV2CoveragePreflight.dayDemands[0])}
                                        </p>
                                    </div>
                                )}

                                {/* Paso 1: configuración — layout 2 paneles */}
                                {autoWizardStep === 'configure' && !autoV2Loading && !autoV2Generating && (
                                    <div className="flex gap-5">

                                        {/* ── PANEL IZQUIERDO: opciones ── */}
                                        <div className="w-[248px] shrink-0 space-y-4">

                                            {/* Cómputo de horas */}
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Cómputo de horas</p>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('budget-cct')} onClick={() => setAutoV2BudgetMode('cct')}
                                                        className={`py-3 px-3 rounded-xl text-left border-2 transition-colors ${autoV2BudgetMode === 'cct' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-200'}`}>
                                                        <div className={`text-[11px] font-black ${autoV2BudgetMode === 'cct' ? 'text-amber-800' : 'text-slate-600'}`}>CCT</div>
                                                        <div className={`text-[9px] font-bold mt-0.5 ${autoV2BudgetMode === 'cct' ? 'text-amber-600' : 'text-slate-400'}`}>por tramos</div>
                                                        {autoV2BudgetMode === 'cct' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" />}
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('budget-calendar')} onClick={() => setAutoV2BudgetMode('calendar')}
                                                        className={`py-3 px-3 rounded-xl text-left border-2 transition-colors ${autoV2BudgetMode === 'calendar' ? 'border-amber-500 bg-amber-50' : 'border-slate-200 hover:border-amber-200'}`}>
                                                        <div className={`text-[11px] font-black ${autoV2BudgetMode === 'calendar' ? 'text-amber-800' : 'text-slate-600'}`}>Simple</div>
                                                        <div className={`text-[9px] font-bold mt-0.5 ${autoV2BudgetMode === 'calendar' ? 'text-amber-600' : 'text-slate-400'}`}>200h netas</div>
                                                        {autoV2BudgetMode === 'calendar' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5" />}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Ciclo de trabajo */}
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Ciclo de trabajo</p>
                                                <div className="px-3 py-3 rounded-xl border-2 border-indigo-400 bg-indigo-50">
                                                    <div className="text-[11px] font-black text-indigo-800">Esquema 6+2 · fijo</div>
                                                    <div className="text-[9px] font-bold mt-0.5 text-indigo-500">6 días trabajo · 2 franco · D12/N12 solo por ajustar o licencias</div>
                                                </div>
                                            </div>

                                            {/* Opciones */}
                                            <div>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Opciones</p>
                                                <div className="space-y-1.5">
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('overwrite')} onClick={() => setAutoOverwrite(p => !p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${autoOverwrite ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoOverwrite ? 'bg-slate-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoOverwrite ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoOverwrite ? 'text-slate-800' : 'text-slate-500'}`}>Sobreescribir celdas</div>
                                                            <div className="text-[9px] font-bold text-slate-400">reemplaza asignaciones existentes</div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('coverage')} onClick={() => setAutoCoverAbsences(p => !p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${autoCoverAbsences ? 'border-teal-300 bg-teal-50' : 'border-slate-200 hover:border-teal-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoCoverAbsences ? 'bg-teal-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoCoverAbsences ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoCoverAbsences ? 'text-teal-800' : 'text-slate-500'}`}>Cobertura de ausencias</div>
                                                            <div className="text-[9px] font-bold text-slate-400">asigna reemplazos por V/L/E/A/PG</div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('rotate')} onClick={() => setAutoRotateForce(p => { const cur = p ?? autoPlanningBrainReport?.rotateShifts ?? true; return !cur; })}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-emerald-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) ? 'text-emerald-800' : 'text-slate-500'}`}>Turnos rotativos M→T→N</div>
                                                            <div className="text-[9px] font-bold text-slate-400">
                                                                Auto {autoPlanningBrainReport?.rotateShifts ? 'ON' : 'OFF'}
                                                                {autoRotateForce !== null ? (autoRotateForce ? ' · forzado ON' : ' · forzado OFF') : ' · tocá para forzar'}
                                                            </div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('sixone')} onClick={() => setUseSixPlusOne(p => !p)}
                                                        disabled={!(planningDotacionEmployees.length % 6 === 0 && planningDotacionEmployees.length >= 6)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors disabled:opacity-40 ${useSixPlusOne ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-emerald-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${useSixPlusOne ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${useSixPlusOne ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${useSixPlusOne ? 'text-emerald-800' : 'text-slate-500'}`}>Ciclo 6+1 · banda fija</div>
                                                            <div className="text-[9px] font-bold text-slate-400">
                                                                {planningDotacionEmployees.length % 6 === 0 && planningDotacionEmployees.length >= 6
                                                                    ? `${planningDotacionEmployees.length / 6} grupo(s) de 6 · 85.7%`
                                                                    : `múltiplo de 6 requerido (actual: ${planningDotacionEmployees.length})`}
                                                            </div>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Contingencia */}
                                            <div onMouseEnter={() => setAutoHelpTopic('contingency')}>
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Contingencia — Modo 12</p>
                                                <div className="flex flex-wrap gap-1">
                                                    {daysInMonth.map(day => {
                                                        const ds = getDateKey(day);
                                                        const sel = autoContingenciaDias.has(ds);
                                                        const isWe = day.getDay() === 0 || day.getDay() === 6;
                                                        return (
                                                            <button key={ds} type="button" title={ds}
                                                                onClick={() => { setAutoContingenciaDias(prev => { const next = new Set(prev); if (next.has(ds)) next.delete(ds); else next.add(ds); return next; }); }}
                                                                className={`min-w-[1.65rem] h-6 rounded text-[10px] font-black border transition-colors ${sel ? 'bg-violet-600 text-white border-violet-700' : isWe ? 'bg-rose-50 text-rose-600 border-rose-200 hover:border-violet-300' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>
                                                                {day.getDate()}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                {autoContingenciaDias.size > 0 && <p className="text-[9px] font-bold text-violet-700 mt-1">{autoContingenciaDias.size} día(s) · D12+N12</p>}
                                            </div>

                                            {/* Ausencias detectadas */}
                                            {autoV2CoveragePreflight && autoV2CoveragePreflight.employees.some(e => e.blockedCount > 0) && (
                                                <div onMouseEnter={() => setAutoHelpTopic('absences')}>
                                                    <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Ausencias en el mes</p>
                                                    <div className="space-y-1.5">
                                                        {autoV2CoveragePreflight.employees.filter(e => e.blockedCount > 0).map(emp => {
                                                            const absMap = autoAbsencesMap[emp.empId];
                                                            const absDates = [...emp.blockedDays].sort();
                                                            const codes = absMap
                                                                ? [...new Set([...absMap.values()].filter(c => ['V','L','E','A','PG','AA'].includes(c)))]
                                                                : [];
                                                            return (
                                                                <div key={emp.empId} className="px-2.5 py-2 rounded-xl border-2 border-amber-200 bg-amber-50">
                                                                    <div className="flex items-start justify-between gap-1.5">
                                                                        <div className="min-w-0">
                                                                            <div className="text-[10px] font-black text-amber-800 truncate">{emp.nombre}</div>
                                                                            <div className="text-[9px] font-bold text-amber-600 mt-0.5">
                                                                                {emp.blockedCount} día(s){codes.length > 0 && ` · ${codes.join('/')}`}
                                                                            </div>
                                                                        </div>
                                                                        <span className="shrink-0 text-[9px] font-black px-2 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-600">
                                                                            D12 auto
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {autoCoverAbsences && (
                                                        <p className="text-[9px] font-bold text-teal-700 mt-1.5">Cobertura auto activa · RET → banda del ausente</p>
                                                    )}
                                                </div>
                                            )}

                                            {/* Avanzado */}
                                            <div className="border-t border-slate-100 pt-3">
                                                <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-2">Avanzado</p>
                                                <div className="space-y-1.5">
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('intensive')}
                                                        onClick={() => (autoRotateForce ?? autoPlanningBrainReport?.rotateShifts) && setAutoAjustarCrono(p => !p)}
                                                        disabled={!(autoRotateForce ?? autoPlanningBrainReport?.rotateShifts)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors disabled:opacity-30 ${autoAjustarCrono ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-violet-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoAjustarCrono ? 'bg-violet-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoAjustarCrono ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoAjustarCrono ? 'text-violet-800' : 'text-slate-500'}`}>Intensivo mes completo</div>
                                                            <div className="text-[9px] font-bold text-slate-400">4+2→6+1 · más RET</div>
                                                        </div>
                                                    </button>
                                                    <button type="button" onMouseEnter={() => setAutoHelpTopic('gemini')} onClick={() => setAutoV2RunGemini(p => !p)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${autoV2RunGemini ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}>
                                                        <div className={`relative w-8 h-4 rounded-full shrink-0 transition-colors ${autoV2RunGemini ? 'bg-indigo-500' : 'bg-slate-200'}`}>
                                                            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${autoV2RunGemini ? 'translate-x-4' : ''}`} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className={`text-[11px] font-black ${autoV2RunGemini ? 'text-indigo-800' : 'text-slate-500'}`}>Ajuste fino IA (Gemini)</div>
                                                            <div className="text-[9px] font-bold text-slate-400">opcional · 30-60s extra</div>
                                                        </div>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── PANEL DERECHO: explicación + diagnóstico ── */}
                                        <div className="flex-1 flex flex-col gap-3 min-w-0">

                                            {/* Card explicación dinámica */}
                                            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3.5 flex-1 min-h-[200px]">
                                                {autoHelpTopic === 'default' && (
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-2">Cómo funciona el motor COSP</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Genera el cronograma del mes completo en base a la dotación y el SLA del objetivo.</p>
                                                        <div className="space-y-1.5 text-[10px] font-bold text-slate-600">
                                                            <div className="flex items-start gap-2"><span className="text-amber-600 shrink-0">Modo 8</span><span>M+T+N con franco rotativo. Para cada día: 3 trabajan, 1 descansa.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-amber-600 shrink-0">Modo 12</span><span>D12+N12 automático cuando hay vacaciones/licencia/enfermedad en la dotación.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-violet-600 shrink-0">Contingencia</span><span>D12+N12 manual en fechas específicas para liberar RETs.</span></div>
                                                        </div>
                                                        {autoV2CoveragePreflight && (
                                                            <div className="mt-3 pt-2.5 border-t border-slate-200">
                                                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Demanda del objetivo</p>
                                                                <p className="text-[10px] font-bold text-slate-700">{Object.entries(autoV2CoveragePreflight.monthBandDemand).map(([c, n]) => `${n}×${c}`).join(' · ')} · <span className="text-amber-700">{slaVendidas}h vendidas</span></p>
                                                                {autoV2CoveragePreflight.totalAbsenceDays > 0 && <p className="text-[10px] font-bold text-amber-700 mt-0.5">{autoV2CoveragePreflight.totalAbsenceDays} días con ausencias/licencias</p>}
                                                            </div>
                                                        )}
                                                        <p className="mt-3 text-[9px] text-slate-400 font-bold">Pasá el cursor sobre una opción para ver su descripción.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'budget-cct' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">CCT por tramos</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Calcula las horas según el convenio 422/05, dividiendo el mes en dos tramos:</p>
                                                        <div className="space-y-1 text-[10px] font-bold text-slate-600 mb-3"><div><strong>T1</strong> · días 1–24: horas normales hasta el tope del tramo.</div><div><strong>T2</strong> · días 25–fin: cola acumulada del mes.</div></div>
                                                        <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">✓ Recomendado para la mayoría de objetivos con guardias bajo CCT 422/05.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'budget-calendar' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">Calendario simple</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Cuenta las horas de corrido sin dividir el mes en tramos. Límite único: <strong>200h netas</strong> por mes.</p>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">Más flexible, pero puede no respetar exactamente el CCT. Usalo cuando el objetivo tiene acuerdo particular o no está bajo convenio.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'scheme-fixed' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-indigo-800 mb-2">Esquema 6+2 · fijo</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Todos los empleados trabajan <strong>6 días seguidos y descansan 2</strong>. Ciclo idéntico para toda la dotación.</p>
                                                        <div className="text-[10px] font-mono font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2 mb-3">LLLLLLFF · LLLLLLFF · LLLLLLFF…</div>
                                                        <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-2">✓ Más fácil de supervisar y auditar. <strong>Recomendado</strong> para la mayoría de objetivos.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'scheme-auto' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">Esquema automático</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">El cerebro elige el ciclo más eficiente: puede usar <strong>6+2, 6+1 o 4+2</strong> para distintos empleados según la dotación.</p>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">⚠ Puede mezclar ciclos — la grilla se vuelve más difícil de leer. Usalo solo para experimentar con dotaciones no estándar.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'overwrite' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-slate-800 mb-2">Sobreescribir celdas</p>
                                                        <div className="space-y-2 text-[10px] font-bold">
                                                            <div className="rounded-lg bg-slate-100 px-2.5 py-2 text-slate-700"><strong>OFF</strong> (recomendado) — solo rellena celdas vacías. Las asignaciones manuales que ya hiciste se preservan.</div>
                                                            <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 text-amber-800"><strong>ON</strong> — el motor reemplaza todo, incluso lo que editaste a mano. Útil si querés empezar desde cero.</div>
                                                        </div>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'coverage' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-teal-800 mb-2">Cobertura de ausencias</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Cuando está activo, tras generar el crono el motor asigna reemplazos para V, L, E, A y PG pre-declaradas.</p>
                                                        <div className="space-y-1.5 text-[10px] font-bold text-slate-600 mb-3">
                                                            <div className="flex items-start gap-2"><span className="text-teal-600 shrink-0 font-black">1.</span><span><strong>Sin turno</strong> — empleado libre ese día (F o sin asignación).</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-teal-600 shrink-0 font-black">2.</span><span><strong>RET</strong> — vigilador en stand-by, se convierte al turno que cubre.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-amber-600 shrink-0 font-black">3.</span><span><strong>FT requerido</strong> — sin candidato: se avisa en toast. El operador lo resuelve manualmente.</span></div>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-teal-700 bg-teal-50 rounded-lg px-2.5 py-2">Solo actúa en el motor 6+2 bandas fijas. ESC y ext.12hs se gestionan desde Operaciones.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'rotate' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-emerald-800 mb-2">Turnos rotativos M→T→N</p>
                                                        <div className="space-y-2 text-[10px] font-bold mb-2">
                                                            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-emerald-800"><strong>ON</strong> — los empleados rotan de banda cada ciclo (péndulo M→T→N→T→M). Distribuye el desgaste nocturno.</div>
                                                            <div className="rounded-lg bg-slate-100 px-2.5 py-2 text-slate-700"><strong>OFF</strong> (banda fija) — cada empleado mantiene su turno todo el mes. Más predecible para el guardia.</div>
                                                        </div>
                                                        <p className="text-[9px] text-slate-400 font-bold">El cerebro decide automáticamente. Podés forzarlo acá.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'sixone' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-emerald-800 mb-2">Ciclo 6+1 · banda fija</p>
                                                        <p className="text-[11px] font-bold text-slate-700 mb-2">Ciclo de <strong>7 días</strong>: 6 de trabajo + 1 franco. Eficiencia <strong>85.7%</strong> (vs 75% del 6+2).</p>
                                                        <div className="text-[10px] font-mono font-bold text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2 mb-2">LLLLLLF · LLLLLLF · LLLLLLF…</div>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">Más horas facturables por mes, pero menos descanso acumulado. Requiere múltiplo de 6 guardias.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'contingency' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-violet-800 mb-2">Contingencia — Modo 12 manual</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Seleccioná fechas para activar <strong>D12+N12</strong> y liberar RETs ese día. Útil para eventos o picos de demanda.</p>
                                                        <p className="text-[10px] font-bold text-slate-600 mb-2">El motor reorganiza quién trabaja — <strong>no convierte francos en turnos</strong>.</p>
                                                        <p className="text-[10px] font-bold text-violet-700 bg-violet-50 rounded-lg px-2.5 py-2">Los días con V/L/E en la dotación ya activan Modo 12 automáticamente.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'intensive' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-violet-800 mb-2">Intensivo mes completo</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Combina ciclos cortos (4+2, 6+1) para maximizar días de trabajo y horas facturables. Genera más RETs disponibles.</p>
                                                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">⚠ Requiere turnos rotativos ON. Solo para objetivos con alta demanda continua donde el 6+2 no alcanza.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'gemini' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-indigo-800 mb-2">Ajuste fino IA (Gemini)</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Después de generar, <strong>Gemini</strong> revisa y aplica micro-ajustes para mejorar la distribución de horas y cerrar huecos pequeños. No regenera desde cero.</p>
                                                        <p className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-lg px-2.5 py-2">Demora 30–60 segundos extra. Opcional.</p>
                                                    </div>
                                                )}
                                                {autoHelpTopic === 'absences' && (
                                                    <div>
                                                        <p className="text-[12px] font-black text-amber-800 mb-2">Ausencias en el mes</p>
                                                        <p className="text-[11px] font-bold text-slate-700 leading-relaxed mb-2">Empleados con V/L/E/A/PG reducen la dotación disponible. Tenés dos herramientas para compensar:</p>
                                                        <div className="space-y-1.5 text-[10px] font-bold text-slate-600 mb-3">
                                                            <div className="flex items-start gap-2"><span className="text-violet-600 font-black shrink-0">D12 auto</span><span>El cerebro activa D12+N12 automáticamente en días V/L/E. No necesitás agregarlo a contingencia manual.</span></div>
                                                            <div className="flex items-start gap-2"><span className="text-teal-600 font-black shrink-0">Cob. Auto</span><span>Asigna automáticamente el RET disponible del mismo objetivo a la banda del ausente (M→M, N→N, etc.).</span></div>
                                                        </div>
                                                        <p className="text-[10px] font-bold text-teal-700 bg-teal-50 rounded-lg px-2.5 py-2">Activá <strong>Cobertura de ausencias</strong> para que el RET libre cubra la banda automáticamente.</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Diagnóstico (si el cerebro ya corrió) */}
                                            {autoPlanningBrainReport?.diagnosis && (
                                                <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 space-y-2">
                                                    <p className="text-[9px] font-black uppercase tracking-wide text-indigo-500">Diagnóstico del esquema</p>
                                                    <div className="grid grid-cols-2 gap-1.5">
                                                        <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Demanda</p>
                                                            <p className="text-[10px] font-bold text-slate-800">{autoPlanningBrainReport.diagnosis.demand.slotsPerDay} slots/día · {Math.round(autoPlanningBrainReport.diagnosis.demand.soldHours)}h vendidas</p>
                                                        </div>
                                                        <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Oferta</p>
                                                            <p className="text-[10px] font-bold text-slate-800">{autoPlanningBrainReport.diagnosis.supply.peopleAvailable} guardias · plantilla 6+2: {autoPlanningBrainReport.diagnosis.supply.plantillaRequired6x2}</p>
                                                        </div>
                                                    </div>
                                                    <div className={`rounded-lg px-2.5 py-1.5 border text-[10px] font-bold ${autoPlanningBrainReport.diagnosis.balance === 'exact' ? 'bg-emerald-100 border-emerald-300 text-emerald-900' : autoPlanningBrainReport.diagnosis.balance === 'surplus' ? 'bg-amber-100 border-amber-300 text-amber-900' : 'bg-rose-100 border-rose-300 text-rose-900'}`}>
                                                        <span className="text-[9px] uppercase opacity-70">Balance · </span>{autoPlanningBrainReport.diagnosis.balanceLabel}
                                                        {autoPlanningBrainReport.strictSixTwo && <span className="block text-[9px] mt-0.5 text-emerald-700">6+2 estricto · bandas fijas + flotante</span>}
                                                    </div>
                                                    {autoPlanningBrainReport.recommendedAlternative && !autoAjustarCrono && (
                                                        <button type="button" onClick={() => {
                                                            const alt = autoPlanningBrainReport.recommendedAlternative!;
                                                            const baseInput = autoPlanningBrainInputRef.current;
                                                            if (!baseInput) return;
                                                            const newBrain = resolveAutoPlanningBrain({ ...baseInput, cycleOverride: alt });
                                                            autoPlanningBrainRef.current = newBrain;
                                                            setAutoPlanningBrainReport(newBrain);
                                                            autoSelectedCyclesRef.current = newBrain.cycles;
                                                            setAutoCycles(newBrain.cycles);
                                                        }} className="w-full text-left text-[10px] font-bold rounded-lg px-2 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors">
                                                            💡 <strong>{autoPlanningBrainReport.recommendedAlternative}</strong> también es viable — clic para aplicar
                                                        </button>
                                                    )}
                                                    {/* Acción rápida: sobran personas → desasignar del objetivo */}
                                                    {autoPlanningBrainReport.diagnosis.balance === 'surplus' && (autoPlanningBrainReport.diagnosis.headcountDelta ?? 0) > 0 && (
                                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 space-y-1">
                                                            <p className="text-[9px] font-black uppercase text-amber-800">Sobra personal · desasignar del objetivo</p>
                                                            <div className="max-h-28 overflow-y-auto space-y-0.5">
                                                                {planningDotacionEmployees.map(emp => (
                                                                    <div key={emp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-amber-100">
                                                                        <span className="text-[10px] font-bold text-slate-800 truncate">{emp.nombre || emp.name}</span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleUnassignEmployee(emp).then(() => setAutoWizardStep('configure'))}
                                                                            className="shrink-0 text-[9px] font-black text-rose-600 hover:text-rose-800 uppercase px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 hover:border-rose-400 transition-colors"
                                                                        >Quitar</button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Acción rápida: faltan personas → asignar sin objetivo */}
                                                    {(autoPlanningBrainReport.diagnosis.balance === 'short' || autoPlanningBrainReport.diagnosis.balance === 'hours_short') && (
                                                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 space-y-1">
                                                            <p className="text-[9px] font-black uppercase text-rose-800">Falta personal · incorporar al objetivo</p>
                                                            {(() => {
                                                                const pool = employees.filter((e: any) => e.status !== 'inactivo' && (!e.preferredObjectiveId || e.preferredObjectiveId === ''));
                                                                if (!pool.length) return <p className="text-[10px] text-rose-700 font-bold">No hay empleados sin objetivo en la empresa.</p>;
                                                                return (
                                                                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                                                                        {pool.map((emp: any) => (
                                                                            <div key={emp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-rose-100">
                                                                                <span className="text-[10px] font-bold text-slate-800 truncate">{emp.nombre || emp.name}</span>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={async () => {
                                                                                        await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective });
                                                                                        toast.success(`${emp.nombre || emp.name} incorporado al objetivo`);
                                                                                        setAutoWizardStep('configure');
                                                                                    }}
                                                                                    className="shrink-0 text-[9px] font-black text-emerald-600 hover:text-emerald-800 uppercase px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 hover:border-emerald-400 transition-colors"
                                                                                >Asignar</button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Progreso — detectando o generando */}
                                {(autoWizardStep === 'detecting' || autoV2Loading || autoV2Generating || autoV2GeminiLoading) && (
                                    <div className="rounded-xl bg-slate-900 px-4 py-4 text-white shadow-inner ring-1 ring-slate-700/80">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[11px] font-black uppercase tracking-wide text-amber-300">
                                                {autoV2GeminiLoading ? 'Ajuste fino IA…' : autoV2Generating ? 'Generando cronograma…' : 'Analizando configuración…'}
                                            </span>
                                            <span className="text-[11px] font-mono font-bold text-slate-300">{Math.round(autoV2Progress?.pct ?? 0)}%</span>
                                        </div>
                                        <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden mb-2">
                                            <div className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out ${autoV2Generating ? 'from-emerald-500 to-emerald-300' : 'from-amber-500 to-amber-300'}`}
                                                style={{ width: `${Math.min(100, Math.max(0, autoV2Progress?.pct ?? 3))}%` }}/>
                                        </div>
                                        <p className="text-[11px] font-medium text-slate-300 leading-snug">{autoV2Progress?.label ?? 'Procesando…'}</p>
                                    </div>
                                )}

                                {/* No viable */}
                                {autoWizardStep === 'verified' && autoV2Report && !autoV2Report.ok && (
                                    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
                                        <p className="text-sm font-black text-rose-800 mb-3">✗ Dotación insuficiente para cubrir el SLA</p>
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Demanda SLA</div>
                                                <div className="text-lg font-black text-rose-700">{Math.round(autoV2Report.metrics.contractedHours)}<span className="text-xs">h</span></div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Oferta disponible</div>
                                                <div className="text-lg font-black text-rose-700">{Math.round(autoV2Report.metrics.offerHours)}<span className="text-xs">h</span></div>
                                                <div className="text-[9px] font-black text-rose-600 mt-0.5">{Math.round(autoV2Report.metrics.offerHours - autoV2Report.metrics.effectiveTargetHours)}h faltantes</div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Personas necesarias</div>
                                                <div className="text-lg font-black text-rose-700">{autoV2Report.metrics.peopleNeededForTarget}</div>
                                                <div className="text-[9px] text-slate-400 font-bold mt-0.5">ciclo {autoV2Report.metrics.cycleUsed}: ~{autoV2Report.metrics.peopleSuggestedWithCycle}</div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Personas disponibles</div>
                                                <div className="text-lg font-black text-slate-800">{autoV2Report.metrics.peopleAvailable}</div>
                                            </div>
                                        </div>
                                        {autoV2Report.reasons.length > 0 && (
                                            <ul className="list-disc list-inside space-y-0.5 text-[11px] font-bold text-rose-800">
                                                {autoV2Report.reasons.map((r, i) => <li key={i}>{r}</li>)}
                                            </ul>
                                        )}
                                        {/* Acción rápida: incorporar empleados sin objetivo */}
                                        {(() => {
                                            const pool = employees.filter((e: any) => e.status !== 'inactivo' && (!e.preferredObjectiveId || e.preferredObjectiveId === ''));
                                            if (!pool.length) return null;
                                            return (
                                                <div className="mt-3 rounded-lg border border-rose-300 bg-white px-2 py-1.5 space-y-1">
                                                    <p className="text-[9px] font-black uppercase text-rose-800">Incorporar al objetivo · sin objetivo asignado</p>
                                                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                                                        {pool.map((emp: any) => (
                                                            <div key={emp.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-rose-50 border border-rose-100">
                                                                <span className="text-[10px] font-bold text-slate-800 truncate">{emp.nombre || emp.name}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective });
                                                                        toast.success(`${emp.nombre || emp.name} incorporado — volvé a analizar`);
                                                                        setAutoWizardStep('configure');
                                                                    }}
                                                                    className="shrink-0 text-[9px] font-black text-emerald-600 hover:text-emerald-800 uppercase px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 hover:border-emerald-400 transition-colors"
                                                                >Asignar</button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}

                                {autoWizardStep === 'sla_open' && !autoV2Generating && (
                                    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3">
                                        <p className="text-sm font-black text-rose-800 mb-1">✗ Cobertura sin cerrar — vista previa</p>
                                        <p className="text-[11px] font-bold text-rose-700 leading-snug">
                                            El cronograma calculado ya está en la grilla (celdas pendientes). Cerrá este modal para revisarlo.
                                            No publiques ni guardes como definitivo hasta cerrar el SLA.
                                        </p>
                                    </div>
                                )}

                                {autoPlanningBrainReport?.diagnosis && (autoWizardStep === 'configure' || autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Loading && !autoV2Generating && (
                                    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/80 px-3 py-2.5 space-y-2">
                                        <p className="text-[10px] font-black text-indigo-800 uppercase tracking-wide">Diagnóstico operativo</p>
                                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                                            <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                <p className="font-black text-slate-500 uppercase text-[9px]">Demanda</p>
                                                <p className="font-bold text-slate-800">{autoPlanningBrainReport.diagnosis.demand.slotsPerDay} slots/día · {autoPlanningBrainReport.diagnosis.demand.slotsMonth} mes</p>
                                                <p className="text-slate-600">{Math.round(autoPlanningBrainReport.diagnosis.demand.structuralHours)}h estructura · {Math.round(autoPlanningBrainReport.diagnosis.demand.soldHours)}h vendidas</p>
                                                {autoPlanningBrainReport.diagnosis.demand.modo12DayCount > 0 && (
                                                    <p className="text-amber-700 font-bold">{autoPlanningBrainReport.diagnosis.demand.modo12DayCount} día(s) Modo 12</p>
                                                )}
                                            </div>
                                            <div className="rounded-lg bg-white/90 border border-indigo-100 px-2 py-1.5">
                                                <p className="font-black text-slate-500 uppercase text-[9px]">Oferta</p>
                                                <p className="font-bold text-slate-800">{autoPlanningBrainReport.diagnosis.supply.peopleAvailable} guardias · {Math.round(autoPlanningBrainReport.diagnosis.supply.offerHours)}h max</p>
                                                <p className="text-slate-600">T1 {Math.round(autoPlanningBrainReport.diagnosis.supply.offerHoursT1)}h · T2 {Math.round(autoPlanningBrainReport.diagnosis.supply.offerHoursT2)}h</p>
                                                <p className="text-slate-600">Plantilla 6+2: {autoPlanningBrainReport.diagnosis.supply.servicioDiario}+{autoPlanningBrainReport.diagnosis.supply.poolFrancos6x2}={autoPlanningBrainReport.diagnosis.supply.plantillaRequired6x2}</p>
                                            </div>
                                        </div>
                                        <div className={`rounded-lg px-2 py-1.5 border text-[10px] font-bold ${
                                            autoPlanningBrainReport.diagnosis.balance === 'exact'
                                                ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                                                : autoPlanningBrainReport.diagnosis.balance === 'surplus'
                                                    ? 'bg-amber-100 border-amber-300 text-amber-900'
                                                    : 'bg-rose-100 border-rose-300 text-rose-900'
                                        }`}>
                                            <span className="uppercase text-[9px] opacity-80">Balance · </span>
                                            {autoPlanningBrainReport.diagnosis.balanceLabel}
                                            {autoPlanningBrainReport.strictSixTwo && (
                                                <span className="block mt-0.5 text-emerald-800">6+2 estricto — ciclo M→T→N + continuidad mes anterior</span>
                                            )}
                                        </div>
                                        <p className="text-[10px] font-bold text-indigo-900 leading-snug">{autoPlanningBrainReport.diagnosis.resolution}</p>
                                    </div>
                                )}

                                {autoPlanningBrainReport && (autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Loading && (
                                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1.5">
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-wide">Cerebro Auto — dotación diaria</p>
                                        <p className="text-[11px] font-bold text-slate-800">
                                            Modo 8: <strong>{autoPlanningBrainReport.staffing.servicioDiarioModo8}</strong> servicio
                                            + <strong>{autoPlanningBrainReport.staffing.poolFrancos}</strong> franco
                                            = <strong>{autoPlanningBrainReport.staffing.plantillaTotal}</strong> plantilla
                                            <span className="text-slate-500 font-bold"> ({autoPlanningBrainReport.pickedCycle})</span>
                                        </p>
                                        <p className="text-[10px] font-bold text-slate-500">
                                            Modo 12: {autoPlanningBrainReport.staffing.servicioDiarioModo12} en servicio (D12/N12)
                                            · rotativo {autoPlanningBrainReport.rotateShifts ? 'ON' : 'OFF'}
                                        </p>
                                        {autoPlanningBrainReport.modo12DaysAuto.length > 0 && (
                                            <p className={`text-[10px] font-bold rounded px-2 py-1 ${autoPlanningBrainReport.absenceModo12Ok ? 'text-amber-800 bg-amber-50' : 'text-rose-800 bg-rose-50'}`}>
                                                Ausencias V/L/E: {autoPlanningBrainReport.modo12DaysAuto.length} día(s) Modo 12
                                                {autoPlanningBrainReport.absenceModo12Ok ? ' · plantilla objetivo' : ' · revisar (sin franco extra)'}
                                            </p>
                                        )}
                                        {autoPlanningBrainReport.contingencyDaysManual.length > 0 && (
                                            <p className={`text-[10px] font-bold rounded px-2 py-1 ${autoPlanningBrainReport.contingencyOk ? 'text-violet-800 bg-violet-50' : 'text-rose-800 bg-rose-50'}`}>
                                                Contingencia: {autoPlanningBrainReport.contingencyDaysManual.length} día(s)
                                                {autoPlanningBrainReport.contingencyOk ? ' · viable' : ' · no viable'}
                                            </p>
                                        )}
                                        {autoPlanningBrainReport.recommendedAlternative && !autoAjustarCrono && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const alt = autoPlanningBrainReport.recommendedAlternative!;
                                                    const baseInput = autoPlanningBrainInputRef.current;
                                                    if (!baseInput) return;
                                                    const newBrain = resolveAutoPlanningBrain({ ...baseInput, cycleOverride: alt });
                                                    autoPlanningBrainRef.current = newBrain;
                                                    setAutoPlanningBrainReport(newBrain);
                                                    autoSelectedCyclesRef.current = newBrain.cycles;
                                                    setAutoCycles(newBrain.cycles);
                                                }}
                                                className="w-full text-left text-[10px] font-bold rounded px-2 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors"
                                            >
                                                💡 <strong>{autoPlanningBrainReport.recommendedAlternative}</strong> también es viable — clic para aplicar
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Resultado: 3 tarjetas */}
                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && autoCycles.length > 0 && (
                                    <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 mb-1">
                                        <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wide">
                                            {autoWizardStep === 'sla_open' ? 'Esquema calculado' : 'Esquema aplicado'}
                                        </p>
                                        <p className="text-sm font-black text-indigo-900">{autoCycles.join(' · ')} <span className="text-[10px] font-bold text-indigo-600">(auto)</span></p>
                                    </div>
                                )}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && slaVendidas > 0 && (
                                    <div className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${
                                        autoV2GenStats.slaHoursClosed
                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                            : 'border-rose-300 bg-rose-50 text-rose-800'
                                    }`}>
                                        {autoV2GenStats.slaHoursClosed
                                            ? `✓ SLA cerrado: ${Math.round(autoV2GenStats.totalBillableHours)}h planificadas = ${slaVendidas}h vendidas`
                                            : (() => {
                                                const hrs = Math.round(
                                                    autoV2GenStats.slaDeficitRemaining
                                                    ?? Math.max(0, slaVendidas - autoV2GenStats.totalBillableHours),
                                                );
                                                const slots = autoV2Coverage?.coverage.uncoveredSlots
                                                    ?? autoV2GenStats.uncoveredSlots ?? 0;
                                                const parts: string[] = [];
                                                if (hrs > 0) parts.push(`${hrs}h`);
                                                if (slots > 0) parts.push(`${slots} slot${slots !== 1 ? 's' : ''} sin cubrir`);
                                                const detail = parts.length > 0 ? parts.join(' · ') : 'revisar cobertura';
                                                return `✗ SLA abierto: ${detail} (${slaVendidas}h vendidas, ${Math.round(autoV2GenStats.totalBillableHours)}h planificadas)`;
                                            })()}
                                    </div>
                                )}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && (
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className={`bg-white rounded-xl p-3 border-2 text-center ${
                                            autoV2GenStats.gridBillableHours != null
                                            && Math.abs(autoV2GenStats.totalBillableHours - autoV2GenStats.gridBillableHours) > 16
                                                ? 'border-amber-400' : 'border-slate-200'
                                        }`}>
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">Hs facturables</div>
                                            <div className="text-2xl font-black text-indigo-700">{Math.round(autoV2GenStats.totalBillableHours)}<span className="text-sm">h</span></div>
                                            {autoV2GenStats.gridBillableHours != null
                                                && Math.abs(autoV2GenStats.totalBillableHours - autoV2GenStats.gridBillableHours) > 16 && (
                                                <div className="text-[9px] font-bold text-amber-700 mt-0.5">
                                                    Grilla: {Math.round(autoV2GenStats.gridBillableHours)}h
                                                </div>
                                            )}
                                        </div>
                                        <div className="bg-white rounded-xl p-3 border-2 border-slate-200 text-center">
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">Cubiertos</div>
                                            <div className={`text-2xl font-black ${(autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                                {autoV2Coverage ? `${autoV2Coverage.coverage.coveredSlots}/${autoV2Coverage.coverage.totalSlots}` : '—'}
                                            </div>
                                        </div>
                                        <div className={`bg-white rounded-xl p-3 border-2 text-center ${(autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0 ? 'border-emerald-300' : 'border-rose-300'}`}>
                                            <div className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-1">Sin cubrir</div>
                                            <div className={`text-2xl font-black ${(autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                {autoV2Coverage?.coverage.uncoveredSlots ?? 0}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Aviso: empleados movidos automáticamente por asignación incorrecta de puestos */}
                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (() => {
                                    const relocated = autoV2GenStats?.relocatedEmployeeIds || [];
                                    const stranded  = autoV2GenStats?.strandedEmployeeIds  || [];
                                    if (relocated.length === 0 && stranded.length === 0) return null;
                                    const getName = (id: string) => {
                                        const emp = displayedEmployees.find((e: any) => e.id === id);
                                        return emp ? (emp.name || emp.nombre || id) : id;
                                    };
                                    return (
                                        <div className="rounded-xl border-2 border-orange-400 bg-orange-50 px-3 py-2.5 space-y-2">
                                            <div className="flex items-start gap-2">
                                                <span className="text-orange-600 mt-0.5 text-base font-black">!</span>
                                                <div className="flex-1">
                                                    <p className="text-[11px] font-black text-orange-900 uppercase tracking-wide mb-0.5">
                                                        Puestos con dotación incorrecta — corregidos automáticamente
                                                    </p>
                                                    <p className="text-[10px] text-orange-800 leading-relaxed">
                                                        El engine detectó puestos con más o menos empleados de los necesarios para el ciclo 6+2 (qty × 4 por puesto)
                                                        y rebalanceó la asignación para generar cobertura correcta.
                                                        <strong className="block mt-0.5">Corregí la asignación de puestos en los legajos para que coincida con el SLA.</strong>
                                                    </p>
                                                </div>
                                            </div>
                                            {relocated.length > 0 && (
                                                <div>
                                                    <p className="text-[9px] font-black text-orange-700 uppercase mb-1">
                                                        {relocated.length} movido{relocated.length !== 1 ? 's' : ''} de su puesto (legajo incorrecto):
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {relocated.map((id, i) => (
                                                            <span key={i} className="bg-orange-200 text-orange-900 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase">
                                                                {getName(id)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {stranded.length > 0 && (
                                                <div>
                                                    <p className="text-[9px] font-black text-orange-700 uppercase mb-1">
                                                        {stranded.length} sin puesto válido (faltan empleados en el servicio):
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {stranded.map((id, i) => (
                                                            <span key={i} className="bg-amber-200 text-amber-900 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase">
                                                                {getName(id)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Panel de cobertura de ausencias — visible si hay gaps (siempre se analiza con pipeline floater) */}
                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoCoverageGaps.length > 0 && (() => {
                                    const bandMeta: Record<string, { name: string; hours: number; startTime: string; endTime: string }> = {
                                        M: { name: 'Mañana',   hours: 8, startTime: '07:00', endTime: '15:00' },
                                        T: { name: 'Tarde',    hours: 8, startTime: '15:00', endTime: '23:00' },
                                        N: { name: 'Noche',    hours: 8, startTime: '23:00', endTime: '07:00' },
                                        D12:{ name: 'Diurno',  hours:12, startTime: '07:00', endTime: '19:00' },
                                        N12:{ name: 'Nocturno',hours:12, startTime: '19:00', endTime: '07:00' },
                                    };

                                    const assignGap = (candidateEmpId: string, candidateName: string, dateStr: string, band: string, absentEmpId: string) => {
                                        const meta = bandMeta[band] ?? bandMeta.M;
                                        const posName = positionStructure[0]?.positionName ?? 'General';
                                        // Actualizar grilla: cambiar el turno del candidato en ese día
                                        setPendingChanges(prev => ({
                                            ...prev,
                                            [`${candidateEmpId}_${dateStr}`]: {
                                                isTemp: true,
                                                employeeId: candidateEmpId,
                                                objectiveId: selectedObjective,
                                                positionName: posName,
                                                code: band,
                                                name: meta.name,
                                                hours: meta.hours,
                                                startTime: meta.startTime,
                                                endTime: meta.endTime,
                                                isFranco: false,
                                            },
                                        }));
                                        // Marcar gap como cubierto manualmente
                                        setAutoCoverageGaps(prev => prev.map(g =>
                                            g.absentEmpId === absentEmpId && g.dateStr === dateStr
                                                ? { ...g, coverageType: 'manual' as const, coveredBy: candidateEmpId, coveredByName: candidateName }
                                                : g
                                        ));
                                        toast.success(`Día ${dateStr.slice(8,10)}: ${candidateName.split(',')[0]} asignado a banda ${band}`, { duration: 3000 });
                                    };

                                    const coveredGaps = autoCoverageGaps.filter(g => g.coveredBy !== null);
                                    const ftGaps = autoCoverageGaps.filter(g => g.coverageType === 'ft_required');

                                    const ftByEmp: Record<string, { nombre: string; days: typeof ftGaps }> = {};
                                    for (const g of ftGaps) {
                                        if (!ftByEmp[g.absentEmpId]) ftByEmp[g.absentEmpId] = { nombre: g.absentName || g.absentEmpId, days: [] };
                                        ftByEmp[g.absentEmpId].days.push(g);
                                    }

                                    const coverLabel = (type: string) =>
                                        type === 'ret' ? 'RET' : type === 'esc' ? 'ESC' : type === 'sin_turno' ? 'ST' : type === 'manual' ? 'MANUAL' : type === 'ft_required' ? 'FT' : type.toUpperCase();

                                    return (
                                        <div className="rounded-xl border-2 border-amber-200 bg-amber-50/80 px-3 py-2.5 space-y-2.5">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-black uppercase tracking-wide text-amber-800">Cobertura ausencias</p>
                                                <div className="flex gap-1 flex-wrap">
                                                    {coveredGaps.length > 0 && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-teal-100 text-teal-800">{coveredGaps.length} cubiertos ✓</span>}
                                                    {ftGaps.length > 0 && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">{ftGaps.length} sin cubrir</span>}
                                                    {!autoCoverAbsences && ftGaps.length > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">activá cobertura auto</span>}
                                                </div>
                                            </div>

                                            {/* Sin cobertura ST/RET/ESC → filas clicables multi-selección */}
                                            {ftGaps.length > 0 && (() => {
                                                const allFtKeys = ftGaps.map(g => `${g.absentEmpId}_${g.dateStr}`);
                                                const someSelected = allFtKeys.some(k => coverageSelectedDays.has(k));
                                                const allSelected = allFtKeys.every(k => coverageSelectedDays.has(k));
                                                const selectedGaps = ftGaps.filter(g => coverageSelectedDays.has(`${g.absentEmpId}_${g.dateStr}`));
                                                const toggle = (key: string) => setCoverageSelectedDays(prev => {
                                                    const next = new Set(prev);
                                                    next.has(key) ? next.delete(key) : next.add(key);
                                                    return next;
                                                });
                                                return (
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center justify-between">
                                                            <p className="text-[9px] font-black text-rose-800">Seleccioná días a cubrir:</p>
                                                            <button
                                                                type="button"
                                                                onClick={() => setCoverageSelectedDays(allSelected
                                                                    ? new Set()
                                                                    : new Set(allFtKeys)
                                                                )}
                                                                className="text-[9px] font-black text-indigo-600 hover:text-indigo-800"
                                                            >
                                                                {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                                                            </button>
                                                        </div>
                                                        {Object.values(ftByEmp).map(({ nombre, days }) => (
                                                            <div key={days[0].absentEmpId} className="rounded-lg border border-rose-200 bg-white overflow-hidden">
                                                                <div className="px-2.5 py-1.5 bg-rose-50 border-b border-rose-100">
                                                                    <p className="text-[9px] font-black text-rose-800">{nombre}</p>
                                                                </div>
                                                                {days.map(gap => {
                                                                    const key = `${gap.absentEmpId}_${gap.dateStr}`;
                                                                    const isChecked = coverageSelectedDays.has(key);
                                                                    return (
                                                                        <button
                                                                            key={gap.dateStr}
                                                                            type="button"
                                                                            onClick={() => toggle(key)}
                                                                            className={`w-full flex items-center justify-between px-3 py-2 border-b border-slate-100 last:border-b-0 transition-colors text-left ${
                                                                                isChecked
                                                                                    ? 'bg-indigo-600 text-white'
                                                                                    : 'bg-white hover:bg-slate-50 text-slate-700'
                                                                            }`}
                                                                        >
                                                                            <span className="text-[10px] font-bold">
                                                                                Día {gap.dateStr.slice(8, 10)} · {gap.band}
                                                                            </span>
                                                                            <span className={`text-[9px] font-black ${isChecked ? 'text-white/80' : 'text-slate-400'}`}>
                                                                                {isChecked ? '✓' : '○'}
                                                                            </span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        ))}
                                                        <button
                                                            type="button"
                                                            disabled={!someSelected}
                                                            onClick={() => someSelected && setPlanCoverageModalGaps(selectedGaps)}
                                                            className={`w-full py-2.5 rounded-lg text-[10px] font-black transition-colors ${
                                                                someSelected
                                                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                            }`}
                                                        >
                                                            {someSelected
                                                                ? `Asignar cobertura — ${selectedGaps.length} día(s) seleccionado(s)`
                                                                : 'Seleccioná al menos un día'}
                                                        </button>
                                                    </div>
                                                );
                                            })()}

                                            {/* Cubiertos: ST / RET / ESC / FT / manual */}
                                            {coveredGaps.length > 0 && (
                                                <div className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 space-y-0.5">
                                                    <p className="text-[9px] font-black text-teal-800 mb-1">✓ Cubiertos</p>
                                                    {coveredGaps.map(g => (
                                                        <div key={`${g.absentEmpId}_${g.dateStr}`} className="flex justify-between text-[9px] font-bold text-teal-700">
                                                            <span>{g.absentName?.split(',')[0]} · día {g.dateStr.slice(8,10)} · {g.band}</span>
                                                            <span>{g.coveredByName?.split(',')[0]} ({coverLabel(g.coverageType)})</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {autoV2FormReport && (autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (
                                    <div className={`rounded-xl border-2 px-3 py-2.5 space-y-2 ${
                                        autoV2FormReport.ok
                                            ? 'border-emerald-200 bg-emerald-50/90'
                                            : autoV2FormReport.warnings
                                                ? 'border-amber-200 bg-amber-50/90'
                                                : 'border-rose-200 bg-rose-50/90'
                                    }`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-700">
                                                Calidad forma 6+2
                                            </p>
                                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                                autoV2FormReport.ok ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'
                                            }`}>
                                                {autoV2FormReport.metrics.formCompliantPct}% limpias
                                            </span>
                                        </div>
                                        <p className="text-[10px] font-bold text-slate-800 leading-snug">{autoV2FormReport.summary}</p>
                                        <div className="grid grid-cols-4 gap-1 text-[9px] font-bold text-slate-600">
                                            <span>Prom {autoV2FormReport.metrics.avgBillableHours}h</span>
                                            <span>{autoV2FormReport.metrics.minBillableHours}–{autoV2FormReport.metrics.maxBillableHours}h</span>
                                            <span>Δ {autoV2FormReport.metrics.hoursSpread}h</span>
                                            <span>&gt;200h: {autoV2FormReport.metrics.over200Count}</span>
                                        </div>
                                        {(autoV2FormReport.metrics.workBlockIssues > 0
                                            || autoV2FormReport.metrics.francoBlockIssues > 0
                                            || autoV2FormReport.metrics.rotationStuckCount > 0
                                            || autoV2FormReport.metrics.weeklyOver48Count > 0) && (
                                            <div className="flex flex-wrap gap-1">
                                                {autoV2FormReport.metrics.workBlockIssues > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        bloques ≠6d: {autoV2FormReport.metrics.workBlockIssues}
                                                    </span>
                                                )}
                                                {autoV2FormReport.metrics.francoBlockIssues > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        FF ≠2: {autoV2FormReport.metrics.francoBlockIssues}
                                                    </span>
                                                )}
                                                {autoV2FormReport.metrics.rotationStuckCount > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        banda fija: {autoV2FormReport.metrics.rotationStuckCount}
                                                    </span>
                                                )}
                                                {autoV2FormReport.metrics.weeklyOver48Count > 0 && (
                                                    <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded border border-slate-200">
                                                        sem &gt;48h: {autoV2FormReport.metrics.weeklyOver48Count}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {autoV2FormReport.issues.length > 0 && (
                                            <ul className="max-h-28 overflow-y-auto text-[9px] font-bold text-slate-700 space-y-0.5 border-t border-slate-200/80 pt-1.5">
                                                {autoV2FormReport.issues.slice(0, 12).map((issue, i) => (
                                                    <li key={`${issue.empId}-${issue.kind}-${i}`} className={issue.severity === 'error' ? 'text-rose-800' : 'text-amber-800'}>
                                                        {issue.empName || issue.empId.slice(-6)}: {issue.message}
                                                    </li>
                                                ))}
                                                {autoV2FormReport.issues.length > 12 && (
                                                    <li className="text-slate-500">… y {autoV2FormReport.issues.length - 12} más</li>
                                                )}
                                            </ul>
                                        )}
                                        {(autoV2FormReport.metrics.hoursSpread > 24
                                            || autoV2FormReport.metrics.over192Count > 0
                                            || autoV2FormReport.metrics.under168Count > 0)
                                            && (autoV2Coverage?.coverage.uncoveredSlots ?? 0) === 0
                                            && autoWizardStep === 'done'
                                            && !autoPlanningBrainRef.current?.strictSixTwo
                                            && !autoSelectedCyclesRef.current?.includes('6+2') && (
                                            <button
                                                type="button"
                                                onClick={() => void rebalanceAutoForm()}
                                                disabled={autoV2Rebalancing || autoV2Generating}
                                                className="w-full mt-1 flex items-center justify-center gap-1.5 rounded-lg border-2 border-indigo-300 bg-indigo-50 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                                            >
                                                {autoV2Rebalancing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowLeftRight className="w-3 h-3" />}
                                                Rebalancear forma (swaps)
                                            </button>
                                        )}
                                        {autoV2RebalanceLog.length > 0 && (
                                            <ul className="max-h-20 overflow-y-auto text-[9px] font-bold text-indigo-800 space-y-0.5 border-t border-indigo-200/80 pt-1.5">
                                                {autoV2RebalanceLog.slice(-6).map((entry, i) => (
                                                    <li key={`${entry.dateStr}-${entry.fromEmpId}-${i}`}>
                                                        {entry.dateStr}: {entry.detail}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                )}

                                {autoV2TrailDiag && (autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (() => {
                                    const diagBandOf = (s: number) => { const n=((s%24)+24)%24; if(n<=5)return'M'; if(n<=7)return'F'; if(n<=13)return'T'; if(n<=15)return'F'; if(n<=21)return'N'; return'F'; };
                                    // Detectar colisiones: misma apertura (banda+diasFranco) entre empleados del mismo puesto
                                    const aperturaKey = (r: typeof autoV2TrailDiag[0]) =>
                                        r.julioBand && r.diasFranco !== undefined ? `${r.puesto}|${r.julioBand}|${r.diasFranco}` : null;
                                    const keyCounts: Record<string, number> = {};
                                    autoV2TrailDiag.forEach(r => { const k = aperturaKey(r); if(k) keyCounts[k] = (keyCounts[k]??0)+1; });
                                    return (
                                        <div className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 space-y-1.5">
                                            <button
                                                type="button"
                                                onClick={() => setAutoV2ShowTrailDiag(v => !v)}
                                                className="w-full flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-slate-600 hover:text-slate-900"
                                            >
                                                <span>Racha mes anterior → apertura</span>
                                                <span className="text-slate-400">{autoV2ShowTrailDiag ? '▲' : '▼'}</span>
                                            </button>
                                            {autoV2ShowTrailDiag && (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full">
                                                        <thead>
                                                            <tr className="text-[9px] font-black uppercase text-slate-400 border-b border-slate-100">
                                                                <th className="text-left pb-1 pr-2 font-black">Colaborador</th>
                                                                <th className="text-center pb-1 pr-1 font-black">Puesto</th>
                                                                <th className="text-center pb-1 pr-1 font-black">Fin mes ant.</th>
                                                                <th className="text-center pb-1 font-black">Apertura</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {autoV2TrailDiag.map(row => {
                                                                const finMes = row.trailWork > 0
                                                                    ? `${row.trailWork}×${row.lastBand}`
                                                                    : row.trailRest > 0
                                                                        ? `${row.trailRest}×F`
                                                                        : '—';
                                                                const apertura = row.julioBand !== undefined && row.diasFranco !== undefined
                                                                    ? `${row.julioBand} · ${row.diasFranco}d→F`
                                                                    : '—';
                                                                const k = aperturaKey(row);
                                                                // Colisión real solo si hay MÁS empleados con igual apertura que qty del puesto.
                                                                // qty=2 → 2 F·0d en el mismo puesto es normal (1 por subgrupo).
                                                                const isCollision = k !== null && (keyCounts[k] ?? 0) > (row.puestoQty ?? 1);
                                                                const isTruncatedFranco = row.trailRest === 1 && row.julioBand !== 'F';
                                                                const rowClass = isCollision
                                                                    ? 'text-rose-700 bg-rose-50'
                                                                    : isTruncatedFranco
                                                                        ? 'text-amber-700'
                                                                        : 'text-slate-700';
                                                                return (
                                                                    <tr key={row.id} className={`text-[9px] font-bold border-b border-slate-50 ${rowClass}`}>
                                                                        <td className="py-0.5 pr-2 text-left">{row.nombre}</td>
                                                                        <td className="py-0.5 pr-1 text-center text-slate-500">{row.puesto}</td>
                                                                        <td className="py-0.5 pr-1 text-center font-black">{finMes}</td>
                                                                        <td className="py-0.5 text-center font-black">{apertura}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                    <p className="text-[8px] text-slate-400 mt-1">Rojo = colisión (más empleados con igual apertura que qty del puesto). Ámbar = franco truncado (1×F → inicio trabajo).</p>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {(autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && autoV2GenStats && (autoV2GenStats.totalRetCount ?? 0) > 0 && (
                                    <div className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${
                                        autoV2GenStats.ajustarCrono ? 'border-violet-300 bg-violet-50 text-violet-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                                    }`}>
                                        <p className="font-black">
                                            Pool RET: {autoV2GenStats.totalRetCount} días-persona
                                            {autoV2GenStats.totalRetHoursPotential
                                                ? ` (~${Math.round(autoV2GenStats.totalRetHoursPotential)}h stand-by potencial)`
                                                : ''}
                                        </p>
                                        {(autoV2GenStats.overCoverageRetDays ?? 0) > 0 && (
                                            <p className="text-[10px] mt-1 opacity-90">
                                                ⚠ {autoV2GenStats.overCoverageRetDays} día(s) con 2+ RET simultáneos
                                                (máx. {autoV2GenStats.maxRetConcurrent ?? 0}) — revisar sobrecobertura en dotación.
                                            </p>
                                        )}
                                        {autoV2GenStats.ajustarCrono && (
                                            <p className="text-[10px] mt-1 opacity-80">
                                                Modo ajustar crono: esquemas intensivos para liberar guardias a otros objetivos / eventos.
                                            </p>
                                        )}
                                        {(autoV2GenStats.apretarCronoDays?.length ?? 0) > 0 && (
                                            <p className="text-[10px] mt-1 opacity-90">
                                                Modo 12 (D12+N12):{' '}
                                                {autoV2GenStats.apretarCronoDays!.map(d => d.slice(8, 10)).join(', ')}
                                                {' '}— ausencias auto y/o Contingencia manual.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {autoWizardStep === 'done' && !autoV2Generating && autoV2GenStats && (
                                    <>
                                        {/* Conflictos / descansos — grilla aplicada */}
                                        {autoV2Coverage && (autoV2Coverage.licenseConflicts.length > 0 || autoV2Coverage.restViolations.length > 0) && (
                                            <div className="flex flex-wrap gap-2">
                                                {autoV2Coverage.licenseConflicts.length > 0 && (
                                                    <span className="text-[11px] font-black text-rose-700 bg-rose-100 px-2 py-1 rounded-lg">
                                                        ⛔ {autoV2Coverage.licenseConflicts.length} conflicto{autoV2Coverage.licenseConflicts.length > 1 ? 's' : ''} de licencia
                                                    </span>
                                                )}
                                                {autoV2Coverage.restViolations.length > 0 && (
                                                    <span className="text-[11px] font-black text-amber-700 bg-amber-100 px-2 py-1 rounded-lg">
                                                        ⚠ {autoV2Coverage.restViolations.length} descanso{autoV2Coverage.restViolations.length > 1 ? 's' : ''} roto{autoV2Coverage.restViolations.length > 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {!autoOverwrite && (autoV2GenStats?.cellsSkippedOverwrite ?? 0) > 0 && (
                                            <p className="text-[11px] font-black text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5">
                                                Sobreescribir OFF: {autoV2GenStats?.cellsSkippedOverwrite} celdas no se actualizaron. Lo que ves en la grilla puede no coincidir con el cálculo del modal.
                                            </p>
                                        )}
                                        <p className="text-[11px] text-slate-500 font-bold">
                                            {autoV2Coverage?.ok !== false
                                                ? 'Cronograma listo. Revisá la grilla y guardá cuando estés listo.'
                                                : 'Cronograma con avisos. Revisá la grilla antes de guardar.'}
                                        </p>
                                        {autoV2GeminiSummary && (
                                            <p className="text-[10px] text-indigo-700 font-bold bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1.5">
                                                IA: {autoV2GeminiSummary}
                                            </p>
                                        )}
                                        {autoV2LastRun && autoV2Coverage && (
                                            <button type="button"
                                                disabled={autoV2GeminiLoading || autoV2Generating}
                                                onClick={async () => {
                                                    if (!autoV2LastRun || !autoV2Coverage) return;
                                                    const out = await runAutoV2PlanningAgentGemini(
                                                        autoV2LastRun.assignments,
                                                        autoV2Coverage,
                                                        autoV2LastRun.ctx,
                                                        autoV2LastRun.stats,
                                                        { ...pendingChanges },
                                                        true,
                                                    );
                                                    setPendingChanges({ ...out.changes });
                                                    setAutoV2Coverage(out.coverage);
                                                    setAutoV2LastRun({ ...autoV2LastRun, assignments: out.assignments });
                                                    setAutoV2Suggestions(
                                                        buildScheduleOptimizationSuggestions(
                                                            autoV2LastRun.ctx,
                                                            out.assignments,
                                                            autoV2LastRun.stats,
                                                        ),
                                                    );
                                                }}
                                                className="w-full py-2 rounded-lg text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                                                {autoV2GeminiLoading ? 'IA trabajando…' : '↻ Re-ejecutar ajuste fino IA'}
                                            </button>
                                        )}

                                        {/* Autorización 200h */}
                                        {capOverflowEmps.length > 0 && (
                                            <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-3">
                                                <p className="text-[11px] font-black text-orange-800 mb-1">
                                                    ⚠ {capOverflowEmps.length} empleado{capOverflowEmps.length > 1 ? 's' : ''} alcanzaron el tope de 200h
                                                </p>
                                                <p className="text-[10px] text-orange-700 font-bold mb-2">
                                                    Autorizá quiénes pueden superarlo con PIN de supervisor. El motor re-generará.
                                                </p>
                                                <div className="space-y-1 mb-3">
                                                    {capOverflowEmps.map(e => (
                                                        <label key={e.empId} className="flex items-center gap-2 cursor-pointer">
                                                            <input type="checkbox"
                                                                checked={over200AuthChecked[e.empId] ?? false}
                                                                onChange={ev => setOver200AuthChecked(prev => ({ ...prev, [e.empId]: ev.target.checked }))}
                                                                className="w-3.5 h-3.5 accent-orange-600"/>
                                                            <span className="text-[11px] font-bold text-slate-800">{e.nombre}</span>
                                                            {authorizedOver200Ids.has(e.empId) && (
                                                                <span className="text-[9px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">ya autorizado</span>
                                                            )}
                                                        </label>
                                                    ))}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <SupervisorPinInput
                                                        value={over200AuthPin}
                                                        onChange={e => { setOver200AuthPin(e.target.value.replace(/\D/g, '').slice(0, 20)); setOver200AuthError(''); }}
                                                        placeholder="PIN supervisor (mín. 4 dígitos)"
                                                        maxLength={20}
                                                        className="flex-1 min-w-0 rounded-lg border border-orange-300 px-2 py-1.5 text-[11px] font-bold bg-white outline-none focus:ring-2 focus:ring-orange-400"/>
                                                    <button type="button"
                                                        disabled={autoV2Generating || !over200AuthPin}
                                                        onClick={() => {
                                                            if (over200AuthPin.length < 4) { setOver200AuthError('PIN mínimo 4 caracteres'); return; }
                                                            const toAuthorize = capOverflowEmps.filter(e => over200AuthChecked[e.empId]).map(e => e.empId);
                                                            if (toAuthorize.length === 0) { setOver200AuthError('Seleccioná al menos un empleado'); return; }
                                                            const next = new Set(authorizedOver200IdsRef.current);
                                                            toAuthorize.forEach(id => next.add(id));
                                                            authorizedOver200IdsRef.current = next;
                                                            setAuthorizedOver200Ids(next);
                                                            setCapOverflowEmps([]);
                                                            setOver200AuthPin(''); setOver200AuthError('');
                                                            applyAutoScheduleV2();
                                                        }}
                                                        className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-black text-white bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50">
                                                        Autorizar y re-generar
                                                    </button>
                                                </div>
                                                {over200AuthError && <p className="text-[10px] font-bold text-rose-700 mt-1">{over200AuthError}</p>}
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Ajustar configuración — colapsible, visible en verified (no viable) y done */}
                                {(autoWizardStep === 'verified' || autoWizardStep === 'done' || autoWizardStep === 'sla_open') && !autoV2Generating && (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                                        <button type="button"
                                            onClick={() => setAutoWizardPersonalize(p => !p)}
                                            className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-black text-slate-600 bg-slate-50 hover:bg-slate-100 transition-colors">
                                            <span>Ajustar configuración</span>
                                            {autoWizardPersonalize ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                                        </button>
                                        {autoWizardPersonalize && (
                                            <div className="px-3 pb-3 pt-2 bg-white space-y-3">
                                                {autoCycles.length > 0 && (
                                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                                                        <p className="text-[9px] font-black text-slate-500 uppercase">Esquema (automático)</p>
                                                        <p className="text-[11px] font-black text-slate-800">{autoCycles.join(' · ')}</p>
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <button type="button" onClick={() => setAutoV2BudgetMode('cct')}
                                                        className={`py-1.5 rounded-lg text-[10px] font-black border-2 transition-colors text-left px-2 ${autoV2BudgetMode==='cct' ? 'border-amber-500 bg-amber-100 text-amber-700' : 'border-slate-200 text-slate-500'}`}>
                                                        CCT por tramos<div className={`text-[9px] font-bold ${autoV2BudgetMode==='cct' ? 'opacity-80' : 'opacity-50'}`}>cola + nuevo desde día {autoV2Report?.metrics.cctCutoffDay ?? 25}</div>
                                                    </button>
                                                    <button type="button" onClick={() => setAutoV2BudgetMode('calendar')}
                                                        className={`py-1.5 rounded-lg text-[10px] font-black border-2 transition-colors text-left px-2 ${autoV2BudgetMode==='calendar' ? 'border-amber-500 bg-amber-100 text-amber-700' : 'border-slate-200 text-slate-500'}`}>
                                                        Calendario simple<div className={`text-[9px] font-bold ${autoV2BudgetMode==='calendar' ? 'opacity-80' : 'opacity-50'}`}>200h netas sin cola</div>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-slate-700 flex-1">Sobreescribir celdas ya asignadas</span>
                                                    <button type="button" onClick={() => setAutoOverwrite(p => !p)}
                                                        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${autoOverwrite ? 'bg-amber-500' : 'bg-slate-300'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${autoOverwrite ? 'translate-x-4' : ''}`}/>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-slate-700 flex-1">Ajuste fino IA tras generar (Gemini)</span>
                                                    <button type="button" onClick={() => setAutoV2RunGemini(p => !p)}
                                                        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${autoV2RunGemini ? 'bg-indigo-500' : 'bg-slate-300'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${autoV2RunGemini ? 'translate-x-4' : ''}`}/>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] font-black text-slate-700 flex-1">Cobertura de ausencias (V/L/E/A/PG)</span>
                                                    <button type="button" onClick={() => setAutoCoverAbsences(p => !p)}
                                                        className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${autoCoverAbsences ? 'bg-teal-500' : 'bg-slate-300'}`}>
                                                        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${autoCoverAbsences ? 'translate-x-4' : ''}`}/>
                                                    </button>
                                                </div>
                                                {/* Ausencias — mini wizard */}
                                                {autoV2CoveragePreflight && autoV2CoveragePreflight.employees.some(e => e.blockedCount > 0) && (
                                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 space-y-1.5">
                                                        <p className="text-[9px] font-black uppercase tracking-wide text-amber-700 mb-1">Ausencias en el mes</p>
                                                        {autoV2CoveragePreflight.employees.filter(e => e.blockedCount > 0).map(emp => {
                                                            const absMap = autoAbsencesMap[emp.empId];
                                                            const codes = absMap
                                                                ? [...new Set([...absMap.values()].filter(c => ['V','L','E','A','PG','AA'].includes(c)))]
                                                                : [];
                                                            return (
                                                                <div key={emp.empId} className="flex items-center justify-between gap-1.5">
                                                                    <div className="min-w-0">
                                                                        <span className="text-[10px] font-black text-amber-800 truncate block">{emp.nombre}</span>
                                                                        <span className="text-[9px] font-bold text-amber-600">{emp.blockedCount}d{codes.length > 0 ? ` · ${codes.join('/')}` : ''}</span>
                                                                    </div>
                                                                    <span className="shrink-0 text-[9px] font-black px-2 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-600">
                                                                        D12 auto
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <button type="button"
                                                    onClick={() => { setAutoWizardPersonalize(false); runFullGeneration(); }}
                                                    disabled={autoV2Loading || autoV2Generating}
                                                    className="w-full py-2 rounded-lg text-[11px] font-black text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                                                    <RefreshCw size={11}/> Re-generar (re-evalúa esquema)
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                            </div>

                            {/* Footer */}
                            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3 flex flex-col gap-2 rounded-b-2xl">
                                {slaDebug && (
                                    <div className="bg-slate-900 text-slate-100 text-[10px] rounded-lg p-2 max-h-60 overflow-y-auto">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-black text-emerald-300">doc id: {slaDebug.id}</span>
                                            <div className="flex gap-2">
                                                <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(slaDebug, null, 2)); toast.success('JSON copiado'); }} className="text-[10px] font-bold text-slate-300 hover:text-white">copiar</button>
                                                <button onClick={() => setSlaDebug(null)} className="text-[10px] font-bold text-slate-300 hover:text-white">cerrar</button>
                                            </div>
                                        </div>
                                        <pre className="whitespace-pre-wrap break-all leading-tight">{JSON.stringify(slaDebug.data, null, 2)}</pre>
                                    </div>
                                )}
                                <div className="flex items-center justify-between gap-3">
                                    <button type="button" onClick={fetchSlaDebug} disabled={slaDebugLoading || !selectedObjective}
                                        className="text-[11px] font-black text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors">
                                        {slaDebugLoading ? 'Cargando…' : '🔧 SLA JSON'}
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {autoWizardStep === 'configure' && !autoV2Loading && !autoV2Generating && (
                                            <button type="button"
                                                onClick={() => runFullGeneration()}
                                                className="px-5 py-2 rounded-xl text-sm font-black text-white bg-amber-500 hover:bg-amber-600 transition-colors flex items-center gap-1.5">
                                                <Wand2 size={14}/> Generar
                                            </button>
                                        )}
                                        {autoWizardStep === 'sla_open' && !autoV2Loading && !autoV2Generating && (
                                            <>
                                                <button type="button"
                                                    onClick={() => setShowAutoV2Modal(false)}
                                                    className="px-5 py-2 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-colors">
                                                    Ver grilla
                                                </button>
                                                <button type="button"
                                                    onClick={() => runFullGeneration()}
                                                    className="px-5 py-2 rounded-xl text-sm font-black text-white bg-rose-600 hover:bg-rose-700 transition-colors flex items-center gap-1.5">
                                                    <RefreshCw size={14}/> Re-generar
                                                </button>
                                            </>
                                        )}
                                        <button type="button"
                                            onClick={() => {
                                                if (autoV2GeminiLoading) {
                                                    setAutoV2GeminiLoading(false);
                                                    setAutoV2Progress(null);
                                                }
                                                setShowAutoV2Modal(false);
                                            }}
                                            disabled={autoV2Loading || autoV2Generating}
                                            className="px-5 py-2 rounded-xl text-sm font-black text-slate-600 bg-slate-200 hover:bg-slate-300 transition-colors disabled:opacity-50">
                                            Cerrar
                                        </button>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                , document.body)}

            {showDiagnostic && diagnosticPanelPos && typeof document !== 'undefined' && createPortal(
                <>
                    <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowDiagnostic(false)} />
                    <div
                        className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-2xl min-w-[280px] max-w-[min(420px,calc(100vw-2rem))] p-3 animate-in zoom-in-95 max-h-[min(70vh,520px)] overflow-y-auto custom-scrollbar"
                        style={{ left: diagnosticPanelPos.x, top: diagnosticPanelPos.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-widest">Estructura del Servicio</p>
                        <div className="space-y-1.5">
                            {positionStructure.map((pos, i) => (
                                <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5 flex-wrap">
                                            <span>{pos.positionName}</span>
                                            {renderPositionGeneroBadge(pos.preferenciaGenero)}
                                        </p>
                                        <div className="flex flex-wrap gap-1 mt-0.5">
                                            {(pos.shifts || []).map((sh: any, j: number) => (
                                                <span key={j} className="text-[9px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-700 font-bold">
                                                    {sh.code || sh.name}{sh.hours ? ` · ${sh.hours}h` : ''}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-black text-white bg-indigo-600 px-1.5 py-0.5 rounded shrink-0">{pos.qty} pax</span>
                                </div>
                            ))}
                        </div>
                        {slaVendidas > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-600 flex justify-between items-center">
                                <span className="text-[9px] font-black text-slate-400 uppercase">Hs. Vendidas / mes</span>
                                <span className="text-base font-black text-teal-600">{slaVendidas}h</span>
                            </div>
                        )}
                    </div>
                </>,
                document.body,
            )}

            {showCoverageDiagnostic && coveragePanelPos && objectiveCoverageGapReport && typeof document !== 'undefined' && createPortal(
                <>
                    <div className="fixed inset-0 z-[9998]" aria-hidden onClick={() => setShowCoverageDiagnostic(false)} />
                    <div
                        className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-2xl min-w-[320px] max-w-[min(420px,calc(100vw-2rem))] p-3 animate-in zoom-in-95 max-h-[min(70vh,520px)] overflow-y-auto custom-scrollbar"
                        style={{ left: coveragePanelPos.x, top: coveragePanelPos.y }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-widest">Qué falta para cerrar el SLA</p>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="bg-emerald-50 rounded-lg p-2 text-center border border-emerald-100">
                                <div className="text-lg font-black text-emerald-700">{objectiveCoverageGapReport.daysFull}</div>
                                <div className="text-[8px] font-bold text-emerald-600 uppercase">Días 100%</div>
                            </div>
                            <div className="bg-amber-50 rounded-lg p-2 text-center border border-amber-100">
                                <div className="text-lg font-black text-amber-700">{objectiveCoverageGapReport.daysPartial}</div>
                                <div className="text-[8px] font-bold text-amber-600 uppercase">Parcial</div>
                            </div>
                            <div className="bg-rose-50 rounded-lg p-2 text-center border border-rose-100">
                                <div className="text-lg font-black text-rose-700">{objectiveCoverageGapReport.daysEmpty}</div>
                                <div className="text-[8px] font-bold text-rose-600 uppercase">Sin cerrar</div>
                            </div>
                        </div>
                        {Object.keys(objectiveCoverageGapReport.aggregateMissingPrimary).length > 0 && (
                            <div className="mb-3">
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Bandas faltantes en el mes (esquema M+T+N)</p>
                                <div className="flex flex-wrap gap-1">
                                    {Object.entries(objectiveCoverageGapReport.aggregateMissingPrimary)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([code, n]) => (
                                            <span key={code} className="text-[9px] font-black bg-rose-100 text-rose-700 px-2 py-0.5 rounded border border-rose-200">
                                                {n}x{code}
                                            </span>
                                        ))}
                                </div>
                            </div>
                        )}
                        {objectiveCoverageGapReport.worstDays.length > 0 && (
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Peores días (click en pie para detalle)</p>
                                <div className="space-y-1 max-h-[180px] overflow-y-auto">
                                    {objectiveCoverageGapReport.worstDays.slice(0, 8).map(wd => {
                                        const dayGaps = objectiveCoverageGapReport.byDay[wd.dateStr]?.positions || [];
                                        return (
                                            <div key={wd.dateStr} className="p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                <div className="flex justify-between text-[10px] font-black text-slate-700 dark:text-slate-200 mb-0.5">
                                                    <span>Día {wd.dateStr.slice(8)}</span>
                                                    <span className="text-rose-600">{wd.closed}/{wd.required}</span>
                                                </div>
                                                {dayGaps.slice(0, 3).map((g, i) => (
                                                    <p key={i} className="text-[9px] text-slate-500 leading-snug">{g.positionName}: {g.summary}</p>
                                                ))}
                                                {dayGaps.length > 3 && (
                                                    <p className="text-[8px] text-slate-400">+{dayGaps.length - 3} puestos más</p>
                                      
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </>,
                document.body,
            )}
            {/* ── Modal asignar guardia a RFZ vacante ── */}
            {rfzAsignando && (
                <div className="fixed inset-0 bg-black/60 z-[75] flex items-center justify-center p-4"
                    onClick={() => setRfzAsignando(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4"
                        onClick={e => e.stopPropagation()}>
                        <div className="flex items-start gap-3">
                            <span className="shrink-0 text-[10px] font-black text-white bg-red-500 px-2 py-1 rounded-lg">RFZ</span>
                            <div>
                                <h2 className="font-black text-slate-800 text-base leading-tight">Asignar guardia al refuerzo</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    {rfzAsignando.positionName || 'Sin puesto'} · {formatTime(rfzAsignando.startTime)}–{formatTime(rfzAsignando.endTime)} · {rfzAsignando.fecha}
                                </p>
                                {rfzAsignando.solicitadoPorNombre && (
                                    <p className="text-[10px] text-red-500 font-bold mt-0.5">
                                        Solicitado por: {rfzAsignando.solicitadoPorNombre}
                                    </p>
                                )}
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold -mt-1">
                            Solo guardias disponibles ese día (sin turno, RET o franco). Se prioriza titular y quien conoce el objetivo.
                        </p>
                        <div className="flex flex-col max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                            {(() => {
                                const fecha = rfzAsignando.fecha;
                                const objId = rfzAsignando.objectiveId;
                                const cliId = rfzAsignando.clientId;
                                const categorizar = (emp: any) => {
                                    const key = `${emp.id}_${fecha}`;
                                    const pend = pendingChanges[key];
                                    const shift = pend ? (pend.isDeleted ? null : pend) : shiftsMap[key];
                                    const code = String(shift?.code || '').toUpperCase();
                                    if (!shift || !code) return { rank: 0, label: 'Sin turno', cls: 'bg-emerald-100 text-emerald-700', franco: false };
                                    if (code === 'RET') return { rank: 1, label: 'RET (stand-by)', cls: 'bg-sky-100 text-sky-700', franco: false };
                                    if (['F', 'FF', 'FP'].includes(code)) return { rank: 2, label: 'De franco → FT', cls: 'bg-amber-100 text-amber-700', franco: true };
                                    return null;
                                };
                                // Experiencia (igual que Operaciones): 3 titular, 2 conoce objetivo, 1 mismo cliente.
                                const expLevel = (emp: any): number => {
                                    if (objId && emp.preferredObjectiveId === objId) return 3;
                                    const expMap: Record<string, any> = emp.experienciaObjetivos || {};
                                    const entry = objId ? expMap[objId] : null;
                                    if (entry) {
                                        const total = (entry.turnosRegulares ?? 0) + (entry.turnosRefuerzo ?? 0) + (entry.turnosConvocado ?? 0) + (entry.turnosEscuela ?? 0);
                                        if (total > 0) return 2;
                                    }
                                    if (cliId && emp.clientId === cliId) return 1;
                                    return 0;
                                };
                                const expBadge = (lv: number) =>
                                    lv === 3 ? { label: '★ Titular', cls: 'bg-emerald-100 text-emerald-700' }
                                  : lv === 2 ? { label: '◆ Conoce el objetivo', cls: 'bg-blue-50 text-blue-600' }
                                  : lv === 1 ? { label: 'Mismo cliente', cls: 'bg-slate-100 text-slate-500' }
                                  : null;
                                const candidatos = (displayedEmployees as any[])
                                    .map(emp => ({ emp, cat: categorizar(emp), exp: expLevel(emp) }))
                                    .filter((x): x is { emp: any; cat: NonNullable<ReturnType<typeof categorizar>>; exp: number } => x.cat !== null)
                                    .sort((a, b) => (a.cat.rank - b.cat.rank) || (b.exp - a.exp) || String(a.emp.name).localeCompare(String(b.emp.name)));
                                if (candidatos.length === 0) {
                                    return <p className="text-xs text-slate-400 text-center py-4">No hay guardias disponibles (sin turno, RET o franco) ese día</p>;
                                }
                                return candidatos.map(({ emp, cat, exp }) => {
                                    const eb = expBadge(exp);
                                    return (
                                        <button key={emp.id}
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await updateDoc(doc(db, 'turnos', rfzAsignando.id), {
                                                        employeeId: emp.id,
                                                        employeeName: emp.name,
                                                        ...(cat.franco ? { isFrancoTrabajado: true, coveredFromFranco: true } : {}),
                                                    });
                                                    activateRfzCorrectionFlow();
                                                    setRfzAsignando(null);
                                                    const lookupKey = planificacionPublishLookupKey(
                                                        selectedObjective,
                                                        currentDate.getFullYear(),
                                                        currentDate.getMonth() + 1,
                                                    );
                                                    const yaPublicado = isPlanificacionPublished(publishStatusMap[lookupKey]);
                                                    toast.success(
                                                        yaPublicado
                                                            ? (cat.franco
                                                                ? `${emp.name} asignado/a al RFZ (Franco Trabajado). Modo corrección activo — re-publicá para notificarle.`
                                                                : `${emp.name} asignado/a al RFZ. Modo corrección activo — re-publicá para notificarle.`)
                                                            : (cat.franco
                                                                ? `${emp.name} asignado/a al RFZ (Franco Trabajado). Publicá el cronograma para notificarle.`
                                                                : `${emp.name} asignado/a al RFZ. Publicá el cronograma para notificarle.`),
                                                    );
                                                } catch {
                                                    toast.error('Error al asignar guardia');
                                                }
                                            }}
                                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 text-left transition-colors">
                                            <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-600 shrink-0">
                                                {(emp.name || '?')[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="block text-sm text-slate-700 font-semibold truncate">{emp.name}</span>
                                                {eb && (
                                                    <span className={`inline-block mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${eb.cls}`}>{eb.label}</span>
                                                )}
                                            </div>
                                            <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full ${cat.cls}`}>{cat.label}</span>
                                        </button>
                                    );
                                });
                            })()}
                        </div>
                        <button type="button" onClick={() => setRfzAsignando(null)}
                            className="self-end text-xs text-slate-400 hover:text-slate-600">
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
            </div>

            {/* ── MODAL AJUSTAR CRONO ── */}
            <AjustarCronoOperativoModal
                open={showAjustarCronoModal}
                onClose={() => setShowAjustarCronoModal(false)}
                empresaId={empresaId || ''}
                fechaInicial={currentDate}
                fechaHastaInicial={currentDate}
                objetivoInicial={selectedObjectiveData ? { id: selectedObjectiveData.id, nombre: selectedObjectiveData.nombre || selectedObjectiveData.name || '' } : undefined}
                clients={clients}
                gridSnapshot={{ shiftsMap, pendingChanges }}
            />

            {/* ── MODAL EQUILIBRAR CRONO ── */}
            <EquilibrarCronoModal
                open={showEquilibrarModal}
                onClose={() => setShowEquilibrarModal(false)}
                empresaId={empresaId || ''}
                objectiveId={selectedObjective || ''}
                objectiveNombre={selectedObjectiveData?.nombre || selectedObjectiveData?.name || selectedObjective || ''}
                year={currentDate.getFullYear()}
                month={currentDate.getMonth() + 1}
                employees={planningDotacionEmployees}
                cctMaxBillableHours={planningLimits.monthly}
                onApplyPending={(changes) => {
                    const newPending: Record<string, any> = { ...pendingChanges };
                    for (const c of changes) {
                        newPending[`${c.empId}_${c.dateStr}`] = {
                            code:         c.code,
                            name:         c.name,
                            hours:        c.hours,
                            positionName: c.positionName,
                            startTime:    c.startTimeStr,
                            endTime:      c.endTimeStr,
                            isFranco:     false,
                            isTemp:       true,
                            swapWith:     null,
                            swapDate:     null,
                            comments:     'Equilibrar horas',
                        };
                    }
                    setPendingChanges(newPending);
                }}
            />
        </DashboardLayout>
    );
}
