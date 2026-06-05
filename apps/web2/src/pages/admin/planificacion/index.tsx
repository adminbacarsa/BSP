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
    PowerOff, LockKeyhole, Ghost, Maximize2, Copy, ClipboardPaste, Wand2
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, orderBy, limit, serverTimestamp, Timestamp, where, getDocs, getDoc, updateDoc, writeBatch, setDoc } from 'firebase/firestore';

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
    filterRowsByEmpresa,
    dedupeClientsById,
    stampEmpresaId,
    buildPlanificacionEstadoDocId,
    planificacionPublishLookupKey,
    fetchPlanificacionEstadoDoc,
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
import { listDateRangeInclusive, applyVacancyCoverageToChanges, VACANCY_NON_WORK_CODES } from '@/lib/planificacion/vacancyCoverage';
import { verifyScheduleCoverage } from '@/lib/planificacion/coverageVerification';
import { runStrictSixTwoPipeline, runSixPlusOnePipeline } from '@/lib/planificacion/planningPipeline';
import { canUseFixedBandFloater } from '@/lib/planificacion/fixedBandFloaterScheduleEngine';
import { applyAbsenceCoverage } from '@/lib/planificacion/coverageEngine';
import PlanningCoverageModal from '@/components/planificacion/PlanningCoverageModal';
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

const LEAVE_CELL_CODES = new Set(['V', 'L', 'PG', 'A', 'E', 'AA']);

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
    'RET': 'bg-white text-slate-500 border border-slate-300 font-bold',
    'REF': 'bg-violet-100 text-violet-800 border-violet-500 font-black',
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
    'REF': 'Refuerzo (no cuenta cobertura SLA ni horas planificadas)',
    'ESC': 'Escuela / formación (no cuenta cobertura SLA ni horas planificadas)',
    'PU': 'Puesto Único / Especial',
    'A': 'ART',
    'V': 'Vacaciones',
    'L': 'Licencia Esp.',
    'E': 'Enfermedad',
    'AA': 'Injustificada',
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
    'M': 8, 'T': 8, 'N': 8, 'D12': 12, 'N12': 12, 'PU': 12, 'EN': 9, 'F': 0, 'FF': 0, 'FP': 0, 'FT': 0, 'V': 0, 'L': 0, 'A': 0, 'E': 0, 'AA': 0, 'PG': 0, 'RET': 0, 'REF': 8, 'ESC': 8, 'C': 8,
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

export default function PlanificacionPage() {
    const { empresaId, empresa } = useEmpresa();
    const { isSuperAdmin } = useAuth();
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
    const [isProcessing, setIsProcessing] = useState(false);
    const [sortBy, setSortBy] = useState<'name' | 'activity' | 'client' | 'band' | 'position'>('activity');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    const [employees, setEmployees] = useState<any[]>([]);
    const [slaIdToObjId, setSlaIdToObjId] = useState<Record<string, string>>({});
    const [shiftsMap, setShiftsMap] = useState<Record<string, any>>({});
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

    const [authModal, setAuthModal] = useState<{ pendingFn: (() => Promise<void>) | null; employees: string[]; operatorName?: string; isSaveFlow?: boolean; description?: string }>({ pendingFn: null, employees: [] });
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
    const [compareShowDiffList, setCompareShowDiffList] = useState(true);

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
    const [vacancyDayReplacements, setVacancyDayReplacements] = useState<Record<string, string>>({});
    const [vacancyEditingDay, setVacancyEditingDay] = useState<string | null>(null);
    const [vacancyReplacementSearch, setVacancyReplacementSearch] = useState('');
    const [vacancyReplacementOpen, setVacancyReplacementOpen] = useState(false);
    const vacancyReplacementPanelRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!vacancyData?.startDate) {
            setVacancyActiveDates(new Set());
            setVacancyDayReplacements({});
            return;
        }
        const all = listDateRangeInclusive(vacancyData.startDate, vacancyData.endDate || vacancyData.startDate);
        const focus = vacancyData.focusDate as string | undefined;
        setVacancyActiveDates(new Set(focus && all.includes(focus) ? [focus] : all));
        setVacancyDayReplacements({});
        setVacancyEditingDay(null);
        setSelectedReplacement('');
    }, [vacancyData]);

    useEffect(() => {
        if (showVacancyModal) {
            setVacancyReplacementSearch('');
            setVacancyReplacementOpen(false);
            setVacancyEditingDay(null);
        }
    }, [showVacancyModal]);

    useEffect(() => {
        if (!vacancyReplacementOpen) return;
        const t = window.setTimeout(() => {
            vacancyReplacementPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 50);
        return () => window.clearTimeout(t);
    }, [vacancyReplacementOpen]);
    
    const [modifiers, setModifiers] = useState({ extend: false, early: false, plannedNovedad: '' });

    const [showLegend, setShowLegend] = useState(false);
    const [selectedRef, setSelectedRef] = useState<string | null>(null);

    const setPageHeader = useSetPageHeader();
    useEffect(() => {
        setPageHeader({ compactSidebar: !!selectedClient });
        return () => setPageHeader({ compactSidebar: false });
    }, [selectedClient, setPageHeader]);

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
        for (const shift of Object.values(shiftsMap) as any[]) {
            if (shift?.objectiveId === selectedObjective && shift?.employeeId) {
                ids.add(shift.employeeId);
            }
        }
        return ids;
    }, [shiftsMap, selectedObjective]);

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
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, slaCodeHoursHint]);

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
    // Combina todos los turnos de todas las posiciones del objetivo (sin duplicados).
    // Si ninguna posición tiene M/T/N/D12/N12, agrega los estándar como base mínima.
    const bulkShifts = useMemo(() => {
        const STANDARD_CODES = new Set(['M','T','N','D12','N12']);
        const allShifts: any[] = positionStructure.flatMap((pos: any) => pos.shifts || []);
        const deduped: any[] = [...new Map(allShifts.map((s: any) => [String(s.code||'').toUpperCase(), s])).values()];
        const base = deduped.length > 0 ? deduped : uniqueSLAShifts;
        const hasStandard = base.some((s: any) => STANDARD_CODES.has(String(s.code||'').toUpperCase()));
        if (hasStandard) return base;
        const existingCodes = new Set(base.map((s: any) => String(s.code||'').toUpperCase()));
        const missing = STANDARD_SHIFTS_BASE.filter(s => !existingCodes.has(s.code));
        return [...missing, ...base];
    }, [uniqueSLAShifts, positionStructure]);

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
        displayedEmployees.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
            if (!shift) return;
            const shiftPos = shift.positionName || dominant?.positionName || 'General';
            if (shiftPos !== posName) return;
            if (!isWorking(shift.code)) return;
            const objectiveMatch = shift.objectiveId === selectedObjective || !!pendingChanges[key];
            if (!objectiveMatch) return;
            const hours = Number(shift.hours) || SHIFT_HOURS_LOOKUP[shift.code] || 8;
            assigned.push({ code: String(shift.code || shift.type || '').toUpperCase(), hours });
        });

        const assigned8h = assigned.filter(a => a.hours <= 10).map(a => a.code);
        const assigned12h = assigned.filter(a => a.hours > 10).map(a => a.code);
        const shifts8h = uniqueSLAShifts.filter((s: any) => (Number(s.hours) || 8) <= 10);
        const shifts12h = uniqueSLAShifts.filter((s: any) => (Number(s.hours) || 8) > 10);
        // Cada tipo de turno puede repetirse hasta PAX veces (un empleado por pax por franja)
        const max8hSlots = shifts8h.length * pax;
        const max12hSlots = shifts12h.length * pax;

        uniqueSLAShifts.forEach((s: any) => {
            const code = String(s.code || '').toUpperCase();
            const hours = Number(s.hours) || 8;
            const is8h = hours <= 10;

            if (assigned8h.length > 0 && assigned12h.length > 0) {
                disabled.add(code);
                return;
            }
            if (assigned8h.length > 0) {
                if (!is8h) { disabled.add(code); return; }
                if (assigned8h.filter(c => c === code).length >= pax) { disabled.add(code); return; }
                if (assigned8h.length >= max8hSlots) { disabled.add(code); return; }
                return;
            }
            if (assigned12h.length > 0) {
                if (is8h) { disabled.add(code); return; }
                if (assigned12h.filter(c => c === code).length >= pax) { disabled.add(code); return; }
                if (assigned12h.length >= max12hSlots) { disabled.add(code); return; }
                return;
            }
        });
        return disabled;
    }, [selectedCell?.dateStr, selectedObjective, activePosition, positionStructure, displayedEmployees, pendingChanges, shiftsMap, uniqueSLAShifts]);

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
            if (isDateLocked(dateStr)) return;

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
    }, [selectedSwapTarget, shiftsMap, pendingChanges, selectedCell?.empId, selectedCell?.dateStr, selectedObjective]);

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

    const getPositionDailyCoverage = (dateStr: string, positionName: string) => {
        return calculateCoverageStats(dateStr, positionName, positionStructure, displayedEmployees, pendingChanges, shiftsMap);
    };

    // Sincronización Reactiva del Modal
    useEffect(() => {
        if (selectedCell) {
            const empPreferred = empDefaultPos[`${selectedCell.empId}___${selectedObjective}`];
            const smartDefault = selectedCell.currentShift?.positionName || empPreferred || dominantPosition.positionName || 'General';
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
                maxHoursWeekly: DEFAULT_LIMITS.weekly,
                maxHoursMonthly: DEFAULT_LIMITS.monthly,
            };
        const limitMonthly = parseInt(String((rule as any).maxHoursMonthly), 10) || DEFAULT_LIMITS.monthly;
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
    useEffect(() => { if (!openDrop) return; const h = () => setOpenDrop(null); document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, [openDrop]);

    // ============================================================================
    // 6. EFECTOS Y SUBSCRIPCIONES (NIVEL 5)
    // ============================================================================

    const renderLegend = () => {
        const selectedStyle = selectedRef ? SHIFT_STYLES[selectedRef] : '';
        const selectedDesc = selectedRef ? LEGEND_DESCRIPTIONS[selectedRef] : '';
        const selectedRange = selectedRef ? SHIFT_RANGES[selectedRef] : null;
        const selectedHours = selectedRef ? SHIFT_HOURS_LOOKUP[selectedRef] : 0;

        return (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setShowLegend(false)}>
                <div className="bg-white w-full max-w-2xl rounded-xl p-6 shadow-2xl relative border border-slate-100 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-6 pb-3 border-b border-slate-100 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl shadow-sm">
                                <Info size={24} strokeWidth={2.5}/>
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-slate-800 tracking-tight">Referencias Operativas</h3>
                                <p className="text-slate-500 font-bold text-xs">Haga clic en un ícono para ver detalles</p>
                            </div>
                        </div>
                        <button onClick={() => setShowLegend(false)} className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={20}/>
                        </button>
                    </div>
                    <div className="overflow-y-auto custom-scrollbar pr-2 mb-4">
                        <div className="grid grid-cols-5 gap-3">
                            {Object.entries(SHIFT_STYLES).map(([code, styleClass]: [string, any]) => (
                                <button key={code} onClick={() => setSelectedRef(code)} className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all border-2 ${selectedRef === code ? 'border-indigo-600 shadow-lg ring-2 ring-indigo-100 scale-105 z-10' : 'border-transparent hover:bg-slate-50 hover:scale-105'}`}>
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black border shadow-sm ${styleClass}`}>
                                        {code === 'CONSOLIDATED' ? 'C' : code}
                                    </div>
                                    <span className="text-[9px] font-bold text-slate-400">{code === 'CONSOLIDATED' ? 'C' : code}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mt-auto pt-4 border-t border-slate-100 shrink-0 min-h-[80px]">
                        {selectedRef ? (
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 animate-in slide-in-from-bottom-2 fade-in duration-300">
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-black border shadow-md ${selectedStyle}`}>
                                        {selectedRef === 'CONSOLIDATED' ? 'C' : selectedRef}
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-sm font-black text-slate-800">{selectedDesc || 'Sin descripción'}</h4>
                                        <div className="flex gap-4 mt-1">
                                            {selectedRange ? (
                                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 shadow-sm flex items-center gap-1">
                                                    <Clock size={10}/> {selectedRange}
                                                </span>
                                            ) : selectedHours > 0 && (
                                                <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border shadow-sm flex items-center gap-1">
                                                    <Clock size={10}/> {selectedHours} hs carga
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-300 font-bold text-xs italic gap-2 py-2">
                                <MousePointerClick size={16}/> Seleccione un código
                            </div>
                        )}
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100 shrink-0">
                         <h5 className="text-[9px] font-black uppercase text-slate-400 mb-2 flex items-center gap-1"><ShieldCheck size={10}/> Estados</h5>
                        <div className="flex flex-wrap gap-4">
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm ring-1 ring-slate-100"></div><span className="text-[10px] font-bold text-slate-600">Presente</span></div>
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-rose-500 border-2 border-white shadow-sm ring-1 ring-slate-100"></div><span className="text-[10px] font-bold text-slate-600">Ausente</span></div>
                            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-white border border-slate-300 flex items-center justify-center"><div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div></div><span className="text-[10px] font-bold text-slate-600">Conflicto</span></div>
                            <div className="flex items-center gap-1.5"><div className={`w-5 h-3 rounded text-[7px] font-black flex items-center justify-center ${SHIFT_STYLES['RET']}`}>RET</div><span className="text-[10px] font-bold text-slate-600">Retén (disponible)</span></div>
                            <div className="flex items-center gap-1.5"><div className={`w-5 h-3 rounded text-[7px] font-black flex items-center justify-center ${OTHER_OBJECTIVE_CELL_STYLE}`}>M</div><span className="text-[10px] font-bold text-slate-600">Otro objetivo</span></div>
                            <div className="flex items-center gap-1.5"><span className="text-[9px] font-black text-pink-700 bg-pink-100 border border-pink-200 px-1.5 py-0.5 rounded">♀ F</span><span className="text-[10px] font-bold text-slate-600">Puesto solo femenino</span></div>
                            <div className="flex items-center gap-1.5"><span className="text-[9px] font-black text-blue-700 bg-blue-100 border border-blue-200 px-1.5 py-0.5 rounded">♂ M</span><span className="text-[10px] font-bold text-slate-600">Puesto solo masculino</span></div>
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
    }, [selectedClient, selectedObjective, currentDate, empresaId, migracionCompleta, scopeEmpresa, clients, tenantClientIds, slaIdToObjId]);

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
            snap.docs.forEach(d => {
                const data = d.data();
                if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
                if (data.startTime?.seconds) {
                    const dateKey = getDateKey(data.startTime);
                    const key = `${data.employeeId}_${dateKey}`;
                    map[key] = {
                        id: d.id, ...data, code: data.code || data.type, objectiveId: data.objectiveId,
                        startTime: data.startTime, endTime: data.endTime, realStartTime: data.realStartTime,
                        status: data.status, isPresent: data.isPresent || false, isAbsent: data.isAbsent || false,
                        isExtended: data.isExtended, isEarlyStart: data.isEarlyStart || data.isEarlyEntry,
                        isFrancoTrabajado: data.isFrancoTrabajado || false, isFrancoCompensatorio: data.isFrancoCompensatorio || false,
                        swapWith: data.swapWith, swapDate: data.swapDate, hasNovedad: data.hasNovedad, plannedNovedad: data.plannedNovedad,
                        positionName: data.positionName,
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
        }, (e) => { console.error('[plan] turnos error:', e); toast.error(`Error cargando turnos: ${e.code || e.message}`); });

        // Actividad Reciente (audit_logs) - sin índices compuestos: traemos últimos N y filtramos en memoria.
        const unsubLogs = onSnapshot(
            query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(80)),
            (snap) => {
                const rows = snap.docs
                    .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                    .map((d) => {
                        const data: any = d.data();
                        const ts =
                            data.timestamp?.toDate ? data.timestamp.toDate()
                            : (data.timestamp?.seconds ? new Date(data.timestamp.seconds * 1000)
                            : new Date());
                        return {
                            id: d.id,
                            timestamp: ts.getTime(),
                            label: ACTION_LABELS[data.action] || data.action || 'CAMBIO',
                            detail: data.details || '',
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
                    })
                    .slice(0, 20);
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
            query(collection(db, 'user_notifications'), orderBy('createdAt', 'desc'), limit(50)),
            (snap) => {
                const rows = snap.docs.map(d => {
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
                });
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
                .map(d => ({ id: d.id, source: 'NOVEDAD', ...d.data(), msg: d.data().description }));
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
                if (row) {
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
    }, [selectedObjective, currentDate, empresaId]);

    useEffect(() => {
        const { pos, shift } = buildDotacionMapsFromEmployees(employees);
        setEmpDefaultPos(pos);
        setEmpDefaultShift(shift);
    }, [employees]);

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

        // Ausencias que requieren gestión de cobertura
        const isVacancyAbsence = notif.type &&
            (notif.type === 'Vacaciones' || notif.type.includes('Licencia') || notif.type === 'PG Permiso Gremial');

        if (notif.date || notif.startDate) {
            try {
                let targetDate: Date | null = null;
                const rawDate = notif.date || notif.startDate;

                if (typeof rawDate === 'string') {
                    const parts = rawDate.split('-');
                    if(parts.length === 3) targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                } else if (rawDate?.seconds) {
                    targetDate = new Date(rawDate.seconds * 1000);
                }

                if (targetDate) {
                    // Navegar al mes correcto SIEMPRE (antes de abrir cualquier modal)
                    setCurrentDate(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
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
        const key = `${empId}___${selectedObjective}`;
        const emp = employees.find((e) => e.id === empId);
        const prevPosMap = { ...empDefaultPos };
        const prevShiftMap = { ...empDefaultShift };
        const newPosMap = { ...empDefaultPos };
        if (posName) { newPosMap[key] = posName; } else { delete newPosMap[key]; }
        setEmpDefaultPos(newPosMap);
        const newShiftMap = { ...empDefaultShift };
        if (shiftCode) { newShiftMap[key] = shiftCode.toUpperCase(); } else { delete newShiftMap[key]; }
        setEmpDefaultShift(newShiftMap);
        setEmpPosPicker(null);
        try {
            const nextDotacion: PlanificacionDotacionMap = { ...(emp?.planificacionDotacion || {}) };
            if (posName) {
                nextDotacion[selectedObjective] = {
                    positionName: posName,
                    ...(shiftCode ? { shiftCode: shiftCode.toUpperCase() } : {}),
                };
            } else {
                delete nextDotacion[selectedObjective];
            }
            await updateDoc(doc(db, 'empleados', empId), { planificacionDotacion: nextDotacion });
        } catch {
            setEmpDefaultPos(prevPosMap);
            setEmpDefaultShift(prevShiftMap);
            toast.error('No se pudo guardar el puesto asignado');
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
    const handleTransferEmployee = async (emp: any) => { if (!selectedObjective) return; if (!confirm(`¿Transferir a ${emp.name} a este objetivo?`)) return; try { await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective }); await addDoc(collection(db, 'audit_logs'), { action: 'TRANSFERENCIA_OBJETIVO', module: 'PLANIFICADOR', details: `Transfirió a ${emp.name} al objetivo ${selectedObjective}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid }); toast.success("Transferencia exitosa"); } catch (e) { toast.error("Error al transferir"); } };
    const handleDelete = async () => {
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        if (!selectedCell) return;
        if (isDateLocked(selectedCell.dateStr)) { toast.warning("Bloqueado."); return; }
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

    const handleSaveAll = async () => {
        if (isProcessing) return;
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        const count = Object.keys(pendingChanges).length;
        if (count === 0) return;
        if (!confirm(`¿Confirmar y guardar ${count} cambios?`)) return;

        // Verificar si algún empleado superaría las 200h
        const over200: string[] = [];
        Object.keys(pendingChanges).forEach(key => {
            const empId = key.split('_')[0];
            const hours = empMonthlyHours[empId] || 0;
            if (hours > 200) {
                const empName = displayedEmployees.find((e: any) => e.id === empId)?.name || empId;
                if (!over200.includes(empName)) over200.push(empName);
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
            const isPublished = !!publishStatusMap[publishLookupKey];
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

                    if (change.isDeleted) {
                        actionType = 'ELIMINACION_MASIVA';
                        actionDetail = `Borró turno de ${empName} el ${dateStr}`;
                        if (existing?.id) batch.delete(doc(db, 'turnos', existing.id));
                    } else {
                        if (existing?.id) batch.delete(doc(db, 'turnos', existing.id));

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
                        else end.setTime(start.getTime() + ((change.hours != null ? change.hours : 8)*3600000));

                        const safeSwapWith = change.swapWith || null;
                        const safeSwapDate = change.swapDate || null;

                        // FIX DE SEGURIDAD: Evitar undefined en positionName
                        const safePositionName = change.positionName || 'General';

                        batch.set(doc(collection(db, 'turnos')), stampEmpresaId({
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
                            comments: change.comments || 'Carga Masiva',
                            isExtended: change.isExtended || false,
                            isEarlyStart: change.isEarlyStart || false,
                            plannedNovedad: change.plannedNovedad || null,
                            positionName: safePositionName,
                            coveredBy: change.coveredBy || null,
                            draft: correctionMode ? false : !isPublished,
                            ...deploymentFieldsForFirestore(change),
                        }, empresaId));

                        logData.push({ empId, date: dateStr, action: correctionMode ? 'CORRECCION_SUPERADMIN' : actionType });
                        if (isPublished || correctionMode) {
                            batch.set(doc(collection(db, 'audit_logs')), stampEmpresaId({
                                action: correctionMode ? 'CORRECCION_SUPERADMIN' : actionType,
                                module: 'PLANIFICADOR',
                                details: correctionMode ? `[CORRECCIÓN] ${actionDetail}` : actionDetail,
                                timestamp: serverTimestamp(),
                                actorName: realActorName,
                                actorUid: auth.currentUser?.uid,
                            }, empresaId));
                        }
                    }
                }

                await addDoc(collection(db, 'planificaciones_historial'), { timestamp: serverTimestamp(), user: realActorName, period: `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`, objectiveId: selectedObjective, changes: logData, count, snapshot: JSON.stringify(snapshotData) });
                await batch.commit();
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

        if (over200.length > 0) {
            setAuthModal({ pendingFn: doSave, employees: over200, operatorName: activeActorName || operatorName, isSaveFlow: true });
            setAuthPin('');
            setAuthError('');
            return;
        }

        await doSave();
    };

    const handlePublish = async () => {
        if (!selectedObjective) return;
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
        const publishDocId = buildPlanificacionEstadoDocId(empresaId, selectedObjective, year, month);
        const isAlreadyPublished = !!publishStatusMap[publishLookupKey];
        let verb = isAlreadyPublished
            ? 'El cronograma ya fue publicado. ¿Volver a notificar todos los cambios desde la última publicación?'
            : '¿Publicar cronograma? Se notificará a todos los empleados del objetivo.';
        if (isSuperAdmin && (slaHoursMismatch || hasCoverageGaps)) {
            const warnings: string[] = [];
            if (slaHoursMismatch) {
                const delta = slaRounded - plannedRounded;
                warnings.push(
                    delta > 0
                        ? `SLA: ${plannedRounded}h planificadas vs ${slaRounded}h vendidas (faltan ${delta}h).`
                        : `SLA: ${plannedRounded}h planificadas vs ${slaRounded}h vendidas (excede ${-delta}h).`,
                );
            }
            if (hasCoverageGaps) {
                warnings.push(`Cobertura: ${coverageGapDays} día(s) con huecos respecto al esquema SLA.`);
            }
            verb = `[SUPERADMIN — sin validación SLA/cobertura]\n\n${warnings.join('\n')}\n\n¿Publicar igual?`;
        }
        if (!confirm(verb)) return;
        setIsPublishing(true);
        try {
            const auth = getAuth();
            const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';
            // 1. Registrar publicación (doc id con tenant)
            await setDoc(doc(db, 'planificacion_estados', publishDocId), {
                objetivoId: selectedObjective,
                objectiveId: selectedObjective,
                año: year,
                mes: month,
                year,
                month,
                publishedAt: serverTimestamp(),
                publishedBy: actorName,
                empresaId: empresaId || null,
            });
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
            draftsSnap.docs.forEach(d => batch.update(d.ref, { draft: false }));
            await batch.commit();
            // 3. Registrar en audit_logs
            await addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                action: 'PUBLICACION_CRONOGRAMA',
                module: 'PLANIFICADOR',
                details: isSuperAdmin && (slaHoursMismatch || hasCoverageGaps)
                    ? `[OVERRIDE SA] Cronograma publicado sin validación SLA/cobertura — ${draftsSnap.docs.length} turno(s) · ${month}/${year}`
                    : `Cronograma publicado — ${draftsSnap.docs.length} turno(s) notificado(s) · ${month}/${year}`,
                timestamp: serverTimestamp(),
                actorName,
                actorUid: getAuth().currentUser?.uid || null,
            }, empresaId));
            // 4. Actualizar estado local
            setPublishStatusMap(prev => ({ ...prev, [publishLookupKey]: { publishedAt: new Date(), publishedBy: actorName } }));
            setNeedsRepublishMap(prev => ({ ...prev, [publishLookupKey]: false }));
            toast.success(`Cronograma publicado — ${draftsSnap.docs.length} turno(s) notificado(s)`);
        } catch (e) {
            console.error(e);
            toast.error('Error al publicar');
        } finally {
            setIsPublishing(false);
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
        const days = activeDays.map((dateStr) => {
            const replId = vacancyDayReplacements[dateStr] ?? selectedReplacement ?? '';
            const emp = replId ? employees.find((e: any) => e.id === replId) : null;
            return { dateStr, replacementEmpId: emp?.id ?? null, replacementName: emp?.name ?? null };
        });
        const { changes, count, covered, cleared } = applyVacancyCoverageToChanges(pendingChanges, {
            vacancyData,
            days,
            selectedObjective,
            activePosition,
            shiftsMap,
            getTypicalShift,
        });
        const vd = vacancyData;
        const absCode = days.length ? (changes[`${vd.employeeId}_${days[0].dateStr}`]?.code || '—') : '—';
        setPendingChanges(changes);
        setShowVacancyModal(false);
        setVacancyData(null);
        setVacancyActiveDates(new Set());
        setVacancyDayReplacements({});
        const clearedMsg = cleared > 0 ? ` Se removieron ${cleared} turno(s) de cobertura anterior.` : '';
        if (covered > 0) {
            toast.success(`${absCode} en ${count} día(s) — ${covered} con cobertura asignada.${clearedMsg} Guardá los cambios.`);
        } else {
            toast.success(`${absCode} en ${count} día(s) — sin cobertura asignada.${clearedMsg} Guardá los cambios.`);
        }
    };
    
    // 🛑 FIX: Inyección de Puesto en Bulk
    const applyBulkChange = (shiftConfig: any) => { 
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; } 
        if (!selection.start || !selection.end) return; 
        const startDay = daysInMonth[Math.min(selection.start.c, selection.end.c)]; 
        if (isDateLocked(getDateKey(startDay))) { toast.warning("Periodo cerrado."); return; } 
        const minR = Math.min(selection.start.r, selection.end.r); 
        const maxR = Math.max(selection.start.r, selection.end.r); 
        const minC = Math.min(selection.start.c, selection.end.c); 
        const maxC = Math.max(selection.start.c, selection.end.c); 
        const newChanges = { ...pendingChanges }; 
        let count = 0; 
        let francosReplaced = 0; 
        let skippedExcluded = 0;
        
        const fallbackPos = activePosition || (positionStructure[0]?.positionName) || 'General';
        const getEmpPos = (emp: any) => empDefaultPos[`${emp.id}___${selectedObjective}`] || fallbackPos;

        for (let r = minR; r <= maxR; r++) { const emp = displayedEmployees[r]; if (!emp) continue; for (let c = minC; c <= maxC; c++) { const day = daysInMonth[c]; const key = `${emp.id}_${getDateKey(day)}`; const existing = shiftsMap[key]; if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig && shiftConfig.code !== 'F') { francosReplaced++; } } }
        let markAsFT = false;
        if (francosReplaced > 0) { if(confirm(`⚠️ Estás sobrescribiendo ${francosReplaced} Francos.\n¿Deseas marcarlos como FT?`)) { markAsFT = true; } }
        const blockedEmps = new Set<string>();
        for (let r = minR; r <= maxR; r++) { const emp = displayedEmployees[r]; if (!emp) continue; const empPos = getEmpPos(emp); for (let c = minC; c <= maxC; c++) { const day = daysInMonth[c]; const dateStr = getDateKey(day); const key = `${emp.id}_${dateStr}`; const existing = shiftsMap[key]; if (isShiftConsolidated(existing)) continue; if (shiftConfig === null) { newChanges[key] = { isDeleted: true }; count++; } else { const assignPos = shiftConfig.positionName || empPos; const posCfg = positionStructure.find((p: any) => p.positionName === assignPos); if (isPosExcludedOnDate(posCfg, dateStr) && isPlanningWorkShiftCode(shiftConfig.code)) { skippedExcluded++; continue; } const { blocked, warnings } = checkRestricciones(emp, dateStr, assignPos, shiftConfig.code); if (blocked) { blockedEmps.add(emp.name); continue; } if (warnings.length > 0) warnings.forEach(w => toast.warning(w, { duration: 8000 })); let cellIsFT = false; if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') { cellIsFT = markAsFT; } newChanges[key] = { ...shiftConfig, isTemp: true, oldObjectiveId: existing?.objectiveId, isFrancoTrabajado: cellIsFT, positionName: assignPos }; count++; } } }
        if (blockedEmps.size > 0) toast.error(`🚫 Bloqueados (objetivo excluido): ${[...blockedEmps].join(', ')}`, { duration: 10000 });
        if (skippedExcluded > 0) toast.warning(`${skippedExcluded} celda(s) omitida(s): puesto excluido por SLA ese día`, { duration: 8000 });
        setPendingChanges(newChanges);
        toast.info(`${count} celdas`);
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
        if (isDateLocked(selectedCell.dateStr)) { toast.error("Periodo cerrado."); return; } 
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
        applyToPending({ ...shiftConfig, positionName, isFrancoTrabajado: isFT, isFrancoCompensatorio: false, isExtended: modifiers.extend, isEarlyStart: modifiers.early, plannedNovedad: modifiers.plannedNovedad });
    };

    const confirmPendingAssignment = () => { if (!pendingAssignment) return; applyToPending({ ...pendingAssignment.shiftConfig, positionName: pendingAssignment.positionName, isFrancoTrabajado: francoMode === 'FT_SELECTION', isExtended: modifiers.extend, isEarlyStart: modifiers.early, plannedNovedad: modifiers.plannedNovedad }); setPendingAssignment(null); setAuthWarningMessage(''); };

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
                toast.success(`${maxR - minR + 1}×${maxC - minC + 1} copiado — Ctrl+V o botón para pegar`);
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
                    if (isDateLocked(dateStr)) return;
                    const key = `${emp.id}_${dateStr}`;
                    if (!shift) { if (newChanges[key] || shiftsMap[key]) newChanges[key] = { isDeleted: true }; }
                    else { newChanges[key] = { ...shift, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective }; pasted++; }
                });
                setPendingChanges(newChanges);
                setClipboard(null); setClipboardDim(null); setSelection({ start: null, end: null });
                toast.success(`${pasted} turno(s) pegado(s)`);
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                setSelection({ start: null, end: null });
                setClipboard(null); setClipboardDim(null);
                setColumnSelectMode(false); setColumnSelectSource(null); setIsDragging(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selection, clipboard, displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, columnSelectMode]);

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
            const shift = pendingChanges[key] || shiftsMap[key]; 
            const absence = absencesMap[key]; 
            if (selection.start.r === selection.end.r && selection.start.c === selection.end.c) { setSelection({ start: null, end: null }); } 
            {
                // Si la celda tiene borrado pendiente, tratar como vacía para permitir reasignar sin guardar
                const effectiveShift = pendingChanges[key]?.isDeleted ? null : shift;
                const empPreferred = empDefaultPos[`${emp.id}___${selectedObjective}`];
                const defaultPos = effectiveShift?.positionName || empPreferred || dominantPosition.positionName;
                setActivePosition(defaultPos);
                if (isShiftConsolidated(effectiveShift)) { setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); return; }
                const isLocked = isDateLocked(dateStr);
                const absenceAlreadyHandled = effectiveShift && ['V','L','PG','A','E','AA'].includes(effectiveShift.code || '');
                if (!isLocked && ((effectiveShift && absence && !absenceAlreadyHandled) || (effectiveShift && effectiveShift.hasNovedad && !absenceAlreadyHandled))) { findNeighbors(effectiveShift, dateStr); setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); if (absence && absence.type) { setVacancyData({ ...absence, source: 'AUSENCIA', focusDate: dateStr }); setShowVacancyModal(true); } else { setShowConflictModal(true); } }
                else if (!isLocked && absence && !effectiveShift) { setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); setVacancyData({ ...absence, source: 'AUSENCIA', focusDate: dateStr }); setShowVacancyModal(true); }
                else { if (!isLocked) { let initialModifiers = { extend: false, early: false, plannedNovedad: '' }; if (effectiveShift) { initialModifiers = { extend: effectiveShift.isExtended || false, early: effectiveShift.isEarlyStart || false, plannedNovedad: effectiveShift.plannedNovedad || '' }; } setModifiers(initialModifiers); setFrancoMode('NONE'); } setCellEditMode(false); setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); }
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
        toast.success(`${maxR - minR + 1}×${maxC - minC + 1} copiado — seleccioná destino y pegá`);
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
            if (isDateLocked(dateStr)) return;
            const key = `${emp.id}_${dateStr}`;
            if (!shift) {
                if (newChanges[key] || shiftsMap[key]) newChanges[key] = { isDeleted: true };
            } else {
                newChanges[key] = { ...shift, isTemp: true, employeeId: emp.id, objectiveId: selectedObjective };
                pasted++;
            }
        });
        setPendingChanges(newChanges);
        setClipboard(null);
        setClipboardDim(null);
        setSelection({ start: null, end: null });
        toast.success(`${pasted} turno(s) pegado(s)`);
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
                if (isDateLocked(targetDateStr)) return;
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
                globalRetPool,
                strictSixTwo: genBrain.strictSixTwo,
                noFlexSchemeEmployees: true,
                authorizedOver200Ids: authorizedOver200IdsRef.current.size > 0 ? authorizedOver200IdsRef.current : undefined,
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
                ? (() => { try { return runSixPlusOnePipeline(baseGenCtx); } catch { return null; } })()
                : canFloater
                    ? (() => { try { return runStrictSixTwoPipeline({ ...baseGenCtx, rotateShifts: false, demandDriven: false }); } catch { return null; } })()
                    : null;
            const useFloaterPipeline = !!strictPipeline;
            const gen = strictPipeline?.generation ?? generateScheduleV4({
                ...baseGenCtx,
                ...(useStrictPipeline ? { rotateShifts: false, demandDriven: false } : {}),
            });

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
     * Solo ajusta los contadores — no re-ejecuta el motor de verificación.
     */
    const applyCoverageToStats = (coveredCount: number) => {
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
            const slaClosed = newUncovered === 0
                && (slaVendidas <= 0 || prev.totalBillableHours >= slaVendidas - 0.5);
            return { ...prev, uncoveredSlots: newUncovered, slaHoursClosed: slaClosed };
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
    ) => {
        const gridEmployees = employeesForRows ?? displayedEmployees;
        return (
        <table className="planning-grid-table border-separate border-spacing-0 w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 shadow-md">
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
                                    className={`group ${dragOverVisual === idx ? 'border-t-2 border-t-indigo-400' : ''} ${(empMonthlyHours[emp.id] || 0) >= 200 ? 'bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
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
                                        className={`sticky left-0 z-20 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8 ${forceShowAll ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'} dark:border-slate-700 ${(empMonthlyHours[emp.id] || 0) >= 200 ? 'bg-red-50 group-hover:bg-red-100 dark:bg-red-950/30 dark:group-hover:bg-red-900/30' : 'bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/60'}`}
                                    >
                                        {(() => {
                                            const empLat = Number(emp.lat ?? emp.latitude ?? 0);
                                            const empLng = Number(emp.lng ?? emp.longitude ?? 0);
                                            const objLat = Number(selectedObjectiveData?.lat ?? 0);
                                            const objLng = Number(selectedObjectiveData?.lng ?? 0);
                                            const distKm = (empLat && empLng && objLat && objLng) ? haversineKm(empLat, empLng, objLat, objLng) : null;
                                            const monthHours = empMonthlyHours[emp.id] || 0;
                                            const cctHours = empCctCurrentHours[emp.id] || 0;
                                            const retDays = empRetDays[emp.id] || 0;
                                            const displayHours = hoursMode === 'cct' ? cctHours : monthHours;
                                            const hoursColor = displayHours >= 200 ? 'text-red-600 font-black'
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
                                        const selected = !isSnapshotView && isCellSelected(idx, dayIndex);
                                        const isLockedDate = !isSnapshotView && isDateLocked(getDateKey(day));
                                        const isCellWeekend = [0, 6].includes(day.getDay());
                                        let content = null; let style = "";
                                        let isFT = s?.isFrancoTrabajado || p?.isFrancoTrabajado; let isFF = s?.isFrancoCompensatorio || p?.isFrancoCompensatorio;
                                        let isExtended = s?.isExtended || p?.isExtended; let isEarly = s?.isEarlyStart || p?.isEarlyStart; 
                                        let plannedNov = s?.plannedNovedad || p?.plannedNovedad; 
                                        let absence = absencesMap[key];
                                        if (absence && ((absence.inferredCode as string) || inferAbsenceCode(absence)) === 'AA' && !publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)]) absence = null as any;
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
                                        const _planPublished = !!publishStatusMap[planificacionPublishLookupKey(selectedObjective, currentDate.getFullYear(), currentDate.getMonth() + 1)];
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
                                        const activeShift = (p && !p.isDeleted) ? p : s;
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
                                        const cellPosName = (p && !p.isDeleted ? p.positionName : s?.positionName) || null;
                                        const cellCode = (p && !p.isDeleted) ? (isFT ? 'FT' : isFF ? 'FF' : p.code) : s ? (isFT ? 'FT' : isFF ? 'FF' : s.code) : null;
                                        const cellRange = cellCode
                                            ? (SHIFT_RANGES[cellCode] || (
                                                activeShift?.startTime && activeShift?.endTime
                                                    ? `${formatTime(activeShift.startTime)} - ${formatTime(activeShift.endTime)}`
                                                    : null
                                              ))
                                            : null;
                                        const cellDateStr = getDateKey(day);
                                        const excludedOnDay = excludedPositionsByDate[cellDateStr];
                                        const isExclusionCol = !!excludedOnDay?.length;
                                        const cellPosExcluded = !!(cellPosName && excludedOnDay?.includes(cellPosName));
                                        const leaveCellCode = absence
                                            ? String(absence.inferredCode || inferAbsenceCode(absence) || content || '').toUpperCase()
                                            : String(cellCode || '').toUpperCase();
                                        const isLeaveCell = !!absence || LEAVE_CELL_CODES.has(leaveCellCode);
                                        return <td key={key} onMouseDown={() => !isSnapshotView && handleMouseDown(idx, dayIndex)} onMouseEnter={(e) => { if (!isSnapshotView && isDragging) setSelection(pr => ({...pr, end:{r:idx, c:dayIndex}})); if (isLeaveCell) { const absType = absence?.type || activeShift?.name || LEGEND_DESCRIPTIONS[leaveCellCode] || leaveCellCode; const reason = absence?.reason || activeShift?.comments || pending?.comments || ''; const covered = resolveTitularCoverageName(emp.id, emp.name || '', cellDateStr, shiftsMap, pendingChanges, (id) => employees.find((x: any) => x.id === id)?.name, coveredByCell); setShiftTooltip({ label: buildLeaveCellTooltipLabel({ absenceType: absType, reason, coveredBy: covered }), pos: null, range: null, x: e.clientX, y: e.clientY, restHours: null }); } else if ((s || p) && !absence) { const shiftLabel = cellCode ? (LEGEND_DESCRIPTIONS[cellCode] || cellCode) : null; const _isFrancoTip = cellCode ? ['F','FF','FP','FT'].includes(String(cellCode).toUpperCase()) : false; const _restHrs = _isFrancoTip ? calcFrancoRestHours(emp.id, dayIndex) : null; const _isRet = String(cellCode || '').toUpperCase() === 'RET'; const _exclHint = cellPosExcluded ? `\n⚠ Puesto excluido por SLA este día` : ''; const _otherObjHint = isOtherObjectiveShift && activeShift?.objectiveId ? `\n📍 Otro objetivo: ${getObjectiveName(activeShift.objectiveId)}` : ''; setShiftTooltip({ label: shiftLabel ? `${shiftLabel}${_exclHint}${_otherObjHint}` : (_exclHint || _otherObjHint || null), pos: _isRet ? null : (cellPosName || null), range: _isRet ? null : cellRange, x: e.clientX, y: e.clientY, restHours: _restHrs }); } else if (isExclusionCol) { setShiftTooltip({ label: excludedPositionsTooltip(excludedOnDay, cellDateStr), pos: null, range: null, x: e.clientX, y: e.clientY, restHours: null }); } else setShiftTooltip(null); }} onMouseLeave={() => setShiftTooltip(null)} className={`border-b border-r p-0.5 ${!isSnapshotView && !isLockedDate && !isServiceLocked ? 'cursor-pointer' : 'cursor-default'} text-center relative ${selected ? 'bg-indigo-200 dark:bg-indigo-800/50' : isExclusionCol ? 'bg-rose-50/50 dark:bg-rose-950/15 sla-excluded-day-col' : isCellWeekend ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`} title={isExclusionCol && !s && !p ? excludedPositionsTooltip(excludedOnDay, cellDateStr) : isOtherObjectiveShift && activeShift?.objectiveId ? `Turno en ${getObjectiveName(activeShift.objectiveId)}` : undefined}><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style} ${cellPosExcluded ? 'ring-1 ring-rose-400/70' : ''}`}>{content}{isExclusionCol && !content && (<span className="absolute bottom-0 left-0 w-1.5 h-1.5 rounded-full bg-rose-400/80" title="Día con puesto(s) excluido(s)"/>)}{isSwap && (<div className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${swapPending ? 'bg-amber-600 text-white' : 'bg-cyan-600 text-white'}`}>{swapPending ? 'S!' : 'S'}</div>)}{(isExtended || isEarly) && <div className="absolute -top-1 -right-1 text-[8px] bg-slate-800 text-white px-1 rounded-full">+</div>}{statusIndicator && <div className={`absolute top-0 right-0 w-2 h-2 rounded-full border border-white ${statusIndicator}`}></div>}{hasConflict && ( <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center animate-pulse border-2 border-red-500 z-20"><Siren size={14} className="text-white drop-shadow-md"/></div> )}{isGuest && (s || p) && !absence && !isOtherObjectiveShift && (<div className="absolute bottom-0 left-0"><Briefcase size={8} className="text-amber-600 drop-shadow-sm"/></div>)}{isOtherObjectiveShift && content && (<div className="absolute bottom-0 left-0"><MapPin size={7} className="text-slate-300 drop-shadow-sm"/></div>)}</div></td>;
                                    })}
                                </tr>
                            )}
                            
                            {/* FILA SNAPSHOT (HISTÓRICA) - Solo se muestra si hay snapshotData y estamos en modo snapshot */}
                            {isSnapshotView && snapshotData && (
                                <tr className="bg-amber-50 border-b-2 border-amber-200">
                                    <td className="sticky left-0 z-20 bg-amber-100 p-2 border-r border-b shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                                        <span className="text-[9px] font-black uppercase text-amber-700 flex items-center gap-1"><History size={10}/> {emp.name} (Hist)</span>
                                    </td>
                                    {daysInMonth.map((day) => {
                                        const key = `${emp.id}_${getDateKey(day)}`;
                                        const snapShift = snapshotData[key];
                                        let content = null; let style = "bg-amber-50 text-amber-300";
                                        if (snapShift) {
                                            content = snapShift.code;
                                            style = `${SHIFT_STYLES[snapShift.code] || 'bg-slate-200'} opacity-70 grayscale`;
                                            if (snapShift.isFrancoTrabajado) { content = "FT"; style = SHIFT_STYLES['FT']; }
                                            else if (snapShift.isFrancoCompensatorio) { content = "FF"; style = SHIFT_STYLES['FF']; }
                                        }
                                        if (compareChangedKeys?.has(key)) {
                                            style += ' ring-2 ring-amber-600 ring-offset-1 z-20 opacity-100';
                                        }
                                        return <td key={`snap_${key}`} className="border-b border-r p-0.5 text-center bg-amber-50/50"><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-bold ${style}`}>{content}</div></td>;
                                    })}
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </tbody>
            <tfoot className="sticky bottom-0 z-10 bg-slate-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] border-t-2 border-slate-300">
                <tr>
                    <td className="sticky left-0 z-20 bg-slate-50 p-2 border-r border-b font-black text-[10px] uppercase text-slate-500 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] h-8" style={{ width: nameColWidth, minWidth: nameColWidth }}>
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
                            <span className="flex items-center gap-1 text-slate-500">
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
        </table>
        );
    };

    const compareDiffKeys = planningCompareDiff?.changedKeys ?? null;

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
            <div className={`overflow-hidden transition-all duration-300 ease-in-out no-print ${selectedClient ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-40 opacity-100'}`}>
                <PageHeader
                    title="Planificador"
                    subtitle="Gestión de turnos y asignaciones"
                    icon={CalendarCheck}
                    className="px-2 pt-2"
                />
            </div>
            <div className={`flex flex-col animate-in fade-in select-none transition-all duration-300 ease-in-out min-h-0 ${selectedClient ? 'h-[calc(100dvh-5.5rem)] lg:h-[calc(100dvh-6.5rem)] overflow-hidden p-1 space-y-1.5' : 'p-2 space-y-4 h-[calc(100vh-220px)] lg:h-[calc(100vh-160px)]'}`} onMouseUp={handleMouseUp} onClick={() => setEmpPosPicker(null)}>

                <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 shrink-0 relative z-40 ${selectedClient ? 'py-1.5 px-2' : 'p-3'}`}>
                    {comparingSnapshot ? (
                         <div className="flex-1 bg-amber-50 border-amber-200 border px-4 py-2 rounded-xl flex justify-between items-center animate-in slide-in-from-top no-print shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-amber-100 rounded-lg text-amber-700"><Split size={20}/></div>
                                <div><p className="text-xs font-black text-amber-800 uppercase">Modo Comparación Activado</p><p className="text-[10px] text-amber-600">Histórico ({new Date(comparingSnapshot.date).toLocaleString()}) vs actual — {planningCompareDiff?.changedCount ?? 0} celda(s) distinta(s)</p></div>
                            </div>
                            <button onClick={exitSnapshotMode} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-black hover:bg-amber-700 shadow-sm flex items-center gap-2"><X size={14}/> CERRAR COMPARACIÓN</button>
                        </div>
                    ) : (
                        <>
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
                                const published = publishStatusMap[publishLookupKey];
                                const needsRepublish = !!needsRepublishMap[publishLookupKey];
                                return (
                                    <div className="flex items-center gap-2 no-print">
                                        {published ? (
                                            <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                                                <CheckCircle size={12}/> PUBLICADO
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl">
                                                <Ghost size={12}/> BORRADOR
                                            </span>
                                        )}
                                        {(!published || needsRepublish) && (
                                            <button
                                                onClick={handlePublish}
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
                                        {published && isSuperAdmin && (
                                            <button
                                                onClick={() => setCorrectionMode(v => !v)}
                                                title="Modo Corrección: permite editar directamente sin FT/FF"
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors border ${correctionMode ? 'bg-rose-600 text-white border-rose-700 shadow-lg' : 'bg-white text-rose-600 border-rose-300 hover:bg-rose-50'}`}
                                            >
                                                <ShieldAlert size={12}/>
                                                {correctionMode ? 'CORRECCIÓN ACTIVA' : 'CORREGIR'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}
                            {Object.keys(pendingChanges).length > 0 && !isServiceLocked && <div className="flex items-center gap-2 animate-in slide-in-from-top-2 bg-amber-50 p-1.5 rounded-xl border border-amber-200 shadow-lg no-print"><span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest hidden md:inline">Planificando como: {operatorName}</span><div className="h-4 w-px bg-amber-200 mx-1"></div><span className="text-xs font-black text-amber-700 px-1">{Object.keys(pendingChanges).length} cambios</span><button onClick={() => setPendingChanges({})} className="p-1.5 hover:bg-amber-100 rounded-lg text-amber-600"><Undo size={16}/></button><button onClick={handleSaveAll} disabled={isProcessing} className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 shadow">{isProcessing ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}{isProcessing ? 'GUARDANDO…' : 'GUARDAR'}</button></div>}
                            
                            <div className="flex items-center gap-3 no-print">
                                
                                {/* BOTÓN REFERENCIAS */}
                                <button 
                                    onClick={() => setShowLegend(!showLegend)} 
                                    className={`p-2 rounded-xl transition-colors border ${showLegend ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-transparent hover:bg-white text-slate-500'}`} 
                                    title="Ver Referencias de Colores"
                                >
                                    <Info size={18}/>
                                </button>
                                {/* RENDERIZADO CONDICIONAL DE LA LEYENDA (MODAL) */}
                                {showLegend && renderLegend()}

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
                                        <Bell size={18}/>{hasUnread && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white animate-pulse"></span>}
                                    </button>
                                </div>
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
                                                {notifications.length > 0 ? notifications.map((notif, i) => (
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

                                <div className="flex items-center bg-slate-100 rounded-xl p-1"><button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1)); setAutoGeneratedReady(false); }} aria-label="Mes anterior" className="p-1 hover:bg-white rounded-lg"><ChevronLeft size={16} aria-hidden="true"/></button><span className="px-3 font-black text-xs w-24 text-center capitalize">{currentDate.toLocaleDateString('es-AR', {month:'long'})}</span><button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1)); setAutoGeneratedReady(false); }} aria-label="Mes siguiente" className="p-1 hover:bg-white rounded-lg"><ChevronRight size={16} aria-hidden="true"/></button></div>
                                <div className="flex items-center gap-0.5" title="Automatización del cronograma (motor COSP)">
                                    <button
                                        onClick={applyPrevMonthTemplate}
                                        disabled={!selectedObjective || prevMonthLoading}
                                        title="Copiar planificación del mes anterior como plantilla"
                                        className="p-2 bg-slate-100 rounded-l-lg hover:bg-teal-50 hover:text-teal-600 transition-colors disabled:opacity-40 border-r border-slate-200"
                                    >
                                        {prevMonthLoading ? <Loader2 size={18} className="animate-spin text-teal-600"/> : <CalendarSearch size={18}/>}
                                    </button>
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
                                        disabled={!selectedObjective || autoV2Loading}
                                        title="Automatizar: viabilidad + generación según SLA, CCT 200h, cobertura y dotación"
                                        className="p-2 bg-slate-100 rounded-r-lg hover:bg-amber-50 hover:text-amber-600 transition-colors disabled:opacity-40 border-l border-slate-200 flex items-center gap-1.5 px-2.5"
                                    >
                                        {autoV2Loading
                                            ? <Loader2 size={18} className="animate-spin text-amber-600"/>
                                            : <><Wand2 size={16} className="text-amber-600 shrink-0"/><span className="text-[10px] font-black text-amber-700 uppercase tracking-tight hidden sm:inline">Auto</span></>}
                                    </button>
                                </div>
                                <button onClick={loadHistory} className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Ver Historial" disabled={!selectedObjective}><History size={18}/></button>
                                <button
                                    onClick={() => {
                                        if (!selectedClient) return;
                                        openCronoPopout({
                                            clientId: selectedClient,
                                            objectiveId: floatingInitialObjective,
                                            month: currentDate,
                                            mainObjectiveId: selectedObjective,
                                        });
                                    }}
                                    disabled={!selectedClient}
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40"
                                    title="Abrir crono en ventana externa (monitor extra)"
                                >
                                    <Maximize2 size={18}/>
                                </button>
                                <button
                                    onClick={() => setShowAjustarCronoModal(true)}
                                    disabled={!selectedObjective}
                                    title="Ajustar Crono: comprimir a 12h o liberar retenes para un rango de días"
                                    className="p-2 bg-slate-100 rounded-lg hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-40 flex items-center gap-1.5 px-2.5"
                                >
                                    <ArrowLeftRight size={16} className="text-rose-600 shrink-0"/>
                                    <span className="text-[10px] font-black text-rose-700 uppercase tracking-tight hidden sm:inline">Ajustar</span>
                                </button>
                                <div className="flex items-center gap-0.5">
                                    <button onClick={() => startFilterTransition(() => setSortBy(prev => prev === 'activity' ? 'name' : prev === 'name' ? 'client' : prev === 'client' ? 'band' : prev === 'band' ? 'position' : 'activity'))} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-l-xl transition-colors border border-transparent hover:border-indigo-200" title={sortBy === 'activity' ? "Ordenado por Actividad" : sortBy === 'name' ? "Ordenado por Nombre" : sortBy === 'client' ? "Ordenado por Cliente" : sortBy === 'band' ? "Ordenado por Banda" : "Ordenado por Puesto"}>{sortBy === 'activity' ? <ArrowDownWideNarrow size={18}/> : sortBy === 'name' ? <ArrowDownAZ size={18}/> : sortBy === 'band' ? <Clock size={18}/> : sortBy === 'position' ? <LayoutGrid size={18}/> : <Briefcase size={18}/>}</button>
                                    <button onClick={() => startFilterTransition(() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc'))} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-r-xl transition-colors border border-transparent hover:border-indigo-200" title={sortDir === 'asc' ? "Ascendente" : "Descendente"}>{sortDir === 'asc' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
                                </div>
                                <div className="flex items-center gap-0.5" title="Filtrar por banda horaria">
                                    {[null,'M','T','N','D12','N12','RET'].map(b => {
                                        const active = bandFilter === b;
                                        const label = b ?? 'All';
                                        const colors: Record<string, string> = {
                                            M: 'text-blue-700 border-blue-400 bg-blue-50',
                                            T: 'text-orange-600 border-orange-400 bg-orange-50',
                                            N: 'text-indigo-700 border-indigo-500 bg-indigo-50',
                                            D12: 'text-cyan-700 border-cyan-400 bg-cyan-50',
                                            N12: 'text-purple-700 border-purple-500 bg-purple-50',
                                            RET: 'text-amber-700 border-amber-500 bg-amber-50',
                                        };
                                        const cls = b ? colors[b] : 'text-slate-600 border-slate-300 bg-slate-100';
                                        return (
                                            <button key={label} onClick={() => startFilterTransition(() => setBandFilter(b))}
                                                className={`px-1.5 py-1 text-[9px] font-black uppercase border transition-colors first:rounded-l-lg last:rounded-r-lg ${active ? cls + ' shadow-inner' : 'border-transparent bg-slate-100 text-slate-400 hover:' + cls}`}
                                                title={b ? { M: 'Mañana', T: 'Tarde', N: 'Noche', D12: 'Diurno 12h', N12: 'Nocturno 12h', RET: 'Retén' }[b] ?? b : 'Ver todas las bandas'}
                                            >{label}</button>
                                        );
                                    })}
                                </div>
                                {customOrderMap[selectedObjective || '__all__'] && !forceShowAll && (
                                    <button onClick={clearCustomOrder} className="p-2 bg-indigo-100 text-indigo-600 hover:bg-rose-100 hover:text-rose-600 rounded-xl transition-colors text-[9px] font-black uppercase flex items-center gap-1" title="Hay orden personalizado — click para restablecer orden automático"><Grip size={12}/><X size={10}/></button>
                                )}
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
                                <button onClick={() => setShowAddModal(true)} disabled={!selectedObjective || isServiceLocked} className="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50"><UserPlus size={14}/> Asignar</button>
                            </div>
                        </>
                    )}
                </div>

                {/* --- ÁREA PRINCIPAL DE LA GRILLA (PLANIFICACIÓN + COMPARACIÓN SPLIT VIEW) --- */}
                <div className={`flex-1 min-h-0 overflow-hidden relative z-0 custom-scrollbar ${isServiceLocked ? 'opacity-75 grayscale-[0.5] pointer-events-none' : ''}`}>
                    {isProcessing && <div className="absolute inset-0 bg-white/50 z-50 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={40}/></div>}
                    
                    {!selectedObjective ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
                            <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center">
                                <Calendar size={32} className="text-slate-300" aria-hidden="true"/>
                            </div>
                            <p className="font-bold text-base text-slate-400">Seleccioná un cliente y objetivo</p>
                            <p className="text-sm text-slate-300">La grilla de planificación aparecerá aquí</p>
                        </div>
                    ) : (
                        <>
                        {correctionMode && (
                            <div className="mx-2 mb-1 flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-black no-print">
                                <ShieldAlert size={14}/>
                                MODO CORRECCIÓN ACTIVO — Los cambios se guardan directamente sin FT/FF y quedan registrados como corrección de superadmin.
                                <button onClick={() => setCorrectionMode(false)} className="ml-auto underline text-rose-100 hover:text-white">Desactivar</button>
                            </div>
                        )}
                        {comparingSnapshot ? (
                            // 🛑 VISTA DE COMPARACIÓN DUAL (V8.20) - SPLIT SCREEN
                            <div className="flex flex-col h-full gap-4 p-2 bg-slate-100/50">
                                <div className="flex-1 overflow-auto border-2 border-amber-300 bg-amber-50/30 rounded-xl shadow-sm relative">
                                    <div className="sticky top-0 z-50 bg-amber-100/90 backdrop-blur-sm px-4 py-1 text-[10px] font-black text-amber-800 uppercase mb-2 border-b border-amber-200 flex items-center justify-center gap-2">
                                        <History size={12}/> VERSIÓN HISTÓRICA ({new Date(comparingSnapshot.date).toLocaleString()}) — borde ámbar = cambió vs actual
                                    </div>
                                    {renderGrid(true, comparingSnapshot.data, compareDiffKeys, compareGridEmployees)}
                                </div>

                                <div className="shrink-0 mx-2 rounded-xl border border-slate-300 bg-white shadow-sm overflow-hidden z-10">
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-700">
                                            <ArrowLeftRight size={14} className="text-indigo-600"/>
                                            Diferencias histórico → actual
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${planningCompareDiff?.changedCount ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                                {planningCompareDiff?.changedCount ?? 0} celda(s) distinta(s)
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setCompareShowOnlyDiffs((v) => !v)}
                                                className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${compareShowOnlyDiffs ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-600 border-slate-200'}`}
                                            >
                                                Solo filas con cambios
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setCompareShowDiffList((v) => !v)}
                                                className="px-2 py-1 rounded-lg text-[10px] font-bold border bg-white text-slate-600 border-slate-200"
                                            >
                                                {compareShowDiffList ? 'Ocultar detalle' : 'Ver detalle'}
                                            </button>
                                        </div>
                                    </div>
                                    {compareShowDiffList && planningCompareDiff && planningCompareDiff.changedCount > 0 && (
                                        <div className="max-h-28 overflow-y-auto custom-scrollbar px-3 py-2 text-[10px] space-y-1">
                                            {planningCompareDiff.cells.slice(0, 40).map((c) => {
                                                const emp = displayedEmployees.find((e: { id: string }) => e.id === c.empId);
                                                const label = emp?.name || c.empId.slice(0, 8);
                                                const arrow = c.histLabel && c.currentLabel ? `${c.histLabel} → ${c.currentLabel}` : c.currentLabel ? `∅ → ${c.currentLabel}` : `${c.histLabel} → ∅`;
                                                return (
                                                    <div key={c.key} className="flex justify-between gap-2 text-slate-700">
                                                        <span className="truncate font-bold">{label} · {c.date.split('-').reverse().join('/')}</span>
                                                        <span className="shrink-0 font-mono text-indigo-700">{arrow}</span>
                                                    </div>
                                                );
                                            })}
                                            {planningCompareDiff.cells.length > 40 && (
                                                <p className="text-slate-400 italic">… y {planningCompareDiff.cells.length - 40} más en la grilla (borde ámbar/violeta).</p>
                                            )}
                                        </div>
                                    )}
                                    {compareShowDiffList && planningCompareDiff?.changedCount === 0 && (
                                        <p className="px-3 py-2 text-[10px] text-emerald-700 font-bold">Sin diferencias: la versión actual coincide con el snapshot histórico.</p>
                                    )}
                                </div>

                                <div className="flex-1 overflow-auto border-2 border-indigo-500 bg-white rounded-xl shadow-lg relative">
                                    <div className="sticky top-0 z-50 bg-indigo-600 px-4 py-1 text-[10px] font-black text-white uppercase mb-2 flex items-center justify-center gap-2 shadow-sm">
                                        <Activity size={12}/> VERSIÓN ACTUAL (EN VIVO) — borde violeta = cambió vs histórico
                                    </div>
                                    {renderGrid(false, undefined, compareDiffKeys, compareGridEmployees)}
                                </div>
                            </div>
                        ) : (
                            <div className={`h-full min-h-0 overflow-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 transition-opacity duration-150 ${(isFilterPending || isShowAllPending) ? 'opacity-60' : ''}`}>
                                {renderGrid(false)}
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
                                    Portapapeles {clipboardDim ? `${clipboardDim.rows}×${clipboardDim.cols}` : ''}
                                </span>
                                <button
                                    onClick={() => { if (selection.start) { const minR = Math.min(selection.start.r, selection.end?.r ?? selection.start.r); const minC = Math.min(selection.start.c, selection.end?.c ?? selection.start.c); handlePasteAt(minR, minC); } }}
                                    disabled={!selection.start}
                                    title={selection.start ? 'Pegar en la selección actual' : 'Seleccioná una celda destino primero'}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-white font-black text-xs flex items-center gap-1.5 shadow-sm"
                                >
                                    <ArrowRightCircle size={14}/> Pegar aquí
                                </button>
                                <span className="text-[9px] text-slate-400 px-1">Ctrl+V</span>
                                <div className="h-6 w-px bg-slate-600 mx-1"></div>
                                <button onClick={() => { setClipboard(null); setClipboardDim(null); setSelection({start:null,end:null}); }} className="p-2 hover:bg-slate-700 rounded-lg"><X size={16}/></button>
                            </>
                        ) : (
                            <>
                                <span className="text-[10px] font-bold px-2 text-slate-300 uppercase tracking-wider">Asignar:</span>
                                {bulkShifts.map((s: any) => ( <button key={s.code} onClick={() => applyBulkChange({ code: s.code, name: s.name, hours: s.hours, startTime: s.startTime })} disabled={isServiceLocked} className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle(s.code)}`}>{s.code}</button>))}
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
                {selectedObjective && Object.keys(empMonthlyHours).length > 0 && (() => {
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
                        {slaVendidas > 0 && (
                            <div className={`text-center pl-3 ${slaMismatch ? 'rounded-lg bg-rose-50 px-2 py-0.5' : ''}`}>
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Vendidas</p>
                                <p className="text-sm font-black text-teal-600 leading-tight">{slaVendidas}</p>
                            </div>
                        )}
                    </div>
                    );
                })()}

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

                {showActivityModal && (
                    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print" onClick={() => setShowActivityModal(false)}>
                        <div className="bg-white w-full max-w-3xl h-[80vh] rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                                <h3 className="font-black text-lg flex items-center gap-2"><Clock className="text-indigo-600" size={18}/> Actividad Reciente</h3>
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
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="text-xs font-mono text-slate-400">{new Date(log.timestamp).toLocaleString()}</span>
                                                            <span className="text-[10px] font-black uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded border">{log.label}</span>
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
                                const isPastClosed = isDateLocked(selectedCell.dateStr);
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
                                    return null;
                                };
                                const originalWorkShift = (absence || isRRHHCode) ? resolveOriginalWorkShift() : null;
                                const absenceTypeLabel = absence?.type || shift?.name || LEGEND_DESCRIPTIONS[code] || code || '—';
                                const absenceStatusLabel = absence?.status || (isRRHHCode ? 'Registrada' : '');
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
                                const previewIsPublished = !!publishStatusMap[previewPublishKey];
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
                                                        <LockKeyhole size={12}/> Cronograma publicado — solo superadmin puede corregir
                                                    </div>
                                                )}
                                            </div>

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
                                                                : disabledByCoverage ? 'Puesto cerrado (esquema SLA completo). Solo se puede asignar Franco.' : isBlocked ? 'No se puede mezclar con turnos ya asignados en este puesto/día (solo 8h con 8h, 12h con 12h)' : undefined;
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
                                        <div className={`flex gap-2 mb-4 ${isServiceLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <button onClick={() => setModifiers(p => ({...p, extend: !p.extend}))} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${modifiers.extend ? 'bg-violet-100 border-violet-300 text-violet-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>Extensión (+)</button>
                                            <button onClick={() => setModifiers(p => ({...p, early: !p.early}))} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${modifiers.early ? 'bg-cyan-100 border-cyan-300 text-cyan-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>Adelanto (+)</button>
                                            <button onClick={() => setShowRRHHModal(true)} className="flex-1 py-2 bg-slate-100 border-slate-200 text-slate-600 rounded-lg text-xs font-bold border hover:bg-slate-200">Ausencia/RRHH</button>
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
                                                applyToPending({ ...cap.shiftConfig, positionName: cap.positionName, isFrancoTrabajado: francoMode === 'FT_SELECTION', isExtended: modifiers.extend, isEarlyStart: modifiers.early, plannedNovedad: modifiers.plannedNovedad });
                                                setAuthWarningMessage('');
                                            },
                                            employees: [empName],
                                            operatorName: activeActorName || operatorName
                                        });
                                    }} className="flex-1 py-3 bg-amber-500 text-white font-black text-xs rounded-xl hover:bg-amber-600 shadow-md">Autorizar con PIN</button></div></div></div></div>, document.body)}
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
                                                if (isDateLocked(dateStr)) return null;
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
                    const hint = isVac ? 'Elegí qué días procesar y quién cubre cada uno. Solo se listan RET, ESC o guardias sin turno ese día (más cerca primero).' : isEnf ? 'Solo RET, ESC o sin turno ese día — no se muestra personal ya asignado a otro objetivo.' : isPG ? 'Asigná cobertura por día desde RET, ESC o libres.' : isLic ? 'Suplentes desde RET, ESC o sin turno; ordenados por cercanía al objetivo.' : 'Podés asignar cobertura por día o dejar vacante.';
                    const candidateDate = vacancyEditingDay || [...vacancyActiveDates].sort()[0] || vacancyData?.startDate;
                    const formatShortDay = (ymd: string) => {
                        const [, m, d] = ymd.split('-');
                        return `${d}/${m}`;
                    };
                    const toggleVacancyDate = (d: string) => {
                        setVacancyActiveDates((prev) => {
                            const next = new Set(prev);
                            if (next.has(d)) next.delete(d); else next.add(d);
                            return next;
                        });
                    };
                    const resolveDayReplacementId = (dateStr: string) => vacancyDayReplacements[dateStr] ?? selectedReplacement ?? '';
                    const resolveDayReplacementName = (dateStr: string) => {
                        const id = resolveDayReplacementId(dateStr);
                        return id ? (employees.find((e: any) => e.id === id)?.name || '—') : 'Sin cobertura';
                    };
                    const willAssignAny = [...vacancyActiveDates].some((d) => !!resolveDayReplacementId(d));
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
                    const selectedReplacementEmp = candidatos.find(e => e.id === (vacancyEditingDay ? resolveDayReplacementId(vacancyEditingDay) : selectedReplacement));
                    const renderVacancyCandidate = (e: typeof candidatos[0], suffix: string) => (
                        <button
                            key={e.id}
                            type="button"
                            onClick={() => {
                                if (vacancyEditingDay) {
                                    setVacancyDayReplacements((prev) => ({ ...prev, [vacancyEditingDay]: e.id }));
                                    setVacancyEditingDay(null);
                                } else {
                                    setSelectedReplacement(e.id);
                                }
                                setVacancyReplacementOpen(false);
                            }}
                            className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-indigo-50 rounded-lg ${(vacancyEditingDay ? resolveDayReplacementId(vacancyEditingDay) : selectedReplacement) === e.id ? 'bg-indigo-50 ring-1 ring-indigo-300' : ''}`}
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
                        <div className={`bg-white p-6 rounded-xl shadow-2xl w-full max-w-[560px] max-h-[min(92vh,780px)] flex flex-col border-l-4 ${colorMap[color].split(' ')[0]}`}>
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
                            {absenceDateRange.length > 1 && (
                                <div className="mb-3 shrink-0">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-[10px] font-black uppercase text-slate-400">Días a procesar</label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setVacancyActiveDates(new Set(absenceDateRange))} className="text-[10px] font-bold text-indigo-600 hover:underline">Todos</button>
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
                                <div className="mb-4 shrink-0 max-h-32 overflow-y-auto custom-scrollbar border rounded-xl divide-y">
                                    {[...vacancyActiveDates].sort().map((d) => (
                                        <div key={d} className="flex items-center gap-2 px-3 py-2 text-xs">
                                            <span className="font-mono font-bold text-slate-600 w-14 shrink-0">{formatShortDay(d)}</span>
                                            <button
                                                type="button"
                                                onClick={() => { setVacancyEditingDay(d); setVacancyReplacementOpen(true); }}
                                                className="flex-1 text-left truncate font-bold text-slate-700 hover:text-indigo-600"
                                            >
                                                {resolveDayReplacementName(d)}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="bg-slate-50 p-4 rounded-xl border mb-5 min-h-0 flex-1 flex flex-col">
                                <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block shrink-0">
                                    {vacancyEditingDay
                                        ? `Suplente para ${formatShortDay(vacancyEditingDay)}`
                                        : (isInj ? 'Suplente por defecto (opcional)' : 'Suplente por defecto para días seleccionados')}
                                </label>
                                {!vacancyReplacementOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setVacancyReplacementOpen(true)}
                                        className="w-full p-3 rounded-lg border text-sm font-bold bg-white text-left flex items-center justify-between gap-2 shrink-0"
                                    >
                                        <span className={`truncate ${selectedReplacement ? 'text-slate-800' : 'text-slate-400'}`}>
                                            {selectedReplacementEmp ? `${selectedReplacementEmp.expBadge} ${selectedReplacementEmp.name}` : 'Sin cobertura — dejar vacante'}
                                        </span>
                                        <ChevronDown size={16} className="text-slate-400 shrink-0" />
                                    </button>
                                ) : (
                                    <div ref={vacancyReplacementPanelRef} className="bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
                                        <div className="p-2 border-b shrink-0 bg-white sticky top-0 z-10">
                                            <div className="relative">
                                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                <input
                                                    autoFocus
                                                    className="w-full pl-9 pr-3 py-2.5 text-sm font-bold bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
                                                    placeholder="Buscar por nombre o legajo..."
                                                    value={vacancyReplacementSearch}
                                                    onChange={e => setVacancyReplacementSearch(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="overflow-y-auto custom-scrollbar p-1 min-h-0 flex-1 max-h-[min(42vh,280px)]">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (vacancyEditingDay) {
                                                        setVacancyDayReplacements((prev) => {
                                                            const next = { ...prev };
                                                            delete next[vacancyEditingDay];
                                                            return next;
                                                        });
                                                        setVacancyEditingDay(null);
                                                    } else {
                                                        setSelectedReplacement('');
                                                    }
                                                    setVacancyReplacementOpen(false);
                                                }}
                                                className={`w-full px-3 py-2.5 text-left text-sm font-bold hover:bg-slate-50 rounded-lg ${!(vacancyEditingDay ? resolveDayReplacementId(vacancyEditingDay) : selectedReplacement) ? 'bg-slate-50 ring-1 ring-slate-300 text-slate-500' : 'text-slate-400'}`}
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
                                                <p className="px-3 py-4 text-xs text-slate-400 text-center">
                                                    {q ? `Sin resultados para "${vacancyReplacementSearch}"` : 'No hay RET, ESC ni guardias libres ese día cerca del objetivo.'}
                                                </p>
                                            )}
                                        </div>
                                        <div className="p-2 border-t shrink-0 bg-slate-50">
                                            <button
                                                type="button"
                                                onClick={() => { setVacancyReplacementOpen(false); setVacancyReplacementSearch(''); }}
                                                className="w-full py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                                            >
                                                Cerrar lista
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-3 shrink-0">
                                <button onClick={() => { setShowVacancyModal(false); setVacancyData(null); setVacancyReplacementSearch(''); setVacancyReplacementOpen(false); setVacancyActiveDates(new Set()); setVacancyDayReplacements({}); setVacancyEditingDay(null); }} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-50 rounded-xl border">Cancelar</button>
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
                                <div className="mt-3 flex flex-wrap gap-1 justify-center">
                                    {authModal.employees.map(name => (
                                        <span key={name} className="text-xs bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-bold">{name}</span>
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
                                        // Loguear la autorización solo cuando viene del flujo GUARDAR
                                        if (authModal.isSaveFlow) {
                                            await addDoc(collection(db, 'audit_logs'), {
                                                timestamp: serverTimestamp(),
                                                action: 'OVERRIDE_200H',
                                                module: 'PLANIFICADOR',
                                                actorName: result.name,
                                                details: `${authModal.operatorName || 'Operador'} asignó turno a ${authModal.employees.join(', ')} superando 200hs — autorizó: ${result.name}`,
                                            });
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
                                            Tope CCT 422/05: <b>200h por ciclo</b>. La tabla refleja la <b>última automatización</b> de este objetivo: si corregiste datos o filtros, volvé a <b>generar</b> para actualizarla.
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
                                                const isCapped = curr >= 200 || next >= 200;
                                                const isHigh = curr >= 192 || next >= 192;
                                                const status = isIdle ? 'Capacidad ociosa' :
                                                    isCapped ? 'CAP 200h alcanzado' :
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
                                                const aCap = a.curr >= 200 || a.next >= 200 ? 0 : 1;
                                                const bCap = b.curr >= 200 || b.next >= 200 ? 0 : 1;
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
                                        positionName: positionStructure[0]?.positionName ?? 'General',
                                        code: gap.band,
                                        name: meta.name,
                                        hours: meta.hours,
                                        startTime: meta.startTime,
                                        endTime: meta.endTime,
                                        isFranco: false,
                                    };
                                    gapKeys.push(`${gap.absentEmpId}_${gap.dateStr}`);
                                }
                                const n = planCoverageModalGaps.length;
                                setPendingChanges(prev => ({ ...prev, ...updates }));
                                setAutoCoverageGaps(prev => prev.map(g =>
                                    gapKeys.includes(`${g.absentEmpId}_${g.dateStr}`)
                                        ? { ...g, coverageType: 'manual' as const, coveredBy: empId, coveredByName: nombre }
                                        : g
                                ));
                                setCoverageSelectedDays(prev => { const next = new Set(prev); gapKeys.forEach(k => next.delete(k)); return next; });
                                // Actualizar métricas de cobertura y SLA para reflejar la asignación
                                applyCoverageToStats(n);
                                toast.success(`${nombre.split(',')[0]} asignado a ${n} día(s)`);
                                setPlanCoverageModalGaps([]);
                            }}
                            onAssignD12={() => {
                                const gapKeys = planCoverageModalGaps.map(g => `${g.absentEmpId}_${g.dateStr}`);
                                const n = planCoverageModalGaps.length;
                                setAutoCoverageGaps(prev => prev.map(g =>
                                    gapKeys.includes(`${g.absentEmpId}_${g.dateStr}`)
                                        ? { ...g, coverageType: 'manual' as const, coveredBy: 'D12', coveredByName: 'D12 (extensión)' }
                                        : g
                                ));
                                setCoverageSelectedDays(prev => { const next = new Set(prev); gapKeys.forEach(k => next.delete(k)); return next; });
                                applyCoverageToStats(n);
                                toast.success(`D12 confirmado para ${n} día(s)`);
                                setPlanCoverageModalGaps([]);
                            }}
                            onClose={() => setPlanCoverageModalGaps([])}
                        />
                    );
                })()}

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
                                        type === 'ret' ? 'RET' : type === 'esc' ? 'ESC' : type === 'sin_turno' ? 'ST' : 'FT';

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
                                                {n}×{code}
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

            {showAjustarCronoModal && (
                <AjustarCronoOperativoModal
                    open={showAjustarCronoModal}
                    onClose={() => setShowAjustarCronoModal(false)}
                    empresaId={empresaId}
                    objetivoInicial={selectedObjective ? { id: selectedObjective, nombre: selectedObjectiveData?.name ?? selectedObjective } : undefined}
                    gridSnapshot={{ shiftsMap, pendingChanges }}
                />
            )}

            </div>

        </DashboardLayout>
    );
}
