import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { 
    ChevronLeft, ChevronRight, Search, Plus, 
    Users, Clock, X, UserPlus, ArrowRight, Eye, EyeOff, 
    CheckCircle, Trash2, ShieldAlert, User, Briefcase, Layers,
    Bell, CalendarX, Loader2, Stethoscope, MapPin, Lock, ShieldCheck, UserMinus,
    Save, Undo, History, MousePointer2, AlertTriangle, Grip, LayoutGrid, MonitorPlay,
    Printer, Download, Grid, RefreshCw, Edit3, Shield, ArrowRightCircle, Info, ArrowDownWideNarrow, ArrowDownAZ,
    BadgePercent, ArrowLeftRight, CalendarSearch, CheckSquare, XCircle, Search as SearchIcon, RefreshCcw, UserCheck, Map, Split, Ban,
    FastForward, Rewind, AlertOctagon, Siren, FileText, Fingerprint, CalendarCheck, HelpCircle, MousePointerClick, Check, Database, Activity,
    PowerOff, LockKeyhole, Ghost
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth'; 
import { collection, onSnapshot, addDoc, deleteDoc, doc, query, orderBy, limit, serverTimestamp, Timestamp, where, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';

// --- CONFIGURACIÓN VISUAL ---
const SHIFT_STYLES: any = {
    'M': 'bg-blue-100 text-blue-700 border-blue-200',
    'T': 'bg-orange-100 text-orange-700 border-orange-200',
    'N': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'D12': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'N12': 'bg-purple-100 text-purple-700 border-purple-200',
    'F': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'PU': 'bg-pink-100 text-pink-700 border-pink-200',
    'A': 'bg-red-100 text-red-700 border-red-300 font-black pattern-diagonal',        
    'V': 'bg-teal-600 text-white border-teal-700 font-black shadow-sm',
    'L': 'bg-purple-100 text-purple-700 border-purple-300 font-black', 
    'E': 'bg-rose-100 text-rose-700 border-rose-300 font-black',    
    'AA': 'bg-amber-100 text-amber-700 border-amber-300',
    'LOCKED': 'bg-slate-200 text-slate-500 border-slate-300 pattern-grid',
    'PAST': 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed',
    'C': 'bg-slate-100 text-slate-600 border-slate-300 font-bold opacity-90',
    'FT': 'bg-violet-600 text-white border-violet-700 font-black shadow-sm',
    'FF': 'bg-cyan-600 text-white border-cyan-700 font-black shadow-sm',
    'SWAP': 'bg-cyan-50 text-cyan-700 border-cyan-300 border-dashed font-bold'
};

const LEGEND_DESCRIPTIONS: Record<string, string> = {
    'M': 'Turno Mañana (Estándar)',
    'T': 'Turno Tarde (Estándar)',
    'N': 'Turno Noche (Estándar)',
    'D12': 'Jornada Diurna 12hs',
    'N12': 'Jornada Nocturna 12hs',
    'F': 'Franco Compensatorio',
    'PU': 'Puesto Único / Especial',
    'A': 'Ausente (Sin Aviso)',
    'V': 'Vacaciones',
    'L': 'Licencia (Gremial/Otras)',
    'E': 'Enfermedad / Médico',
    'AA': 'Ausencia con Aviso',
    'LOCKED': 'Bloqueado (Cerrado/Pasado)',
    'PAST': 'Fecha Pasada',
    'C': 'Turno Consolidado (Fichado)',
    'FT': 'Franco Trabajado (Pago Doble)',
    'FF': 'Franco x Franco (Devolución)',
    'SWAP': 'Intercambio de Turno'
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
    'M': 8, 'T': 8, 'N': 8, 'D12': 12, 'N12': 12, 'PU': 12, 'F': 0, 'FF': 0, 'V': 0, 'L': 0, 'A': 0, 'E': 0, 'AA': 0, 'C': 8 
};

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
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

const ACTION_LABELS: Record<string, string> = {
    'ASIGNACION': 'Asignación', 'ELIMINACION': 'Eliminación', 'EDICION_MASIVA': 'Edición Masiva',
    'ASIGNACION_MASIVA': 'Asignación Múltiple', 'CAMBIO_FRANCO_TURNO': 'Franco x Turno (FT)', 'CAMBIO_TURNO_FRANCO': 'Turno x Franco (FF)',
};

// Helper para día de la semana (0=Domingo -> 'D')
const getDayLetter = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const days = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    return days[date.getDay()];
};

interface Coords { r: number; c: number; }

const isShiftConsolidated = (shift: any) => {
    if (!shift) return false;
    if (shift.status === 'PRESENT' || shift.status === 'CHECK_IN' || shift.status === 'COMPLETED') return true;
    return false;
};

export default function PlanificacionPage() {
    // ============================================================================
    // 1. ESTADOS (NIVEL 0)
    // ============================================================================
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedClient, setSelectedClient] = useState('');
    const [selectedObjective, setSelectedObjective] = useState('');
    const [forceShowAll, setForceShowAll] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [sortBy, setSortBy] = useState<'name' | 'activity'>('activity');

    const [employees, setEmployees] = useState<any[]>([]);
    const [shiftsMap, setShiftsMap] = useState<Record<string, any>>({});
    const [absencesMap, setAbsencesMap] = useState<Record<string, any>>({});
    const [clients, setClients] = useState<any[]>([]);
    const [agreements, setAgreements] = useState<any[]>([]);
    const [unifiedLogs, setUnifiedLogs] = useState<any[]>([]);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [hasUnread, setHasUnread] = useState(false);
    
    const [operatorName, setOperatorName] = useState('Cargando...');
    const [operatorEmail, setOperatorEmail] = useState('');
    const [usersMap, setUsersMap] = useState<Record<string, string>>({}); 

    const [positionStructure, setPositionStructure] = useState<any[]>([]);
    // 🛑 SYNC-CORE: Estado activo inicial null para forzar limpieza
    const [activePosition, setActivePosition] = useState<string | null>(null);
    const [hasActiveSLA, setHasActiveSLA] = useState<boolean>(true);

    const [showAddModal, setShowAddModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [addSearchTerm, setAddSearchTerm] = useState('');
    const [selectedCell, setSelectedCell] = useState<any>(null);

    const [pendingAssignment, setPendingAssignment] = useState<any>(null); 
    const [authWarningMessage, setAuthWarningMessage] = useState('');

    const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
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
    const [rrhhData, setRrhhData] = useState({ type: 'Ausencia con Aviso', reason: '' });
    const [showConflictModal, setShowConflictModal] = useState(false);
    const [conflictNeighbors, setConflictNeighbors] = useState<{prev: any, next: any} | null>(null);
    
    const [showVacancyModal, setShowVacancyModal] = useState(false);
    const [vacancyData, setVacancyData] = useState<any>(null);
    const [selectedReplacement, setSelectedReplacement] = useState('');
    
    const [modifiers, setModifiers] = useState({ extend: false, early: false, plannedNovedad: '' });

    const [showLegend, setShowLegend] = useState(false);
    const [selectedRef, setSelectedRef] = useState<string | null>(null);

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

    // ============================================================================
    // 3. LISTA MAESTRA DE EMPLEADOS (NIVEL 2)
    // ============================================================================
    const displayedEmployees = useMemo(() => { 
        if (!selectedObjective && !forceShowAll) return []; 
        let list = employees; 
        if (selectedObjective && !forceShowAll) { 
            const activeGuestIds = new Set(); 
            Object.values(shiftsMap).forEach((shift: any) => { if (shift.objectiveId === selectedObjective) activeGuestIds.add(shift.employeeId); }); 
            Object.entries(pendingChanges).forEach(([key, change]: [string, any]) => { const [empId] = key.split('_'); if (!change.isDeleted) activeGuestIds.add(empId); }); 
            list = list.filter(e => e.preferredObjectiveId === selectedObjective || activeGuestIds.has(e.id)); 
        } 
        if (searchTerm) list = list.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase())); 
        return list.sort((a, b) => { 
            if (sortBy === 'activity') { 
                const countA = getEmployeeShiftCount(a.id); 
                const countB = getEmployeeShiftCount(b.id); 
                if (countA !== countB) return countB - countA; 
            } 
            return a.name.localeCompare(b.name); 
        }); 
    }, [employees, selectedObjective, forceShowAll, searchTerm, shiftsMap, pendingChanges, sortBy, daysInMonth]);

    // ============================================================================
    // 4. LÓGICA DERIVADA (NIVEL 3)
    // ============================================================================
    
    const dominantPosition = useMemo(() => {
        if (positionStructure.length === 0) return { qty: 1, positionName: 'General' };
        return positionStructure.reduce((prev, current) => (Number(prev.qty || 0) > Number(current.qty || 0)) ? prev : current, positionStructure[0]);
    }, [positionStructure]);

    const uniqueSLAShifts = useMemo(() => { 
        const targetPos = activePosition || (positionStructure.length > 0 ? positionStructure[0].positionName : 'General');
        const pos = positionStructure.find(p => p.positionName === targetPos);
        return pos ? pos.shifts : [];
    }, [positionStructure, activePosition]);

    // 🛑 RESTAURADO: swapCandidates
    const swapCandidates = useMemo(() => { 
        if (!showSwapModal) return []; 
        return employees.filter(e => e.id !== swapConfig?.empId)
                        .filter(e => e.name.toLowerCase().includes(swapSearchTerm.toLowerCase()))
                        .sort((a, b) => a.name.localeCompare(b.name)); 
    }, [employees, showSwapModal, swapSearchTerm, swapConfig]);

    // 🛑 RESTAURADO: targetFrancos
    useEffect(() => {
        if (selectedSwapTarget) {
            const dates: any[] = [];
            Object.values(shiftsMap).forEach((s: any) => {
                if (s.employeeId === selectedSwapTarget && (s.code === 'F' || s.isFranco)) {
                    const [y, m, d] = getDateKey(s.startTime).split('-');
                    dates.push({ dateStr: getDateKey(s.startTime), label: `${d}/${m}` });
                }
            });
            setTargetFrancos(dates);
        } else {
            setTargetFrancos([]);
        }
    }, [selectedSwapTarget, shiftsMap]);

    const activeServiceStatus = useMemo(() => {
        if (!selectedClient || !selectedObjective) return { status: 'IDLE', msg: '', icon: null };
        const client = clients.find(c => c.id === selectedClient);
        if (!client) return { status: 'DELETED', msg: 'CLIENTE NO ENCONTRADO', icon: <Ghost size={20}/> };
        
        const obj = client.objetivos?.find((o: any) => (o.id || o.name) === selectedObjective) ||
                    client.objetivos?.find((o: any) => o.name === getObjectiveName(selectedObjective));
        
        if (!obj) return { status: 'DELETED', msg: '⚠️ OBJETIVO ELIMINADO / NO EXISTE', icon: <Ghost size={20}/> };
        if (obj.status === 'INACTIVE' || obj.active === false) return { status: 'INACTIVE', msg: '⛔ SERVICIO SUSPENDIDO / INACTIVO', icon: <PowerOff size={20}/> };
        if (!hasActiveSLA) return { status: 'DELETED', msg: '⛔ SERVICIO NO VINCULADO O ELIMINADO', icon: <Database size={20}/> };
        
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
        const isDayActive = posConfig.activeDays ? posConfig.activeDays.includes(dayLetter) : true;
        
        // Meta Final
        const target = isDayActive ? (pax * dailyHoursTarget) : 0;

        let current = 0;
        const dominant = structure.reduce((prev: any, current: any) => (prev.qty > current.qty) ? prev : current, structure[0] || { qty: 1, positionName: 'General' });

        employeesList.forEach((emp: any) => {
            const key = `${emp.id}_${dateStr}`;
            const shift = changes[key] ? (changes[key].isDeleted ? null : changes[key]) : existing[key];
            if (shift && (shift.objectiveId === selectedObjective || changes[key])) {
                let shiftPos = shift.positionName || dominant?.positionName || 'General';
                if (shiftPos === positionName && !['F','FF','V','L','A','E','AA'].includes(shift.code)) {
                     current += (Number(shift.hours) || SHIFT_HOURS_LOOKUP[shift.code] || 8);
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
            const smartDefault = selectedCell.currentShift?.positionName || dominantPosition.positionName || 'General';
            setActivePosition(smartDefault);
        } else {
            setActivePosition(null);
        }
    }, [selectedCell, dominantPosition]);

    const getPositionHoursCoverage = (dateStr: string) => {
        const coverage: Record<string, { coveredHours: number, count: number }> = {};
        if (!selectedObjective) return coverage;
        displayedEmployees.forEach(emp => {
            const key = `${emp.id}_${dateStr}`;
            const shift = pendingChanges[key] ? (pendingChanges[key].isDeleted ? null : pendingChanges[key]) : shiftsMap[key];
            if (shift && (shift.objectiveId === selectedObjective || pendingChanges[key])) {
                if (['F','FF','V','L','A','E','AA'].includes(shift.code)) return;
                const posName = shift.positionName || 'General'; 
                const hours = shift.hours || SHIFT_HOURS_LOOKUP[shift.code] || 8;
                if (!coverage[posName]) coverage[posName] = { coveredHours: 0, count: 0 };
                coverage[posName].coveredHours += hours;
                coverage[posName].count += 1;
            }
        });
        return coverage;
    };

    const checkLaborRules = (empId: string, targetDate: Date, newHours: number) => { const emp = employees.find(e => e.id === empId); if (!emp) return null; const dateKey = getDateKey(targetDate); const key = `${empId}_${dateKey}`; if (absencesMap[key]) { return `ALERTA CRÍTICA: El empleado tiene una Ausencia Registrada (${absencesMap[key].type}) para esta fecha.`; } const rule = agreements.find(a => a.name === emp.laborAgreement) || agreements.find(a => a.name === 'General') || { maxHoursWeekly: DEFAULT_LIMITS.weekly, maxHoursMonthly: DEFAULT_LIMITS.monthly }; const limitMonthly = parseInt(rule.maxHoursMonthly) || DEFAULT_LIMITS.monthly; const pendingShift = pendingChanges[key]; const existingShift = shiftsMap[key]; let finalShift = pendingShift ? (pendingShift.isDeleted ? null : pendingShift) : existingShift; if (finalShift && (finalShift.code === 'F' || finalShift.isFranco)) return `ALERTA CRÍTICA: El empleado ya tiene un FRANCO asignado este día.`; const targetMonthStr = getDateKey(targetDate).substring(0,7); let monthlyTotal = 0; const daysInCurrentMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate(); for(let d=1; d<=daysInCurrentMonth; d++) { const checkDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), d); const k = `${empId}_${getDateKey(checkDate)}`; const p = pendingChanges[k]; const s = shiftsMap[k]; let active = p ? (p.isDeleted ? null : p) : s; if (active && active.code !== 'F') monthlyTotal += (SHIFT_HOURS_LOOKUP[active.code] || active.hours || 8); } if ((monthlyTotal + newHours) > limitMonthly) return `ALERTA MENSUAL: Límite de ${limitMonthly}hs superado.`; return null; };
    
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

    const handleContextChange = (newClient: string, newObjective: string) => { if (Object.keys(pendingChanges).length > 0) { if (!confirm(`⚠️ TIENES CAMBIOS SIN GUARDAR.\n¿Descartar y cambiar de objetivo?`)) return; setPendingChanges({}); } setSelectedClient(newClient); setSelectedObjective(newObjective); setSearchTerm(''); setSelection({start: null, end: null}); setComparingSnapshot(null); };

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
                snap.docs.forEach(d => { const u = d.data(); if (u.email) map[u.email] = u.name || u.email; }); 
                setUsersMap(map); 
            } catch (e) { console.error("Error loading users", e); } 
        };
        loadUsers();
        const auth = getAuth();
        onAuthStateChanged(auth, (user) => { if (user) { setOperatorEmail(user.email || ''); setOperatorName(user.displayName || user.email || "Usuario"); } else { setOperatorName("No Logueado"); } });
    }, []);

    // 🛑 V8.50 - OMNI-SCANNER + DETECCIÓN DE FALLO DE SLA + ACTIVE DAYS + COVERAGE TYPE
    useEffect(() => { 
        if (!selectedClient || !selectedObjective) { setPositionStructure([]); setHasActiveSLA(true); return; } 
        const fetchSLA = async () => { 
            try { 
                const q = query(collection(db, 'servicios_sla'), where('clientId', '==', selectedClient)); 
                const snap = await getDocs(q); 
                let srv = snap.docs.map(d => d.data()).find(d => d.objectiveId === selectedObjective); 
                if (!srv) {
                    const objName = getObjectiveName(selectedObjective);
                    srv = snap.docs.map(d => d.data()).find(d => d.objectiveId === objName);
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
                                coverageType: pos.coverageType || srv.coverageType || '24hs' // 🛑 CAPTURA DEL TIPO DE COBERTURA
                            }); 
                        }
                    }); 
                } 
                if (structure.length === 0) {
                    console.warn("CRONO: No se encontró estructura válida. Activando Fallback.");
                    structure.push({ positionName: 'General', shifts: [{code:'M',hours:8},{code:'T',hours:8},{code:'N',hours:8}], qty: 1, activeDays: ['L','M','X','J','V','S','D'], coverageType: '24hs' }); 
                    setHasActiveSLA(false);
                } else {
                    setHasActiveSLA(true);
                }
                setPositionStructure(structure); 
            } catch (e) { 
                console.error("CRONO SLA ERROR:", e);
                setPositionStructure([{ positionName: 'ERROR', shifts: [], qty: 1 }]); 
                setHasActiveSLA(false);
            } 
        }; 
        fetchSLA(); 
    }, [selectedClient, selectedObjective]);

    // LISTENER DE NOVEDADES Y OTROS DATOS
    useEffect(() => {
        const unsubC = onSnapshot(collection(db, 'clients'), snap => setClients(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        const unsubAg = onSnapshot(collection(db, 'convenios'), snap => setAgreements(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubE = onSnapshot(collection(db, 'empleados'), snap => setEmployees(snap.docs.map(d => ({ id: d.id, name: d.data().name || d.data().firstName + ' ' + d.data().lastName, preferredObjectiveId: d.data().preferredObjectiveId, laborAgreement: d.data().laborAgreement }))));
        
        const unsubS = onSnapshot(collection(db, 'turnos'), snap => { 
            const map: any = {}; 
            snap.docs.forEach(d => { 
                const data = d.data(); 
                if (data.startTime?.seconds) { 
                    const dateKey = getDateKey(data.startTime); 
                    const key = `${data.employeeId}_${dateKey}`; 
                    map[key] = { 
                        id: d.id, ...data, code: data.code || data.type, objectiveId: data.objectiveId, 
                        startTime: data.startTime, realStartTime: data.realStartTime, status: data.status, 
                        isExtended: data.isExtended, isEarlyStart: data.isEarlyStart || data.isEarlyEntry, 
                        isFrancoTrabajado: data.isFrancoTrabajado || false, isFrancoCompensatorio: data.isFrancoCompensatorio || false, 
                        swapWith: data.swapWith, swapDate: data.swapDate, hasNovedad: data.hasNovedad, plannedNovedad: data.plannedNovedad,
                        positionName: data.positionName 
                    }; 
                } 
            }); 
            setShiftsMap(map); 
        });

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
        });

        const qNovedades = query(collection(db, 'novedades'), where('status', '==', 'pending'), where('priority', '==', 'high'), orderBy('createdAt', 'desc'), limit(20));
        const unsubN = onSnapshot(qNovedades, (snap) => {
            const alerts = snap.docs.map(d => ({ id: d.id, source: 'NOVEDAD', ...d.data(), msg: d.data().description }));
            setNotifications(alerts);
            if (alerts.length > 0) setHasUnread(true);
        });
        
        return () => { unsubC(); unsubE(); unsubS(); unsubA(); unsubAg(); unsubN(); };
    }, []);

    // ============================================================================
    // 7. HANDLERS DE USUARIO (NIVEL 6) - DEFINIDOS UNA SOLA VEZ
    // ============================================================================

    // 🛑 V8.20: Handler Restaurado
    const handleNotificationClick = async (notif: any) => {
        setShowNotifications(false);
        if (notif.id) {
            try {
                const collectionName = notif.source === 'NOVEDAD' ? 'novedades' : 'ausencias';
                await updateDoc(doc(db, collectionName, notif.id), { viewed: true });
                setNotifications(prev => prev.filter(n => n.id !== notif.id));
                setHasUnread(false);
            } catch (e) { console.error("Error update view", e); }
        }

        if (notif.source === 'AUSENCIA' && notif.type && (notif.type.includes('Vacaciones') || notif.type.includes('Licencia'))) {
            setVacancyData(notif);
            setSelectedReplacement('');
            setShowVacancyModal(true);
            return;
        }

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
                    setCurrentDate(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1));
                    const targetEmp = employees.find(e => e.id === notif.employeeId || e.name === notif.employeeName);
                    
                    if (targetEmp) {
                        setSearchTerm(targetEmp.name);
                        setForceShowAll(true);
                        
                        setTimeout(() => {
                            const dateStr = getDateKey(targetDate);
                            const key = `${targetEmp.id}_${dateStr}`;
                            const shift = pendingChanges[key] || shiftsMap[key];
                            const absence = absencesMap[key];
                            
                            if ((shift && absence) || (shift && shift.hasNovedad)) {
                                findNeighbors(shift, dateStr);
                                setShowConflictModal(true);
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
                        }, 300);
                    }
                }
            } catch (e) { console.error("Error navegando", e); }
        }
    };

    const loadHistory = async () => { if (!selectedObjective) { toast.error("Seleccione un objetivo"); return; } try { const q = query(collection(db, 'planificaciones_historial'), where('period', '==', `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`)); const snap = await getDocs(q); const versions = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((v: any) => v.objectiveId === selectedObjective).sort((a:any, b:any) => b.timestamp.seconds - a.timestamp.seconds); setHistoryVersions(versions); setShowHistoryModal(true); } catch (e) { toast.error("Error historial"); } };
    const handleViewSnapshot = (v: any) => { try { const data = JSON.parse(v.snapshot); setComparingSnapshot({ id: v.id, date: new Date(v.timestamp.seconds*1000), user: v.user, data: data }); setShowHistoryModal(false); } catch(e) { toast.error("Error al cargar versión histórica"); } };
    const exitSnapshotMode = () => setComparingSnapshot(null);

    const handleUnassignEmployee = async (emp: any) => { if (!selectedObjective) return; if (emp.preferredObjectiveId !== selectedObjective) { toast.error("Error asignación."); return; } if (!confirm(`¿CONFIRMAR DESVINCULACIÓN?`)) return; try { await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: null }); await addDoc(collection(db, 'audit_logs'), { action: 'DESVINCULACION_OBJETIVO', module: 'PLANIFICADOR', details: `Desvinculó a ${emp.name}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid }); toast.success("Desvinculado"); } catch (e) { toast.error("Error"); } };
    const handleMarkAllRead = async () => { if (!confirm("¿Marcar todas como leídas?")) return; const batch = writeBatch(db); notifications.forEach(n => { if (n.id) { const ref = doc(db, n.source === 'NOVEDAD' ? 'novedades' : 'ausencias', n.id); batch.update(ref, { viewed: true }); } }); await batch.commit(); setNotifications([]); setHasUnread(false); toast.success("Bandeja limpia"); };
    const handleTransferEmployee = async (emp: any) => { if (!selectedObjective) return; if (!confirm(`¿Transferir a ${emp.name} a este objetivo?`)) return; try { await updateDoc(doc(db, 'empleados', emp.id), { preferredObjectiveId: selectedObjective }); await addDoc(collection(db, 'audit_logs'), { action: 'TRANSFERENCIA_OBJETIVO', module: 'PLANIFICADOR', details: `Transfirió a ${emp.name} al objetivo ${selectedObjective}`, timestamp: serverTimestamp(), actorName: activeActorName, actorUid: getAuth().currentUser?.uid }); toast.success("Transferencia exitosa"); } catch (e) { toast.error("Error al transferir"); } };
    const handleDelete = async () => { if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; } if (!selectedCell) return; if (isDateLocked(selectedCell.dateStr)) { toast.warning("Bloqueado."); return; } const key = `${selectedCell.empId}_${selectedCell.dateStr}`; const newChanges = { ...pendingChanges }; newChanges[key] = { isDeleted: true }; setPendingChanges(newChanges); setSelectedCell(null); toast.info("Marcado para borrar."); };
    const getSafeTime = (input: any) => { if (!input) return [6, 0]; if (typeof input === 'string') return input.split(':').map(Number); if (input.toDate) { const d = input.toDate(); return [d.getHours(), d.getMinutes()]; } if (input.seconds) { const d = new Date(input.seconds * 1000); return [d.getHours(), d.getMinutes()]; } if (input instanceof Date) return [input.getHours(), input.getMinutes()]; return [6, 0]; };
    
    const handleSaveAll = async () => { 
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; }
        const count = Object.keys(pendingChanges).length; 
        if (count === 0) return; 
        if (!confirm(`¿Confirmar y guardar ${count} cambios?`)) return; 
        
        setIsProcessing(true); 
        const batch = writeBatch(db); 
        const auth = getAuth(); 
        const realActorName = activeActorName || 'Sistema'; 
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
                let actionDetail = `Asignó ${change.code} a ${empName} el ${dateStr}`; 
                
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
                    else end.setTime(start.getTime() + ((change.hours||8)*3600000)); 
                    
                    const safeSwapWith = change.swapWith || null; 
                    const safeSwapDate = change.swapDate || null; 
                    
                    // 🛑 FIX DE SEGURIDAD: Evitar undefined en positionName
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
                        comments: 'Carga Masiva', 
                        isExtended: change.isExtended || false, 
                        isEarlyStart: change.isEarlyStart || false, 
                        plannedNovedad: change.plannedNovedad || null, 
                        positionName: safePositionName 
                    }); 
                    
                    logData.push({ empId, date: dateStr, action: actionType }); 
                    batch.set(doc(collection(db, 'audit_logs')), { action: actionType, module: 'PLANIFICADOR', details: actionDetail, timestamp: serverTimestamp(), actorName: realActorName, actorUid: auth.currentUser?.uid }); 
                } 
            } 
            
            await addDoc(collection(db, 'planificaciones_historial'), { timestamp: serverTimestamp(), user: realActorName, period: `${currentDate.getMonth()+1}-${currentDate.getFullYear()}`, objectiveId: selectedObjective, changes: logData, count, snapshot: JSON.stringify(snapshotData) }); 
            await batch.commit(); 
            setPendingChanges({}); 
            toast.success("Guardado exitoso"); 
        } catch(e) { 
            console.error(e); 
            toast.error("Error al guardar"); 
        } finally { 
            setIsProcessing(false); 
        } 
    };

    const resolveConflict = async (type: 'SPLIT' | 'FULL_COVERAGE') => { if (!selectedCell?.currentShift) return; const batch = writeBatch(db); const shiftId = selectedCell.currentShift.id; if (selectedCell.absence) { batch.update(doc(db, 'turnos', shiftId), { status: 'ABSENT', comments: 'Cubierto por ausencia' }); } else { batch.update(doc(db, 'turnos', shiftId), { hasNovedad: false, comments: 'Novedad resuelta' }); } if (type === 'SPLIT') { if (conflictNeighbors?.prev) { batch.update(doc(db, 'turnos', conflictNeighbors.prev.id), { isExtended: true, comments: 'Extensión por cobertura' }); } if (conflictNeighbors?.next) { batch.update(doc(db, 'turnos', conflictNeighbors.next.id), { isEarlyStart: true, comments: 'Adelanto por cobertura' }); } toast.success("Cobertura aplicada: Extensión + Adelanto"); } else { setShowConflictModal(false); setFrancoMode('FT_SELECTION'); return; } await batch.commit(); setShowConflictModal(false); setSelectedCell(null); };
    const handleRRHHSubmit = async () => { if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; } if (!selectedCell) return; try { await addDoc(collection(db, 'ausencias'), { employeeId: selectedCell.empId, employeeName: employees.find(e => e.id === selectedCell.empId)?.name, startDate: selectedCell.dateStr, endDate: selectedCell.dateStr, type: rrhhData.type, reason: rrhhData.reason, status: 'APPROVED', createdAt: serverTimestamp() }); toast.success("Ausencia cargada por RRHH"); setShowRRHHModal(false); setSelectedCell(null); } catch(e) { toast.error("Error al cargar ausencia"); } };
    const handleProcessVacancy = () => { if (isServiceLocked) { toast.error(activeServiceStatus.msg); return; } if (!vacancyData || !selectedReplacement) return; const replacementEmp = employees.find(e => e.id === selectedReplacement); if (!replacementEmp) return; const newChanges = { ...pendingChanges }; const [sY, sM, sD] = vacancyData.startDate.split('-').map(Number); const [eY, eM, eD] = vacancyData.endDate.split('-').map(Number); let current = new Date(sY, sM - 1, sD); const end = new Date(eY, eM - 1, eD); let count = 0; while (current <= end) { const dateStr = getDateKey(current); const titularKey = `${vacancyData.employeeId}_${dateStr}`; const existingShift = shiftsMap[titularKey]; newChanges[titularKey] = { code: 'V', name: 'Vacaciones', isTemp: true, hours: 0, startTime: '00:00', comments: `Licencia: ${vacancyData.type}` }; if (existingShift && existingShift.code !== 'F') { const suplenteKey = `${replacementEmp.id}_${dateStr}`; newChanges[suplenteKey] = { code: existingShift.code, name: existingShift.code, isTemp: true, objectiveId: existingShift.objectiveId, hours: existingShift.hours || 8, startTime: existingShift.startTime, positionName: existingShift.positionName, comments: `Cubriendo a ${vacancyData.employeeName} (${vacancyData.type})` }; } count++; current.setDate(current.getDate() + 1); } setPendingChanges(newChanges); setShowVacancyModal(false); setVacancyData(null); toast.success(`Cobertura planificada para ${count} días. Revise y guarde los cambios.`);
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
        
        const currentPos = activePosition || (positionStructure[0]?.positionName) || 'General';

        for (let r = minR; r <= maxR; r++) { const emp = displayedEmployees[r]; if (!emp) continue; for (let c = minC; c <= maxC; c++) { const day = daysInMonth[c]; const key = `${emp.id}_${getDateKey(day)}`; const existing = shiftsMap[key]; if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig && shiftConfig.code !== 'F') { francosReplaced++; } } } 
        let markAsFT = false; 
        if (francosReplaced > 0) { if(confirm(`⚠️ Estás sobrescribiendo ${francosReplaced} Francos.\n¿Deseas marcarlos como FT?`)) { markAsFT = true; } } 
        for (let r = minR; r <= maxR; r++) { const emp = displayedEmployees[r]; if (!emp) continue; for (let c = minC; c <= maxC; c++) { const day = daysInMonth[c]; const key = `${emp.id}_${getDateKey(day)}`; const existing = shiftsMap[key]; if (isShiftConsolidated(existing)) continue; if (shiftConfig === null) { newChanges[key] = { isDeleted: true }; } else { let cellIsFT = false; if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F') { cellIsFT = markAsFT; } newChanges[key] = { ...shiftConfig, isTemp: true, oldObjectiveId: existing?.objectiveId, isFrancoTrabajado: cellIsFT, positionName: currentPos }; } count++; } } 
        setPendingChanges(newChanges); 
        toast.info(`${count} celdas`); 
    };

    const applyToPending = (config: any) => { 
        const key = `${selectedCell.empId}_${selectedCell.dateStr}`; 
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
        setPendingAssignment(null); 
        setSwapConfig(null); 
        setShowSwapModal(false); 
        toast.info("Cambio aplicado"); 
    };

    const handleAssignShift = async (shiftConfig: any, positionName: string) => { 
        if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; } 
        if (!selectedCell) return; 
        if (isDateLocked(selectedCell.dateStr)) { toast.error("Periodo cerrado."); return; } 
        const key = `${selectedCell.empId}_${selectedCell.dateStr}`; 
        const existing = selectedCell.currentShift; 
        const isFT = francoMode === 'FT_SELECTION'; 
        if (existing && existing.objectiveId !== selectedObjective && !existing.isFranco && !isFT) { const objName = getObjectiveName(existing.objectiveId); if(!confirm(`⚠️ ALERTA DE TRANSFERENCIA\n\nEl empleado ya tiene turno en "${objName}".\n\n¿Desea moverlo a este objetivo?`)) return; applyToPending({ ...shiftConfig, oldObjectiveId: existing.objectiveId, positionName }); return; } 
        if (existing && (existing.code === 'F' || existing.isFranco) && shiftConfig.code !== 'F' && !isFT) { if(!confirm(`⚠️ ATENCIÓN: ESTÁ ELIMINANDO UN FRANCO\n\n¿Seguro que desea eliminar el Franco?`)) return; } 
        const [y, m, d] = selectedCell.dateStr.split('-').map(Number); const targetDate = new Date(y, m-1, d); const hours = shiftConfig.hours || 8; 
        if (shiftConfig.code !== 'F' && !isFT) { const warning = checkLaborRules(selectedCell.empId, targetDate, hours); if (warning) { setAuthWarningMessage(warning); if(warning.includes("CRÍTICA")) { toast.error(warning); return; } setPendingAssignment({ shiftConfig, positionName, targetDate }); return; } } 
        applyToPending({ ...shiftConfig, positionName, isFrancoTrabajado: isFT, isExtended: modifiers.extend, isEarlyStart: modifiers.early, plannedNovedad: modifiers.plannedNovedad }); 
    };

    const confirmPendingAssignment = () => { if (!pendingAssignment) return; applyToPending({ ...pendingAssignment.shiftConfig, positionName: pendingAssignment.positionName, isFrancoTrabajado: francoMode === 'FT_SELECTION', isExtended: modifiers.extend, isEarlyStart: modifiers.early, plannedNovedad: modifiers.plannedNovedad }); setPendingAssignment(null); setAuthWarningMessage(''); };
    const executeSwap = () => { if (isServiceLocked) { toast.error(activeServiceStatus.msg || 'Bloqueado'); return; } const emp1 = selectedCell.empId; const date1 = selectedCell.dateStr; const emp2 = selectedSwapTarget; const date2 = selectedSwapDate; const newChanges = { ...pendingChanges }; const name1 = employees.find(e => e.id === emp1)?.name || 'Emp1'; const name2 = employees.find(e => e.id === emp2)?.name || 'Emp2'; newChanges[`${emp1}_${date1}`] = { code: coverShift1, isTemp: true, isFranco: false, isSwap: true, swapWith: name2 }; newChanges[`${emp2}_${date1}`] = { code: 'FF', isTemp: true, isFranco: true, isFrancoCompensatorio: true, swapWith: name1, swapDate: date2 }; newChanges[`${emp1}_${date1}`] = { code: 'FF', isTemp: true, isFranco: true, isFrancoCompensatorio: true, swapWith: name2, swapDate: date1 }; newChanges[`${emp2}_${date2}`] = { code: coverShift2, isTemp: true, isFranco: false, isSwap: true, swapWith: name1 }; setPendingChanges(newChanges); setShowSwapModal(false); setSwapConfig(null); setSelectedCell(null); setCoverageStep(false); toast.success("Enroque completado"); };
    const handleSelectDate = (dateStr: string) => { setSelectedSwapDate(dateStr); setCoverageStep(true); const getShiftInfo = (eId: string, dStr: string) => { const k = `${eId}_${dStr}`; return pendingChanges[k] || shiftsMap[k]; }; const s1 = getShiftInfo(selectedSwapTarget, selectedCell.dateStr); if (s1 && s1.code !== 'F' && s1.code !== 'FF') { setCoverShift1(s1.code); setIsShift1Fixed(true); } else { setCoverShift1('M'); setIsShift1Fixed(false); } const s2 = getShiftInfo(selectedCell.empId, dateStr); if (s2 && s2.code !== 'F' && s2.code !== 'FF') { setCoverShift2(s2.code); setIsShift2Fixed(true); } else { setCoverShift2('M'); setIsShift2Fixed(false); } };
    
    const handleMouseUp = () => { 
        setIsDragging(false); 
        if (isServiceLocked) { toast.error(activeServiceStatus.msg); setSelection({ start: null, end: null }); return; } 
        if (selection.start && selection.end && selection.start.r === selection.end.r && selection.start.c === selection.end.c) { 
            const emp = displayedEmployees[selection.start.r]; 
            const day = daysInMonth[selection.start.c]; 
            const dateStr = getDateKey(day); 
            const key = `${emp.id}_${dateStr}`; 
            const shift = pendingChanges[key] || shiftsMap[key]; 
            const absence = absencesMap[key]; 
            if (selection.start.r === selection.end.r && selection.start.c === selection.end.c) { setSelection({ start: null, end: null }); } 
            if (!pendingChanges[key]?.isDeleted) { 
                const defaultPos = shift?.positionName || dominantPosition.positionName; 
                setActivePosition(defaultPos); 
                if (isShiftConsolidated(shift)) { setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: shift, absence: absence }); return; } 
                const isLocked = isDateLocked(dateStr); 
                if (!isLocked && ((shift && absence) || (shift && shift.hasNovedad))) { findNeighbors(shift, dateStr); setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: shift, absence: absence }); setShowConflictModal(true); } 
                else { if (!isLocked) { let initialModifiers = { extend: false, early: false, plannedNovedad: '' }; if (shift) { initialModifiers = { extend: shift.isExtended || false, early: shift.isEarlyStart || false, plannedNovedad: shift.plannedNovedad || '' }; } setModifiers(initialModifiers); setFrancoMode('NONE'); } setSelectedCell({ empId: emp.id, dateStr: dateStr, currentShift: shift, absence: absence }); } 
            } 
        } 
    };
    const handleMouseDown = (r: number, c: number) => { if (!selectedObjective || comparingSnapshot || isServiceLocked) return; setIsDragging(true); setSelection({ start: {r, c}, end: {r, c} }); };
    const handleMouseEnter = (r: number, c: number) => { if (!isDragging) return; setSelection(prev => ({ ...prev, end: {r, c} })); };
    const isCellSelected = (r: number, c: number) => selection.start && r >= Math.min(selection.start.r, selection.end!.r) && r <= Math.max(selection.start.r, selection.end!.r) && c >= Math.min(selection.start.c, selection.end!.c) && c <= Math.max(selection.start.c, selection.end!.c);

    // 🛑 V8.20: RENDERIZADO DUAL (SPLIT SCREEN) - RESTAURADO
    const renderGrid = (isSnapshotView: boolean, snapshotData?: any) => (
        <table className="border-collapse w-full text-xs">
            <thead className="sticky top-0 z-30 bg-slate-100 shadow-md h-10"><tr><th className="sticky left-0 z-40 bg-slate-100 p-2 text-left min-w-[150px] border-b border-r"><span className="text-[10px] font-black uppercase"><Users size={12}/> Dotación</span></th>{daysInMonth.map(d => <th key={d.toISOString()} className={`min-w-[25px] border-b border-r p-1 text-center ${[0,6].includes(d.getDay())?'bg-slate-200':''}`}><span className="text-[10px] font-bold">{d.getDate()}</span></th>)}</tr></thead>
            <tbody>
                {displayedEmployees.map((emp, idx) => {
                    const isGuest = selectedObjective && emp.preferredObjectiveId !== selectedObjective;
                    const homeObjectiveName = getObjectiveName(emp.preferredObjectiveId);
                    
                    return (
                        <React.Fragment key={emp.id}>
                            {/* FILA ACTUAL (Editable) - Solo se muestra si NO es vista de snapshot */}
                            {!isSnapshotView && (
                                <tr className="group hover:bg-slate-50">
                                    <td className="sticky left-0 z-20 bg-white p-2 border-r border-b shadow-sm group-hover:bg-slate-50 h-8">
                                        <div className="flex items-center justify-between w-full"><div className="flex items-center gap-1 min-w-0 overflow-hidden"><span className="text-[9px] font-bold truncate" title={emp.name}>{emp.name}</span>{isGuest && (<div className="shrink-0 px-1.5 py-0.5 rounded bg-amber-500 text-white text-[8px] font-black uppercase flex items-center gap-1 cursor-help shadow-sm" title={`Base: ${homeObjectiveName}`}><Briefcase size={8} /> EXT</div>)}</div>{!isSnapshotView && selectedObjective && !isServiceLocked && (<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">{!isGuest && (<button onClick={(e) => { e.stopPropagation(); handleUnassignEmployee(emp); }} className="p-1 hover:bg-rose-100 text-rose-400 hover:text-rose-600 rounded transition-all" title="Desvincular (Dejar Sin Base)"><UserMinus size={12}/></button>)}{isGuest && (<button onClick={(e) => { e.stopPropagation(); handleTransferEmployee(emp); }} className="p-1 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-600 rounded transition-all" title="Transferir a este Objetivo (Hacer Base)"><UserCheck size={12}/></button>)}</div>)}</div>
                                    </td>
                                    {daysInMonth.map((day, dayIndex) => {
                                        const key = `${emp.id}_${getDateKey(day)}`;
                                        const s = shiftsMap[key]; const p = pendingChanges[key];
                                        const selected = !isSnapshotView && isCellSelected(idx, dayIndex);
                                        const isLockedDate = !isSnapshotView && isDateLocked(getDateKey(day));
                                        let content = null; let style = "";
                                        let isFT = s?.isFrancoTrabajado || p?.isFrancoTrabajado; let isFF = s?.isFrancoCompensatorio || p?.isFrancoCompensatorio;
                                        let isExtended = s?.isExtended || p?.isExtended; let isEarly = s?.isEarlyStart || p?.isEarlyStart; 
                                        let plannedNov = s?.plannedNovedad || p?.plannedNovedad; 
                                        let absence = absencesMap[key];
                                        let hasConflict = (s && absence && s.status !== 'ABSENT') || (s && s.hasNovedad); 
                                        let statusIndicator = null;
                                        if (s && !isSnapshotView) { if (s.status === 'PRESENT' || s.status === 'COMPLETED') statusIndicator = 'bg-emerald-500'; else if (s.status === 'ABSENT') statusIndicator = 'bg-rose-500'; }
                                        let isSwap = s?.swapWith || p?.swapWith;
                                        if (isLockedDate) { style = SHIFT_STYLES['PAST']; if (s) content = s.code; } 
                                        else if (p) { if(p.isDeleted) { content=<X size={12}/>; style="bg-rose-50 text-rose-300"; } else { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { content=p.code; style=`bg-amber-100 text-amber-700 font-black ring-2 ring-amber-400 ${isSwap ? SHIFT_STYLES['SWAP'] : ''}`; } } } 
                                        else if (s) { if (!isLockedDate) { if(isFT) { style=SHIFT_STYLES['FT']; content="FT"; } else if(isFF) { style=SHIFT_STYLES['FF']; content="FF"; } else { style=`${getDefaultStyle(s.code)} ${isSwap ? SHIFT_STYLES['SWAP'] : ''}`; content=s.code; } } }
                                        if (isExtended) { style += ' ring-2 ring-violet-600 z-10'; }
                                        if (isEarly) { style += ' ring-2 ring-cyan-500 z-10'; }
                                        if (plannedNov === 'AVISO') { style += ' border-l-4 border-l-amber-500'; } 
                                        if (plannedNov === 'LICENCIA') { style += ' border-l-4 border-l-purple-500'; } 
                                        if (content === 'Ausencia con Aviso') { content = 'AA'; style = SHIFT_STYLES['AA']; }
                                        if (isGuest && (s || p)) { style += ' border-t-2 border-t-amber-400'; }
                                        if (absence) { style = SHIFT_STYLES['V'] || 'bg-teal-600 text-white font-black'; content = "V"; if (absence.type === 'Vacaciones') { content = "V"; } else if (absence.type === 'Enfermedad') { content = "E"; style = SHIFT_STYLES['E']; } else { content = "AUS"; style = 'bg-rose-50 text-rose-700 font-bold border-rose-200'; } }
                                        return <td key={key} onMouseDown={() => !isSnapshotView && handleMouseDown(idx, dayIndex)} onMouseEnter={() => !isSnapshotView && isDragging && setSelection(pr => ({...pr, end:{r:idx, c:dayIndex}}))} className={`border-b border-r p-0.5 ${!isSnapshotView && !isLockedDate && !isServiceLocked ? 'cursor-pointer' : 'cursor-default'} text-center relative ${selected?'bg-indigo-200':''}`}><div className={`w-full h-6 rounded flex items-center justify-center text-[9px] font-black relative ${style}`}>{content}{(isExtended || isEarly) && <div className="absolute -top-1 -right-1 text-[8px] bg-slate-800 text-white px-1 rounded-full">+</div>}{statusIndicator && <div className={`absolute top-0 right-0 w-2 h-2 rounded-full border border-white ${statusIndicator}`}></div>}{hasConflict && ( <div className="absolute inset-0 bg-red-500/30 flex items-center justify-center animate-pulse border-2 border-red-500 z-20"><Siren size={14} className="text-white drop-shadow-md"/></div> )}{isGuest && (s || p) && !absence && (<div className="absolute bottom-0 left-0"><Briefcase size={8} className="text-amber-600 drop-shadow-sm"/></div>)}</div></td>;
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
            <tfoot className="sticky bottom-0 z-30 bg-slate-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] border-t-2 border-slate-300"><tr><td className="sticky left-0 z-40 bg-slate-50 p-2 border-r border-b font-black text-[10px] text-right uppercase text-slate-500 shadow-sm flex items-center justify-end gap-2 h-8"><ShieldCheck size={12}/> Cobertura:</td>{daysInMonth.map(day => { const dateStr = getDateKey(day); let totalActive = 0; const relevantEmployees = displayedEmployees; relevantEmployees.forEach(emp => { const key = `${emp.id}_${dateStr}`; const pending = pendingChanges[key]; const existing = shiftsMap[key]; let activeShift = pending ? (pending.isDeleted ? null : pending) : existing; if (activeShift) { const isWorking = activeShift.code !== 'F' && activeShift.code !== 'FF' && activeShift.code !== 'V' && activeShift.code !== 'L' && activeShift.code !== 'A' && activeShift.code !== 'E'; const shiftObjective = activeShift.objectiveId || (pending ? selectedObjective : ''); if (isWorking && shiftObjective === selectedObjective) { totalActive++; } } }); return (<td key={dateStr} className={`text-center border-r border-b text-[10px] font-black ${totalActive > 0 ? 'bg-white text-slate-700' : 'bg-rose-50 text-rose-300'}`} colSpan={1}>{totalActive}</td>); })}</tr></tfoot>
        </table>
    );

    return (
        <DashboardLayout>
            <Head><title>Planificador</title></Head>
            <style>{`.pattern-grid { background-image: linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb), linear-gradient(45deg, #e5e7eb 25%, transparent 25%, transparent 75%, #e5e7eb 75%, #e5e7eb); background-size: 10px 10px; background-position: 0 0, 5px 5px; } @media print { @page { size: A4 landscape; margin: 5mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background-color: white !important; } #printable-section { position: absolute; left: 0; top: 0; width: 100%; min-width: 100%; transform: none; background: white; } .no-print { display: none !important; } .custom-scrollbar { overflow: visible !important; height: auto !important; } }`}</style>
            <Toaster position="top-center" />
            <div className="flex flex-col h-[calc(100vh-100px)] p-2 space-y-4 animate-in fade-in select-none" onMouseUp={handleMouseUp}>
                
                <div className="bg-white p-3 rounded-2xl shadow-sm border flex flex-wrap items-center justify-between gap-3 shrink-0">
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
                            <div className="flex gap-2 no-print">
                                <select value={selectedClient} onChange={e => handleContextChange(e.target.value, '')} className="bg-slate-50 border p-2 rounded-xl text-xs font-bold w-40"><option value="">Cliente...</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                                <select value={selectedObjective} onChange={e => handleContextChange(selectedClient, e.target.value)} className="bg-slate-50 border p-2 rounded-xl text-xs font-bold w-40"><option value="">Objetivo...</option>{clients.find(c => c.id === selectedClient)?.objetivos?.map((o:any) => <option key={o.id||o.name} value={o.id||o.name}>{o.name}</option>)}</select>
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

                            {/* CRONO: V7.70 - BARRA DE DIAGNÓSTICO VISUAL DE ESTRUCTURA */}
                            {selectedObjective && !isServiceLocked && (
                                <div className="hidden md:flex px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl items-center gap-2 animate-in fade-in shadow-sm">
                                    <Activity size={14} className="text-emerald-500 animate-pulse"/>
                                    <div className="flex flex-col leading-none">
                                        <span className="text-[9px] font-black text-slate-400 uppercase">Diagnóstico de Estructura</span>
                                        <span className="text-[10px] font-bold text-slate-700">
                                            DETECTADO: {positionStructure.length} Puestos | 
                                            <span className="text-emerald-600 font-black ml-1">{positionStructure.reduce((acc, curr) => acc + (curr.qty || 1), 0)} Pax Total</span>
                                        </span>
                                    </div>
                                </div>
                            )}

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
                                                        <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded">
                                                            <Check size={12}/> Marcar todo leído
                                                        </button>
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
                                                                <p className="text-[9px] font-mono text-slate-400">{notif.createdAt ? new Date(notif.createdAt).toLocaleDateString() : notif.date}</p>
                                                                <span className="text-[9px] font-bold text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">Ir a detalle →</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )) : <div className="p-6 text-center text-slate-400 text-xs">Sin novedades recientes.</div>}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center bg-slate-100 rounded-xl p-1"><button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1, 1))} className="p-1 hover:bg-white rounded-lg"><ChevronLeft size={16}/></button><span className="px-3 font-black text-xs w-24 text-center capitalize">{currentDate.toLocaleDateString('es-AR', {month:'long'})}</span><button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 1))} className="p-1 hover:bg-white rounded-lg"><ChevronRight size={16}/></button></div>
                                <button onClick={loadHistory} className="p-2 bg-slate-100 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Ver Historial" disabled={!selectedObjective}><History size={18}/></button>
                                <button onClick={() => setSortBy(prev => prev === 'name' ? 'activity' : 'name')} className="p-2 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-colors border border-transparent hover:border-indigo-200" title={sortBy === 'activity' ? "Ordenado por Actividad" : "Ordenado por Nombre"}>{sortBy === 'activity' ? <ArrowDownWideNarrow size={18}/> : <ArrowDownAZ size={18}/>}</button>
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
                        comparingSnapshot ? (
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
                            renderGrid(false)
                        )
                    )}
                </div>

                {/* BARRA FLOTANTE */}
                {selection.start && (selection.start.r !== selection.end?.r || selection.start.c !== selection.end?.c) && !comparingSnapshot && !isServiceLocked && (
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] bg-slate-800 text-white p-2 rounded-2xl shadow-2xl flex gap-1 animate-in zoom-in-95 items-center border border-slate-600 no-print">
                        <span className="text-[10px] font-bold px-2 text-slate-300 uppercase tracking-wider">Asignar:</span>
                        {uniqueSLAShifts.map((s: any) => ( <button key={s.code} onClick={() => applyBulkChange({ code: s.code, name: s.name, hours: s.hours, startTime: s.startTime })} disabled={isServiceLocked} className={`w-8 h-8 rounded-lg font-black text-xs ${getDefaultStyle(s.code)}`}>{s.code}</button>))}
                        <button onClick={() => applyBulkChange({ code: 'F', name: 'Franco', hours: 0, startTime: '00:00' })} disabled={isServiceLocked} className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-black text-xs border border-emerald-700">F</button>
                        <div className="h-6 w-px bg-slate-600 mx-2"></div>
                        <button onClick={() => setShowRRHHModal(true)} disabled={isServiceLocked} className="p-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-white font-bold text-xs flex items-center gap-2 shadow-sm"><FileText size={12}/> +Ausencia</button>
                        <div className="h-6 w-px bg-slate-600 mx-2"></div>
                        <button onClick={() => applyBulkChange(null)} disabled={isServiceLocked} className="p-2 hover:bg-rose-600 rounded-lg text-rose-300 hover:text-white transition-colors" title="Borrar"><Trash2 size={16}/></button>
                        <button onClick={() => setSelection({start:null, end:null})} className="ml-1 p-2 hover:bg-slate-700 rounded-lg"><X size={16}/></button>
                    </div>
                )}

                <div className="bg-white p-2 rounded-xl border shadow-sm shrink-0 h-32 overflow-hidden flex flex-col no-print">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 mb-2 px-2 border-b pb-1 flex items-center gap-2"><Clock size={12}/> Actividad Reciente</h4>
                    <div className="overflow-y-auto custom-scrollbar space-y-1 px-2 pb-2">
                        {unifiedLogs.map(log => {
                            const realName = usersMap[log.actor] || usersMap[log.actorUid] || log.actor || 'Sistema';
                            return (<div key={log.id} className="flex items-center gap-2 text-[10px] p-1 border-b last:border-0 hover:bg-slate-50"><span className="font-mono text-slate-400">{new Date(log.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span><span className="font-bold px-1.5 rounded uppercase bg-slate-100 text-slate-600">{log.label}</span><span className="text-slate-600 truncate flex-1">{log.detail}</span><span className="text-[9px] text-slate-400 font-bold">{realName}</span></div>);
                        })}
                    </div>
                </div>

                {/* MODALES Y MENÚS DE CONTEXTO (V9.10 - EXPANDIDOS Y ORDENADOS) */}

                {/* 1. MODAL SELECTOR DE TURNOS */}
                {selectedCell && !showConflictModal && !showSwapModal && !showRRHHModal && !showVacancyModal && !pendingAssignment && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedCell(null)}>
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-[500px] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-4">
                                <div><h3 className="font-black text-lg text-slate-800">{employees.find(e => e.id === selectedCell.empId)?.name}</h3><p className="text-xs text-slate-500 font-bold uppercase">{selectedCell.dateStr}</p></div>
                                <button onClick={handleDelete} className="p-2 bg-rose-50 text-rose-500 rounded-xl hover:bg-rose-100" disabled={isServiceLocked}><Trash2 size={18}/></button>
                            </div>
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
                                const percentage = coverageData.target > 0 ? Math.min(100, (coverageData.current / coverageData.target) * 100) : 100;
                                const gap = coverageData.current - coverageData.target;
                                const displayTarget = coverageData.isActiveDay ? `${coverageData.target}h` : `CERRADO (0h)`;
                                const bgClass = coverageData.isActiveDay ? (isCovered ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600') : 'bg-slate-100 text-slate-500';
                                const barColor = coverageData.isActiveDay ? (isCovered ? 'bg-emerald-500' : 'bg-rose-500') : 'bg-slate-300';
                                return (
                                    <>
                                        <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                            <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Layers size={14} className="text-slate-400"/><span className="text-[10px] font-bold text-slate-500 uppercase">Cobertura {currentPosName} ({coverageData.pax} pax)</span></div><div className={`text-xs font-black px-2 py-0.5 rounded ${bgClass}`}>{coverageData.current}h / {displayTarget}</div></div>
                                            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${percentage}%` }}></div></div>
                                        </div>
                                        <div className={`grid grid-cols-5 gap-2 mb-4 ${isServiceLocked ? 'opacity-50 pointer-events-none' : ''}`}>
                                            {uniqueSLAShifts.map((s: any) => (
                                                <button key={s.code} onClick={() => handleAssignShift(s, activePosition || 'General')} disabled={isServiceLocked} className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-1 hover:scale-105 transition-transform relative ${SHIFT_STYLES[s.code]}`}><span className="font-black text-sm">{s.code}</span><span className="text-[9px] opacity-70">{s.hours}hs</span>{!selectedCell.currentShift && gap < 0 && <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">{gap}h</div>}</button>
                                            ))}
                                            <button onClick={() => { setFrancoMode('FT_SELECTION'); handleAssignShift({code: 'F', hours: 0}, 'General'); }} disabled={isServiceLocked} className="p-2 bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg flex flex-col items-center justify-center font-black"><span>F</span><span className="text-[8px]">Franco</span></button>
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
                        </div>
                    </div>
                )}

                {pendingAssignment && (<div className="fixed inset-0 z-[150] bg-amber-900/40 backdrop-blur-sm flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl border-2 border-amber-400 animate-in zoom-in-95"><div className="flex flex-col items-center text-center space-y-4"><div className="p-4 bg-amber-100 rounded-full text-amber-600"><AlertTriangle size={32} /></div><div><h3 className="font-black text-lg text-amber-800 uppercase">Advertencia Laboral</h3><p className="text-xs text-slate-600 mt-2 font-medium">{authWarningMessage}</p></div><div className="w-full pt-4 border-t flex gap-3"><button onClick={() => { setPendingAssignment(null); setAuthWarningMessage(''); }} className="flex-1 py-3 text-slate-500 font-bold text-xs rounded-xl hover:bg-slate-100">Cancelar</button><button onClick={confirmPendingAssignment} className="flex-1 py-3 bg-amber-500 text-white font-black text-xs rounded-xl hover:bg-amber-600 shadow-md">Confirmar</button></div></div></div></div>)}
                {showConflictModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-rose-900/20 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl shadow-2xl w-[400px] border-2 border-rose-100"><div className="text-center mb-6"><div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-3"><Siren size={24}/></div><h3 className="text-lg font-black text-slate-800">Conflicto Detectado</h3><p className="text-xs text-slate-500 mt-1">Hay una superposición entre Novedad y Turno.</p></div><div className="space-y-3"><button onClick={() => resolveConflict('SPLIT')} className="w-full p-3 bg-indigo-600 text-white rounded-xl font-bold text-xs shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex items-center justify-center gap-2"><Split size={16}/> Dividir Turno (Extensión + Adelanto)</button><button onClick={() => resolveConflict('FULL_COVERAGE')} className="w-full p-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-xs hover:bg-slate-50 flex items-center justify-center gap-2"><Shield size={16}/> Cobertura Total (Franco Trabajado)</button><button onClick={() => setShowConflictModal(false)} className="w-full p-3 text-slate-400 font-bold text-xs hover:text-slate-600">Cancelar</button></div></div></div>)}
                {showSwapModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl shadow-2xl w-[500px]"><h3 className="font-black text-lg mb-4 flex items-center gap-2"><ArrowLeftRight size={20} className="text-indigo-500"/> Asistente de Enroque</h3>{!coverageStep ? (<><input type="text" placeholder="Buscar compañero..." className="w-full bg-slate-50 border p-3 rounded-xl mb-3 text-sm font-bold" value={swapSearchTerm} onChange={e => setSwapSearchTerm(e.target.value)}/><div className="max-h-60 overflow-y-auto custom-scrollbar border rounded-xl mb-4">{swapCandidates.map(c => (<button key={c.id} onClick={() => setSelectedSwapTarget(c.id)} className={`w-full p-3 text-left hover:bg-slate-50 border-b flex justify-between items-center ${selectedSwapTarget === c.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-600'}`}><span>{c.name}</span>{selectedSwapTarget === c.id && <CheckCircle size={16}/>}</button>))}</div><div className="flex gap-2">{targetFrancos.map(f => (<button key={f.dateStr} onClick={() => handleSelectDate(f.dateStr)} className="bg-slate-100 px-3 py-1 rounded-lg text-xs font-bold border hover:bg-indigo-50 hover:border-indigo-200 transition-all">{f.label}</button>))}</div></>) : (<div className="space-y-4"><div className="bg-slate-50 p-4 rounded-xl border"><p className="text-xs font-black text-slate-400 uppercase mb-2">Configuración de Cobertura</p><div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] font-bold text-slate-500">Turno para {employees.find(e=>e.id===selectedCell.empId)?.name}</label><input value={coverShift2} onChange={e=>setCoverShift2(e.target.value)} disabled={isShift2Fixed} className="w-full p-2 border rounded font-bold text-center mt-1"/></div><div><label className="text-[10px] font-bold text-slate-500">Turno para {employees.find(e=>e.id===selectedSwapTarget)?.name}</label><input value={coverShift1} onChange={e=>setCoverShift1(e.target.value)} disabled={isShift1Fixed} className="w-full p-2 border rounded font-bold text-center mt-1"/></div></div></div><button onClick={executeSwap} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200">Confirmar Enroque</button></div>)}</div></div>)}
                {showAddModal && (<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)}><div className="bg-white p-6 rounded-2xl shadow-2xl w-[400px]" onClick={e => e.stopPropagation()}><h3 className="font-black text-lg mb-4">Agregar / Buscar Empleado</h3><input autoFocus className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl mb-4 text-sm font-bold" placeholder="Escriba nombre..." value={addSearchTerm} onChange={e => setAddSearchTerm(e.target.value)}/><div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">{employees.filter(e => e.name.toLowerCase().includes(addSearchTerm.toLowerCase())).map(emp => (<button key={emp.id} onClick={() => { setSearchTerm(emp.name); setForceShowAll(true); setShowAddModal(false); toast.info(`Mostrando a ${emp.name}`); }} className="w-full p-3 text-left hover:bg-slate-50 rounded-lg flex items-center gap-3 text-sm font-medium text-slate-700"><div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-black text-xs text-slate-500">{emp.name.substring(0,2)}</div>{emp.name}</button>))}</div></div></div>)}
                {showVacancyModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl shadow-2xl w-[500px] border-l-4 border-l-teal-500"><h3 className="font-black text-lg text-slate-800 mb-1">Gestión de Ausencia Prolongada</h3><p className="text-sm text-slate-500 mb-6">Cubriendo a <span className="font-bold text-slate-800">{vacancyData?.employeeName}</span> por <span className="font-bold text-teal-600">{vacancyData?.type}</span></p><div className="bg-slate-50 p-4 rounded-xl border mb-4"><label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">Seleccionar Suplente</label><select className="w-full p-3 rounded-lg border text-sm font-bold bg-white" value={selectedReplacement} onChange={e => setSelectedReplacement(e.target.value)}><option value="">Sin cobertura (Dejar descubierto)</option>{employees.filter(e => e.id !== vacancyData?.employeeId).map(e => (<option key={e.id} value={e.id}>{e.name}</option>))}</select></div><div className="flex gap-3"><button onClick={() => setShowVacancyModal(false)} className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-50 rounded-xl">Cancelar</button><button onClick={handleProcessVacancy} className="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold shadow-lg shadow-teal-200">Aplicar Cobertura</button></div></div></div>)}
                {showRRHHModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"><div className="bg-white p-6 rounded-2xl shadow-2xl w-[400px]"><h3 className="font-black text-lg mb-4">Registrar Novedad RRHH</h3><div className="space-y-4"><div><label className="text-xs font-bold text-slate-500 block mb-1">Tipo de Novedad</label><select className="w-full border p-2 rounded-lg" value={rrhhData.type} onChange={e => setRrhhData({...rrhhData, type: e.target.value})}><option>Ausencia con Aviso</option><option>Ausencia sin Aviso</option><option>Enfermedad</option><option>Licencia Gremial</option><option>Vacaciones</option></select></div><div><label className="text-xs font-bold text-slate-500 block mb-1">Detalle / Motivo</label><textarea className="w-full border p-2 rounded-lg h-24 text-sm" value={rrhhData.reason} onChange={e => setRrhhData({...rrhhData, reason: e.target.value})} placeholder="Especifique el motivo..."></textarea></div><button onClick={handleRRHHSubmit} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold">Guardar Novedad</button><button onClick={() => setShowRRHHModal(false)} className="w-full text-slate-400 text-xs font-bold py-2">Cancelar</button></div></div></div>)}
                {showHistoryModal && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistoryModal(false)}><div className="bg-white w-full max-w-3xl h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}><div className="p-4 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-black text-lg flex items-center gap-2"><History className="text-indigo-600"/> Historial de Versiones</h3><button onClick={() => setShowHistoryModal(false)}><X size={20}/></button></div><div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">{historyVersions.map(v => (<div key={v.id} className="border p-4 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-colors group"><div><p className="font-black text-slate-800 text-sm">{new Date(v.timestamp.seconds*1000).toLocaleString()}</p><p className="text-xs text-slate-500 font-mono mt-1">Modificado por: <span className="font-bold text-indigo-600">{v.user}</span></p><div className="mt-2 flex gap-2"><span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-600 border border-slate-200">{v.count} cambios</span></div></div><button onClick={() => handleViewSnapshot(v)} className="bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs font-black shadow-sm group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-all">Ver Versión</button></div>))}{historyVersions.length === 0 && <div className="text-center text-slate-400 py-10">No hay versiones guardadas para este periodo.</div>}</div></div></div>)}

            </div>
        </DashboardLayout>
    );
}