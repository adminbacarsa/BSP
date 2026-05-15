import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui';
import { useSetPageHeader } from '@/context/PageHeaderContext';
import { 
    ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, Plus,
    Users, Clock, X, UserPlus, ArrowRight, Eye, EyeOff, 
    CheckCircle, Trash2, ShieldAlert, User, Briefcase, Layers,
    Bell, CalendarX, Loader2, Stethoscope, MapPin, Lock, ShieldCheck, UserMinus,
    Save, Undo, History, MousePointer2, AlertTriangle, Grip, LayoutGrid, MonitorPlay,
    Printer, Download, Grid, RefreshCw, Edit3, Shield, ArrowRightCircle, Info, ArrowDownWideNarrow, ArrowDownAZ,
    BadgePercent, ArrowLeftRight, CalendarSearch, CheckSquare, XCircle, Search as SearchIcon, RefreshCcw, UserCheck, Split, Ban,
    FastForward, Rewind, AlertOctagon, Siren, FileText, Fingerprint, CalendarCheck, HelpCircle, MousePointerClick, Check, Database, Activity,
    PowerOff, LockKeyhole, Ghost, Maximize2, Copy, ClipboardPaste, Wand2
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, orderBy, limit, serverTimestamp, Timestamp, where, getDocs, getDoc, updateDoc, writeBatch, setDoc } from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { Toaster, toast } from 'sonner';
import { checkRestBetweenShifts, getAgreementRestConfig } from '@/lib/planificacion/restBetweenShifts';
import { runAutoScheduleV2, generateScheduleV2 } from '@/lib/planificacion/autoScheduleEngineV2';
import { inferAbsenceCode, isActiveAbsence } from '@/lib/planificacion/absenceCodes';
import { verifyScheduleCoverage } from '@/lib/planificacion/coverageVerification';
import { fixScheduleIssues } from '@/lib/planificacion/coverageFixer';
import { buildScheduleOptimizationSuggestions } from '@/lib/planificacion/scheduleOptimizationSuggestions';

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
    'V':   'bg-teal-600 text-white border-teal-700 font-black shadow-sm',
    'L':   'bg-white text-purple-700 border-purple-400 font-black',
    'E':   'bg-white text-rose-700 border-rose-400 font-black',
    'AA':  'bg-white text-amber-700 border-amber-400',
    'RET': 'bg-white text-amber-800 border-amber-500 font-black',
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

const DEFAULT_LIMITS = { weekly: 48, monthly: 200 };

const SHIFT_HOURS_LOOKUP: Record<string, number> = {
    'M': 8, 'T': 8, 'N': 8, 'D12': 12, 'N12': 12, 'PU': 12, 'EN': 9, 'F': 0, 'FF': 0, 'FP': 0, 'FT': 0, 'V': 0, 'L': 0, 'A': 0, 'E': 0, 'AA': 0, 'PG': 0, 'RET': 0, 'C': 8,
};

/** No computan como "hs planificadas de cobertura" en el objetivo (retén, francos, licencias). */
const OBJECTIVE_NON_BILLABLE_CODES = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'A', 'E', 'AA', 'PG', 'RET']);

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
 * Evita “200h en abril” por turnos de OTRO objetivo o cobertura de ops mezclados en
 * `turnos` con la misma fecha+empleado.
 */
function turnoCuentaParaCronoPlanificado(data: any, objectiveId: string | undefined | null): boolean {
    if (!data || !objectiveId) return false;
    if (String(data.objectiveId || '') !== String(objectiveId)) return false;
    if (isOperationalOriginShift(data)) return false;
    return true;
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

// Determina si un puesto está activo en un día dado.
// Usa activeDays explícito (<7) si existe; si no, infiere desde los days[] de los turnos.
const FRANCO_CODES = new Set(['F','FF','FP','FT','V','L','A','E','AA','PG','RET']);
const isPosActiveOnDay = (pos: any, dayLetter: string): boolean => {
    if (Array.isArray(pos?.activeDays) && pos.activeDays.length < 7) {
        return pos.activeDays.includes(dayLetter);
    }
    const workingShifts = (pos?.shifts || []).filter((s: any) => !FRANCO_CODES.has(String(s.code || '').toUpperCase()));
    const shiftsWithDays = workingShifts.filter((s: any) => Array.isArray(s.days) && s.days.length > 0);
    if (shiftsWithDays.length === 0 || shiftsWithDays.length < workingShifts.length) return true;
    return shiftsWithDays.some((s: any) => s.days.includes(dayLetter));
};

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

    // ============================================================================
    // 1. ESTADOS (NIVEL 0)
    // ============================================================================
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedClient, setSelectedClient] = useState('');
    const [selectedObjective, setSelectedObjective] = useState('');
    const [forceShowAll, setForceShowAll] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [sortBy, setSortBy] = useState<'name' | 'activity' | 'client'>('activity');
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
    const [coverageTooltip, setCoverageTooltip] = useState<{ dateStr: string; gaps: { positionName: string; code: string; missing: number }[]; x: number; y: number } | null>(null);
    const [columnSelectMode, setColumnSelectMode] = useState(false);
    const [columnSelectSource, setColumnSelectSource] = useState<number | null>(null);
    const [openDrop, setOpenDrop] = useState<'client' | 'objective' | null>(null);
    const longPressTimer = useRef<any>(null);
    const [empDefaultPos, setEmpDefaultPos] = useState<Record<string, string>>(() => {
        if (typeof window === 'undefined') return {};
        try { return JSON.parse(localStorage.getItem('planif_emp_pos') || '{}'); } catch { return {}; }
    });
    const [empPosPicker, setEmpPosPicker] = useState<{ empId: string; x: number; y: number } | null>(null);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);
    
    const [operatorName, setOperatorName] = useState('Cargando...');
    const [operatorEmail, setOperatorEmail] = useState('');
    const [usersMap, setUsersMap] = useState<Record<string, string>>({}); 

    const [positionStructure, setPositionStructure] = useState<any[]>([]);
    const [slaVendidas, setSlaVendidas] = useState<number>(0);
    const [showDiagnostic, setShowDiagnostic] = useState<boolean>(false);
    const [publishStatusMap, setPublishStatusMap] = useState<Record<string, { publishedAt: any; publishedBy: string } | null>>({});
    const [isPublishing, setIsPublishing] = useState(false);
    const [correctionMode, setCorrectionMode] = useState(false);
    const [cellEditMode, setCellEditMode] = useState(false);
    // 🛑 SYNC-CORE: Estado activo inicial null para forzar limpieza
    const [activePosition, setActivePosition] = useState<string | null>(null);
    const [hasActiveSLA, setHasActiveSLA] = useState<boolean>(true);

    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
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
    const [autoCycles, setAutoCycles] = useState<string[]>(['6+2']);
    const [autoOverwrite, setAutoOverwrite] = useState(false);
    /** Rotar turnos entre ciclos (M→T→N→M…). Si el puesto solo tiene 1 turno, no afecta. */
    const [autoRotateShifts, setAutoRotateShifts] = useState(true);

    // ── Automatización COSP (viabilidad + motor determinístico) ──
    const [showAutoV2Modal, setShowAutoV2Modal] = useState(false);
    const [autoV2Loading, setAutoV2Loading] = useState(false);
    const [autoV2Generating, setAutoV2Generating] = useState(false);
    /** Barra de progreso en el modal de automatización (viabilidad / generar). */
    const [autoV2Progress, setAutoV2Progress] = useState<{ pct: number; label: string } | null>(null);
    const [autoV2Report, setAutoV2Report] = useState<import('@/lib/planificacion/autoScheduleEngineV2').V2FeasibilityReport | null>(null);
    const [autoV2BudgetMode, setAutoV2BudgetMode] = useState<'cct'|'calendar'>('cct');
    const [autoV2ShowEmpDetail, setAutoV2ShowEmpDetail] = useState(false);
    // Stats post-generación (capacidad CCT por empleado)
    const [autoV2GenStats, setAutoV2GenStats] = useState<{
        employeeMonthlyHours: Record<string, number>;
        employeeCycleHours: { current: Record<string, number>; next: Record<string, number> };
        targetHours: number;
        totalBillableHours: number;
        uncoveredSlots: number;
        idleEmployeeIds?: string[];
        primaryShiftByEmp?: Record<string, string | null>;
        positionGroups?: Record<string, string[]>;
        employeeRetCount?: Record<string, number>;
        employeeRetHoursPotential?: Record<string, number>;
        totalRetCount?: number;
        totalRetHoursPotential?: number;
        uncoveredSlotsByDay?: Record<string, { positionName: string; code: string; missing: number }[]>;
        excessPositionEmployees?: { positionName: string; assigned: number; needed: number; excess: number }[];
    } | null>(null);
    const [showCapacityModal, setShowCapacityModal] = useState(false);
    // Reporte de verificación de cobertura post-generación (V2)
    const [autoV2Coverage, setAutoV2Coverage] = useState<import('@/lib/planificacion/coverageVerification').CoverageVerificationReport | null>(null);
    const [autoV2Suggestions, setAutoV2Suggestions] = useState<import('@/lib/planificacion/scheduleOptimizationSuggestions').ScheduleChangeSuggestion[] | null>(null);
    const [showCoverageModal, setShowCoverageModal] = useState(false);
    // Snapshot de la última generación para reprocesar errores sin volver a llamar al motor
    const [autoV2LastRun, setAutoV2LastRun] = useState<{
        assignments: import('@/lib/planificacion/autoScheduleEngineV2').V2Assignment[];
        stats: import('@/lib/planificacion/autoScheduleEngineV2').V2GenerateStats;
        ctx: import('@/lib/planificacion/autoScheduleEngineV2').V2EngineContext;
    } | null>(null);
    const [autoV2Fixing, setAutoV2Fixing] = useState(false);
    const [slaDebug, setSlaDebug] = useState<{ id: string; data: any } | null>(null);
    const [slaDebugLoading, setSlaDebugLoading] = useState(false);
    const [hoursMode, setHoursMode] = useState<'mes' | 'cct'>('mes');

    const [showVacancyModal, setShowVacancyModal] = useState(false);
    const [vacancyData, setVacancyData] = useState<any>(null);
    const [selectedReplacement, setSelectedReplacement] = useState('');
    
    const [modifiers, setModifiers] = useState({ extend: false, early: false, plannedNovedad: '' });

    const [showLegend, setShowLegend] = useState(false);
    const [selectedRef, setSelectedRef] = useState<string | null>(null);

    const setPageHeader = useSetPageHeader();
    useEffect(() => {
        setPageHeader({ compactSidebar: !!selectedClient });
        return () => setPageHeader({ compactSidebar: false });
    }, [selectedClient]);

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

    // 🛑 ESTE HELPER DEBE IR ANTES DE displayedEmployees
    const getEmployeeShiftCount = (empId: string) => { 
        let count = 0; 
        daysInMonth.forEach(day => { 
            const key = `${empId}_${getDateKey(day)}`; 
            const pending = pendingChanges[key]; 
            const existing = shiftsMap[key]; 
            if (pending) { 
                if (!pending.isDeleted) count++; 
            } else if (existing) { 
                if (existing.objectiveId === selectedObjective) count++; 
            } 
        }); 
        return count; 
    };

    const getObjectiveName = (objId: string) => { if (!objId) return 'Desconocido'; for (const client of clients) { if (client.objetivos) { const found = client.objetivos.find((o: any) => (o.id || o.name) === objId); if (found) return found.name; } } return objId; };

    const selectedObjectiveData = useMemo(() => {
        if (!selectedObjective || !selectedClient) return null;
        const client = clients.find((c: any) => c.id === selectedClient);
        if (!client) return null;
        return client.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective) || null;
    }, [clients, selectedClient, selectedObjective]);

    const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // ============================================================================
    // 3. LISTA MAESTRA DE EMPLEADOS (NIVEL 2)
    // ============================================================================
    const displayedEmployees = useMemo(() => {
        if (!selectedObjective && !forceShowAll) return [];
        // Excluir empleados inactivos (dados de baja)
        let list = employees.filter(e => e.status !== 'inactivo');
        if (selectedObjective && !forceShowAll) {
            // Solo shifts guardados en Firestore determinan si un invitado/desvinculado sigue visible.
            // Los pendingChanges no cuentan: si desvinculás a alguien sin guardar, desaparece.
            const activeGuestIds = new Set();
            Object.values(shiftsMap).forEach((shift: any) => { if (shift.objectiveId === selectedObjective) activeGuestIds.add(shift.employeeId); });
            list = list.filter(e =>
                e.preferredObjectiveId === selectedObjective ||
                slaIdToObjId[e.preferredObjectiveId] === selectedObjective ||
                activeGuestIds.has(e.id)
            );
        }
        if (searchTerm) list = list.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())); 
        // If there's a custom order for this objective, apply it
        const orderKey = selectedObjective || '__all__';
        const customOrder = customOrderMap[orderKey];
        if (customOrder && customOrder.length > 0) {
            const orderMap: Record<string, number> = {};
            customOrder.forEach((id: string, i: number) => { orderMap[id] = i; });
            return list.sort((a: any, b: any) => {
                const ai = orderMap[a.id] !== undefined ? orderMap[a.id] : 9999;
                const bi = orderMap[b.id] !== undefined ? orderMap[b.id] : 9999;
                return ai - bi;
            });
        }
        const dir = sortDir === 'asc' ? 1 : -1;
        return list.sort((a, b) => {
            if (sortBy === 'activity') {
                const countA = getEmployeeShiftCount(a.id);
                const countB = getEmployeeShiftCount(b.id);
                if (countA !== countB) return (countB - countA) * dir;
            }
            if (sortBy === 'client') {
                const clientA = getObjectiveName(a.preferredObjectiveId);
                const clientB = getObjectiveName(b.preferredObjectiveId);
                const cmp = clientA.localeCompare(clientB);
                if (cmp !== 0) return cmp * dir;
            }
            return a.name.localeCompare(b.name) * dir;
        });
    }, [employees, selectedObjective, forceShowAll, searchTerm, shiftsMap, pendingChanges, sortBy, sortDir, daysInMonth, slaIdToObjId, customOrderMap]);

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
                if (OBJECTIVE_NON_BILLABLE_CODES.has(String(activeShift.code || '').toUpperCase())) return;
                total += calcShiftHours(activeShift, slaCodeHoursHint);
            });
            result[emp.id] = total;
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective, slaCodeHoursHint]);

    // Horas en el ciclo CCT actual (corre del 26 del mes anterior al 25 del mes activo).
    // Suma:
    //   - Cola del mes anterior (días 26..fin) → tomada de shiftsMap (no editable acá).
    //   - Días 1..25 del mes activo → toma pendingChanges si existe, si no shiftsMap.
    // Filtra todos los códigos no facturables (RET, F, FF, FP, FT, V, L, etc.).
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
            if (OBJECTIVE_NON_BILLABLE_CODES.has(String(activeShift.code || '').toUpperCase())) return;
            result[empId] = (result[empId] || 0) + calcShiftHours(activeShift, slaCodeHoursHint);
        };
        displayedEmployees.forEach((emp: any) => {
            result[emp.id] = 0;
            tailDays.forEach((d) => acumular(emp.id, `${emp.id}_${getDateKey(d)}`, true));
            headDays.forEach((d) => acumular(emp.id, `${emp.id}_${getDateKey(d)}`, false));
        });
        return result;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, currentDate, selectedObjective, slaCodeHoursHint]);

    const retCount = useMemo(() => {
        let count = 0;
        displayedEmployees.forEach((emp: any) => {
            daysInMonth.forEach(day => {
                const key = `${emp.id}_${getDateKey(day)}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                if (activeShift && String(activeShift.code || '').toUpperCase() === 'RET') count++;
            });
        });
        return count;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap]);

    // Colchón disponible (horas): si hoy se ausenta alguien, ¿cuánto se podría cubrir
    // promoviendo RETs a turno facturable sin pasar 200h por empleado?
    // Estimación: 8h por RET (turno típico), limitada por la capacidad restante de
    // cada empleado hasta 200h. Pesimista pero segura.
    const retBufferHours = useMemo(() => {
        let total = 0;
        displayedEmployees.forEach((emp: any) => {
            let empRetCount = 0;
            daysInMonth.forEach(day => {
                const key = `${emp.id}_${getDateKey(day)}`;
                const pending = pendingChanges[key];
                const existing = shiftsMap[key];
                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                if (activeShift && String(activeShift.code || '').toUpperCase() === 'RET') empRetCount++;
            });
            if (empRetCount === 0) return;
            const monthH = empMonthlyHours[emp.id] || 0;
            const spareToCap = Math.max(0, 200 - monthH);
            total += Math.min(empRetCount * 8, spareToCap);
        });
        return total;
    }, [displayedEmployees, daysInMonth, pendingChanges, shiftsMap, empMonthlyHours]);

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
        if (!hasActiveSLA) return { status: 'DELETED', msg: '⛔ SIN SERVICIO ACTIVO PARA ESTE MES — No se puede planificar', icon: <Database size={20}/> };
        
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
    }, [selectedClient, selectedObjective, clients, currentDate, hasActiveSLA]);

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

        // Verificación de Días Activos
        const dayLetter = getDayLetter(dateStr);
        const isDayActive = isPosActiveOnDay(posConfig, dayLetter);
        
        // Meta Final
        const target = isDayActive ? (pax * dailyHoursTarget) : 0;

        let current = 0;
        const dominant = structure.reduce((prev: any, current: any) => (prev.qty > current.qty) ? prev : current, structure[0] || { qty: 1, positionName: 'General' });

        employeesList.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
            if (shift && (shift.objectiveId === selectedObjective || changes[key])) {
                let shiftPos = shift.positionName || dominant?.positionName || 'General';
                if (shiftPos === positionName && !OBJECTIVE_NON_BILLABLE_CODES.has(String(shift.code || '').toUpperCase())) {
                    current += calcShiftHours(shift);
                }
            }
        });
        return { current, target, pax, isActiveDay: isDayActive };
    };

    // 🛑 MEMOIZACIÓN CRÍTICA PARA EL MODAL
    const modalCoverageStats = useMemo(() => {
        if (!selectedCell || !selectedObjective) return null;
        const currentPosName = activePosition || selectedCell.currentShift?.positionName || (positionStructure.length > 0 ? positionStructure[0].positionName : 'General');
        return calculateCoverageStats(selectedCell.dateStr, currentPosName, positionStructure, displayedEmployees, pendingChanges, shiftsMap);
    }, [selectedCell, activePosition, displayedEmployees, pendingChanges, shiftsMap, positionStructure, selectedObjective]);

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

    const handleContextChange = (newClient: string, newObjective: string) => { if (Object.keys(pendingChanges).length > 0) { if (!confirm(`⚠️ TIENES CAMBIOS SIN GUARDAR.\n¿Descartar y cambiar de objetivo?`)) return; setPendingChanges({}); setPendingNovedades({}); } setSelectedClient(newClient); setSelectedObjective(newObjective); setSearchTerm(''); setSelection({start: null, end: null}); setComparingSnapshot(null); setOpenDrop(null); setAutoGeneratedReady(false); };
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
                <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl relative border border-slate-100 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
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
                            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 animate-in slide-in-from-bottom-2 fade-in duration-300">
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

    // 🛑 V8.60 - SELECCIÓN DE SERVICIO POR FECHA: usa la versión de servicios_sla vigente para el mes visualizado
    useEffect(() => {
        if (!selectedClient || !selectedObjective) { setPositionStructure([]); setHasActiveSLA(true); setSlaVendidas(0); return; }
        const fetchSLA = async () => {
            try {
                const q = query(collection(db, 'servicios_sla'), where('clientId', '==', selectedClient));
                const snap = await getDocs(q);
                const allDocs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

                // Filtrar por objetivo (por id o por nombre)
                let matching = allDocs.filter(d => d.objectiveId === selectedObjective);
                if (matching.length === 0) {
                    const objName = getObjectiveName(selectedObjective);
                    matching = allDocs.filter(d => d.objectiveId === objName || d.objectiveName === objName);
                }

                // Seleccionar la versión vigente para el mes visualizado
                const viewYear = currentDate.getFullYear();
                const viewMonth = currentDate.getMonth();
                const viewMonthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
                // Último día del mes visualizado (para comparar con endDate)
                const viewMonthEndStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(new Date(viewYear, viewMonth + 1, 0).getDate()).padStart(2, '0')}`;
                let srv = matching.find(d => d.startDate && d.endDate && d.startDate <= viewMonthEndStr && d.endDate >= viewMonthStr);
                // Si no hay servicio que cubra el mes actual → bloquear edición (sin fallback)
                const hasExactMatch = !!srv;
                if (!srv && matching.length > 0) {
                    // Cargamos la estructura más reciente solo para mostrar los tipos de turno, pero SIN habilitar edición
                    srv = [...matching].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];
                }

                const structure: any[] = [];
                if (srv?.positions) {
                    const positionsIterable = Array.isArray(srv.positions) ? srv.positions : Object.values(srv.positions);
                    positionsIterable.forEach((pos: any) => {
                        if (pos && (pos.allowedShiftTypes?.length > 0 || pos.shifts?.length > 0)) {
                            const rawQty = pos.quantity || pos.qty || pos.pax || pos.cant || pos.cantidad || pos.cant_guardias || pos.dotacion || pos.guardias || pos.plazas || pos.cupo || pos.staff || pos.personal || pos.recursos || 1;
                            const cleanQty = typeof rawQty === 'string' ? rawQty.trim() : rawQty;
                            const parsedQty = parseInt(String(cleanQty), 10);
                            structure.push({
                                positionName: pos.name || pos.positionName || 'General',
                                shifts: pos.allowedShiftTypes || pos.shifts,
                                qty: !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 1,
                                activeDays: pos.activeDays || ['L','M','X','J','V','S','D'],
                                coverageType: pos.coverageType || srv.coverageType || '24hs',
                                _serviceId: srv.id,
                                _serviceRange: `${srv.startDate || '?'} → ${srv.endDate || '?'}`,
                            });
                        }
                    });
                }
                if (structure.length === 0) {
                    console.warn("CRONO: No se encontró estructura válida. Activando Fallback.");
                    structure.push({ positionName: 'General', shifts: [{code:'M',hours:8},{code:'T',hours:8},{code:'N',hours:8}], qty: 1, activeDays: ['L','M','X','J','V','S','D'], coverageType: '24hs' });
                    setHasActiveSLA(false);
                } else {
                    // Solo habilita edición si hay un servicio que cubre efectivamente el mes visualizado
                    setHasActiveSLA(hasExactMatch);
                }
                setPositionStructure(structure);
                setSlaVendidas(hasExactMatch ? (srv?.totalMonthlyHours || 0) : 0);
            } catch (e) {
                console.error("CRONO SLA ERROR:", e);
                setPositionStructure([{ positionName: 'ERROR', shifts: [], qty: 1 }]);
                setHasActiveSLA(false);
                setSlaVendidas(0);
            }
        };
        fetchSLA();
    }, [selectedClient, selectedObjective, currentDate]);

    // LISTENER DE NOVEDADES Y OTROS DATOS
    useEffect(() => {
        // Mapa: servicios_sla doc ID → objectiveId (para cruzar preferredObjectiveId cargado desde RRHH)
        getDocs(collection(db, 'servicios_sla')).then(snap => {
            const m: Record<string, string> = {};
            snap.docs.forEach(d => { if (d.data().objectiveId) m[d.id] = d.data().objectiveId; });
            setSlaIdToObjId(m);
        }).catch(() => {});

        // Queries filtradas por empresa si la migración está completa
        const clientsQ = migracionCompleta
            ? query(collection(db, 'clients'), where('empresaId', '==', empresaId))
            : collection(db, 'clients');
        const empleadosQ = migracionCompleta
            ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
            : collection(db, 'empleados');

        const unsubC = onSnapshot(clientsQ, snap => {
            if (snap.empty && migracionCompleta) {
                getDocs(collection(db, 'clients')).then(fb => { if (!fb.empty) setClients(fb.docs.map(d => ({id: d.id, ...d.data()}))); }).catch(() => {});
            } else {
                setClients(snap.docs.map(d => ({id: d.id, ...d.data()})));
            }
        }, (e) => console.error('[plan] clients error:', e));
        const unsubAg = onSnapshot(collection(db, 'convenios'), snap => setAgreements(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error('[plan] convenios error:', e));
        const unsubE = onSnapshot(empleadosQ, snap => {
            const map = (s: typeof snap) => s.docs.map(d => { const data = d.data(); return { id: d.id, name: data.name || data.firstName + ' ' + data.lastName, preferredObjectiveId: data.preferredObjectiveId, laborAgreement: data.laborAgreement, status: data.status || 'activo', lat: data.lat ?? data.latitude ?? null, lng: data.lng ?? data.longitude ?? null, address: data.address || '', restriccionesObjetivo: data.restriccionesObjetivo || [], restriccionesCliente: data.restriccionesCliente || [], conflictosEmpleados: data.conflictosEmpleados || [] }; });
            if (snap.empty && migracionCompleta) {
                getDocs(collection(db, 'empleados')).then(fb => { if (!fb.empty) setEmployees(map(fb)); }).catch(() => {});
            } else {
                setEmployees(map(snap));
            }
        }, (e) => console.error('[plan] empleados error:', e));

        const unsubS = onSnapshot(collection(db, 'turnos'), snap => {
            const map: any = {};
            snap.docs.forEach(d => {
                const data = d.data();
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
                        positionName: data.positionName
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

        const unsubA = onSnapshot(collection(db, 'ausencias'), snap => {
            const map: any = {};
            snap.docs.forEach(d => {
                const data = d.data();
                if (!data.employeeId) return;
                const toDay = (val: any) => {
                    if (!val) return null;
                    if (val.toDate) return val.toDate();
                    if (val.seconds) return new Date(val.seconds * 1000);
                    if (typeof val === 'string') {
                        const parts = val.split('-').map(Number);
                        if (parts.length === 3) return new Date(parts[0], parts[1] - 1, parts[2]);
                    }
                    const dt = new Date(val);
                    return isNaN(dt.getTime()) ? null : dt;
                };
                const start = toDay(data.startDate);
                const end = toDay(data.endDate);
                if (start && end) {
                    let current = new Date(start);
                    const endDay = new Date(end);
                    current.setHours(0, 0, 0, 0);
                    endDay.setHours(0, 0, 0, 0);
                    while (current <= endDay) { 
                        const key = `${data.employeeId}_${getDateKey(current)}`; 
                        map[key] = { id: d.id, ...data, isAbsence: true }; 
                        current.setDate(current.getDate() + 1); 
                    } 
                }
            });
            setAbsencesMap(map);
        }, (e) => console.error('[plan] ausencias error:', e));

        // novedades: equality + orderBy requires composite index (status ASC, createdAt DESC in firestore.indexes.json)
        const qNovedades = query(collection(db, 'novedades'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(40));
        const unsubN = onSnapshot(qNovedades, (snap) => {
            const alerts = snap.docs
                .filter(d => !d.data().viewed)  // safety net: excluir ya vistas
                .filter(d => !d.data().priority || d.data().priority === 'high')
                .map(d => ({ id: d.id, source: 'NOVEDAD', ...d.data(), msg: d.data().description }));
            setNotifications(alerts);
            setHasUnread(alerts.length > 0);
        }, (e) => console.error('[plan] novedades error:', e));
        
        return () => { unsubC(); unsubE(); unsubS(); unsubLogs(); unsubNotifs(); unsubA(); unsubAg(); unsubN(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresaId, migracionCompleta]);

    // Cargar estado de publicación cuando cambia objetivo o mes
    useEffect(() => {
        if (!selectedObjective) return;
        const key = `${selectedObjective}_${currentDate.getFullYear()}_${currentDate.getMonth() + 1}`;
        getDoc(doc(db, 'planificacion_estados', key))
            .then(snap => {
                if (snap.exists()) {
                    const data = snap.data();
                    setPublishStatusMap(prev => ({ ...prev, [key]: { publishedAt: data.publishedAt, publishedBy: data.publishedBy } }));
                } else {
                    setPublishStatusMap(prev => ({ ...prev, [key]: null }));
                }
            }).catch(() => {});
    }, [selectedObjective, currentDate]);

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
    const exitSnapshotMode = () => setComparingSnapshot(null);

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
    const saveEmpPos = (empId: string, posName: string | null) => {
        const key = `${empId}___${selectedObjective}`;
        const newMap = { ...empDefaultPos };
        if (posName) { newMap[key] = posName; } else { delete newMap[key]; }
        setEmpDefaultPos(newMap);
        try { localStorage.setItem('planif_emp_pos', JSON.stringify(newMap)); } catch {}
        setEmpPosPicker(null);
    };

    const handleUnassignEmployee = async (emp: any) => { if (!selectedObjective) return; if (emp.preferredObjectiveId !== selectedObjective) { toast.error("Error asignación."); return; } if (!confirm(`¿CONFIRMAR DESVINCULACIÓN?`)) return; try { await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: null }); await addDoc(collection(db, 'audit_logs'), { action: 'DESVINCULACION_OBJETIVO', module: 'PLANIFICADOR', details: `Desvinculó a ${emp.name}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid }); toast.success("Desvinculado"); } catch (e) { toast.error("Error"); } };
    const handleMarkAllRead = async () => { if (!confirm("¿Marcar todas como leídas?")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) { const ref = doc(db, 'novedades', n.id); batch.update(ref, { viewed: true, status: 'read' }); } }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Bandeja limpia"); };
    const handleDeleteAllNotifications = async () => { if (!confirm("¿Eliminar permanentemente todas las notificaciones? Esta acción no se puede deshacer.")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) batch.delete(doc(db, 'novedades', n.id)); }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Notificaciones eliminadas"); };
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
            const publishKey = `${selectedObjective}_${currentDate.getFullYear()}_${currentDate.getMonth() + 1}`;
            const isPublished = !!publishStatusMap[publishKey];
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

                        if(change.code === 'F' || change.code === 'FF') end.setHours(23,59,59);
                        else end.setTime(start.getTime() + ((change.hours != null ? change.hours : 8)*3600000));

                        const safeSwapWith = change.swapWith || null;
                        const safeSwapDate = change.swapDate || null;

                        // FIX DE SEGURIDAD: Evitar undefined en positionName
                        const safePositionName = change.positionName || 'General';

                        batch.set(doc(collection(db, 'turnos')), {
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
                        });

                        logData.push({ empId, date: dateStr, action: correctionMode ? 'CORRECCION_SUPERADMIN' : actionType });
                        if (isPublished || correctionMode) {
                            batch.set(doc(collection(db, 'audit_logs')), {
                                action: correctionMode ? 'CORRECCION_SUPERADMIN' : actionType,
                                module: 'PLANIFICADOR',
                                details: correctionMode ? `[CORRECCIÓN] ${actionDetail}` : actionDetail,
                                timestamp: serverTimestamp(),
                                actorName: realActorName,
                                actorUid: auth.currentUser?.uid,
                            });
                        }
                    }
                }

                await addDoc(collection(db, 'planificaciones_historial'), { timestamp: serverTimestamp(), user: realActorName, period: `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`, objectiveId: selectedObjective, changes: logData, count, snapshot: JSON.stringify(snapshotData) });
                await batch.commit();
                // Guardar ausencias pendientes (novedades RRHH)
                for (const novedad of Object.values(pendingNovedades)) {
                    await addDoc(collection(db, 'ausencias'), { ...novedad, createdAt: serverTimestamp() });
                }
                setPendingChanges({});
                setPendingNovedades({});
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
        const publishKey = `${selectedObjective}_${currentDate.getFullYear()}_${currentDate.getMonth() + 1}`;
        const isAlreadyPublished = !!publishStatusMap[publishKey];
        const verb = isAlreadyPublished ? 'ya fue publicado. ¿Volver a notificar todos los cambios desde la última publicación?' : '¿Publicar cronograma? Se notificará a todos los empleados del objetivo.';
        if (!confirm(verb)) return;
        setIsPublishing(true);
        try {
            const auth = getAuth();
            const actorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Sistema';
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth() + 1;
            // 1. Registrar publicación
            await setDoc(doc(db, 'planificacion_estados', publishKey), {
                objetivoId: selectedObjective,
                año: year,
                mes: month,
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
            await addDoc(collection(db, 'audit_logs'), {
                action: 'PUBLICACION_CRONOGRAMA',
                module: 'PLANIFICADOR',
                details: `Cronograma publicado — ${draftsSnap.docs.length} turno(s) notificado(s) · ${month}/${year}`,
                timestamp: serverTimestamp(),
                actorName,
                actorUid: getAuth().currentUser?.uid || null,
            });
            // 4. Actualizar estado local
            setPublishStatusMap(prev => ({ ...prev, [publishKey]: { publishedAt: new Date(), publishedBy: actorName } }));
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
    const handleProcessVacancy = () => { if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; } if (!vacancyData) return; const replacementEmp = selectedReplacement ? employees.find(e => e.id === selectedReplacement) : null; const newChanges = { ...pendingChanges }; const [sY, sM, sD] = (vacancyData.startDate || '').split('-').map(Number); const [eY, eM, eD] = (vacancyData.endDate || vacancyData.startDate || '').split('-').map(Number); if (!sY || !eY) { toast.error('Datos de ausencia incompletos'); return; } let current = new Date(sY, sM - 1, sD); const end = new Date(eY, eM - 1, eD); const ABSENCE_TYPE_CODES: Record<string, string> = { 'Vacaciones': 'V', 'Enfermedad': 'E', 'ART': 'A', 'Licencia Esp.': 'L', 'PG Permiso Gremial': 'PG', 'Injustificada': 'AA' }; const absCode = ABSENCE_TYPE_CODES[vacancyData.type] || 'AA'; const NON_WORK_CODES = new Set(['V', 'L', 'PG', 'A', 'E', 'AA', 'F', 'FF', 'FT', 'PAST', 'LOCKED', 'RET']);
                        // Turno típico de la titular (para cubrir cuando no hay shift previo asignado)
                        const getTypicalShift = (empId: string) => {
                            const yr = currentDate.getFullYear(); const mo = currentDate.getMonth();
                            const days = new Date(yr, mo + 1, 0).getDate();
                            const freq: Record<string, { count: number; shift: any }> = {};
                            for (let d = 1; d <= days; d++) {
                                const k = `${empId}_${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                                const s = shiftsMap[k];
                                if (s?.code && !NON_WORK_CODES.has(s.code)) {
                                    if (!freq[s.code]) freq[s.code] = { count: 0, shift: s };
                                    freq[s.code].count++;
                                }
                            }
                            const best = Object.values(freq).sort((a, b) => b.count - a.count)[0];
                            return best?.shift || null;
                        };
                        let count = 0; let covered = 0; while (current <= end) { const dateStr = getDateKey(current); const titularKey = `${vacancyData.employeeId}_${dateStr}`; const existingShift = shiftsMap[titularKey]; const workShift = (existingShift && existingShift.code && !NON_WORK_CODES.has(existingShift.code)) ? existingShift : getTypicalShift(vacancyData.employeeId); newChanges[titularKey] = { code: absCode, name: vacancyData.type, isTemp: true, hours: 0, startTime: '00:00', comments: `${vacancyData.type} — gestionado desde planificador`, coveredBy: replacementEmp ? replacementEmp.name : null }; if (replacementEmp && workShift) { const suplenteKey = `${replacementEmp.id}_${dateStr}`; newChanges[suplenteKey] = { code: workShift.code, name: workShift.code, isTemp: true, objectiveId: workShift.objectiveId || selectedObjective, hours: workShift.hours || 8, startTime: workShift.startTime || '00:00', positionName: workShift.positionName || activePosition || 'General', comments: `Cubriendo a ${vacancyData.employeeName} (${vacancyData.type})` }; covered++; } count++; current.setDate(current.getDate() + 1); } setPendingChanges(newChanges); setShowVacancyModal(false); setVacancyData(null); toast.success(replacementEmp ? `${absCode} en ${count} día(s) — ${covered} turno(s) asignados a ${replacementEmp.name}. Guardá los cambios.` : `${absCode} en ${count} día(s) — sin cobertura asignada. Guardá los cambios.`);
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
        
        const fallbackPos = activePosition || (positionStructure[0]?.positionName) || 'General';
        const getEmpPos = (emp: any) => empDefaultPos[`${emp.id}___${selectedObjective}`] || fallbackPos;

        for (let r = minR; r <= maxR; r++) { const emp = displayedEmployees[r]; if (!emp) continue; for (let c = minC; c <= maxC; c++) { const day = daysInMonth[c]; const key = `${emp.id}_${getDateKey(day)}`; const existing = shiftsMap[key]; if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig && shiftConfig.code !== 'F') { francosReplaced++; } } }
        let markAsFT = false;
        if (francosReplaced > 0) { if(confirm(`⚠️ Estás sobrescribiendo ${francosReplaced} Francos.\n¿Deseas marcarlos como FT?`)) { markAsFT = true; } }
        const blockedEmps = new Set<string>();
        for (let r = minR; r <= maxR; r++) { const emp = displayedEmployees[r]; if (!emp) continue; const empPos = getEmpPos(emp); for (let c = minC; c <= maxC; c++) { const day = daysInMonth[c]; const dateStr = getDateKey(day); const key = `${emp.id}_${dateStr}`; const existing = shiftsMap[key]; if (isShiftConsolidated(existing)) continue; if (shiftConfig === null) { newChanges[key] = { isDeleted: true }; count++; } else { const { blocked, warnings } = checkRestricciones(emp, dateStr); if (blocked) { blockedEmps.add(emp.name); continue; } if (warnings.length > 0) warnings.forEach(w => toast.warning(w, { duration: 8000 })); let cellIsFT = false; if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') { cellIsFT = markAsFT; } newChanges[key] = { ...shiftConfig, isTemp: true, oldObjectiveId: existing?.objectiveId, isFrancoTrabajado: cellIsFT, positionName: empPos }; count++; } } }
        if (blockedEmps.size > 0) toast.error(`🚫 Bloqueados (objetivo excluido): ${[...blockedEmps].join(', ')}`, { duration: 10000 });
        setPendingChanges(newChanges);
        toast.info(`${count} celdas`);
    };

    const checkRestricciones = (emp: any, dateStr: string): { blocked: boolean; warnings: string[] } => {
        const warnings: string[] = [];
        const currentObjName = getObjectiveName(selectedObjective);
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
        return { blocked: !!(objRestr || clientRestr), warnings };
    };

    const applyToPending = (config: any) => {
        const key = `${selectedCell.empId}_${selectedCell.dateStr}`;
        const emp = displayedEmployees.find((e: any) => e.id === selectedCell.empId);
        if (emp && config && !config.isDeleted) {
            const { blocked, warnings } = checkRestricciones(emp, selectedCell.dateStr);
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
        setSelectedCell(null);
        setActivePosition(null);
        setFrancoMode('NONE');
        setPendingAssignment(null);
        setSwapConfig(null);
        setShowSwapModal(false);
        toast.info("Cambio aplicado");
    };

    const handleAssignShift = async (shiftConfig: any, positionName: string) => { 
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; } 
        if (!selectedCell) return; 
        if (isDateLocked(selectedCell.dateStr)) { toast.error("Periodo cerrado."); return; } 
        if (isShiftConsolidated(selectedCell.currentShift)) { toast.warning("Turno consolidado/fichado: solo lectura."); return; }
        if (selectedCell.absence) { toast.warning("El empleado tiene una ausencia/vacaciones registrada: no se puede planificar encima."); return; }
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
        // Para que tenga efecto real, necesitamos los “turnos laborables” cruzados:
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
                if (!isLocked && ((effectiveShift && absence && !absenceAlreadyHandled) || (effectiveShift && effectiveShift.hasNovedad && !absenceAlreadyHandled))) { findNeighbors(effectiveShift, dateStr); setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); if (absence && absence.type) { setVacancyData({ ...absence, source: 'AUSENCIA' }); setSelectedReplacement(''); setShowVacancyModal(true); } else { setShowConflictModal(true); } }
                else if (!isLocked && absence && !effectiveShift) { setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: effectiveShift, absence: absence }); setVacancyData({ ...absence, source: 'AUSENCIA' }); setSelectedReplacement(''); setShowVacancyModal(true); }
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
        const queryStart = new Date(monthStart);
        queryStart.setMonth(queryStart.getMonth() - 2);
        const absSnap = await getDocs(query(
            collection(db, 'ausencias'),
            where('startDate', '>=', Timestamp.fromDate(queryStart)),
            where('startDate', '<=', Timestamp.fromDate(monthEnd))
        ));
        const absences: Record<string, Map<string, string>> = {};
        absSnap.docs.forEach(d => {
            const data = d.data() as any;
            const empId = data.employeeId;
            if (!empId) return;
            if (!isActiveAbsence(data)) return;
            const s = data.startDate?.toDate ? data.startDate.toDate() : new Date((data.startDate?.seconds || 0) * 1000);
            const e = data.endDate?.toDate ? data.endDate.toDate() : new Date((data.endDate?.seconds || 0) * 1000);
            if (!(s instanceof Date) || isNaN(s.getTime())) return;
            if (!(e instanceof Date) || isNaN(e.getTime())) return;
            // Solapamiento real con el mes a planificar
            if (e < monthStart) return;
            const code = inferAbsenceCode(data);
            if (!absences[empId]) absences[empId] = new Map();
            const cur = new Date(Math.max(s.getTime(), monthStart.getTime()));
            cur.setHours(12, 0, 0, 0);
            const end = new Date(Math.min(e.getTime(), monthEnd.getTime()));
            end.setHours(12, 0, 0, 0);
            while (cur <= end) {
                absences[empId].set(getDateKey(cur), code);
                cur.setDate(cur.getDate() + 1);
            }
        });
        return absences;
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
    const generateAutoScheduleV2 = async () => {
        if (!selectedObjective) return;
        if (!autoCycles.length) { toast.error('Seleccioná al menos un esquema de turnos'); return; }
        if (!positionStructure.length) { toast.error('No hay puestos/SLA configurados para este objetivo'); return; }
        if (!displayedEmployees.length) { toast.error('No hay empleados en la dotación'); return; }

        setAutoV2Loading(true);
        setAutoV2Progress({ pct: 4, label: 'Iniciando análisis…' });
        try {
            const SHIFT_HRS_LOCAL: Record<string,number> = { M:8, T:8, N:8, D12:12, N12:12 };

            // Cargar ausencias que SOLAPAN con el mes (vacaciones, ART, licencias en curso)
            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const monthEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0, 23, 59, 59);
            await bumpAutoV2Progress(12, 'Cargando ausencias y licencias del mes…');
            const absences = await loadAbsencesForRange(monthStart, monthEnd);

            // Acumular cola CCT del mes anterior (26 → fin) por empleado
            const empMonthlyInitial: Record<string,number> = {};
            displayedEmployees.forEach((emp: any) => { empMonthlyInitial[emp.id] = 0; });
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
            await bumpAutoV2Progress(52, 'Calculando viabilidad (motor COSP)…');
            await new Promise<void>((r) => setTimeout(r, 0));
            const result = runAutoScheduleV2({
                positions: positionStructure,
                employees: displayedEmployees.map((e:any) => ({
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
                autoCycles,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                getDayLetter,
                getDateKey,
            });

            await bumpAutoV2Progress(100, 'Listo');
            await new Promise<void>((r) => setTimeout(r, 150));
            setAutoV2Report(result.feasibility);

            if (!result.feasibility.ok) {
                toast.error('Plan no viable — revisá el diagnóstico antes de generar', { duration: 4000 });
            } else {
                toast.success(
                    `Viabilidad OK: objetivo ${Math.round(result.feasibility.metrics.effectiveTargetHours)}h vs oferta ${Math.round(result.feasibility.metrics.offerHours)}h. Podés generar el cronograma.`,
                    { duration: 4500 }
                );
            }
        } catch (e:any) {
            toast.error('Error al analizar viabilidad');
            console.error('[autoScheduleCOSP]', e);
        } finally {
            setAutoV2Loading(false);
            setAutoV2Progress(null);
        }
    };

    /**
     * Genera asignaciones y las vuelca a pendingChanges (motor COSP).
     */
    const applyAutoScheduleV2 = async () => {
        if (!selectedObjective) return;
        if (!autoV2Report?.ok) { toast.error('Calculá viabilidad primero (debe dar viable)'); return; }
        setAutoV2Generating(true);
        setAutoV2Progress({ pct: 4, label: 'Iniciando generación…' });
        try {
            const SHIFT_HRS_LOCAL: Record<string,number> = { M:8, T:8, N:8, D12:12, N12:12 };

            const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            const monthEnd   = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0, 23, 59, 59);
            await bumpAutoV2Progress(10, 'Cargando ausencias y licencias del mes…');
            const absences = await loadAbsencesForRange(monthStart, monthEnd);

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

            const client = clients.find((c:any) => c.objetivos?.some((o:any) => (o.id || o.name) === selectedObjective));
            const objMeta: any = client?.objetivos?.find((o:any) => (o.id || o.name) === selectedObjective);
            const defaultPositionByEmp: Record<string,string> = {};
            displayedEmployees.forEach((e:any) => {
                const pos = empDefaultPos[`${e.id}___${selectedObjective}`];
                if (pos) defaultPositionByEmp[e.id] = pos;
            });
            await bumpAutoV2Progress(38, 'Generando cronograma (motor COSP, puede tardar varios segundos)…');
            await new Promise<void>((r) => setTimeout(r, 0));
            const gen = generateScheduleV2({
                positions: positionStructure,
                employees: displayedEmployees.map((e:any) => ({
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
                autoCycles,
                budgetMode: autoV2BudgetMode,
                objectiveId: selectedObjective,
                objectiveLat: typeof objMeta?.lat === 'number' ? objMeta.lat : null,
                objectiveLng: typeof objMeta?.lng === 'number' ? objMeta.lng : null,
                defaultPositionByEmp,
                getDayLetter,
                getDateKey,
                rotateShifts: autoRotateShifts,
                codeHoursHint: slaCodeHoursHint,
            });

            await bumpAutoV2Progress(58, 'Volcando celdas en pendientes…');
            // Volcamos a pendingChanges respetando autoOverwrite y celdas bloqueadas
            const newChanges: Record<string, any> = autoOverwrite ? {} : { ...pendingChanges };
            let written = 0;
            let skipped = 0;
            for (const a of gen.assignments) {
                const key = `${a.empId}_${a.dateStr}`;
                if (isDateLocked(a.dateStr)) { skipped++; continue; }
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
            setPendingChanges(newChanges);
            setAutoGeneratedReady(true);

            // Si hay turnos bloqueados solo por el cap 200h que pasarían CCT → pedir autorización
            if (gen.capOverflowSlots.length > 0) {
                const overSlots = gen.capOverflowSlots;
                const affectedNames = [...new Set(overSlots.map(s => {
                    const emp = displayedEmployees.find((e: any) => e.id === s.empId);
                    return (emp?.nombre || emp?.name || s.empId) as string;
                }))];
                setAuthModal({
                    pendingFn: async () => {
                        const overflowChanges: Record<string, any> = {};
                        for (const s of overSlots) {
                            const key = `${s.empId}_${s.dateStr}`;
                            if (isDateLocked(s.dateStr)) continue;
                            overflowChanges[key] = {
                                isTemp: true,
                                employeeId: s.empId,
                                objectiveId: selectedObjective,
                                positionName: s.positionName,
                                code: s.code,
                                name: s.name,
                                hours: s.hours,
                                startTime: s.startTime,
                                ...(s.endTime ? { endTime: s.endTime } : {}),
                            };
                        }
                        setPendingChanges((prev: any) => ({ ...prev, ...overflowChanges }));
                        toast.success(`${overSlots.length} turno(s) sobre 200h autorizados y agregados al borrador.`, { duration: 5000 });
                    },
                    employees: affectedNames,
                    isSaveFlow: true,
                    operatorName: 'Autoplanificador COSP',
                    description: `La auto-planificación generó ${overSlots.length} turno(s) que superan las 200hs del convenio. Autorizá con PIN para agregarlos al borrador:`,
                });
            }
            // Guardamos las stats post-generación para el panel "Capacidad CCT"
            setAutoV2GenStats({
                employeeMonthlyHours: gen.stats.employeeMonthlyHours,
                employeeCycleHours: gen.stats.employeeCycleHours,
                targetHours: gen.stats.targetHours,
                totalBillableHours: gen.stats.totalBillableHours,
                uncoveredSlots: gen.stats.uncoveredSlots,
                idleEmployeeIds: gen.stats.idleEmployeeIds,
                primaryShiftByEmp: gen.stats.primaryShiftByEmp,
                positionGroups: gen.stats.positionGroups,
                employeeRetCount: gen.stats.employeeRetCount,
                employeeRetHoursPotential: gen.stats.employeeRetHoursPotential,
                totalRetCount: gen.stats.totalRetCount,
                totalRetHoursPotential: gen.stats.totalRetHoursPotential,
                uncoveredSlotsByDay: gen.stats.uncoveredSlotsByDay,
                excessPositionEmployees: gen.stats.excessPositionEmployees,
            });

            await bumpAutoV2Progress(78, 'Verificando cobertura y reglas (descansos, licencias)…');
            // ── Verificación de cobertura (slots, descansos, licencias, >200h) ──
            const verifyCtx = {
                positions: positionStructure,
                employees: displayedEmployees.map((e:any) => ({ id: e.id, nombre: e.nombre || e.name })),
                daysInMonth,
                empMonthlyInitial,
                absences,
                slaVendidas,
                autoCycles,
                getDayLetter,
                getDateKey,
            } as any;
            const coverage = verifyScheduleCoverage(verifyCtx, gen.assignments, gen.stats);
            setAutoV2Coverage(coverage);
            setAutoV2Suggestions(buildScheduleOptimizationSuggestions(verifyCtx, gen.assignments, gen.stats));
            // Snapshot para reprocesar (cuando el usuario hace click en "Reprocesar errores")
            setAutoV2LastRun({ assignments: gen.assignments, stats: gen.stats, ctx: verifyCtx });

            await bumpAutoV2Progress(100, 'Listo');
            await new Promise<void>((r) => setTimeout(r, 180));
            setShowAutoV2Modal(false);

            const uncov = coverage.coverage.uncoveredSlots > 0 ? ` · ⚠ ${coverage.coverage.uncoveredSlots} slots sin cubrir` : '';
            const over  = coverage.overHours.length > 0 ? ` · ⚠ ${coverage.overHours.length} empleados >200h ciclo` : '';
            const idleN = gen.stats.idleEmployeeIds?.length || 0;
            const idle  = idleN > 0 ? ` · 💤 ${idleN} en RET mes entero` : '';
            const lic   = coverage.licenseConflicts.length > 0 ? ` · ⛔ ${coverage.licenseConflicts.length} conflictos con licencias` : '';
            const rest  = coverage.restViolations.length > 0 ? ` · ⛔ ${coverage.restViolations.length} descansos rotos` : '';

            if (written === 0 && skipped > 0) {
                toast.error(
                    `No se generó nada: las ${skipped} celdas calculadas ya estaban ocupadas. ` +
                    `Activá "Sobreescribir celdas ya asignadas" en Automatizar y ejecutá de nuevo.`,
                    { duration: 8000 }
                );
            } else if (written === 0) {
                toast.error('No se generó el cronograma. Revisá ciclos seleccionados, ausencias y dotación.', { duration: 6000 });
            } else if (!coverage.ok) {
                // Hay slots/descansos/licencias rotos: avisamos y abrimos el reporte
                toast.warning(
                    `${written} celdas generadas con avisos. Revisá la Verificación de cobertura.${uncov}${over}${lic}${rest}`,
                    { duration: 7500 }
                );
                setShowCoverageModal(true);
            } else {
                toast.success(
                    `Automático: ${written} celdas · ${Math.round(gen.stats.totalBillableHours)}h facturables (objetivo ${Math.round(gen.stats.targetHours)}h)${skipped>0?` · ${skipped} omitidas`:''}${idle}. Cobertura ✓`,
                    { duration: 6500 }
                );
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
            let written = 0;
            for (const a of result.assignments) {
                const key = `${a.empId}_${a.dateStr}`;
                if (isDateLocked(a.dateStr)) continue;
                // Cuando overwrite está OFF, solo sobreescribimos las celdas que ya venía marcando esta automatización
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

    /** Debug: trae el doc de servicios_sla vigente para el mes en pantalla y lo muestra crudo. */
    const fetchSlaDebug = async () => {
        if (!selectedClient || !selectedObjective) { toast.error('Seleccioná cliente y objetivo'); return; }
        setSlaDebugLoading(true);
        try {
            const q = query(collection(db, 'servicios_sla'), where('clientId', '==', selectedClient));
            const snap = await getDocs(q);
            const allDocs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
            let matching = allDocs.filter(d => d.objectiveId === selectedObjective);
            if (matching.length === 0) {
                const objName = getObjectiveName(selectedObjective);
                matching = allDocs.filter(d => d.objectiveId === objName || d.objectiveName === objName);
            }
            const y = currentDate.getFullYear(), m = currentDate.getMonth();
            const viewStart = `${y}-${String(m+1).padStart(2,'0')}-01`;
            const viewEnd   = `${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y, m+1, 0).getDate()).padStart(2,'0')}`;
            const srv = matching.find(d => d.startDate && d.endDate && d.startDate <= viewEnd && d.endDate >= viewStart)
                ?? [...matching].sort((a,b) => (b.startDate||'').localeCompare(a.startDate||''))[0];
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
        if (!monthPlannedHours) return 0;
        const isWorkingCode = (code: string) => !OBJECTIVE_NON_BILLABLE_CODES.has(String(code || '').toUpperCase());
        const empWithHours = new Set<string>();
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
                if (calcShiftHours(activeShift) > 0) empWithHours.add(emp.id);
            });
        });
        const count = empWithHours.size;
        if (!count) return 0;
        return Math.round(monthPlannedHours / count);
    }, [monthPlannedHours, displayedEmployees, daysInMonth, pendingChanges, shiftsMap, selectedObjective]);

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

    const renderGrid = (isSnapshotView: boolean, snapshotData?: any) => (
        <table className="border-collapse w-full text-xs">
            <thead className="sticky top-0 z-30 bg-slate-100 shadow-md">
                <tr className="h-6">
                    <th rowSpan={2} className="sticky left-0 z-40 bg-slate-100 p-2 text-left min-w-[150px] border-b border-r">
                        <span className="text-[10px] font-black uppercase"><Users size={12}/> Dotación</span>
                    </th>
                    {daysInMonth.map((d) => {
                        const dateStr = getDateKey(d);
                        const letter = getDayLetter(dateStr);
                        const isWeekend = [0, 6].includes(d.getDay());
                        return (
                            <th key={`dw_${d.toISOString()}`} className={`min-w-[25px] border-b border-r p-1 text-center ${isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : 'dark:border-slate-700'}`}>
                                <span className={`text-[9px] font-black ${isWeekend ? 'text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>{letter}</span>
                            </th>
                        );
                    })}
                </tr>
                <tr className="h-10">
                    {daysInMonth.map((d, dayIndex) => {
                        const isSource = columnSelectMode && columnSelectSource === dayIndex;
                        const isInSel = !isSnapshotView && selection.start != null && dayIndex >= Math.min(selection.start.c, selection.end?.c ?? selection.start.c) && dayIndex <= Math.max(selection.start.c, selection.end?.c ?? selection.start.c);
                        const isWeekend = [0,6].includes(d.getDay());
                        return (
                            <th
                                key={d.toISOString()}
                                onMouseDown={() => !isSnapshotView && handleDayHeaderMouseDown(dayIndex)}
                                onMouseEnter={() => !isSnapshotView && handleDayHeaderMouseEnter(dayIndex)}
                                onMouseUp={handleDayHeaderMouseUpOrLeave}
                                onMouseLeave={handleDayHeaderMouseUpOrLeave}
                                className={`min-w-[25px] border-b border-r p-1 text-center select-none cursor-pointer transition-colors
                                    ${isSource ? 'bg-indigo-600 text-white' : isInSel && columnSelectMode ? 'bg-indigo-100 dark:bg-indigo-900/40' : isWeekend ? 'bg-rose-50 dark:bg-rose-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-700 dark:border-slate-700'}`}
                                title={columnSelectMode ? (isSource ? 'Clic para cancelar copia' : 'Clic para extender destino') : 'Clic para copiar este día'}
                            >
                                <span className={`text-[10px] font-bold ${isSource ? 'text-white' : isWeekend ? 'text-rose-600 dark:text-rose-400 font-black' : 'dark:text-slate-300'}`}>{d.getDate()}</span>
                                {isSource && <div className="text-[7px] font-black opacity-80 leading-none mt-0.5">ORIG</div>}
                            </th>
                        );
                    })}
                </tr>
            </thead>
            <tbody>
                {displayedEmployees.map((emp, idx) => {
                    const isGuest = selectedObjective && emp.preferredObjectiveId !== selectedObjective;
                    const homeObjectiveName = getObjectiveName(emp.preferredObjectiveId);
                    
                    return (
                        <React.Fragment key={emp.id}>
                            {/* FILA ACTUAL (Editable) - Solo se muestra si NO es vista de snapshot */}
                            {!isSnapshotView && (
                                <tr
                                    className={`group ${dragOverVisual === idx ? 'border-t-2 border-t-indigo-400' : ''} ${(empMonthlyHours[emp.id] || 0) >= 200 ? 'bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/40'}`}
                                    onDragOver={(e) => handleRowDragOver(e, idx)}
                                    onDrop={(e) => handleRowDrop(e, idx)}
                                    onDragEnd={() => setDragOverVisual(null)}
                                >
                                    <td
                                        draggable
                                        onDragStart={(e) => handleRowDragStart(e, idx)}
                                        onClick={() => !isSnapshotView && handleRowHeaderClick(idx)}
                                        title="Clic para seleccionar fila completa"
                                        className={`sticky left-0 z-20 p-2 border-r border-b shadow-sm h-8 cursor-grab active:cursor-grabbing dark:border-slate-700 ${(empMonthlyHours[emp.id] || 0) >= 200 ? 'bg-red-50 group-hover:bg-red-100 dark:bg-red-950/30 dark:group-hover:bg-red-900/30' : 'bg-white dark:bg-slate-800 group-hover:bg-slate-50 dark:group-hover:bg-slate-700/60'}`}
                                    >
                                        {(() => {
                                            const empLat = Number(emp.lat ?? emp.latitude ?? 0);
                                            const empLng = Number(emp.lng ?? emp.longitude ?? 0);
                                            const objLat = Number(selectedObjectiveData?.lat ?? 0);
                                            const objLng = Number(selectedObjectiveData?.lng ?? 0);
                                            const distKm = (empLat && empLng && objLat && objLng) ? haversineKm(empLat, empLng, objLat, objLng) : null;
                                            const monthHours = empMonthlyHours[emp.id] || 0;
                                            const cctHours = empCctCurrentHours[emp.id] || 0;
                                            const displayHours = hoursMode === 'cct' ? cctHours : monthHours;
                                            const hoursColor = displayHours >= 200 ? 'text-red-600 font-black'
                                                : displayHours >= 185 ? 'text-orange-500 font-bold'
                                                : displayHours >= 160 ? 'text-amber-500'
                                                : displayHours > 0   ? 'text-slate-500 dark:text-slate-300'
                                                : 'text-slate-400 dark:text-slate-500';
                                            return (
                                                <div className="flex items-center justify-between w-full">
                                                    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                                                        <Grip size={8} className="shrink-0 text-slate-200 group-hover:text-slate-400 transition-colors mr-0.5" />
                                                        <span className="text-[9px] font-bold truncate text-slate-700 dark:text-slate-200" title={emp.name}>{emp.name}</span>
                                                        {isGuest && (<div className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[8px] font-black uppercase flex items-center gap-1 cursor-help shadow-sm" title={`Base: ${homeObjectiveName}`}><Briefcase size={8} /> EXT</div>)}
                                                        {/* Horas mensuales planificadas */}
                                                        <span
                                                            title={hoursMode === 'cct'
                                                                ? `${Math.round(cctHours)}h en el ciclo CCT actual (26 mes anterior → 25 de este mes). Tope 200h.\n${Math.round(monthHours)}h en el mes calendario.`
                                                                : `${Math.round(monthHours)}h planificadas en el mes calendario.\n${Math.round(cctHours)}h en el ciclo CCT actual (tope 200h).`}
                                                            className={`shrink-0 text-[8px] ${hoursColor}`}
                                                        >
                                                            {Math.round(displayHours)}h
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
                                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const estimatedH = Math.min(positionStructure.length * 36 + 48, 240); const flipUp = r.bottom + estimatedH > window.innerHeight - 8; setEmpPosPicker(empPosPicker?.empId === emp.id ? null : { empId: emp.id, x: r.left, y: flipUp ? r.top - estimatedH - 4 : r.bottom + 4 }); }}
                                                                className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-colors whitespace-nowrap ${getEmpDefaultPos(emp.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100'}`}
                                                                title={`Puesto prefijado: ${getEmpDefaultPos(emp.id) || 'sin asignar'}`}
                                                            >
                                                                {getEmpDefaultPos(emp.id) || '···'}
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
                                        const effectiveCode = p?.code || s?.code;
                                        const absAlreadyHandled = effectiveCode && ['V','L','PG','A','E','AA'].includes(effectiveCode) && !!absence;
                                        let hasConflict = (!absAlreadyHandled && ((s && absence && s.status !== 'ABSENT') || (s && s.hasNovedad)));
                                        let statusIndicator = null;
                                        if (s && !isSnapshotView) { if (s.status === 'PRESENT' || s.status === 'COMPLETED' || s.isPresent) statusIndicator = 'bg-emerald-500'; else if (s.status === 'ABSENT' || s.isAbsent) statusIndicator = 'bg-rose-500'; }
                                        let isSwap = s?.swapWith || p?.swapWith;
                                        const swapPending = !!(
                                            isSwap &&
                                            (
                                                (s?.origin && s.origin !== 'PLANIFICADOR' && !s.swapAuthorized) ||
                                                (p?.origin && p.origin !== 'PLANIFICADOR' && !p.swapAuthorized)
                                            )
                                        );
                                        const swapStyle = swapPending ? SHIFT_STYLES['SWAP_PENDING'] : SHIFT_STYLES['SWAP'];
                                        if (isLockedDate) { style = SHIFT_STYLES['PAST']; if (s) content = s.code; } 
                                        else if (p) { if(p.isDeleted) { content=<X size={12}/>; style="bg-rose-50 text-rose-300"; } else { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { content=p.code; const baseStyle = SHIFT_STYLES[p.code]; style = baseStyle ? `${baseStyle} ring-2 ring-amber-400 ${isSwap ? swapStyle : ''}` : `bg-amber-100 text-amber-700 font-black ring-2 ring-amber-400 ${isSwap ? swapStyle : ''}`; } } }
                                        else if (s) { if (!isLockedDate) { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { style=`${getDefaultStyle(s.code)} ${isSwap ? swapStyle : ''}`; content=s.code; } } }
                                        if (isExtended) { style += ' ring-2 ring-violet-600 z-10'; }
                                        if (isEarly) { style += ' ring-2 ring-cyan-500 z-10'; }
                                        if (plannedNov === 'AVISO') { style += ' border-l-4 border-l-amber-500'; } 
                                        if (plannedNov === 'LICENCIA') { style += ' border-l-4 border-l-purple-500'; } 
                                        if (content === 'Ausencia con Aviso' || content === 'Injustificada') { content = 'AA'; style = SHIFT_STYLES['AA']; }
                                        if (isGuest && (s || p)) { style += ' border-t-2 border-t-amber-400'; }
                                        if (absence) { const absCodes: Record<string,string> = {'Vacaciones':'V','Enfermedad':'E','ART':'A','Injustificada':'AA','Licencia Esp.':'L','PG Permiso Gremial':'PG'}; const absCode = absCodes[absence.type] || 'AA'; content = absCode; style = SHIFT_STYLES[absCode] || 'bg-rose-50 text-rose-700 font-bold border-rose-200'; }
                                        const cellPosName = (p && !p.isDeleted ? p.positionName : s?.positionName) || null;
                                        const cellCode = (p && !p.isDeleted) ? (isFT ? 'FT' : isFF ? 'FF' : p.code) : s ? (isFT ? 'FT' : isFF ? 'FF' : s.code) : null;
                                        const activeShift = (p && !p.isDeleted) ? p : s;
                                        const cellRange = cellCode
                                            ? (SHIFT_RANGES[cellCode] || (
                                                activeShift?.startTime && activeShift?.endTime
                                                    ? `${formatTime(activeShift.startTime)} - ${formatTime(activeShift.endTime)}`
                                                    : null
                                              ))
                                            : null;
                                        return <td key={key} onMouseDown={() => !isSnapshotView && handleMouseDown(idx, dayIndex)} onMouseEnter={(e) => { if (!isSnapshotView && isDragging) setSelection(pr => ({...pr, end:{r:idx, c:dayIndex}})); if ((s || p) && !absence) { const shiftLabel = cellCode ? (LEGEND_DESCRIPTIONS[cellCode] || cellCode) : null; const _isFrancoTip = cellCode ? ['F','FF','FP','FT'].includes(String(cellCode).toUpperCase()) : false; const _restHrs = _isFrancoTip ? calcFrancoRestHours(emp.id, dayIndex) : null; const _isRet = String(cellCode || '').toUpperCase() === 'RET'; setShiftTooltip({ label: shiftLabel, pos: _isRet ? null : (cellPosName || null), range: _isRet ? null : cellRange, x: e.clientX, y: e.clientY, restHours: _restHrs }); } else setShiftTooltip(null); }} onMouseLeave={() => setShiftTooltip(null)} className={`border-b border-r p-0.5 ${!isSnapshotView && !isLockedDate && !isServiceLocked ? 'cursor-pointer' : 'cursor-default'} text-center relative ${selected ? 'bg-indigo-200 dark:bg-indigo-800/50' : isCellWeekend ? 'bg-rose-50/60 dark:bg-rose-950/20' : ''}`}><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style}`}>{content}{isSwap && (<div className={`absolute bottom-0.5 right-0.5 text-[8px] font-black px-1 rounded ${swapPending ? 'bg-amber-600 text-white' : 'bg-cyan-600 text-white'}`}>{swapPending ? 'S!' : 'S'}</div>)}{(isExtended || isEarly) && <div className="absolute -top-1 -right-1 text-[8px] bg-slate-800 text-white px-1 rounded-full">+</div>}{statusIndicator && <div className={`absolute top-0 right-0 w-2 h-2 rounded-full border border-white ${statusIndicator}`}></div>}{hasConflict && ( <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center animate-pulse border-2 border-red-500 z-20"><Siren size={14} className="text-white drop-shadow-md"/></div> )}{isGuest && (s || p) && !absence && (<div className="absolute bottom-0 left-0"><Briefcase size={8} className="text-amber-600 drop-shadow-sm"/></div>)}</div></td>;
                                    })}
                                </tr>
                            )}
                            
                            {/* FILA SNAPSHOT (HISTÓRICA) - Solo se muestra si hay snapshotData y estamos en modo snapshot */}
                            {isSnapshotView && snapshotData && (
                                <tr className="bg-amber-50 border-b-2 border-amber-200">
                                    <td className="sticky left-0 z-20 bg-amber-100 p-2 border-r border-b shadow-sm h-8">
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
                                        }
                                        return <td key={`snap_${key}`} className="border-b border-r p-0.5 text-center bg-amber-50/50"><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-bold ${style}`}>{content}</div></td>;
                                    })}
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </tbody>
            <tfoot className="sticky bottom-0 z-30 bg-slate-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] border-t-2 border-slate-300">
                <tr>
                    <td className="sticky left-0 z-40 bg-slate-50 p-2 border-r border-b font-black text-[10px] uppercase text-slate-500 shadow-sm h-8">
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

                        // required = sum of pax across active positions for this day
                        const required = (positionStructure || []).reduce((acc: number, pos: any) => {
                            if (!isPosActiveOnDay(pos, dayLetter)) return acc;
                            return acc + (Number(pos?.qty) || 1);
                        }, 0);

                        // current = covered pax: per position, sum employee hours and divide by the
                        // position's daily target (24h for 24hs type, or sum of its configured shifts)
                        let current = 0;
                        (positionStructure || []).forEach((pos: any) => {
                            if (!isPosActiveOnDay(pos, dayLetter)) return;
                            const pax = Number(pos?.qty) || 1;
                            const coverageType = pos?.coverageType || 'custom';
                            let dailyTarget = 24;
                            if (coverageType !== '24hs') {
                                const shiftsArr = Array.isArray(pos?.shifts) ? pos.shifts : [];
                                const sum = shiftsArr.reduce((a: number, s: any) => {
                                    const h = Number(s.hours);
                                    if (h > 0) return a + h;
                                    if (s.startTime && s.endTime) {
                                        const parseH = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh + (mm || 0) / 60; };
                                        let dur = parseH(s.endTime) - parseH(s.startTime);
                                        if (dur <= 0) dur += 24;
                                        if (dur > 0 && dur <= 24) return a + dur;
                                    }
                                    return a + 8;
                                }, 0);
                                dailyTarget = sum > 0 ? sum : 8;
                            }
                            let hoursForPos = 0;
                            displayedEmployees.forEach((emp: any) => {
                                const key = `${emp.id}_${dateStr}`;
                                const pending = pendingChanges[key];
                                const existing = shiftsMap[key];
                                const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                                if (!activeShift) return;
                                const isWorking = !OBJECTIVE_NON_BILLABLE_CODES.has(String(activeShift.code || '').toUpperCase());
                                const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : '');
                                const shiftPos = activeShift.positionName || dominantPosition?.positionName || 'General';
                                if (isWorking && shiftObjective === selectedObjective && shiftPos === pos.positionName) {
                                    hoursForPos += calcShiftHours(activeShift);
                                }
                            });
                            current += Math.min(Math.floor(hoursForPos / dailyTarget), pax);
                        });

                        const isCovered = required > 0 && current >= required;
                        const cls = required === 0 ? 'bg-slate-50 text-slate-400' : (isCovered ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600 cursor-pointer');
                        return (
                            <td
                                key={dateStr}
                                className={`text-center border-r border-b text-[10px] font-black ${cls}`}
                                colSpan={1}
                                onClick={(e) => {
                                    if (isCovered || required === 0) return;
                                    // Gaps en tiempo real: misma lógica hours-based que el cálculo de cobertura.
                                    // NO itera códigos del SLA (evita falsos D12/N12 en esquema 6+2).
                                    const liveGaps: { positionName: string; code: string; missing: number }[] = [];
                                    (positionStructure || []).forEach((pos: any) => {
                                        if (!isPosActiveOnDay(pos, dayLetter)) return;
                                        const posQty = Number(pos?.qty) || 1;
                                        const cvType = pos?.coverageType || 'custom';
                                        let dailyTarget = 24;
                                        if (cvType !== '24hs') {
                                            const shiftsArr = Array.isArray(pos?.shifts) ? pos.shifts : [];
                                            const sum = shiftsArr.reduce((a: number, s: any) => {
                                                const h = Number(s.hours);
                                                if (h > 0) return a + h;
                                                if (s.startTime && s.endTime) {
                                                    const parseH = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh + (mm || 0) / 60; };
                                                    let dur = parseH(s.endTime) - parseH(s.startTime);
                                                    if (dur <= 0) dur += 24;
                                                    if (dur > 0 && dur <= 24) return a + dur;
                                                }
                                                return a + 8;
                                            }, 0);
                                            dailyTarget = sum > 0 ? sum : 8;
                                        }
                                        let hoursForPos = 0;
                                        const codeCounts: Record<string, number> = {};
                                        displayedEmployees.forEach((emp: any) => {
                                            const key = `${emp.id}_${dateStr}`;
                                            const pending = pendingChanges[key];
                                            const existing = shiftsMap[key];
                                            const activeShift = pending ? (pending.isDeleted ? null : pending) : existing;
                                            if (!activeShift) return;
                                            const code = String(activeShift.code || '').toUpperCase();
                                            if (OBJECTIVE_NON_BILLABLE_CODES.has(code)) return;
                                            const shiftPos = activeShift.positionName || dominantPosition?.positionName || 'General';
                                            const shiftObj = activeShift.objectiveId || (pending ? selectedObjective : '');
                                            if (shiftPos !== pos.positionName || shiftObj !== selectedObjective) return;
                                            hoursForPos += calcShiftHours(activeShift);
                                            codeCounts[code] = (codeCounts[code] || 0) + 1;
                                        });
                                        const missingHours = dailyTarget * posQty - hoursForPos;
                                        if (missingHours > 0.5) {
                                            const has12h = (codeCounts['D12'] || 0) + (codeCounts['N12'] || 0) > 0;
                                            const has8h = (codeCounts['M'] || 0) + (codeCounts['T'] || 0) + (codeCounts['N'] || 0) > 0;
                                            const shiftHrs = (has12h && !has8h) ? 12 : 8;
                                            const missCount = Math.max(1, Math.round(missingHours / shiftHrs));
                                            const bands = shiftHrs === 12 ? ['D12', 'N12'] : ['M', 'T', 'N'];
                                            let worstBand = bands[0];
                                            let worstCnt = Infinity;
                                            for (const b of bands) {
                                                const cnt = codeCounts[b] ?? 0;
                                                if (cnt < worstCnt) { worstCnt = cnt; worstBand = b; }
                                            }
                                            liveGaps.push({ positionName: pos.positionName, code: worstBand, missing: missCount });
                                        }
                                    });
                                    const gaps = liveGaps.length > 0 ? liveGaps : (autoV2GenStats?.uncoveredSlotsByDay?.[dateStr] || []);
                                    if (gaps.length > 0) setCoverageTooltip(prev => prev?.dateStr === dateStr ? null : { dateStr, gaps, x: e.clientX, y: e.clientY });
                                }}
                            >
                                {required > 0 ? `${current}/${required}` : '-'}
                            </td>
                        );
                    })}
                </tr>
            </tfoot>
        </table>
    );

    return (
        <DashboardLayout>
            <Head><title>Planificador</title></Head>
            <style>{`.pattern-grid { background-image: linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb); background-size: 10px 10px; background-position: 0 0, 5px 5px; } @media print { @page { size: A4 landscape; margin: 5mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background-color: white !important; } #printable-section { position: absolute; left: 0; top: 0; width: 100%; min-width: 100%; transform: none; background: white; } .no-print { display: none !important; } .custom-scrollbar { overflow: visible !important; height: auto !important; } }`}</style>
            <Toaster position="top-center" />
            {coverageTooltip && (
                <div
                    className="fixed z-[9999]"
                    style={{ left: Math.min(coverageTooltip.x + 8, window.innerWidth - 220), top: coverageTooltip.y + 10 }}
                    onClick={() => setCoverageTooltip(null)}
                >
                    <div className="bg-slate-900 text-white text-[10px] font-black px-3 py-2 rounded-lg shadow-xl flex flex-col gap-1 min-w-[180px]">
                        <div className="text-rose-300 text-[9px] uppercase tracking-wide mb-0.5">Cobertura incompleta · {coverageTooltip.dateStr.slice(8)}</div>
                        {coverageTooltip.gaps.map((g, i) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                                <span className="text-slate-300">{g.positionName}</span>
                                <span className="text-rose-400 font-black">{g.missing}× {g.code} faltante{g.missing > 1 ? 's' : ''}</span>
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
                    <div className="bg-slate-900 text-white text-[10px] font-black px-2.5 py-2 rounded-lg shadow-xl whitespace-nowrap flex flex-col gap-1">
                        {shiftTooltip.label && (
                            <div className="flex items-center gap-1.5 text-white">
                                <Clock size={9} className="text-indigo-300 shrink-0" />
                                {shiftTooltip.label}
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
            {empPosPicker && (
                <div
                    className="fixed z-[9999] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
                    style={{ left: empPosPicker.x, top: empPosPicker.y, minWidth: 160 }}
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase border-b bg-slate-50 tracking-wider">Puesto prefijado</div>
                    <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 200 }}>
                    {positionStructure.map(p => (
                        <button key={p.positionName} onClick={() => saveEmpPos(empPosPicker.empId, p.positionName)}
                            className={`w-full text-left px-3 py-2 text-[11px] font-bold hover:bg-indigo-50 hover:text-indigo-700 transition-colors ${getEmpDefaultPos(empPosPicker.empId) === p.positionName ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
                            {p.positionName}
                        </button>
                    ))}
                    </div>
                    {getEmpDefaultPos(empPosPicker.empId) && (
                        <button onClick={() => saveEmpPos(empPosPicker.empId, null)}
                            className="w-full text-left px-3 py-2 text-[10px] font-bold text-slate-400 hover:bg-slate-50 border-t transition-colors">
                            Quitar prefijo
                        </button>
                    )}
                </div>
            )}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out no-print ${selectedClient ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-40 opacity-100'}`}>
                <PageHeader
                    title="Planificador"
                    subtitle="Gestión de turnos y asignaciones"
                    icon={CalendarCheck}
                    className="px-2 pt-2"
                />
            </div>
            <div className={`flex flex-col animate-in fade-in select-none transition-all duration-300 ease-in-out ${selectedClient ? 'h-full p-1 space-y-1.5' : 'p-2 space-y-4 h-[calc(100vh-160px)]'}`} onMouseUp={handleMouseUp} onClick={() => setEmpPosPicker(null)}>

                <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 shrink-0 ${selectedClient ? 'py-1.5 px-2' : 'p-3'}`}>
                    {comparingSnapshot ? (
                         <div className="flex-1 bg-amber-50 border-amber-200 border px-4 py-2 rounded-xl flex justify-between items-center animate-in slide-in-from-top no-print shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-amber-100 rounded-lg text-amber-700"><Split size={20}/></div>
                                <div><p className="text-xs font-black text-amber-800 uppercase">Modo Comparación Activado</p><p className="text-[10px] text-amber-600">Comparando Actualidad vs. Versión del {comparingSnapshot.date.toLocaleString()}</p></div>
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
                                            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl min-w-[220px] max-h-64 overflow-y-auto">
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
                                                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl min-w-[220px] max-h-64 overflow-y-auto">
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
                                        onClick={() => setShowDiagnostic(v => !v)}
                                        className="flex px-3 py-1.5 bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl items-center gap-2 animate-in fade-in shadow-sm hover:border-indigo-300 dark:hover:border-indigo-500 transition-colors"
                                    >
                                        <Activity size={14} className="text-emerald-500 animate-pulse shrink-0"/>
                                        <div className="flex flex-col leading-none">
                                            <span className="text-[9px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider">Diagnóstico de Estructura</span>
                                            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                                {positionStructure.length} Puestos
                                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                                <span className="text-emerald-600 font-black">{positionStructure.reduce((acc, curr) => acc + (curr.qty || 1), 0)} Pax</span>
                                                {slaVendidas > 0 && <><span className="text-slate-300 dark:text-slate-600">|</span><span className="text-teal-600 font-black">{slaVendidas}h vend.</span></>}
                                            </span>
                                        </div>
                                        <ChevronDown size={12} className={`text-slate-400 transition-transform shrink-0 ${showDiagnostic ? 'rotate-180' : ''}`}/>
                                    </button>

                                    {showDiagnostic && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setShowDiagnostic(false)}/>
                                            <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 shadow-2xl min-w-[280px] p-3 animate-in zoom-in-95">
                                                <p className="text-[9px] font-black text-slate-400 uppercase mb-2 tracking-widest">Estructura del Servicio</p>
                                                <div className="space-y-1.5">
                                                    {positionStructure.map((pos, i) => (
                                                        <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-[10px] font-black text-slate-700 dark:text-slate-200">{pos.positionName}</p>
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
                                        </>
                                    )}
                                </div>
                            )}

                            {selectedObjective && (() => {
                                const publishKey = `${selectedObjective}_${currentDate.getFullYear()}_${currentDate.getMonth() + 1}`;
                                const published = publishStatusMap[publishKey];
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
                                        <button
                                            onClick={handlePublish}
                                            disabled={isPublishing}
                                            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors shadow"
                                        >
                                            {isPublishing ? <Loader2 size={12} className="animate-spin"/> : <CalendarCheck size={12}/>}
                                            {published ? 'RE-PUBLICAR' : 'PUBLICAR'}
                                        </button>
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
                            {Object.keys(pendingChanges).length > 0 && !isServiceLocked && <div className="flex items-center gap-2 animate-in slide-in-from-top-2 bg-amber-50 p-1.5 rounded-xl border border-amber-200 shadow-lg no-print"><span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest hidden md:inline">Planificando como: {operatorName}</span><div className="h-4 w-px bg-amber-200 mx-1"></div><span className="text-xs font-black text-amber-700 px-1">{Object.keys(pendingChanges).length} cambios</span><button onClick={() => setPendingChanges({})} className="p-1.5 hover:bg-amber-100 rounded-lg text-amber-600"><Undo size={16}/></button><button onClick={handleSaveAll} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-black flex items-center gap-2 shadow"><Save size={14}/> GUARDAR</button></div>}
                            
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
                                    <button onClick={() => {setShowNotifications(!showNotifications); setHasUnread(false)}} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl relative">
                                        <Bell size={18}/>{hasUnread && <span className="absolute top-0 right-0 w-3 h-3 bg-rose-500 rounded-full border-2 border-white animate-pulse"></span>}
                                    </button>
                                    
                                    {showNotifications && (
                                        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-2xl border overflow-hidden z-50 animate-in zoom-in-95">
                                            <div className="p-3 bg-slate-50 border-b flex justify-between items-center">
                                                <h3 className="font-black text-xs uppercase text-slate-500">Alertas</h3>
                                                <div className="flex items-center gap-2">
                                                    {/* 🛑 BOTÓN DE BORRADO MASIVO */}
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
                                    )}
                                </div>

                                <div className="flex items-center bg-slate-100 rounded-xl p-1"><button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1)); setAutoGeneratedReady(false); }} className="p-1 hover:bg-white rounded-lg"><ChevronLeft size={16}/></button><span className="px-3 font-black text-xs w-24 text-center capitalize">{currentDate.toLocaleDateString('es-AR', {month:'long'})}</span><button onClick={() => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1)); setAutoGeneratedReady(false); }} className="p-1 hover:bg-white rounded-lg"><ChevronRight size={16}/></button></div>
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
                                        onClick={() => { setAutoV2Report(null); setShowAutoV2Modal(true); }}
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
                                <div className="flex items-center gap-0.5">
                                    <button onClick={() => setSortBy(prev => prev === 'activity' ? 'name' : prev === 'name' ? 'client' : 'activity')} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-l-xl transition-colors border border-transparent hover:border-indigo-200" title={sortBy === 'activity' ? "Ordenado por Actividad" : sortBy === 'name' ? "Ordenado por Nombre" : "Ordenado por Cliente"}>{sortBy === 'activity' ? <ArrowDownWideNarrow size={18}/> : sortBy === 'name' ? <ArrowDownAZ size={18}/> : <Briefcase size={18}/>}</button>
                                    <button onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-r-xl transition-colors border border-transparent hover:border-indigo-200" title={sortDir === 'asc' ? "Ascendente" : "Descendente"}>{sortDir === 'asc' ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
                                </div>
                                {customOrderMap[selectedObjective || '__all__'] && (
                                    <button onClick={clearCustomOrder} className="p-2 bg-indigo-100 text-indigo-600 hover:bg-rose-100 hover:text-rose-600 rounded-xl transition-colors text-[9px] font-black uppercase flex items-center gap-1" title="Hay orden personalizado — click para restablecer orden automático"><Grip size={12}/><X size={10}/></button>
                                )}
                                <button onClick={() => setForceShowAll(!forceShowAll)} className={`px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 border transition-colors ${forceShowAll ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white border-slate-200 text-slate-500'}`}>{forceShowAll ? <Eye size={14}/> : <EyeOff size={14}/>} {forceShowAll ? 'Ver Todos' : 'Dotación'}</button>
                                <button onClick={() => setShowAddModal(true)} disabled={!selectedObjective || isServiceLocked} className="bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50"><UserPlus size={14}/> Asignar</button>
                            </div>
                        </>
                    )}
                </div>

                {/* --- ÁREA PRINCIPAL DE LA GRILLA (PLANIFICACIÓN + COMPARACIÓN SPLIT VIEW) --- */}
                <div className={`flex-1 overflow-hidden relative custom-scrollbar ${isServiceLocked ? 'opacity-75 grayscale-[0.5] pointer-events-none' : ''}`}>
                    {isProcessing && <div className="absolute inset-0 bg-white/50 z-50 flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={40}/></div>}
                    
                    {!selectedObjective ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-4">
                            <CalendarX size={64}/><p className="font-bold text-lg">Seleccione Cliente y Objetivo</p>
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
                                        <History size={12}/> VERSIÓN HISTÓRICA ({new Date(comparingSnapshot.date).toLocaleString()}) - SOLO LECTURA
                                    </div>
                                    {renderGrid(true, comparingSnapshot.data)}
                                </div>
                                
                                <div className="flex items-center justify-center -my-2 z-10">
                                    <div className="bg-white p-1.5 rounded-full shadow-md border border-slate-300 text-slate-400">
                                        <ArrowDownWideNarrow size={16} />
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto border-2 border-indigo-500 bg-white rounded-xl shadow-lg relative">
                                    <div className="sticky top-0 z-50 bg-indigo-600 px-4 py-1 text-[10px] font-black text-white uppercase mb-2 flex items-center justify-center gap-2 shadow-sm">
                                        <Activity size={12}/> VERSIÓN ACTUAL (EN VIVO)
                                    </div>
                                    {renderGrid(false)}
                                </div>
                            </div>
                        ) : (
                            <div className="h-full min-h-0 overflow-y-auto overflow-x-auto custom-scrollbar">
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
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] bg-slate-800 text-white p-2 rounded-2xl shadow-2xl flex gap-1 animate-in zoom-in-95 items-center border border-slate-600 no-print">
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
                    const empCount = Object.values(sourceHours).filter((v: any) => v > 0).length;
                    const hsLabel = hoursMode === 'cct' ? 'Hs. CCT' : 'Hs. Plan.';
                    const hsTitle = hoursMode === 'cct'
                        ? 'Suma del ciclo CCT actual (cola del mes anterior 26..fin + días 1..25 del mes activo). Solo turnos publicados de este objetivo, sin RET/francos/licencias.'
                        : 'Suma de horas planificadas en el mes calendario para este objetivo (sin RET, francos ni licencias). Compará con Vendidas del SLA.';
                    return (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm shrink-0 no-print px-3 py-2 flex items-center gap-3 divide-x divide-slate-100 dark:divide-slate-700">
                        <div className="text-center pr-3" title={hoursMode === 'cct' ? 'Empleados con horas en el ciclo CCT actual.' : 'Empleados con horas planificadas en el mes.'}>
                            <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Empl.</p>
                            <p className="text-sm font-black text-slate-700 dark:text-slate-200 leading-tight">{empCount}</p>
                        </div>
                        <div className="text-center px-3" title={hsTitle}>
                            <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none flex items-center justify-center gap-1">
                                {hsLabel}
                                {hoursMode === 'cct' && <span className="text-[7px] text-indigo-500">CCT</span>}
                            </p>
                            <p className="text-sm font-black text-indigo-600 leading-tight">{totalHrs.toFixed(0)}</p>
                        </div>
                        {displayedEmployees.length > 0 && (
                            <div className="text-center px-3" title={hoursMode === 'cct' ? 'Promedio de horas por empleado en el ciclo CCT actual.' : 'Promedio de horas por empleado en el mes calendario.'}>
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Prom./Emp.</p>
                                <p className="text-sm font-black text-slate-500 dark:text-slate-300 leading-tight">{Math.round(totalHrs / displayedEmployees.length)}h</p>
                            </div>
                        )}
                        {retCount > 0 && (
                            <div className="text-center px-3" title={`Cantidad de celdas en RET (stand-by) en el mes. Potencial: ${retCount * 8}h activables como cobertura.`}>
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Retenes</p>
                                <p className="text-sm font-black text-amber-600 leading-tight">{retCount} <span className="text-[9px] text-amber-500 font-bold">({retCount * 8}h)</span></p>
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
                        {autoV2Coverage && (() => {
                            const hardCount = (autoV2Coverage.uncovered?.length || 0)
                                + (autoV2Coverage.restViolations?.length || 0)
                                + (autoV2Coverage.licenseConflicts?.length || 0);
                            const softCount = autoV2Coverage.overHours?.length || 0;
                            const label = autoV2Coverage.ok
                                ? '✓ Sin alertas'
                                : autoV2Coverage.warnings
                                    ? `${softCount} aviso${softCount !== 1 ? 's' : ''}`
                                    : `${hardCount} incidencia${hardCount !== 1 ? 's' : ''}`;
                            return (
                                <button
                                    onClick={() => setShowCoverageModal(true)}
                                    className="text-center px-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded transition-colors"
                                    title="Verificación de cobertura: slots descubiertos, descansos rotos, conflictos con licencias y horas vs SLA."
                                >
                                    <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Verificación</p>
                                    <p className={`text-sm font-black leading-tight underline decoration-dotted ${
                                        autoV2Coverage.ok ? 'text-emerald-600'
                                        : autoV2Coverage.warnings ? 'text-amber-600' : 'text-rose-600'
                                    }`}>{label}</p>
                                </button>
                            );
                        })()}
                        {slaVendidas > 0 && (
                            <div className="text-center pl-3">
                                <p className="text-[8px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none">Vendidas</p>
                                <p className="text-sm font-black text-teal-600 leading-tight">{slaVendidas}</p>
                            </div>
                        )}
                    </div>
                    );
                })()}

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm shrink-0 no-print overflow-hidden">
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
                        <div className="bg-white w-full max-w-3xl h-[80vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
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
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-[500px] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
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
                                // Buscar quién cubrió este turno: primero en coveredBy, luego en comments de otros turnos del mismo día
                                const coveringEmployee = shift?.coveredBy || (() => {
                                    const empName = employees.find(e => e.id === selectedCell.empId)?.name || '';
                                    const dateStr = selectedCell.dateStr;
                                    const allSources = { ...shiftsMap, ...pendingChanges };
                                    const found = Object.entries(allSources).find(([k, s]: [string, any]) =>
                                        k.endsWith(`_${dateStr}`) && !k.startsWith(`${selectedCell.empId}_`) &&
                                        s?.comments?.includes(`Cubriendo a ${empName}`)
                                    );
                                    if (!found) return null;
                                    const covEmpId = found[0].replace(`_${dateStr}`, '');
                                    const covEmp = employees.find((e: any) => e.id === covEmpId);
                                    const covShift = (found[1] as any);
                                    return covEmp ? `${covEmp.name} (${covShift.code || ''})` : null;
                                })();
                                const hasSwap = !!(shift?.swapWith || shift?.swapDate);
                                const isSwapPersisted = hasSwap && !pending && !!shift?.id;
                                const isReadOnly = isConsolidated || !!absence || isRRHHCode || isPastClosed || isSwapPersisted;

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
                                const objectiveId = (shift?.objectiveId || selectedObjective || '').toString();
                                const serviceName = shift?.objectiveName || (objectiveId ? getObjectiveName(objectiveId) : '-');
                                const storedHours = Number(shift?.hours);
                                const calcHoursFromTs = (shift?.startTime && shift?.endTime && typeof shift.startTime !== 'string')
                                    ? Math.max(0, (formatTime(shift.endTime) !== '--:--' ? (shift.endTime.toDate ? shift.endTime.toDate().getTime() : new Date(shift.endTime.seconds * 1000).getTime()) - (shift.startTime.toDate ? shift.startTime.toDate().getTime() : new Date(shift.startTime.seconds * 1000).getTime()) : 0)) / 3600000
                                    : 0;
                                const hours = storedHours || calcHoursFromTs || (code ? (SHIFT_HOURS_LOOKUP[code] || 0) : 0);
                                const coveredPosition = (shift?.positionName || activePosition || 'General').toString();
                                const showRealTimes = isConsolidated;

                                if (isReadOnly) {
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

                                                {(absence || isRRHHCode) && (
                                                    <div className="p-3 rounded-xl border bg-amber-50 border-amber-200">
                                                        <div className="text-[10px] font-black uppercase text-amber-800 mb-2">RRHH</div>
                                                        <div className="text-xs text-amber-900">
                                                            <div><span className="font-bold">Tipo</span>: {absence?.type || shift?.name || code || '—'}</div>
                                                            {absence?.status && <div className="mt-1"><span className="font-bold">Estado</span>: {absence.status}</div>}
                                                            {coveringEmployee
                                                                ? <div className="mt-2 pt-2 border-t border-amber-200 font-bold">Cubierto por: {coveringEmployee}</div>
                                                                : (absence && !shift?.isTemp) ? null
                                                                : <div className="mt-1 text-amber-700 text-[10px]">Sin cobertura asignada</div>
                                                            }
                                                            {(absence?.reason) && <div className="mt-1 text-amber-700 text-[10px]">{absence.reason}</div>}
                                                        </div>
                                                        {pending ? (
                                                            <button onClick={handleDelete} className="mt-3 w-full py-2 rounded-xl bg-white border border-amber-200 text-amber-900 font-black text-xs hover:bg-amber-100">
                                                                Quitar marca (borrador)
                                                            </button>
                                                        ) : (
                                                            <div className="mt-3 text-[10px] font-bold text-amber-800">
                                                                Esta novedad viene de RRHH (ausencias). No se edita desde Planificación.
                                                            </div>
                                                        )}
                                                        {isRRHHCode && !isPastClosed && !isConsolidated && !pending && absence && (
                                                            <button
                                                                onClick={() => {
                                                                    const vd = { ...absence, source: 'AUSENCIA', employeeId: selectedCell.empId, employeeName };
                                                                    setSelectedCell(null);
                                                                    setVacancyData(vd);
                                                                    setSelectedReplacement('');
                                                                    setShowVacancyModal(true);
                                                                }}
                                                                className="mt-2 w-full py-2 rounded-xl bg-amber-600 text-white font-black text-xs hover:bg-amber-700"
                                                            >
                                                                Re-procesar cobertura
                                                            </button>
                                                        )}
                                                        {isRRHHCode && !isPastClosed && !isConsolidated && !pending && !absence && (
                                                            <button
                                                                onClick={() => {
                                                                    const newChanges = { ...pendingChanges };
                                                                    newChanges[`${selectedCell.empId}_${selectedCell.dateStr}`] = { isDeleted: true };
                                                                    setPendingChanges(newChanges);
                                                                    setSelectedCell(null);
                                                                    toast.info('Turno marcado para borrar — guardá los cambios.');
                                                                }}
                                                                className="mt-2 w-full py-2 rounded-xl bg-slate-600 text-white font-black text-xs hover:bg-slate-700"
                                                            >
                                                                Borrar turno asignado por error
                                                            </button>
                                                        )}
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
                                const previewPublishKey = `${selectedObjective}_${currentDate.getFullYear()}_${currentDate.getMonth() + 1}`;
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
                                            <div className={`flex items-center gap-3 p-4 rounded-2xl border mb-4 ${shiftStyle}`}>
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
                                            <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Puesto / Función</label>
                                            <select 
                                                className="w-full bg-slate-50 border p-2 rounded-lg text-xs font-bold"
                                                // 🛑 V9.00 - COMPONENTE CONTROLADO
                                                value={activePosition || ''} 
                                                id="positionSelector"
                                                disabled={isServiceLocked}
                                                onChange={(e) => setActivePosition(e.target.value)}
                                            >
                                                {positionStructure.map(p => (
                                                    <option key={p.positionName} value={p.positionName}>
                                                        {p.positionName} ({p.qty} pax - Meta: {p.qty * (p.activeDays?.includes(getDayLetter(selectedCell.dateStr)) ? (p.coverageType === '24hs' ? 24 : (p.shifts?.reduce((acc:number,s:any)=>acc+(Number(s.hours)||8),0)||0)) : 0)}h)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        {(() => {
                                            const coverageData = modalCoverageStats || { current: 0, target: 24, pax: 1, isActiveDay: true };
                                            const currentPosName = activePosition || 'General';
                                            const isCovered = coverageData.current >= coverageData.target;
                                            const coverageFull = coverageData.isActiveDay && coverageData.target > 0 && isCovered;
                                            const percentage = coverageData.target > 0 ? Math.min(100, (coverageData.current / coverageData.target) * 100) : 100;
                                            const gap = coverageData.current - coverageData.target;
                                            const displayTarget = coverageData.isActiveDay ? `${coverageData.target}h` : `Sin cobertura`;
                                            const bgClass = coverageData.isActiveDay ? (isCovered ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600') : 'bg-slate-100 text-slate-500';
                                            const barColor = coverageData.isActiveDay ? (isCovered ? 'bg-emerald-500' : 'bg-rose-500') : 'bg-slate-300';
                                            return (
                                                <>
                                                    <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                                        <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Layers size={14} className="text-slate-400"/><span className="text-[10px] font-bold text-slate-500 uppercase">Cobertura {currentPosName} ({coverageData.pax} pax)</span></div><div className={`text-xs font-black px-2 py-0.5 rounded ${bgClass}`}>{coverageData.current}h / {displayTarget}</div></div>
                                                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }}></div></div>
                                                    </div>
                                                    <div className={`grid grid-cols-3 gap-2 mb-4 ${isServiceLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                                        {uniqueSLAShifts.map((s: any) => {
                                                            const isBlocked = shiftButtonDisabledMap.has(String(s.code).toUpperCase());
                                                            const disabledByCoverage = coverageFull;
                                                            const disabled = isServiceLocked || isBlocked || disabledByCoverage;
                                                            const timeRange = (s.startTime && s.endTime) ? `${s.startTime}–${s.endTime}` : null;
                                                            return (
                                                                <button
                                                                    key={s.code}
                                                                    onClick={() => !disabled && handleAssignShift(s, activePosition || 'General')}
                                                                    disabled={disabled}
                                                                    title={disabledByCoverage ? 'Cobertura completa. Solo se puede asignar Franco.' : isBlocked ? 'No se puede mezclar con turnos ya asignados en este puesto/día (solo 8h con 8h, 12h con 12h)' : undefined}
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
                                                            className="p-2 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg flex flex-col items-center justify-center font-black"
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

                {pendingAssignment && createPortal(<div className="fixed inset-0 z-[9000] bg-amber-900/40 backdrop-blur-sm flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border-2 border-amber-400 animate-in zoom-in-95"><div className="flex flex-col items-center text-center space-y-4"><div className="p-4 bg-amber-100 rounded-full text-amber-600"><AlertTriangle size={32} /></div><div><h3 className="font-black text-lg text-amber-800 uppercase">Advertencia Laboral</h3><p className="text-xs text-slate-600 mt-2 font-medium">{authWarningMessage}</p></div><div className="w-full pt-4 border-t flex gap-3"><button onClick={() => { setPendingAssignment(null); setAuthWarningMessage(''); }} className="flex-1 py-3 text-slate-500 font-bold text-xs rounded-xl hover:bg-slate-100">Cancelar</button><button onClick={() => {
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
                {showConflictModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-rose-900/20 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl shadow-2xl w-[400px] border-2 border-rose-100"><div className="text-center mb-6"><div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3"><Siren size={24}/></div><h3 className="text-lg font-black text-slate-800">Conflicto Detectado</h3><p className="text-xs text-slate-500 mt-1">Hay una superposición entre Novedad y Turno.</p></div><div className="space-y-3"><button onClick={() => resolveConflict('SPLIT')} className="w-full p-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex items-center justify-center gap-2"><Split size={16}/> Dividir Turno (Extensión + Adelanto)</button><button onClick={() => resolveConflict('FULL_COVERAGE')} className="w-full p-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-50 flex items-center justify-center gap-2"><Shield size={16}/> Cobertura Total (Franco Trabajado)</button><button onClick={() => setShowConflictModal(false)} className="w-full p-3 text-slate-400 font-bold text-xs hover:text-slate-600">Cancelar</button></div></div></div>)}
                {showSwapModal && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-[500px]">
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
                {showAddModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)}><div className="bg-white p-6 rounded-2xl shadow-2xl w-[420px]" onClick={e => e.stopPropagation()}><h3 className="font-black text-lg mb-1">Asignar Colaborador</h3><p className="text-xs text-slate-400 font-bold mb-4">Seleccionar cambia el objetivo preferido del colaborador a <span className="text-indigo-600">{getObjectiveName(selectedObjective)}</span>.</p><input autoFocus className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl mb-4 text-sm font-bold" placeholder="Escriba nombre..." value={addSearchTerm} onChange={e => setAddSearchTerm(e.target.value)}/><div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">{employees.filter(e => e.name.toLowerCase().includes(addSearchTerm.toLowerCase())).map(emp => { const alreadyAssigned = emp.preferredObjectiveId === selectedObjective; return (<button key={emp.id} onClick={async () => { if (!emp.id) return; await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective }); setAddSearchTerm(''); setShowAddModal(false); toast.success(`${emp.name} asignado a ${getObjectiveName(selectedObjective)}`); }} className="w-full p-3 text-left hover:bg-indigo-50 rounded-lg flex items-center gap-3 text-sm font-medium text-slate-700 group"><div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-black text-xs text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600">{emp.name.substring(0,2)}</div><div className="flex-1 min-w-0"><div className="font-bold truncate">{emp.name}</div>{alreadyAssigned && <div className="text-[10px] text-emerald-600 font-black">Ya asignado aquí</div>}</div>{alreadyAssigned && <CheckCircle size={14} className="text-emerald-500 shrink-0"/>}</button>); })}</div></div></div>)}
                {showVacancyModal && (() => {
                    const absType = vacancyData?.type || '';
                    const isVac = absType === 'Vacaciones';
                    const isEnf = absType === 'Enfermedad' || absType === 'ART';
                    const isPG = absType === 'PG Permiso Gremial';
                    const isLic = absType === 'Licencia Esp.' || isPG;
                    const isInj = absType === 'Injustificada';
                    const color = isVac ? 'teal' : isEnf ? 'rose' : isPG ? 'blue' : isLic ? 'purple' : 'amber';
                    const colorMap: any = { teal: 'border-l-teal-500 bg-teal-50 text-teal-700', rose: 'border-l-rose-500 bg-rose-50 text-rose-700', purple: 'border-l-purple-500 bg-purple-50 text-purple-700', blue: 'border-l-blue-500 bg-blue-50 text-blue-700', amber: 'border-l-amber-500 bg-amber-50 text-amber-700' };
                    const btnColor: any = { teal: 'bg-teal-600 hover:bg-teal-700 shadow-teal-200', rose: 'bg-rose-600 hover:bg-rose-700 shadow-rose-200', purple: 'bg-purple-600 hover:bg-purple-700 shadow-purple-200', blue: 'bg-blue-600 hover:bg-blue-700 shadow-blue-200', amber: 'bg-amber-500 hover:bg-amber-600 shadow-amber-200' };
                    const title = isVac ? 'Vacaciones — Planificar Cobertura' : isEnf ? 'Ausencia Médica — Cobertura Temporal' : isPG ? 'PG Permiso Gremial — Planificar Cobertura' : isLic ? 'Licencia Especial — Planificar Cobertura' : 'Ausencia Injustificada — Gestionar';
                    const hint = isVac ? 'Seleccioná quién cubrirá los turnos durante el período de vacaciones, o dejá el puesto vacante.' : isEnf ? 'Podés asignar cobertura temporal o dejar vacante según la dotación disponible.' : isPG ? 'Permiso Gremial pago — el turno se libera pero las horas computan. Asigná cobertura o dejá vacante.' : isLic ? 'Asigná un reemplazo para el período de licencia o dejá vacante.' : 'Podés asignar cobertura o dejar el puesto vacante para gestión desde Operaciones.';
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
                            if (OBJECTIVE_NON_BILLABLE_CODES.has(String(sh.code).toUpperCase())) continue;
                            h += calcShiftHours(sh);
                        }
                        return h;
                    };
                    // Clasificar disponibilidad en la fecha de la ausencia
                    const NON_AVAILABLE = new Set(['F','FF','FT','V','L','PG','A','E','AA','PAST','LOCKED']);
                    const getEmpStatusOnDate = (empId: string): 'RETEN' | 'FREE' | 'WORKING' => {
                        const key = `${empId}_${vacancyData?.startDate}`;
                        const s = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
                        if (!s || s.isDeleted) return 'FREE';
                        if (s.code === 'RET') return 'RETEN';
                        if (NON_AVAILABLE.has(s.code)) return 'FREE'; // franco/ausente: también disponible
                        return 'WORKING';
                    };
                    // IDs del objetivo: preferredObjectiveId o alias SLA
                    const objectiveEmpIds = new Set(
                        employees
                            .filter((e: any) => e.preferredObjectiveId === selectedObjective || slaIdToObjId[e.preferredObjectiveId] === selectedObjective)
                            .map((e: any) => e.id)
                    );
                    const candidatos = employees
                        .filter(e => e.id !== vacancyData?.employeeId)
                        .map(e => ({ ...e, monthHours: getEmpMonthHours(e.id), dayStatus: getEmpStatusOnDate(e.id), isObjectiveGuard: objectiveEmpIds.has(e.id) }))
                        .sort((a, b) => a.monthHours - b.monthHours);
                    // Orden: 1° objetivo, 2° retenes externos, 3° sin turno externos, 4° con horas, 5° resto
                    const objetivoCandidatos = candidatos.filter(e => e.isObjectiveGuard);
                    const retenCandidatos = candidatos.filter(e => !e.isObjectiveGuard && e.dayStatus === 'RETEN');
                    const sinTurnoCandidatos = candidatos.filter(e => !e.isObjectiveGuard && e.dayStatus === 'FREE');
                    const retCandidatos = candidatos.filter(e => !e.isObjectiveGuard && e.dayStatus === 'WORKING' && e.monthHours < (e.maxHours||200) - 16);
                    const restoCandidatos = candidatos.filter(e => !e.isObjectiveGuard && e.dayStatus === 'WORKING' && e.monthHours >= (e.maxHours||200) - 16);
                    return (
                    <div className="fixed inset-0 z-[70] flex items-end justify-end p-6 bg-black/25 backdrop-blur-[2px]">
                        <div className={`bg-white p-6 rounded-2xl shadow-2xl w-[520px] border-l-4 ${colorMap[color].split(' ')[0]}`}>
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <h3 className="font-black text-lg text-slate-800">{title}</h3>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        <span className="font-bold text-slate-700">{vacancyData?.employeeName}</span>
                                        {vacancyData?.startDate && <span className="ml-2 text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">{vacancyData.startDate} → {vacancyData.endDate}</span>}
                                    </p>
                                </div>
                                <span className={`text-[10px] font-black px-2 py-1 rounded-full ${colorMap[color]}`}>{absType}</span>
                            </div>
                            <p className="text-xs text-slate-400 mb-4">{hint}</p>
                            <div className="bg-slate-50 p-4 rounded-xl border mb-5">
                                <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">
                                    {isInj ? 'Asignar cobertura (opcional)' : 'Seleccionar suplente'}
                                </label>
                                <select className="w-full p-3 rounded-lg border text-sm font-bold bg-white" value={selectedReplacement} onChange={e => setSelectedReplacement(e.target.value)}>
                                    <option value="">Sin cobertura — dejar vacante</option>
                                    {objetivoCandidatos.length > 0 && <optgroup label={`🏢 Guardias del objetivo (${objetivoCandidatos.length})`}>
                                        {objetivoCandidatos.map(e => <option key={e.id} value={e.id}>{e.name} — {e.monthHours}h este mes{e.dayStatus === 'RETEN' ? ' ★ Retén' : e.dayStatus === 'FREE' ? ' ◎ Libre hoy' : ''}</option>)}
                                    </optgroup>}
                                    {retenCandidatos.length > 0 && <optgroup label={`🔶 RETÉN externo — En disponibilidad (${retenCandidatos.length})`}>
                                        {retenCandidatos.map(e => <option key={e.id} value={e.id}>★ {e.name} — Retén ({e.monthHours}h)</option>)}
                                    </optgroup>}
                                    {sinTurnoCandidatos.length > 0 && <optgroup label={`🟢 Sin turno hoy — disponibles (${sinTurnoCandidatos.length})`}>
                                        {sinTurnoCandidatos.map(e => <option key={e.id} value={e.id}>◎ {e.name} — Libre ({e.monthHours}h)</option>)}
                                    </optgroup>}
                                    {retCandidatos.length > 0 && <optgroup label={`Con horas disponibles (${retCandidatos.length})`}>
                                        {retCandidatos.map(e => <option key={e.id} value={e.id}>{e.name} — {e.monthHours}h ({(e.maxHours||200) - e.monthHours}h libres)</option>)}
                                    </optgroup>}
                                    {restoCandidatos.length > 0 && <optgroup label={`Resto del personal (${restoCandidatos.length})`}>
                                        {restoCandidatos.map(e => <option key={e.id} value={e.id}>{e.name} — {e.monthHours}h</option>)}
                                    </optgroup>}
                                </select>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => { setShowVacancyModal(false); setVacancyData(null); }} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-50 rounded-xl border">Cancelar</button>
                                <button onClick={handleProcessVacancy} className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg ${btnColor[color]}`}>
                                    {selectedReplacement ? 'Asignar reemplazo' : 'Marcar vacante'}
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-400 text-center mt-3">Los cambios quedan pendientes — recordá guardar el cronograma.</p>
                        </div>
                    </div>
                    );
                })()}
                {showRRHHModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl shadow-2xl w-[400px]"><h3 className="font-black text-lg mb-4">Registrar Novedad RRHH</h3><div className="space-y-4"><div><label className="text-xs font-bold text-slate-500 block mb-1">Tipo de Novedad</label><select className="w-full border p-2 rounded-lg" value={rrhhData.type} onChange={e => setRrhhData({...rrhhData, type: e.target.value})}><option>Vacaciones</option><option>Enfermedad</option><option>ART</option><option>Injustificada</option><option>Licencia Esp.</option></select></div><div><label className="text-xs font-bold text-slate-500 block mb-1">Detalle / Motivo</label><textarea className="w-full border p-2 rounded-lg h-24 text-sm" value={rrhhData.reason} onChange={e => setRrhhData({...rrhhData, reason: e.target.value})} placeholder="Especifique el motivo..."></textarea></div><button onClick={handleRRHHSubmit} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Guardar Novedad</button><button onClick={() => setShowRRHHModal(false)} className="w-full text-slate-400 text-xs font-bold py-2">Cancelar</button></div></div></div>)}
                {showHistoryModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistoryModal(false)}><div className="bg-white w-full max-w-3xl h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}><div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-black text-lg flex items-center gap-2"><History className="text-indigo-600"/> Historial de Versiones</h3><button onClick={() => setShowHistoryModal(false)}><X size={20}/></button></div><div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">{historyVersions.map(v => (<div key={v.id} className="border p-4 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-colors group"><div><p className="font-black text-slate-800 text-sm">{new Date(v.timestamp.seconds*1000).toLocaleString()}</p><p className="text-xs text-slate-500 font-mono mt-1">Modificado por: <span className="font-bold text-indigo-600">{v.user}</span></p><div className="mt-2 flex gap-2"><span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-600 border border-slate-200">{v.count} cambios</span></div></div><button onClick={() => handleViewSnapshot(v)} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all">Ver Versión</button></div>))}{historyVersions.length === 0 && <div className="text-center text-slate-400 py-10">No hay versiones guardadas para este periodo.</div>}</div></div></div>)}

                {/* MODAL AUTORIZACIÓN SUPERVISOR 200H */}
                {authModal.pendingFn && createPortal(
                    <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
                        <div className="bg-white dark:bg-slate-800 rounded-3xl w-full max-w-md p-8 shadow-2xl animate-in zoom-in-95 border dark:border-slate-700">
                            <div className="text-center mb-6">
                                <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
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

                            <div className="mb-6">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2 text-center">PIN de Supervisor</label>
                                <input
                                    autoFocus
                                    type="password"
                                    maxLength={4}
                                    inputMode="numeric"
                                    placeholder="••••"
                                    value={authPin}
                                    onChange={e => { setAuthPin(e.target.value.replace(/\D/g,'').slice(0,4)); setAuthError(''); }}
                                    className="w-full text-center text-3xl font-black tracking-[0.6em] bg-slate-50 dark:bg-slate-700 border-2 border-slate-200 dark:border-slate-600 focus:border-indigo-500 outline-none dark:text-white rounded-2xl px-4 py-4"
                                />
                                {authError && <p className="text-rose-600 text-xs font-bold text-center mt-2">{authError}</p>}
                            </div>

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
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-[860px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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

                {/* ── Modal verificación de cobertura post-generación ── */}
                {showCoverageModal && autoV2Coverage && createPortal(
                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCoverageModal(false)}>
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-[900px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                                        : `Se detectaron ${autoV2Coverage.uncovered.length} slots, ${autoV2Coverage.restViolations.length} descansos y ${autoV2Coverage.licenseConflicts.length} conflictos. Probá "Reprocesar" para aplicarles fixes automáticos.`}
                                </div>
                                <div className="flex gap-2">
                                    {!autoV2Coverage.ok && autoV2LastRun && (
                                        <button
                                            onClick={reprocessAutoIssues}
                                            disabled={autoV2Fixing}
                                            className="px-5 py-2 rounded-xl text-sm font-black text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                            title="Intenta resolver iterativamente los errores: swap de descansos rotos contra RETs disponibles, llena slots con RETs del mismo grupo, reemplaza turnos sobre licencias."
                                        >
                                            {autoV2Fixing ? 'Reprocesando…' : '↻ Reprocesar errores'}
                                        </button>
                                    )}
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
                        <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-6 pb-2">
                            <h3 className="font-black text-lg mb-1 flex items-center gap-2 flex-wrap">
                                <Wand2 size={20} className="text-amber-600 shrink-0"/>
                                <span className="text-slate-800">Automatizar cronograma</span>
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">COSP</span>
                            </h3>
                            <p className="text-xs text-slate-400 font-medium mb-4">
                                Primero se calcula la <strong>viabilidad</strong> (dotación, CCT 200h, SLA). Si no cierra, ves el diagnóstico y no se modifica la grilla. Si cierra, podés <strong>generar</strong> el mes en pendientes (revisá antes de guardar).
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-wide mb-2 block">Esquema de ciclo (4+2, 6+1, etc.)</label>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {['4+2','5+1','6+1','6+2'].map(key => {
                                            const checked = autoCycles.includes(key);
                                            return (
                                                <button key={key} type="button"
                                                    onClick={() => setAutoCycles(prev => checked ? prev.filter(c => c!==key) : [...prev, key])}
                                                    className={`py-1.5 rounded-lg text-xs font-black border-2 transition-colors ${checked ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}>
                                                    {key}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {autoCycles.length === 0 && <p className="text-[11px] text-red-500 font-bold mt-1">Seleccioná al menos un esquema.</p>}
                                </div>

                                <div>
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-wide mb-2 block">Cupo del empleado</label>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <button type="button" onClick={() => setAutoV2BudgetMode('cct')}
                                            className={`py-1.5 rounded-lg text-[11px] font-black border-2 transition-colors text-left px-2 ${autoV2BudgetMode==='cct' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                                            CCT por tramos
                                            <div className={`text-[9px] font-bold ${autoV2BudgetMode==='cct' ? 'text-amber-600' : 'text-slate-400'}`}>1→25 con cola + 26→fin ciclo nuevo</div>
                                        </button>
                                        <button type="button" onClick={() => setAutoV2BudgetMode('calendar')}
                                            className={`py-1.5 rounded-lg text-[11px] font-black border-2 transition-colors text-left px-2 ${autoV2BudgetMode==='calendar' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                                            Calendario simple
                                            <div className={`text-[9px] font-bold ${autoV2BudgetMode==='calendar' ? 'text-amber-600' : 'text-slate-400'}`}>200h netas por persona (sin cola)</div>
                                        </button>
                                    </div>
                                </div>

                                <button onClick={generateAutoScheduleV2} disabled={autoV2Loading || autoCycles.length === 0}
                                    className="w-full py-2.5 rounded-xl text-sm font-black text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                    {autoV2Loading ? <><Loader2 size={14} className="animate-spin"/> Analizando viabilidad...</> : <>Calcular viabilidad</>}
                                </button>

                                {autoV2Report && (
                                    <div className={`rounded-xl p-3 border-2 ${autoV2Report.ok ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
                                        <p className={`text-sm font-black mb-1 ${autoV2Report.ok ? 'text-emerald-800' : 'text-rose-800'}`}>
                                            {autoV2Report.ok ? '✓ Plan viable' : '✗ Plan NO viable'}
                                        </p>
                                        {autoV2Report.ok && autoV2Report.warnings?.length > 0 && (
                                            <p className="text-[10px] font-bold text-emerald-900/80 mb-2">
                                                Hay avisos abajo en amarillo: son informativos y no cambian el resultado viable.
                                            </p>
                                        )}

                                        {/* Métricas en bloques claros */}
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Horas a cubrir (SLA)</div>
                                                <div className="text-base font-black text-indigo-700">{Math.round(autoV2Report.metrics.contractedHours)}<span className="text-xs">h</span></div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Cobertura disponible</div>
                                                <div className={`text-base font-black ${autoV2Report.metrics.offerHours >= autoV2Report.metrics.effectiveTargetHours ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                    {Math.round(autoV2Report.metrics.offerHours)}<span className="text-xs">h</span>
                                                </div>
                                                {(() => {
                                                    const diff = autoV2Report.metrics.offerHours - autoV2Report.metrics.effectiveTargetHours;
                                                    return (
                                                        <div className={`text-[9px] font-black mt-0.5 ${diff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {diff >= 0 ? `+${Math.round(diff)}h sobrantes` : `${Math.round(diff)}h faltantes`}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Mín. personas (horas ÷ 192 promedio)</div>
                                                <div className={`text-base font-black ${autoV2Report.metrics.peopleAvailable >= autoV2Report.metrics.peopleNeededForTarget ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                    {autoV2Report.metrics.peopleNeededForTarget}
                                                </div>
                                                <div className="text-[9px] text-slate-400 font-bold mt-0.5">Sugerido ciclo {autoV2Report.metrics.cycleUsed}: ~{autoV2Report.metrics.peopleSuggestedWithCycle}</div>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-200">
                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Personas disponibles</div>
                                                <div className="text-base font-black text-slate-800">{autoV2Report.metrics.peopleAvailable}</div>
                                                {(() => {
                                                    const idle = autoV2Report.metrics.idleEmployees ?? 0;
                                                    if (idle <= 0) return (
                                                        <div className="text-[9px] text-slate-400 font-bold mt-0.5">Sin capacidad ociosa</div>
                                                    );
                                                    return (
                                                        <div className="text-[9px] font-black text-amber-600 mt-0.5" title="Empleados que sobran tras cubrir todos los puestos. Quedarán todo el mes en RET / Franco, sin turnos salpicados.">
                                                            Capacidad ociosa: {idle} → RET / F mes entero
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {autoV2BudgetMode === 'cct' ? (
                                            <div className="bg-white border border-slate-200 rounded-lg p-2 mb-2">
                                                <div className="text-[9px] font-black uppercase text-slate-500 mb-1">Oferta por tramo del ciclo CCT (corte día {autoV2Report.metrics.cctCutoffDay} · tope 200h por ciclo)</div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="text-[10px] font-bold text-slate-700">
                                                        Tramo 1→{autoV2Report.metrics.cctCutoffDay} (ciclo en curso)<br/>
                                                        <span className="text-base font-black text-slate-900">{Math.round(autoV2Report.metrics.offerHoursCurrentCycle)}h</span>
                                                        <span className="text-[9px] font-bold text-slate-400 ml-1">(tope 200h − cola)</span>
                                                    </div>
                                                    <div className="text-[10px] font-bold text-slate-700">
                                                        Tramo {autoV2Report.metrics.cctCutoffDay+1}→fin (ciclo siguiente)<br/>
                                                        <span className="text-base font-black text-slate-900">{Math.round(autoV2Report.metrics.offerHoursNextCycle)}h</span>
                                                        <span className="text-[9px] font-bold text-slate-400 ml-1">(arranca de cero)</span>
                                                    </div>
                                                </div>
                                                <div className="text-[9px] text-slate-400 font-bold mt-1">
                                                    Cola CCT equipo (Σ): {Math.round(autoV2Report.metrics.totalPriorHoursTeam)}h ·
                                                    Ausencias est. (Σ): {Math.round(autoV2Report.metrics.totalAbsenceHoursTeam)}h
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-[10px] text-slate-500 font-bold mb-2">
                                                Modo calendario: 200h netas por persona en el mes, sin descontar cola CCT.
                                                Ausencias est. (Σ): <span className="text-slate-800">{Math.round(autoV2Report.metrics.totalAbsenceHoursTeam)}h</span>
                                            </p>
                                        )}
                                        <div className="text-[9px] font-bold text-slate-600 mb-1">
                                            Todos los cálculos son solo del mes en pantalla:{' '}
                                            <span className="text-slate-900 font-black capitalize">
                                                {currentDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
                                            </span>
                                            . No se suman horas de otros meses (Mayo + Junio, etc.).
                                        </div>
                                        <div className="text-[10px] font-bold text-slate-500 mb-2 flex flex-wrap gap-x-3 gap-y-1">
                                            <span>Demanda estructural (solo ese mes): <span className="text-slate-800">{Math.round(autoV2Report.metrics.structuralDemandHours)}h</span></span>
                                            <span>Pico simultáneo: <span className="text-slate-800">{autoV2Report.metrics.peakConcurrent}</span></span>
                                            <span>Req. para 100% estructura: <span className="text-slate-800">{autoV2Report.metrics.peopleNeededForStructure}</span></span>
                                            <span className="font-black text-indigo-700">Turnos a cubrir: <span>{autoV2Report.metrics.totalSlotsAll}</span></span>
                                        </div>

                                        {autoV2Report.metrics.cycleComparison && autoV2Report.metrics.cycleComparison.length > 0 && (
                                            <div className="mb-3">
                                                <div className="text-[10px] font-black uppercase text-slate-600 mb-1">Dotación por esquema de ciclo</div>
                                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                    <table className="w-full text-[10px]">
                                                        <thead className="bg-slate-100">
                                                            <tr className="text-slate-600">
                                                                <th className="text-left px-2 py-1 font-black">Ciclo</th>
                                                                <th className="text-right px-2 py-1 font-black">Personas</th>
                                                                <th className="text-right px-2 py-1 font-black">Hs/persona</th>
                                                                <th className="text-right px-2 py-1 font-black">Colchón</th>
                                                                <th className="text-right px-2 py-1 font-black">RETs est.</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="bg-white">
                                                            {autoV2Report.metrics.cycleComparison.map(c => {
                                                                const isSelected = autoV2Report.metrics.cycleUsed === c.cycleKey;
                                                                const bufferOk = c.bufferHours >= 0;
                                                                return (
                                                                    <tr key={c.cycleKey} className={`border-t border-slate-100 ${isSelected ? 'bg-indigo-50' : ''}`}>
                                                                        <td className={`px-2 py-0.5 font-black ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>{c.cycleKey}{isSelected ? ' ✓' : ''}</td>
                                                                        <td className="text-right px-2 py-0.5 font-bold text-slate-800">{c.structuralPeakPeople}</td>
                                                                        <td className="text-right px-2 py-0.5 text-slate-600">{c.hrsPerPerson}h</td>
                                                                        <td className={`text-right px-2 py-0.5 font-bold ${bufferOk ? 'text-emerald-700' : 'text-rose-700'}`}>{c.bufferHours >= 0 ? '+' : ''}{c.bufferHours}h</td>
                                                                        <td className="text-right px-2 py-0.5 text-slate-600">{c.retEstimate}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div className="text-[9px] text-slate-400 mt-0.5">Personas = pico simultáneo × factor ciclo. Colchón = capacidad − demanda estructural. RETs est. = colchón / hs turno.</div>
                                            </div>
                                        )}

                                        {autoV2Report.metrics.cctSchemeCalendarProjection && (
                                            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2 mb-2">
                                                <div className="text-[10px] font-black uppercase text-indigo-900 mb-1">
                                                    Proyección calendario 2026 — {autoV2Report.metrics.cctSchemeCalendarProjection.monthNameEs}
                                                </div>
                                                <table className="w-full text-[10px]">
                                                    <thead>
                                                        <tr className="text-indigo-800">
                                                            <th className="text-left px-1 py-0.5 font-black">Ciclo</th>
                                                            <th className="text-right px-1 py-0.5 font-black">Días</th>
                                                            <th className="text-right px-1 py-0.5 font-black">Hs mes</th>
                                                            <th className="text-left px-1 py-0.5 font-black">Estado</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {autoV2Report.metrics.cctSchemeCalendarProjection.rows.map((r) => (
                                                            <tr key={r.cycleKey} className="border-t border-indigo-100">
                                                                <td className="px-1 py-0.5 font-bold text-indigo-950">{r.cycleKey}</td>
                                                                <td className="text-right px-1 py-0.5 text-indigo-900">{r.workDays}</td>
                                                                <td className="text-right px-1 py-0.5 font-black text-indigo-950">{r.billableHours}h</td>
                                                                <td className="px-1 py-0.5 text-indigo-900 font-bold">
                                                                    {r.overHardCap ? '>200h ref. cal.' : r.overSoftWarn ? 'Alerta ref. cal.' : 'OK ref.'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                <p className="text-[9px] text-indigo-800/90 mt-1 leading-snug">
                                                    Referencia de carga si todo el mes se trabajara a ritmo del esquema; el tope operativo del motor sigue siendo el ciclo CCT (corte día {autoV2Report.metrics.cctCutoffDay}) más la cola por persona.
                                                </p>
                                            </div>
                                        )}

                                        {autoV2Report.warnings && autoV2Report.warnings.length > 0 && (
                                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2">
                                                <div className="text-[10px] font-black uppercase text-amber-800 mb-1">Avisos (no bloquean)</div>
                                                <p className="text-[9px] font-bold text-amber-800/90 mb-1.5">Opcional: mejoran datos o comodidad; no hace falta “arreglar” nada para seguir planificando.</p>
                                                <ul className="list-disc list-inside space-y-1 text-[11px] font-bold text-amber-900">
                                                    {autoV2Report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                                </ul>
                                            </div>
                                        )}

                                        {autoV2Report.reasons.length > 0 && (
                                            <div className="bg-white border border-rose-200 rounded-lg p-2">
                                                <div className="text-[10px] font-black uppercase text-rose-700 mb-1">Bloqueos</div>
                                                <ul className="list-disc list-inside space-y-1 text-[11px] font-bold text-rose-800">
                                                    {autoV2Report.reasons.map((r, i) => <li key={i}>{r}</li>)}
                                                </ul>
                                            </div>
                                        )}

                                        {autoV2Report.perEmployee.length > 0 && (
                                            <details className="mt-3" open={autoV2ShowEmpDetail} onToggle={(e:any) => setAutoV2ShowEmpDetail(e.currentTarget.open)}>
                                                <summary className="cursor-pointer text-[11px] font-black text-slate-900">Detalle por empleado ({autoV2Report.perEmployee.length})</summary>
                                                <div className="max-h-48 overflow-y-auto mt-2 border border-slate-300 rounded-lg bg-white">
                                                    <table className="w-full text-[10px]">
                                                        <thead className="bg-slate-100 sticky top-0">
                                                            <tr className="text-slate-700">
                                                                <th className="text-left px-2 py-1 font-black">Empleado</th>
                                                                <th className="text-right px-2 py-1 font-black">Cola</th>
                                                                <th className="text-right px-2 py-1 font-black">Aus.</th>
                                                                <th className="text-right px-2 py-1 font-black" title="Oferta tramo ciclo actual (1→cutoff)">Ofer. T1</th>
                                                                <th className="text-right px-2 py-1 font-black" title="Oferta tramo ciclo siguiente (cutoff+1→fin)">Ofer. T2</th>
                                                                <th className="text-right px-2 py-1 font-black">Total</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="bg-white">
                                                            {[...autoV2Report.perEmployee]
                                                                .sort((a,b) => a.availableHours - b.availableHours)
                                                                .map(e => (
                                                                <tr key={e.id} className="border-t border-slate-100">
                                                                    <td className="px-2 py-0.5 text-slate-900 font-bold truncate max-w-[160px]">{e.nombre || e.id}</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{Math.round(e.priorHours)}h</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{e.absenceDays}</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{Math.round(e.availableCurrentCycle)}h</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{Math.round(e.availableNextCycle)}h</td>
                                                                    <td className={`text-right px-2 py-0.5 font-black ${e.availableHours >= 160 ? 'text-emerald-700' : e.availableHours >= 100 ? 'text-amber-700' : 'text-rose-700'}`}>{Math.round(e.availableHours)}h</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </details>
                                        )}

                                        {autoV2Report.perPosition.length > 0 && (
                                            <details className="mt-2">
                                                <summary className="cursor-pointer text-[11px] font-black text-slate-900">Detalle por puesto</summary>
                                                <div className="mt-2 border border-slate-300 rounded-lg bg-white overflow-hidden">
                                                    <table className="w-full text-[10px]">
                                                        <thead className="bg-slate-100">
                                                            <tr className="text-slate-700">
                                                                <th className="text-left px-2 py-1 font-black">Puesto</th>
                                                                <th className="text-right px-2 py-1 font-black text-slate-500">Días</th>
                                                                <th className="text-right px-2 py-1 font-black text-indigo-700">Turnos</th>
                                                                <th className="text-right px-2 py-1 font-black">Horas</th>
                                                                <th className="text-right px-2 py-1 font-black">Pico</th>
                                                                <th className="text-right px-2 py-1 font-black">Personas</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="bg-white">
                                                            {autoV2Report.perPosition.map(p => (
                                                                <tr key={p.positionName} className="border-t border-slate-100">
                                                                    <td className="px-2 py-0.5 text-slate-900 font-bold">{p.positionName}</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-500 font-bold">{p.activeDays}</td>
                                                                    <td className="text-right px-2 py-0.5 font-black text-indigo-700">{p.totalSlots}</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{Math.round(p.monthHours)}</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{p.peakConcurrent}</td>
                                                                    <td className="text-right px-2 py-0.5 text-slate-700 font-bold">{p.peopleNeededWithCycle}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 border-t border-slate-200 pt-3">
                                <button
                                    type="button"
                                    onClick={fetchSlaDebug}
                                    disabled={slaDebugLoading || !selectedObjective}
                                    className="text-[11px] font-black text-slate-500 hover:text-slate-800 underline disabled:opacity-50"
                                >
                                    {slaDebugLoading ? 'Cargando JSON…' : '🔧 Ver JSON del SLA del mes en pantalla'}
                                </button>
                                {slaDebug && (
                                    <div className="mt-2 bg-slate-900 text-slate-100 text-[10px] rounded-lg p-2 max-h-72 overflow-y-auto">
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
                            </div>
                            </div>

                            <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-4 space-y-3 rounded-b-2xl">
                            {(autoV2Loading || autoV2Generating) && (
                                <div className="rounded-xl bg-slate-900 px-4 py-3 text-white shadow-inner ring-1 ring-slate-700/80" role="progressbar" aria-valuenow={Math.round(autoV2Progress?.pct ?? 0)} aria-valuemin={0} aria-valuemax={100} aria-label={autoV2Progress?.label || 'Procesando'}>
                                    <div className="flex justify-between items-center mb-2 gap-2">
                                        <span className="text-[11px] font-black uppercase tracking-wide text-amber-300 shrink-0">Progreso</span>
                                        <span className="text-[11px] font-mono font-bold text-slate-300">{Math.round(autoV2Progress?.pct ?? 0)}%</span>
                                    </div>
                                    <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden mb-2">
                                        <div
                                            className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out ${
                                                autoV2Generating ? 'from-emerald-500 to-emerald-300' : 'from-amber-500 to-amber-300'
                                            }`}
                                            style={{ width: `${Math.min(100, Math.max(0, autoV2Progress?.pct ?? 3))}%` }}
                                        />
                                    </div>
                                    <p className="text-[11px] font-medium text-slate-300 leading-snug">{autoV2Progress?.label ?? 'Procesando…'}</p>
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowAutoV2Modal(false)}
                                    disabled={autoV2Loading || autoV2Generating}
                                    title={autoV2Loading || autoV2Generating ? 'Esperá a que termine el proceso' : undefined}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Cerrar
                                </button>
                                <button
                                    onClick={applyAutoScheduleV2}
                                    disabled={!autoV2Report?.ok || autoV2Generating}
                                    title={autoV2Report?.ok ? 'Generar plan respetando 200h por ciclo CCT' : 'Calculá viabilidad y debe dar VIABLE'}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {autoV2Generating ? <><Loader2 size={14} className="animate-spin"/> Generando…</> : <>Generar cronograma</>}
                                </button>
                            </div>
                            </div>
                        </div>
                    </div>
                , document.body)}

            </div>

        </DashboardLayout>
    );
}
