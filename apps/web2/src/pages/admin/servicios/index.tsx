import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, PageHeader, ModuleShell } from '@/components/ui';
import { slaService, ServiceSLA, ServicePosition, ShiftVariant } from '@/services/slaService'; 
import { useToast } from '@/context/ToastContext';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { FirebaseError } from 'firebase/app'; 
import { collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, where, getDocs, writeBatch, doc, Timestamp } from 'firebase/firestore';
import {
  Shield, Calendar, Users, Plus, Trash2, Edit2, Copy,
  Search, Save, X, MapPin, Briefcase, Table, Settings,
  AlertCircle, Info, Sun, Moon, Activity, RotateCw, CheckCircle, FileText,
  Clock, Layers
} from 'lucide-react';
import { ServiceShiftSchemeModal } from '@/components/servicios/ServiceShiftSchemeModal';
import { ServiceShiftSchemeIcon } from '@/components/servicios/ServiceShiftSchemeIcon';
import { analyzeShiftSchemesForService } from '@/lib/servicios/shiftSchemeAdvisor';
import { useEmpresa } from '@/context/EmpresaContext';
import {
  filterSlaRowsByEmpresa, belongsToEmpresaView, belongsToEmpresa, shouldScopeQueriesToEmpresa,
  collectTurnoIdsForSlaDelete, deleteSlaWithRelatedDataForEmpresa, TenantIsolationError,
} from '@/lib/multiempresa';
import { isSlaContractActive } from '@/lib/slaPlanningMatch';
import {
  analyzeShiftComposition,
  calculateMonthlyBreakdown,
  computePositionDayComposition,
  parseYmdToLocalDate,
  WEEK_DAY_CODES,
} from '@/lib/servicios/slaHoursCalculator';

import { toYyyyMmDd } from '@/lib/firestoreDates';

function serviceSlaRowKey(srv: ServiceSLA): string {
  return srv.id || `${srv.clientId}-${srv.objectiveId}-${srv.startDate}`;
}

// --- 1. MODELO DE DATOS ---

// ✅ PRESETS (SUVICO/CCT 422/05)
const SHIFT_VARIANTS_DB: Record<string, ShiftVariant> = {
    'M': { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8 },
    'T': { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8 }, // Incluye 2h nocturnas (21-23)
    'N': { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
    'D12': { code: 'D12', name: 'Diurno 12h', startTime: '07:00', endTime: '19:00', hours: 12 },
    'N12': { code: 'N12', name: 'Nocturno 12h', startTime: '19:00', endTime: '07:00', hours: 12 }, // Incluye 9h nocturnas (21-06)
};

function parseHm(t: string): number {
  const s = (t || '00:00').slice(0, 5);
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return ((hh * 60 + mm) % 1440 + 1440) % 1440;
}

function formatHmLinear(linearMin: number): string {
  const x = ((linearMin % 1440) + 1440) % 1440;
  const hh = Math.floor(x / 60);
  const mm = x % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export default function ServiciosSLAPage() {
  const { addToast } = useToast();
  const { empresaId, empresa } = useEmpresa();
  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  
  // ESTADOS
  const [currentUserName, setCurrentUserName] = useState("Cargando...");
  const [dbStatus, setDbStatus] = useState<'online' | 'offline'>('offline');
  const [loading, setLoading] = useState(false);
  
  const [view, setView] = useState<'list' | 'form'>('list');
  const [services, setServices] = useState<ServiceSLA[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [availableObjectives, setAvailableObjectives] = useState<any[]>([]);

  // Fechas por defecto
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

  const [form, setForm] = useState<ServiceSLA>({
    clientId: '', clientName: '', objectiveId: '', objectiveName: '',
    startDate: firstDay, endDate: lastDay,
    positions: [], totalMonthlyHours: 0, status: 'active'
  });

  const [showPositionModal, setShowPositionModal] = useState(false);
  const [positionForm, setPositionForm] = useState<ServicePosition>({
    id: '', name: 'Puesto 1', code: '', coverageType: '24hs', quantity: 1,
    activeDays: ['L','M','X','J','V','S','D'], allowedShiftTypes: [], preferenciaGenero: 'INDISTINTO',
  });

  const [newCustomShift, setNewCustomShift] = useState<{
      name: string; start: string; end: string; code: string; days: string[]; specificDates: string[]
  }>({
      name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'], specificDates: []
  });
  const [customShiftDateMode, setCustomShiftDateMode] = useState<'weekdays' | 'dates'>('weekdays');
  const [pendingDate, setPendingDate] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [showExcludedDatesPicker, setShowExcludedDatesPicker] = useState(false);
  const [excludedDatesScope, setExcludedDatesScope] = useState<'ALL' | string>('ALL');
  const savedSelfRef = useRef(false); // evita falsos positivos por nuestros propios guardados
  // Código del turno que se está editando (null = modo "agregar nuevo")
  const [editingShiftCode, setEditingShiftCode] = useState<string | null>(null);

  // --- EFECTOS ---
  
  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) setCurrentUserName(user.displayName || user.email || "Usuario Crono");
        else setCurrentUserName("No Logueado");
    });
    return () => unsubscribe();
  }, []);

  // Detectar cambios externos mientras se edita un servicio
  useEffect(() => {
    if (!isEditing || !form.id) { setExternalChange(false); return; }
    if (savedSelfRef.current) { savedSelfRef.current = false; return; }
    const serverVersion = services.find(s => s.id === form.id);
    if (!serverVersion) return;
    const serverPositionsJson = JSON.stringify(serverVersion.positions);
    const formPositionsJson = JSON.stringify(form.positions);
    if (serverPositionsJson !== formPositionsJson) setExternalChange(true);
  }, [services]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de empresa: limpiar listado y volver a la grilla
  useEffect(() => {
    setServices([]);
    setClients([]);
    setAvailableObjectives([]);
    setView('list');
    setIsEditing(false);
  }, [empresaId]);

  // ✅ Colección servicios_sla — sin orderBy(clientName): excluye docs legacy sin ese campo
  useEffect(() => {
      if (!empresaId) return;

      let unsub: (() => void) | undefined;
      let cancelled = false;

      (async () => {
        setLoading(true);
        let clientRows: any[] = [];
        try {
          clientRows = await slaService.getClients({ empresaId, scopeEmpresa });
          if (!cancelled) setClients(clientRows);
        } catch (e) {
          console.error('Error cargando clientes:', e);
        }

        const clientIds = new Set(clientRows.map((c) => c.id));

        const q = scopeEmpresa
            ? query(collection(db, 'servicios_sla'), where('empresaId', '==', empresaId))
            : query(collection(db, 'servicios_sla'));

        unsub = onSnapshot(q, (snapshot) => {
            let adaptedData = snapshot.docs.map(doc => {
                const data = doc.data();
                return { 
                    id: doc.id, 
                    ...data,
                    startDate: toYyyyMmDd(data.startDate),
                    endDate: toYyyyMmDd(data.endDate),
                    positions: data.positions || [] 
                } as ServiceSLA;
              });
            if (scopeEmpresa) {
              adaptedData = filterSlaRowsByEmpresa(adaptedData, empresaId, true, clientIds);
            }
            adaptedData.sort((a, b) =>
              (a.clientName || a.objectiveName || '').localeCompare(b.clientName || b.objectiveName || '', 'es'),
            );
            setServices(adaptedData);
            setDbStatus('online');
            setLoading(false);
        }, (error) => {
            console.error("Error RealTime:", error);
            setDbStatus('offline');
            setLoading(false);
            loadDataFallback(clientIds);
        });
      })();

      return () => {
        cancelled = true;
        unsub?.();
      };
  }, [empresaId, scopeEmpresa]);

  // Suscripción turnos RFZ/TURA — extras solicitados por cliente
  useEffect(() => {
    if (!empresaId) return;
    const q = query(
      collection(db, 'turnos'),
      where('empresaId', '==', empresaId),
      where('code', 'in', ['RFZ', 'TURA']),
    );
    const unsub = onSnapshot(q, snap => {
      setRfzTuraExtras(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return unsub;
  }, [empresaId]);

  const loadDataFallback = async (clientIds?: Set<string>) => {
    const ids = clientIds ?? new Set(clients.map((c) => c.id));
    const data = await slaService.getAll({ empresaId, scopeEmpresa, clientIds: ids });
    const adaptedData = data.map((d: any) => ({
      ...d,
      startDate: toYyyyMmDd(d.startDate),
      endDate: toYyyyMmDd(d.endDate),
      positions: d.positions || [],
    }));
    setServices(adaptedData);
    setLoading(false);
  };

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);


  // Auditoría en 'audit_logs'
  const registrarAuditoria = async (accion: string, detalle: string) => {
      try {
          const auth = getAuth();
          const currentUser = auth.currentUser;
          const actorName = currentUser?.displayName || currentUser?.email || "Sistema";
          const actorUid = currentUser?.uid || "SYSTEM";

          await addDoc(collection(db, 'audit_logs'), { 
              timestamp: serverTimestamp(),
              actorUid: actorUid,
              actorName: actorName,
              action: accion,
              module: 'SERVICIOS_SLA',
              details: detalle,
              ...(scopeEmpresa && empresaId ? { empresaId } : {}),
              metadata: { platform: 'web_admin_crono' }
          });
      } catch (error: any) {
          console.error("Error auditoría:", error);
      }
  };

  // --- MOTOR DE CÁLCULO (compartido con Dashboard y CRM vía slaHoursCalculator) ---
  const calculateShiftHours = (start: string, end: string) => analyzeShiftComposition(start, end).total;

  const rebuild24hsVariants = (anchorM: string, anchorD12: string): ShiftVariant[] => {
    const m0 = parseHm(anchorM);
    const d0 = parseHm(anchorD12);
    const H8 = 8 * 60;
    const H12 = 12 * 60;
    const presets = SHIFT_VARIANTS_DB;
    const mS = formatHmLinear(m0);
    const mE = formatHmLinear(m0 + H8);
    const tS = formatHmLinear(m0 + H8);
    const tE = formatHmLinear(m0 + H8 * 2);
    const nS = formatHmLinear(m0 + H8 * 2);
    const nE = formatHmLinear(m0 + H8 * 3);
    const d12S = formatHmLinear(d0);
    const d12E = formatHmLinear(d0 + H12);
    const n12S = formatHmLinear(d0 + H12);
    const n12E = formatHmLinear(d0 + H12 * 2);
    return [
      { ...presets['M'], startTime: mS, endTime: mE, hours: calculateShiftHours(mS, mE) },
      { ...presets['T'], startTime: tS, endTime: tE, hours: calculateShiftHours(tS, tE) },
      { ...presets['N'], startTime: nS, endTime: nE, hours: calculateShiftHours(nS, nE) },
      { ...presets['D12'], startTime: d12S, endTime: d12E, hours: calculateShiftHours(d12S, d12E) },
      { ...presets['N12'], startTime: n12S, endTime: n12E, hours: calculateShiftHours(n12S, n12E) },
    ];
  };

  const formatPositionDailyCoverageLabel = (pos: ServicePosition) => {
    const totals = WEEK_DAY_CODES.map((d) => computePositionDayComposition(pos, d).dayTotal);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const r = (x: number) => Math.round(x * 10) / 10;
    if (max < 1e-6) return '—';
    if (Math.abs(min - max) < 1e-6) return `${r(max)} hs/día`;
    return `${r(min)}–${r(max)} hs/día`;
  };

  const monthlyBreakdown = useMemo(
    () => calculateMonthlyBreakdown(form.positions, form.startDate, form.endDate, form.excludedDates),
    [form.positions, form.startDate, form.endDate, form.excludedDates]
  );
  const totalContractHours = useMemo(
    () => Math.round(monthlyBreakdown.reduce((acc, curr) => acc + curr.totalHours, 0)),
    [monthlyBreakdown]
  );
  const totalNightHours = useMemo(
    () => Math.round(monthlyBreakdown.reduce((acc, curr) => acc + curr.nightHours, 0)),
    [monthlyBreakdown]
  );
  const totalWeekendHours = useMemo(
    () => Math.round(monthlyBreakdown.reduce((acc, curr) => acc + curr.weekendHours, 0)),
    [monthlyBreakdown]
  );

  // Historial combinado: meses de versiones anteriores + meses del form actual
  const combinedMonthlyBreakdown = useMemo(() => {
    const map: Record<string, { name: string; days: number; totalHours: number; nightHours: number; weekendHours: number; isCurrent: boolean; sortKey: string; serviceId?: string }> = {};

    // Otras versiones del mismo cliente+objetivo (excluir el form actual)
    services
      .filter(s => s.clientId === form.clientId && s.objectiveId === form.objectiveId && s.id !== form.id)
      .forEach(srv => {
        calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate, srv.excludedDates).forEach((m) => {
          const sk = m.monthKey;
          if (!map[sk]) map[sk] = { ...m, isCurrent: false, sortKey: sk, serviceId: srv.id };
        });
      });

    // Meses del form actual (sobrescriben si coinciden)
    monthlyBreakdown.forEach((m) => {
      const sk = m.monthKey;
      map[sk] = { ...m, isCurrent: true, sortKey: sk };
    });

    return Object.values(map).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [services, form.clientId, form.objectiveId, form.id, form.startDate, monthlyBreakdown]);

  const serviceTotals = useMemo(() => {
    const map = new Map<string, number>();
    services.forEach((srv) => {
      const breakdown = calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate, srv.excludedDates);
      const fromBreakdown = Math.round(breakdown.reduce((acc, curr) => acc + curr.totalHours, 0));
      const total = fromBreakdown > 0 ? fromBreakdown : Math.round(Number(srv.totalMonthlyHours) || 0);
      map.set(serviceSlaRowKey(srv), total);
    });
    return map;
  }, [services]);

  const parseDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => {
    return aStart <= bEnd && aEnd >= bStart;
  };

  // --- MODAL Y UTILS ---
  const openAddPositionModal = () => {
      setEditingShiftCode(null);
      setNewCustomShift({ name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'], specificDates: [] });
      setCustomShiftDateMode('weekdays');
      // Usar freshForm directamente para evitar capturar positionForm stale (async setState)
      const freshForm: ServicePosition = {
        id: '', name: 'Puesto 1', code: '', coverageType: '24hs', quantity: 1,
        activeDays: ['L','M','X','J','V','S','D'], allowedShiftTypes: []
      };
      updateVariantsForCoverage('24hs', freshForm, { anchorM: '07:00', anchorD12: '07:00' });
      setShowPositionModal(true);
  };

  const updateVariantsForCoverage = (
      type: string,
      currentFormState: ServicePosition,
      anchors?: { anchorM?: string; anchorD12?: string }
  ) => {
      let variants: ShiftVariant[] = [];
      if (type === '24hs') {
        const am = anchors?.anchorM || '07:00';
        const ad = anchors?.anchorD12 || '07:00';
        variants = rebuild24hsVariants(am, ad);
      }
      else if (type === '12hs_diurno') variants = [SHIFT_VARIANTS_DB['M'], SHIFT_VARIANTS_DB['D12']];
      else if (type === '12hs_nocturno') variants = [SHIFT_VARIANTS_DB['N'], SHIFT_VARIANTS_DB['N12']];
      
      setPositionForm({ ...currentFormState, allowedShiftTypes: type === 'custom' ? [] : variants, coverageType: type as any });
  };

  const handleCoverageTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const type = e.target.value;
      if (type === '24hs') {
        const m = positionForm.allowedShiftTypes.find((s) => s.code === 'M')?.startTime?.slice(0, 5) || '07:00';
        const d = positionForm.allowedShiftTypes.find((s) => s.code === 'D12')?.startTime?.slice(0, 5) || '07:00';
        updateVariantsForCoverage('24hs', positionForm, { anchorM: m, anchorD12: d });
      } else {
        updateVariantsForCoverage(type, positionForm);
      }
  };

  const toggleStandardVariant = (variantKey: string) => {
      const variant = SHIFT_VARIANTS_DB[variantKey];
      const exists = positionForm.allowedShiftTypes.find(v => v.code === variant.code && !v.isCustom);
      let newAllowed = [...positionForm.allowedShiftTypes];
      if (exists) newAllowed = newAllowed.filter(v => v.code !== variant.code || v.isCustom);
      else newAllowed.push(variant);
      setPositionForm({ ...positionForm, allowedShiftTypes: newAllowed });
  };

  const toggleNewShiftDay = (day: string) => {
      setNewCustomShift(prev => {
          const days = prev.days.includes(day) ? prev.days.filter(d => d !== day) : [...prev.days, day];
          return { ...prev, days };
      });
  };

  const addCustomShift = () => {
      if (!newCustomShift.name) return;
      const hours = calculateShiftHours(newCustomShift.start, newCustomShift.end);
      const code = newCustomShift.code || newCustomShift.name.substring(0, 2).toUpperCase();

      const newVariant: ShiftVariant = {
          code, name: newCustomShift.name, startTime: newCustomShift.start, endTime: newCustomShift.end,
          hours, isCustom: true,
          ...(customShiftDateMode === 'dates'
              ? { specificDates: newCustomShift.specificDates }
              : { days: newCustomShift.days }),
      };

      if (editingShiftCode !== null) {
          setPositionForm(prev => ({
              ...prev,
              allowedShiftTypes: prev.allowedShiftTypes.map(v =>
                  v.code === editingShiftCode ? newVariant : v
              )
          }));
          setEditingShiftCode(null);
      } else {
          setPositionForm(prev => ({ ...prev, allowedShiftTypes: [...prev.allowedShiftTypes, newVariant] }));
      }
      setNewCustomShift(prev => ({ ...prev, name: '', code: '', specificDates: [] }));
  };

  const startEditShift = (v: ShiftVariant) => {
      const hasSpecificDates = Array.isArray(v.specificDates) && v.specificDates.length > 0;
      setCustomShiftDateMode(hasSpecificDates ? 'dates' : 'weekdays');
      setNewCustomShift({ name: v.name, start: v.startTime, end: v.endTime, code: v.code, days: v.days || [], specificDates: v.specificDates || [] });
      setEditingShiftCode(v.code);
  };

  const cancelEditShift = () => {
      setNewCustomShift({ name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'], specificDates: [] });
      setCustomShiftDateMode('weekdays');
      setPendingDate('');
      setEditingShiftCode(null);
  };

  const removeCustomVariant = (code: string) => {
      setPositionForm(prev => ({ ...prev, allowedShiftTypes: prev.allowedShiftTypes.filter(v => v.code !== code) }));
      if (editingShiftCode === code) cancelEditShift();
  };

  const handleSavePosition = () => {
      if (!positionForm.name) return addToast('Nombre requerido', 'error');
      if (positionForm.allowedShiftTypes.length === 0) return addToast('Seleccione al menos un turno', 'error');

      const newId = positionForm.id || `pos_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const newPosition: ServicePosition = {
        ...positionForm,
        id: newId,
        allowedShiftTypes: positionForm.allowedShiftTypes.map(s => ({ ...s })),
      };
      let updatedPositions = [...form.positions];
      if (positionForm.id) updatedPositions = updatedPositions.map(p => p.id === positionForm.id ? newPosition : p);
      else updatedPositions.push(newPosition);

      setForm({ ...form, positions: updatedPositions });
      setShowPositionModal(false);
  };

  const removePosition = (id: string) => {
      const updatedPositions = form.positions.filter(p => p.id !== id);
      setForm({ ...form, positions: updatedPositions });
  };

  const handleSave = async () => {
    if (!form.clientId) return addToast('Falta Cliente', 'error');
    if (!form.objectiveId) return addToast('Falta Objetivo', 'error');
    if (form.positions.length === 0) return addToast('Agregue al menos un puesto', 'error');

    const startDate = parseDate(form.startDate);
    const endDate = parseDate(form.endDate);
    if (!startDate || !endDate) return addToast('Fechas inválidas', 'error');
    if (startDate > endDate) return addToast('La fecha de inicio no puede ser mayor que la de fin', 'error');

    // Al editar, el objetivo ya era válido cuando se creó; solo validar en creación
    if (!isEditing) {
      const objectiveValid = availableObjectives.some(o => o.id === form.objectiveId);
      if (!objectiveValid) return addToast('El objetivo no pertenece al cliente seleccionado', 'error');
    }

    const hasOverlap = services.some(s => {
      if (!s.startDate || !s.endDate) return false;
      if (s.clientId !== form.clientId || s.objectiveId !== form.objectiveId) return false;
      if (isEditing && form.id && s.id === form.id) return false;
      const sStart = parseDate(s.startDate);
      const sEnd = parseDate(s.endDate);
      if (!sStart || !sEnd) return false;
      return rangesOverlap(startDate, endDate, sStart, sEnd);
    });
    if (hasOverlap) return addToast('Ya existe un SLA con fechas superpuestas para ese objetivo', 'error');

    const turnosBelong = (data: Record<string, unknown>) =>
      !scopeEmpresa || belongsToEmpresa(data, empresaId, true);

    // ── Cleanup al cambiar fechas ────────────────────────────────────────────
    // Si la fecha de inicio se adelantó o la de fin se retrasó, eliminar todos los
    // turnos, ausencias y novedades del objetivo fuera del nuevo rango.
    if (isEditing && form.id) {
      const oldService = services.find(s => s.id === form.id);
      if (oldService) {
        const oldStart = parseDate(oldService.startDate);
        const oldEnd   = parseDate(oldService.endDate);

        const turnosToDelete: string[] = [];

        if (oldStart && startDate > oldStart) {
          const snap = await getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', form.objectiveId),
            where('startTime', '<', Timestamp.fromDate(startDate))
          ));
          snap.docs.forEach(d => { if (turnosBelong(d.data())) turnosToDelete.push(d.id); });
        }

        if (oldEnd && endDate < oldEnd) {
          const newEndOfDay = new Date(endDate); newEndOfDay.setHours(23, 59, 59, 999);
          const snap = await getDocs(query(
            collection(db, 'turnos'),
            where('objectiveId', '==', form.objectiveId),
            where('startTime', '>', Timestamp.fromDate(newEndOfDay))
          ));
          snap.docs.forEach(d => { if (turnosBelong(d.data())) turnosToDelete.push(d.id); });
        }

        if (turnosToDelete.length > 0) {
          const ausToDelete: string[] = [];
          const novToDelete: string[] = [];
          for (let i = 0; i < turnosToDelete.length; i += 10) {
            const chunk = turnosToDelete.slice(i, i + 10);
            const [ausSnap, novSnap] = await Promise.all([
              getDocs(query(collection(db, 'ausencias'), where('shiftId', 'in', chunk))),
              getDocs(query(collection(db, 'novedades'), where('shiftId', 'in', chunk))),
            ]);
            ausSnap.docs.forEach(d => ausToDelete.push(d.id));
            novSnap.docs.forEach(d => novToDelete.push(d.id));
          }

          const msg = `⚠️ Cambio de fechas detectado.\n\nSe eliminarán:\n• ${turnosToDelete.length} turno(s)\n• ${ausToDelete.length} ausencia(s)\n• ${novToDelete.length} novedad(es)\n\ndel objetivo "${form.objectiveName}" fuera del nuevo rango.\n\n¿Confirmar?`;
          if (!confirm(msg)) return;

          await Promise.all([
            deleteDocsByIdsForEmpresa('turnos', turnosToDelete, empresaId, migracionCompleta),
            deleteDocsByIdsForEmpresa('ausencias', ausToDelete, empresaId, migracionCompleta),
            deleteDocsByIdsForEmpresa('novedades', novToDelete, empresaId, migracionCompleta),
          ]);
          addToast(`${turnosToDelete.length} turno(s) eliminados del objetivo`, 'success');
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // JSON round-trip elimina campos undefined que Firestore no acepta
    const dataToSave = JSON.parse(JSON.stringify({ ...form, totalMonthlyHours: totalContractHours })) as any;
    if (scopeEmpresa && empresaId) dataToSave.empresaId = empresaId;

    try {
      if (isEditing && form.id) {
          savedSelfRef.current = true;
          await slaService.update(form.id, dataToSave, { empresaId, migracionCompleta });
          // Actualización optimista: no esperar al snapshot
          setServices(prev => prev.map(s => s.id === form.id ? { ...dataToSave, id: form.id } : s));
          await registrarAuditoria('UPDATE_CONTRACT', `Editó contrato: ${form.clientName} - ${form.objectiveName}`);
      } else {
          delete dataToSave.id; // garantizar que no va id undefined al crear
          const ref = await slaService.add(dataToSave, empresaId);
          // Actualización optimista: agregar inmediatamente con el nuevo id
          setServices(prev => [...prev, { ...dataToSave, id: ref.id }]);
          await registrarAuditoria('CREATE_CONTRACT', `Creó contrato: ${form.clientName} - ${form.objectiveName}`);
      }
      addToast('Guardado correctamente', 'success');
      setView('list');
    } catch (e: unknown) {
        console.error(e);
        if (e instanceof TenantIsolationError) {
          addToast(e.message, 'error');
        } else if (e instanceof FirebaseError && e.code === 'permission-denied') {
          addToast('Permiso denegado en Firestore. Verificá rol/empresa o pedí redeploy de reglas.', 'error');
        } else {
          addToast(e instanceof Error ? e.message : 'Error al guardar', 'error');
        }
    }
  };

  const handleEdit = (srv: ServiceSLA) => {
    // Deep copy para evitar mutar el objeto del estado services
    setForm({
      ...srv,
      positions: (srv.positions || []).map(p => ({
        ...p,
        allowedShiftTypes: (p.allowedShiftTypes || []).map(s => ({ ...s })),
      })),
    });
    const client = clients.find(c => c.id === srv.clientId);
    const clientObjectives = client?.objectives || [];
    // Garantizar que el objetivo actual siempre esté disponible en el dropdown
    const hasCurrentObj = clientObjectives.some((o: any) => o.id === srv.objectiveId);
    const objectives = hasCurrentObj
      ? clientObjectives
      : [...clientObjectives, { id: srv.objectiveId, name: srv.objectiveName }];
    setAvailableObjectives(objectives);
    setIsEditing(true); setView('form');
  };

  const handleDelete = async (id: string) => {
    const srv = services.find(s => s.id === id);
    if (!srv) return;

    const client = clients.find(c => c.id === srv.clientId);
    const clientObjetivos = client?.objectives || client?.objetivos || [];

    let shiftIds: string[] = [];
    try {
      shiftIds = await collectTurnoIdsForSlaDelete(
        {
          id: srv.id || id,
          clientId: srv.clientId,
          objectiveId: srv.objectiveId,
          objectiveName: srv.objectiveName,
          startDate: srv.startDate,
          endDate: srv.endDate,
        },
        empresaId,
        migracionCompleta,
        clientObjetivos,
      );
    } catch (e) {
      console.error(e);
      addToast('Error al buscar turnos del servicio', 'error');
      return;
    }

    const msg = [
      `¿Eliminar el servicio "${srv.clientName} - ${srv.objectiveName}"?`,
      `Período: ${srv.startDate} → ${srv.endDate}`,
      '',
      'Se eliminarán los datos de ese período:',
      `• ${shiftIds.length} turno(s)`,
      '',
      'También se borran ausencias y novedades vinculadas a esos turnos.',
      'Esta acción no se puede deshacer.',
    ].join('\n');
    if (!confirm(msg)) return;

    try {
      const r = await deleteSlaWithRelatedDataForEmpresa(
        {
          id: srv.id || id,
          clientId: srv.clientId,
          objectiveId: srv.objectiveId,
          objectiveName: srv.objectiveName,
          startDate: srv.startDate,
          endDate: srv.endDate,
        },
        empresaId,
        migracionCompleta,
        clientObjetivos,
      );
      await registrarAuditoria('DELETE_CONTRACT', `Eliminó contrato: ${srv.clientName} - ${srv.objectiveName} (${r.deletedTurnos} turnos)`);
      addToast(`Servicio eliminado con ${r.deletedTurnos} turno(s)`, 'success');
    } catch (e) {
      addToast(e instanceof TenantIsolationError ? e.message : 'Error al eliminar servicio', 'error');
    }
  };

  const openNew = () => {
    const t = new Date();
    setForm({
        clientId: '', clientName: '', objectiveId: '', objectiveName: '',
        startDate: new Date(t.getFullYear(), t.getMonth(), 1).toISOString().split('T')[0],
        endDate: new Date(t.getFullYear(), t.getMonth() + 1, 0).toISOString().split('T')[0],
        positions: [], totalMonthlyHours: 0, status: 'active'
    });
    setIsEditing(false); setView('form');
  };

  // Nueva versión: copia los puestos del servicio origen, mes siguiente al endDate del origen
  const handleNewVersion = (srv: ServiceSLA) => {
    // Usar endDate del servicio como referencia; si no tiene, usar hoy
    const ref = srv.endDate ? new Date(srv.endDate + 'T00:00:00') : new Date();
    const nextMonthStart = new Date(ref.getFullYear(), ref.getMonth() + 1, 1).toISOString().split('T')[0];
    const nextMonthEnd = new Date(ref.getFullYear(), ref.getMonth() + 2, 0).toISOString().split('T')[0];
    setForm({
      ...srv,
      id: undefined as any,           // sin ID → crea nuevo documento
      startDate: nextMonthStart,
      endDate: nextMonthEnd,
      positions: (srv.positions || []).map(p => ({ ...p, id: Date.now().toString() + Math.random() })),
    });
    const client = clients.find(c => c.id === srv.clientId);
    const clientObjs = client?.objectives || [];
    const hasObj = clientObjs.some((o: any) => o.id === srv.objectiveId);
    setAvailableObjectives(hasObj ? clientObjs : [...clientObjs, { id: srv.objectiveId, name: srv.objectiveName }]);
    setIsEditing(false);
    setView('form');
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const clientId = e.target.value;
    const selectedClient = clients.find(c => c.id === clientId);
    if (selectedClient) {
        setForm(prev => ({ ...prev, clientId: selectedClient.id, clientName: selectedClient.name, objectiveId: '', objectiveName: '' }));
        setAvailableObjectives(selectedClient.objectives || []);
        return;
    }
    setForm(prev => ({ ...prev, clientId: '', clientName: '', objectiveId: '', objectiveName: '' }));
    setAvailableObjectives([]);
  };

  const handleObjectiveChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const objId = e.target.value;
      const selectedObj = availableObjectives.find(o => o.id === objId);
      if (selectedObj) {
        setForm(prev => ({ ...prev, objectiveId: selectedObj.id, objectiveName: selectedObj.name }));
        return;
      }
      setForm(prev => ({ ...prev, objectiveId: '', objectiveName: '' }));
  };

  const [kpiMonth, setKpiMonth] = useState(new Date().getMonth());
  const [kpiYear, setKpiYear]   = useState(new Date().getFullYear());
  const [srvSearch, setSrvSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [rfzTuraExtras, setRfzTuraExtras] = useState<any[]>([]);
  const [shiftModal, setShiftModal] = useState<{
    open: boolean;
    service: (ServiceSLA & { id: string }) | null;
  }>({ open: false, service: null });

  const toggleGroup = (key: string) =>
    setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  type SrvGroupItem = { key: string; clientName: string; objectiveName: string; services: (ServiceSLA & { id: string })[] };

  const groupedServices = useMemo((): SrvGroupItem[] => {
    const q = srvSearch.toLowerCase().trim();
    const filtered = (services as (ServiceSLA & { id: string })[]).filter(s =>
      !q || (s.clientName||'').toLowerCase().includes(q) || (s.objectiveName||'').toLowerCase().includes(q)
    );
    const map = new Map<string, (ServiceSLA & { id: string })[]>();
    filtered.forEach(s => {
      const key = s.objectiveId || `${s.clientId}_${s.objectiveName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      clientName: items[0].clientName || clientNameById.get(items[0].clientId) || 'Sin cliente',
      objectiveName: items[0].objectiveName || 'General',
      services: items.sort((a, b) => (b.startDate||'').localeCompare(a.startDate||'')),
    }));
  }, [services, srvSearch, clientNameById]);

  const kpiHistory = useMemo(() => {
    const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const result = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(kpiYear, kpiMonth - i, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const mStart = new Date(y, m, 1);
      const mEnd   = new Date(y, m + 1, 0);
      const sk = `${y}-${String(m + 1).padStart(2, '0')}`;
      let active = 0, hours = 0, positions = 0, guards = 0;
      services.forEach(srv => {
        if (!srv.startDate || !srv.endDate) return;
        const sStart = parseYmdToLocalDate((srv.startDate || '').trim().slice(0, 10));
        const sEnd = parseYmdToLocalDate((srv.endDate || '').trim().slice(0, 10));
        if (!sStart || !sEnd || sStart > mEnd || sEnd < mStart) return;
        active++;
        positions += (srv.positions || []).length;
        // Guardias = suma de ceil(hs_mensuales_por_puesto / 200) — guardias en rotación reales
        (srv.positions || []).forEach(p => {
          calculateMonthlyBreakdown([p], srv.startDate, srv.endDate, srv.excludedDates).forEach((mb) => {
            if (mb.monthKey === sk) {
              const pax = p.quantity || 1;
              const minRot = p.coverageType === '24hs' ? pax * 2 : pax;
              guards += Math.max(minRot, Math.ceil(mb.totalHours / 200));
            }
          });
        });
        calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate, srv.excludedDates).forEach((mb) => {
          if (mb.monthKey === sk) hours += mb.totalHours;
        });
      });
      result.push({ label: `${MONTHS[m]} ${y}`, short: MONTHS[m], year: y, month: m, isCurrent: i === 0, active, hours: Math.round(hours), positions, guards });
    }
    return result;
  }, [services, kpiYear, kpiMonth]);

  const kpiCurrent = kpiHistory[kpiHistory.length - 1] ?? { active: 0, hours: 0, positions: 0, guards: 0, label: '' };
  const kpiMaxHours = Math.max(...kpiHistory.map(m => m.hours), 1);

  const kpiPrevMonth = () => { if (kpiMonth === 0) { setKpiMonth(11); setKpiYear(y => y - 1); } else setKpiMonth(m => m - 1); };
  const kpiNextMonth = () => { if (kpiMonth === 11) { setKpiMonth(0);  setKpiYear(y => y + 1); } else setKpiMonth(m => m + 1); };

  const getServiceHoursForKpiMonth = useCallback(
    (srv: ServiceSLA & { id: string }) => {
      if (!srv.startDate || !srv.endDate || !srv.positions?.length) return 0;
      const y = kpiYear;
      const m = kpiMonth;
      const mStart = new Date(y, m, 1);
      const mEnd = new Date(y, m + 1, 0);
      const sStart = parseYmdToLocalDate((srv.startDate || '').trim().slice(0, 10));
      const sEnd = parseYmdToLocalDate((srv.endDate || '').trim().slice(0, 10));
      if (!sStart || !sEnd) return 0;
      if (sStart > mEnd || sEnd < mStart) return 0;
      const sk = `${y}-${String(m + 1).padStart(2, '0')}`;
      let hours = 0;
      calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate, srv.excludedDates).forEach((mb) => {
        if (mb.monthKey === sk) hours += mb.totalHours;
      });
      return Math.round(hours);
    },
    [kpiYear, kpiMonth],
  );

  const getResolvedSlaForMargin = useCallback(
    (srv: ServiceSLA & { id: string }) => {
      const kpiH = getServiceHoursForKpiMonth(srv);
      if (kpiH > 0) return { sla: kpiH, note: null as string | null };
      const bd = calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate, srv.excludedDates);
      if (!bd.length) {
        const stored = Math.round(Number(srv.totalMonthlyHours) || 0);
        if (stored > 0) {
          return {
            sla: stored,
            note: `Sin desglose por puestos/días: se usa totalMonthlyHours (${stored} h).`,
          };
        }
        return { sla: 0, note: null as string | null };
      }
      const peak = bd.reduce((b, x) => (x.totalHours > b.totalHours ? x : b), bd[0]);
      const peakH = Math.round(peak.totalHours);
      const monthNames = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
      ];
      const listLabel = `${monthNames[kpiMonth]} ${kpiYear}`;
      return {
        sla: peakH,
        note: `El mes del listado (${listLabel}) no tiene horas en este contrato. Se usa el mes pico ${peak.monthKey} (${peakH} h) para la comparativa.`,
      };
    },
    [getServiceHoursForKpiMonth, kpiMonth, kpiYear],
  );

  return (
    <DashboardLayout>
      {view === 'list' && (
        <div className="p-4 md:p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-600 rounded-xl"><Shield size={18} className="text-white"/></div>
              <div>
                <h1 className="text-lg font-black text-slate-800 dark:text-white uppercase">Servicios & SLA</h1>
                <p className="text-xs text-slate-400">Contratos, puestos y proyección de costos</p>
              </div>
            </div>
            <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase shadow-sm flex gap-2 items-center">
              <Plus size={14}/> Nuevo Servicio
            </button>
          </div>

          {/* Búsqueda */}
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              type="text"
              placeholder="Buscar cliente u objetivo..."
              value={srvSearch}
              onChange={e => setSrvSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-white placeholder-slate-400 outline-none focus:border-indigo-400"
            />
          </div>

          {/* KPIs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Métricas por mes</p>
              <div className="flex items-center gap-1.5">
                <button onClick={kpiPrevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-400 font-black text-sm transition-colors">‹</button>
                <span className="text-[11px] font-black text-slate-700 dark:text-white uppercase min-w-[100px] text-center tracking-wide">{kpiCurrent.label}</span>
                <button onClick={kpiNextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-400 font-black text-sm transition-colors">›</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {([
                { icon: Shield, color: '#4f46e5', label: 'Servicios activos', value: kpiCurrent.active, unit: '' },
                { icon: Clock,  color: '#059669', label: 'Horas del mes',      value: kpiCurrent.hours.toLocaleString('es-AR'), unit: 'hs' },
                { icon: Layers, color: '#d97706', label: 'Puestos',             value: kpiCurrent.positions, unit: '' },
                { icon: Users,  color: '#dc2626', label: 'Guardias',            value: kpiCurrent.guards, unit: '' },
              ] as const).map(({ icon: Icon, color, label, value, unit }) => (
                <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm px-4 pt-3.5 pb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded-lg shrink-0" style={{ background: color + '1a' }}>
                      <Icon size={13} color={color} strokeWidth={2.5} />
                    </div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-wide leading-tight">{label}</p>
                  </div>
                  <p className="text-2xl font-black text-slate-800 dark:text-white leading-none">
                    {value}{unit && <span className="text-xs font-bold text-slate-400 ml-1">{unit}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Contador */}
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
            {groupedServices.length} objetivo{groupedServices.length !== 1 ? 's' : ''}
            {srvSearch && ` · búsqueda: "${srvSearch}"`}
          </p>

          {/* Grid de grupos */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <RotateCw size={20} className="animate-spin mr-2"/> Cargando...
            </div>
          ) : groupedServices.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm font-bold">No se encontraron contratos.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {groupedServices.map(group => {
                const latestSrv = group.services[0];
                const hasActive = group.services.some(s => isSlaContractActive(s.status));
                const isExpanded = expandedGroups.has(group.key);
                return (
                  <div key={group.key} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                    {/* Accent */}
                    <div className={`h-1 w-full ${hasActive ? 'bg-indigo-600' : 'bg-slate-300'}`}/>
                    <div className="p-4">
                      {/* Cabecera */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase truncate">{group.clientName}</h3>
                          <p className="text-xs font-bold text-indigo-500 mt-0.5 flex items-center gap-1 truncate uppercase">
                            <MapPin size={10}/> {group.objectiveName}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${hasActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                            {hasActive ? 'Activo' : 'Inactivo'}
                          </span>
                          {group.services.length > 1 && (
                            <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                              {group.services.length} contratos
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Dotación del contrato más reciente */}
                      <div className="mb-3">
                        <p className="text-[9px] font-black uppercase text-slate-400 mb-1.5">Dotación</p>
                        <div className="flex flex-wrap gap-1.5">
                          {latestSrv.positions.length > 0
                            ? latestSrv.positions.map((p, idx) => (
                                <span key={idx} className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-md uppercase border border-indigo-100 dark:border-indigo-800 flex items-center gap-1">
                                  <Users size={9}/> {p.quantity}x {p.name}
                                </span>
                              ))
                            : <span className="text-[9px] text-slate-400">Sin definir</span>
                          }
                        </div>
                      </div>

                      {/* Contratos */}
                      <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
                        <button
                          onClick={() => toggleGroup(group.key)}
                          className="flex items-center justify-between w-full text-[9px] font-black uppercase text-slate-400 mb-2 hover:text-slate-600 transition-colors"
                        >
                          <span>Contratos</span>
                          <span className="text-slate-300">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                        <div className="space-y-2">
                          {(isExpanded ? group.services : group.services.slice(0,1)).map(srv => {
                            const total = serviceTotals.get(serviceSlaRowKey(srv)) ?? 0;
                            const slaR = getResolvedSlaForMargin(srv);
                            return (
                              <div key={srv.id} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-2.5">
                                <div className="flex items-center gap-2 mb-2">
                                  <Calendar size={10} className="text-slate-400 shrink-0"/>
                                  <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">{srv.startDate} → {srv.endDate}</span>
                                  <span className={`ml-auto text-[8px] font-black px-1.5 py-0.5 rounded-full ${isSlaContractActive(srv.status) ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
                                    {isSlaContractActive(srv.status) ? 'Activo' : 'Inactivo'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="flex flex-col min-w-0">
                                      <span className="text-base font-black text-indigo-600 dark:text-indigo-400 tabular-nums leading-tight">
                                        {slaR.sla}
                                        <span className="text-[9px] font-bold ml-0.5">h</span>
                                        <span className="text-[8px] font-black text-slate-400 uppercase ml-1">SLA sim.</span>
                                      </span>
                                      {slaR.note && (
                                        <span className="text-[8px] font-black text-amber-600" title={slaR.note}>
                                          {' '}*
                                        </span>
                                      )}
                                      <span className="text-[8px] font-bold text-slate-400 tabular-nums truncate" title="Horas acumuladas en todo el contrato">
                                        Total contrato: {total} h
                                      </span>
                                    </div>
                                    {(() => {
                                      const shiftAdvice = analyzeShiftSchemesForService(srv);
                                      return (
                                        <ServiceShiftSchemeIcon
                                          hasIssues={
                                            shiftAdvice.issues.length > 0 || shiftAdvice.soldShiftAnalyses.length > 0
                                          }
                                          complexityScore={shiftAdvice.coverComplexity.score}
                                          onOpen={() =>
                                            setShiftModal({
                                              open: true,
                                              service: srv,
                                            })
                                          }
                                        />
                                      );
                                    })()}
                                  </div>
                                  <div className="flex gap-1 shrink-0">
                                    <button onClick={() => { handleNewVersion(srv); }} title="Nueva versión" className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors">
                                      <Copy size={11}/>
                                    </button>
                                    <button onClick={() => { handleEdit(srv); }} title="Editar" className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                                      <Edit2 size={11}/>
                                    </button>
                                    <button onClick={() => { srv.id && handleDelete(srv.id); }} title="Eliminar" className="p-1.5 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 transition-colors">
                                      <Trash2 size={11}/>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {!isExpanded && group.services.length > 1 && (
                            <button onClick={() => toggleGroup(group.key)} className="w-full text-[9px] font-black text-indigo-500 hover:text-indigo-700 uppercase py-1 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg transition-colors">
                              + {group.services.length - 1} contrato{group.services.length - 1 !== 1 ? 's' : ''} anterior{group.services.length - 1 !== 1 ? 'es' : ''}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* ── Refuerzos del mes (RFZ/TURA) integrados al servicio ── */}
                      {(() => {
                        const groupExtras = rfzTuraExtras.filter(t => {
                          if (!t.fecha) return false;
                          const [yy, mm] = String(t.fecha).split('-').map(Number);
                          if (yy !== kpiYear || mm !== kpiMonth + 1) return false;
                          return t.objectiveId === group.key
                            || group.services.some(s => s.objectiveId === t.objectiveId)
                            || (!!group.objectiveName && t.objectiveName === group.objectiveName);
                        });
                        if (groupExtras.length === 0) return null;
                        const extraHrs = groupExtras.reduce((a, t) => a + (t.hours || 8), 0);
                        const baseHrs = group.services.reduce((a, s) => a + getServiceHoursForKpiMonth(s), 0);
                        return (
                          <div className="mt-3 border-t border-dashed border-red-200 dark:border-red-900/40 pt-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[9px] font-black uppercase text-red-500 tracking-widest flex items-center gap-1">
                                <AlertCircle size={10}/> Refuerzos del mes · {kpiCurrent.label}
                              </span>
                              <span className="text-[9px] font-black bg-red-50 text-red-600 px-2 py-0.5 rounded-lg border border-red-200">
                                {groupExtras.length} turno{groupExtras.length !== 1 ? 's' : ''} · +{extraHrs} h
                              </span>
                            </div>
                            <div className="space-y-1 mb-2">
                              {groupExtras.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map(t => (
                                <div key={t.id} className="flex items-center gap-2 text-[10px]">
                                  <span className={`shrink-0 font-black px-1 py-0.5 rounded ${t.code === 'TURA' ? 'bg-red-600 text-white' : 'bg-red-500 text-white'}`}>{t.code}</span>
                                  <span className="font-bold text-slate-600 dark:text-slate-300 w-16 shrink-0">{t.fecha}</span>
                                  <span className="text-slate-500 dark:text-slate-400 flex-1 truncate">{t.positionName || t.employeeName || 'Sin asignar'}</span>
                                  <span className={`shrink-0 font-bold ${t.employeeId && t.employeeId !== 'VACANTE' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {t.employeeId && t.employeeId !== 'VACANTE' ? 'Asignado' : 'Vacante'}
                                  </span>
                                  <span className="shrink-0 font-black text-red-500">{t.hours || 8}h</span>
                                </div>
                              ))}
                            </div>
                            {baseHrs > 0 && (
                              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-1.5">
                                <span className="text-[9px] font-black uppercase text-slate-500">SLA del mes c/ refuerzos</span>
                                <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 tabular-nums">
                                  {baseHrs} + {extraHrs} = {baseHrs + extraHrs} h
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <ServiceShiftSchemeModal
            open={shiftModal.open}
            onClose={() => setShiftModal({ open: false, service: null })}
            service={shiftModal.service}
          />
        </div>
      )}

      {/* keep-import:ModuleShell */}
      {false && (
        <ModuleShell title="" subtitle="" items={[]} icon={Shield} searchFn={() => true} topContent={
            <div className="space-y-3">
              {/* Nav de mes */}
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Métricas por mes</p>
                <div className="flex items-center gap-1.5">
                  <button onClick={kpiPrevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-400 font-black text-sm transition-colors">‹</button>
                  <span className="text-[11px] font-black text-slate-700 dark:text-white uppercase min-w-[100px] text-center tracking-wide">{kpiCurrent.label}</span>
                  <button onClick={kpiNextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-400 font-black text-sm transition-colors">›</button>
                </div>
              </div>

              {/* 4 KPI cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {([
                  { icon: Shield, color: '#4f46e5', label: 'Servicios activos', value: kpiCurrent.active, unit: '' },
                  { icon: Clock,  color: '#059669', label: 'Horas del mes',      value: kpiCurrent.hours.toLocaleString('es-AR'), unit: 'hs' },
                  { icon: Layers, color: '#d97706', label: 'Puestos',             value: kpiCurrent.positions, unit: '' },
                  { icon: Users,  color: '#dc2626', label: 'Guardias',            value: kpiCurrent.guards, unit: '' },
                ] as const).map(({ icon: Icon, color, label, value, unit }) => (
                  <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm px-4 pt-3.5 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-lg shrink-0" style={{ background: color + '1a' }}>
                        <Icon size={13} color={color} strokeWidth={2.5} />
                      </div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wide leading-tight">{label}</p>
                    </div>
                    <p className="text-2xl font-black text-slate-800 dark:text-white leading-none">
                      {value}{unit && <span className="text-xs font-bold text-slate-400 ml-1">{unit}</span>}
                    </p>
                  </div>
                ))}
              </div>

              {/* Histórico · timeline horizontal */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm px-6 py-4 overflow-hidden">
                <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-5">Histórico · últimos 5 meses</p>
                <div className="relative">
                  {/* Línea conectora */}
                  <div className="absolute left-[10%] right-[10%] top-[calc(1.5rem+0.5px)] h-0.5 bg-slate-200 dark:bg-slate-700" />
                  {/* Nodos */}
                  <div className="flex justify-between items-start">
                    {kpiHistory.map(m => (
                      <div key={m.label} className="flex flex-col items-center gap-2 flex-1">
                        {/* Etiqueta del mes encima */}
                        <span className={`text-[9px] font-black uppercase tracking-wide leading-none ${m.isCurrent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}>
                          {m.short}{m.year !== kpiYear ? ` '${String(m.year).slice(2)}` : ''}
                        </span>
                        {/* Círculo nodo */}
                        <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all shadow-sm
                          ${m.isCurrent
                            ? 'bg-indigo-600 border-indigo-600 shadow-indigo-400/30 shadow-lg'
                            : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600'
                          }`}>
                          <Clock size={15} className={m.isCurrent ? 'text-white' : 'text-slate-300 dark:text-slate-500'} />
                        </div>
                        {/* Info debajo */}
                        <div className="text-center space-y-0.5">
                          <p className={`text-sm font-black leading-tight ${m.isCurrent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-300 dark:text-slate-600'}`}>
                            {m.hours > 0 ? m.hours.toLocaleString('es-AR') : '—'}
                            {m.hours > 0 && <span className="text-[9px] font-bold ml-0.5">hs</span>}
                          </p>
                          <p className={`text-[9px] font-bold ${m.isCurrent ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'}`}>
                            {m.guards > 0 ? `${m.guards} G` : '—'}
                          </p>
                          <p className={`text-[9px] font-bold ${m.isCurrent ? 'text-slate-400 dark:text-slate-500' : 'text-slate-200 dark:text-slate-700'}`}>
                            {m.active > 0 ? `${m.active} srv` : '—'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          }
          accentFn={s => isSlaContractActive(s.status) ? 'bg-indigo-700' : 'bg-slate-300'}
          renderCardSummary={srv => {
            const total = serviceTotals.get(serviceSlaRowKey(srv)) ?? 0;
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase truncate">{srv.clientName || 'Sin Cliente'}</h3>
                    <p className="text-xs font-bold text-indigo-500 mt-0.5 flex items-center gap-1 truncate uppercase"><MapPin size={10}/> {srv.objectiveName || 'General'}</p>
                  </div>
                  <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${isSlaContractActive(srv.status) ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-400'}`}>
                    {isSlaContractActive(srv.status) ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="mt-3">
                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1.5">Dotación</p>
                  <div className="flex flex-wrap gap-1.5">
                    {srv.positions.length > 0 ? srv.positions.map((p, idx) => (
                      <span key={idx} className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-md uppercase border border-indigo-100 dark:border-indigo-800 flex items-center gap-1">
                        <Users size={9}/> {p.quantity}x {p.name}
                      </span>
                    )) : <span className="text-[9px] text-slate-400">Sin definir</span>}
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between border-t border-slate-100 dark:border-slate-700 pt-3">
                  <span className="text-[9px] font-black uppercase text-slate-400">Total mensual</span>
                  <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">{total} <span className="text-xs font-bold">hs</span></span>
                </div>
              </>
            );
          }}
          renderRowSummary={srv => {
            const total = serviceTotals.get(serviceSlaRowKey(srv)) ?? 0;
            return (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <span className="font-black text-xs text-slate-800 dark:text-white uppercase">{srv.clientName || 'Sin Cliente'}</span>
                  <span className="text-slate-300 dark:text-slate-600 mx-2">·</span>
                  <span className="text-xs font-bold text-indigo-500 uppercase"><MapPin size={9} className="inline mr-0.5"/>{srv.objectiveName || 'General'}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-[10px] text-slate-400 font-bold">{srv.positions.length} puestos</span>
                  <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">{total} hs</span>
                </div>
              </div>
            );
          }}
          renderExpanded={(srv, close) => {
            const total = serviceTotals.get(serviceSlaRowKey(srv)) ?? 0;
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <Calendar size={13} className="text-slate-400"/>
                  <span className="font-bold font-mono">{srv.startDate}</span>
                  <span className="text-slate-300 dark:text-slate-600">→</span>
                  <span className="font-bold font-mono">{srv.endDate}</span>
                  <span className="ml-auto text-base font-black text-indigo-600 dark:text-indigo-400">{total} hs totales</span>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Dotación Operativa</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {srv.positions.length === 0 && <p className="text-xs text-slate-400 col-span-3">Sin puestos definidos.</p>}
                    {srv.positions.map(pos => (
                      <div key={pos.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700 shadow-sm">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="font-black text-xs text-slate-800 dark:text-white uppercase">{pos.name}</span>
                          <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300 px-1.5 py-0.5 rounded text-[8px] font-black">{pos.quantity} PAX</span>
                          <span className="text-[8px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 rounded">{pos.coverageType === '24hs' ? '24 HS' : pos.coverageType.toUpperCase()}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {pos.allowedShiftTypes.map(v => (
                            <span key={v.code} className="text-[8px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">{v.code} · {v.hours}h</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Análisis Operativo */}
                {srv.positions.length > 0 && (() => {
                  const viabilityBase = srv.positions.map(pos => {
                    const bd = calculateMonthlyBreakdown([pos], srv.startDate, srv.endDate, srv.excludedDates);
                    const avgH = bd.length > 0 ? bd.reduce((a, m) => a + m.totalHours, 0) / bd.length : 0;
                    return { pos, avgH: Math.round(avgH) };
                  });
                  const totalHrsAll = viabilityBase.reduce((a, v) => a + v.avgH, 0);
                  const totalGuards = Math.ceil(totalHrsAll / 192);
                  const viability = viabilityBase.map(({ pos, avgH }) => {
                    const propGuards = totalHrsAll > 0 ? (avgH / totalHrsAll) * totalGuards : 0;
                    const hxg = propGuards > 0 ? avgH / propGuards : 0;
                    return { pos, avgH, propGuards, hxg };
                  });
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">Análisis Operativo</p>
                        <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2.5 py-1 rounded-lg">
                          {totalGuards} guardias en rotación
                        </span>
                      </div>
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800/80">
                            <tr className="text-[9px] font-black uppercase text-slate-400">
                              <th className="text-left px-3 py-2">Puesto</th>
                              <th className="text-center px-3 py-2">Cobertura</th>
                              <th className="text-center px-3 py-2">PAX simult.</th>
                              <th className="text-center px-3 py-2">Hs prom./mes</th>
                              <th className="text-center px-3 py-2">G. rotación</th>
                              <th className="text-center px-3 py-2">Hs/guardia</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {viability.map(({ pos, avgH, propGuards, hxg }) => (
                              <tr key={pos.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                <td className="px-3 py-2 font-bold text-slate-700 dark:text-white">{pos.name}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded">
                                    {pos.coverageType === '24hs' ? '24 HS' : pos.coverageType.toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center font-bold text-slate-500">{pos.quantity}</td>
                                <td className="px-3 py-2 text-center font-bold text-slate-600 dark:text-slate-300">
                                  {avgH} <span className="text-slate-400 text-[9px]">hs</span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="text-base font-black text-indigo-600 dark:text-indigo-400">{propGuards.toFixed(2)}</span>
                                </td>
                                <td className="px-3 py-2 text-center text-slate-500">
                                  {Math.round(hxg)} <span className="text-[9px]">hs</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {viability.length > 1 && (
                            <tfoot className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
                              <tr>
                                <td colSpan={4} className="px-3 py-2 text-[9px] font-black uppercase text-slate-400 text-right">Total</td>
                                <td className="px-3 py-2 text-center text-indigo-600 dark:text-indigo-400 text-base font-black">{totalGuards}</td>
                                <td></td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <button onClick={() => { handleNewVersion(srv); close(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-black text-xs uppercase hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
                    <Copy size={13}/> Nueva versión
                  </button>
                  <button onClick={() => { handleEdit(srv); close(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-black text-xs uppercase hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors">
                    <Edit2 size={13}/> Editar
                  </button>
                  <button onClick={() => { srv.id && handleDelete(srv.id); close(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-black text-xs uppercase hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors">
                    <Trash2 size={13}/> Eliminar
                  </button>
                </div>
              </div>
            );
          }}
        />
      )}

      {view === 'form' && (
        <PageShell>
          <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader
              title="Servicios & SLA"
              subtitle="Contratos, puestos y proyección de costos"
              icon={Shield}
            />
            {externalChange && (
              <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-xl px-5 py-3 mb-4">
                <AlertCircle size={16} className="text-amber-600 shrink-0"/>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400 flex-1">
                  Otro usuario modificó este servicio. Tus cambios no guardados pueden sobreescribir los suyos.
                </p>
                <button
                  onClick={() => {
                    const srv = services.find(s => s.id === form.id);
                    if (srv) {
                      setForm({ ...srv, positions: (srv.positions || []).map(p => ({ ...p, allowedShiftTypes: (p.allowedShiftTypes || []).map(s => ({ ...s })) })) });
                      const client = clients.find(c => c.id === srv.clientId);
                      if (client) setAvailableObjectives(client.objectives || []);
                    }
                    setExternalChange(false);
                  }}
                  className="flex items-center gap-1.5 bg-amber-600 text-white px-4 py-1.5 rounded-xl font-black text-xs uppercase hover:bg-amber-700 transition-colors shrink-0"
                >
                  <RotateCw size={12}/> Recargar
                </button>
              </div>
            )}
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[3rem] border dark:border-slate-700 shadow-sm">
            <div className="flex justify-between items-start mb-8">
               <div><h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase">{isEditing ? 'Editar' : 'Nuevo'} Contrato</h2><p className="text-slate-400 text-xs mt-1">Definición de SLA y Costos Laborales (SUVICO).</p></div>
               <div className="text-right">
                   <div className="text-4xl font-black text-indigo-600 dark:text-indigo-400">{totalContractHours} <span className="text-sm text-indigo-300 font-bold">hs</span></div>
                   <div className="flex justify-end gap-2 mt-2">
                       <span className="text-[9px] font-bold text-indigo-400 bg-indigo-50 px-2 rounded flex items-center gap-1"><Moon size={10}/> {totalNightHours}h Noc</span>
                       <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-2 rounded flex items-center gap-1"><Sun size={10}/> {totalWeekendHours}h Finde</span>
                   </div>
                   <p className="text-[8px] text-slate-400 text-right mt-1">*Cálculo nocturno: 21:00 a 06:00 (CCT 422/05)</p>
               </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
               <div className="space-y-6">
                 <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Cliente</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold text-sm dark:text-white" value={form.clientId} onChange={handleClientChange}><option value="">Seleccionar...</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                 <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Objetivo</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold text-sm dark:text-white" value={form.objectiveId} onChange={handleObjectiveChange} disabled={!form.clientId}><option value="">Seleccionar...</option>{availableObjectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Inicio</label><input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold text-xs dark:text-white" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div>
                     <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Fin</label><input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold text-xs dark:text-white" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div>
                 </div>

                 {/* Días excluidos — por puesto o para todos */}
                 {(() => {
                     const WD_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                     const posNames = form.positions.map(p => p.name || p.id);
                     // Scope actual: 'ALL' = nivel SLA, o positionName = nivel puesto
                     const isAll = excludedDatesScope === 'ALL';
                     const scopePosIdx = isAll ? -1 : form.positions.findIndex(p => (p.name || p.id) === excludedDatesScope);
                     // Exclusiones activas para el scope seleccionado
                     const activeDates = isAll
                         ? new Set(form.excludedDates || [])
                         : new Set(scopePosIdx >= 0 ? (form.positions[scopePosIdx]?.excludedDates || []) : []);
                     // Exclusiones a nivel SLA (siempre marcadas, independiente del scope)
                     const slaGlobal = new Set(form.excludedDates || []);

                     const toggleDate = (ds: string) => {
                         if (isAll) {
                             const next = new Set(slaGlobal);
                             if (next.has(ds)) next.delete(ds); else next.add(ds);
                             setForm({ ...form, excludedDates: Array.from(next).sort() });
                         } else if (scopePosIdx >= 0) {
                             const nextPositions = form.positions.map((p, i) => {
                                 if (i !== scopePosIdx) return p;
                                 const cur = new Set(p.excludedDates || []);
                                 if (cur.has(ds)) cur.delete(ds); else cur.add(ds);
                                 return { ...p, excludedDates: Array.from(cur).sort() };
                             });
                             setForm({ ...form, positions: nextPositions });
                         }
                     };
                     const clearScope = () => {
                         if (isAll) {
                             setForm({ ...form, excludedDates: [] });
                         } else if (scopePosIdx >= 0) {
                             const nextPositions = form.positions.map((p, i) =>
                                 i === scopePosIdx ? { ...p, excludedDates: [] } : p
                             );
                             setForm({ ...form, positions: nextPositions });
                         }
                     };

                     // Total excluidos en todos los scopes
                     const totalExcluded = slaGlobal.size + form.positions.reduce(
                         (acc, p) => acc + (p.excludedDates?.length || 0), 0
                     );

                     // Generar meses
                     const months: Array<{ year: number; month: number; label: string; days: Array<{ date: Date; ds: string }> }> = [];
                     const start = parseYmdToLocalDate(form.startDate);
                     const end = parseYmdToLocalDate(form.endDate);
                     if (start && end) {
                         let cur = new Date(start.getFullYear(), start.getMonth(), 1);
                         const endMo = new Date(end.getFullYear(), end.getMonth(), 1);
                         while (cur <= endMo) {
                             const y = cur.getFullYear(); const m = cur.getMonth();
                             const label = cur.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
                             const days: Array<{ date: Date; ds: string }> = [];
                             const daysInMo = new Date(y, m + 1, 0).getDate();
                             for (let d = 1; d <= daysInMo; d++) {
                                 const date = new Date(y, m, d);
                                 if (date < start || date > end) { days.push({ date, ds: '' }); continue; }
                                 const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                                 days.push({ date, ds });
                             }
                             months.push({ year: y, month: m, label, days });
                             cur.setMonth(cur.getMonth() + 1);
                         }
                     }

                     const makeSummary = (dates: Set<string>) => {
                         const countByWd: Record<number, number> = {};
                         dates.forEach(ds => {
                             if (!ds) return;
                             const [y, m, d] = ds.split('-').map(Number);
                             countByWd[new Date(y, m - 1, d).getDay()] = (countByWd[new Date(y, m - 1, d).getDay()] || 0) + 1;
                         });
                         return Object.entries(countByWd).sort(([a],[b]) => +a - +b)
                             .map(([wd, cnt]) => `${cnt} ${WD_NAMES[+wd].toLowerCase()}${cnt > 1 ? 's' : ''}`).join(', ');
                     };

                     return (
                         <div className="rounded-xl border dark:border-slate-700 overflow-hidden">
                             <button type="button" onClick={() => setShowExcludedDatesPicker(p => !p)}
                                 className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                 <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                     <span className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-black ${totalExcluded > 0 ? 'bg-rose-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}`}>{totalExcluded}</span>
                                     Días excluidos
                                 </span>
                                 <span className="text-slate-400 text-xs">{showExcludedDatesPicker ? '▲' : '▼'}</span>
                             </button>
                             {totalExcluded > 0 && !showExcludedDatesPicker && (
                                 <div className="px-4 py-2 bg-rose-50 dark:bg-rose-950/20 border-t border-rose-100 dark:border-rose-900 space-y-0.5">
                                     {slaGlobal.size > 0 && <p className="text-[9px] font-bold text-rose-600 dark:text-rose-400">Todos los puestos: {makeSummary(slaGlobal)}</p>}
                                     {form.positions.map(p => (p.excludedDates?.length ?? 0) > 0 && (
                                         <p key={p.id} className="text-[9px] font-bold text-rose-500 dark:text-rose-400">{p.name || p.id}: {makeSummary(new Set(p.excludedDates))}</p>
                                     ))}
                                 </div>
                             )}
                             {showExcludedDatesPicker && (
                                 <div className="border-t dark:border-slate-700">
                                     {/* Selector de scope */}
                                     <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 flex items-center gap-2 flex-wrap border-b dark:border-slate-700">
                                         <span className="text-[9px] font-black uppercase text-slate-400">Aplica a:</span>
                                         {(['ALL', ...posNames] as string[]).map(scope => (
                                             <button key={scope} type="button"
                                                 onClick={() => setExcludedDatesScope(scope)}
                                                 className={`px-2 py-0.5 rounded text-[9px] font-black border transition-colors ${excludedDatesScope === scope ? 'bg-rose-500 border-rose-500 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-rose-400'}`}>
                                                 {scope === 'ALL' ? 'Todos los puestos' : scope}
                                             </button>
                                         ))}
                                     </div>
                                     {months.length > 0 ? (
                                         <div className="p-4 bg-white dark:bg-slate-900 space-y-4">
                                             {months.map(({ year, month, label, days }) => {
                                                 const firstDow = new Date(year, month, 1).getDay();
                                                 const padded = Array(firstDow === 0 ? 6 : firstDow - 1).fill(null).concat(days);
                                                 return (
                                                     <div key={`${year}-${month}`}>
                                                         <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-2">{label}</p>
                                                         <div className="grid grid-cols-7 gap-0.5">
                                                             {['L','M','X','J','V','S','D'].map(h => <span key={h} className="text-center text-[8px] font-black text-slate-400 py-0.5">{h}</span>)}
                                                             {padded.map((cell, i) => {
                                                                 if (!cell) return <span key={`pad-${i}`}/>;
                                                                 const { date, ds } = cell;
                                                                 if (!ds) return <span key={`out-${i}`} className="text-center text-[9px] text-slate-200 dark:text-slate-700 py-1">{date.getDate()}</span>;
                                                                 const isActive = activeDates.has(ds);
                                                                 const isGlobal = !isAll && slaGlobal.has(ds); // excluido para todos
                                                                 const isWe = date.getDay() === 0 || date.getDay() === 6;
                                                                 return (
                                                                     <button key={ds} type="button" title={isGlobal ? 'Excluido para todos los puestos' : ds}
                                                                         onClick={() => !isGlobal && toggleDate(ds)}
                                                                         className={`text-center text-[9px] font-bold py-1 rounded transition-colors leading-none
                                                                             ${isActive || isGlobal
                                                                                 ? isGlobal ? 'bg-rose-300 dark:bg-rose-800 text-white cursor-not-allowed' : 'bg-rose-500 text-white'
                                                                                 : isWe ? 'text-amber-600 dark:text-amber-400 hover:bg-rose-50' : 'text-slate-700 dark:text-slate-300 hover:bg-rose-50'
                                                                             }`}
                                                                     >{date.getDate()}</button>
                                                                 );
                                                             })}
                                                         </div>
                                                     </div>
                                                 );
                                             })}
                                             {activeDates.size > 0 && (
                                                 <div className="flex items-center justify-between pt-2 border-t dark:border-slate-700">
                                                     <p className="text-[9px] font-bold text-rose-600 dark:text-rose-400">{makeSummary(activeDates)}</p>
                                                     <button type="button" onClick={clearScope} className="text-[9px] font-black text-rose-400 hover:text-rose-600 uppercase">Limpiar</button>
                                                 </div>
                                             )}
                                         </div>
                                     ) : (
                                         <p className="px-4 py-3 text-[10px] text-slate-400">Completá las fechas del contrato primero.</p>
                                     )}
                                 </div>
                             )}
                         </div>
                     );
                 })()}

                 <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border dark:border-slate-700/50">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-2"><Table size={12}/> Proyección de Costos</h4>
                      <button onClick={() => handleNewVersion(form)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 shadow-md transition-colors"><Plus size={11}/> Nuevo Servicio</button>
                    </div>
                    <div className="max-h-52 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                        {combinedMonthlyBreakdown.length === 0 && (
                          <p className="text-[10px] text-slate-400 text-center py-4">Completá fechas y puestos para ver la proyección</p>
                        )}
                        {combinedMonthlyBreakdown.map((m) => (
                            <div
                              key={m.sortKey}
                              onClick={() => {
                                if (!m.isCurrent && m.serviceId) {
                                  const srv = services.find(s => s.id === m.serviceId);
                                  if (srv) handleEdit(srv);
                                }
                              }}
                              className={`flex justify-between items-center p-2 rounded-xl border transition-colors ${m.isCurrent ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-700' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 opacity-60 hover:opacity-100 hover:border-indigo-300 cursor-pointer'}`}
                            >
                                <div className="flex items-center gap-2">
                                  {!m.isCurrent && <span className="text-[7px] font-black uppercase text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-700">editar</span>}
                                  <div><span className={`text-[10px] font-bold uppercase block ${m.isCurrent ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>{m.name}</span><span className="text-[8px] text-slate-400">{m.days} días</span></div>
                                </div>
                                <div className="text-right">
                                  <span className={`block text-xs font-black ${m.isCurrent ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>{Math.round(m.totalHours)} hs</span>
                                  <div className="flex gap-2 justify-end"><span className="text-[8px] text-slate-400 font-bold" title="Nocturnas">{Math.round(m.nightHours)}N</span><span className="text-[8px] text-amber-500/70 font-bold" title="Fin de semana">{Math.round(m.weekendHours)}F</span></div>
                                </div>
                            </div>
                        ))}
                    </div>
                 </div>
               </div>

               <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-xl border dark:border-slate-700/50">
                  <div className="flex justify-between items-center mb-6">
                     <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2"><Briefcase size={18} className="text-indigo-500"/> Estructura Operativa</h3>
                     <button onClick={openAddPositionModal} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 shadow-md transition-colors"><Plus size={11}/> Agregar Puesto</button>
                  </div>
                  <div className="space-y-3">
                     {form.positions.map((pos) => (
                        <div key={pos.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border dark:border-slate-700 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                           <div className="flex-1 text-left">
                              <div className="flex items-center gap-3"><h4 className="font-bold text-slate-800 dark:text-white text-sm uppercase">{pos.name}</h4><span className="bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-300 px-2 py-0.5 rounded text-[9px] font-black uppercase">{pos.quantity} PAX</span></div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/50 px-2 rounded">{pos.coverageType === '24hs' ? '24 HS' : pos.coverageType.toUpperCase()}</span>
                                {pos.preferenciaGenero === 'M' && <span className="text-[10px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded" title="Solo masculino">♂ M</span>}
                                {pos.preferenciaGenero === 'F' && <span className="text-[10px] font-black text-pink-700 bg-pink-100 px-2 py-0.5 rounded" title="Solo femenino">♀ F</span>}
                                <span className="text-[10px] font-black text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800" title="Horas de cobertura por día (un puesto). Rango si cambia según el día de la semana.">
                                  {formatPositionDailyCoverageLabel(pos)}
                                </span>
                              </div>
                           </div>
                           <div className="flex gap-1 flex-wrap justify-end max-w-xs items-center">
                             {pos.code && <div className="text-center bg-indigo-100 dark:bg-indigo-900/40 px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-700"><div className="text-[9px] font-black text-indigo-700 dark:text-indigo-300">{pos.code}</div><div className="text-[7px] text-indigo-400">sigla</div></div>}
                             {pos.allowedShiftTypes.map(v => (<div key={v.code} className="text-center bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-lg border dark:border-slate-600"><div className="text-[9px] font-black text-slate-600 dark:text-slate-300">{v.code}</div><div className="text-[7px] text-slate-400">{v.hours}h</div></div>))}
                           </div>
                           <div className="flex gap-1">
                             <button onClick={() => {
                               setEditingShiftCode(null);
                               const clones = pos.allowedShiftTypes.map((s) => ({ ...s }));
                               const nextAllowed =
                                 pos.coverageType === '24hs'
                                   ? rebuild24hsVariants(
                                       clones.find((s) => s.code === 'M')?.startTime?.slice(0, 5) || '07:00',
                                       clones.find((s) => s.code === 'D12')?.startTime?.slice(0, 5) || '07:00'
                                     )
                                   : clones;
                               setPositionForm({ ...pos, allowedShiftTypes: nextAllowed });
                               setShowPositionModal(true);
                             }} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-indigo-500 hover:bg-indigo-100 transition-colors"><Edit2 size={14}/></button>
                             <button onClick={() => removePosition(pos.id)} className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-rose-500 hover:bg-rose-100 transition-colors"><X size={14}/></button>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
            <div className="mt-8 flex justify-end gap-4 border-t dark:border-slate-700 pt-6"><button onClick={() => setView('list')} className="text-slate-400 font-bold uppercase text-xs hover:text-slate-600 transition-colors">Cancelar</button><button onClick={handleSave} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-8 py-3 rounded-xl font-black uppercase text-xs shadow-sm transition-transform active:scale-95"><Save size={16} className="mr-2 inline"/> Guardar</button></div>
            </div>
          </div>
        </PageShell>
      )}

      {showPositionModal && (
           <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 w-full max-w-lg p-8 rounded-[3rem] animate-in zoom-in-95 shadow-2xl border dark:border-slate-600 max-h-[90vh] overflow-y-auto custom-scrollbar">
                 <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase mb-6 flex items-center gap-2"><Settings className="text-indigo-500"/> Definir Puesto</h3>
                 <div className="space-y-5">
                    <div className="grid grid-cols-4 gap-3">
                        <div className="col-span-2"><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Nombre del puesto</label><input className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold dark:text-white" value={positionForm.name} onChange={e => setPositionForm({...positionForm, name: e.target.value})}/></div>
                        <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Sigla <span className="text-indigo-400">(planif.)</span></label><input maxLength={4} className="w-full p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl font-black text-center text-indigo-700 dark:text-indigo-300 uppercase" placeholder="P1" value={positionForm.code || ''} onChange={e => setPositionForm({...positionForm, code: e.target.value.toUpperCase().slice(0,4)})}/></div>
                        <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Pax</label><input type="number" min="1" className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold text-center dark:text-white" value={positionForm.quantity} onChange={e => setPositionForm({...positionForm, quantity: parseInt(e.target.value) || 1})}/></div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1 mb-1 block">Días operativos</label>
                        <div className="flex gap-1">
                            {['L','M','X','J','V','S','D'].map(day => {
                                const active = (positionForm.activeDays || ['L','M','X','J','V','S','D']).includes(day);
                                return (
                                    <button key={day} type="button"
                                        onClick={() => {
                                            const cur = positionForm.activeDays || ['L','M','X','J','V','S','D'];
                                            const next = active ? cur.filter(d => d !== day) : [...cur, day];
                                            // Mantener orden canónico
                                            const ordered = ['L','M','X','J','V','S','D'].filter(d => next.includes(d));
                                            setPositionForm({...positionForm, activeDays: ordered});
                                        }}
                                        className={`w-9 h-9 rounded-lg text-[11px] font-black transition-colors border ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-600'}`}
                                    >{day}</button>
                                );
                            })}
                        </div>
                        <p className="text-[9px] text-slate-400 font-bold mt-1">
                            {(() => {
                                const days = positionForm.activeDays || ['L','M','X','J','V','S','D'];
                                if (days.length === 7) return 'Todos los días (incluye S/D → usa ciclo 6+1 con franco rotativo)';
                                if (days.length === 5 && !days.includes('S') && !days.includes('D')) return 'Lunes a viernes → francos automáticos en S/D';
                                return `${days.length} días/semana → Franco en días no seleccionados`;
                            })()}
                        </p>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tipo de Cobertura</label>
                        <select className="w-full p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl font-bold text-indigo-700 dark:text-indigo-300" value={positionForm.coverageType} onChange={handleCoverageTypeChange}>
                            <option value="24hs">24 HORAS (Lunes a Lunes)</option>
                            <option value="12hs_diurno">12 HORAS DIURNO</option>
                            <option value="12hs_nocturno">12 HORAS NOCTURNO</option>
                            <option value="custom">PERSONALIZADO / TURNOS ESPECÍFICOS</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Género requerido en el puesto</label>
                        <select className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl font-bold dark:text-white" value={positionForm.preferenciaGenero || 'INDISTINTO'} onChange={e => setPositionForm({ ...positionForm, preferenciaGenero: e.target.value as ServicePosition['preferenciaGenero'] })}>
                            <option value="INDISTINTO">Indistinto</option>
                            <option value="M">Solo masculino</option>
                            <option value="F">Solo femenino</option>
                        </select>
                    </div>

                    {positionForm.coverageType === '24hs' && (
                        <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-800 rounded-xl p-4 space-y-3">
                            <p className="text-[9px] font-black uppercase text-sky-600 dark:text-sky-400">Horarios base (24 h)</p>
                            <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-snug">
                                Definí el inicio del turno M (cada bloque 8 h): se calculan T y N en cadena. Definí el inicio de D12 (12 h): N12 completa las 24 h. Los ciclos 8+8+8 y 12+12 son independientes (dos modelos de planificación).
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 ml-0.5 block mb-1">Inicio M → T → N</label>
                                    <input
                                        type="time"
                                        className="w-full p-2.5 bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-xl font-bold text-sm text-slate-800 dark:text-white"
                                        value={positionForm.allowedShiftTypes.find((s) => s.code === 'M')?.startTime?.slice(0, 5) || '07:00'}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) return;
                                            setPositionForm((prev) => {
                                                if (prev.coverageType !== '24hs') return prev;
                                                const d12 = prev.allowedShiftTypes.find((s) => s.code === 'D12')?.startTime?.slice(0, 5) || '07:00';
                                                return { ...prev, allowedShiftTypes: rebuild24hsVariants(v, d12) };
                                            });
                                        }}
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 ml-0.5 block mb-1">Inicio D12 → N12</label>
                                    <input
                                        type="time"
                                        className="w-full p-2.5 bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-800 rounded-xl font-bold text-sm text-slate-800 dark:text-white"
                                        value={positionForm.allowedShiftTypes.find((s) => s.code === 'D12')?.startTime?.slice(0, 5) || '07:00'}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) return;
                                            setPositionForm((prev) => {
                                                if (prev.coverageType !== '24hs') return prev;
                                                const mStart = prev.allowedShiftTypes.find((s) => s.code === 'M')?.startTime?.slice(0, 5) || '07:00';
                                                return { ...prev, allowedShiftTypes: rebuild24hsVariants(mStart, v) };
                                            });
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {positionForm.coverageType === 'custom' && (
                        <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-xl border border-orange-100 dark:border-orange-800">
                             <div className="flex gap-2 items-center mb-4 text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 p-2 rounded-lg">
                                <Info size={14}/>
                                <p className="text-[9px] font-bold">El cálculo de horas (Noc/Finde) es automático según los días asignados.</p>
                             </div>
                            
                            <label className="text-[10px] font-black uppercase text-slate-400 mb-2 block">1. Turnos Estándar (Todos los días)</label>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {Object.keys(SHIFT_VARIANTS_DB).map((key) => {
                                    const v = SHIFT_VARIANTS_DB[key];
                                    const sel = positionForm.allowedShiftTypes.some(x => x.code === v.code && !x.isCustom);
                                    return <button key={key} onClick={() => toggleStandardVariant(key)} className={`px-3 py-1 rounded-lg border text-[10px] font-bold transition-all ${sel ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{v.name} ({v.hours}h)</button>
                                })}
                            </div>

                            <label className={`text-[10px] font-black uppercase mb-2 flex items-center gap-2 ${editingShiftCode ? 'text-indigo-500' : 'text-slate-400'}`}>
                                {editingShiftCode ? <><Edit2 size={11}/> Editando turno: <span className="bg-indigo-100 text-indigo-700 px-1.5 rounded">{editingShiftCode}</span></> : '2. Crear Turno a Medida'}
                            </label>
                            <div className={`space-y-2 rounded-xl p-3 transition-colors ${editingShiftCode ? 'bg-indigo-50 border border-indigo-200' : ''}`}>
                                <div className="flex gap-2 items-end">
                                    <div className="flex-1"><span className="text-[9px] text-slate-400">Nombre</span><input className="w-full p-2 text-xs font-bold rounded-lg border" placeholder="Ej: Puerta Bar" value={newCustomShift.name} onChange={e => setNewCustomShift({...newCustomShift, name: e.target.value})}/></div>
                                    <div className="w-20"><span className="text-[9px] text-slate-400">Inicio</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border text-center" value={newCustomShift.start} onChange={e => setNewCustomShift({...newCustomShift, start: e.target.value})}/></div>
                                    <div className="w-20"><span className="text-[9px] text-slate-400">Fin</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border text-center" value={newCustomShift.end} onChange={e => setNewCustomShift({...newCustomShift, end: e.target.value})}/></div>
                                </div>
                                <div>
                                    {/* Toggle: Días de semana / Fechas específicas */}
                                    <div className="flex gap-1 mb-2">
                                        <button onClick={() => setCustomShiftDateMode('weekdays')} className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-colors ${customShiftDateMode === 'weekdays' ? 'bg-slate-900 text-white' : 'bg-white border text-slate-400 hover:bg-slate-50'}`}>Días de semana</button>
                                        <button onClick={() => setCustomShiftDateMode('dates')} className={`px-2.5 py-1 rounded-lg text-[9px] font-black transition-colors ${customShiftDateMode === 'dates' ? 'bg-indigo-600 text-white' : 'bg-white border text-slate-400 hover:bg-slate-50'}`}>Fechas específicas</button>
                                    </div>

                                    {customShiftDateMode === 'weekdays' ? (
                                        <div className="flex gap-1 justify-between items-center">
                                            <div className="flex gap-1">
                                                {['L','M','X','J','V','S','D'].map(day => (
                                                    <button key={day} onClick={() => toggleNewShiftDay(day)} className={`w-7 h-7 rounded text-[9px] font-black transition-colors ${newCustomShift.days.includes(day) ? 'bg-slate-900 text-white' : 'bg-white border text-slate-400'}`}>{day}</button>
                                                ))}
                                            </div>
                                            <div className="flex gap-1">
                                                {editingShiftCode && <button onClick={cancelEditShift} className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-slate-300 flex items-center gap-1"><X size={12}/> Cancelar</button>}
                                                <button onClick={addCustomShift} className={`text-white px-4 py-1.5 rounded-lg font-bold text-xs hover:scale-105 flex items-center gap-1 ${editingShiftCode ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-900'}`}>
                                                    {editingShiftCode ? <><CheckCircle size={14}/> Actualizar</> : <><Plus size={14}/> Agregar</>}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            <div className="flex gap-1 items-center">
                                                <input
                                                    type="date"
                                                    value={pendingDate}
                                                    onChange={e => setPendingDate(e.target.value)}
                                                    className="p-1.5 text-xs rounded-lg border font-mono flex-1 text-slate-700"
                                                />
                                                <button
                                                    onClick={() => {
                                                        if (!pendingDate || newCustomShift.specificDates.includes(pendingDate)) return;
                                                        setNewCustomShift(prev => ({ ...prev, specificDates: [...prev.specificDates, pendingDate].sort() }));
                                                        setPendingDate('');
                                                    }}
                                                    className="bg-slate-800 text-white px-2 py-1.5 rounded-lg text-xs font-bold flex items-center"
                                                ><Plus size={12}/></button>
                                            </div>
                                            {newCustomShift.specificDates.length > 0 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {newCustomShift.specificDates.map(d => (
                                                        <span key={d} className="flex items-center gap-1 bg-indigo-100 text-indigo-700 text-[9px] font-bold px-2 py-0.5 rounded-full">
                                                            {d}
                                                            <button onClick={() => setNewCustomShift(prev => ({ ...prev, specificDates: prev.specificDates.filter(x => x !== d) }))} className="hover:text-rose-500 leading-none"><X size={8}/></button>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex justify-end gap-1">
                                                {editingShiftCode && <button onClick={cancelEditShift} className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-slate-300 flex items-center gap-1"><X size={12}/> Cancelar</button>}
                                                <button onClick={addCustomShift} className={`text-white px-4 py-1.5 rounded-lg font-bold text-xs hover:scale-105 flex items-center gap-1 ${editingShiftCode ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-900'}`}>
                                                    {editingShiftCode ? <><CheckCircle size={14}/> Actualizar</> : <><Plus size={14}/> Agregar</>}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border dark:border-slate-700">
                        <label className="text-[10px] font-black uppercase text-slate-400 mb-3 block">Turnos Habilitados</label>
                        <div className="flex flex-col gap-2">
                            {positionForm.allowedShiftTypes.length > 0 ? positionForm.allowedShiftTypes.map((v, vIdx) => {
                                const isBeingEdited = editingShiftCode === v.code;
                                return (
                                <div key={`${v.code}_${vIdx}`} className={`flex items-center gap-3 bg-white dark:bg-slate-800 px-3 py-2.5 rounded-xl border shadow-sm transition-all ${isBeingEdited ? 'border-indigo-400 ring-2 ring-indigo-200' : 'dark:border-slate-600'}`}>
                                    {/* Sigla editable inline */}
                                    <input
                                      value={v.code}
                                      maxLength={4}
                                      title="Sigla del turno en planificador (editable)"
                                      className={`w-10 h-8 text-center text-[10px] font-black rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-400 uppercase cursor-text ${v.isCustom ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 text-orange-600' : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 text-indigo-700 dark:text-indigo-300'}`}
                                      onChange={e => {
                                        const newCode = e.target.value.toUpperCase().slice(0, 4);
                                        const updated = positionForm.allowedShiftTypes.map((x, i) => i === vIdx ? { ...x, code: newCode } : x);
                                        setPositionForm({ ...positionForm, allowedShiftTypes: updated });
                                      }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-black text-slate-700 dark:text-white uppercase leading-none">{v.name}</p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <p className="text-[9px] text-slate-400 font-mono">{v.startTime} – {v.endTime} · {v.hours}h</p>
                                            {v.days && v.days.length > 0 && <p className="text-[9px] font-black text-slate-500 bg-slate-100 dark:bg-slate-700 px-1.5 rounded">{v.days.join('')}</p>}
                                            {v.specificDates && v.specificDates.length > 0 && <p className="text-[9px] font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 rounded">{v.specificDates.length} fecha{v.specificDates.length !== 1 ? 's' : ''}</p>}
                                        </div>
                                    </div>
                                    {positionForm.coverageType === 'custom' && (
                                        <div className="flex gap-1 shrink-0">
                                            <button
                                                onClick={() => startEditShift(v)}
                                                className={`p-1.5 rounded-lg transition-colors ${isBeingEdited ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 hover:bg-indigo-50 text-slate-400 hover:text-indigo-500'}`}
                                                title="Editar horarios del turno"
                                            >
                                                <Edit2 size={12}/>
                                            </button>
                                            <button
                                                onClick={() => removeCustomVariant(v.code)}
                                                className="p-1.5 bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded-lg transition-colors"
                                                title="Eliminar turno"
                                            >
                                                <X size={12}/>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}) : <span className="text-xs text-slate-400 italic">Ningún turno seleccionado.</span>}
                        </div>
                    </div>
                    {/* Estimación de guardias en rotación */}
                    {positionForm.allowedShiftTypes.length > 0 && (() => {
                      const bd = calculateMonthlyBreakdown([positionForm], form.startDate, form.endDate);
                      const avgH = bd.length > 0 ? bd.reduce((a, m) => a + m.totalHours, 0) / bd.length : 0;
                      const _pax = positionForm.quantity || 1;
                      const _minRot = positionForm.coverageType === '24hs' ? _pax * 2 : _pax;
                      const guardsMin = Math.max(_minRot, Math.ceil(avgH / 192));
                      const hxg = guardsMin > 0 ? Math.round(avgH / guardsMin) : 0;
                      return (
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4">
                          <p className="text-[9px] font-black uppercase text-indigo-400 mb-3">Cálculo CCT 422/05 — por puesto (PAX: {positionForm.quantity})</p>
                          <div className="grid grid-cols-3 gap-3 text-center">
                            <div>
                              <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{Math.round(avgH)}</p>
                              <p className="text-[9px] text-indigo-400 uppercase font-bold">Hs/mes prom.</p>
                            </div>
                            <div className="border-x border-indigo-200 dark:border-indigo-700">
                              <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{guardsMin}</p>
                              <p className="text-[9px] text-indigo-400 uppercase font-bold">G. rotación mín.</p>
                            </div>
                            <div>
                              <p className="text-xl font-black text-indigo-700 dark:text-indigo-300">{hxg}</p>
                              <p className="text-[9px] text-indigo-400 uppercase font-bold">Hs/guardia</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="pt-4 flex gap-3"><button onClick={() => { setShowPositionModal(false); setEditingShiftCode(null); }} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-500 font-bold rounded-xl uppercase text-xs hover:bg-slate-200">Cancelar</button><button onClick={handleSavePosition} className="flex-1 py-3 bg-indigo-600 text-white font-black rounded-xl uppercase text-xs shadow-sm hover:bg-indigo-700">Confirmar</button></div>
                 </div>
              </div>
           </div>
        )}
    </DashboardLayout>
  );
}