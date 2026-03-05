import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { Toaster, toast } from 'sonner';
import {
  BarChart3,
  Building2,
  Calculator,
  ChevronDown,
  ChevronUp,
  Edit2,
  ExternalLink,
  FileText,
  Globe,
  Grid3x3,
  LayoutList,
  Loader2,
  Plus,
  Printer,
  Receipt,
  Search,
  Send,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const formatMoney = (val: any) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(val) || 0);

// --- MOTOR DE CÁLCULO (CCT 422/05) ---
const analyzeShiftComposition = (start: string, end: string) => {
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  let startMin = h1 * 60 + m1;
  let endMin = h2 * 60 + m2;
  if (endMin < startMin) endMin += 1440;
  return (endMin - startMin) / 60;
};

const calculateMonthlySLA = (positions: any[], startStr: string, endStr: string) => {
  if (!positions || positions.length === 0 || !startStr || !endStr) return 0;
  const sParts = startStr.split('-').map(Number);
  const eParts = endStr.split('-').map(Number);
  let current = new Date(sParts[0], sParts[1] - 1, sParts[2]);
  const end = new Date(eParts[0], eParts[1] - 1, eParts[2]);
  let totalAccumulator = 0;
  while (current <= end) {
    positions.forEach((pos: any) => {
      let dayTotal = 0;
      if (pos.coverageType === '24hs') dayTotal = 24;
      else if (pos.coverageType === '12hs_diurno' || pos.coverageType === '12hs_nocturno') dayTotal = 12;
      else if (pos.coverageType === 'custom' && pos.allowedShiftTypes) {
        pos.allowedShiftTypes.forEach((shift: any) => {
          dayTotal += analyzeShiftComposition(shift.startTime, shift.endTime);
        });
      }
      totalAccumulator += dayTotal * (pos.quantity || 1);
    });
    current.setDate(current.getDate() + 1);
  }
  return Math.round(totalAccumulator);
};

const SHIFT_CODE_HOURS: Record<string, number> = { M: 8, T: 8, N: 8, D12: 12, N12: 12, PU: 12, C: 8 };
const isWorkingCode = (code: string) => !['F', 'FF', 'V', 'L', 'A', 'E', 'AA'].includes((code || '').toUpperCase());

const getDateKeyInTimezone = (date: Date) => {
  const parts = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;
  return `${year}-${month}-${day}`;
};

const toDateSafe = (val: any) => {
  if (!val) return null;
  if (typeof val?.toDate === 'function') return val.toDate();
  if (typeof val?.seconds === 'number') return new Date(val.seconds * 1000);
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
};

const clampDateRange = (start: Date | null, end: Date | null, min: Date | null, max: Date | null) => {
  const s = start && min ? (start > min ? start : min) : (start || min);
  const e = end && max ? (end < max ? end : max) : (end || max);
  if (s && e && s > e) return null;
  return { start: s, end: e };
};

const calculateSLAForRange = (positions: any[], startStr: string, endStr: string, rangeStart: Date | null, rangeEnd: Date | null) => {
  if (!positions || positions.length === 0 || !startStr || !endStr) return 0;
  const sParts = startStr.split('-').map(Number);
  const eParts = endStr.split('-').map(Number);
  const start = new Date(sParts[0], sParts[1] - 1, sParts[2]);
  const end = new Date(eParts[0], eParts[1] - 1, eParts[2]);
  const clamped = clampDateRange(start, end, rangeStart, rangeEnd);
  if (!clamped?.start || !clamped?.end) return 0;

  let current = new Date(clamped.start);
  const last = new Date(clamped.end);
  let total = 0;
  while (current <= last) {
    positions.forEach((pos: any) => {
      let dayTotal = 0;
      if (pos.coverageType === '24hs') dayTotal = 24;
      else if (pos.coverageType === '12hs_diurno' || pos.coverageType === '12hs_nocturno') dayTotal = 12;
      else if (pos.coverageType === 'custom' && pos.allowedShiftTypes) {
        pos.allowedShiftTypes.forEach((shift: any) => {
          dayTotal += analyzeShiftComposition(shift.startTime, shift.endTime);
        });
      }
      total += dayTotal * (pos.quantity || 1);
    });
    current.setDate(current.getDate() + 1);
  }
  return Math.round(total);
};

const getDurationHours = (start: Date, end: Date) => {
  const diff = (end.getTime() - start.getTime()) / 3600000;
  if (diff >= 0) return diff;
  return diff + 24;
};

type RangeMode = 'month' | 'year' | 'all';
type ViewMode = 'grid' | 'list';
type ProformaDetailMode = 'auto' | 'planned' | 'executed';
type ProformaBase = 'requested' | 'planned' | 'executed';

export default function CRMPage() {
  const router = useRouter();

  const [view, setView] = useState<'list' | 'detail'>('list');
  const [activeTab, setActiveTab] = useState('INFO');
  const [currentUserName, setCurrentUserName] = useState('Cargando...');

  const [showGlobalDashboard, setShowGlobalDashboard] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [rangeMonth, setRangeMonth] = useState(new Date().getMonth());
  const [rangeYear, setRangeYear] = useState(new Date().getFullYear());

  const [clients, setClients] = useState<any[]>([]);
  const [filteredClients, setFilteredClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);

  const [clientServices, setClientServices] = useState<any[]>([]);
  const [clientContracts, setClientContracts] = useState<any[]>([]);
  const [clientQuotes, setClientQuotes] = useState<any[]>([]);

  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [calculatingMetrics, setCalculatingMetrics] = useState(false);

  const [globalMetrics, setGlobalMetrics] = useState({ totalSold: 0, totalPlanned: 0, totalExecuted: 0, criticalClients: [] as any[] });
  const [clientMetricsMap, setClientMetricsMap] = useState<Record<string, any>>({});

  // --- INFO ---
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState<any>({});

  // --- SLA SERVICES ---
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [tempService, setTempService] = useState<any>({});

  // --- OBJECTIVES (SEDES) ---
  const [objectiveForm, setObjectiveForm] = useState({ name: '', address: '', lat: '', lng: '', contact: '', notes: '' });
  const [editingObjectiveIndex, setEditingObjectiveIndex] = useState<number | null>(null);

  // --- CONTRACTS ---
  const [contractFormOpen, setContractFormOpen] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState({ name: '', startDate: '', endDate: '', totalHours: '', driveUrl: '', type: 'cerrado' });

  // --- HISTORIAL ---
  const [historyNote, setHistoryNote] = useState('');

  // --- PROFORMA ---
  const [proformaOpen, setProformaOpen] = useState(false);
  const [proformaMonth, setProformaMonth] = useState(new Date().getMonth());
  const [proformaYear, setProformaYear] = useState(new Date().getFullYear());
  const [proformaStartDate, setProformaStartDate] = useState('');
  const [proformaEndDate, setProformaEndDate] = useState('');
  const [proformaDetailMode, setProformaDetailMode] = useState<ProformaDetailMode>('auto');
  const [proformaBase, setProformaBase] = useState<ProformaBase>('requested');
  const [proformaHourlyValue, setProformaHourlyValue] = useState('');
  const [proformaTotals, setProformaTotals] = useState({ planned: 0, executed: 0, loading: false });
  const [proformaBreakdown, setProformaBreakdown] = useState<any[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    onAuthStateChanged(getAuth(), (u) => setCurrentUserName(u?.displayName || u?.email || 'Operador'));
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchClients = async () => {
    setLoadingClients(true);
    try {
      const snap = await getDocs(query(collection(db, 'clients'), orderBy('name')));
      const data = snap.docs.map((x) => ({ id: x.id, ...x.data() }));
      setClients(data);
      setFilteredClients(data);
    } catch (e) {
      console.error(e);
      toast.error('Error al cargar clientes');
    } finally {
      setLoadingClients(false);
    }
  };

  const loadClientFullData = async (id: string) => {
    setLoadingClientData(true);
    try {
      const [srv, cont, quo] = await Promise.all([
        getDocs(query(collection(db, 'servicios_sla'), where('clientId', '==', id))),
        getDocs(query(collection(db, 'contracts'), where('clientId', '==', id))),
        getDocs(query(collection(db, 'quotes'), where('clientId', '==', id))),
      ]);
      setClientServices(srv.docs.map((x) => ({ id: x.id, ...x.data() })));
      setClientContracts(cont.docs.map((x) => ({ id: x.id, ...x.data() })));
      setClientQuotes(quo.docs.map((x) => ({ id: x.id, ...x.data() })));
    } catch (e) {
      console.error(e);
      toast.error('Error al cargar datos del cliente');
    } finally {
      setLoadingClientData(false);
    }
  };

  const getRangeLabel = () => {
    if (rangeMode === 'all') return 'Todo el histórico';
    if (rangeMode === 'year') return `Año ${rangeYear}`;
    return `${MONTHS_ES[rangeMonth]} ${rangeYear}`;
  };

  const getRangeDates = () => {
    if (rangeMode === 'all') return { start: null as Date | null, end: null as Date | null };
    if (rangeMode === 'year') return { start: new Date(rangeYear, 0, 1), end: new Date(rangeYear, 11, 31, 23, 59, 59, 999) };
    return { start: new Date(rangeYear, rangeMonth, 1), end: new Date(rangeYear, rangeMonth + 1, 0, 23, 59, 59, 999) };
  };

  const calculateDashboardMetrics = async () => {
    setCalculatingMetrics(true);
    try {
      const [{ start, end }, sSla, sTurnos, sContracts, sEmployees] = await Promise.all([
        Promise.resolve(getRangeDates()),
        getDocs(collection(db, 'servicios_sla')),
        getDocs(collection(db, 'turnos')),
        getDocs(collection(db, 'contracts')),
        getDocs(collection(db, 'empleados')),
      ]);

      const validEmp: Record<string, boolean> = {};
      sEmployees.forEach((d) => {
        const e = d.data() as any;
        const fileNumber = String(e.fileNumber || '').trim();
        const dni = String(e.dni || '').trim();
        const cuil = String(e.cuil || '').trim();
        if (fileNumber && (dni || cuil)) validEmp[d.id] = true;
      });

      const slaByClient: Record<string, number> = {};
      const plannedByClient: Record<string, number> = {};
      const executedByClient: Record<string, number> = {};
      const contractedByClient: Record<string, number> = {};
      const closedByClient: Record<string, number> = {};

      sSla.forEach((d) => {
        const s = d.data() as any;
        if (!s.clientId) return;
        const cid = String(s.clientId).trim();
        const hrs = rangeMode === 'all' ? calculateMonthlySLA(s.positions, s.startDate, s.endDate) : calculateSLAForRange(s.positions, s.startDate, s.endDate, start, end);
        slaByClient[cid] = (slaByClient[cid] || 0) + (Number(hrs) || 0);
      });

      sContracts.forEach((d) => {
        const c = d.data() as any;
        if (!c.clientId) return;
        const cid = String(c.clientId).trim();
        const totalHours = Number(c.totalHours) || 0;
        if (rangeMode === 'all') {
          contractedByClient[cid] = (contractedByClient[cid] || 0) + totalHours;
          if (c.type === 'cerrado') closedByClient[cid] = (closedByClient[cid] || 0) + totalHours;
          return;
        }
        const cStart = c.startDate ? new Date(c.startDate) : null;
        const cEnd = c.endDate ? new Date(c.endDate) : null;
        const clamped = clampDateRange(cStart, cEnd, start, end);
        if (!clamped && (cStart || cEnd)) return;
        contractedByClient[cid] = (contractedByClient[cid] || 0) + totalHours;
        if (c.type === 'cerrado') closedByClient[cid] = (closedByClient[cid] || 0) + totalHours;
      });

      sTurnos.forEach((d) => {
        const t = d.data() as any;
        if (!t.clientId || !t.startTime || !t.endTime || typeof t.startTime.toDate !== 'function') return;
        if (!validEmp[t.employeeId]) return;
        if (String(t.type || '').toUpperCase() === 'NOVEDAD') return;

        const status = String(t.status || '').toLowerCase();
        if (status.includes('cancel') || status.includes('delet')) return;

        const code = String((t.code || t.type || '')).trim().toUpperCase();
        if (!isWorkingCode(code)) return;

        const cid = String(t.clientId).trim();

        const plannedStart = toDateSafe(t.startTime);
        const plannedEnd = toDateSafe(t.endTime);
        const realStart = toDateSafe(t.realStartTime);
        const realEnd = toDateSafe(t.realEndTime);

        if (plannedStart && plannedEnd && (!start || (plannedStart >= start && plannedStart <= (end as Date)))) {
          let hrs = Number(t.hours) || getDurationHours(plannedStart, plannedEnd);
          if (SHIFT_CODE_HOURS[code]) hrs = SHIFT_CODE_HOURS[code];
          if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = SHIFT_CODE_HOURS[code] || 8;
          plannedByClient[cid] = (plannedByClient[cid] || 0) + hrs;
        }

        if (realStart && realEnd && (!start || (realStart >= start && realStart <= (end as Date)))) {
          let hrs = getDurationHours(realStart, realEnd);
          if (SHIFT_CODE_HOURS[code]) hrs = SHIFT_CODE_HOURS[code];
          if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = SHIFT_CODE_HOURS[code] || 8;
          executedByClient[cid] = (executedByClient[cid] || 0) + hrs;
        }
      });

      const metrics: Record<string, any> = {};
      let totalSold = 0;
      let totalPlanned = 0;
      let totalExecuted = 0;

      clients.forEach((c) => {
        const sla = Math.round(slaByClient[c.id] || 0);
        const planned = Math.round(plannedByClient[c.id] || 0);
        const real = Math.round(executedByClient[c.id] || 0);
        const contracted = Math.round(contractedByClient[c.id] || 0);
        const contractClosed = Math.round(closedByClient[c.id] || 0);
        const burnRate = sla > 0 ? (real / sla) * 100 : 0;

        totalSold += sla;
        totalPlanned += planned;
        totalExecuted += real;

        metrics[c.id] = {
          sla,
          planned,
          real,
          contracted,
          contractClosed,
          contractMismatch: contractClosed > 0 && contractClosed !== sla,
          burnRate,
          hasActivity: sla > 0 || planned > 0 || real > 0,
        };
      });

      setClientMetricsMap(metrics);
      setGlobalMetrics({ totalSold, totalPlanned, totalExecuted, criticalClients: [] });
    } catch (e) {
      console.error(e);
      toast.error('Error al calcular métricas');
    } finally {
      setCalculatingMetrics(false);
    }
  };

  const handleSaveInfo = async () => {
    if (!selectedClient?.id) return;
    if (!infoForm?.name) return;
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), infoForm);
      setSelectedClient({ ...selectedClient, ...infoForm });
      setIsEditingInfo(false);
      toast.success('Actualizado');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar');
    }
  };

  const handleSaveService = async () => {
    if (!editingServiceId || !selectedClient?.id) return;
    try {
      await updateDoc(doc(db, 'servicios_sla', editingServiceId), tempService);
      setEditingServiceId(null);
      await loadClientFullData(selectedClient.id);
      toast.success('SLA Actualizado');
    } catch (e) {
      console.error(e);
      toast.error('Error al actualizar SLA');
    }
  };

  const handleAddHistory = async () => {
    if (!selectedClient?.id) return;
    const noteText = (historyNote || '').trim();
    if (!noteText) return;
    const note = { date: new Date().toISOString(), note: noteText, user: currentUserName };
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), { historial: arrayUnion(note) });
      setSelectedClient({ ...selectedClient, historial: [...(selectedClient.historial || []), note] });
      setHistoryNote('');
      toast.success('Nota guardada');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar nota');
    }
  };

  useEffect(() => {
    if (clients.length > 0) calculateDashboardMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, rangeMode, rangeMonth, rangeYear]);

  useEffect(() => {
    setFilteredClients(clients.filter((c) => (c.name || '').toLowerCase().includes(searchTerm.toLowerCase())));
  }, [searchTerm, clients]);

  const resetObjectiveForm = () => {
    setObjectiveForm({ name: '', address: '', lat: '', lng: '', contact: '', notes: '' });
    setEditingObjectiveIndex(null);
  };

  const startEditObjective = (obj: any, idx: number) => {
    setObjectiveForm({
      name: obj?.name || '',
      address: obj?.address || '',
      lat: obj?.lat ?? '',
      lng: obj?.lng ?? '',
      contact: obj?.contact || '',
      notes: obj?.notes || '',
    });
    setEditingObjectiveIndex(idx);
  };

  const handleSaveObjective = async () => {
    if (!selectedClient?.id) return;
    if (!objectiveForm.name.trim()) return toast.error('El objetivo necesita nombre');

    const objetivos = [...(selectedClient.objetivos || [])];
    const payload = {
      name: objectiveForm.name.trim(),
      address: (objectiveForm.address || '').trim(),
      lat: objectiveForm.lat === '' ? null : Number(objectiveForm.lat),
      lng: objectiveForm.lng === '' ? null : Number(objectiveForm.lng),
      contact: (objectiveForm.contact || '').trim(),
      notes: (objectiveForm.notes || '').trim(),
    };
    if (payload.lat !== null && Number.isNaN(payload.lat)) return toast.error('Latitud inválida');
    if (payload.lng !== null && Number.isNaN(payload.lng)) return toast.error('Longitud inválida');

    if (editingObjectiveIndex !== null) objetivos[editingObjectiveIndex] = payload;
    else objetivos.push(payload);

    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), { objetivos });
      setSelectedClient({ ...selectedClient, objetivos });
      resetObjectiveForm();
      toast.success('Objetivo guardado');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar objetivo');
    }
  };

  const handleDeleteObjective = async (idx: number) => {
    if (!selectedClient?.id) return;
    if (!window.confirm('¿Eliminar este objetivo?')) return;
    const objetivos = (selectedClient.objetivos || []).filter((_: any, i: number) => i !== idx);
    try {
      await updateDoc(doc(db, 'clients', selectedClient.id), { objetivos });
      setSelectedClient({ ...selectedClient, objetivos });
      if (editingObjectiveIndex === idx) resetObjectiveForm();
      toast.success('Objetivo eliminado');
    } catch (e) {
      console.error(e);
      toast.error('Error al eliminar objetivo');
    }
  };

  const resetContractForm = () => {
    setContractForm({ name: '', startDate: '', endDate: '', totalHours: '', driveUrl: '', type: 'cerrado' });
    setEditingContractId(null);
    setContractFormOpen(false);
  };

  const startEditContract = (c: any) => {
    setContractForm({
      name: c?.name || '',
      startDate: c?.startDate || '',
      endDate: c?.endDate || '',
      totalHours: String(c?.totalHours ?? ''),
      driveUrl: c?.driveUrl || c?.driveFolderUrl || '',
      type: c?.type || 'cerrado',
    });
    setEditingContractId(c?.id || null);
    setContractFormOpen(true);
  };

  const handleSaveContract = async () => {
    if (!selectedClient?.id) return;
    if (!contractForm.name.trim()) return toast.error('El contrato necesita nombre');

    const payload = {
      name: contractForm.name.trim(),
      startDate: (contractForm.startDate || '').trim(),
      endDate: (contractForm.endDate || '').trim(),
      totalHours: Number(contractForm.totalHours) || 0,
      driveUrl: (contractForm.driveUrl || '').trim(),
      type: contractForm.type || 'cerrado',
      clientId: selectedClient.id,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingContractId) await updateDoc(doc(db, 'contracts', editingContractId), payload);
      else await addDoc(collection(db, 'contracts'), { ...payload, createdAt: serverTimestamp() });
      await loadClientFullData(selectedClient.id);
      resetContractForm();
      toast.success('Contrato guardado');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar contrato');
    }
  };

  const handleDeleteContract = async (id: string) => {
    if (!selectedClient?.id) return;
    if (!window.confirm('¿Eliminar este contrato?')) return;
    try {
      await deleteDoc(doc(db, 'contracts', id));
      await loadClientFullData(selectedClient.id);
      if (editingContractId === id) resetContractForm();
      toast.success('Contrato eliminado');
    } catch (e) {
      console.error(e);
      toast.error('Error al eliminar contrato');
    }
  };

  const getProformaRange = () => {
    const monthStart = new Date(proformaYear, proformaMonth, 1);
    const monthEnd = new Date(proformaYear, proformaMonth + 1, 0, 23, 59, 59, 999);
    const start = proformaStartDate ? new Date(`${proformaStartDate}T00:00:00`) : monthStart;
    const end = proformaEndDate ? new Date(`${proformaEndDate}T23:59:59`) : monthEnd;
    return { start, end };
  };

  const toggleExpandedKey = (k: string) => setExpandedKeys((prev) => ({ ...prev, [k]: !prev[k] }));

  const calculateProformaTurnos = async () => {
    if (!selectedClient?.id) return;
    setProformaTotals((p) => ({ ...p, loading: true }));
    try {
      const { start, end } = getProformaRange();

      const sTurnos = await getDocs(query(collection(db, 'turnos'), where('clientId', '==', selectedClient.id)));
      const planned = { total: 0, byObjective: {} as any };
      const executed = { total: 0, byObjective: {} as any };

      const normalize = (s: string) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
      const add = (target: any, objName: string, posName: string, dateKey: string, hours: number) => {
        const oKey = normalize(objName);
        target.byObjective[oKey] ||= { objectiveName: objName, totalHours: 0, positions: {} as any };
        const pKey = normalize(posName);
        target.byObjective[oKey].positions[pKey] ||= { positionName: posName, totalHours: 0, byDay: {} as any };
        target.byObjective[oKey].totalHours += hours;
        target.byObjective[oKey].positions[pKey].totalHours += hours;
        target.byObjective[oKey].positions[pKey].byDay[dateKey] = (target.byObjective[oKey].positions[pKey].byDay[dateKey] || 0) + hours;
      };

      sTurnos.forEach((d) => {
        const t = d.data() as any;
        const code = String((t.code || t.type || '')).trim().toUpperCase();
        if (!isWorkingCode(code)) return;

        const plannedStart = toDateSafe(t.startTime);
        const plannedEnd = toDateSafe(t.endTime);
        const realStart = toDateSafe(t.realStartTime);
        const realEnd = toDateSafe(t.realEndTime);

        const objectiveName = (t.objectiveName || 'Objetivo sin nombre').toString().trim();
        const positionName = (t.positionName || 'Sin puesto').toString().trim();

        if (plannedStart && plannedEnd && plannedStart >= start && plannedStart <= end) {
          let hrs = Number(t.hours) || getDurationHours(plannedStart, plannedEnd);
          if (SHIFT_CODE_HOURS[code]) hrs = SHIFT_CODE_HOURS[code];
          if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = SHIFT_CODE_HOURS[code] || 8;
          planned.total += hrs;
          add(planned, objectiveName, positionName, getDateKeyInTimezone(plannedStart), hrs);
        }

        if (realStart && realEnd && realStart >= start && realStart <= end) {
          let hrs = getDurationHours(realStart, realEnd);
          if (SHIFT_CODE_HOURS[code]) hrs = SHIFT_CODE_HOURS[code];
          if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = SHIFT_CODE_HOURS[code] || 8;
          executed.total += hrs;
          add(executed, objectiveName, positionName, getDateKeyInTimezone(realStart), hrs);
        }
      });

      const breakdownSource = proformaDetailMode === 'executed' ? executed : proformaDetailMode === 'planned' ? planned : (clientContracts || []).some((c) => c.type === 'abierto') ? executed : planned;
      const breakdown = Object.values(breakdownSource.byObjective)
        .map((o: any) => ({
          ...o,
          totalHours: Math.round(o.totalHours),
          positions: Object.values(o.positions)
            .map((p: any) => ({
              ...p,
              totalHours: Math.round(p.totalHours),
              byDay: Object.entries(p.byDay)
                .map(([date, hours]) => ({ date, hours: Math.round(hours as number) }))
                .sort((a, b) => a.date.localeCompare(b.date)),
            }))
            .sort((a: any, b: any) => b.totalHours - a.totalHours),
        }))
        .sort((a: any, b: any) => b.totalHours - a.totalHours);

      setProformaBreakdown(breakdown);
      setProformaTotals({ planned: Math.round(planned.total), executed: Math.round(executed.total), loading: false });
    } catch (e) {
      console.error(e);
      setProformaTotals((p) => ({ ...p, loading: false }));
      toast.error('Error al calcular turnos');
    }
  };

  useEffect(() => {
    if (!proformaOpen) return;
    const start = new Date(proformaYear, proformaMonth, 1);
    const end = new Date(proformaYear, proformaMonth + 1, 0);
    setProformaStartDate(start.toISOString().split('T')[0]);
    setProformaEndDate(end.toISOString().split('T')[0]);
    setProformaDetailMode('auto');
  }, [proformaOpen, proformaMonth, proformaYear]);

  useEffect(() => {
    if (!proformaOpen || !selectedClient?.id) return;
    calculateProformaTurnos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proformaOpen, selectedClient?.id, proformaMonth, proformaYear, proformaStartDate, proformaEndDate, proformaDetailMode]);

  const baseHours = useMemo(() => {
    if (!selectedClient) return 0;
    const { start, end } = getProformaRange();
    const requested = Math.round((clientServices || []).reduce((acc, s) => acc + calculateSLAForRange(s.positions, s.startDate, s.endDate, start, end), 0));
    if (proformaBase === 'requested') return requested;
    if (proformaBase === 'planned') return proformaTotals.planned;
    return proformaTotals.executed;
  }, [selectedClient, clientServices, proformaBase, proformaTotals, proformaStartDate, proformaEndDate, proformaMonth, proformaYear]);

  const totalEstimate = useMemo(() => {
    const hourly = Number(proformaHourlyValue) || 0;
    return baseHours * hourly;
  }, [baseHours, proformaHourlyValue]);

  return (
    <DashboardLayout>
      <Head><title>CRM Clientes | CronoApp</title></Head>
      <Toaster position="top-center" richColors />

      <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black text-slate-900 uppercase">Centro de Comando</h1>
          </div>
          {view === 'detail' && (
            <button onClick={() => setView('list')} className="bg-white border px-6 py-3 rounded-2xl text-[10px] font-black uppercase text-slate-500">
              Volver al Listado
            </button>
          )}
        </div>

        {view === 'list' && (
          <div className="space-y-6">
            <div className="bg-white border-2 border-slate-50 rounded-[2.5rem] shadow-xl overflow-hidden">
              <div className="p-6 bg-slate-50/50 border-b flex flex-wrap items-center justify-between gap-4 cursor-pointer" onClick={() => setShowGlobalDashboard(!showGlobalDashboard)}>
                <div className="flex items-center gap-3">
                  <h3 className="font-black text-xs text-slate-400 uppercase flex items-center gap-3">
                    <BarChart3 size={18} /> Dashboard de Rentabilidad
                    {calculatingMetrics ? <Loader2 className="animate-spin" size={14} /> : null}
                  </h3>
                  <span className="text-[10px] font-black uppercase text-slate-400">{getRangeLabel()}</span>
                </div>

                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <select className="text-[10px] font-black uppercase border rounded-xl px-3 py-2" value={rangeMode} onChange={(e) => setRangeMode(e.target.value as RangeMode)}>
                    <option value="month">Mes</option>
                    <option value="year">Año</option>
                    <option value="all">Todo</option>
                  </select>

                  {rangeMode !== 'all' ? (
                    <select
                      className="text-[10px] font-black uppercase border rounded-xl px-3 py-2"
                      value={rangeYear}
                      onChange={(e) => setRangeYear(Number(e.target.value))}
                    >
                      {[rangeYear - 2, rangeYear - 1, rangeYear, rangeYear + 1].map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  ) : null}

                  {rangeMode === 'month' ? (
                    <select
                      className="text-[10px] font-black uppercase border rounded-xl px-3 py-2"
                      value={rangeMonth}
                      onChange={(e) => setRangeMonth(Number(e.target.value))}
                    >
                      {MONTHS_ES.map((m, idx) => (
                        <option key={m} value={idx}>{m}</option>
                      ))}
                    </select>
                  ) : null}
                </div>

                {showGlobalDashboard ? <ChevronUp /> : <ChevronDown />}
              </div>

              {showGlobalDashboard && (
                <div className="p-8 grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="p-6 bg-indigo-50 rounded-3xl border border-indigo-100">
                    <p className="text-[10px] font-black text-indigo-400 uppercase">Solicitado (SLA)</p>
                    <p className="text-4xl font-black text-indigo-900">{globalMetrics.totalSold} hs</p>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Planificado</p>
                    <p className="text-4xl font-black text-slate-800">{globalMetrics.totalPlanned} hs</p>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Ejecutado</p>
                    <p className="text-4xl font-black text-slate-800">{globalMetrics.totalExecuted} hs</p>
                  </div>
                  <div className="p-6 bg-white rounded-3xl border flex items-center gap-4">
                    <TrendingUp className="text-emerald-500" />
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase">Burn rate global</p>
                      <p className="text-3xl font-black">{globalMetrics.totalSold > 0 ? Math.round((globalMetrics.totalExecuted / globalMetrics.totalSold) * 100) : 0}%</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white p-4 rounded-3xl border flex items-center gap-3 shadow-sm">
              <Search className="text-slate-300" />
              <input className="w-full outline-none font-bold" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <button
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                className="p-2 rounded-xl border bg-white hover:bg-slate-50 text-slate-500"
                title={viewMode === 'grid' ? 'Ver como lista' : 'Ver como tarjetas'}
              >
                {viewMode === 'grid' ? <LayoutList size={16} /> : <Grid3x3 size={16} />}
              </button>
            </div>

            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-3 gap-6' : 'grid grid-cols-1 gap-3'}>
              {loadingClients ? (
                <div className="col-span-full bg-white p-8 rounded-[2.5rem] border flex items-center justify-center gap-3 text-slate-400 font-bold">
                  <Loader2 className="animate-spin" size={18} /> Cargando clientes...
                </div>
              ) : null}

              {!loadingClients && filteredClients.length === 0 ? (
                <div className="col-span-full bg-white p-8 rounded-[2.5rem] border text-center text-slate-400 font-bold">Sin clientes para mostrar</div>
              ) : null}

              {!loadingClients &&
                filteredClients.map((c) => {
                  const m = clientMetricsMap[c.id] || {};
                  const burn = Math.round(m.burnRate || 0);
                  const isList = viewMode === 'list';
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedClient(c);
                        loadClientFullData(c.id);
                        setView('detail');
                      }}
                      className={'bg-white border hover:border-indigo-100 shadow-xl cursor-pointer group ' + (isList ? 'p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4' : 'p-8 rounded-[2.5rem]')}
                    >
                      <div className={'flex ' + (isList ? 'items-center gap-4' : 'justify-between mb-6')}>
                        <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                          <Building2 />
                        </div>
                        <div>
                          <h3 className="text-xl font-black text-slate-800 truncate">{c.name}</h3>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{c.taxId || 'S/C'}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={
                            'text-[10px] font-black px-3 py-1 rounded-full border ' +
                            (burn >= 110 ? 'text-rose-600 bg-rose-50 border-rose-100' : burn >= 90 ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-emerald-600 bg-emerald-50 border-emerald-100')
                          }
                        >
                          Burn {burn || 0}%
                        </span>
                        <span className="text-[10px] font-black px-3 py-1 rounded-full border bg-emerald-50 text-emerald-600">{c.status || 'ACTIVO'}</span>
                      </div>

                      <div className={'grid grid-cols-2 gap-2 text-[10px] font-black uppercase text-slate-400 ' + (isList ? 'w-full md:w-auto' : 'mt-4')}>
                        <div>
                          Contratos: <span className="text-slate-700">{m.contracted || 0} hs</span>
                        </div>
                        <div>
                          SLA: <span className="text-slate-700">{m.sla || 0} hs</span>
                        </div>
                        <div>
                          Planificado: <span className="text-slate-700">{m.planned || 0} hs</span>
                        </div>
                        <div>
                          Ejecutado: <span className="text-slate-700">{m.real || 0} hs</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {view === 'detail' && selectedClient && (
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="w-full lg:w-1/4 space-y-6">
              <div className="bg-white p-8 rounded-[2.5rem] border text-center shadow-sm sticky top-6">
                <div className="w-24 h-24 bg-indigo-50 rounded-[2rem] flex items-center justify-center text-indigo-600 mx-auto mb-6 shadow-lg">
                  <Building2 size={40} />
                </div>
                <h2 className="text-2xl font-black text-slate-800 leading-tight">{selectedClient.name}</h2>
                <p className="text-[10px] font-black text-slate-300 uppercase mt-2">{selectedClient.taxId}</p>
              </div>
            </div>

            <div className="flex-1 bg-white rounded-[2.5rem] border shadow-sm overflow-hidden flex flex-col min-h-[600px]">
              <div className="flex border-b">
                {['INFO', 'CONTRATOS', 'SERVICIOS', 'SEDES', 'COTIZACIONES', 'HISTORIAL'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={`px-8 py-6 text-[10px] font-black uppercase tracking-widest border-b-[4px] transition-all ${
                      activeTab === t ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30' : 'border-transparent text-slate-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="p-10 flex-1 space-y-6">
                {loadingClientData ? (
                  <div className="p-6 bg-slate-50 rounded-2xl border flex items-center gap-3 text-slate-500 font-bold">
                    <Loader2 className="animate-spin" size={18} /> Cargando datos del cliente...
                  </div>
                ) : null}

                {activeTab === 'INFO' && (
                  <div className="space-y-8">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xl font-black text-slate-800 uppercase">Ficha Técnica</h3>
                      <button
                        onClick={() => {
                          setInfoForm(selectedClient);
                          setIsEditingInfo(!isEditingInfo);
                        }}
                        className="text-indigo-600 font-black text-[10px] uppercase border px-4 py-2 rounded-xl"
                      >
                        Editar
                      </button>
                    </div>

                    {isEditingInfo ? (
                      <div className="space-y-4">
                        <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Nombre comercial" value={infoForm.name || ''} onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })} />
                        <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Razón social" value={infoForm.legalName || ''} onChange={(e) => setInfoForm({ ...infoForm, legalName: e.target.value })} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input className="w-full p-4 border rounded-2xl font-bold" placeholder="CUIT / Tax ID" value={infoForm.taxId || ''} onChange={(e) => setInfoForm({ ...infoForm, taxId: e.target.value })} />
                          <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Condición IVA" value={infoForm.ivaStatus || ''} onChange={(e) => setInfoForm({ ...infoForm, ivaStatus: e.target.value })} />
                        </div>
                        <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Dirección" value={infoForm.address || ''} onChange={(e) => setInfoForm({ ...infoForm, address: e.target.value })} />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Ciudad" value={infoForm.city || ''} onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })} />
                          <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Provincia" value={infoForm.state || ''} onChange={(e) => setInfoForm({ ...infoForm, state: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Contacto" value={infoForm.contactName || ''} onChange={(e) => setInfoForm({ ...infoForm, contactName: e.target.value })} />
                          <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Teléfono" value={infoForm.phone || ''} onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })} />
                        </div>
                        <input className="w-full p-4 border rounded-2xl font-bold" placeholder="Email" value={infoForm.email || ''} onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })} />

                        <button onClick={handleSaveInfo} className="bg-emerald-500 text-white px-8 py-3 rounded-2xl font-black uppercase text-xs">
                          Guardar
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          ['Nombre Comercial', selectedClient.name],
                          ['Razón Social', selectedClient.legalName],
                          ['CUIT / Tax ID', selectedClient.taxId],
                          ['Condición IVA', selectedClient.ivaStatus],
                          ['Dirección', selectedClient.address, true],
                          ['Ciudad', selectedClient.city],
                          ['Provincia', selectedClient.state],
                          ['Contacto', selectedClient.contactName],
                          ['Teléfono', selectedClient.phone],
                          ['Email', selectedClient.email, true],
                        ].map(([label, value, wide], idx) => (
                          <div key={idx} className={'p-6 bg-slate-50 rounded-3xl ' + (wide ? 'md:col-span-2' : '')}>
                            <p className="text-[10px] font-black text-slate-400 uppercase">{label}</p>
                            <p className="font-black text-lg text-slate-700">{(value as any) || '-'}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'CONTRATOS' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <h3 className="text-xl font-black text-slate-800 uppercase">Acuerdos Administrativos</h3>
                      <div className="flex gap-2">
                        <button onClick={() => { resetContractForm(); setContractFormOpen(true); }} className="bg-white border px-4 py-2 rounded-xl text-[10px] font-black uppercase flex gap-2">
                          <Plus size={14} /> Nuevo
                        </button>
                        <button onClick={() => setProformaOpen(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex gap-2">
                          <Receipt size={14} /> Proforma
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="p-4 bg-slate-50 rounded-2xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Contratos</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.length}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Hs Totales</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.reduce((acc, c) => acc + (Number(c.totalHours) || 0), 0)} hs</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Abiertos</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.filter((c) => c.type === 'abierto').length}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Temporales</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.filter((c) => c.type === 'temporal').length}</p>
                      </div>
                    </div>

                    {contractFormOpen ? (
                      <div className="p-6 bg-slate-50 rounded-3xl border space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Nombre del contrato" value={contractForm.name} onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })} />
                          <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Horas totales" value={contractForm.totalHours} onChange={(e) => setContractForm({ ...contractForm, totalHours: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <select className="w-full p-3 rounded-2xl border font-black uppercase text-[10px]" value={contractForm.type} onChange={(e) => setContractForm({ ...contractForm, type: e.target.value })}>
                            <option value="cerrado">Cerrado</option>
                            <option value="abierto">Abierto</option>
                            <option value="temporal">Temporal</option>
                          </select>
                          <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Link / ID de Drive" value={contractForm.driveUrl} onChange={(e) => setContractForm({ ...contractForm, driveUrl: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Inicio (YYYY-MM-DD)" value={contractForm.startDate} onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} />
                          <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Fin (YYYY-MM-DD)" value={contractForm.endDate} onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={handleSaveContract} className="bg-emerald-500 text-white px-6 py-2 rounded-xl font-black uppercase text-xs">
                            {editingContractId ? 'Actualizar' : 'Guardar'}
                          </button>
                          <button onClick={resetContractForm} className="bg-white border px-6 py-2 rounded-xl font-black uppercase text-xs">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {clientContracts.map((c) => {
                      const badge =
                        c.type === 'cerrado' ? 'bg-slate-50 text-slate-500' : c.type === 'abierto' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600';
                      const cStart = c.startDate ? new Date(c.startDate) : null;
                      const cEnd = c.endDate ? new Date(c.endDate) : null;
                      const slaInRange = c.type === 'cerrado' ? Math.round((clientServices || []).reduce((acc, s) => acc + calculateSLAForRange(s.positions, s.startDate, s.endDate, cStart, cEnd), 0)) : null;
                      const contractHours = Math.round(Number(c.totalHours) || 0);
                      const ok = slaInRange !== null ? contractHours === slaInRange : false;

                      return (
                        <div key={c.id} className="p-6 border rounded-3xl flex flex-wrap justify-between items-center gap-4 shadow-sm">
                          <div>
                            <p className="font-black text-slate-700 uppercase">{c.name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] font-bold text-slate-400 uppercase">
                                {c.startDate || '-'} - {c.endDate || '-'}
                              </p>
                              {c.type ? <span className={'text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ' + badge}>{c.type}</span> : null}
                            </div>

                            {slaInRange !== null ? (
                              <div className="mt-2">
                                <span className={'text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ' + (ok ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100')}>
                                  {ok ? `Validado ${slaInRange} hs` : `No coincide (${slaInRange} hs SLA)`}
                                </span>
                              </div>
                            ) : null}

                            {c.driveUrl ? (
                              <a href={c.driveUrl} target="_blank" className="inline-flex items-center gap-2 text-xs font-black text-indigo-600 mt-2">
                                <ExternalLink size={14} /> Abrir Drive
                              </a>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-3">
                            <p className="text-2xl font-black text-indigo-600">{c.totalHours} hs</p>
                            <button onClick={() => startEditContract(c)} className="p-2 hover:bg-slate-100 rounded-lg">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => handleDeleteContract(c.id)} className="p-2 hover:bg-slate-100 rounded-lg text-rose-500">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeTab === 'SERVICIOS' && (
                  <div className="space-y-4">
                    <h3 className="text-xl font-black text-slate-800 uppercase mb-6">Configuración SLA</h3>
                    {editingServiceId ? (
                      <div className="p-6 bg-indigo-50 rounded-2xl mb-4 space-y-4">
                        <input className="w-full p-3 rounded-xl border" value={tempService.objectiveName || ''} onChange={(e) => setTempService({ ...tempService, objectiveName: e.target.value })} />
                        <button onClick={handleSaveService} className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-black uppercase text-xs">
                          Confirmar
                        </button>
                      </div>
                    ) : null}

                    {clientServices.map((s) => (
                      <div key={s.id} className="p-6 border rounded-3xl flex justify-between items-center">
                        <div>
                          <p className="font-black text-slate-700 uppercase">{s.objectiveName}</p>
                          <p className="text-[10px] font-bold text-slate-400">Bolsa: {calculateMonthlySLA(s.positions, s.startDate, s.endDate)} hs</p>
                        </div>
                        <button onClick={() => { setEditingServiceId(s.id); setTempService(s); }} className="p-2 hover:bg-slate-100 rounded-lg">
                          <Edit2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'SEDES' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <h3 className="text-xl font-black text-slate-800 uppercase">Ubicaciones GPS</h3>
                      <button onClick={resetObjectiveForm} className="bg-white border px-4 py-2 rounded-xl text-[10px] font-black uppercase flex gap-2">
                        <Plus size={14} /> Nuevo
                      </button>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-3xl border space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Nombre del objetivo" value={objectiveForm.name} onChange={(e) => setObjectiveForm({ ...objectiveForm, name: e.target.value })} />
                        <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Dirección" value={objectiveForm.address} onChange={(e) => setObjectiveForm({ ...objectiveForm, address: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Latitud" value={objectiveForm.lat} onChange={(e) => setObjectiveForm({ ...objectiveForm, lat: e.target.value })} />
                        <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Longitud" value={objectiveForm.lng} onChange={(e) => setObjectiveForm({ ...objectiveForm, lng: e.target.value })} />
                        <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Contacto" value={objectiveForm.contact} onChange={(e) => setObjectiveForm({ ...objectiveForm, contact: e.target.value })} />
                      </div>
                      <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Notas" value={objectiveForm.notes} onChange={(e) => setObjectiveForm({ ...objectiveForm, notes: e.target.value })} />
                      <div className="flex gap-2">
                        <button onClick={handleSaveObjective} className="bg-emerald-500 text-white px-6 py-2 rounded-xl font-black uppercase text-xs">
                          {editingObjectiveIndex !== null ? 'Actualizar' : 'Guardar'}
                        </button>
                        {editingObjectiveIndex !== null ? (
                          <button onClick={resetObjectiveForm} className="bg-white border px-6 py-2 rounded-xl font-black uppercase text-xs">
                            Cancelar
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {(selectedClient.objetivos || []).map((o: any, idx: number) => (
                      <div key={idx} className="p-6 border rounded-3xl flex flex-wrap justify-between items-center gap-4">
                        <div>
                          <p className="font-black text-slate-700 uppercase">{o.name}</p>
                          <p className="text-[10px] font-bold text-slate-400">{o.address || '-'}</p>
                          {o.contact ? <p className="text-[10px] font-bold text-slate-400">Contacto: {o.contact}</p> : null}
                        </div>
                        <div className="flex gap-2 items-center">
                          {o.lat && o.lng ? (
                            <a href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank" className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                              <Globe size={18} />
                            </a>
                          ) : null}
                          <button onClick={() => startEditObjective(o, idx)} className="p-2 hover:bg-slate-100 rounded-lg">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => handleDeleteObjective(idx)} className="p-2 hover:bg-slate-100 rounded-lg text-rose-500">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === 'COTIZACIONES' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xl font-black text-slate-800 uppercase">Propuestas</h3>
                      <button onClick={() => router.push('/admin/cotizador')} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase">
                        + Nueva
                      </button>
                    </div>
                    <div className="border rounded-2xl overflow-hidden">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-[10px] font-black uppercase">
                          <tr>
                            <th className="p-4">Fecha</th>
                            <th className="p-4">Monto</th>
                            <th className="p-4" />
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {clientQuotes.map((q) => (
                            <tr key={q.id} className="text-xs font-bold">
                              <td className="p-4">{q.createdAt?.toDate?.().toLocaleDateString?.() || '-'}</td>
                              <td className="p-4">{formatMoney(q.results?.valorTotalContrato)}</td>
                              <td className="p-4 text-right">
                                {q.pdfUrl || q.pdf || q.fileUrl || q.url ? (
                                  <a href={q.pdfUrl || q.pdf || q.fileUrl || q.url} target="_blank" className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700">
                                    <Printer size={16} /> PDF
                                  </a>
                                ) : (
                                  <span className="text-slate-300">Sin PDF</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'HISTORIAL' && (
                  <div className="space-y-6">
                    <div className="flex gap-2">
                      <input className="flex-1 p-3 border rounded-xl" placeholder="Agregar nota..." value={historyNote} onChange={(e) => setHistoryNote(e.target.value)} />
                      <button onClick={handleAddHistory} className="bg-indigo-600 text-white px-4 rounded-xl">
                        <Send size={18} />
                      </button>
                    </div>
                    <div className="space-y-3">
                      {(selectedClient.historial || []).map((h: any, i: number) => (
                        <div key={i} className="p-4 bg-slate-50 rounded-2xl border">
                          <p className="text-[10px] font-black text-slate-400 uppercase">
                            {h.user} - {new Date(h.date).toLocaleString()}
                          </p>
                          <p className="text-sm font-bold text-slate-700">{h.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {proformaOpen ? (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setProformaOpen(false)}>
            <div className="bg-white rounded-[2rem] p-8 w-full max-w-6xl shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-black text-slate-800 uppercase">Proforma</h3>
                <button onClick={() => setProformaOpen(false)} className="p-2 rounded-xl hover:bg-slate-100">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-slate-50 rounded-2xl border">
                  <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Pre-factura</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm font-bold text-slate-600">
                    <div>Cliente: <span className="text-slate-800">{selectedClient?.name || '-'}</span></div>
                    <div>CUIT: <span className="text-slate-800">{selectedClient?.taxId || '-'}</span></div>
                    <div>Razón Social: <span className="text-slate-800">{selectedClient?.legalName || '-'}</span></div>
                    <div className="md:col-span-2">Dirección: <span className="text-slate-800">{selectedClient?.address || '-'}</span></div>
                    <div>Contacto: <span className="text-slate-800">{selectedClient?.contactName || '-'}</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <select className="w-full p-3 rounded-2xl border font-black uppercase text-[10px]" value={proformaYear} onChange={(e) => setProformaYear(Number(e.target.value))}>
                    {[proformaYear - 2, proformaYear - 1, proformaYear, proformaYear + 1].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <select className="w-full p-3 rounded-2xl border font-black uppercase text-[10px]" value={proformaMonth} onChange={(e) => setProformaMonth(Number(e.target.value))}>
                    {MONTHS_ES.map((m, idx) => (
                      <option key={m} value={idx}>{m}</option>
                    ))}
                  </select>
                  <input type="date" className="w-full p-3 rounded-2xl border font-bold" value={proformaStartDate} onChange={(e) => setProformaStartDate(e.target.value)} />
                  <input type="date" className="w-full p-3 rounded-2xl border font-bold" value={proformaEndDate} onChange={(e) => setProformaEndDate(e.target.value)} />
                  <select className="w-full p-3 rounded-2xl border font-black uppercase text-[10px]" value={proformaDetailMode} onChange={(e) => setProformaDetailMode(e.target.value as ProformaDetailMode)}>
                    <option value="auto">Detalle Auto</option>
                    <option value="planned">Detalle Planificado</option>
                    <option value="executed">Detalle Ejecutado</option>
                  </select>
                  <select className="w-full p-3 rounded-2xl border font-black uppercase text-[10px]" value={proformaBase} onChange={(e) => setProformaBase(e.target.value as ProformaBase)}>
                    <option value="requested">Solicitado (SLA)</option>
                    <option value="planned">Planificado</option>
                    <option value="executed">Ejecutado</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input className="w-full p-3 rounded-2xl border font-bold" placeholder="Valor hora (ARS)" value={proformaHourlyValue} onChange={(e) => setProformaHourlyValue(e.target.value)} />
                  <div className="md:col-span-2 flex items-center gap-3">
                    <button onClick={calculateProformaTurnos} className="bg-white border px-4 py-2 rounded-xl text-[10px] font-black uppercase flex gap-2">
                      <Calculator size={14} /> Recalcular turnos
                    </button>
                    {proformaTotals.loading ? (
                      <span className="text-xs font-bold text-slate-400 flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> Calculando...
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-4 bg-slate-50 rounded-2xl border">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Horas base</p>
                    <p className="text-2xl font-black text-slate-800">{baseHours} hs</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Valor hora</p>
                    <p className="text-2xl font-black text-slate-800">{formatMoney(Number(proformaHourlyValue) || 0)}</p>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-2xl border">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Total estimado</p>
                    <p className="text-2xl font-black text-slate-800">{formatMoney(totalEstimate)}</p>
                  </div>
                </div>

                <div className="p-4 bg-white rounded-2xl border space-y-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-black uppercase text-slate-400">Detalle por objetivo y puesto</p>
                    <span className="text-[10px] font-black uppercase text-slate-400">HS</span>
                  </div>

                  {proformaBreakdown.length === 0 ? <div className="text-sm font-bold text-slate-400">Sin turnos en el período seleccionado.</div> : null}

                  <div className="space-y-2">
                    {proformaBreakdown.map((o) => (
                      <div key={o.objectiveName} className="border rounded-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
                          <div>
                            <p className="text-sm font-black text-slate-800">{o.objectiveName}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Objetivo</p>
                          </div>
                          <div className="text-sm font-black text-slate-700">{o.totalHours} hs</div>
                        </div>
                        <div className="space-y-2 p-3">
                          {o.positions.map((p: any) => {
                            const key = `${o.objectiveName}__${p.positionName}`;
                            return (
                              <div key={key} className="border rounded-2xl overflow-hidden">
                                <button onClick={() => toggleExpandedKey(key)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                                  <div>
                                    <p className="text-sm font-black text-slate-800">{p.positionName}</p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Puesto</p>
                                  </div>
                                  <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                                    {p.totalHours} hs {expandedKeys[key] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </div>
                                </button>
                                {expandedKeys[key] ? (
                                  <div className="px-4 pb-3 text-xs font-bold text-slate-500 space-y-1">
                                    {p.byDay.map((d: any) => (
                                      <div key={d.date} className="flex items-center justify-between">
                                        <span>{d.date}</span>
                                        <span>{d.hours} hs</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex justify-end">
                    <button onClick={() => setProformaOpen(false)} className="bg-indigo-600 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase">
                      Cerrar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
