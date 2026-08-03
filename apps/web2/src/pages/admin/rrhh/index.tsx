
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { TabBar, SupervisorPinInput } from '@/components/ui';
import { employeeService, Employee } from '@/services/employeeService';
import { absenceService, Absence } from '@/services/absenceService';
import { holidayService, Holiday } from '@/services/holidayService';
import { agreementService } from '@/services/agreementService';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { geocodeAddress } from '@/lib/employees/geocodeAddress';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where, Timestamp, addDoc, updateDoc, doc, deleteDoc, writeBatch, serverTimestamp, deleteField, limit } from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import { belongsToEmpresa, empresaScopedQuery, filterRowsByEmpresa, shouldScopeQueriesToEmpresa, belongsToEmpresaView, deleteEmployeeForEmpresa, queryAndDeleteForEmpresa, stampEmpresaId, updateDocForEmpresa, TenantIsolationError } from '@/lib/multiempresa';
import { useToast } from '@/context/ToastContext';
import {
    Users, Search, Plus, Edit2, Trash2,
    FileText, X, CheckCircle, ChevronRight, ChevronLeft,
    BarChart2, Book, Download, Coffee, AlertOctagon, FileCheck,
    FileSpreadsheet, Shirt, Info, UploadCloud, FileDown, Activity, AlertTriangle, Calendar, Briefcase, Save, ArrowLeft, Printer,
    PieChart as PieChartIcon, TrendingUp, Clock, Target, MapPin, ExternalLink,
    UserCheck, UserX, TrendingDown, Award, ChevronDown, Phone, Home, Loader2,
    Send, KeyRound, CheckCircle2, Mail, ShieldCheck as ShieldCheckIcon, RefreshCw,
    BellRing, MessageCircle, ClipboardEdit, Eye, EyeOff, Shuffle
} from 'lucide-react';
import CorreccionesTab from '@/components/admin/rrhh/CorreccionesTab';
import AusenciasTab from '@/components/admin/rrhh/AusenciasTab';
import ExperienciaObjetivosPanel from '@/components/admin/employees/ExperienciaObjetivosPanel';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { countExperienciaObjetivos } from '@/lib/planificacion/experienciaObjetivos';
import { normalizeArgPhone } from '@/lib/whatsapp';
import { inferAbsenceCode, RRHH_ABSENCE_LABEL_TO_CODE, validateAbsenceDateRange, toCalendarDateStr, absenceNeedsMedicalVerification, absenceReplicatesToPlanning } from '@/lib/planificacion/absenceCodes';
import { normalizeGeneroImport } from '@/lib/planificacion/genderPreference';

import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// --- UTILIDADES ---

const getArgentinaDate = (dateInput: unknown): string => {
    if (!dateInput) return '';
    const cal = toCalendarDateStr(dateInput);
    if (cal) return cal;
    const rec = dateInput as { toDate?: () => Date };
    const d = typeof rec.toDate === 'function' ? rec.toDate() : new Date(String(dateInput));
    if (isNaN(d.getTime())) return '';
    const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' };
    const parts = new Intl.DateTimeFormat('es-AR', options).formatToParts(d);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    return `${year}-${month}-${day}`;
};

// --- PARSEO CSV ---
const parseCSV = (text: string) => {
    const cleanText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleanText.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return []; 

    const firstLine = lines[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';
    const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    
    const result = [];
    for(let i=1; i<lines.length; i++){
        const rowLine = lines[i];
        if (!rowLine.trim() || rowLine.replace(/;/g, '').trim().length === 0) continue;

        let row = [];
        if (delimiter === ';') {
             row = rowLine.split(';'); 
        } else {
             const matches = rowLine.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
             row = matches ? matches : rowLine.split(',');
        }
        
        const obj: any = {};
        headers.forEach((h, idx) => {
            let val = row[idx] ? row[idx].trim() : '';
            val = val.replace(/^"|"$/g, '');
            obj[h] = val;
        });
        result.push(obj);
    }
    return result;
};

const parseDateString = (dateStr: string) => {
    if (!dateStr) return '';
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr; 
    const parts = dateStr.split(/[/\-]/);
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        return `${year}-${month}-${day}`;
    }
    return '';
};

// --- MAPEO DE DATOS ---
const createEmployeeObject = (data: any, objectivesList: any[]) => {
    let objId = '';
    
    // PRIORIDAD 1: ID Manual
    if (data.preferredObjectiveId && data.preferredObjectiveId !== 'undefined') {
        objId = data.preferredObjectiveId;
    } 
    // PRIORIDAD 2: Busqueda por nombre
    else if (data.objectiveName) {
        const cleanObj = data.objectiveName.toLowerCase().trim();
        let found = objectivesList.find(o => o.name.toLowerCase().trim() === cleanObj);
        if (!found) {
             found = objectivesList.find(o => o.name.toLowerCase().includes(cleanObj) || cleanObj.includes(o.name.toLowerCase()));
        }
        if (found) objId = found.id;
    }

    let finalName = '';
    const ln = (data.lastName || '').trim();
    const fn = (data.firstName || '').trim();

    if (ln && fn) {
        if (ln.toLowerCase().includes(fn.toLowerCase())) { finalName = ln; } 
        else { finalName = `${ln}, ${fn}`; }
    } else {
        finalName = ln || fn || 'Desconocido';
    }

    finalName = finalName.toUpperCase();
    const cycleDay = data.cycleStartDay ? parseInt(data.cycleStartDay.toString().replace(/[^0-9]/g, '')) : 26;

    return {
        firstName: fn,
        lastName: ln,
        name: finalName, 
        dni: data.dni || '',
        cuil: data.cuil || '',
        fileNumber: data.fileNumber || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        lat: data.lat || null, 
        lng: data.lng || null,
        category: data.category || 'Vigilador',
        cct: data.cct || 'Seguridad Privada',
        laborAgreement: data.laborAgreement || 'SUVICO',
        status: data.status ? data.status.toLowerCase() : 'activo',
        role: 'employee',
        isAvailable: true,
        contractType: data.contractType || 'FullTime',
        periodType: data.periodType || 'Mensual',
        startDate: data.startDate || new Date().toISOString().split('T')[0],
        cycleStartDay: !isNaN(cycleDay) ? cycleDay : 26, 
        maxHours: 200,
        preferredClientId: '', 
        preferredObjectiveId: objId,
        genero: normalizeGeneroImport(data.genero),
        createdAt: new Date().toISOString(),
        sizes: data.sizes || { shirt: '', pants: '', shoes: '' }
    };
};

const getNightDuration = (start: Date, end: Date, nightStart: number = 21, nightEnd: number = 6) => {
    const ns = nightStart ?? 21;
    const ne = nightEnd ?? 6;
    let durationMins = 0;
    let current = new Date(start.getTime());
    const endTime = end.getTime();
    let safety = 0;
    while (current.getTime() < endTime && safety < 1440) {
        const h = current.getHours();
        if (h >= ns || h < ne) durationMins++;
        current.setMinutes(current.getMinutes() + 1);
        safety++;
    }
    return durationMins / 60;
};

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const OPERATIVE_CODES = ['M', 'T', 'N', 'D12', 'N12', 'PU', 'GU', 'FT']; // legacy compat
// Códigos NO operativos (días libres/licencias). Cualquier otro código se considera operativo.
const NON_WORK_CODES_RRHH = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'FP']);
const isOperativeCodeRRHH = (code: string) => !NON_WORK_CODES_RRHH.has((code || '').trim().toUpperCase());
const SHIFT_HOURS_LOOKUP: Record<string, number> = { 'M':8, 'T':8, 'N':8, 'D12':12, 'N12':12, 'PU':12, 'GU':8, 'EN':9, 'FT': 0, 'F':0, 'V':0, 'L':0, 'A':0, 'E':0, 'RET': 0 };

interface Agreement {
    id?: string;
    name: string;
    code: string;
    maxHoursWeekly: number;
    maxHoursMonthly: number;
    saturdayCutoffHour: number;
    saturdayRate: number;
    nightShiftStart: number;
    nightShiftEnd: number;
    categories: string[];
    paysDoubleOnFranco: boolean;
    holidayIsPlus?: boolean;
    sundayIs100?: boolean;
}

interface ExtendedAgreement extends Agreement {
    holidayIsPlus?: boolean;
    francoWorkedIs100?: boolean;
    saturdayAfter13Is100?: boolean; 
    sundayIs100?: boolean;
}

const NOVEDAD_TYPES = ['Vacaciones', 'Enfermedad', 'ART', 'Injustificada', 'Licencia Esp.', 'PG Permiso Gremial'] as const;

export default function EmployeesPage() {
  const { empresaId, empresa, empresas } = useEmpresa();
  const { isSuperAdmin: authIsSuperAdmin, rolePermissions } = useAuth();
  const isSuperAdmin = authIsSuperAdmin;
  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const { addToast } = useToast();
  const canAdjust = authIsSuperAdmin || (rolePermissions['RRHH'] || []).includes('adjust');
  const [currentUserName, setCurrentUserName] = useState("Cargando...");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'dashboard' | 'legajos' | 'ausencias' | 'feriados' | 'convenios' | 'correcciones'>('dashboard');
  const [view, setView] = useState<'list' | 'form'>('list');
  const [selectedEmp, setSelectedEmp] = useState<any | null>(null); // Changed type to any to avoid strict interface blocking
  const [employees, setEmployees] = useState<any[]>([]); // Changed to any[]
  const [filteredEmployees, setFilteredEmployees] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [empStats, setEmpStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [globalStats, setGlobalStats] = useState({ totalEmployees: 0, activeAbsences: 0, nextHolidays: 0 });

  const [clients, setClients] = useState<any[]>([]);
  const [allObjectives, setAllObjectives] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<ExtendedAgreement[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [filteredAbsences, setFilteredAbsences] = useState<Absence[]>([]);
  const [absenceSearchTerm, setAbsenceSearchTerm] = useState('');
  const [absenceTypeFilter, setAbsenceTypeFilter] = useState('');
  const [absenceStatusFilter, setAbsenceStatusFilter] = useState('');
  const [absencePeriodFilter, setAbsencePeriodFilter] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [absenceDateFilterMode, setAbsenceDateFilterMode] = useState<'month' | 'days'>('month');
  const [absenceCalendarMonth, setAbsenceCalendarMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [absenceSelectedDays, setAbsenceSelectedDays] = useState<Set<string>>(new Set());
  const [selectedAbsenceIds, setSelectedAbsenceIds] = useState<Set<string>>(new Set());
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const initialAbsenceForm: Absence = { employeeId: '', employeeName: '', type: 'Vacaciones', startDate: new Date().toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0], status: 'Pendiente', hasCertificate: false, reason: '', comments: '', rejectionReason: '', alternativePeriodStart: '', alternativePeriodEnd: '' };
  const [absenceForm, setAbsenceForm] = useState<Absence>(initialAbsenceForm);
  const [isEditingAbsence, setIsEditingAbsence] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [empDropOpen, setEmpDropOpen] = useState(false);

  const [holidayForm, setHolidayForm] = useState<any>({ date: '', name: '', type: 'Nacional' });
  const [syncYear, setSyncYear] = useState(new Date().getFullYear());
  const [isSyncing, setIsSyncing] = useState(false);
  
  const initialAgreement: ExtendedAgreement = { name: '', code: '', maxHoursWeekly: 48, maxHoursMonthly: 200, saturdayCutoffHour: 13, saturdayRate: 0, nightShiftStart: 21, nightShiftEnd: 6, paysDoubleOnFranco: true, categories: [], holidayIsPlus: true, sundayIs100: false };
  const [agreementForm, setAgreementForm] = useState<ExtendedAgreement>(initialAgreement);
  const [newCategory, setNewCategory] = useState('');
  const [isEditingAgreement, setIsEditingAgreement] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importEmpresaId, setImportEmpresaId] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatusMsg, setImportStatusMsg] = useState('');
  const [importAsInactive, setImportAsInactive] = useState(false);
  const [importWithGeo, setImportWithGeo] = useState(false);
  
  const [activeFormTab, setActiveFormTab] = useState<'PERSONAL' | 'LABORAL' | 'TALLES' | 'EXPERIENCIA' | 'VOLANTE' | 'RESTRICCIONES'>('PERSONAL');
  const initialForm: any = { firstName: '', lastName: '', dni: '', fileNumber: '', phone: '', email: '', category: '', status: 'activo', laborAgreement: '', preferredClientId: '', preferredObjectiveId: '', genero: '', sizes: { shirt:'', pants:'', shoes:'' }, cuil: '', address: '', lat: null, lng: null, contractType: 'FullTime', periodType: 'Mensual', cycleStartDay: 26, maxHours: 200, restriccionesObjetivo: [], restriccionesCliente: [], conflictosEmpleados: [], experienciaObjetivos: {}, volante: [] };
  const [form, setForm] = useState<any>(initialForm);
  const [newObjRestr, setNewObjRestr] = useState({ objectiveId: '', reason: '' });
  const [newClientRestr, setNewClientRestr] = useState({ clientId: '', reason: '' });
  const [newEmpConflict, setNewEmpConflict] = useState({ employeeId: '', reason: '' });
  const [newVolanteObjId, setNewVolanteObjId] = useState('');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState(0);
  const [authPinModal, setAuthPinModal] = useState<{ absenceId: string; absence: Absence } | null>(null);
  const [verifyModal, setVerifyModal] = useState<{ absenceId: string; absence: Absence } | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [authPinValue, setAuthPinValue] = useState('');
  const [authPinError, setAuthPinError] = useState('');
  const [authPinLoading, setAuthPinLoading] = useState(false);
  const [showBajaModal, setShowBajaModal] = useState(false);
  const [bajaForm, setBajaForm] = useState({ motivo: 'Desvinculación', fecha: new Date().toISOString().split('T')[0], observacion: '' });
  const [showInactive, setShowInactive] = useState(false);
  const [filterObjective, setFilterObjective] = useState('');
  const [filterNoCoords, setFilterNoCoords] = useState(false);
  const [geoFailedList, setGeoFailedList] = useState<string[]>([]);
  const [sendingPortalIds, setSendingPortalIds] = useState<Set<string>>(new Set());
  const [sendingAllPortal, setSendingAllPortal] = useState(false);
  const [pendingPortalRequests, setPendingPortalRequests] = useState<any[]>([]);
  // Portal password modal
  const [showPortalPwdModal, setShowPortalPwdModal] = useState(false);
  const [portalPwdEmp, setPortalPwdEmp] = useState<any>(null);
  const [portalPwdMode, setPortalPwdMode] = useState<'auto' | 'manual'>('auto');
  const [portalPwdValue, setPortalPwdValue] = useState('');
  const [portalPwdShow, setPortalPwdShow] = useState(false);
  const [portalPwdSending, setPortalPwdSending] = useState(false);
  const [showRRHHAlerts, setShowRRHHAlerts] = useState(false);

  const inputClass = "w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all";
  const selectClass = "w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none";
  const labelClass = "text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1 block ml-1";

  // --- HOOKS ---
  useEffect(() => {
    const auth = getAuth();
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUserName(user.displayName || user.email || "Usuario Sin Nombre");
      } else {
        setCurrentUserName("No Logueado");
      }
    });
  }, []);
  const registrarAuditoria = async (accion: string, detalle: string) => { try { const auth = getAuth(); const u = auth.currentUser; await addDoc(collection(db, 'audit_logs'), { timestamp: serverTimestamp(), actorUid: u?.uid || "unknown", actorName: u?.displayName || u?.email || "Desc", action: accion, module: 'RRHH', details: detalle, empresaId, metadata: { platform: 'web' } }); } catch (error) {} };

  const getCycleDates = (refDate: Date, startDay: number = 26) => { const year = refDate.getFullYear(); const month = refDate.getMonth(); const start = new Date(year, month - 1, startDay); start.setHours(0,0,0,0); const end = new Date(year, month, startDay - 1); end.setHours(23,59,59,999); return { start, end }; };

  const replicarAusenciaEnPlanificador = async (absenceId: string, data: Absence) => {
    try {
      if (!data.employeeId?.trim()) {
        addToast('No se puede replicar: la ausencia no tiene empleado asignado.', 'error');
        return;
      }
      const range = validateAbsenceDateRange(data.startDate, data.endDate);
      if (!range.ok) return;
      const turnosQ = query(collection(db, 'turnos'), where('absenceId', '==', absenceId));
      await queryAndDeleteForEmpresa('turnos', turnosQ, empresaId, migracionCompleta);
      const [sY, sM, sD] = range.startDate.split('-').map(Number);
      const [eY, eM, eD] = range.endDate.split('-').map(Number);
      const start = new Date(sY, sM - 1, sD);
      const end = new Date(eY, eM - 1, eD);
      const code = inferAbsenceCode(data);
      const emp = employees.find(e => e.id === data.employeeId);
      const portal = data as Absence & { objectiveId?: string; objectiveName?: string; clientId?: string };
      const objectiveId =
        String(portal.objectiveId ?? '').trim() ||
        String(emp?.preferredObjectiveId ?? '').trim();
      const objRow = allObjectives.find(o => o.id === objectiveId || o.docId === objectiveId);
      const clientId =
        String(portal.clientId ?? '').trim() ||
        String(objRow?.clientId ?? '').trim();
      const objectiveName =
        String(portal.objectiveName ?? '').trim() ||
        objRow?.name ||
        (objectiveId ? `Objetivo ${objectiveId}` : `NOVEDAD - ${data.type}`);
      const absenceCreatedAt = new Date().toISOString();
      const batch = writeBatch(db);

      const rangeStartTs = Timestamp.fromDate(new Date(sY, sM - 1, sD, 0, 0, 0));
      const rangeEndTs   = Timestamp.fromDate(new Date(eY, eM - 1, eD, 23, 59, 59));
      try {
        const originalTurnosSnap = await getDocs(query(
          collection(db, 'turnos'),
          where('employeeId', '==', data.employeeId),
          where('startTime', '>=', rangeStartTs),
          where('startTime', '<=', rangeEndTs),
        ));
        originalTurnosSnap.forEach(docSnap => {
          const t = docSnap.data();
          if (!belongsToEmpresaView(t, empresaId, migracionCompleta)) return;
          if (t.type === 'NOVEDAD' || t.hasNovedad || t.isAbsent || t.isFranco) return;
          batch.update(docSnap.ref, {
            hasNovedad: true,
            isAbsent: true,
            absenceId,
            absenceType: data.type,
            absenceCreatedAt,
          });
        });
      } catch (queryErr) {
        console.warn('[replicarAusencia] No se pudieron marcar turnos originales (índice o permisos):', queryErr);
      }

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        const isPeriodOnly = code === 'V';
        const dayEnd = isPeriodOnly
          ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
          : new Date(dayStart.getTime() + 8 * 3600000);
        const turnoRef = doc(collection(db, 'turnos'));
        const turnoPayload: Record<string, unknown> = {
          employeeId: data.employeeId,
          employeeName: data.employeeName,
          startTime: Timestamp.fromDate(dayStart),
          endTime: Timestamp.fromDate(dayEnd),
          hours: isPeriodOnly ? 0 : 8,
          type: 'NOVEDAD',
          code,
          status: 'Approved',
          absenceId,
          isFranco: false,
          hasNovedad: true,
          plannedNovedad: data.type?.includes('Licencia') ? 'LICENCIA' : 'AVISO',
          comments: data.reason || '',
        };
        if (objectiveId) turnoPayload.objectiveId = objectiveId;
        if (objectiveName) turnoPayload.objectiveName = objectiveName;
        if (clientId) turnoPayload.clientId = clientId;
        batch.set(turnoRef, stampEmpresaId(turnoPayload, empresaId));
      }
      await batch.commit();
    } catch (e) {
      console.error('[replicarAusencia]', e);
      const msg =
        e instanceof TenantIsolationError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Error replicando';
      addToast(msg.length > 120 ? `${msg.slice(0, 120)}…` : msg, 'error');
    }
  };

  const eliminarReplicasPlanificador = async (absenceId: string) => {
    try {
      const turnosQ = query(collection(db, 'turnos'), where('absenceId', '==', absenceId));
      await queryAndDeleteForEmpresa('turnos', turnosQ, empresaId, migracionCompleta);
    } catch {
      /* noop */
    }
  };

  useEffect(() => { loadData(); loadClientsAndObjectives(); loadAbsences(); loadHolidays(); loadAgreements(); }, [empresaId, migracionCompleta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scopeEmpresa && !empresaId) {
      setPendingPortalRequests([]);
      return;
    }
    const unsub = onSnapshotFresh(
      scopeEmpresa
        ? query(collection(db, 'ausencias'), where('empresaId', '==', empresaId), where('source', '==', 'EMPLEADO'), where('status', '==', 'Pendiente'), limit(50))
        : query(collection(db, 'ausencias'), where('source', '==', 'EMPLEADO'), where('status', '==', 'Pendiente'), limit(50)),
      snap => {
        const docs = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((a: any) => a.type !== 'Injustificada');
        docs.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setPendingPortalRequests(docs);
      }
    );
    return () => unsub();
  }, [empresaId, scopeEmpresa]);
  useEffect(() => { const activeAbs = absences.filter(a => a.status === 'Pendiente' || a.status === 'Justificada').length; const nextHols = holidays.filter(h => new Date(h.date) >= new Date()).length; setGlobalStats({ totalEmployees: employees.length, activeAbsences: activeAbs, nextHolidays: nextHols }); }, [employees, absences, holidays]);
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    setFilteredEmployees(employees.filter(e => {
      const matchesTerm = (e.lastName || '').toLowerCase().includes(term) || (e.firstName || '').toLowerCase().includes(term) || (e.fileNumber || '').includes(term);
      const isActive = e.status === 'activo' || e.status === 'active' || !e.status;
      const matchesStatus = showInactive ? !isActive : isActive;
      const obj = allObjectives.find((o: any) => o.id === filterObjective);
      const matchesObjective = !filterObjective
        ? true
        : filterObjective === '__sin_objetivo__'
          ? !e.preferredObjectiveId
          : (obj?.allIds ?? [filterObjective]).includes(e.preferredObjectiveId);
      const matchesCoords = !filterNoCoords || (!e.lat && !e.lng);
      return matchesTerm && matchesStatus && matchesObjective && matchesCoords;
    }));
  }, [searchTerm, employees, showInactive, filterObjective, allObjectives, filterNoCoords]);
  const dashboardStats = useMemo(() => {
    const y = currentDate.getFullYear(), m = currentDate.getMonth();
    const monthStart = new Date(y, m, 1), monthEnd = new Date(y, m + 1, 0);
    const toDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v === 'string') return new Date(v + 'T00:00:00');
      if (typeof v.toDate === 'function') return v.toDate();
      if (v.seconds) return new Date(v.seconds * 1000);
      return null;
    };
    const activos = employees.filter(e => e.status === 'activo' || e.status === 'active' || !e.status);
    const bajas = employees.filter(e => {
      if (e.status !== 'baja' && e.status !== 'inactive') return false;
      const d = toDate(e.fechaBaja);
      return d && d >= monthStart && d <= monthEnd;
    });
    const altas = employees.filter(e => {
      const d = toDate(e.startDate);
      return d && d >= monthStart && d <= monthEnd;
    });
    const sinEmail   = activos.filter(e => !e.email);
    const sinPortal  = activos.filter(e => e.email && !(e as any).portalInvite?.sent);
    // ausencias del mes actual
    const ausMonth = absences.filter(a => {
      const d = toDate(a.startDate);
      return d && d >= monthStart && d <= monthEnd;
    });
    const injust = ausMonth.filter(a => {
      const t = (a.type || '').toLowerCase();
      return t.includes('injust') || t === 'aa' || t === 'no_presentacion' || t.includes('no presentaci');
    });
    const sinCert = ausMonth.filter(a => {
      const t = (a.type || '').toLowerCase();
      return (t.includes('enferm') || t === 'e') && !a.hasCertificate;
    });
    const workDays = 22;
    const tasaAus = activos.length > 0 ? ((ausMonth.length / (activos.length * workDays)) * 100).toFixed(1) : '0.0';
    return { activos: activos.length, bajas: bajas.length, altas: altas.length, sinEmail: sinEmail.length, sinPortal: sinPortal.length, ausencias: ausMonth.length, injustificadas: injust.length, sinCertificado: sinCert.length, tasaAusentismo: tasaAus };
  }, [employees, absences, currentDate]);

  const absencePeriods = useMemo(() => {
    const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const seen = new Set<string>();
    absences.forEach(a => { if (a.startDate) { const [y, m] = a.startDate.split('-'); if (y && m) seen.add(`${y}-${m}`); } });
    return Array.from(seen).sort().reverse().map(v => {
      const [y, m] = v.split('-');
      return { value: v, label: `${monthNames[parseInt(m, 10) - 1]} ${y}` };
    });
  }, [absences]);
  const absenceCalendarCells = useMemo(() => {
    const [y, m] = absenceCalendarMonth.split('-').map(Number);
    if (!y || !m) return [] as (string | null)[];
    const first = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0).getDate();
    const startPad = first.getDay();
    const cells: (string | null)[] = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) {
      cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return cells;
  }, [absenceCalendarMonth]);
  const toggleAbsenceCalendarDay = (day: string) => {
    setAbsenceSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  };
  useEffect(() => {
    const term = absenceSearchTerm.toLowerCase();
    setFilteredAbsences(absences.filter(a => {
      const name = a.employeeName || '';
      let searchableName = name;
      if (!name && a.employeeId) { const emp = employees.find(e => e.id === a.employeeId); if (emp) searchableName = `${emp.lastName} ${emp.firstName}`; }
      const matchesSearch = searchableName.toLowerCase().includes(term);
      const matchesType = !absenceTypeFilter || a.type === absenceTypeFilter;
      const matchesStatus = !absenceStatusFilter || a.status === absenceStatusFilter;
      const end = a.endDate || a.startDate || '';
      const matchesDate = absenceDateFilterMode === 'month'
        ? (!absencePeriodFilter || (a.startDate && a.startDate.startsWith(absencePeriodFilter)))
        : (absenceSelectedDays.size === 0
          ? (a.startDate && a.startDate.startsWith(absenceCalendarMonth))
          : [...absenceSelectedDays].some((day) => a.startDate && day >= a.startDate && day <= end));
      return matchesSearch && matchesType && matchesStatus && matchesDate;
    }));
    setSelectedAbsenceIds(new Set());
  }, [absenceSearchTerm, absenceTypeFilter, absenceStatusFilter, absencePeriodFilter, absenceDateFilterMode, absenceCalendarMonth, absenceSelectedDays, absences, employees]);
  useEffect(() => { if (form.laborAgreement) { const selectedAgreement = agreements.find(a => a.name === form.laborAgreement); setAvailableCategories(selectedAgreement?.categories?.length ? selectedAgreement.categories : ['General']); } else { setAvailableCategories([]); } }, [form.laborAgreement, agreements]);
  
  useEffect(() => { if (selectedEmp && holidays.length > 0) { calculateStats(selectedEmp.id!, selectedEmp.laborAgreement || '', selectedEmp.cycleStartDay || 26); } }, [currentDate, selectedEmp, holidays, agreements]);

  // --- CARGA DE DATOS RAW (SIN FILTROS DE SERVICIO) ---
  const loadData = async () => {
      try {
          const snapshot = await getDocs(
            scopeEmpresa
              ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
              : collection(db, 'empleados'),
          );
          const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setEmployees(data.sort((a: any, b: any) => (a.lastName || '').localeCompare(b.lastName || '')));
      } catch (e) {
          console.error("Error cargando empleados:", e);
      }
  };

  const loadAbsences = async () => {
    const data = await absenceService.getAll({ empresaId, scopeEmpresa });
    setAbsences(data);
  };
  const loadHolidays = async () => { const data = await holidayService.getForEmpresa(empresaId); setHolidays(data); };
  const loadAgreements = async () => { const data = await agreementService.getAll(); setAgreements(data.map(a => ({...a, categories: Array.isArray(a.categories) ? a.categories : [], paysDoubleOnFranco: !!a.paysDoubleOnFranco} as ExtendedAgreement))); };
  const loadClientsAndObjectives = async () => {
    try {
      const cSnap = await getDocs(
        scopeEmpresa
          ? query(collection(db, 'clients'), where('empresaId', '==', empresaId))
          : collection(db, 'clients'),
      );
      const clientsData = cSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((c: any) => belongsToEmpresaView(c, empresaId, migracionCompleta));
      setClients(clientsData);
      // Dedup case-insensitive por nombre. Distintos IDs del mismo objetivo (por períodos
      // o duplicados de datos) se agrupan en allIds[] para que el filtro los matchee todos.
      const nameMap = new Map();
      for (const client of clientsData) {
        for (const obj of (client as any).objetivos || []) {
          if (!obj.id || !obj.name) continue;
          const key = String(obj.name).toLowerCase().trim();
          const existing = nameMap.get(key);
          if (existing) { if (!existing.allIds.includes(obj.id)) existing.allIds.push(obj.id); }
          else nameMap.set(key, { id: obj.id, allIds: [obj.id], name: String(obj.name).trim(), clientId: client.id });
        }
      }
      setAllObjectives(Array.from(nameMap.values()));
    } catch (e) {}
  };

  // --- PORTAL DE EMPLEADOS ---
  const sendPortalInvites = async (empIds: string[]) => {
    const valid = empIds.filter(id => { const e = employees.find(x => x.id === id); return e && (e as any).email; });
    if (!valid.length) { addToast('Los empleados seleccionados no tienen email registrado', 'error'); return; }
    try {
      const cf = getFunctions();
      const createPortalAccess = httpsCallable(cf, 'createPortalAccess');
      const result: any = await createPortalAccess({ employeeIds: valid });
      const results: any[] = result.data?.results || [];
      const sent = results.filter((r: any) => r.success).length;
      const failed = results.length - sent;
      if (sent > 0) addToast(`✓ ${sent} acceso${sent > 1 ? 's' : ''} enviado${sent > 1 ? 's' : ''} correctamente`, 'success');
      if (failed > 0) addToast(`${failed} sin email o con error`, 'error');
      await loadData();
    } catch (err: any) { addToast('Error al crear accesos: ' + (err?.message || err), 'error'); }
  };

  const handleSendPortalOne = async (emp: any) => {
    if (!emp.id) return;
    if (!emp.email) { addToast('Este empleado no tiene email registrado', 'error'); return; }
    const action = (emp as any).portalInvite?.sent ? 'reenviar' : 'enviar';
    if (!confirm(`¿${action === 'reenviar' ? 'Reenviar' : 'Enviar'} acceso al portal a:\n\n${emp.lastName}, ${emp.firstName}\n${emp.email}\n\nEl empleado recibirá un email para crear su contraseña.`)) return;
    setSendingPortalIds(prev => new Set([...prev, emp.id]));
    await sendPortalInvites([emp.id]);
    setSendingPortalIds(prev => { const n = new Set(prev); n.delete(emp.id); return n; });
  };

  const handleResetPortalAll = async () => {
    const sent = employees.filter((e: any) => (e as any).portalInvite?.sent);
    if (!sent.length) { addToast('Ningún empleado tiene acceso enviado', 'info'); return; }
    if (!confirm(`¿Resetear el estado de portal de ${sent.length} empleado${sent.length > 1 ? 's' : ''}?\n\nEsto no elimina sus cuentas de Firebase Auth, solo marca que pueden recibir la invitación de nuevo.\n¿Confirmar?`)) return;
    try {
      const batch = writeBatch(db);
      sent.forEach((e: any) => { batch.update(doc(db, 'empleados', e.id), { portalInvite: deleteField() }); });
      await batch.commit();
      addToast(`Reset aplicado a ${sent.length} empleados`, 'success');
      await loadData();
    } catch (err: any) { addToast('Error al resetear: ' + err.message, 'error'); }
  };


  const generateRandomPassword = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
    let pwd = '';
    for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
  };

  const openPortalPwdModal = (emp: any) => {
    if (!emp.email) { addToast('Este empleado no tiene email registrado', 'error'); return; }
    setPortalPwdEmp(emp);
    setPortalPwdMode('auto');
    setPortalPwdValue(generateRandomPassword());
    setPortalPwdShow(false);
    setShowPortalPwdModal(true);
  };

  const handleConfirmPortalPassword = async () => {
    if (!portalPwdEmp) return;
    const pwd = portalPwdValue.trim();
    if (!pwd || pwd.length < 6) { addToast('La contraseña debe tener al menos 6 caracteres', 'error'); return; }
    setPortalPwdSending(true);
    try {
      const cf = getFunctions();
      const setPortalPwd = httpsCallable(cf, 'setEmployeePortalPassword');
      const _actor = getAuth().currentUser?.displayName || getAuth().currentUser?.email?.split('@')[0] || 'Admin';
      await setPortalPwd({ employeeId: portalPwdEmp.id, password: pwd, actorName: _actor });
      addToast('Contraseña establecida para ' + portalPwdEmp.lastName + ', ' + portalPwdEmp.firstName, 'success');
      setShowPortalPwdModal(false);
      await loadData();
    } catch (err: any) {
      addToast('Error: ' + (err?.message || String(err)), 'error');
    } finally {
      setPortalPwdSending(false);
    }
  };

  const handleSendPortalAll = async () => {
    const pendingEmps = employees.filter((e: any) => !(e as any).portalInvite?.sent && (e as any).email);
    if (!pendingEmps.length) { addToast('Todos los empleados con email ya tienen acceso enviado', 'info'); return; }
    const preview = pendingEmps.slice(0, 5).map((e: any) => `• ${e.lastName}, ${e.firstName} (${e.email})`).join('\n');
    const extra = pendingEmps.length > 5 ? `\n  ...y ${pendingEmps.length - 5} más` : '';
    if (!confirm(`Se enviará el acceso al portal a ${pendingEmps.length} empleado${pendingEmps.length > 1 ? 's' : ''}:\n\n${preview}${extra}\n\nCada uno recibirá un email para crear su contraseña.\n¿Confirmar envío?`)) return;
    setSendingAllPortal(true);
    await sendPortalInvites(pendingEmps.map((e: any) => e.id!));
    setSendingAllPortal(false);
  };

  // --- CALCULO ESTADISTICAS ---
  const calculateStats = async (empId: string, empAgreementName: string, cycleStartDay: number = 26) => {
      setLoadingStats(true);
      try {
          const ruleBase: ExtendedAgreement = agreements.find(a => a.name === empAgreementName) || initialAgreement;
          const rule = { ...ruleBase, holidayIsPlus: ruleBase.holidayIsPlus ?? true, paysDoubleOnFranco: ruleBase.paysDoubleOnFranco ?? true };
          // Respetar el ciclo de liquidación del empleado (ej: día 26 → abr/26 a may/25)
          const { start: firstDay, end: lastDay } = getCycleDates(currentDate, cycleStartDay);

          const qTurnos = query(collection(db, 'turnos'), where('employeeId', '==', empId));
          const turnosSnap = await getDocs(qTurnos);
          const firstMs = firstDay.getTime();
          const lastMs  = lastDay.getTime();
          const sortedDocs = turnosSnap.docs
              .map(d => ({ ...d.data(), id: d.id }))
              .filter((d: any) => {
                  const ts = d.startTime?.seconds ? d.startTime.seconds * 1000 : null;
                  return ts !== null && ts >= firstMs && ts <= lastMs;
              })
              .sort((a: any, b: any) => a.startTime.seconds - b.startTime.seconds);
          
          const qAusencias = query(collection(db, 'ausencias'), where('employeeId', '==', empId));
          const ausenciasSnap = await getDocs(qAusencias);
          let totalVacaciones = 0, totalLicencias = 0, totalAusencias = 0, totalEnfermedad = 0;
          
          const parseAusDate = (val: any): Date | null => {
              if (!val) return null;
              if (typeof val === 'string') { const [y, m, d] = val.split('-').map(Number); return new Date(y, m - 1, d); }
              if (typeof val.toDate === 'function') return val.toDate();
              if (val.seconds) return new Date(val.seconds * 1000);
              return null;
          };
          ausenciasSnap.docs.forEach(doc => {
             const data = doc.data();
             const start = parseAusDate(data.startDate);
             const end   = parseAusDate(data.endDate);
             if (!start || !end) return;
             if (start <= lastDay && end >= firstDay) {
                 const daysCount = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                 const type = (data.type || '').toLowerCase();
                 if (type.includes('vacaci')) totalVacaciones += daysCount;
                 else if (type.includes('enfermedad') || type.includes('art')) totalEnfermedad += daysCount;
                 else if (type.includes('licencia')) totalLicencias += daysCount;
                 else totalAusencias += daysCount;
             }
          });

          // Contar también los turnos con isAbsent:true como ausencias del ciclo
          sortedDocs.forEach((d: any) => {
              const st = (d.status || '').toLowerCase();
              if (d.isAbsent === true || st.includes('absent') || st.includes('ausent')) {
                  totalAusencias++;
              }
          });

          let hoursTotalOperativas = 0, totalNocturnas = 0, totalDiurnas = 0, totalPlanificado = 0, totalRealizado = 0, hoursOnFranco = 0, hoursOnHoliday = 0, totalFrancos = 0, tardanzasCount = 0;
          let objectivesMap = new Map();
          const monthHolidays: {[key: string]: boolean} = {}; holidays.forEach(h => { monthHolidays[h.date] = true; });

          sortedDocs.forEach((d:any) => { if (d.code === 'F' || d.isFranco || d.code === 'FF') totalFrancos++; });

          const nightStart = rule?.nightShiftStart ?? 21;
          const nightEnd   = rule?.nightShiftEnd   ?? 6;

          sortedDocs.forEach((d:any) => {
              const st = (d.status || '').toLowerCase();
              if (st.includes('cancel') || st.includes('delet')) return;
              const rawCode = (d.code || '').trim().toUpperCase();
              if (d.type === 'NOVEDAD' || !isOperativeCodeRRHH(rawCode)) return;
              if (d.isLate === true) tardanzasCount++;

              if (!d.startTime?.toDate || !d.endTime?.toDate) return;
              const start = d.startTime.toDate();
              const end = d.endTime.toDate();
              let duration = (end.getTime() - start.getTime()) / 3600000;
              if (duration < 0 || duration > 24) duration = SHIFT_HOURS_LOOKUP[rawCode] || 8;

              const night = getNightDuration(start, end, nightStart, nightEnd);
              const day   = Math.max(0, duration - night);

              totalPlanificado += duration;

              const dateKey   = getArgentinaDate(d.startTime);
              const isFeriado = monthHolidays[dateKey];
              const isFT      = d.isFrancoTrabajado || rawCode === 'FT';
              if (isFeriado) hoursOnHoliday += duration;
              if (isFT) { hoursOnFranco += duration; }
              else { hoursTotalOperativas += duration; totalNocturnas += night; totalDiurnas += day; }

              // Horas reales con clamp (ingreso anticipado → hora plan; ±5min egreso → hora plan)
              const isAbsentShift = d.isAbsent === true || st.includes('absent') || st.includes('ausent');
              if (!isAbsentShift && end <= new Date()) {
                  const rStartRaw = d.realStartTime?.seconds ? new Date(d.realStartTime.seconds * 1000)
                                  : d.checkInTime?.seconds  ? new Date(d.checkInTime.seconds * 1000)
                                  : null;
                  const rEndRaw   = d.realEndTime?.seconds   ? new Date(d.realEndTime.seconds * 1000)
                                  : d.checkOutTime?.seconds  ? new Date(d.checkOutTime.seconds * 1000)
                                  : null;
                  const rStart = rStartRaw ? ((rStartRaw.getTime() - start.getTime()) / 60000 <= 5 ? start : rStartRaw) : null;
                  const rEnd   = rEndRaw   ? (Math.abs((rEndRaw.getTime() - end.getTime()) / 60000) <= 5 ? end : rEndRaw) : null;
                  if (rStart && rEnd) {
                      const rDur = (rEnd.getTime() - rStart.getTime()) / 3600000;
                      totalRealizado += (rDur >= 0 && rDur <= 36) ? rDur : duration;
                  } else {
                      totalRealizado += duration;
                  }
              }

              let objName = "Sin Asignar";
              if (d.objectiveId) {
                  const found = allObjectives.find(o => o.id === d.objectiveId);
                  if (found) objName = found.name;
              } else if (d.objectiveName && !d.objectiveName.includes("undefined")) {
                  objName = d.objectiveName;
                  if (objName.length > 15 && !objName.includes(" ")) {
                       const found = allObjectives.find(o => o.id === objName);
                       if(found) objName = found.name;
                  }
              }
              if (objName === "Sin Asignar" && d.clientId) {
                  const client = clients.find(c => c.id === d.clientId);
                  objName = client ? `Cliente: ${client.name}` : `Cliente: ${d.clientId}`;
              }
              objectivesMap.set(objName, (objectivesMap.get(objName) || 0) + duration);
          });

          const baseLimit  = rule.maxHoursMonthly || 200;
          const excess     = Math.max(0, hoursTotalOperativas - baseLimit);
          const simpleHours = Math.min(hoursTotalOperativas, baseLimit);
          const round1 = (n: number) => Math.round(n * 10) / 10;

          setEmpStats({
              totalPlanificado: round1(totalPlanificado),
              totalRealizado:   round1(totalRealizado),
              progress: totalPlanificado > 0 ? Math.round((totalRealizado / totalPlanificado) * 100) : 0,
              nightHours: round1(totalNocturnas),
              dayHours:   round1(totalDiurnas),
              extra100: round1(hoursOnFranco),
              extra50:  round1(excess),
              plusFeriado: round1(hoursOnHoliday),
              francosCount: totalFrancos,
              vacationsCount: totalVacaciones,
              licensesCount: totalLicencias + totalEnfermedad,
              absencesCount: totalAusencias,
              tardanzasCount,
              objectives: Array.from(objectivesMap.entries()).map(([name, hours]) => ({ name, hours })),
              shiftsCount: sortedDocs.filter((d:any) => isOperativeCodeRRHH((d.code||'').trim())).length,
              monthlyLimit: rule.maxHoursMonthly,
              isOverLimit: hoursTotalOperativas > rule.maxHoursMonthly,
              reportData: { turnos: sortedDocs, ausencias: ausenciasSnap.docs.map(d=>d.data()) }
          });

      } catch (e) { console.error(e); addToast('Error stats', 'error'); } finally { setLoadingStats(false); }
  };
  
  const changeMonth = (delta: number) => { const newDate = new Date(currentDate); newDate.setMonth(newDate.getMonth() + delta); setCurrentDate(newDate); };
  const handleRowClick = (emp: Employee) => { setSelectedEmp(emp); };
  
  // --- GUARDADO MANUAL (RAW DIRECTO) ---
  const handleSave = async () => { 
      if (!form.lastName) return addToast('El apellido es obligatorio', 'error'); 
      
      const dataToSave = {
          firstName: form.firstName || '',
          lastName: form.lastName || '',
          name: `${form.lastName || ''}, ${form.firstName || ''}`.toUpperCase(),
          dni: form.dni || '',
          cuil: form.cuil || '',
          fileNumber: form.fileNumber || '',
          email: form.email || '',
          phone: form.phone || '',
          address: form.address || '',
          lat: form.lat || null,
          lng: form.lng || null,
          category: form.category || 'Vigilador',
          cct: form.cct || '',
          laborAgreement: form.laborAgreement || '',
          status: form.status || 'activo',
          role: 'employee',
          contractType: form.contractType || 'FullTime',
          periodType: form.periodType || 'Mensual',
          startDate: form.startDate || new Date().toISOString().split('T')[0],
          cycleStartDay: form.cycleStartDay ? parseInt(form.cycleStartDay) : 26,
          maxHours: form.maxHours || 200,
          preferredClientId: form.preferredClientId || '',
          preferredObjectiveId: form.preferredObjectiveId || '',
          sizes: form.sizes || { shirt: '', pants: '', shoes: '' },
          restriccionesObjetivo: form.restriccionesObjetivo || [],
          restriccionesCliente: form.restriccionesCliente || [],
          conflictosEmpleados: form.conflictosEmpleados || [],
          genero: form.genero || '',
          volante: form.volante || [],
          empresaId,
      };

      try { 
          if (isEditing && form.id) { 
              await updateDocForEmpresa('empleados', form.id, dataToSave, empresaId, migracionCompleta);
              await registrarAuditoria('UPDATE_EMPLOYEE', `Modificó legajo: ${form.fileNumber} - ${form.lastName}`); 
          } else {
              if (form.dni && employees.some(e => e.id !== form.id && e.dni === form.dni))
                return addToast('Ya existe un empleado con ese DNI', 'error');
              if (form.fileNumber && employees.some(e => e.id !== form.id && e.fileNumber === form.fileNumber))
                return addToast('Ya existe un empleado con ese número de legajo', 'error');
              await addDoc(collection(db, 'empleados'), dataToSave);
              await registrarAuditoria('CREATE_EMPLOYEE', `Creó legajo: ${form.fileNumber} - ${form.lastName}`); 
          } 
          
          addToast('Empleado guardado correctamente', 'success');
          await loadData(); 
          setView('list'); 
          setSelectedEmp(null); 
      } catch (e) { 
          console.error(e); 
          addToast('Error al guardar', 'error'); 
      } 
  };

  // --- GEOLOCALIZACION ---

  const handleGeocode = async () => {
      if (!form.address) return addToast('Ingrese una dirección primero', 'warning');
      setIsGeocoding(true);
      setShowManualCoords(false);
      try {
          const result = await geocodeAddress(form.address.trim());
          if (result) {
              setForm({ ...form, lat: result.lat, lng: result.lon });
              addToast(`Ubicación encontrada: ${result.display_name.split(',').slice(0, 2).join(',')}`, 'success');
          } else {
              addToast('No se encontró la dirección. Podés ingresar las coordenadas manualmente.', 'warning');
              setShowManualCoords(true);
          }
      } catch (e) {
          console.error(e);
          addToast('Error conectando el servicio de mapas', 'error');
          setShowManualCoords(true);
      } finally {
          setIsGeocoding(false);
      }
  };

  const [isBulkGeocoding, setIsBulkGeocoding] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; failed: number } | null>(null);

  const handleBulkGeocode = async () => {
      const pending = employees.filter(e => e.status !== 'inactivo' && e.address && !e.lat && !e.lng);
      if (pending.length === 0) return addToast('Todos los empleados activos ya tienen coordenadas o no tienen dirección cargada.', 'info');
      if (!confirm(`Geolocalizar automáticamente ${pending.length} empleados sin coordenadas?\n\nEsto puede tardar ${Math.ceil(pending.length * 1.2)} segundos aprox.`)) return;
      setIsBulkGeocoding(true);
      setGeoFailedList([]);
      setBulkProgress({ done: 0, total: pending.length, failed: 0 });
      let done = 0; let failed = 0;
      const failedNames: string[] = [];
      for (const emp of pending) {
          try {
              const result = await geocodeAddress(emp.address!);
              if (result) {
                  await updateDoc(doc(db, 'empleados', emp.id!), { lat: result.lat, lng: result.lon });
                  done++;
              } else {
                  failed++;
                  failedNames.push(`${emp.lastName || ''} ${emp.firstName || ''}`.trim() || emp.id);
              }
          } catch {
              failed++;
              failedNames.push(`${emp.lastName || ''} ${emp.firstName || ''}`.trim() || emp.id);
          }
          setBulkProgress({ done: done + failed, total: pending.length, failed });
          await new Promise(r => setTimeout(r, 1200));
      }
      setIsBulkGeocoding(false);
      setBulkProgress(null);
      await loadData();
      if (failedNames.length > 0) {
          setGeoFailedList(failedNames);
          setFilterNoCoords(true); // activa el filtro automáticamente
          addToast(`${done} geolocalizados. ${failed} sin resultado — filtrando la lista.`, 'warning');
      } else {
          addToast(`Todos los ${done} empleados fueron geolocalizados correctamente.`, 'success');
      }
  };

  const handleSaveManualCoords = () => {
      const lat = parseFloat(manualLat.replace(',', '.'));
      const lng = parseFloat(manualLng.replace(',', '.'));
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          return addToast('Coordenadas inválidas', 'error');
      }
      setForm({ ...form, lat: String(lat), lng: String(lng) });
      setShowManualCoords(false);
      setManualLat(''); setManualLng('');
      addToast('Coordenadas guardadas manualmente', 'success');
  };
  
  const handleDelete = async (id: string) => {
    const emp = employees.find(e => e.id === id);
    if (!confirm(`¿Eliminar legajo ${emp?.fileNumber || id}?`)) return;
    try {
      await deleteEmployeeForEmpresa(id, empresaId, migracionCompleta);
      await registrarAuditoria('DELETE_EMPLOYEE', `Eliminó legajo: ${emp?.fileNumber} - ${emp?.lastName}`);
      loadData();
      setSelectedEmp(null);
    } catch (e) {
      addToast(e instanceof TenantIsolationError ? e.message : 'Error al eliminar', 'error');
    }
  };

  const handleDarDeBaja = async () => {
    if (!selectedEmp?.id) return;
    try {
      await updateDocForEmpresa('empleados', selectedEmp.id, {
        status: 'inactivo',
        motivoBaja: bajaForm.motivo,
        fechaBaja: bajaForm.fecha,
        observacionBaja: bajaForm.observacion || '',
      }, empresaId, migracionCompleta);
      await registrarAuditoria('BAJA_EMPLEADO', `Baja: ${selectedEmp.lastName}, ${selectedEmp.firstName} | Motivo: ${bajaForm.motivo} | Fecha: ${bajaForm.fecha}`);
      addToast(`${selectedEmp.lastName} dado de baja (${bajaForm.motivo})`, 'success');
      setShowBajaModal(false);
      loadData();
      setSelectedEmp(null);
    } catch (e) { addToast('Error al dar de baja', 'error'); }
  };

  const handleReactivar = async (emp: any) => {
    if (!emp?.id || !confirm(`¿Reactivar a ${emp.lastName}, ${emp.firstName}?`)) return;
    try {
      await updateDocForEmpresa('empleados', emp.id, { status: 'activo', motivoBaja: null, fechaBaja: null, observacionBaja: null }, empresaId, migracionCompleta);
      await registrarAuditoria('REACTIVACION_EMPLEADO', `Reactivó: ${emp.lastName}, ${emp.firstName}`);
      addToast(`${emp.lastName} reactivado`, 'success');
      loadData();
      setSelectedEmp(null);
    } catch (e) { addToast('Error al reactivar', 'error'); }
  };
  const handleDeleteAll = async () => {
    if (!confirm('BORRAR TODO?')) return;
    setIsDeletingAll(true);
    try {
      for (const emp of employees) {
        if (emp.id) await deleteEmployeeForEmpresa(emp.id, empresaId, migracionCompleta);
      }
      await registrarAuditoria('DELETE_ALL', 'Eliminación masiva');
      addToast('Eliminados.', 'success');
      loadData();
    } catch (e) {
      addToast(e instanceof TenantIsolationError ? e.message : 'Error en eliminación masiva', 'error');
    } finally {
      setIsDeletingAll(false);
    }
  };
  const openNew = () => { setForm(initialForm); setIsEditing(false); setView('form'); setSelectedEmp(null); setActiveFormTab('PERSONAL'); };
  const openEditFromDetail = () => { if (!selectedEmp) return; setForm({ ...initialForm, ...selectedEmp, id: selectedEmp.id }); setIsEditing(true); setView('form'); setSelectedEmp(null); setActiveFormTab('PERSONAL'); };
  const handleSaveHoliday = async () => { if(!holidayForm.name) return; await holidayService.add(holidayForm, empresaId); await registrarAuditoria('CREATE_HOLIDAY', `Feriado: ${holidayForm.name}`); setHolidayForm({ date: '', name: '', type: 'Nacional' }); loadHolidays(); };
  const handleDeleteHoliday = async (id: string) => { await holidayService.delete(id); await registrarAuditoria('DELETE_HOLIDAY', `Feriado ID: ${id}`); loadHolidays(); };
  const handleSyncHolidays = async () => { setIsSyncing(true); try { await holidayService.syncWithGovApi(syncYear, empresaId); addToast(`Sync OK`, 'success'); loadHolidays(); } catch (e) { addToast('Error', 'error'); } finally { setIsSyncing(false); } };
  const handleAddCategory = () => { if (newCategory.trim()) { setAgreementForm({ ...agreementForm, categories: [...agreementForm.categories, newCategory.trim()] }); setNewCategory(''); }};
  const removeCategory = (idx: number) => { const newCats = [...agreementForm.categories]; newCats.splice(idx, 1); setAgreementForm({ ...agreementForm, categories: newCats }); };
  const handleSaveAgreement = async () => { if (!agreementForm.name) return; if (isEditingAgreement && agreementForm.id) { await agreementService.update(agreementForm.id, agreementForm); } else { await agreementService.add(agreementForm); } setAgreementForm(initialAgreement); setIsEditingAgreement(false); loadAgreements(); };
  const handleEditAgreement = (a: Agreement) => { setAgreementForm(a as ExtendedAgreement); setIsEditingAgreement(true); };
  const handleDeleteAgreement = async (id: string) => { if(confirm('?')) { await agreementService.delete(id); loadAgreements(); } };
  const handleOpenAbsenceModal = (absence?: Absence) => {
    if (absence) {
      const startDate = toCalendarDateStr(absence.startDate) || absence.startDate;
      const endDate = toCalendarDateStr(absence.endDate) || absence.endDate;
      let status = absence.status;
      if (absenceNeedsMedicalVerification(absence) && status === 'Autorizada') {
        status = 'En verificación';
      }
      setAbsenceForm({ ...absence, startDate, endDate, status });
      setIsEditingAbsence(true);
      setEmpSearch('');
      setEmpDropOpen(false);
    } else {
      setAbsenceForm(initialAbsenceForm);
      setIsEditingAbsence(false);
      setEmpSearch('');
      setEmpDropOpen(true);
    }
    setShowAbsenceModal(true);
  };

  const absenceEmployeeLabel = (empId: string, fallbackName?: string) => {
    const emp = employees.find(e => e.id === empId);
    if (emp) return `${emp.lastName}, ${emp.firstName}`;
    return fallbackName || '';
  };

  const filteredAbsenceEmployees = useMemo(() => {
    const q = empSearch.toLowerCase().trim();
    return employees
      .filter(e => e.status === 'activo' || e.status === 'active' || !e.status)
      .filter(e => {
        if (!q) return true;
        const haystack = [
          e.lastName,
          e.firstName,
          e.name,
          e.fileNumber,
          e.dni,
          e.cuil,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q)
          || `${e.lastName} ${e.firstName}`.toLowerCase().includes(q)
          || `${e.firstName} ${e.lastName}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));
  }, [employees, empSearch]);

  const absenceDateRangeError = useMemo(() => {
    const r = validateAbsenceDateRange(absenceForm.startDate, absenceForm.endDate);
    return r.ok ? '' : r.message;
  }, [absenceForm.startDate, absenceForm.endDate]);

  const handleSaveAbsence = async () => {
    if (!absenceForm.employeeId) return addToast('Seleccione un empleado', 'error');
    const range = validateAbsenceDateRange(absenceForm.startDate, absenceForm.endDate);
    if (!range.ok) return addToast(range.message, 'error');
    if (absenceForm.status === 'Rechazada' && !absenceForm.rejectionReason?.trim()) return addToast('Ingrese el motivo de rechazo', 'error');
    const emp = employees.find(x => x.id === absenceForm.employeeId);
    const auth = getAuth();
    const u = auth.currentUser;
    const nombreReal = u?.displayName || u?.email || 'Usuario Desconocido';
    const absenceType = RRHH_ABSENCE_LABEL_TO_CODE[absenceForm.type] || inferAbsenceCode({ type: absenceForm.type });
    const dataToSave = {
      ...absenceForm,
      startDate: range.startDate,
      endDate: range.endDate,
      absenceType,
      employeeName: emp ? `${emp.lastName} ${emp.firstName}` : (absenceForm.employeeName || 'Desconocido'),
      comments: `${absenceForm.comments || ''} (Cargado por: ${nombreReal})`,
      createdBy: nombreReal,
      createdAt: new Date().toISOString(),
    };
    let savedId = '';
    try {
      if (isEditingAbsence && absenceForm.id) {
        await absenceService.update(absenceForm.id, dataToSave, { empresaId, migracionCompleta });
        savedId = absenceForm.id;
        await registrarAuditoria('UPDATE_ABSENCE', `Novedad: ${dataToSave.type}`);
        addToast('Actualizado', 'success');
      } else {
        const docRef = await absenceService.add(dataToSave, empresaId);
        savedId = docRef.id;
        await registrarAuditoria('CREATE_ABSENCE', `Novedad: ${dataToSave.type}`);
        addToast('Registrado', 'success');
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Error al guardar la novedad', 'error');
      return;
    }
    if (absenceReplicatesToPlanning(dataToSave)) {
      await replicarAusenciaEnPlanificador(savedId, { ...dataToSave, id: savedId });
      if (dataToSave.status === 'Autorizada' || dataToSave.status === 'Justificada') {
        await addDoc(collection(db, 'novedades'), stampEmpresaId({
          source: 'AUSENCIA',
          type: dataToSave.type,
          status: 'pending',
          employeeId: dataToSave.employeeId,
          employeeName: dataToSave.employeeName,
          startDate: dataToSave.startDate,
          endDate: dataToSave.endDate,
          ausenciaId: savedId,
          description: `${dataToSave.type} de ${dataToSave.employeeName} — ${dataToSave.startDate} al ${dataToSave.endDate}`,
          reportedBy: nombreReal,
          createdAt: serverTimestamp(),
        }, empresaId));
      }
    } else if (dataToSave.status === 'Rechazada') {
      await eliminarReplicasPlanificador(savedId);
    }
    setShowAbsenceModal(false);
    loadAbsences();
  };
  const handleDeleteAbsence = async (id: string) => {
    if (!confirm('¿Eliminar?')) return;
    try {
      await absenceService.delete(id, { empresaId, migracionCompleta });
      await eliminarReplicasPlanificador(id);
      await registrarAuditoria('DELETE_ABSENCE', 'Eliminó novedad');
      loadAbsences();
    } catch (e) {
      addToast(e instanceof TenantIsolationError ? e.message : 'Error al eliminar', 'error');
    }
  };
  const handleBulkDeleteAbsences = async () => {
    if (selectedAbsenceIds.size === 0) return;
    if (!confirm(`¿Eliminar ${selectedAbsenceIds.size} ausencia(s) seleccionada(s)? Esta acción no se puede deshacer.`)) return;
    const ids = [...selectedAbsenceIds];
    setBulkDeleting(true);
    setBulkDeleteProgress(0);
    try {
      let done = 0;
      for (const id of ids) {
        await absenceService.delete(id, { empresaId, migracionCompleta });
        await eliminarReplicasPlanificador(id);
        done++;
        setBulkDeleteProgress(Math.round((done / ids.length) * 100));
      }
      await registrarAuditoria('DELETE_ABSENCE', `Eliminó ${ids.length} ausencias (bulk)`);
      setSelectedAbsenceIds(new Set());
      loadAbsences();
      addToast(`${ids.length} ausencia(s) eliminada(s)`, 'success');
    } catch (e) {
      addToast(e instanceof TenantIsolationError ? e.message : 'Error al eliminar ausencias', 'error');
    } finally {
      setBulkDeleting(false);
      setBulkDeleteProgress(0);
    }
  };
  const handleVerifyMedicalSubmit = async (outcome: 'Justificada' | 'Injustificada') => {
    if (!verifyModal) return;
    setVerifyLoading(true);
    try {
      const dataToUpdate: Absence = {
        ...verifyModal.absence,
        status: outcome,
        type: outcome === 'Injustificada' ? 'Injustificada' : verifyModal.absence.type,
        hasCertificate: outcome === 'Justificada' ? true : verifyModal.absence.hasCertificate,
      };
      const { id: _omitId, ...updatePayload } = dataToUpdate;
      await absenceService.update(verifyModal.absenceId, updatePayload, { empresaId, migracionCompleta });
      await replicarAusenciaEnPlanificador(verifyModal.absenceId, dataToUpdate);
      await registrarAuditoria(
        'VERIFY_ABSENCE',
        `${outcome === 'Justificada' ? 'Justificó' : 'Marcó injustificada'} ${verifyModal.absence.type} — ${verifyModal.absence.employeeName}`,
      );
      addToast(outcome === 'Justificada' ? 'Enfermedad justificada' : 'Ausencia marcada como injustificada', 'success');
      setVerifyModal(null);
      loadAbsences();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Error al verificar', 'error');
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleAuthorizePinSubmit = async () => {
    if (!authPinModal) return;
    if (authPinValue.length < 4) { setAuthPinError('PIN mínimo 4 dígitos'); return; }
    setAuthPinLoading(true); setAuthPinError('');
    try {
      const snap = await getDocs(query(collection(db, 'system_users'), where('supervisorPin', '==', authPinValue)));
      if (snap.empty) { setAuthPinError('PIN incorrecto'); setAuthPinLoading(false); return; }
      const sup = snap.docs[0].data();
      const supervisorName = `${sup.firstName} ${sup.lastName}`;
      const dataToUpdate = { ...authPinModal.absence, status: 'Autorizada' };
      await absenceService.update(authPinModal.absenceId, dataToUpdate as Partial<Absence>, { empresaId, migracionCompleta });
      await replicarAusenciaEnPlanificador(authPinModal.absenceId, dataToUpdate as Absence);
      await registrarAuditoria('AUTHORIZE_ABSENCE', `Autorizó ${authPinModal.absence.type} — ${authPinModal.absence.employeeName} (supervisor: ${supervisorName})`);
      addToast(`Novedad autorizada por ${supervisorName}`, 'success');
      setAuthPinModal(null); setAuthPinValue('');
      loadAbsences();
    } catch (e) {
      setAuthPinError('Error al autorizar');
    } finally {
      setAuthPinLoading(false);
    }
  };

  const getAbsenceEmployeeName = (a: Absence) => { if (a.employeeName) return a.employeeName; const emp = employees.find(e => e.id === a.employeeId); return emp ? `${emp.lastName}, ${emp.firstName}` : 'Desconocido'; };
  const absenceStatusBadgeClass = (status: string) => {
    if (status === 'Confirmada')    return 'bg-blue-100 text-blue-700';
    if (status === 'Autorizada')    return 'bg-teal-100 text-teal-700';
    if (status === 'Justificada')   return 'bg-emerald-100 text-emerald-600';
    if (status === 'Injustificada') return 'bg-rose-100 text-rose-600';
    if (status === 'Rechazada')     return 'bg-red-100 text-red-700';
    if (status === 'En verificación') return 'bg-violet-100 text-violet-700';
    return 'bg-amber-100 text-amber-600';
  };

  const handleQuickClassify = async (absenceId: string, newStatus: 'Justificada' | 'Injustificada') => {
    try {
      await updateDocForEmpresa('ausencias', absenceId, { status: newStatus }, empresaId, migracionCompleta);
      loadAbsences();
    } catch (e) {
      addToast('Error al clasificar la ausencia', 'error');
    }
  };

  const renderAbsenceStatusCell = (a: Absence) => {
    const needsVerify = absenceNeedsMedicalVerification(a) && (a.status === 'Pendiente' || a.status === 'En verificación');
    if (needsVerify) {
      return (
        <button
          type="button"
          onClick={() => setVerifyModal({ absenceId: a.id!, absence: a })}
          className="px-2 py-1 rounded text-[10px] font-black uppercase bg-violet-50 text-violet-700 border border-violet-300 hover:bg-violet-100 transition-colors flex items-center gap-1 mx-auto"
        >
          <FileCheck size={9}/> Verificar
        </button>
      );
    }
    // No Presentación confirmada: acciones rápidas sin necesidad de autorización
    if (a.status === 'Confirmada') {
      const isLT = a.type === 'Llegada Tarde' || (a as any).absenceType === 'LT';
      if (isLT) {
        // Llegada Tarde: solo badge, sin clasificación RRHH
        return (
          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-orange-100 text-orange-700 border border-orange-200">
            Confirmada
          </span>
        );
      }
      return (
        <div className="flex flex-col items-center gap-1">
          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-blue-100 text-blue-700">
            Confirmada
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => handleQuickClassify(a.id!, 'Justificada')}
              title="Marcar como Justificada"
              className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              ✓ Just.
            </button>
            <button
              type="button"
              onClick={() => handleQuickClassify(a.id!, 'Injustificada')}
              title="Marcar como Injustificada"
              className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors"
            >
              ✗ Injust.
            </button>
          </div>
        </div>
      );
    }
    if (a.status === 'Pendiente') {
      return (
        <button
          type="button"
          onClick={() => { setAuthPinModal({ absenceId: a.id!, absence: a }); setAuthPinValue(''); setAuthPinError(''); }}
          className="px-2 py-1 rounded text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100 transition-colors flex items-center gap-1 mx-auto"
        >
          <KeyRound size={9}/> Autorizar
        </button>
      );
    }
    return (
      <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${absenceStatusBadgeClass(a.status)}`}>
        {a.status}
      </span>
    );
  };
  const coberturaBadgeClass = (estado?: string) => {
    if (estado === 'GESTIONADA') return 'bg-teal-100 text-teal-700';
    if (estado === 'VACANTE') return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-500';
  };
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; setFileName(file.name); const reader = new FileReader(); reader.onload = (evt) => { if (evt.target?.result) { setCsvContent(evt.target.result as string); } }; reader.readAsText(file, 'ISO-8859-1'); };
  
  // FUNCION DESCARGAR PLANTILLA
  const handleDownloadTemplate = () => { const headers = [ "Legajo", "Apellido, Nombre", "CUIL", "Email", "Telefono", "Direccion", "Genero", "Categoria", "Convenio", "Estado", "Fecha Ingreso", "Periodo", "Inicio Ciclo", "Objetivo" ]; const example = [ "1020", "PEREZ, Juan", "20-12345678-9", "juan@email.com", "3511234567", "Av Colon 1234", "M", "VIGILADOR", "422/05", "activo", "01/01/2024", "Mensual", "26", "Planta Industrial" ]; const csvString = headers.join(';') + '\n' + example.join(';'); const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.setAttribute("download", "Plantilla_Nomina_CronoApp.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link); };
  
  const handleProcessCSV = () => { 
      try { 
          const parsed = parseCSV(csvContent); 
          if (parsed.length === 0) { alert('Archivo vacío o formato desconocido.'); return; } 
          
          const mapped = parsed.map(row => { 
              const keys = Object.keys(row); 
              // Detección de columnas
              const findKey = (variations: string[]) => keys.find(k => variations.some(v => k.toLowerCase().includes(v)));
              
              let keyApellidoNombre = keys.find(k => k.toLowerCase().includes('apellido') && k.toLowerCase().includes('nombre'));
              const keyLegajo = findKey(['legajo', 'nro', 'ficha']);
              const keyDni = findKey(['dni', 'doc', 'documento', 'cuil', 'cuit']);
              const keyCat = findKey(['cat', 'puesto', 'cargo']);
              const keyConvenio = findKey(['convenio', 'cct']);
              const keyObj = findKey(['objetivo', 'cliente', 'servicio']);
              const keyFecha = findKey(['fecha', 'ingreso', 'alta']);
              const keyEmail = findKey(['email', 'correo']);
              const keyPhone = findKey(['tel', 'cel', 'movil']);
              const keyAddr = findKey(['dir', 'domicilio', 'calle']);
              const keyStatus = findKey(['estado']);
              const keyPeriod = findKey(['periodo']);
              const keyCycle = findKey(['ciclo', 'inicio']);
              const normHeader = (k: string) => k.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
              const keyGenero = keys.find(k => ['genero', 'sexo', 'gender'].some(v => normHeader(k).includes(v)));

              let fname = 'Sin Nombre'; let lname = 'Sin Apellido';
              if (keyApellidoNombre && row[keyApellidoNombre]) { 
                  const rawName = row[keyApellidoNombre]; 
                  if (rawName.includes(',')) { 
                      const parts = rawName.split(','); 
                      lname = parts[0].trim(); 
                      fname = parts.length > 1 ? parts[1].trim() : '-'; 
                  } else { 
                      const parts = rawName.split(' '); 
                      lname = parts[0]; 
                      fname = parts.slice(1).join(' '); 
                  } 
              } else {
                  const kA = findKey(['apellido', 'lastname']);
                  const kN = findKey(['nombre', 'firstname']);
                  if (kA && kN) { lname = row[kA]; fname = row[kN]; }
              }

              let dni = ''; let cuilRaw = ''; 
              const possibleCuil = row[keyDni] || ''; 
              if (possibleCuil) { 
                  cuilRaw = possibleCuil.trim(); 
                  const clean = possibleCuil.replace(/[^0-9]/g, ''); 
                  if (clean.length === 11) dni = clean.substring(2, 10); else if (clean.length >= 7) dni = clean; 
              } 
              
              const rawData = { 
                  firstName: fname, 
                  lastName: lname, 
                  dni: dni, 
                  cuil: cuilRaw, 
                  fileNumber: row[keyLegajo] || '', 
                  category: keyCat ? row[keyCat] : '', 
                  cct: keyConvenio ? row[keyConvenio] : '', 
                  email: keyEmail ? row[keyEmail] : '', 
                  phone: keyPhone ? row[keyPhone] : '', 
                  address: keyAddr ? row[keyAddr] : '', 
                  status: (keyStatus && row[keyStatus].toLowerCase().includes('inact')) ? 'inactivo' : 'activo', 
                  laborAgreement: keyConvenio ? row[keyConvenio] : '', 
                  startDate: keyFecha ? parseDateString(row[keyFecha]) : '', 
                  periodType: keyPeriod ? row[keyPeriod] : 'Mensual', 
                  cycleStartDay: keyCycle ? row[keyCycle] : '26', 
                  preferredObjectiveId: '', 
                  objectiveName: keyObj ? row[keyObj] : '',
                  genero: keyGenero ? normalizeGeneroImport(row[keyGenero]) : '',
              }; 
              return createEmployeeObject(rawData, allObjectives); 
          }).filter(x => x.dni && x.dni.length > 5); 
          
          if (mapped.length === 0) { alert('No se encontraron registros válidos (DNI/CUIL).'); } 
          else { setImportPreview(mapped); } 
      } catch(e: any) { 
          console.error(e); 
          alert('Error: ' + e.message); 
      } 
  };

  const confirmImport = async () => {
    setIsImporting(true);
    setImportStatusMsg('Importando...');
    try {
      const targetEmpresaId = importEmpresaId || empresaId;
      const freshSnap = targetEmpresaId
        ? await getDocs(query(collection(db, 'empleados'), where('empresaId', '==', targetEmpresaId)))
        : await getDocs(collection(db, 'empleados'));
      const current = freshSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

      const seenDni = new Set<string>();
      const seenLeg = new Set<string>();
      const deduped: any[] = [];
      for (const emp of importPreview) {
        const dniKey = (emp.dni || '').trim();
        const legKey = (emp.fileNumber || '').trim();
        if (dniKey && seenDni.has(dniKey)) continue;
        if (legKey && seenLeg.has(legKey)) continue;
        if (dniKey) seenDni.add(dniKey);
        if (legKey) seenLeg.add(legKey);
        deduped.push(emp);
      }

      let created = 0, updated = 0;
      const toGeocode: { docId: string; address: string }[] = [];

      for (const emp of deduped) {
        const finalEmp = importAsInactive ? { ...emp, status: 'inactivo' } : emp;
        const existing = current.find(e =>
          (finalEmp.dni && e.dni === finalEmp.dni) ||
          (finalEmp.fileNumber && e.fileNumber === finalEmp.fileNumber)
        );
        const needsGeo = !!(importWithGeo && finalEmp.address && !finalEmp.lat && !finalEmp.lng);
        if (existing) {
          await updateDoc(doc(db, 'empleados', existing.id), finalEmp);
          updated++;
          if (needsGeo) toGeocode.push({ docId: existing.id, address: finalEmp.address });
        } else {
          const ref = await addDoc(collection(db, 'empleados'), { ...finalEmp, empresaId: targetEmpresaId });
          created++;
          if (needsGeo) toGeocode.push({ docId: ref.id, address: finalEmp.address });
        }
      }

      const skipped = importPreview.length - deduped.length;

      let geoOk = 0, geoFail = 0;
      if (toGeocode.length > 0) {
        for (let i = 0; i < toGeocode.length; i++) {
          setImportStatusMsg(`Geolocalizando ${i + 1}/${toGeocode.length}...`);
          const { docId, address } = toGeocode[i];
          try {
            const result = await geocodeAddress(address);
            if (result) {
              await updateDoc(doc(db, 'empleados', docId), { lat: result.lat, lng: result.lon });
              geoOk++;
            } else {
              geoFail++;
            }
          } catch {
            geoFail++;
          }
          if (i < toGeocode.length - 1) await new Promise(r => setTimeout(r, 1200));
        }
      }

      await registrarAuditoria('IMPORT_EMPLOYEES',
        `CSV: ${created} nuevos, ${updated} actualizados, ${skipped} duplicados ignorados${geoOk ? `, ${geoOk} geolocalizados` : ''}`);

      const geoLine = toGeocode.length > 0
        ? `\n• ${geoOk} dirección${geoOk !== 1 ? 'es' : ''} geolocalizadas automáticamente${geoFail > 0 ? ` (${geoFail} sin resultado)` : ''}`
        : '';
      alert(`Importación completa:\n• ${created} empleados nuevos\n• ${updated} actualizados\n• ${skipped} duplicados ignorados${geoLine}`);
      setShowImportModal(false);
      setImportPreview([]); setCsvContent(''); setFileName(''); setImportAsInactive(false);
      await loadData();
    } catch(e) {
      console.error(e);
      alert('Error importando');
    } finally {
      setIsImporting(false);
      setImportStatusMsg('');
    }
  };

  const handleExport = () => {
      const headers = ['Legajo', 'Apellido', 'Nombre', 'DNI', 'CUIL', 'Email', 'Teléfono', 'Genero', 'Convenio', 'Categoría', 'Objetivo Preferido', 'Estado'];
      const csvRows = [headers.join(';')];

      employees.forEach(emp => {
          const objName = allObjectives.find(o => o.id === emp.preferredObjectiveId)?.name || '';
          const generoLabel = (emp as any).genero === 'M' ? 'M' : (emp as any).genero === 'F' ? 'F' : '';
          const row = [
              emp.fileNumber,
              `"${emp.lastName}"`,
              `"${emp.firstName}"`,
              emp.dni,
              emp.cuil,
              emp.email,
              emp.phone,
              generoLabel,
              `"${emp.laborAgreement}"`,
              `"${emp.category}"`,
              `"${objName}"`,
              emp.status
          ];
          csvRows.push(row.join(';'));
      });

      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `empleados_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };
  
  const handleExportVCard = () => {
      const withPhone = employees.filter(e => e.phone || (e as any).celular);
      if (withPhone.length === 0) { alert('Ningún empleado tiene teléfono registrado.'); return; }
      const cards = withPhone.map(emp => {
          const raw = emp.phone || (emp as any).celular || '';
          const normalized = normalizeArgPhone(raw);
          const tel = normalized ? `+${normalized}` : raw;
          const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
          return [
              'BEGIN:VCARD',
              'VERSION:3.0',
              `FN:COSP - ${fullName}`,
              `N:${emp.lastName || ''};${emp.firstName || ''};;;`,
              `TEL;TYPE=CELL:${tel}`,
              emp.email ? `EMAIL:${emp.email}` : '',
              `NOTE:Legajo ${emp.fileNumber || '-'} · DNI ${emp.dni || '-'}`,
              'END:VCARD',
          ].filter(Boolean).join('\r\n');
      });
      const blob = new Blob([cards.join('\r\n')], { type: 'text/vcard;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `contactos_cosp_${new Date().toISOString().split('T')[0]}.vcf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleExportReport = async () => {
      setIsExporting(true);
      try {
          const rows = [];
          rows.push(["Legajo", "Apellido", "Nombre", "DNI", "Objetivo", "Hs Normales", "Hs Nocturnas", "Hs 100%", "Hs 50%", "Plus Feriado", "Ausencias (Cant)", "Llegadas Tarde (Hs)", "Observaciones"].join(';'));
          const listToExport = selectedEmp ? [selectedEmp] : filteredEmployees;
          const objectivesLookup = new Map(allObjectives.map(o => [o.id, o.name]));

          for (const emp of listToExport) {
              const { start, end } = getCycleDates(currentDate, emp.cycleStartDay ? Number(emp.cycleStartDay) : 26);
              const qTurnos = query(collection(db, 'turnos'), where('employeeId', '==', emp.id), where('startTime', '>=', Timestamp.fromDate(start)), where('startTime', '<=', Timestamp.fromDate(end)));
              const turnosSnap = await getDocs(qTurnos);
              const turnos = turnosSnap.docs.map(d => d.data());
              const qAus = query(collection(db, 'ausencias'), where('employeeId', '==', emp.id));
              const ausSnap = await getDocs(qAus);
              const activeAbs = ausSnap.docs.map(d=>d.data()).filter((a:any) => new Date(a.startDate) >= start && new Date(a.endDate) <= end);
              
              let hoursNormal = 0, hoursNight = 0, hours50 = 0, hours100 = 0, hoursHoliday = 0, lateHours = 0;
              let empObjName = 'General';
              if (emp.preferredObjectiveId && objectivesLookup.has(emp.preferredObjectiveId)) empObjName = objectivesLookup.get(emp.preferredObjectiveId);

              const ruleBase = agreements.find(a => a.name === emp.laborAgreement) || initialAgreement;
              const rule = { ...ruleBase, nightShiftStart: ruleBase.nightShiftStart || 21, nightShiftEnd: ruleBase.nightShiftEnd || 6 };

              turnos.forEach((t:any) => {
                  if (t.status === 'Canceled' || t.type === 'NOVEDAD') return;
                  const s = t.startTime.toDate();
                  const e = t.endTime.toDate();
                  let dur = (e.getTime() - s.getTime()) / 3600000;
                  if (t.isLate && t.realStartTime) { const realStart = t.realStartTime.toDate(); const lateDiff = (realStart.getTime() - s.getTime()) / 3600000; if (lateDiff > 0) lateHours += lateDiff; }
                  const night = getNightDuration(s, e, rule?.nightShiftStart ?? 21, rule?.nightShiftEnd ?? 6);
                  hoursNight += night;
                  if (t.isFrancoTrabajado || t.code === 'FT') hours100 += dur; else hoursNormal += dur;
                  const dStr = getArgentinaDate(t.startTime);
                  if (holidays.some(h => h.date === dStr)) hoursHoliday += dur;
              });

              const obs = [...activeAbs.map((a:any) => `Aus: ${a.type}`), ...turnos.filter((t:any) => t.extensionNote).map((t:any) => `Ext: ${t.extensionNote}`), ...turnos.filter((t:any) => t.entryNote).map((t:any) => `Adel: ${t.entryNote}`)].join(' | ');
              rows.push([emp.fileNumber || '-', emp.lastName, emp.firstName, emp.dni, empObjName, hoursNormal.toFixed(2), hoursNight.toFixed(2), hours100.toFixed(2), hours50.toFixed(2), hoursHoliday.toFixed(2), activeAbs.length, lateHours.toFixed(2), `"${obs}"`].join(';'));
          }
          const blob = new Blob(["\uFEFF" + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.setAttribute("download", `Reporte_RRHH_${selectedEmp ? selectedEmp.lastName : 'Nomina'}_${currentDate.toISOString().slice(0,7)}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          await registrarAuditoria('EXPORT_REPORT', `Reporte generado: ${selectedEmp ? 'Individual' : 'Nómina Completa'}`);
      } catch (e) { addToast('Error generando reporte', 'error'); } finally { setIsExporting(false); }
  };

  // ── KPIs globales de RRHH ────────────────────────────────────────────────────
  const globalHRStats = useMemo(() => {
    const activeEmps   = employees.filter(e => e.status === 'activo' || e.status === 'active' || !e.status);
    const inactiveEmps = employees.filter(e => !['activo','active',undefined,null,''].includes(e.status));
    const activePct    = employees.length > 0 ? Math.round((activeEmps.length / employees.length) * 100) : 0;

    const today   = new Date(); today.setHours(0,0,0,0);
    const inMonth = absences.filter(a => {
      const s = new Date(a.startDate + 'T00:00:00');
      const e = new Date(a.endDate   + 'T00:00:00');
      return s.getMonth() === today.getMonth() && s.getFullYear() === today.getFullYear();
    });
    const absActive = absences.filter(a => {
      const s = new Date(a.startDate + 'T00:00:00');
      const e = new Date(a.endDate   + 'T00:00:00');
      return s <= today && e >= today;
    });

    const byType: Record<string, number> = {};
    inMonth.forEach(a => { const t = a.type || 'Otro'; byType[t] = (byType[t] || 0) + 1; });

    const ausentismoPct = activeEmps.length > 0
      ? Math.round((absActive.length / activeEmps.length) * 100)
      : 0;

    const categoryCounts: Record<string, number> = {};
    activeEmps.forEach(e => { const c = e.category || 'Sin Categoría'; categoryCounts[c] = (categoryCounts[c] || 0) + 1; });

    const objCounts: Record<string, number> = {};
    activeEmps.forEach(e => {
      if (e.preferredObjectiveId) {
        const obj = allObjectives.find((o: any) => o.id === e.preferredObjectiveId);
        const name = obj?.name || e.preferredObjectiveId;
        objCounts[name] = (objCounts[name] || 0) + 1;
      }
    });

    const withPortal    = employees.filter((e: any) => e.portalInvite?.sent).length;
    const withEmail     = employees.filter((e: any) => e.email).length;
    const withoutCoords = activeEmps.filter(e => !e.lat && !e.lng).length;

    const recentAbsences = [...absences]
      .sort((a,b) => String(b.startDate).localeCompare(String(a.startDate)))
      .slice(0, 6);

    // Seniority buckets (activos)
    const senBuckets = { '<1': 0, '1-3': 0, '3-5': 0, '5+': 0 };
    let totalSenYrs = 0; let senCount = 0;
    activeEmps.forEach((e: any) => {
      if (!e.startDate) return;
      const yrs = (today.getTime() - new Date(e.startDate + 'T00:00:00').getTime()) / (1000*60*60*24*365.25);
      if      (yrs < 1)  senBuckets['<1']++;
      else if (yrs < 3)  senBuckets['1-3']++;
      else if (yrs < 5)  senBuckets['3-5']++;
      else               senBuckets['5+']++;
      totalSenYrs += yrs; senCount++;
    });
    const avgSeniority = senCount > 0 ? Math.round(totalSenYrs / senCount * 10) / 10 : 0;

    let totalAgeYrs = 0; let ageCount = 0;
    activeEmps.forEach((e: any) => {
      const dob = (e as any).birthDate || (e as any).fechaNacimiento;
      if (!dob) return;
      const dobStr = typeof dob === 'string' ? dob : (dob.toDate ? dob.toDate().toISOString().slice(0,10) : '');
      if (!dobStr) return;
      const age = (today.getTime() - new Date(dobStr + 'T00:00:00').getTime()) / (1000*60*60*24*365.25);
      if (age > 14 && age < 100) { totalAgeYrs += age; ageCount++; }
    });
    const avgAge = ageCount > 0 ? Math.round(totalAgeYrs / ageCount) : 0;

    const upcomingHolidays = holidays
      .filter(h => new Date(h.date + 'T00:00:00') >= today)
      .sort((a,b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 4);

    return {
      total: employees.length, activeCount: activeEmps.length, inactiveCount: inactiveEmps.length,
      activePct, ausentismoPct, absActive: absActive.length, withPortal, withEmail, withoutCoords,
      byType, categoryCounts, objCounts, recentAbsences, senBuckets, upcomingHolidays,
      avgSeniority, avgAge, ageCount,
    };
  }, [employees, absences, holidays, allObjectives]);

  return (
    <DashboardLayout>
        {/* --- CONTENIDO PRINCIPAL --- */}
        <div className="max-w-full mx-auto space-y-4 animate-in fade-in h-[calc(100vh-100px)] flex flex-col print:hidden">
            {/* ===== PREMIUM HEADER ===== */}
            <header className="flex flex-col gap-3 shrink-0">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                            <Users size={22} className="text-white"/>
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight leading-none">Gestión de Recursos Humanos</h1>
                            <p className="text-slate-400 text-xs font-bold mt-0.5 uppercase tracking-widest">
                                {currentDate.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-1.5 items-center relative">
                        {/* ── Campana: solicitudes del portal de empleados ── */}
                        <div className="relative">
                            <button
                                onClick={() => setShowRRHHAlerts(v => !v)}
                                title="Solicitudes del portal de empleados"
                                className={`relative p-2 rounded-xl transition-colors ${pendingPortalRequests.length > 0 ? 'bg-rose-100 text-rose-600 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400' : 'bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-700'}`}
                            >
                                <BellRing size={17} className={pendingPortalRequests.length > 0 ? 'animate-pulse' : ''}/>
                                {pendingPortalRequests.length > 0 && (
                                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center">
                                        {pendingPortalRequests.length}
                                    </span>
                                )}
                            </button>
                            {showRRHHAlerts && (
                                <div className="absolute right-0 top-10 z-50 w-80 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2">
                                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
                                        <BellRing size={14} className="text-rose-500"/>
                                        <span className="font-black text-sm text-slate-800 dark:text-white flex-1">Solicitudes pendientes</span>
                                        <button onClick={() => setShowRRHHAlerts(false)} className="text-slate-400 hover:text-slate-600"><X size={14}/></button>
                                    </div>
                                    {pendingPortalRequests.length === 0 ? (
                                        <div className="p-6 text-center text-slate-400 text-xs font-bold">Sin solicitudes pendientes</div>
                                    ) : (
                                        <div className="max-h-72 overflow-y-auto">
                                            {pendingPortalRequests.map((a: any) => {
                                                const typeColors: Record<string, string> = {
                                                    'Vacaciones': 'bg-teal-100 text-teal-700',
                                                    'Enfermedad': 'bg-rose-100 text-rose-700',
                                                    'ART': 'bg-orange-100 text-orange-700',
                                                    'Licencia Esp.': 'bg-purple-100 text-purple-700',
                                                    'Ausencia con aviso': 'bg-amber-100 text-amber-800',
                                                };
                                                const tc = typeColors[a.type] || 'bg-slate-100 text-slate-600';
                                                const fmtD = (v: any) => v ? String(v).slice(5, 10).replace('-', '/') : '--';
                                                return (
                                                    <button
                                                        key={a.id}
                                                        onClick={() => { setShowRRHHAlerts(false); setActiveTab('ausencias'); handleOpenAbsenceModal(a); }}
                                                        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-50 dark:border-slate-700 text-left transition-colors"
                                                    >
                                                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded mt-0.5 shrink-0 ${tc}`}>{a.type}</span>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{a.employeeName || '—'}</p>
                                                            <p className="text-[10px] text-slate-400 font-mono">{fmtD(a.startDate)} → {fmtD(a.endDate)}</p>
                                                            {a.reason && <p className="text-[9px] text-slate-400 truncate mt-0.5">{a.reason}</p>}
                                                        </div>
                                                        <ChevronRight size={13} className="text-slate-300 shrink-0 mt-1"/>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center">
                                        <span className="text-[9px] text-slate-400">{pendingPortalRequests.length} pendiente{pendingPortalRequests.length !== 1 ? 's' : ''}</span>
                                        <button onClick={() => { setShowRRHHAlerts(false); setActiveTab('ausencias'); }} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800">Ver todas →</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {activeTab === 'legajos' && view === 'list' && (
                            <>
                                {/* Acciones secundarias — iconos compactos */}
                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-xl p-1">
                                    <button onClick={() => window.print()} title="Imprimir" className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 transition-colors">
                                        <Printer size={15}/>
                                    </button>
                                    <button onClick={handleExport} title="Exportar CSV" className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 transition-colors">
                                        <FileDown size={15}/>
                                    </button>
                                    <button onClick={handleExportVCard} title="Exportar contactos WhatsApp (.vcf)" className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-emerald-600 dark:text-emerald-400 transition-colors">
                                        <MessageCircle size={15}/>
                                    </button>
                                    <button onClick={() => { setImportEmpresaId(empresaId || 'bacarsa'); setShowImportModal(true); }} title="Importar CSV" className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300 transition-colors">
                                        <FileSpreadsheet size={15}/>
                                    </button>
                                    <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-0.5"/>
                                    <button
                                        onClick={handleBulkGeocode}
                                        disabled={isBulkGeocoding}
                                        title={`Geolocalizar (${employees.filter(e => e.status !== 'inactivo' && (e as any).address && !(e as any).lat).length} pendientes)`}
                                        className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-teal-600 dark:text-teal-400 transition-colors disabled:opacity-50 relative"
                                    >
                                        {isBulkGeocoding ? <Loader2 size={15} className="animate-spin"/> : <MapPin size={15}/>}
                                        {!isBulkGeocoding && employees.filter(e => e.status !== 'inactivo' && (e as any).address && !(e as any).lat).length > 0 && (
                                            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-teal-500 text-white text-[7px] font-black rounded-full flex items-center justify-center">
                                                {employees.filter(e => e.status !== 'inactivo' && (e as any).address && !(e as any).lat).length}
                                            </span>
                                        )}
                                    </button>
                                    <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-0.5"/>
                                    <button
                                        onClick={handleSendPortalAll}
                                        disabled={sendingAllPortal}
                                        title={`Enviar portal (${employees.filter((e: any) => !(e as any).portalInvite?.sent && (e as any).email).length} pendientes)`}
                                        className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-indigo-500 dark:text-indigo-400 transition-colors disabled:opacity-50 relative"
                                    >
                                        {sendingAllPortal ? <Loader2 size={15} className="animate-spin"/> : <Send size={15}/>}
                                        {!sendingAllPortal && employees.filter((e: any) => !(e as any).portalInvite?.sent && (e as any).email).length > 0 && (
                                            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-indigo-500 text-white text-[7px] font-black rounded-full flex items-center justify-center">
                                                {employees.filter((e: any) => !(e as any).portalInvite?.sent && (e as any).email).length}
                                            </span>
                                        )}
                                    </button>
                                    {employees.some((e: any) => (e as any).portalInvite?.sent) && (
                                        <button onClick={handleResetPortalAll} title="Reset portal" className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-rose-400 transition-colors">
                                            <RefreshCw size={15}/>
                                        </button>
                                    )}
                                </div>
                                {/* Barra de progreso geocoding */}
                                {bulkProgress && isBulkGeocoding && (
                                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-700 font-bold">
                                        <div className="w-16 h-1.5 bg-teal-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-teal-500 transition-all" style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}/>
                                        </div>
                                        <span className="text-[10px]">{bulkProgress.done}/{bulkProgress.total}</span>
                                    </div>
                                )}
                                {/* Acceso Portal Empleados */}
                                <a
                                    href="/admin/empleados"
                                    title="Gestionar acceso Portal Empleados"
                                    className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-600 text-violet-500 dark:text-violet-400 transition-colors"
                                >
                                    <ShieldCheckIcon size={15}/>
                                </a>
                                {/* Acción primaria */}
                                <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-500/25 flex items-center gap-1.5 hover:bg-indigo-700 transition-colors">
                                    <Plus size={14}/> Nuevo Legajo
                                </button>
                            </>
                        )}
                        {activeTab === 'ausencias' && (
                            <div className="flex items-center gap-2">
                                {canAdjust && selectedAbsenceIds.size > 0 && (
                                    <button onClick={handleBulkDeleteAbsences} className="bg-rose-700 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-lg flex items-center gap-1.5 hover:bg-rose-800 transition-colors">
                                        <Trash2 size={14}/> Eliminar {selectedAbsenceIds.size} seleccionada{selectedAbsenceIds.size !== 1 ? 's' : ''}
                                    </button>
                                )}
                                <button onClick={() => handleOpenAbsenceModal()} className="bg-rose-600 text-white px-4 py-2 rounded-xl font-black text-xs uppercase shadow-lg shadow-rose-500/25 flex items-center gap-1.5 hover:bg-rose-700 transition-colors">
                                    <Plus size={14}/> Nueva Novedad
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* TAB BAR */}
                <div className="flex items-center gap-2">
                    <TabBar
                        compact
                        tabs={[
                            { id: 'dashboard',    label: 'Dashboard',    icon: BarChart2 },
                            { id: 'legajos',      label: 'Legajos',      icon: Users },
                            { id: 'ausencias',    label: 'Novedades',    icon: AlertTriangle },
                            { id: 'feriados',     label: 'Feriados',     icon: Calendar },
                            { id: 'convenios',    label: 'Convenios',    icon: Book },
                            { id: 'correcciones', label: 'Correcciones', icon: ClipboardEdit },
                        ]}
                        active={activeTab}
                        onChange={id => { setActiveTab(id as any); setView('list'); }}
                    />
                    <Link href="/admin/rrhh/ausentismo"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase transition-all border"
                        style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt3)' }}
                    >
                        <TrendingDown size={11}/> Ausentismo
                    </Link>
                    <Link
                        href="/admin/empleados"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase transition-all border"
                        style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt3)' }}
                    >
                        <ShieldCheckIcon size={11}/> Empleados
                    </Link>
                </div>
            </header>

            {/* DASHBOARD GENERAL */}
            {activeTab === 'dashboard' && (
                <div className="flex-1 overflow-y-auto pb-6 space-y-4">

                    {/* ── Fila 1: KPIs principales ── */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {/* Nómina total */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-col gap-1 col-span-1">
                            <div className="flex items-center justify-between mb-1">
                                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                                    <Users size={16} className="text-indigo-600"/>
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-wide text-slate-300 bg-slate-50 px-2 py-0.5 rounded-full">Nómina</span>
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">TOTAL PLANTILLA</p>
                            <p className="text-3xl font-black text-indigo-600 leading-none">{globalHRStats.total}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                <span className="text-emerald-600 font-bold">{globalHRStats.activeCount} activos</span>
                                {globalHRStats.inactiveCount > 0 && <span className="text-slate-400"> · {globalHRStats.inactiveCount} bajas</span>}
                            </p>
                        </div>

                        {/* % Activos */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-col gap-1">
                            <div className="flex items-center justify-between mb-1">
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <UserCheck size={16} className="text-emerald-600"/>
                                </div>
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${globalHRStats.activePct >= 90 ? 'bg-emerald-50 text-emerald-600' : globalHRStats.activePct >= 70 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>{globalHRStats.activePct}%</span>
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">ACTIVOS</p>
                            <p className="text-3xl font-black text-emerald-600 leading-none">{globalHRStats.activeCount}</p>
                            <div className="mt-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${globalHRStats.activePct}%` }}/>
                            </div>
                        </div>

                        {/* Ausentismo */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-col gap-1">
                            <div className="flex items-center justify-between mb-1">
                                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <TrendingDown size={16} className="text-rose-500"/>
                                </div>
                                <Link href="/admin/rrhh/ausentismo" className="text-[9px] font-bold text-indigo-500 hover:underline flex items-center gap-0.5">
                                    Detalle <ExternalLink size={9}/>
                                </Link>
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">AUSENTISMO HOY</p>
                            <p className={`text-3xl font-black leading-none ${globalHRStats.ausentismoPct > 10 ? 'text-rose-600' : globalHRStats.ausentismoPct > 5 ? 'text-amber-500' : 'text-slate-700'}`}>{globalHRStats.ausentismoPct}%</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{globalHRStats.absActive} ausente{globalHRStats.absActive !== 1 ? 's' : ''} hoy</p>
                        </div>

                        {/* Portal / Coords */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4 flex flex-col gap-1">
                            <div className="flex items-center justify-between mb-1">
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <ShieldCheckIcon size={16} className="text-blue-600"/>
                                </div>
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">PORTAL ACTIVO</p>
                            <p className="text-3xl font-black text-blue-600 leading-none">{globalHRStats.withPortal}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                                {globalHRStats.withEmail} con email
                                {globalHRStats.withoutCoords > 0 && <span className="text-amber-500"> · {globalHRStats.withoutCoords} sin coords</span>}
                            </p>
                        </div>
                    </div>

                    {/* ── Fila 2: Antigüedad + Distribución por objetivo ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                        {/* Antigüedad */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Award size={15} className="text-indigo-500"/>
                                    <h3 className="text-[12px] font-black uppercase tracking-wide text-slate-700">Antigüedad de plantilla</h3>
                                </div>
                                <div className="flex gap-2 text-[10px] text-slate-400">
                                    {globalHRStats.avgSeniority > 0 && <span className="font-bold text-indigo-600">Prom. {globalHRStats.avgSeniority} años</span>}
                                    {globalHRStats.avgAge > 0 && <span>· {globalHRStats.avgAge} edad</span>}
                                </div>
                            </div>
                            <div className="space-y-2">
                                {([['< 1 año', globalHRStats.senBuckets['<1']], ['1 a 3 años', globalHRStats.senBuckets['1-3']], ['3 a 5 años', globalHRStats.senBuckets['3-5']], ['5+ años', globalHRStats.senBuckets['5+']]] as [string, number][]).map(([label, count], i) => {
                                    const pct = globalHRStats.activeCount > 0 ? Math.round((count / globalHRStats.activeCount) * 100) : 0;
                                    return (
                                        <div key={label} className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-slate-500 w-16 shrink-0">{label}</span>
                                            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}/>
                                            </div>
                                            <span className="text-[10px] font-black text-slate-700 w-6 text-right">{count}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Distribución por objetivo */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Target size={15} className="text-emerald-500"/>
                                <h3 className="text-[12px] font-black uppercase tracking-wide text-slate-700">Distribución por objetivo</h3>
                            </div>
                            {Object.keys(globalHRStats.objCounts).length === 0 ? (
                                <p className="text-[11px] text-slate-400 text-center py-4">Sin datos de objetivo asignado</p>
                            ) : (
                                <div className="space-y-2">
                                    {Object.entries(globalHRStats.objCounts)
                                        .sort((a, b) => b[1] - a[1])
                                        .slice(0, 5)
                                        .map(([name, count], i) => {
                                            const pct = globalHRStats.activeCount > 0 ? Math.round((count / globalHRStats.activeCount) * 100) : 0;
                                            return (
                                                <div key={name} className="flex items-center gap-2">
                                                    <span className="text-[10px] font-bold text-slate-500 truncate flex-1 min-w-0">{name}</span>
                                                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                                                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}/>
                                                    </div>
                                                    <span className="text-[10px] font-black text-slate-700 w-5 text-right shrink-0">{count}</span>
                                                </div>
                                            );
                                        })
                                    }
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Fila 3: Novedades recientes + Próximos feriados ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                        {/* Novedades recientes */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle size={15} className="text-rose-500"/>
                                    <h3 className="text-[12px] font-black uppercase tracking-wide text-slate-700">Novedades recientes</h3>
                                </div>
                                <button onClick={() => setActiveTab('ausencias')} className="text-[10px] font-bold text-indigo-500 hover:underline">Ver todas →</button>
                            </div>
                            {globalHRStats.recentAbsences.length === 0 ? (
                                <p className="text-[11px] text-slate-400 text-center py-4">Sin novedades recientes</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {globalHRStats.recentAbsences.map((ab: any, i: number) => {
                                        const emp = employees.find(e => e.id === ab.employeeId);
                                        const displayName = emp?.nombre || ab.employeeName || '—';
                                        const initial = displayName !== '—' ? displayName[0].toUpperCase() : '?';
                                        return (
                                            <div key={ab.id || i} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                                                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                                                    <span className="text-[9px] font-black text-indigo-600">{initial}</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-bold text-slate-700 truncate">{displayName}</p>
                                                    <p className="text-[10px] text-slate-400">{ab.type || 'Ausencia'} · {String(ab.startDate).slice(0, 10)}</p>
                                                </div>
                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${ab.type === 'AA' ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{ab.type || '—'}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Próximos feriados */}
                        <div className="bg-white rounded-xl border border-slate-100 p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Calendar size={15} className="text-amber-500"/>
                                <h3 className="text-[12px] font-black uppercase tracking-wide text-slate-700">Próximos feriados</h3>
                            </div>
                            {globalHRStats.upcomingHolidays.length === 0 ? (
                                <p className="text-[11px] text-slate-400 text-center py-4">Sin feriados próximos cargados</p>
                            ) : (
                                <div className="space-y-2">
                                    {globalHRStats.upcomingHolidays.map((h: any, i: number) => {
                                        const d = new Date(h.date + 'T00:00:00');
                                        const diff = Math.round((d.getTime() - new Date().setHours(0,0,0,0)) / (1000*60*60*24));
                                        return (
                                            <div key={h.id || i} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                                                <div className="w-10 text-center shrink-0">
                                                    <p className="text-[18px] font-black text-slate-700 leading-none">{d.getDate()}</p>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase">{d.toLocaleString('es-AR', { month: 'short' })}</p>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[11px] font-bold text-slate-700 truncate">{h.name}</p>
                                                    <p className="text-[10px] text-slate-400">{diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : `En ${diff} días`}</p>
                                                </div>
                                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${h.type === 'inamovible' ? 'bg-rose-50 text-rose-500' : 'bg-amber-50 text-amber-600'}`}>{h.type === 'inamovible' ? 'INAM.' : 'TRASLA.'}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Fila 4: Alertas de plantilla + Accesos rápidos ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Alertas */}
                        {(dashboardStats.sinEmail > 0 || dashboardStats.sinPortal > 0 || globalHRStats.withoutCoords > 0) ? (
                            <div className="bg-white rounded-xl border border-amber-100 p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <BellRing size={15} className="text-amber-500"/>
                                    <h3 className="text-[12px] font-black uppercase tracking-wide text-slate-700">Alertas de plantilla</h3>
                                </div>
                                <div className="space-y-1.5">
                                    {dashboardStats.sinEmail > 0 && (
                                        <div className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-2 text-[11px] text-amber-800">
                                                <Mail size={12}/> <span><b>{dashboardStats.sinEmail}</b> sin email</span>
                                            </div>
                                            <button onClick={() => setActiveTab('legajos')} className="text-[10px] font-bold text-amber-700 hover:underline">Ver →</button>
                                        </div>
                                    )}
                                    {dashboardStats.sinPortal > 0 && (
                                        <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-2 text-[11px] text-blue-800">
                                                <KeyRound size={12}/> <span><b>{dashboardStats.sinPortal}</b> sin acceso al portal</span>
                                            </div>
                                            <button onClick={() => setActiveTab('legajos')} className="text-[10px] font-bold text-blue-700 hover:underline">Ver →</button>
                                        </div>
                                    )}
                                    {globalHRStats.withoutCoords > 0 && (
                                        <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                                            <div className="flex items-center gap-2 text-[11px] text-slate-600">
                                                <MapPin size={12}/> <span><b>{globalHRStats.withoutCoords}</b> sin coordenadas GPS</span>
                                            </div>
                                            <button onClick={() => setActiveTab('legajos')} className="text-[10px] font-bold text-slate-600 hover:underline">Ver →</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4 flex items-center gap-3">
                                <CheckCircle2 size={20} className="text-emerald-500 shrink-0"/>
                                <div>
                                    <p className="text-[12px] font-black text-emerald-700">Plantilla completa</p>
                                    <p className="text-[10px] text-emerald-600">Todos los empleados tienen email, portal y coordenadas.</p>
                                </div>
                            </div>
                        )}

                        {/* Accesos rápidos */}
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { label: 'Legajos', desc: `${globalHRStats.activeCount} activos`, icon: Users, tab: 'legajos' as const, color: 'bg-indigo-50 text-indigo-600' },
                                { label: 'Novedades', desc: 'Ausencias y lic.', icon: AlertTriangle, tab: 'ausencias' as const, color: 'bg-rose-50 text-rose-600' },
                                { label: 'Correcciones', desc: 'Ajuste de horas', icon: ClipboardEdit, tab: 'correcciones' as const, color: 'bg-slate-50 text-slate-600' },
                            ].map(s => (
                                <button key={s.label} onClick={() => setActiveTab(s.tab)}
                                    className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col items-center gap-2 hover:shadow-sm transition-all text-center">
                                    <div className={`w-9 h-9 rounded-lg ${s.color} flex items-center justify-center`}>
                                        <s.icon size={16}/>
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-black text-slate-700">{s.label}</p>
                                        <p className="text-[9px] text-slate-400">{s.desc}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* SECCIONES DEL DASHBOARD */}
            {activeTab === 'legajos' && view === 'list' && (
                <div className="flex-1 flex gap-6 overflow-hidden relative">
                    {/* ── Panel izquierdo: lista de empleados ────────── */}
                    <div className="w-[340px] bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden shrink-0">

                      {/* Header del panel */}
                      <div className="px-3 pt-3 pb-2 border-b border-slate-100 dark:border-slate-700 space-y-2 bg-white dark:bg-slate-800">
                        {/* Buscador */}
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-700">
                          <Search size={14} className="text-slate-400 shrink-0"/>
                          <input placeholder="Buscar por nombre o legajo…" className="bg-transparent outline-none w-full text-xs font-bold text-slate-900 dark:text-white placeholder:font-medium placeholder:text-slate-400" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                          {searchTerm && <button onClick={() => setSearchTerm('')} className="text-slate-300 hover:text-slate-500"><X size={12}/></button>}
                          <button onClick={() => loadData()} title="Actualizar" className="text-slate-300 hover:text-indigo-500 transition-colors shrink-0"><RefreshCw size={12}/></button>
                        </div>

                        {/* Filtro objetivo */}
                        <select value={filterObjective} onChange={e => setFilterObjective(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-700 px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-600 dark:text-white appearance-none">
                          <option value="">Todos los objetivos</option>
                          <option value="__sin_objetivo__">— Sin objetivo</option>
                          {(() => {
                            const seen = new Set<string>();
                            return [...allObjectives]
                              .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
                              .filter((o: any) => { const k = (o.name || '').toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; })
                              .map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>);
                          })()}
                        </select>

                        {/* Ciclo + filtros */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-xl px-1.5 py-0.5">
                            <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"><ChevronLeft size={12}/></button>
                            <span className="text-[10px] font-black uppercase w-16 text-center text-slate-600 dark:text-slate-300">{currentDate.toLocaleString('es-ES',{month:'short',year:'2-digit'})}</span>
                            <button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"><ChevronRight size={12}/></button>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setShowInactive(v => !v)} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-colors ${showInactive ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                              <UserX size={10} aria-hidden="true"/> {showInactive ? 'Bajas' : 'Bajas'}
                            </button>
                            {(() => {
                              const n = employees.filter(e => { const isActive = e.status === 'activo' || e.status === 'active' || !e.status; return isActive && !e.lat && !e.lng; }).length;
                              return n > 0 ? (
                                <button onClick={() => { setFilterNoCoords(v => !v); setGeoFailedList([]); }} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-colors ${filterNoCoords ? 'bg-amber-100 text-amber-700' : 'text-amber-500 hover:bg-amber-50'}`}>
                                  <MapPin size={10}/> {n}
                                </button>
                              ) : null;
                            })()}
                            {isSuperAdmin && employees.length > 0 && (
                              <button onClick={handleDeleteAll} disabled={isDeletingAll} className="text-rose-400 hover:bg-rose-50 px-2 py-1 rounded-lg text-[9px] font-black uppercase transition-colors">
                                {isDeletingAll ? '…' : <Trash2 size={10}/>}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Contador */}
                        <div className="flex items-center justify-between px-0.5">
                          <span className="text-[9px] font-black uppercase text-slate-400">{filteredEmployees.length} empleado{filteredEmployees.length !== 1 ? 's' : ''}</span>
                          {filterObjective && <button onClick={() => setFilterObjective('')} className="text-[9px] text-indigo-500 font-bold flex items-center gap-0.5 hover:underline"><X size={9}/> Limpiar filtro</button>}
                        </div>
                      </div>

                      {/* Panel fallidos geocoding */}
                      {geoFailedList.length > 0 && (
                        <div className="mx-2 my-1.5 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-black text-amber-700 uppercase flex items-center gap-1"><MapPin size={10}/> Sin geo ({geoFailedList.length})</p>
                            <button onClick={() => setGeoFailedList([])} className="text-amber-400 hover:text-amber-700"><X size={11}/></button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {geoFailedList.map(name => <span key={name} className="text-[9px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{name}</span>)}
                          </div>
                        </div>
                      )}

                      {/* Lista de empleados */}
                      <div className="flex-1 overflow-auto custom-scrollbar">
                        {filteredEmployees.length === 0 ? (
                          <div className="p-10 text-center">
                            <Users size={28} className="text-slate-200 mx-auto mb-2"/>
                            <p className="text-slate-400 text-xs font-bold">Sin resultados</p>
                          </div>
                        ) : filteredEmployees.map(emp => {
                          const isActive = (emp.status === 'activo' || emp.status === 'active');
                          const isSelected = selectedEmp?.id === emp.id;
                          const objective = allObjectives.find((o: any) => o.id === emp.preferredObjectiveId);
                          return (
                            <div key={emp.id} onClick={() => handleRowClick(emp)}
                              role="button" tabIndex={0}
                              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleRowClick(emp)}
                              aria-label={`${emp.lastName}, ${emp.firstName}${!isActive ? ' — inactivo' : ''}`}
                              aria-pressed={isSelected}
                              className={`px-3 py-2.5 cursor-pointer transition-all flex items-center gap-2.5 border-b border-slate-50 dark:border-slate-700/50 last:border-0
                                ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : isActive ? 'hover:bg-slate-50 dark:hover:bg-slate-700/30' : 'opacity-50 hover:opacity-80'}`}>
                              {/* Indicador de selección */}
                              <div className={`w-0.5 h-8 rounded-full shrink-0 transition-colors ${isSelected ? 'bg-indigo-500' : 'bg-transparent'}`}/>
                              {/* Avatar */}
                              <div className="relative shrink-0">
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm
                                  ${isSelected ? 'bg-indigo-600 text-white' : isActive ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'bg-slate-100 text-slate-300'}`}>
                                  {(emp.lastName?.[0] || '?').toUpperCase()}
                                </div>
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-800 ${isActive ? 'bg-emerald-500' : 'bg-rose-400'}`}/>
                              </div>
                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <p className={`font-black text-xs uppercase truncate leading-tight ${isSelected ? 'text-indigo-700 dark:text-indigo-300' : isActive ? 'text-slate-800 dark:text-white' : 'text-slate-400 line-through'}`}>
                                  {emp.lastName}, {emp.firstName}
                                </p>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">{emp.fileNumber || '—'}</span>
                                  {emp.category && <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold">· {emp.category}</span>}
                                </div>
                                {objective && (
                                  <p className="text-[9px] text-indigo-400 font-bold truncate leading-tight">{objective.name}</p>
                                )}
                              </div>
                              <ChevronRight size={12} className={isSelected ? 'text-indigo-400 shrink-0' : 'text-slate-200 shrink-0'}/>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 shadow-sm flex flex-col overflow-hidden relative">
                        {selectedEmp ? (
                            <div className="h-full flex flex-col animate-in fade-in">
                                {/* EMPLOYEE DETAIL HEADER — compact */}
                                <div className="px-4 py-3 border-b dark:border-slate-700 bg-white dark:bg-slate-900">
                                    {/* fila 1: avatar + nombre + acciones */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-base font-black text-white shrink-0">
                                            {selectedEmp.lastName?.[0] || '?'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h2 className="text-[14px] font-black uppercase text-slate-900 dark:text-white leading-tight truncate">
                                                {selectedEmp.lastName}, {selectedEmp.firstName}
                                            </h2>
                                        </div>
                                        {/* acciones compactas */}
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onClick={openEditFromDetail}
                                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black uppercase shadow-sm"
                                                style={{ backgroundColor: 'var(--company-primary, #6366f1)', color: '#fff' }}
                                                title="Editar legajo">
                                                <Edit2 size={12}/> Editar
                                            </button>
                                            {selectedEmp.email && (
                                                <button onClick={() => handleSendPortalOne(selectedEmp)}
                                                    disabled={sendingPortalIds.has(selectedEmp.id)}
                                                    title={(selectedEmp as any).portalInvite?.sent ? 'Reenviar portal' : 'Enviar portal'}
                                                    className="flex items-center gap-1 px-2 py-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors text-[11px] font-black uppercase border border-indigo-200 disabled:opacity-50">
                                                    {sendingPortalIds.has(selectedEmp.id) ? <Loader2 size={11} className="animate-spin"/> : <KeyRound size={11}/>}
                                                    {(selectedEmp as any).portalInvite?.sent ? 'Reenviar' : 'Portal'}
                                                </button>
                                            )}
                                            {selectedEmp.email && (
                                                <button onClick={() => openPortalPwdModal(selectedEmp)}
                                                    title="Contraseña portal"
                                                    className="p-1.5 text-violet-600 hover:bg-violet-50 rounded-lg border border-violet-200 transition-colors">
                                                    <ShieldCheckIcon size={13}/>
                                                </button>
                                            )}
                                            {(selectedEmp.status === 'activo' || selectedEmp.status === 'active' || !selectedEmp.status) ? (
                                                <button onClick={() => { setBajaForm({ motivo: 'Desvinculación', fecha: new Date().toISOString().split('T')[0], observacion: '' }); setShowBajaModal(true); }}
                                                    className="flex items-center gap-1 px-2 py-1.5 text-rose-500 hover:bg-rose-50 rounded-lg border border-rose-200 text-[11px] font-black uppercase transition-colors"
                                                    title="Dar de baja">
                                                    <UserX size={11}/> Baja
                                                </button>
                                            ) : (
                                                <button onClick={() => handleReactivar(selectedEmp)}
                                                    className="flex items-center gap-1 px-2 py-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg border border-emerald-200 text-[11px] font-black uppercase transition-colors"
                                                    title="Reactivar">
                                                    <UserCheck size={11}/> Reactivar
                                                </button>
                                            )}
                                            {isSuperAdmin && (
                                                <button onClick={() => handleDelete(selectedEmp.id!)}
                                                    className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg border border-slate-200 transition-colors"
                                                    title="Eliminar permanente">
                                                    <Trash2 size={13}/>
                                                </button>
                                            )}
                                            <button onClick={() => setSelectedEmp(null)}
                                                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
                                                <X size={15}/>
                                            </button>
                                        </div>
                                    </div>
                                    {/* fila 2: badges compactos */}
                                    <div className="flex flex-wrap items-center gap-1 mt-2">
                                        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black uppercase ${(selectedEmp.status === 'activo' || selectedEmp.status === 'active') ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                            {(selectedEmp.status === 'activo' || selectedEmp.status === 'active') ? <UserCheck size={9}/> : <UserX size={9}/>}
                                            {selectedEmp.status || 'activo'}
                                        </span>
                                        {selectedEmp.fileNumber && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-600">Leg. {selectedEmp.fileNumber}</span>}
                                        {selectedEmp.category && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-700">{selectedEmp.category}</span>}
                                        {selectedEmp.laborAgreement && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700"><Book size={8}/> {selectedEmp.laborAgreement}</span>}
                                        {selectedEmp.startDate && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500"><Calendar size={8}/> Ing. {new Date(selectedEmp.startDate + 'T00:00:00').toLocaleDateString('es-AR')}</span>}
                                        {(selectedEmp as any).portalInvite?.sent
                                            ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700"><CheckCircle2 size={8}/> Portal</span>
                                            : selectedEmp.email ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700"><Mail size={8}/> Sin portal</span> : null}
                                        {selectedEmp.phone && <a href={`tel:${selectedEmp.phone}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-slate-500 hover:text-indigo-600 bg-slate-50 border border-slate-100 transition-colors"><Phone size={8}/> {selectedEmp.phone}</a>}
                                        {selectedEmp.address && (selectedEmp.lat && selectedEmp.lng
                                            ? <a href={`https://www.google.com/maps/search/?api=1&query=${selectedEmp.lat},${selectedEmp.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-indigo-600 hover:underline bg-slate-50 border border-slate-100"><MapPin size={8}/> {selectedEmp.address} <ExternalLink size={8}/></a>
                                            : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-100"><Home size={8}/> {selectedEmp.address}</span>)}
                                        {selectedEmp.motivoBaja && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-600"><UserX size={8}/> {selectedEmp.motivoBaja}</span>}
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                                    {empStats ? (
                                        <div className="space-y-3">
                                            {/* ── HERO: planificado vs ejecutado ────────── */}
                                            <div className={`rounded-xl shadow-lg relative overflow-hidden text-white ${empStats.isOverLimit ? 'bg-gradient-to-br from-rose-700 to-rose-900' : 'bg-gradient-to-br from-slate-800 to-slate-900'}`}>
                                                {empStats.isOverLimit && (
                                                  <div className="absolute top-0 left-0 w-full bg-rose-600 text-white text-[9px] font-black uppercase text-center py-0.5 animate-pulse tracking-widest">
                                                    ¡Límite mensual superado!
                                                  </div>
                                                )}
                                                <div className={`p-4 relative z-10 ${empStats.isOverLimit ? 'pt-7' : ''}`}>
                                                  {/* cabecera ciclo */}
                                                  <p className="text-[9px] font-black uppercase tracking-widest text-indigo-300 mb-3">
                                                    Ciclo CCT · {currentDate.toLocaleString('es-ES',{month:'long',year:'numeric'})} · ciclo día {selectedEmp.cycleStartDay || 26}
                                                  </p>
                                                  {/* columnas planificado | ejecutado */}
                                                  <div className="grid grid-cols-2 gap-3">
                                                    {/* planificado */}
                                                    <div>
                                                      <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">Planificado</p>
                                                      <div className="flex items-baseline gap-1.5">
                                                        <span className={`text-3xl font-black ${empStats.isOverLimit ? 'text-rose-300' : 'text-white'}`}>{empStats.totalPlanificado}h</span>
                                                        <span className="text-[10px] text-slate-400">/ {empStats.monthlyLimit}h límite</span>
                                                      </div>
                                                      <div className="mt-2 space-y-1">
                                                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                          <div className={`h-full rounded-full transition-all ${empStats.isOverLimit ? 'bg-rose-400' : 'bg-indigo-400'}`}
                                                            style={{ width:`${Math.min((empStats.totalPlanificado/empStats.monthlyLimit)*100,100)}%` }}/>
                                                        </div>
                                                        <p className="text-[9px] text-slate-500">{Math.round((empStats.totalPlanificado/empStats.monthlyLimit)*100)}% del límite · {Math.max(0,empStats.monthlyLimit-empStats.totalPlanificado)}h disponibles</p>
                                                      </div>
                                                    </div>
                                                    {/* ejecutado */}
                                                    <div className="border-l border-white/10 pl-3">
                                                      <p className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">Ejecutado</p>
                                                      <div className="flex items-baseline gap-1.5">
                                                        <span className="text-3xl font-black text-emerald-300">{empStats.totalRealizado}h</span>
                                                        <span className="text-[10px] text-slate-400">reales</span>
                                                      </div>
                                                      <div className="mt-2 space-y-1">
                                                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                          <div className="h-full rounded-full bg-emerald-400 transition-all"
                                                            style={{ width:`${empStats.totalPlanificado > 0 ? Math.min((empStats.totalRealizado/empStats.totalPlanificado)*100,100) : 0}%` }}/>
                                                        </div>
                                                        <p className="text-[9px] text-slate-500">{empStats.progress}% de lo planificado</p>
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                                {/* sub-stats row */}
                                                <div className="grid grid-cols-3 border-t border-white/10">
                                                  {[
                                                    { label:'Turnos',  value:empStats.shiftsCount,  color:'text-indigo-300' },
                                                    { label:'Francos', value:empStats.francosCount, color:'text-teal-300' },
                                                    { label:'Tardanzas', value:empStats.tardanzasCount||0, color: empStats.tardanzasCount > 0 ? 'text-amber-300' : 'text-slate-400' },
                                                  ].map((s,i) => (
                                                    <div key={i} className={`px-3 py-2 text-center ${i < 2 ? 'border-r border-white/10' : ''}`}>
                                                      <p className={`text-base font-black ${s.color}`}>{s.value}</p>
                                                      <p className="text-[8px] font-black uppercase text-slate-500">{s.label}</p>
                                                    </div>
                                                  ))}
                                                </div>
                                            </div>

                                            {/* ── Horas detalladas ──────────────────────── */}
                                            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
                                              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex items-center gap-2">
                                                <Clock size={11} className="text-indigo-500"/>
                                                <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Desglose de Horas</span>
                                              </div>
                                              {/* barra visual proporcional */}
                                              {empStats.totalPlanificado > 0 && (() => {
                                                const segments = [
                                                  { label:'Diurnas',    value:empStats.dayHours,       color:'#6366f1' },
                                                  { label:'Nocturnas',  value:empStats.nightHours,     color:'#0ea5e9' },
                                                  { label:'Ex 100%',    value:empStats.extra100,       color:'#ef4444' },
                                                  { label:'Ex 50%',     value:empStats.extra50,        color:'#f59e0b' },
                                                  { label:'+Feriado',   value:empStats.plusFeriado||0, color:'#10b981' },
                                                ].filter(s => s.value > 0);
                                                const total = segments.reduce((a,b)=>a+b.value,0)||1;
                                                return (
                                                  <div className="px-4 pt-3 pb-1">
                                                    <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                                                      {segments.map(s => (
                                                        <div key={s.label} className="h-full rounded-sm" style={{ width:`${(s.value/total)*100}%`, background:s.color }} title={`${s.label}: ${s.value}h`}/>
                                                      ))}
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 mt-1.5">
                                                      {segments.map(s => (
                                                        <div key={s.label} className="flex items-center gap-1">
                                                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:s.color }}/>
                                                          <span className="text-[9px] text-slate-500 font-bold">{s.label}</span>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                );
                                              })()}
                                              <div className="grid grid-cols-5 divide-x divide-slate-50 dark:divide-slate-700">
                                                {[
                                                  { label:'Diurnas',   value:empStats.dayHours,       color:'text-indigo-600',  bg:'#6366f1' },
                                                  { label:'Nocturnas', value:empStats.nightHours,     color:'text-sky-600',     bg:'#0ea5e9' },
                                                  { label:'Ex 50%',    value:empStats.extra50,        color:'text-amber-600',   bg:'#f59e0b' },
                                                  { label:'Ex 100%',   value:empStats.extra100,       color:'text-rose-600',    bg:'#ef4444' },
                                                  { label:'+Feriado',  value:empStats.plusFeriado||0, color:'text-emerald-600', bg:'#10b981' },
                                                ].map((c,i) => (
                                                  <div key={i} className="px-2 py-3 text-center">
                                                    <p className={`text-xl font-black ${c.color}`}>{c.value}<span className="text-xs font-bold">h</span></p>
                                                    <p className="text-[8px] font-black uppercase text-slate-400 mt-0.5 leading-tight">{c.label}</p>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>

                                            {/* ── Novedades del ciclo — fila única ─────── */}
                                            <div className="grid grid-cols-5 gap-1.5">
                                              {[
                                                { label:'Vacaciones', value:empStats.vacationsCount||0,  color:'text-teal-600',   bg:'bg-teal-50',    border:'border-teal-100',   icon:<Activity size={11}/> },
                                                { label:'Licencias',  value:empStats.licensesCount||0,   color:'text-violet-600', bg:'bg-violet-50',  border:'border-violet-100', icon:<FileText size={11}/> },
                                                { label:'Ausencias',  value:empStats.absencesCount,      color:'text-rose-600',   bg:'bg-rose-50',    border:'border-rose-100',   icon:<AlertOctagon size={11}/> },
                                                { label:'Tardanzas',  value:empStats.tardanzasCount||0,  color:'text-amber-600',  bg:'bg-amber-50',   border:'border-amber-100',  icon:<Clock size={11}/> },
                                                { label:'Francos',    value:empStats.francosCount,       color:'text-emerald-600',bg:'bg-emerald-50', border:'border-emerald-100',icon:<Coffee size={11}/> },
                                              ].map((s,i) => (
                                                <div key={i} className={`${s.bg} ${s.border} border rounded-lg p-2 flex flex-col items-center gap-0.5`}>
                                                  <span className={`${s.color} opacity-60`}>{s.icon}</span>
                                                  <span className={`text-lg font-black ${s.color}`}>{s.value}</span>
                                                  <span className={`text-[8px] font-black uppercase ${s.color} opacity-60 leading-tight text-center`}>{s.label}</span>
                                                </div>
                                              ))}
                                            </div>

                                            {/* ── Antigüedad del empleado ───────────────── */}
                                            {selectedEmp.startDate && (() => {
                                              const start = new Date(selectedEmp.startDate + 'T00:00:00');
                                              const now = new Date();
                                              const totalMs = now.getTime() - start.getTime();
                                              const years  = Math.floor(totalMs / (1000*60*60*24*365.25));
                                              const months = Math.floor((totalMs % (1000*60*60*24*365.25)) / (1000*60*60*24*30.44));
                                              return (
                                                <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/10 border border-amber-100 dark:border-amber-800 rounded-xl px-4 py-3 flex items-center gap-3">
                                                  <Award size={20} className="text-amber-500 shrink-0"/>
                                                  <div>
                                                    <p className="text-sm font-black text-amber-800 dark:text-amber-300">
                                                      {years > 0 ? `${years} año${years !== 1?'s':''} ` : ''}{months > 0 ? `${months} mes${months !== 1?'es':''}` : (years === 0 ? 'Menos de 1 mes' : '')} de antigüedad
                                                    </p>
                                                    <p className="text-[9px] text-amber-600 dark:text-amber-500">Ingreso: {start.toLocaleDateString('es-AR')}</p>
                                                  </div>
                                                </div>
                                              );
                                            })()}

                                            {/* ── Desglose por objetivo ─────────────────── */}
                                            {empStats.objectives.length > 0 && (
                                              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden">
                                                <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex items-center gap-2">
                                                  <Target size={11} className="text-indigo-500"/>
                                                  <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Horas por Objetivo</span>
                                                </div>
                                                {(() => {
                                                  const totalObjHours = empStats.objectives.reduce((acc: number, o: any) => acc + o.hours, 0);
                                                  return empStats.objectives.map((o: any, i: number) => {
                                                    const pct = totalObjHours > 0 ? Math.round((o.hours / totalObjHours) * 100) : 0;
                                                    return (
                                                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}/>
                                                        <div className="flex-1 min-w-0">
                                                          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase truncate">{o.name}</p>
                                                          <div className="w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full mt-1">
                                                            <div className="h-full rounded-full" style={{ width:`${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}/>
                                                          </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                          <span className="text-sm font-black text-slate-900 dark:text-white">{Math.round(o.hours)}h</span>
                                                          <p className="text-[9px] text-slate-400">{pct}%</p>
                                                        </div>
                                                      </div>
                                                    );
                                                  });
                                                })()}
                                              </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex h-40 items-center justify-center gap-3 text-slate-400 font-bold">
                                            <Loader2 size={20} className="animate-spin text-indigo-400"/>
                                            Calculando métricas del período...
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-400">
                                <Users size={36} className="text-slate-200"/>
                                <p className="text-[13px] font-bold text-slate-400">Seleccioná un empleado para ver su detalle</p>
                                <button onClick={() => setActiveTab('dashboard')} className="text-[11px] text-indigo-500 hover:underline flex items-center gap-1">
                                    <BarChart2 size={12}/> Ver Dashboard General
                                </button>
                                {/*PLACEHOLDER_END*/}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'legajos' && view === 'form' && (
                <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 shadow-sm p-8 animate-in slide-in-from-right-10 overflow-y-auto">
                    <div className="flex justify-between items-center mb-8"><div className="flex items-center gap-4"><button onClick={() => setView('list')} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><ArrowLeft/></button><h2 className="text-2xl font-black uppercase dark:text-white">{isEditing ? `Editar: ${form.lastName}` : 'Nuevo Legajo'}</h2></div><div className="flex flex-wrap gap-2">{(['PERSONAL', 'LABORAL', 'TALLES', 'EXPERIENCIA', 'VOLANTE', 'RESTRICCIONES'] as const).map(tab => { const restrCount = (form.restriccionesObjetivo?.length || 0) + (form.restriccionesCliente?.length || 0) + (form.conflictosEmpleados?.length || 0); const expCount = countExperienciaObjetivos(form.experienciaObjetivos); const volCount = (form.volante || []).length; const active = activeFormTab === tab; const tabClass = active ? (tab === 'RESTRICCIONES' ? 'bg-rose-600 text-white shadow-lg' : tab === 'EXPERIENCIA' ? 'bg-teal-600 text-white shadow-lg' : tab === 'VOLANTE' ? 'bg-violet-600 text-white shadow-lg' : 'bg-indigo-600 text-white shadow-lg') : (tab === 'RESTRICCIONES' && restrCount > 0 ? 'bg-rose-100 text-rose-600' : tab === 'EXPERIENCIA' && expCount > 0 ? 'bg-teal-100 text-teal-700' : tab === 'VOLANTE' && volCount > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'); const label = tab === 'RESTRICCIONES' && restrCount > 0 ? `RESTRICCIONES (${restrCount})` : tab === 'EXPERIENCIA' && expCount > 0 ? `EXPERIENCIA (${expCount})` : tab === 'VOLANTE' && volCount > 0 ? `VOLANTE (${volCount})` : tab; return (<button key={tab} onClick={() => setActiveFormTab(tab)} className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${tabClass}`}>{label}</button>); })}</div></div>
                    <div className="max-w-4xl mx-auto space-y-8">
                        {activeFormTab === 'PERSONAL' && (<div className="grid grid-cols-2 gap-6"><div><label className={labelClass}>Nombre</label><input className={inputClass} value={form.firstName || ''} onChange={e => setForm({...form, firstName: e.target.value})} /></div><div><label className={labelClass}>Apellido</label><input className={inputClass} value={form.lastName || ''} onChange={e => setForm({...form, lastName: e.target.value})} /></div><div><label className={labelClass}>DNI</label><input className={inputClass} value={form.dni || ''} onChange={e => setForm({...form, dni: e.target.value})} /></div><div><label className={labelClass}>CUIL</label><input className={inputClass} value={form.cuil || ''} onChange={e => setForm({...form, cuil: e.target.value})} /></div><div><label className={labelClass}>Género</label><select className={selectClass} value={form.genero || ''} onChange={e => setForm({...form, genero: e.target.value})}><option value="">Sin especificar</option><option value="M">Masculino</option><option value="F">Femenino</option></select></div><div><label className={labelClass}>Email</label><input className={inputClass} value={form.email || ''} onChange={e => setForm({...form, email: e.target.value})} /></div><div><label className={labelClass}>Teléfono</label><input className={inputClass} value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} /></div>
                        {/* --- CAMPO DIRECCION Y GEOLOCALIZACION --- */}
                        <div className="col-span-2">
                            <label className={labelClass}>Dirección</label>
                            <div className="flex gap-2">
                                <input className={inputClass} value={form.address || ''} onChange={e => setForm({...form, address: e.target.value})} placeholder="Calle, Número, Localidad"/>
                                <button onClick={handleGeocode} disabled={isGeocoding} className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold uppercase text-xs flex items-center gap-2 transition-colors whitespace-nowrap">
                                    {isGeocoding ? <><Loader2 size={14} className="animate-spin"/> Buscando...</> : <><MapPin size={16}/> Geolocalizar</>}
                                </button>
                            </div>
                            {form.lat ? (
                                <p className="text-[10px] text-emerald-600 mt-1 ml-1 flex items-center gap-1">
                                    <MapPin size={10}/> Ubicación guardada: {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
                                    <a href={`https://www.google.com/maps?q=${form.lat},${form.lng}`} target="_blank" rel="noreferrer" className="underline text-indigo-500 ml-1">Ver en mapa</a>
                                    <button onClick={() => setForm({...form, lat: null, lng: null})} className="ml-1 text-rose-400 hover:text-rose-600"><X size={10}/></button>
                                </p>
                            ) : (
                                <p className="text-[10px] text-slate-400 mt-1 ml-1">Sin coordenadas</p>
                            )}
                            {/* Panel coordenadas manuales */}
                            {showManualCoords && (
                                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                    <p className="text-[11px] font-bold text-amber-700 mb-2">No se encontró la dirección automáticamente. Podés ingresar las coordenadas manualmente (buscalas en Google Maps haciendo clic derecho en el punto):</p>
                                    <div className="flex gap-2 items-end">
                                        <div>
                                            <label className="text-[10px] font-black text-slate-500 uppercase">Latitud</label>
                                            <input className="border rounded-lg px-2 py-1.5 text-xs w-36" placeholder="-31.4167" value={manualLat} onChange={e => setManualLat(e.target.value)}/>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-500 uppercase">Longitud</label>
                                            <input className="border rounded-lg px-2 py-1.5 text-xs w-36" placeholder="-64.1833" value={manualLng} onChange={e => setManualLng(e.target.value)}/>
                                        </div>
                                        <button onClick={handleSaveManualCoords} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold">Guardar</button>
                                        <button onClick={() => setShowManualCoords(false)} className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold">Cancelar</button>
                                    </div>
                                </div>
                            )}
                        </div>
                        </div>)}
                        {activeFormTab === 'LABORAL' && (<div className="grid grid-cols-2 gap-6"><div><label className={labelClass}>Legajo Nº</label><input className={inputClass} value={form.fileNumber || ''} onChange={e => setForm({...form, fileNumber: e.target.value})} /></div><div><label className={labelClass}>Fecha Ingreso</label><input type="date" className={inputClass} value={form.startDate || ''} onChange={e => setForm({...form, startDate: e.target.value})} /></div><div><label className={labelClass}>Convenio</label><select className={selectClass} value={form.laborAgreement || ''} onChange={e => setForm({...form, laborAgreement: e.target.value})}><option value="">Seleccionar...</option>{agreements.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</select></div><div><label className={labelClass}>Categoría</label><select className={selectClass} value={form.category || ''} onChange={e => setForm({...form, category: e.target.value})}><option value="">Seleccionar...</option>{availableCategories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                        <div><label className={labelClass}>Objetivo Preferido</label><SearchableSelect className={selectClass} value={form.preferredObjectiveId || ''} onChange={v => setForm({...form, preferredObjectiveId: v})} placeholder="Ninguno" options={[{value:'',label:'Ninguno'},...[...allObjectives].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(obj=>({value:obj.id,label:obj.name}))]} /></div>
                        <div><label className={labelClass}>Inicio Ciclo Liquidación (Día)</label><input type="number" min="1" max="31" className={inputClass} value={form.cycleStartDay || 26} onChange={e => setForm({...form, cycleStartDay: parseInt(e.target.value)})} placeholder="Ej: 26"/></div><div><label className={labelClass}>Estado</label><select className={selectClass} value={form.status || 'activo'} onChange={e => setForm({...form, status: e.target.value})}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></div></div>)}
                        {activeFormTab === 'TALLES' && (<div className="grid grid-cols-3 gap-6"><div><label className={labelClass}>Camisa/Remera</label><input className={inputClass} value={form.sizes?.shirt || ''} onChange={e => setForm({...form, sizes: {...form.sizes, shirt: e.target.value}})} /></div><div><label className={labelClass}>Pantalón</label><input className={inputClass} value={form.sizes?.pants || ''} onChange={e => setForm({...form, sizes: {...form.sizes, pants: e.target.value}})} /></div><div><label className={labelClass}>Calzado</label><input className={inputClass} value={form.sizes?.shoes || ''} onChange={e => setForm({...form, sizes: {...form.sizes, shoes: e.target.value}})} /></div></div>)}
                        {activeFormTab === 'EXPERIENCIA' && (
                          <ExperienciaObjetivosPanel
                            experienciaObjetivos={form.experienciaObjetivos}
                            preferredObjectiveId={form.preferredObjectiveId}
                            allObjectives={allObjectives}
                          />
                        )}
                        {activeFormTab === 'VOLANTE' && (
                          <div className="space-y-6">
                            <div>
                              <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white mb-1">Objetivos como volante</h3>
                              <p className="text-[11px] text-slate-400 mb-4">Objetivos donde este guardia puede cubrir ausencias aunque no sea su objetivo base. El motor de cobertura lo considera como comodín.</p>
                              <div className="flex gap-2 mb-3">
                                <SearchableSelect
                                  className="flex-1"
                                  value={newVolanteObjId}
                                  onChange={v => setNewVolanteObjId(v)}
                                  placeholder="Agregar objetivo..."
                                  options={[...allObjectives]
                                    .filter(o => o.id !== form.preferredObjectiveId && !(form.volante || []).includes(o.id))
                                    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                                    .map(o => ({ value: o.id, label: o.name }))}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!newVolanteObjId) return;
                                    if ((form.volante || []).includes(newVolanteObjId)) return;
                                    setForm({ ...form, volante: [...(form.volante || []), newVolanteObjId] });
                                    setNewVolanteObjId('');
                                  }}
                                  className="px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-black hover:bg-violet-700 transition-colors flex items-center gap-1"
                                >
                                  <Plus size={14} /> Agregar
                                </button>
                              </div>
                              {(form.volante || []).length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic">Sin objetivos volante asignados.</p>
                              ) : (
                                <div className="space-y-2">
                                  {(form.volante || []).map((objId: string) => {
                                    const obj = allObjectives.find(o => o.id === objId);
                                    const clientName = obj ? (obj as any).clientName || '' : '';
                                    return (
                                      <div key={objId} className="flex items-center justify-between p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl">
                                        <div className="flex items-center gap-3">
                                          <Shuffle size={14} className="text-violet-500" />
                                          <div>
                                            <p className="text-xs font-bold text-slate-800 dark:text-white">{obj?.name || objId}</p>
                                            {clientName && <p className="text-[10px] text-slate-400">{clientName}</p>}
                                          </div>
                                          <span className="px-1.5 py-0.5 bg-violet-500 text-white text-[9px] font-black rounded uppercase">VOLANTE</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setForm({ ...form, volante: (form.volante || []).filter((id: string) => id !== objId) })}
                                          className="text-slate-400 hover:text-rose-500 transition-colors"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {activeFormTab === 'RESTRICCIONES' && (
                          <div className="space-y-8">
                            {/* — Objetivos excluidos — */}
                            <div>
                              <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white mb-1">Objetivos excluidos</h3>
                              <p className="text-[11px] text-slate-400 mb-4">El empleado no puede ser asignado en estos objetivos. El planificador mostrará una advertencia.</p>
                              <div className="flex gap-2 mb-3">
                                <select className={selectClass} value={newObjRestr.objectiveId} onChange={e => setNewObjRestr({...newObjRestr, objectiveId: e.target.value})}>
                                  <option value="">Seleccionar objetivo...</option>
                                  {[...allObjectives].sort((a,b) => a.name.localeCompare(b.name)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                                <input className={inputClass} placeholder="Motivo (opcional)" value={newObjRestr.reason} onChange={e => setNewObjRestr({...newObjRestr, reason: e.target.value})} />
                                <button onClick={() => {
                                  if (!newObjRestr.objectiveId) return;
                                  const obj = allObjectives.find(o => o.id === newObjRestr.objectiveId);
                                  const already = (form.restriccionesObjetivo || []).some((r: any) => r.objectiveId === newObjRestr.objectiveId);
                                  if (already) return;
                                  setForm({...form, restriccionesObjetivo: [...(form.restriccionesObjetivo || []), { objectiveId: newObjRestr.objectiveId, objectiveName: obj?.name || '', reason: newObjRestr.reason, date: new Date().toISOString().split('T')[0] }]});
                                  setNewObjRestr({ objectiveId: '', reason: '' });
                                }} className="px-4 py-2 bg-rose-600 text-white rounded-xl font-black uppercase text-xs hover:bg-rose-700 whitespace-nowrap">+ Agregar</button>
                              </div>
                              {(form.restriccionesObjetivo || []).length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic">Sin objetivos excluidos.</p>
                              ) : (
                                <div className="space-y-2">
                                  {(form.restriccionesObjetivo || []).map((r: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-200 rounded-xl">
                                      <div className="flex-1">
                                        <p className="text-xs font-black text-rose-800 uppercase">{r.objectiveName || 'Sin objetivo'}</p>
                                        {r.reason && <p className="text-[10px] text-rose-500">{r.reason}</p>}
                                        <p className="text-[10px] text-slate-400">{r.date}</p>
                                      </div>
                                      <button onClick={() => setForm({...form, restriccionesObjetivo: (form.restriccionesObjetivo || []).filter((_: any, idx: number) => idx !== i)})} className="p-1 hover:bg-rose-100 text-rose-400 rounded-lg"><X size={14}/></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* — Clientes excluidos — */}
                            <div>
                              <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white mb-1">Clientes excluidos</h3>
                              <p className="text-[11px] text-slate-400 mb-4">El empleado no puede ser asignado en ningún objetivo de estos clientes.</p>
                              <div className="flex gap-2 mb-3">
                                <select className={selectClass} value={newClientRestr.clientId} onChange={e => setNewClientRestr({...newClientRestr, clientId: e.target.value})}>
                                  <option value="">Seleccionar cliente...</option>
                                  {[...clients].sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                <input className={inputClass} placeholder="Motivo (opcional)" value={newClientRestr.reason} onChange={e => setNewClientRestr({...newClientRestr, reason: e.target.value})} />
                                <button onClick={() => {
                                  if (!newClientRestr.clientId) return;
                                  const cli = clients.find(c => c.id === newClientRestr.clientId);
                                  if ((form.restriccionesCliente || []).some((r: any) => r.clientId === newClientRestr.clientId)) return;
                                  setForm({...form, restriccionesCliente: [...(form.restriccionesCliente || []), { clientId: newClientRestr.clientId, clientName: cli?.name || '', reason: newClientRestr.reason, date: new Date().toISOString().split('T')[0] }]});
                                  setNewClientRestr({ clientId: '', reason: '' });
                                }} className="px-4 py-2 bg-rose-600 text-white rounded-xl font-black uppercase text-xs hover:bg-rose-700 whitespace-nowrap">+ Agregar</button>
                              </div>
                              {(form.restriccionesCliente || []).length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic">Sin clientes excluidos.</p>
                              ) : (
                                <div className="space-y-2">
                                  {(form.restriccionesCliente || []).map((r: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-200 rounded-xl">
                                      <div className="flex-1">
                                        <p className="text-xs font-black text-rose-800 uppercase">{r.clientName || r.clientId}</p>
                                        {r.reason && <p className="text-[10px] text-rose-500">{r.reason}</p>}
                                        <p className="text-[10px] text-slate-400">{r.date}</p>
                                      </div>
                                      <button onClick={() => setForm({...form, restriccionesCliente: (form.restriccionesCliente || []).filter((_: any, idx: number) => idx !== i)})} className="p-1 hover:bg-rose-100 text-rose-400 rounded-lg"><X size={14}/></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* — Conflictos con compañeros — */}
                            <div>
                              <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white mb-1">Conflictos con compañeros</h3>
                              <p className="text-[11px] text-slate-400 mb-4">Si este empleado ya está en el cronograma de un objetivo y se intenta asignar al compañero en conflicto, el planificador mostrará una advertencia.</p>
                              <div className="flex gap-2 mb-3">
                                <select className={selectClass} value={newEmpConflict.employeeId} onChange={e => setNewEmpConflict({...newEmpConflict, employeeId: e.target.value})}>
                                  <option value="">Seleccionar empleado...</option>
                                  {[...employees].filter(e => e.id !== form.id).sort((a,b) => (a.lastName||'').localeCompare(b.lastName||'')).map(e => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName}</option>)}
                                </select>
                                <input className={inputClass} placeholder="Motivo (opcional)" value={newEmpConflict.reason} onChange={e => setNewEmpConflict({...newEmpConflict, reason: e.target.value})} />
                                <button onClick={() => {
                                  if (!newEmpConflict.employeeId) return;
                                  const emp = employees.find(e => e.id === newEmpConflict.employeeId);
                                  const already = (form.conflictosEmpleados || []).some((c: any) => c.employeeId === newEmpConflict.employeeId);
                                  if (already) return;
                                  setForm({...form, conflictosEmpleados: [...(form.conflictosEmpleados || []), { employeeId: newEmpConflict.employeeId, employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : '', reason: newEmpConflict.reason, date: new Date().toISOString().split('T')[0] }]});
                                  setNewEmpConflict({ employeeId: '', reason: '' });
                                }} className="px-4 py-2 bg-amber-500 text-white rounded-xl font-black uppercase text-xs hover:bg-amber-600 whitespace-nowrap">+ Agregar</button>
                              </div>
                              {(form.conflictosEmpleados || []).length === 0 ? (
                                <p className="text-[11px] text-slate-400 italic">Sin conflictos registrados.</p>
                              ) : (
                                <div className="space-y-2">
                                  {(form.conflictosEmpleados || []).map((c: any, i: number) => (
                                    <div key={i} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                      <div className="flex-1">
                                        <p className="text-xs font-black text-amber-800 uppercase">{c.employeeName || c.employeeId}</p>
                                        {c.reason && <p className="text-[10px] text-amber-500">{c.reason}</p>}
                                        <p className="text-[10px] text-slate-400">{c.date}</p>
                                      </div>
                                      <button onClick={() => setForm({...form, conflictosEmpleados: (form.conflictosEmpleados || []).filter((_: any, idx: number) => idx !== i)})} className="p-1 hover:bg-amber-100 text-amber-400 rounded-lg"><X size={14}/></button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="pt-8 border-t dark:border-slate-700 flex justify-end gap-4"><button onClick={() => setView('list')} className="px-6 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold uppercase text-xs">Cancelar</button><button onClick={handleSave} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-indigo-700 transition-transform hover:scale-105">Guardar Cambios</button></div>
                    </div>
                </div>
            )}

            {/* OTROS TABS (AUSENCIAS, FERIADOS, CONVENIOS - SIN CAMBIOS) */}
            {activeTab === 'feriados' && (<div className="flex-1 flex gap-6 overflow-hidden"><div className="w-1/3 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6"><h3 className="text-lg font-black text-slate-900 dark:text-white uppercase mb-4">Gestión Feriados</h3><div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800 mb-6"><label className="text-[10px] font-black uppercase text-indigo-600 mb-2 block">Importar Oficiales</label><div className="flex gap-2"><select className={selectClass} value={syncYear} onChange={e => setSyncYear(parseInt(e.target.value))}><option value={2024}>2024</option><option value={2025}>2025</option><option value={2026}>2026</option></select><button onClick={handleSyncHolidays} disabled={isSyncing} className="flex-1 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">{isSyncing ? '...' : <><Download size={14}/> Sincronizar</>}</button></div></div><div className="space-y-4 pt-4 border-t dark:border-slate-700"><p className="text-[10px] font-black uppercase text-slate-400">Carga Manual</p><input className={inputClass} value={holidayForm.name} onChange={e => setHolidayForm({...holidayForm, name: e.target.value})} placeholder="Nombre del Feriado"/><input type="date" className={inputClass} value={holidayForm.date} onChange={e => setHolidayForm({...holidayForm, date: e.target.value})}/><button onClick={handleSaveHoliday} className="w-full bg-slate-900 text-white py-3 rounded-xl font-black uppercase text-xs">Guardar Manual</button></div></div><div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 overflow-auto custom-scrollbar"><div className="grid grid-cols-1 gap-3">{holidays.map(h => (<div key={h.id} className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border dark:border-slate-700"><div className="flex items-center gap-4"><Calendar size={20} className="text-indigo-500"/><div><p className="font-black dark:text-white uppercase">{h.name}</p><p className="text-xs font-mono text-slate-500">{new Date(h.date + 'T00:00:00').toLocaleDateString()}</p></div></div><button onClick={() => handleDeleteHoliday(h.id!)} className="text-slate-400 hover:text-rose-500"><X size={20}/></button></div>))}</div></div></div>)}
            {activeTab === 'convenios' && (<div className="flex-1 flex gap-6 overflow-hidden"><div className="w-1/3 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 overflow-y-auto"><h3 className="text-lg font-black text-slate-900 dark:text-white uppercase mb-4 flex items-center gap-2">{isEditingAgreement ? <Edit2 size={18}/> : <Book size={18}/>} {isEditingAgreement ? 'Editar' : 'Nuevo'} Convenio</h3><div className="space-y-4"><div><label className={labelClass}>Nombre</label><input className={inputClass} value={agreementForm.name} onChange={e => setAgreementForm({...agreementForm, name: e.target.value})}/></div><div className="grid grid-cols-2 gap-4"><div><label className={labelClass}>Semanal (hs)</label><input type="number" className={inputClass} value={agreementForm.maxHoursWeekly} onChange={e => setAgreementForm({...agreementForm, maxHoursWeekly: parseInt(e.target.value)})}/></div><div><label className={labelClass}>Mensual (hs)</label><input type="number" className={inputClass} value={agreementForm.maxHoursMonthly} onChange={e => setAgreementForm({...agreementForm, maxHoursMonthly: parseInt(e.target.value)})}/></div></div><div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border dark:border-slate-700"><label className={labelClass}>Sábados &gt; 13hs</label><div className="flex gap-2"><button onClick={() => setAgreementForm({...agreementForm, saturdayRate: 0})} className={`flex-1 py-2 rounded-lg text-[10px] font-black ${agreementForm.saturdayRate === 0 ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>NORMAL</button><button onClick={() => setAgreementForm({...agreementForm, saturdayRate: 50})} className={`flex-1 py-2 rounded-lg text-[10px] font-black ${agreementForm.saturdayRate === 50 ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>50%</button><button onClick={() => setAgreementForm({...agreementForm, saturdayRate: 100})} className={`flex-1 py-2 rounded-lg text-[10px] font-black ${agreementForm.saturdayRate === 100 ? 'bg-rose-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>100%</button></div></div><div className="space-y-2"><div className="flex items-center gap-2"><input type="checkbox" checked={agreementForm.paysDoubleOnFranco} onChange={e => setAgreementForm({...agreementForm, paysDoubleOnFranco: e.target.checked})}/><span className="text-xs font-bold dark:text-white">Paga Franco Trabajado 100%</span></div><div className="flex items-center gap-2"><input type="checkbox" checked={agreementForm.holidayIsPlus} onChange={e => setAgreementForm({...agreementForm, holidayIsPlus: e.target.checked})}/><span className="text-xs font-bold dark:text-white text-emerald-600">Feriados se pagan como PLUS</span></div><div className="flex items-center gap-2"><input type="checkbox" checked={agreementForm.sundayIs100} onChange={e => setAgreementForm({...agreementForm, sundayIs100: e.target.checked})}/><span className="text-xs font-bold dark:text-white">Domingos al 100%</span></div></div><div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border dark:border-slate-700"><label className={labelClass}>Categorías</label><div className="flex gap-2 mb-2"><input className="flex-1 p-2 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-900 dark:text-white" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Ej: Vigilador"/><button onClick={handleAddCategory} className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Plus size={14}/></button></div><div className="flex flex-wrap gap-2">{agreementForm.categories.map((c, idx) => (<span key={idx} className="px-2 py-1 bg-white dark:bg-slate-800 rounded-lg text-[10px] font-bold border dark:border-slate-600 flex items-center gap-1">{c} <button onClick={() => removeCategory(idx)} className="text-rose-500"><X size={10}/></button></span>))}</div></div><div className="flex gap-2">{isEditingAgreement && <button onClick={() => { setIsEditingAgreement(false); setAgreementForm(initialAgreement); }} className="px-4 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs uppercase">Cancelar</button>}<button onClick={handleSaveAgreement} className="flex-1 bg-amber-500 text-white py-3 rounded-xl font-black uppercase text-xs">Guardar</button></div></div></div><div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6 overflow-auto custom-scrollbar"><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{agreements.map(a => (<div key={a.id} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-xl border dark:border-slate-700 relative group"><div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => handleEditAgreement(a)} className="text-slate-300 hover:text-indigo-500"><Edit2 size={18}/></button><button onClick={() => handleDeleteAgreement(a.id!)} className="text-slate-300 hover:text-rose-500"><Trash2 size={18}/></button></div><h3 className="font-black text-slate-800 dark:text-white uppercase mb-2">{a.name}</h3><div className="space-y-1 text-xs text-slate-500"><p>Semanal: {a.maxHoursWeekly}hs | Mensual: {a.maxHoursMonthly}hs</p><p>Sábado &gt; 13hs: <span className="font-bold text-indigo-500">{a.saturdayRate === 0 ? 'Normal' : a.saturdayRate + '%'}</span></p><p className="flex gap-2 mt-2">{a.holidayIsPlus && <span className="bg-emerald-100 text-emerald-700 px-2 rounded-full text-[9px] font-bold">Feriado PLUS</span>}{a.paysDoubleOnFranco && <span className="bg-indigo-100 text-indigo-700 px-2 rounded-full text-[9px] font-bold">Franco 100%</span>}</p></div></div>))}</div></div></div>)}
            {activeTab === 'correcciones' && (
                <CorreccionesTab employees={employees} canAdjust={canAdjust} />
            )}
            {activeTab === 'ausencias' && (
                <AusenciasTab
                    canAdjust={canAdjust}
                    filteredAbsences={filteredAbsences}
                    absenceSearchTerm={absenceSearchTerm}
                    setAbsenceSearchTerm={setAbsenceSearchTerm}
                    absenceTypeFilter={absenceTypeFilter}
                    setAbsenceTypeFilter={setAbsenceTypeFilter}
                    absenceStatusFilter={absenceStatusFilter}
                    setAbsenceStatusFilter={setAbsenceStatusFilter}
                    absenceDateFilterMode={absenceDateFilterMode}
                    setAbsenceDateFilterMode={setAbsenceDateFilterMode}
                    absencePeriodFilter={absencePeriodFilter}
                    setAbsencePeriodFilter={setAbsencePeriodFilter}
                    absenceCalendarMonth={absenceCalendarMonth}
                    setAbsenceCalendarMonth={setAbsenceCalendarMonth}
                    absenceSelectedDays={absenceSelectedDays}
                    setAbsenceSelectedDays={setAbsenceSelectedDays}
                    absencePeriods={absencePeriods}
                    absenceCalendarCells={absenceCalendarCells}
                    toggleAbsenceCalendarDay={toggleAbsenceCalendarDay}
                    selectedAbsenceIds={selectedAbsenceIds}
                    setSelectedAbsenceIds={setSelectedAbsenceIds}
                    getAbsenceEmployeeName={getAbsenceEmployeeName}
                    getArgentinaDate={getArgentinaDate}
                    renderAbsenceStatusCell={renderAbsenceStatusCell}
                    coberturaBadgeClass={coberturaBadgeClass}
                    handleOpenAbsenceModal={handleOpenAbsenceModal}
                    handleDeleteAbsence={handleDeleteAbsence}
                />
            )}
        </div>

        {/* MODAL DE IMPORTACIÓN CSV (AMPLIADO) */}
        {showImportModal && (
            <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 p-8 rounded-xl w-full max-w-6xl shadow-2xl relative flex flex-col h-[90vh]">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2"><FileSpreadsheet className="text-emerald-500"/> Importación Masiva</h3>
                            <p className="text-sm text-slate-500">Carga empleados desde un archivo CSV o Excel exportado a CSV.</p>
                            {isSuperAdmin && (
                                <div className="mt-3 flex items-center gap-3">
                                    <span className="text-xs font-black uppercase text-slate-500">Importar a empresa:</span>
                                    <select
                                        value={importEmpresaId}
                                        onChange={e => setImportEmpresaId(e.target.value)}
                                        className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg text-xs font-bold text-indigo-700 dark:text-indigo-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                                    >
                                        {empresas.length > 0
                                            ? empresas.map(e => <option key={e.id} value={e.id}>{e.name || e.id}</option>)
                                            : <option value={empresaId}>{empresa?.name || empresaId}</option>
                                        }
                                    </select>
                                </div>
                            )}
                            <div className="mt-3">
                                <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                                    <div
                                        onClick={() => setImportAsInactive(v => !v)}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${importAsInactive ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${importAsInactive ? 'translate-x-5' : ''}`}/>
                                    </div>
                                    <span className={`text-xs font-black uppercase ${importAsInactive ? 'text-amber-600' : 'text-slate-400'}`}>
                                        Importar como inactivos
                                    </span>
                                    {importAsInactive && (
                                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                            Los empleados se crearán con estado Inactivo
                                        </span>
                                    )}
                                </label>
                            </div>
                            <div className="mt-2">
                                <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                                    <div
                                        onClick={() => setImportWithGeo(v => !v)}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${importWithGeo ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${importWithGeo ? 'translate-x-5' : ''}`}/>
                                    </div>
                                    <span className={`text-xs font-black uppercase ${importWithGeo ? 'text-indigo-600' : 'text-slate-400'}`}>
                                        Geolocalizar al importar
                                    </span>
                                    {importWithGeo && (
                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                                            Puede tardar varios minutos
                                        </span>
                                    )}
                                </label>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleDownloadTemplate} className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-black uppercase hover:bg-indigo-100 transition-colors flex items-center gap-2"><Download size={14}/> Descargar Plantilla</button>
                            <button onClick={() => {setShowImportModal(false); setImportPreview([]); setCsvContent(''); setImportAsInactive(false); setImportWithGeo(false);}} className="p-2 hover:bg-slate-100 rounded-full"><X/></button>
                        </div>
                    </div>

                    {!csvContent ? (
                        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/50 p-10">
                            <UploadCloud size={64} className="text-indigo-400 mb-4"/>
                            <p className="font-bold text-slate-600 dark:text-slate-300 mb-2">Arrastra tu archivo aquí o haz clic para seleccionar</p>
                            <p className="text-xs text-slate-400 mb-6">Formato soportado: .csv (Excel: Guardar como &gt; CSV delimitado por comas)</p>
                            <input type="file" accept=".csv" className="hidden" id="csv-upload" onChange={handleFileUpload} />
                            <label htmlFor="csv-upload" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black text-xs uppercase cursor-pointer hover:bg-indigo-700 shadow-lg transition-transform hover:scale-105">Seleccionar Archivo</label>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden">
                            <div className="flex justify-between items-center mb-4">
                                <span className="font-bold text-slate-700 dark:text-slate-300">Vista Previa ({importPreview.length} registros válidos)</span>
                                <div className="flex gap-2">
                                    <button onClick={handleProcessCSV} className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-white rounded-lg text-xs font-bold">Re-Procesar</button>
                                    <button onClick={() => setCsvContent('')} className="px-4 py-2 text-rose-500 font-bold text-xs">Cancelar</button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto border rounded-xl">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-100 dark:bg-slate-900 sticky top-0">
                                        <tr>
                                            <th className="p-3">Legajo</th>
                                            <th className="p-3">Apellido, Nombre</th>
                                            <th className="p-3">DNI / CUIL</th>
                                            <th className="p-3">Convenio</th>
                                            <th className="p-3">Cat.</th>
                                            <th className="p-3">Género</th>
                                            <th className="p-3">Estado</th>
                                            {/* COLUMNAS ADICIONALES SOLICITADAS */}
                                            <th className="p-3">Objetivo</th>
                                            <th className="p-3">Contacto</th>
                                            <th className="p-3">Dirección</th>
                                            <th className="p-3">Ingreso</th>
                                            <th className="p-3">Ciclo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {importPreview.map((row, i) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                                <td className="p-3 font-mono">{row.fileNumber}</td>
                                                <td className="p-3 font-bold">{row.name}</td>
                                                <td className="p-3">{row.dni}</td>
                                                <td className="p-3">{row.laborAgreement}</td>
                                                <td className="p-3">{row.category}</td>
                                                <td className="p-3 font-mono">{row.genero === 'M' ? 'M' : row.genero === 'F' ? 'F' : '-'}</td>
                                                <td className="p-3">
                                                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${(importAsInactive || row.status === 'inactivo') ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                        {importAsInactive ? 'inactivo' : (row.status || 'activo')}
                                                    </span>
                                                </td>
                                                {/* DATA EXTRA */}
                                                <td className="p-3">
                                                    {/* Mostrar check si encontró ID, o el nombre crudo si no */}
                                                    {row.preferredObjectiveId ? (
                                                        <span className="text-emerald-600 font-bold flex items-center gap-1"><CheckCircle size={10}/> {allObjectives.find(o=>o.id===row.preferredObjectiveId)?.name || 'ID OK'}</span>
                                                    ) : (
                                                        <span className="text-rose-400 italic">{row.objectiveName || '-'} (No enc.)</span>
                                                    )}
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex flex-col text-[10px]">
                                                        {row.email && <span className="text-indigo-500">{row.email}</span>}
                                                        {row.phone && <span>{row.phone}</span>}
                                                        {!row.email && !row.phone && <span className="text-slate-300">-</span>}
                                                    </div>
                                                </td>
                                                <td className="p-3 text-[10px] truncate max-w-[150px]" title={row.address}>{row.address || '-'}</td>
                                                <td className="p-3 font-mono">{row.startDate || '-'}</td>
                                                <td className="p-3 font-mono">{row.cycleStartDay}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="pt-6 mt-4 border-t flex justify-end">
                                <button onClick={confirmImport} disabled={isImporting || importPreview.length === 0} className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-black text-sm shadow-sm hover:bg-emerald-700 transition-transform hover:scale-105 disabled:opacity-50 disabled:scale-100">
                                    {isImporting ? (importStatusMsg || 'Importando...') : `Confirmar Importación (${importPreview.length})`}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* --- VISTA DE IMPRESIÓN --- */}
        <div id="printable-report" className="hidden print:block bg-white p-8 w-full h-full absolute top-0 left-0 z-[9999]">
            {selectedEmp ? (
                <div>
                    {/* ENCABEZADO REPORTE */}
                    <div className="flex justify-between items-center border-b-2 border-black pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-bold uppercase">Ficha de Liquidación</h1>
                            <p className="text-sm text-gray-600">Periodo: {currentDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()}</p>
                        </div>
                        <div className="text-right">
                            <h2 className="text-xl font-black">CRONOAPP</h2>
                            <p className="text-xs text-gray-500">Generado el: {new Date().toLocaleDateString()}</p>
                        </div>
                    </div>

                    {/* DATOS EMPLEADO */}
                    <div className="grid grid-cols-2 gap-4 mb-6 border border-gray-300 p-4 rounded-lg">
                        <div><span className="font-bold text-xs uppercase block text-gray-500">Empleado:</span> {selectedEmp.lastName}, {selectedEmp.firstName}</div>
                        <div><span className="font-bold text-xs uppercase block text-gray-500">Legajo:</span> {selectedEmp.fileNumber}</div>
                        <div><span className="font-bold text-xs uppercase block text-gray-500">CUIL:</span> {selectedEmp.cuil}</div>
                        <div><span className="font-bold text-xs uppercase block text-gray-500">Convenio:</span> {selectedEmp.laborAgreement}</div>
                        <div><span className="font-bold text-xs uppercase block text-gray-500">Categoría:</span> {selectedEmp.category}</div>
                        <div><span className="font-bold text-xs uppercase block text-gray-500">Ciclo:</span> Día {selectedEmp.cycleStartDay} al {selectedEmp.cycleStartDay! - 1}</div>
                    </div>

                    {/* TABLA DE HORAS */}
                    {empStats && (
                        <div className="mb-8">
                            <h3 className="font-bold uppercase text-sm mb-2 border-b border-gray-200">Resumen de Horas</h3>
                            <table className="w-full text-sm text-left border border-gray-300">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="p-2 border">Concepto</th>
                                        <th className="p-2 border text-right">Cantidad</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr><td className="p-2 border">Horas Diurnas</td><td className="p-2 border text-right">{empStats.dayHours} hs</td></tr>
                                    <tr><td className="p-2 border">Horas Nocturnas</td><td className="p-2 border text-right">{empStats.nightHours} hs</td></tr>
                                    <tr><td className="p-2 border">Horas al 50% (Extras)</td><td className="p-2 border text-right">{empStats.extra50} hs</td></tr>
                                    <tr><td className="p-2 border">Horas al 100% (Franco Trab.)</td><td className="p-2 border text-right">{empStats.extra100} hs</td></tr>
                                    <tr><td className="p-2 border">Plus Feriado</td><td className="p-2 border text-right">{empStats.plusFeriado || 0} hs</td></tr>
                                    <tr className="bg-gray-50 font-semibold"><td className="p-2 border">Total Planificado</td><td className="p-2 border text-right">{empStats.totalPlanificado} hs</td></tr>
                                    <tr className="bg-indigo-50 font-bold"><td className="p-2 border">TOTAL REALIZADO (Real)</td><td className="p-2 border text-right">{empStats.totalRealizado} hs</td></tr>
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* DESGLOSE OBJETIVOS */}
                    {empStats && empStats.objectives.length > 0 && (
                        <div className="mb-8">
                            <h3 className="font-bold uppercase text-sm mb-2 border-b border-gray-200">Distribución por Objetivo</h3>
                            <table className="w-full text-sm text-left border border-gray-300">
                                <thead className="bg-gray-100"><tr><th className="p-2 border">Objetivo / Cliente</th><th className="p-2 border text-right">Horas</th></tr></thead>
                                <tbody>
                                    {empStats.objectives.map((o:any, i:number) => (
                                        <tr key={i}><td className="p-2 border">{o.name}</td><td className="p-2 border text-right">{Math.round(o.hours)} hs</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* NOVEDADES Y OBSERVACIONES */}
                    <div className="mb-12">
                        <h3 className="font-bold uppercase text-sm mb-2 border-b border-gray-200">Novedades del Periodo</h3>
                        <div className="border border-gray-300 p-4 min-h-[100px] text-sm">
                            {/* Ausencias */}
                            {empStats?.absencesCount > 0 && <p className="mb-2"><strong>Ausencias:</strong> {empStats.absencesCount} días.</p>}
                            {(empStats?.tardanzasCount||0) > 0 && <p className="mb-2"><strong>Tardanzas:</strong> {empStats.tardanzasCount} registradas en el período.</p>}
                            {/* Observaciones extraidas de los turnos */}
                            {empStats?.reportData?.turnos?.filter((t:any) => t.extensionNote || t.entryNote)?.map((t:any, i:number) => (
                                <p key={i} className="mb-1 text-xs text-gray-600">
                                    • {new Date(t.startTime.seconds * 1000).toLocaleDateString()}: {t.extensionNote || t.entryNote}
                                </p>
                            ))}
                            {(!empStats?.absencesCount && !empStats?.reportData?.turnos?.some((t:any) => t.extensionNote || t.entryNote)) && (
                                <p className="text-gray-400 italic">Sin novedades registradas.</p>
                            )}
                        </div>
                    </div>

                    {/* FIRMAS */}
                    <div className="flex justify-between mt-20 pt-8 border-t border-gray-200">
                        <div className="text-center w-1/3">
                            <div className="border-t border-black mb-2 mx-4"></div>
                            <p className="text-xs font-bold uppercase">Conforme Empleado</p>
                        </div>
                        <div className="text-center w-1/3">
                            <div className="border-t border-black mb-2 mx-4"></div>
                            <p className="text-xs font-bold uppercase">Responsable RRHH</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="text-center p-20">
                    <h1 className="text-4xl font-black mb-4">Reporte General de Nómina</h1>
                    <p>Por favor seleccione un empleado individual para imprimir su ficha detallada, o use la opción "Exportar CSV" para el reporte masivo.</p>
                </div>
            )}
        </div>
        {showAbsenceModal && createPortal(
            <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowAbsenceModal(false)}>
                <div className="bg-white dark:bg-slate-800 p-8 rounded-xl w-full max-w-lg shadow-2xl">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-100 dark:bg-rose-900/30 rounded-xl flex items-center justify-center"><AlertTriangle size={20} className="text-rose-500"/></div>
                            <div>
                                <h3 className="text-lg font-black text-slate-900 dark:text-white">{isEditingAbsence ? 'Editar Novedad' : 'Nueva Novedad'}</h3>
                                <p className="text-xs text-slate-500 font-bold uppercase">Registro de ausencia / novedad</p>
                            </div>
                        </div>
                        <button onClick={() => setShowAbsenceModal(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-400"><X size={20}/></button>
                    </div>
                    <div className="space-y-4" onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (!t.closest('[data-absence-emp-picker]')) setEmpDropOpen(false);
                    }}>
                        <div className="relative" data-absence-emp-picker>
                            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Empleado</label>
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-[1]"/>
                                <input
                                    autoFocus={!isEditingAbsence}
                                    type="text"
                                    placeholder="Buscar por apellido, nombre o legajo..."
                                    value={empDropOpen || empSearch ? empSearch : (absenceForm.employeeId ? absenceEmployeeLabel(absenceForm.employeeId, absenceForm.employeeName) : '')}
                                    onChange={e => {
                                        setEmpSearch(e.target.value);
                                        setEmpDropOpen(true);
                                        if (absenceForm.employeeId) {
                                            setAbsenceForm(f => ({ ...f, employeeId: '', employeeName: '' }));
                                        }
                                    }}
                                    onFocus={() => {
                                        setEmpDropOpen(true);
                                        if (absenceForm.employeeId && !empSearch) {
                                            setEmpSearch('');
                                        }
                                    }}
                                    className="w-full pl-9 pr-10 py-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"
                                />
                                {absenceForm.employeeId && !empDropOpen && !empSearch && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAbsenceForm(f => ({ ...f, employeeId: '', employeeName: '' }));
                                            setEmpSearch('');
                                            setEmpDropOpen(true);
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"
                                        title="Cambiar empleado"
                                    >
                                        <X size={14}/>
                                    </button>
                                )}
                                {empDropOpen && (
                                    <div className="absolute z-[250] top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg max-h-52 overflow-y-auto custom-scrollbar">
                                        {filteredAbsenceEmployees.map(e => (
                                            <button
                                                key={e.id}
                                                type="button"
                                                onMouseDown={() => {
                                                    setAbsenceForm(f => ({
                                                        ...f,
                                                        employeeId: e.id,
                                                        employeeName: `${e.firstName} ${e.lastName}`,
                                                    }));
                                                    setEmpSearch('');
                                                    setEmpDropOpen(false);
                                                }}
                                                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors border-b border-slate-50 dark:border-slate-700 last:border-0 ${absenceForm.employeeId === e.id ? 'bg-rose-50 dark:bg-rose-900/20' : ''}`}
                                            >
                                                <span className="font-black text-slate-800 dark:text-slate-100">{e.lastName}, {e.firstName}</span>
                                                {(e.fileNumber || e.dni) && (
                                                    <span className="block text-[10px] text-slate-400 font-bold mt-0.5">
                                                        {[e.fileNumber && `Leg. ${e.fileNumber}`, e.dni && `DNI ${e.dni}`].filter(Boolean).join(' · ')}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                        {filteredAbsenceEmployees.length === 0 && (
                                            <p className="px-4 py-3 text-xs text-slate-400 italic">Sin resultados — probá apellido o legajo</p>
                                        )}
                                    </div>
                                )}
                            </div>
                            {absenceForm.employeeId && !empDropOpen && (
                                <p className="text-[10px] text-emerald-600 font-bold mt-1 ml-1">Empleado seleccionado</p>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Tipo</label>
                                <select
                                    value={absenceForm.type}
                                    onChange={e => {
                                        const type = e.target.value;
                                        setAbsenceForm(f => {
                                            const medical = absenceNeedsMedicalVerification({ type });
                                            let status = f.status;
                                            if (medical && (status === 'Pendiente' || status === 'Autorizada')) {
                                                status = 'En verificación';
                                            } else if (!medical && status === 'En verificación') {
                                                status = 'Pendiente';
                                            }
                                            return { ...f, type, status };
                                        });
                                    }}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"
                                >
                                    {NOVEDAD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Estado</label>
                                <select
                                    value={absenceForm.status}
                                    onChange={e => setAbsenceForm(f => ({...f, status: e.target.value as Absence['status']}))}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"
                                >
                                    {(absenceNeedsMedicalVerification(absenceForm)
                                        ? ['En verificación', 'Justificada', 'Injustificada', 'Rechazada']
                                        : ['Pendiente', 'Autorizada', 'Justificada', 'Injustificada', 'Rechazada']
                                    ).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>
                        {absenceNeedsMedicalVerification(absenceForm) && absenceForm.status === 'En verificación' && (
                            <p className="text-[10px] font-bold text-violet-600 -mt-2">
                                Enfermedad/ART: impacta planificación de inmediato. Verificá el certificado para pasar a Justificada o Injustificada.
                            </p>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Fecha inicio</label>
                                <input
                                    type="date"
                                    value={absenceForm.startDate}
                                    onChange={e => {
                                        const startDate = e.target.value;
                                        setAbsenceForm(f => ({
                                            ...f,
                                            startDate,
                                            endDate: f.endDate && f.endDate < startDate ? startDate : f.endDate,
                                        }));
                                    }}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Fecha fin</label>
                                <input
                                    type="date"
                                    value={absenceForm.endDate}
                                    min={absenceForm.startDate || undefined}
                                    onChange={e => setAbsenceForm(f => ({ ...f, endDate: e.target.value }))}
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"
                                />
                            </div>
                        </div>
                        {absenceDateRangeError && (
                            <p className="text-xs font-bold text-rose-600 -mt-2">{absenceDateRangeError}</p>
                        )}
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Motivo (opcional)</label>
                            <input type="text" value={absenceForm.reason || ''} onChange={e => setAbsenceForm(f => ({...f, reason: e.target.value}))} placeholder="Descripción breve..." className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"/>
                        </div>
                        {absenceForm.status === 'Rechazada' && (
                            <div className="space-y-3 p-4 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-800">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-rose-600 dark:text-rose-400 block mb-1 ml-1">Motivo de rechazo *</label>
                                    <input
                                        type="text"
                                        value={absenceForm.rejectionReason || ''}
                                        onChange={e => setAbsenceForm(f => ({...f, rejectionReason: e.target.value}))}
                                        placeholder="Ingrese el motivo del rechazo..."
                                        className="w-full p-3 bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-700 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-rose-600 dark:text-rose-400 block mb-1 ml-1">Ofrecer período alternativo (opcional)</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[9px] text-slate-400 ml-1 block">Desde</label>
                                            <input type="date" value={absenceForm.alternativePeriodStart || ''} onChange={e => setAbsenceForm(f => ({...f, alternativePeriodStart: e.target.value}))} className="w-full p-3 bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"/>
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-slate-400 ml-1 block">Hasta</label>
                                            <input type="date" value={absenceForm.alternativePeriodEnd || ''} onChange={e => setAbsenceForm(f => ({...f, alternativePeriodEnd: e.target.value}))} className="w-full p-3 bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-800 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"/>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-600">
                                <input type="checkbox" id="hasCert" checked={absenceForm.hasCertificate} onChange={e => setAbsenceForm(f => ({...f, hasCertificate: e.target.checked}))} className="w-4 h-4 rounded accent-rose-600"/>
                                <label htmlFor="hasCert" className="text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer flex items-center gap-2"><FileCheck size={14} className="text-rose-500"/> Presenta certificado / documentación</label>
                            </div>
                            {(absenceForm.certificateDriveLink || absenceForm.certificateUrl) ? (
                                <a
                                    href={absenceForm.certificateDriveLink || absenceForm.certificateUrl || '#'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center gap-2 w-full p-3 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-black text-sm hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors shadow-sm"
                                >
                                    <ExternalLink size={16} />
                                    Ver certificado adjunto
                                    {absenceForm.certificateDriveLink ? (
                                        <span className="font-bold text-indigo-500 dark:text-indigo-400">(Google Drive)</span>
                                    ) : null}
                                    {absenceForm.certificateName ? (
                                        <span className="font-bold text-indigo-500 dark:text-indigo-400 truncate max-w-[45%]">({absenceForm.certificateName})</span>
                                    ) : null}
                                </a>
                            ) : absenceForm.hasCertificate ? (
                                <p className="text-xs font-bold text-amber-600 dark:text-amber-400 px-1">
                                    Figura certificado en la solicitud; si no ves el enlace, recargá la página o pedí al empleado que reenvíe el archivo desde el portal.
                                </p>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex gap-3 mt-6">
                        <button onClick={() => setShowAbsenceModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-sm hover:bg-slate-50 transition-colors">Cancelar</button>
                        <button
                            onClick={handleSaveAbsence}
                            disabled={!!absenceDateRangeError}
                            className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black text-sm transition-colors flex items-center justify-center gap-2"
                        >
                            <Save size={15}/> {isEditingAbsence ? 'Actualizar' : 'Registrar'}
                        </button>
                    </div>
                </div>
            </div>
        , document.body)}

        {showBajaModal && selectedEmp && (
            <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setShowBajaModal(false)}>
                <div className="bg-white dark:bg-slate-800 p-8 rounded-xl w-full max-w-md shadow-2xl">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-rose-100 rounded-xl flex items-center justify-center"><UserX size={20} className="text-rose-500"/></div>
                        <div>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">Dar de baja</h3>
                            <p className="text-xs text-slate-500 font-bold uppercase">{selectedEmp.lastName}, {selectedEmp.firstName}</p>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Motivo de baja</label>
                            <select value={bajaForm.motivo} onChange={e => setBajaForm(f => ({...f, motivo: e.target.value}))} className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400">
                                <option>Desvinculación</option>
                                <option>Renuncia</option>
                                <option>Fin de contrato</option>
                                <option>Jubilación</option>
                                <option>Fallecimiento</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Fecha de baja</label>
                            <input type="date" value={bajaForm.fecha} onChange={e => setBajaForm(f => ({...f, fecha: e.target.value}))} className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400"/>
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1 ml-1">Observaciones</label>
                            <textarea value={bajaForm.observacion} onChange={e => setBajaForm(f => ({...f, observacion: e.target.value}))} rows={3} placeholder="Detalles adicionales..." className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl font-bold text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-400 resize-none"/>
                        </div>
                    </div>
                    <div className="flex gap-3 mt-6">
                        <button onClick={() => setShowBajaModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-sm hover:bg-slate-50 transition-colors">Cancelar</button>
                        <button onClick={handleDarDeBaja} className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-sm transition-colors flex items-center justify-center gap-2">
                            <UserX size={15}/> Confirmar baja
                        </button>
                    </div>
                </div>
            </div>
        )}
        {bulkDeleting && (
            <div className="fixed inset-0 bg-black/70 z-[400] flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 w-full max-w-sm flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-rose-600 border-t-transparent rounded-full animate-spin"/>
                    <p className="text-base font-black text-slate-900 dark:text-white uppercase">Eliminando novedades...</p>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                        <div className="bg-rose-600 h-3 rounded-full transition-all duration-300" style={{width:`${bulkDeleteProgress}%`}}/>
                    </div>
                    <p className="text-xs font-bold text-slate-500">{bulkDeleteProgress}% completado</p>
                </div>
            </div>
        )}
        {verifyModal && (
            <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget && !verifyLoading) setVerifyModal(null); }}>
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 w-full max-w-sm">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center"><FileCheck size={18} className="text-violet-600"/></div>
                        <div>
                            <h3 className="font-black text-base text-slate-900 dark:text-white uppercase">Verificar enfermedad</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{verifyModal.absence.type} — {verifyModal.absence.employeeName}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{getArgentinaDate(verifyModal.absence.startDate)} → {getArgentinaDate(verifyModal.absence.endDate)}</p>
                        </div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
                        La guardia ya figura ausente en planificación. Confirmá si el certificado justifica la ausencia o marcala como injustificada.
                    </p>
                    {(verifyModal.absence.certificateDriveLink || verifyModal.absence.certificateUrl) ? (
                        <a
                            href={verifyModal.absence.certificateDriveLink || verifyModal.absence.certificateUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full p-3 mb-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-black text-xs uppercase hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                        >
                            <ExternalLink size={14} />
                            Ver certificado
                        </a>
                    ) : null}
                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => handleVerifyMedicalSubmit('Justificada')}
                            disabled={verifyLoading}
                            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black text-xs uppercase transition-colors flex items-center justify-center gap-2"
                        >
                            {verifyLoading ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Justificada (con certificado)
                        </button>
                        <button
                            type="button"
                            onClick={() => handleVerifyMedicalSubmit('Injustificada')}
                            disabled={verifyLoading}
                            className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-black text-xs uppercase transition-colors flex items-center justify-center gap-2"
                        >
                            {verifyLoading ? <Loader2 size={14} className="animate-spin"/> : <AlertTriangle size={14}/>} Injustificada
                        </button>
                        <button type="button" onClick={() => setVerifyModal(null)} disabled={verifyLoading} className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-xs uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
                    </div>
                </div>
            </div>
        )}
        {authPinModal && (
            <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setAuthPinModal(null); setAuthPinValue(''); setAuthPinError(''); } }}>
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 w-full max-w-sm">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center"><KeyRound size={18} className="text-amber-600"/></div>
                        <div>
                            <h3 className="font-black text-base text-slate-900 dark:text-white uppercase">Autorizar Novedad</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{authPinModal.absence.type} — {authPinModal.absence.employeeName}</p>
                        </div>
                    </div>
                    <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleAuthorizePinSubmit(); }} className="contents">
                    <label className="text-[10px] font-black uppercase text-slate-400 block mb-1 ml-1">PIN Supervisor</label>
                    <SupervisorPinInput
                        maxLength={6}
                        autoFocus
                        className="w-full px-4 py-3 border dark:border-slate-600 rounded-xl text-center text-2xl font-black tracking-widest bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400 mb-1"
                        value={authPinValue}
                        onChange={e => { setAuthPinValue(e.target.value); setAuthPinError(''); }}
                        onKeyDown={e => e.key === 'Enter' && handleAuthorizePinSubmit()}
                    />
                    {authPinError && <p className="text-rose-500 text-xs font-bold mt-1 mb-2 ml-1">{authPinError}</p>}
                    <div className="flex gap-3 mt-4">
                        <button type="button" onClick={() => { setAuthPinModal(null); setAuthPinValue(''); setAuthPinError(''); }} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-sm hover:bg-slate-50 transition-colors">Cancelar</button>
                        <button type="submit" disabled={authPinLoading} className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-black text-sm transition-colors flex items-center justify-center gap-2">
                            {authPinLoading ? <Loader2 size={15} className="animate-spin"/> : <KeyRound size={15}/>} Autorizar
                        </button>
                    </div>
                    </form>
                </div>
            </div>
        )}

        {/* ── Modal contraseña portal empleado ── */}
        {showPortalPwdModal && portalPwdEmp && (
            <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowPortalPwdModal(false); }}>
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 bg-violet-100 dark:bg-violet-900/40 rounded-xl flex items-center justify-center"><KeyRound size={18} className="text-violet-600 dark:text-violet-400"/></div>
                        <div>
                            <h3 className="font-black text-base text-slate-900 dark:text-white uppercase">Contraseña portal</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{portalPwdEmp.lastName}, {portalPwdEmp.firstName}</p>
                        </div>
                    </div>

                    {/* Modo auto / manual */}
                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={() => { setPortalPwdMode('auto'); setPortalPwdValue(generateRandomPassword()); setPortalPwdShow(false); }}
                            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-colors ${portalPwdMode === 'auto' ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
                        >Generar automático</button>
                        <button
                            onClick={() => { setPortalPwdMode('manual'); setPortalPwdValue(''); }}
                            className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-colors ${portalPwdMode === 'manual' ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}
                        >Ingresar manual</button>
                    </div>

                    {/* Campo contraseña */}
                    <div className="mb-4">
                        <label className={labelClass}>Contraseña</label>
                        <div className="relative">
                            <input
                                type={portalPwdShow ? 'text' : 'password'}
                                value={portalPwdValue}
                                onChange={e => setPortalPwdValue(e.target.value)}
                                readOnly={portalPwdMode === 'auto'}
                                placeholder="Mínimo 6 caracteres"
                                className={`${inputClass} pr-10 font-mono ${portalPwdMode === 'auto' ? 'bg-slate-50 dark:bg-slate-900' : ''}`}
                            />
                            <button type="button" onClick={() => setPortalPwdShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                {portalPwdShow ? <EyeOff size={16}/> : <Eye size={16}/>}
                            </button>
                        </div>
                        {portalPwdMode === 'auto' && (
                            <button onClick={() => setPortalPwdValue(generateRandomPassword())} className="mt-1 text-[10px] text-violet-600 hover:underline font-bold">↺ Nueva contraseña</button>
                        )}
                    </div>

                    {/* Toggle bypass validación de dispositivo */}
                    <div className="flex items-center justify-between mb-5 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
                        <div>
                            <p className="text-xs font-black text-amber-800 dark:text-amber-400">Omitir validación de dispositivo</p>
                            <p className="text-[10px] text-amber-600 dark:text-amber-500">El empleado podrá acceder desde cualquier celular sin activar</p>
                        </div>
                        <button
                            onClick={async () => {
                                const newVal = !(portalPwdEmp.bypassDeviceCheck || false);
                                try {
                                    await updateDoc(doc(db, 'empleados', portalPwdEmp.id), { bypassDeviceCheck: newVal });
                                    setPortalPwdEmp((e: any) => ({ ...e, bypassDeviceCheck: newVal }));
                                } catch (err: any) { addToast('Error: ' + err.message, 'error'); }
                            }}
                            className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${portalPwdEmp.bypassDeviceCheck ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${portalPwdEmp.bypassDeviceCheck ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                        </button>
                    </div>

                    <div className="flex gap-3">
                        <button onClick={() => setShowPortalPwdModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-black text-sm hover:bg-slate-50 transition-colors">Cancelar</button>
                        <button onClick={handleConfirmPortalPassword} disabled={portalPwdSending || portalPwdValue.trim().length < 6} className="flex-1 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm transition-colors flex items-center justify-center gap-2">
                            {portalPwdSending ? <Loader2 size={15} className="animate-spin"/> : <KeyRound size={15}/>} Confirmar
                        </button>
                    </div>
                </div>
            </div>
        )}
    </DashboardLayout>
  );
}
