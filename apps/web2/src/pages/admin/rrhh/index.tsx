
import React, { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { employeeService, Employee } from '@/services/employeeService';
import { absenceService, Absence } from '@/services/absenceService';
import { holidayService, Holiday } from '@/services/holidayService';
import { agreementService } from '@/services/agreementService';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth'; 
import { collection, getDocs, query, where, Timestamp, addDoc, updateDoc, doc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/context/ToastContext';
import { 
    Users, Search, Plus, Edit2, Trash2, 
    FileText, X, CheckCircle, ChevronRight, ChevronLeft,
    BarChart2, Book, Download, Coffee, AlertOctagon, FileCheck,
    FileSpreadsheet, Shirt, Info, UploadCloud, FileDown, Activity, AlertTriangle, Calendar, Briefcase, Save, ArrowLeft, Printer,
    PieChart as PieChartIcon, TrendingUp, Clock, Target, MapPin, ExternalLink
} from 'lucide-react';

import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// --- UTILIDADES ---

const getArgentinaDate = (dateInput: any): string => {
    if (!dateInput) return '';
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
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
        createdAt: new Date().toISOString(),
        sizes: data.sizes || { shirt: '', pants: '', shoes: '' }
    };
};

const getNightDuration = (start: Date, end: Date, nightStart: number, nightEnd: number) => {
    let durationMins = 0;
    let current = new Date(start.getTime());
    const endTime = end.getTime();
    while (current.getTime() < endTime) {
        const h = current.getHours();
        if (h >= nightStart || h < nightEnd) durationMins++;
        current.setMinutes(current.getMinutes() + 1);
    }
    return durationMins / 60;
};

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const OPERATIVE_CODES = ['M', 'T', 'N', 'D12', 'N12', 'PU', 'GU', 'FT']; 
const SHIFT_HOURS_LOOKUP: Record<string, number> = { 'M':8, 'T':8, 'N':8, 'D12':12, 'N12':12, 'PU':12, 'GU':8, 'FT': 0, 'F':0, 'V':0, 'L':0, 'A':0, 'E':0 };

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

export default function EmployeesPage() {
  const { addToast } = useToast();
  const [currentUserName, setCurrentUserName] = useState("Cargando...");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'legajos' | 'ausencias' | 'feriados' | 'convenios'>('legajos');
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
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const initialAbsenceForm: Absence = { employeeId: '', employeeName: '', type: 'Enfermedad', startDate: new Date().toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0], status: 'Pendiente', hasCertificate: false, reason: '', comments: '' };
  const [absenceForm, setAbsenceForm] = useState<Absence>(initialAbsenceForm);
  const [isEditingAbsence, setIsEditingAbsence] = useState(false);

  const [holidayForm, setHolidayForm] = useState<any>({ date: '', name: '', type: 'Nacional' });
  const [syncYear, setSyncYear] = useState(new Date().getFullYear());
  const [isSyncing, setIsSyncing] = useState(false);
  
  const initialAgreement: ExtendedAgreement = { name: '', code: '', maxHoursWeekly: 48, maxHoursMonthly: 200, saturdayCutoffHour: 13, saturdayRate: 0, nightShiftStart: 21, nightShiftEnd: 6, paysDoubleOnFranco: true, categories: [], holidayIsPlus: true, sundayIs100: false };
  const [agreementForm, setAgreementForm] = useState<ExtendedAgreement>(initialAgreement);
  const [newCategory, setNewCategory] = useState('');
  const [isEditingAgreement, setIsEditingAgreement] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  
  const [activeFormTab, setActiveFormTab] = useState<'PERSONAL' | 'LABORAL' | 'TALLES' | 'DOCS'>('PERSONAL');
  const initialForm: any = { firstName: '', lastName: '', dni: '', fileNumber: '', phone: '', email: '', category: '', status: 'activo', laborAgreement: '', preferredClientId: '', preferredObjectiveId: '', sizes: { shirt:'', pants:'', shoes:'' }, cuil: '', address: '', lat: null, lng: null, contractType: 'FullTime', periodType: 'Mensual', cycleStartDay: 26, maxHours: 200 };
  const [form, setForm] = useState<any>(initialForm);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const inputClass = "w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all";
  const selectClass = "w-full p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none";
  const labelClass = "text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1 block ml-1";

  // --- HOOKS ---
  useEffect(() => { const auth = getAuth(); onAuthStateChanged(auth, (user) => { if (user) setCurrentUserName(user.displayName || user.email || "Usuario Sin Nombre"); else setCurrentUserName("No Logueado"); }); }, []);
  const registrarAuditoria = async (accion: string, detalle: string) => { try { const auth = getAuth(); const u = auth.currentUser; await addDoc(collection(db, 'audit_logs'), { timestamp: serverTimestamp(), actorUid: u?.uid || "unknown", actorName: u?.displayName || u?.email || "Desc", action: accion, module: 'RRHH', details: detalle, metadata: { platform: 'web' } }); } catch (error) {} };

  const getCycleDates = (refDate: Date, startDay: number = 26) => { const year = refDate.getFullYear(); const month = refDate.getMonth(); const start = new Date(year, month - 1, startDay); start.setHours(0,0,0,0); const end = new Date(year, month, startDay - 1); end.setHours(23,59,59,999); return { start, end }; };

  const replicarAusenciaEnPlanificador = async (absenceId: string, data: Absence) => { try { const auth = getAuth(); const u = auth.currentUser; const q = query(collection(db, 'turnos'), where('absenceId', '==', absenceId)); const snapshot = await getDocs(q); const batch = writeBatch(db); snapshot.docs.forEach(d => batch.delete(d.ref)); const [sY, sM, sD] = data.startDate.split('-').map(Number); const [eY, eM, eD] = data.endDate.split('-').map(Number); const start = new Date(sY, sM - 1, sD); const end = new Date(eY, eM - 1, eD); let code = 'A'; const t = data.type.toLowerCase(); if (t.includes('vacaci')) code = 'V'; else if (t.includes('licencia')) code = 'L'; else if (t.includes('enfermedad') || t.includes('medico')) code = 'E'; for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) { const turnoRef = doc(collection(db, 'turnos')); batch.set(turnoRef, { employeeId: data.employeeId, employeeName: data.employeeName, startTime: Timestamp.fromDate(new Date(d.setHours(0, 0, 0, 0))), endTime: Timestamp.fromDate(new Date(d.setHours(23, 59, 59, 999))), type: 'NOVEDAD', code: code, status: 'Approved', objectiveName: `NOVEDAD - ${data.type}`, clientId: 'INTERNO', absenceId: absenceId, isFranco: false, comments: data.reason }); } await batch.commit(); } catch (e) { addToast('Error replicando', 'error'); } };
  const eliminarReplicasPlanificador = async (absenceId: string) => { try { const q = query(collection(db, 'turnos'), where('absenceId', '==', absenceId)); const snapshot = await getDocs(q); const batch = writeBatch(db); snapshot.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); } catch (e) {} };

  useEffect(() => { loadData(); loadClientsAndObjectives(); loadAbsences(); loadHolidays(); loadAgreements(); }, []);
  useEffect(() => { const activeAbs = absences.filter(a => a.status === 'Pendiente' || a.status === 'Justificada').length; const nextHols = holidays.filter(h => new Date(h.date) >= new Date()).length; setGlobalStats({ totalEmployees: employees.length, activeAbsences: activeAbs, nextHolidays: nextHols }); }, [employees, absences, holidays]);
  useEffect(() => { const term = searchTerm.toLowerCase(); setFilteredEmployees(employees.filter(e => (e.lastName || '').toLowerCase().includes(term) || (e.firstName || '').toLowerCase().includes(term) || (e.fileNumber || '').includes(term))); }, [searchTerm, employees]);
  useEffect(() => { const term = absenceSearchTerm.toLowerCase(); setFilteredAbsences(absences.filter(a => { const name = a.employeeName || ''; let searchableName = name; if (!name && a.employeeId) { const emp = employees.find(e => e.id === a.employeeId); if (emp) searchableName = `${emp.lastName} ${emp.firstName}`; } return searchableName.toLowerCase().includes(term); })); }, [absenceSearchTerm, absences, employees]);
  useEffect(() => { if (form.laborAgreement) { const selectedAgreement = agreements.find(a => a.name === form.laborAgreement); setAvailableCategories(selectedAgreement?.categories?.length ? selectedAgreement.categories : ['General']); } else { setAvailableCategories([]); } }, [form.laborAgreement, agreements]);
  
  useEffect(() => { if (selectedEmp && holidays.length > 0) { calculateStats(selectedEmp.id!, selectedEmp.laborAgreement || '', selectedEmp.cycleStartDay || 26); } }, [currentDate, selectedEmp, holidays, agreements]);

  // --- CARGA DE DATOS RAW (SIN FILTROS DE SERVICIO) ---
  const loadData = async () => { 
      try {
          const snapshot = await getDocs(collection(db, 'empleados'));
          const data = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
          }));
          const sorted = data.sort((a: any, b: any) => (a.lastName || '').localeCompare(b.lastName || '')); 
          setEmployees(sorted); 
      } catch (e) {
          console.error("Error cargando empleados:", e);
      }
  };

  const loadAbsences = async () => { const data = await absenceService.getAll(); setAbsences(data); };
  const loadHolidays = async () => { const data = await holidayService.getAll(); setHolidays(data); };
  const loadAgreements = async () => { const data = await agreementService.getAll(); setAgreements(data.map(a => ({...a, categories: Array.isArray(a.categories) ? a.categories : [], paysDoubleOnFranco: !!a.paysDoubleOnFranco} as ExtendedAgreement))); };
  const loadClientsAndObjectives = async () => { try { const cSnap = await getDocs(collection(db, 'clients')); setClients(cSnap.docs.map(d => ({ id: d.id, ...d.data() }))); const sSnap = await getDocs(query(collection(db, 'servicios_sla'), where('status', '==', 'active'))); setAllObjectives(sSnap.docs.map(d => ({ id: d.id, name: d.data().objectiveName || d.data().name, clientId: d.data().clientId }))); } catch (e) {} };

  // --- CALCULO ESTADISTICAS ---
  const calculateStats = async (empId: string, empAgreementName: string, cycleStartDay: number = 26) => {
      setLoadingStats(true);
      try {
          const ruleBase: ExtendedAgreement = agreements.find(a => a.name === empAgreementName) || initialAgreement;
          const rule = { ...ruleBase, holidayIsPlus: ruleBase.holidayIsPlus ?? true, paysDoubleOnFranco: ruleBase.paysDoubleOnFranco ?? true };
          const { start: firstDay, end: lastDay } = getCycleDates(currentDate, cycleStartDay);
          
          const qTurnos = query(collection(db, 'turnos'), where('employeeId', '==', empId), where('startTime', '>=', Timestamp.fromDate(firstDay)), where('startTime', '<=', Timestamp.fromDate(lastDay)));
          const turnosSnap = await getDocs(qTurnos);
          const sortedDocs = turnosSnap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a:any, b:any) => a.startTime.seconds - b.startTime.seconds);
          
          const qAusencias = query(collection(db, 'ausencias'), where('employeeId', '==', empId));
          const ausenciasSnap = await getDocs(qAusencias);
          let totalVacaciones = 0, totalLicencias = 0, totalAusencias = 0, totalEnfermedad = 0;
          
          ausenciasSnap.docs.forEach(doc => {
             const data = doc.data();
             const [sY, sM, sD] = data.startDate.split('-').map(Number);
             const [eY, eM, eD] = data.endDate.split('-').map(Number);
             const start = new Date(sY, sM - 1, sD);
             const end = new Date(eY, eM - 1, eD);
             if (start <= lastDay && end >= firstDay) {
                 const daysCount = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                 const type = (data.type || '').toLowerCase();
                 if (type.includes('vacacion')) totalVacaciones += daysCount;
                 else if (type.includes('enfermedad') || type.includes('medico')) totalEnfermedad += daysCount;
                 else if (type.includes('licencia')) totalLicencias += daysCount;
                 else totalAusencias += daysCount;
             }
          });

          let hoursTotalOperativas = 0, totalNocturnas = 0, totalPlanificado = 0, totalRealizado = 0, hoursOnFranco = 0, hoursOnHoliday = 0, totalFrancos = 0;
          let objectivesMap = new Map();
          const monthHolidays: {[key: string]: boolean} = {}; holidays.forEach(h => { monthHolidays[h.date] = true; });

          sortedDocs.forEach((d:any) => { if (d.code === 'F' || d.isFranco || d.code === 'FF') totalFrancos++; });

          sortedDocs.forEach((d:any) => {
              if (d.status === 'Canceled') return;
              const rawCode = (d.code || '').trim().toUpperCase();
              if (d.type === 'NOVEDAD' || !OPERATIVE_CODES.includes(rawCode)) return; 

              const start = d.startTime.toDate();
              const end = d.endTime.toDate();
              let duration = (end.getTime() - start.getTime()) / 3600000;
              if (duration < 0 || duration > 24) duration = SHIFT_HOURS_LOOKUP[rawCode] || 8;
              
              totalPlanificado += duration;
              if (end <= new Date()) totalRealizado += duration;
              
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
                  if(client) objName = `Cliente: ${client.name}`;
                  else objName = `Cliente: ${d.clientId}`;
              }
              
              objectivesMap.set(objName, (objectivesMap.get(objName) || 0) + duration);

              const night = getNightDuration(start, end, rule.nightShiftStart, rule.nightShiftEnd);
              totalNocturnas += night;
              const dateKey = getArgentinaDate(d.startTime);
              const isFeriado = monthHolidays[dateKey];
              const isFT = d.isFrancoTrabajado || rawCode === 'FT'; 
              if (isFeriado) hoursOnHoliday += duration;
              if (isFT) hoursOnFranco += duration; else hoursTotalOperativas += duration;
          });

          const baseLimit = rule.maxHoursMonthly || 200;
          const excess = Math.max(0, hoursTotalOperativas - baseLimit);
          const simpleHours = Math.min(hoursTotalOperativas, baseLimit);
          
          setEmpStats({ 
              totalPlanificado: Math.round(totalPlanificado),
              totalRealizado: Math.round(totalRealizado),
              progress: totalPlanificado > 0 ? Math.round((totalRealizado / totalPlanificado) * 100) : 0,
              nightHours: Math.round(totalNocturnas),
              dayHours: Math.round(simpleHours),
              extra100: Math.round(hoursOnFranco), 
              extra50: Math.round(excess),          
              plusFeriado: Math.round(hoursOnHoliday),
              francosCount: totalFrancos,
              vacationsCount: totalVacaciones,
              licensesCount: totalLicencias + totalEnfermedad,
              absencesCount: totalAusencias,
              objectives: Array.from(objectivesMap.entries()).map(([name, hours]) => ({ name, hours })),
              shiftsCount: sortedDocs.filter((d:any) => OPERATIVE_CODES.includes((d.code||'').trim().toUpperCase())).length,
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
          sizes: form.sizes || { shirt: '', pants: '', shoes: '' }
      };

      try { 
          if (isEditing && form.id) { 
              await updateDoc(doc(db, 'empleados', form.id), dataToSave);
              await registrarAuditoria('UPDATE_EMPLOYEE', `Modificó legajo: ${form.fileNumber} - ${form.lastName}`); 
          } else { 
              if (employees.some(e => e.dni === form.dni)) return addToast('Ya existe un empleado con este DNI', 'error'); 
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
      if(!form.address) return addToast('Ingrese una dirección primero', 'warning');
      setIsGeocoding(true);
      try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(form.address + ', Argentina')}&limit=1`);
          const data = await res.json();
          if(data && data.length > 0) {
              setForm({...form, lat: data[0].lat, lng: data[0].lon});
              addToast('Ubicación encontrada y guardada', 'success');
          } else {
              addToast('No se encontraron coordenadas', 'error');
          }
      } catch(e) {
          console.error(e);
          addToast('Error conectando servicio de mapas', 'error');
      } finally {
          setIsGeocoding(false);
      }
  };
  
  const handleDelete = async (id: string) => { const emp = employees.find(e => e.id === id); if(confirm('?')) { await deleteDoc(doc(db, 'empleados', id)); await registrarAuditoria('DELETE_EMPLOYEE', `Eliminó legajo: ${emp?.fileNumber} - ${emp?.lastName}`); loadData(); setSelectedEmp(null); } };
  const handleDeleteAll = async () => { if(!confirm('BORRAR TODO?')) return; setIsDeletingAll(true); try { for (const emp of employees) { if (emp.id) await deleteDoc(doc(db, 'empleados', emp.id)); } await registrarAuditoria('DELETE_ALL', `Eliminación masiva`); addToast(`Eliminados.`, 'success'); loadData(); } catch (e) { console.error(e); } finally { setIsDeletingAll(false); } };
  const openNew = () => { setForm(initialForm); setIsEditing(false); setView('form'); setSelectedEmp(null); setActiveFormTab('PERSONAL'); };
  const openEditFromDetail = () => { if (!selectedEmp) return; setForm(selectedEmp); setIsEditing(true); setView('form'); setSelectedEmp(null); setActiveFormTab('PERSONAL'); };
  const handleSaveHoliday = async () => { if(!holidayForm.name) return; await holidayService.add(holidayForm); await registrarAuditoria('CREATE_HOLIDAY', `Feriado: ${holidayForm.name}`); setHolidayForm({ date: '', name: '', type: 'Nacional' }); loadHolidays(); };
  const handleDeleteHoliday = async (id: string) => { await holidayService.delete(id); await registrarAuditoria('DELETE_HOLIDAY', `Feriado ID: ${id}`); loadHolidays(); };
  const handleSyncHolidays = async () => { setIsSyncing(true); try { await holidayService.syncWithGovApi(syncYear); addToast(`Sync OK`, 'success'); loadHolidays(); } catch (e) { addToast('Error', 'error'); } finally { setIsSyncing(false); } };
  const handleAddCategory = () => { if (newCategory.trim()) { setAgreementForm({ ...agreementForm, categories: [...agreementForm.categories, newCategory.trim()] }); setNewCategory(''); }};
  const removeCategory = (idx: number) => { const newCats = [...agreementForm.categories]; newCats.splice(idx, 1); setAgreementForm({ ...agreementForm, categories: newCats }); };
  const handleSaveAgreement = async () => { if (!agreementForm.name) return; if (isEditingAgreement && agreementForm.id) { await agreementService.update(agreementForm.id, agreementForm); } else { await agreementService.add(agreementForm); } setAgreementForm(initialAgreement); setIsEditingAgreement(false); loadAgreements(); };
  const handleEditAgreement = (a: Agreement) => { setAgreementForm(a as ExtendedAgreement); setIsEditingAgreement(true); };
  const handleDeleteAgreement = async (id: string) => { if(confirm('?')) { await agreementService.delete(id); loadAgreements(); } };
  const handleOpenAbsenceModal = (absence?: Absence) => { if (absence) { setAbsenceForm(absence); setIsEditingAbsence(true); } else { setAbsenceForm(initialAbsenceForm); setIsEditingAbsence(false); } setShowAbsenceModal(true); };
  const handleSaveAbsence = async () => { if (!absenceForm.employeeId) return addToast('Seleccione un empleado', 'error'); const emp = employees.find(x => x.id === absenceForm.employeeId); const auth = getAuth(); const u = auth.currentUser; const nombreReal = u?.displayName || u?.email || "Usuario Desconocido"; const dataToSave = { ...absenceForm, employeeName: emp ? `${emp.lastName} ${emp.firstName}` : 'Desconocido', comments: `${absenceForm.comments || ''} (Cargado por: ${nombreReal})`, createdBy: nombreReal, createdAt: new Date().toISOString() }; let savedId = ''; if (isEditingAbsence && absenceForm.id) { await absenceService.update(absenceForm.id, dataToSave); savedId = absenceForm.id; await registrarAuditoria('UPDATE_ABSENCE', `Novedad: ${dataToSave.type}`); addToast('Actualizado', 'success'); } else { const docRef = await absenceService.add(dataToSave); savedId = docRef.id; await registrarAuditoria('CREATE_ABSENCE', `Novedad: ${dataToSave.type}`); addToast('Registrado', 'success'); } if (savedId) { await replicarAusenciaEnPlanificador(savedId, dataToSave); } setShowAbsenceModal(false); loadAbsences(); };
  const handleDeleteAbsence = async (id: string) => { if(confirm('¿Eliminar?')) { await absenceService.delete(id); await eliminarReplicasPlanificador(id); await registrarAuditoria('DELETE_ABSENCE', `Eliminó novedad`); loadAbsences(); } };
  const getAbsenceEmployeeName = (a: Absence) => { if (a.employeeName) return a.employeeName; const emp = employees.find(e => e.id === a.employeeId); return emp ? `${emp.lastName}, ${emp.firstName}` : 'Desconocido'; };
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; setFileName(file.name); const reader = new FileReader(); reader.onload = (evt) => { if (evt.target?.result) { setCsvContent(evt.target.result as string); } }; reader.readAsText(file, 'ISO-8859-1'); };
  
  // FUNCION DESCARGAR PLANTILLA
  const handleDownloadTemplate = () => { const headers = [ "Legajo", "Apellido, Nombre", "CUIL", "Email", "Telefono", "Direccion", "Categoria", "Convenio", "Estado", "Fecha Ingreso", "Periodo", "Inicio Ciclo", "Objetivo" ]; const example = [ "1020", "PEREZ, Juan", "20-12345678-9", "juan@email.com", "3511234567", "Av Colon 1234", "VIGILADOR", "422/05", "activo", "01/01/2024", "Mensual", "26", "Planta Industrial" ]; const csvString = headers.join(';') + '\n' + example.join(';'); const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.setAttribute("download", "Plantilla_Nomina_CronoApp.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link); };
  
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
                  objectiveName: keyObj ? row[keyObj] : '' 
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

  const confirmImport = async () => { setIsImporting(true); try { let count = 0; for (const emp of importPreview) { const existing = employees.find(e => e.dni === emp.dni || (emp.fileNumber && e.fileNumber === emp.fileNumber)); if (existing && existing.id) { await updateDoc(doc(db, 'empleados', existing.id), emp); } else { await addDoc(collection(db, 'empleados'), emp); } count++; } await registrarAuditoria('IMPORT_EMPLOYEES', `Importados ${count} registros vía CSV`); alert(`Se procesaron ${count} registros correctamente.`); setShowImportModal(false); setImportPreview([]); setCsvContent(''); setFileName(''); loadData(); } catch(e) { console.error(e); alert('Error importando'); } finally { setIsImporting(false); } };

  const handleExport = () => {
      const headers = ['Legajo', 'Apellido', 'Nombre', 'DNI', 'CUIL', 'Email', 'Teléfono', 'Convenio', 'Categoría', 'Objetivo Preferido', 'Estado'];
      const csvRows = [headers.join(';')];

      employees.forEach(emp => {
          const objName = allObjectives.find(o => o.id === emp.preferredObjectiveId)?.name || '';
          const row = [
              emp.fileNumber,
              `"${emp.lastName}"`,
              `"${emp.firstName}"`,
              emp.dni,
              emp.cuil,
              emp.email,
              emp.phone,
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
                  const night = getNightDuration(s, e, rule.nightShiftStart, rule.nightShiftEnd);
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

  return (
    <DashboardLayout>
        {/* --- CONTENIDO PRINCIPAL --- */}
        <div className="max-w-full mx-auto space-y-6 animate-in fade-in h-[calc(100vh-100px)] flex flex-col print:hidden">
            <header className="flex flex-col gap-4 shrink-0 p-1">
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase">Gestión RRHH</h1>
                        <p className="text-slate-500 text-sm font-medium">Personal, Novedades y Reglas.</p>
                    </div>
                    <div className="flex gap-2">
                        {activeTab === 'legajos' && view === 'list' && (
                            <>
                                <button onClick={() => window.print()} className="bg-slate-700 text-white px-4 py-3 rounded-xl font-black text-xs uppercase shadow-lg flex gap-2 hover:bg-slate-800 transition-colors">
                                    <Printer size={16}/> Imprimir PDF
                                </button>
                                <button onClick={handleExport} className="bg-emerald-600 text-white px-4 py-3 rounded-xl font-black text-xs uppercase shadow-lg flex gap-2 hover:bg-emerald-700 transition-colors">
                                    <FileDown size={16}/> Exportar
                                </button>
                                <button onClick={() => setShowImportModal(true)} className="bg-slate-800 text-white px-4 py-3 rounded-xl font-black text-xs uppercase shadow-lg flex gap-2 hover:bg-slate-700 transition-colors"><FileSpreadsheet size={16}/> Importar</button>
                                <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-3 rounded-xl font-black text-xs uppercase shadow-lg flex gap-2 hover:bg-indigo-700 transition-colors"><Plus size={16}/> Nuevo</button>
                            </>
                        )}
                        {activeTab === 'ausencias' && <button onClick={() => handleOpenAbsenceModal()} className="bg-rose-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase shadow-lg flex gap-2"><Plus size={16}/> Nueva Novedad</button>}
                    </div>
                </div>
                <div className="flex gap-2 border-b dark:border-slate-700">
                    {['legajos', 'ausencias', 'feriados', 'convenios'].map(tab => (
                        <button key={tab} onClick={() => { setActiveTab(tab as any); setView('list'); }} className={`px-6 py-3 font-black text-xs uppercase border-b-4 transition-all ${activeTab === tab ? (tab === 'legajos' ? 'border-indigo-600 text-indigo-600' : tab === 'ausencias' ? 'border-rose-500 text-rose-500' : tab === 'feriados' ? 'border-emerald-500 text-emerald-500' : 'border-amber-500 text-amber-500') : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{tab}</button>
                    ))}
                </div>
            </header>

            {/* SECCIONES DEL DASHBOARD */}
            {activeTab === 'legajos' && view === 'list' && (
                <div className="flex-1 flex gap-6 overflow-hidden relative">
                    <div className="w-[400px] bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 shadow-sm flex flex-col overflow-hidden shrink-0">
                        <div className="p-4 border-b dark:border-slate-700 flex flex-col gap-4 bg-slate-50/50 dark:bg-slate-800/50">
                            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2 rounded-xl border dark:border-slate-700">
                                <Search size={16} className="text-slate-400"/><input placeholder="Buscar..." className="bg-transparent outline-none w-full text-sm font-bold text-slate-900 dark:text-white" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                            </div>
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-2 py-1 rounded-xl border dark:border-slate-700"><button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-100 rounded-lg"><ChevronLeft size={14}/></button><span className="text-[10px] font-black uppercase w-20 text-center">{currentDate.toLocaleString('es-ES', { month: 'short', year: '2-digit' })}</span><button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-100 rounded-lg"><ChevronRight size={14}/></button></div>
                                {employees.length > 0 && <button onClick={handleDeleteAll} disabled={isDeletingAll} className="text-rose-500 hover:bg-rose-50 px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-colors">{isDeletingAll ? '...' : 'Borrar Todo'}</button>}
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto custom-scrollbar"><div className="divide-y divide-slate-100 dark:divide-slate-700">{filteredEmployees.map(emp => (<div key={emp.id} onClick={() => handleRowClick(emp)} className={`p-4 cursor-pointer transition-colors border-l-4 ${selectedEmp?.id === emp.id ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-indigo-500' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 border-l-transparent'}`}><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs shadow-sm ${selectedEmp?.id === emp.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{emp.lastName?.[0]}</div><div className="flex-1 min-w-0"><p className={`font-bold text-sm uppercase truncate ${selectedEmp?.id === emp.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-white'}`}>{emp.lastName}, {emp.firstName}</p><div className="flex items-center gap-2 mt-0.5"><span className="text-[10px] bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-500 font-mono">{emp.fileNumber || 'S/L'}</span><span className="text-[10px] text-slate-400 truncate">{emp.category}</span></div></div><ChevronRight size={16} className={`text-slate-300 ${selectedEmp?.id === emp.id ? 'text-indigo-400' : ''}`}/></div></div>))}{filteredEmployees.length === 0 && <div className="p-8 text-center text-slate-400 text-xs font-medium">No se encontraron empleados.</div>}</div></div>
                    </div>
                    <div className="flex-1 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 shadow-sm flex flex-col overflow-hidden relative">
                        {selectedEmp ? (
                            <div className="h-full flex flex-col animate-in fade-in">
                                <div className="p-6 border-b dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex justify-between items-start">
                                    <div className="flex gap-4"><div className="w-20 h-20 rounded-3xl bg-indigo-600 flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-indigo-500/30">{selectedEmp.lastName?.[0]}</div><div><h2 className="text-2xl font-black uppercase text-slate-900 dark:text-white">{selectedEmp.lastName}, {selectedEmp.firstName}</h2><div className="flex items-center gap-3 mt-1 text-sm font-bold text-slate-500"><span className="bg-white dark:bg-slate-800 px-2 py-1 rounded border dark:border-slate-700">{selectedEmp.laborAgreement}</span><span className="text-slate-300">|</span><span>{selectedEmp.cuil}</span></div></div></div>
                                    <div className="flex gap-2"><button onClick={() => handleDelete(selectedEmp.id!)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"><Trash2 size={20}/></button><button onClick={() => setSelectedEmp(null)} className="p-2 text-slate-400 hover:bg-slate-200 rounded-lg transition-colors"><X size={20}/></button></div>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                         <div className="p-4 border rounded-xl"><p className="text-[10px] text-slate-400 font-bold uppercase">Objetivo Preferido</p><p className="font-bold">{allObjectives.find(o=>o.id===selectedEmp.preferredObjectiveId)?.name || (selectedEmp.preferredObjectiveId ? `ID: ${selectedEmp.preferredObjectiveId}` : 'Sin asignar')}</p></div>
                                         <div className="p-4 border rounded-xl"><p className="text-[10px] text-slate-400 font-bold uppercase">Contacto</p><p className="font-bold">{selectedEmp.phone || '-'}</p></div>
                                         {/* --- BLOQUE DE DIRECCION Y MAPA --- */}
                                         <div className="col-span-2 p-4 border rounded-xl flex items-center justify-between">
                                             <div><p className="text-[10px] text-slate-400 font-bold uppercase">Dirección</p><p className="font-bold">{selectedEmp.address || 'Sin dirección'}</p></div>
                                             {selectedEmp.lat && selectedEmp.lng ? (
                                                 <a href={`https://www.google.com/maps/search/?api=1&query=${selectedEmp.lat},${selectedEmp.lng}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-indigo-600 font-bold text-xs bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-colors"><MapPin size={16}/> Ver Ubicación</a>
                                             ) : <span className="text-xs text-slate-300 italic">No geolocalizado</span>}
                                         </div>
                                    </div>
                                    {empStats ? (
                                        <div className="space-y-4 max-w-3xl mx-auto">
                                            <div className={`bg-slate-900 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden ${empStats.isOverLimit ? 'ring-4 ring-rose-500' : ''}`}>{empStats.isOverLimit && <div className="absolute top-0 left-0 w-full bg-rose-600 text-white text-[10px] font-black uppercase text-center py-1 animate-pulse">¡Límite Mensual Excedido!</div>}<div className="absolute top-0 right-0 p-4 opacity-10"><BarChart2 size={64}/></div><div className="grid grid-cols-2 gap-8 relative z-10"><div><p className="text-[10px] font-black uppercase text-indigo-200 mb-1">Total Planificado</p><div className="flex items-baseline gap-2"><span className="text-5xl font-black">{empStats.totalPlanificado}h</span><span className="text-sm font-medium text-slate-400">/ {empStats.monthlyLimit}h</span></div><div className="w-full h-2 bg-slate-800 rounded-full mt-4"><div className={`h-full rounded-full ${empStats.isOverLimit ? 'bg-rose-500' : 'bg-emerald-400'}`} style={{ width: `${Math.min(empStats.progress, 100)}%` }}/></div></div><div className="flex flex-col justify-center gap-2"><div className="flex justify-between items-center bg-white/5 p-3 rounded-xl"><span className="text-xs font-bold text-slate-300">Realizado</span><span className="font-black text-xl">{empStats.totalRealizado}h</span></div><div className="flex justify-between items-center bg-white/5 p-3 rounded-xl"><span className="text-xs font-bold text-slate-300">Objetivos</span><span className="font-black text-xl">{empStats.shiftsCount}</span></div></div></div></div>
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-100 flex items-center justify-between"><div><p className="text-emerald-700 font-bold text-sm">Francos</p><p className="text-2xl font-black text-emerald-800">{empStats.francosCount}</p></div><Coffee size={24} className="text-emerald-300"/></div><div className="bg-teal-50 p-5 rounded-2xl border border-teal-100 flex items-center justify-between"><div><p className="text-teal-700 font-bold text-sm">Vacaciones</p><p className="text-2xl font-black text-teal-800">{empStats.vacationsCount || 0}</p></div><Activity size={24} className="text-teal-300"/></div><div className="bg-purple-50 p-5 rounded-2xl border border-purple-100 flex items-center justify-between"><div><p className="text-purple-700 font-bold text-sm">Licencias</p><p className="text-2xl font-black text-purple-800">{empStats.licensesCount || 0}</p></div><FileText size={24} className="text-purple-300"/></div><div className="bg-rose-50 p-5 rounded-2xl border border-rose-100 flex items-center justify-between"><div><p className="text-rose-700 font-bold text-sm">Ausencias</p><p className="text-2xl font-black text-rose-800">{empStats.absencesCount}</p></div><AlertOctagon size={24} className="text-rose-300"/></div></div>
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3"><div className="bg-slate-50 p-4 rounded-xl border text-center"><p className="text-[10px] uppercase font-black text-slate-400">Diurnas</p><p className="text-xl font-black">{empStats.dayHours}h</p></div><div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-center"><p className="text-[10px] uppercase font-black text-indigo-400">Nocturnas</p><p className="text-xl font-black text-indigo-700">{empStats.nightHours}h</p></div><div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-center"><p className="text-[10px] uppercase font-black text-emerald-600">Extra 50%</p><p className="text-xl font-black text-emerald-700">{empStats.extra50}h</p></div><div className="bg-rose-50 p-4 rounded-xl border border-rose-100 text-center"><p className="text-[10px] uppercase font-black text-rose-600">Extra 100%</p><p className="text-xl font-black text-rose-700">{empStats.extra100}h</p></div><div className="bg-amber-50 p-4 rounded-xl border border-amber-100 text-center"><p className="text-[10px] uppercase font-black text-amber-600">Plus Feriado</p><p className="text-xl font-black text-amber-700">{empStats.plusFeriado || 0}h</p></div></div>
                                            <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border dark:border-slate-700 overflow-hidden"><div className="px-4 py-3 bg-slate-100 dark:bg-slate-950 border-b dark:border-slate-700 text-xs font-black uppercase text-slate-500">Desglose por Objetivo</div>{empStats.objectives.map((o:any,i:number)=>(<div key={i} className="flex justify-between items-center p-4 border-b dark:border-slate-700/50 last:border-0 hover:bg-white dark:hover:bg-slate-800 transition-colors"><div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-indigo-500"></div><span className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase">{o.name}</span></div><span className="text-sm font-black text-slate-900 dark:text-white bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded">{Math.round(o.hours)}h</span></div>))}{empStats.objectives.length === 0 && <div className="p-4 text-center text-slate-400 text-xs">Sin asignaciones este mes.</div>}</div>
                                        </div>
                                    ) : <div className="flex h-40 items-center justify-center text-slate-400 font-bold animate-pulse">Calculando métricas...</div>}
                                </div>
                                <div className="p-6 border-t dark:border-slate-700 bg-white dark:bg-slate-800"><button onClick={openEditFromDetail} className="w-full py-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl font-black uppercase text-sm hover:scale-[1.02] transition-transform shadow-xl flex items-center justify-center gap-2"><Edit2 size={18}/> Editar Datos del Legajo</button></div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col p-8 animate-in fade-in"><h2 className="text-2xl font-black text-slate-800 dark:text-white mb-6 uppercase flex items-center gap-3"><Activity className="text-indigo-500"/> Resumen Global RRHH</h2><div className="grid grid-cols-2 gap-6 mb-8"><div className="bg-indigo-600 text-white p-6 rounded-3xl shadow-xl shadow-indigo-500/20"><p className="text-xs font-black uppercase text-indigo-200 mb-2">Total Nómina</p><div className="flex items-center gap-4"><Users size={40} className="text-indigo-300"/><span className="text-5xl font-black">{globalStats.totalEmployees}</span></div></div><div className="bg-white dark:bg-slate-900 border p-6 rounded-3xl shadow-sm"><p className="text-xs font-black uppercase text-rose-500 mb-2">Novedades Activas</p><div className="flex items-center gap-4"><AlertTriangle size={40} className="text-rose-200"/><span className="text-5xl font-black text-rose-600">{globalStats.activeAbsences}</span></div></div></div><div className="grid grid-cols-3 gap-4"><div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border text-center"><Calendar className="mx-auto mb-2 text-slate-400"/><p className="text-2xl font-black text-slate-700 dark:text-white">{globalStats.nextHolidays}</p><p className="text-[10px] font-bold uppercase text-slate-400">Próximos Feriados</p></div><div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border text-center"><FileText className="mx-auto mb-2 text-slate-400"/><p className="text-2xl font-black text-slate-700 dark:text-white">{agreements.length}</p><p className="text-[10px] font-bold uppercase text-slate-400">Convenios Activos</p></div><div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border text-center"><Briefcase className="mx-auto mb-2 text-slate-400"/><p className="text-2xl font-black text-slate-700 dark:text-white">{clients.length}</p><p className="text-[10px] font-bold uppercase text-slate-400">Clientes Activos</p></div></div><div className="mt-auto pt-8 text-center text-slate-300 text-sm font-medium">Seleccione un empleado del listado lateral para ver su detalle individual.</div></div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'legajos' && view === 'form' && (
                <div className="flex-1 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 shadow-sm p-8 animate-in slide-in-from-right-10 overflow-y-auto">
                    <div className="flex justify-between items-center mb-8"><div className="flex items-center gap-4"><button onClick={() => setView('list')} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><ArrowLeft/></button><h2 className="text-2xl font-black uppercase dark:text-white">{isEditing ? `Editar: ${form.lastName}` : 'Nuevo Legajo'}</h2></div><div className="flex gap-2">{['PERSONAL', 'LABORAL', 'TALLES'].map(tab => (<button key={tab} onClick={() => setActiveFormTab(tab as any)} className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeFormTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>{tab}</button>))}</div></div>
                    <div className="max-w-4xl mx-auto space-y-8">
                        {activeFormTab === 'PERSONAL' && (<div className="grid grid-cols-2 gap-6"><div><label className={labelClass}>Nombre</label><input className={inputClass} value={form.firstName || ''} onChange={e => setForm({...form, firstName: e.target.value})} /></div><div><label className={labelClass}>Apellido</label><input className={inputClass} value={form.lastName || ''} onChange={e => setForm({...form, lastName: e.target.value})} /></div><div><label className={labelClass}>DNI</label><input className={inputClass} value={form.dni || ''} onChange={e => setForm({...form, dni: e.target.value})} /></div><div><label className={labelClass}>CUIL</label><input className={inputClass} value={form.cuil || ''} onChange={e => setForm({...form, cuil: e.target.value})} /></div><div><label className={labelClass}>Email</label><input className={inputClass} value={form.email || ''} onChange={e => setForm({...form, email: e.target.value})} /></div><div><label className={labelClass}>Teléfono</label><input className={inputClass} value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} /></div>
                        {/* --- CAMPO DIRECCION Y GEOLOCALIZACION --- */}
                        <div className="col-span-2"><label className={labelClass}>Dirección</label><div className="flex gap-2"><input className={inputClass} value={form.address || ''} onChange={e => setForm({...form, address: e.target.value})} placeholder="Calle, Número, Localidad"/><button onClick={handleGeocode} disabled={isGeocoding} className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold uppercase text-xs flex items-center gap-2 transition-colors">{isGeocoding ? '...' : <><MapPin size={16}/> Geolocalizar</>}</button></div><p className="text-[10px] text-slate-400 mt-1 ml-1">{form.lat ? `Ubicación guardada: ${form.lat}, ${form.lng}` : 'Sin coordenadas'}</p></div></div>)}
                        {activeFormTab === 'LABORAL' && (<div className="grid grid-cols-2 gap-6"><div><label className={labelClass}>Legajo Nº</label><input className={inputClass} value={form.fileNumber || ''} onChange={e => setForm({...form, fileNumber: e.target.value})} /></div><div><label className={labelClass}>Fecha Ingreso</label><input type="date" className={inputClass} value={form.startDate || ''} onChange={e => setForm({...form, startDate: e.target.value})} /></div><div><label className={labelClass}>Convenio</label><select className={selectClass} value={form.laborAgreement || ''} onChange={e => setForm({...form, laborAgreement: e.target.value})}><option value="">Seleccionar...</option>{agreements.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</select></div><div><label className={labelClass}>Categoría</label><select className={selectClass} value={form.category || ''} onChange={e => setForm({...form, category: e.target.value})}><option value="">Seleccionar...</option>{availableCategories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                        <div><label className={labelClass}>Objetivo Preferido</label><select className={selectClass} value={form.preferredObjectiveId || ''} onChange={e => setForm({...form, preferredObjectiveId: e.target.value})}><option value="">Ninguno</option>{allObjectives.map(obj => <option key={obj.id} value={obj.id}>{obj.name}</option>)}</select></div>
                        <div><label className={labelClass}>Inicio Ciclo Liquidación (Día)</label><input type="number" min="1" max="31" className={inputClass} value={form.cycleStartDay || 26} onChange={e => setForm({...form, cycleStartDay: parseInt(e.target.value)})} placeholder="Ej: 26"/></div><div><label className={labelClass}>Estado</label><select className={selectClass} value={form.status || 'activo'} onChange={e => setForm({...form, status: e.target.value})}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select></div></div>)}
                        {activeFormTab === 'TALLES' && (<div className="grid grid-cols-3 gap-6"><div><label className={labelClass}>Camisa/Remera</label><input className={inputClass} value={form.sizes?.shirt || ''} onChange={e => setForm({...form, sizes: {...form.sizes, shirt: e.target.value}})} /></div><div><label className={labelClass}>Pantalón</label><input className={inputClass} value={form.sizes?.pants || ''} onChange={e => setForm({...form, sizes: {...form.sizes, pants: e.target.value}})} /></div><div><label className={labelClass}>Calzado</label><input className={inputClass} value={form.sizes?.shoes || ''} onChange={e => setForm({...form, sizes: {...form.sizes, shoes: e.target.value}})} /></div></div>)}
                        <div className="pt-8 border-t dark:border-slate-700 flex justify-end gap-4"><button onClick={() => setView('list')} className="px-6 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold uppercase text-xs">Cancelar</button><button onClick={handleSave} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs shadow-lg hover:bg-indigo-700 transition-transform hover:scale-105">Guardar Cambios</button></div>
                    </div>
                </div>
            )}

            {/* OTROS TABS (AUSENCIAS, FERIADOS, CONVENIOS - SIN CAMBIOS) */}
            {activeTab === 'feriados' && (<div className="flex-1 flex gap-6 overflow-hidden"><div className="w-1/3 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 p-6"><h3 className="text-lg font-black text-slate-900 dark:text-white uppercase mb-4">Gestión Feriados</h3><div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800 mb-6"><label className="text-[10px] font-black uppercase text-indigo-600 mb-2 block">Importar Oficiales</label><div className="flex gap-2"><select className={selectClass} value={syncYear} onChange={e => setSyncYear(parseInt(e.target.value))}><option value={2024}>2024</option><option value={2025}>2025</option><option value={2026}>2026</option></select><button onClick={handleSyncHolidays} disabled={isSyncing} className="flex-1 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">{isSyncing ? '...' : <><Download size={14}/> Sincronizar</>}</button></div></div><div className="space-y-4 pt-4 border-t dark:border-slate-700"><p className="text-[10px] font-black uppercase text-slate-400">Carga Manual</p><input className={inputClass} value={holidayForm.name} onChange={e => setHolidayForm({...holidayForm, name: e.target.value})} placeholder="Nombre del Feriado"/><input type="date" className={inputClass} value={holidayForm.date} onChange={e => setHolidayForm({...holidayForm, date: e.target.value})}/><button onClick={handleSaveHoliday} className="w-full bg-slate-900 text-white py-3 rounded-xl font-black uppercase text-xs">Guardar Manual</button></div></div><div className="flex-1 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 p-6 overflow-auto custom-scrollbar"><div className="grid grid-cols-1 gap-3">{holidays.map(h => (<div key={h.id} className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border dark:border-slate-700"><div className="flex items-center gap-4"><Calendar size={20} className="text-indigo-500"/><div><p className="font-black dark:text-white uppercase">{h.name}</p><p className="text-xs font-mono text-slate-500">{new Date(h.date + 'T00:00:00').toLocaleDateString()}</p></div></div><button onClick={() => handleDeleteHoliday(h.id!)} className="text-slate-400 hover:text-rose-500"><X size={20}/></button></div>))}</div></div></div>)}
            {activeTab === 'convenios' && (<div className="flex-1 flex gap-6 overflow-hidden"><div className="w-1/3 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 p-6 overflow-y-auto"><h3 className="text-lg font-black text-slate-900 dark:text-white uppercase mb-4 flex items-center gap-2">{isEditingAgreement ? <Edit2 size={18}/> : <Book size={18}/>} {isEditingAgreement ? 'Editar' : 'Nuevo'} Convenio</h3><div className="space-y-4"><div><label className={labelClass}>Nombre</label><input className={inputClass} value={agreementForm.name} onChange={e => setAgreementForm({...agreementForm, name: e.target.value})}/></div><div className="grid grid-cols-2 gap-4"><div><label className={labelClass}>Semanal (hs)</label><input type="number" className={inputClass} value={agreementForm.maxHoursWeekly} onChange={e => setAgreementForm({...agreementForm, maxHoursWeekly: parseInt(e.target.value)})}/></div><div><label className={labelClass}>Mensual (hs)</label><input type="number" className={inputClass} value={agreementForm.maxHoursMonthly} onChange={e => setAgreementForm({...agreementForm, maxHoursMonthly: parseInt(e.target.value)})}/></div></div><div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border dark:border-slate-700"><label className={labelClass}>Sábados > 13hs</label><div className="flex gap-2"><button onClick={() => setAgreementForm({...agreementForm, saturdayRate: 0})} className={`flex-1 py-2 rounded-lg text-[10px] font-black ${agreementForm.saturdayRate === 0 ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>NORMAL</button><button onClick={() => setAgreementForm({...agreementForm, saturdayRate: 50})} className={`flex-1 py-2 rounded-lg text-[10px] font-black ${agreementForm.saturdayRate === 50 ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>50%</button><button onClick={() => setAgreementForm({...agreementForm, saturdayRate: 100})} className={`flex-1 py-2 rounded-lg text-[10px] font-black ${agreementForm.saturdayRate === 100 ? 'bg-rose-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-400'}`}>100%</button></div></div><div className="space-y-2"><div className="flex items-center gap-2"><input type="checkbox" checked={agreementForm.paysDoubleOnFranco} onChange={e => setAgreementForm({...agreementForm, paysDoubleOnFranco: e.target.checked})}/><span className="text-xs font-bold dark:text-white">Paga Franco Trabajado 100%</span></div><div className="flex items-center gap-2"><input type="checkbox" checked={agreementForm.holidayIsPlus} onChange={e => setAgreementForm({...agreementForm, holidayIsPlus: e.target.checked})}/><span className="text-xs font-bold dark:text-white text-emerald-600">Feriados se pagan como PLUS</span></div><div className="flex items-center gap-2"><input type="checkbox" checked={agreementForm.sundayIs100} onChange={e => setAgreementForm({...agreementForm, sundayIs100: e.target.checked})}/><span className="text-xs font-bold dark:text-white">Domingos al 100%</span></div></div><div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border dark:border-slate-700"><label className={labelClass}>Categorías</label><div className="flex gap-2 mb-2"><input className="flex-1 p-2 bg-white dark:bg-slate-800 rounded-lg text-xs text-slate-900 dark:text-white" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Ej: Vigilador"/><button onClick={handleAddCategory} className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Plus size={14}/></button></div><div className="flex flex-wrap gap-2">{agreementForm.categories.map((c, idx) => (<span key={idx} className="px-2 py-1 bg-white dark:bg-slate-800 rounded-lg text-[10px] font-bold border dark:border-slate-600 flex items-center gap-1">{c} <button onClick={() => removeCategory(idx)} className="text-rose-500"><X size={10}/></button></span>))}</div></div><div className="flex gap-2">{isEditingAgreement && <button onClick={() => { setIsEditingAgreement(false); setAgreementForm(initialAgreement); }} className="px-4 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-xs uppercase">Cancelar</button>}<button onClick={handleSaveAgreement} className="flex-1 bg-amber-500 text-white py-3 rounded-xl font-black uppercase text-xs">Guardar</button></div></div></div><div className="flex-1 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 p-6 overflow-auto custom-scrollbar"><div className="grid grid-cols-1 md:grid-cols-2 gap-3">{agreements.map(a => (<div key={a.id} className="p-5 bg-slate-50 dark:bg-slate-900 rounded-[2rem] border dark:border-slate-700 relative group"><div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => handleEditAgreement(a)} className="text-slate-300 hover:text-indigo-500"><Edit2 size={18}/></button><button onClick={() => handleDeleteAgreement(a.id!)} className="text-slate-300 hover:text-rose-500"><Trash2 size={18}/></button></div><h3 className="font-black text-slate-800 dark:text-white uppercase mb-2">{a.name}</h3><div className="space-y-1 text-xs text-slate-500"><p>Semanal: {a.maxHoursWeekly}hs | Mensual: {a.maxHoursMonthly}hs</p><p>Sábado > 13hs: <span className="font-bold text-indigo-500">{a.saturdayRate === 0 ? 'Normal' : a.saturdayRate + '%'}</span></p><p className="flex gap-2 mt-2">{a.holidayIsPlus && <span className="bg-emerald-100 text-emerald-700 px-2 rounded-full text-[9px] font-bold">Feriado PLUS</span>}{a.paysDoubleOnFranco && <span className="bg-indigo-100 text-indigo-700 px-2 rounded-full text-[9px] font-bold">Franco 100%</span>}</p></div></div>))}</div></div></div>)}
            {activeTab === 'ausencias' && (<div className="flex-1 bg-white dark:bg-slate-800 rounded-[2rem] border dark:border-slate-700 p-6 overflow-hidden flex flex-col"><div className="flex justify-between items-center mb-6"><div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 px-4 py-2 rounded-xl border dark:border-slate-700 max-w-md w-full"><Search size={16} className="text-slate-400"/><input placeholder="Buscar novedad..." className="bg-transparent outline-none w-full text-sm font-bold text-slate-900 dark:text-white" value={absenceSearchTerm} onChange={e => setAbsenceSearchTerm(e.target.value)}/></div></div><div className="flex-1 overflow-auto custom-scrollbar"><table className="w-full text-left"><thead className="bg-slate-50 dark:bg-slate-900 sticky top-0"><tr><th className="p-4 text-[10px] font-black uppercase text-slate-400">Empleado</th><th className="p-4 text-[10px] font-black uppercase text-slate-400">Tipo / Motivo</th><th className="p-4 text-[10px] font-black uppercase text-slate-400">Periodo</th><th className="p-4 text-[10px] font-black uppercase text-slate-400 text-center">Estado</th><th className="p-4 text-[10px] font-black uppercase text-slate-400 text-center">Certificado</th><th className="p-4 text-right"></th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-700">{filteredAbsences.map(a => (<tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30"><td className="p-4 font-bold text-sm text-slate-900 dark:text-white uppercase">{getAbsenceEmployeeName(a)}</td><td className="p-4"><div className="flex flex-col"><span className="text-xs font-bold uppercase">{a.type}</span><span className="text-[10px] text-slate-500">{a.reason || '-'}</span></div></td><td className="p-4 text-xs font-mono text-slate-500">{new Date(a.startDate).toLocaleDateString()} - {new Date(a.endDate).toLocaleDateString()}</td><td className="p-4 text-center"><span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${a.status === 'Justificada' ? 'bg-emerald-100 text-emerald-600' : a.status === 'Injustificada' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>{a.status}</span></td><td className="p-4 text-center">{a.hasCertificate ? <span className="text-emerald-500 flex justify-center"><FileCheck size={16}/></span> : <span className="text-slate-300">-</span>}</td><td className="p-4 text-right flex justify-end gap-2"><button onClick={() => handleOpenAbsenceModal(a)} className="text-slate-400 hover:text-indigo-500"><Edit2 size={16}/></button><button onClick={() => handleDeleteAbsence(a.id!)} className="text-slate-400 hover:text-rose-500"><Trash2 size={16}/></button></td></tr>))}</tbody></table></div></div>)}
        </div>

        {/* MODAL DE IMPORTACIÓN CSV (AMPLIADO) */}
        {showImportModal && (
            <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl w-full max-w-6xl shadow-2xl relative flex flex-col h-[90vh]">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2"><FileSpreadsheet className="text-emerald-500"/> Importación Masiva</h3>
                            <p className="text-sm text-slate-500">Carga empleados desde un archivo CSV o Excel exportado a CSV.</p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleDownloadTemplate} className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-black uppercase hover:bg-indigo-100 transition-colors flex items-center gap-2"><Download size={14}/> Descargar Plantilla</button>
                            <button onClick={() => {setShowImportModal(false); setImportPreview([]); setCsvContent('');}} className="p-2 hover:bg-slate-100 rounded-full"><X/></button>
                        </div>
                    </div>

                    {!csvContent ? (
                        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-10">
                            <UploadCloud size={64} className="text-indigo-400 mb-4"/>
                            <p className="font-bold text-slate-600 dark:text-slate-300 mb-2">Arrastra tu archivo aquí o haz clic para seleccionar</p>
                            <p className="text-xs text-slate-400 mb-6">Formato soportado: .csv (Excel: Guardar como > CSV delimitado por comas)</p>
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
                                <button onClick={confirmImport} disabled={isImporting || importPreview.length === 0} className="px-8 py-4 bg-emerald-600 text-white rounded-xl font-black text-sm shadow-xl hover:bg-emerald-700 transition-transform hover:scale-105 disabled:opacity-50 disabled:scale-100">
                                    {isImporting ? 'Importando...' : `Confirmar Importación (${importPreview.length})`}
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
                                    <tr><td className="p-2 border">Horas Normales (Diurnas)</td><td className="p-2 border text-right">{empStats.dayHours} hs</td></tr>
                                    <tr><td className="p-2 border">Horas Nocturnas</td><td className="p-2 border text-right">{empStats.nightHours} hs</td></tr>
                                    <tr><td className="p-2 border">Horas al 50% (Extras)</td><td className="p-2 border text-right">{empStats.extra50} hs</td></tr>
                                    <tr><td className="p-2 border">Horas al 100% (Franco Trab.)</td><td className="p-2 border text-right">{empStats.extra100} hs</td></tr>
                                    <tr><td className="p-2 border">Plus Feriado</td><td className="p-2 border text-right">{empStats.plusFeriado || 0} hs</td></tr>
                                    <tr className="bg-gray-50 font-bold"><td className="p-2 border">TOTAL REALIZADO</td><td className="p-2 border text-right">{empStats.totalRealizado} hs</td></tr>
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
                            {/* Observaciones extraidas de los turnos */}
                            {empStats?.reportData?.turnos?.filter((t:any) => t.extensionNote || t.entryNote).map((t:any, i:number) => (
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
    </DashboardLayout>
  );
}
