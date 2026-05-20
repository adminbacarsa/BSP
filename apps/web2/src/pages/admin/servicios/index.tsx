import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, PageHeader, ModuleShell } from '@/components/ui';
import { slaService, ServiceSLA, ServicePosition, ShiftVariant } from '@/services/slaService'; 
import { useToast } from '@/context/ToastContext';
import { db } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth'; 
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
  deleteDocsByIdsForEmpresa, deleteSlaForEmpresa, TenantIsolationError,
} from '@/lib/multiempresa';
import { isSlaContractActive } from '@/lib/slaPlanningMatch';

import { toYyyyMmDd } from '@/lib/firestoreDates';

function parseYmdToLocalDate(ymd: string): Date | null {
  const core = (ymd || '').trim().slice(0, 10);
  if (core.length < 10) return null;
  const y = parseInt(core.slice(0, 4), 10);
  const mo = parseInt(core.slice(5, 7), 10);
  const d = parseInt(core.slice(8, 10), 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

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

const WEEK_DAY_CODES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

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
    activeDays: ['L','M','X','J','V','S','D'], allowedShiftTypes: []
  });

  const [newCustomShift, setNewCustomShift] = useState<{
      name: string; start: string; end: string; code: string; days: string[]
  }>({
      name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S']
  });

  const [isEditing, setIsEditing] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
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

  // --- MOTOR DE CÁLCULO LEGAL (CCT 422/05) ---
  const analyzeShiftComposition = (start: string, end: string) => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    
    let startMin = h1 * 60 + m1;
    let endMin = h2 * 60 + m2;
    if (endMin < startMin) endMin += 24 * 60; 

    const durationMin = endMin - startMin;
    let nightMinutes = 0;

    // ✅ CORRECCIÓN LEGAL: 21:00 HS
    // Rango Nocturno: 21:00 (1260 min) a 06:00 (360 min)
    const NIGHT_START = 21 * 60; // 1260
    const NIGHT_END = 6 * 60;    // 360

    for (let t = startMin; t < endMin; t++) {
        const modT = t % 1440; 
        // Lógica: Es noche si es < 06:00 O >= 21:00
        if (modT < NIGHT_END || modT >= NIGHT_START) { 
            nightMinutes++;
        }
    }

    return {
        total: parseFloat((durationMin / 60).toFixed(2)),
        night: parseFloat((nightMinutes / 60).toFixed(2)),
        day: parseFloat(((durationMin - nightMinutes) / 60).toFixed(2))
    };
  };

  const calculateShiftHours = (start: string, end: string) => {
    return analyzeShiftComposition(start, end).total;
  };

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

  const computePositionDayComposition = (pos: ServicePosition, dayCode: string) => {
    let dayTotal = 0;
    let dayNight = 0;
    const addVariant = (v: ShiftVariant) => {
      const comp = analyzeShiftComposition(v.startTime, v.endTime);
      dayTotal += comp.total;
      dayNight += comp.night;
    };
    if (pos.coverageType === '24hs') {
      const shifts = pos.allowedShiftTypes || [];
      const m = shifts.find((s) => s.code === 'M');
      const t = shifts.find((s) => s.code === 'T');
      const n = shifts.find((s) => s.code === 'N');
      const d12 = shifts.find((s) => s.code === 'D12');
      const n12 = shifts.find((s) => s.code === 'N12');
      if (m && t && n) {
        addVariant(m);
        addVariant(t);
        addVariant(n);
      } else if (d12 && n12) {
        addVariant(d12);
        addVariant(n12);
      } else {
        addVariant(SHIFT_VARIANTS_DB['D12']);
        addVariant(SHIFT_VARIANTS_DB['N12']);
      }
    } else if (pos.coverageType === '12hs_diurno') {
      addVariant(SHIFT_VARIANTS_DB['D12']);
    } else if (pos.coverageType === '12hs_nocturno') {
      addVariant(SHIFT_VARIANTS_DB['N12']);
    } else if (pos.coverageType === 'custom') {
      (pos.allowedShiftTypes || []).forEach((shift) => {
        if (shift.days && shift.days.length > 0) {
          if (shift.days.includes(dayCode)) addVariant(shift);
        } else {
          addVariant(shift);
        }
      });
    }
    return { dayTotal, dayNight };
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

  const calculateMonthlyBreakdown = (positions: ServicePosition[], startStr: string, endStr: string) => {
    const startNorm = (startStr || '').trim().slice(0, 10);
    const endNorm = (endStr || '').trim().slice(0, 10);
    if (!startNorm || !endNorm || positions.length === 0) return [];

    let current = parseYmdToLocalDate(startNorm);
    const end = parseYmdToLocalDate(endNorm);
    if (!current || !end) return [];

    const monthAccumulator: Record<string, { 
        name: string, days: number, totalHours: number, nightHours: number, weekendHours: number 
    }> = {};

    while (current <= end) {
        const year = current.getFullYear();
        const month = current.getMonth();
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const monthName = current.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
        const dayIdx = current.getDay();
        const dayCode = WEEK_DAY_CODES[dayIdx];
        const isWeekend = (dayIdx === 0 || dayIdx === 6); // D y S

        if (!monthAccumulator[monthKey]) {
            monthAccumulator[monthKey] = { 
                name: monthName.charAt(0).toUpperCase() + monthName.slice(1), 
                days: 0, totalHours: 0, nightHours: 0, weekendHours: 0
            };
        }
        
        monthAccumulator[monthKey].days++;

        positions.forEach(pos => {
            const { dayTotal, dayNight } = computePositionDayComposition(pos, dayCode);
            const q = pos.quantity;
            monthAccumulator[monthKey].totalHours += (dayTotal * q);
            monthAccumulator[monthKey].nightHours += (dayNight * q);
            if (isWeekend) monthAccumulator[monthKey].weekendHours += (dayTotal * q);
        });
        current.setDate(current.getDate() + 1);
    }
    return Object.entries(monthAccumulator)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([monthKey, row]) => ({ ...row, monthKey }));
  };

  const monthlyBreakdown = useMemo(
    () => calculateMonthlyBreakdown(form.positions, form.startDate, form.endDate),
    [form.positions, form.startDate, form.endDate]
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
        calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate).forEach((m) => {
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
      const breakdown = calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate);
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
      setNewCustomShift({ name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'] });
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
          hours, isCustom: true, days: newCustomShift.days
      };

      if (editingShiftCode !== null) {
          // Reemplazar el turno existente
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
      setNewCustomShift(prev => ({ ...prev, name: '', code: '' }));
  };

  const startEditShift = (v: ShiftVariant) => {
      setNewCustomShift({ name: v.name, start: v.startTime, end: v.endTime, code: v.code, days: v.days || [] });
      setEditingShiftCode(v.code);
  };

  const cancelEditShift = () => {
      setNewCustomShift({ name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'] });
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
    } catch (e) { 
        addToast('Error al guardar', 'error'); 
        console.error(e);
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

    // Contar turnos del objetivo dentro del rango de fechas del servicio
    const [sy, sm, sd] = (srv.startDate || '').split('-').map(Number);
    const [ey, em, ed] = (srv.endDate || '').split('-').map(Number);
    const rangeStart = Timestamp.fromDate(new Date(sy, sm - 1, sd, 0, 0, 0));
    const rangeEnd   = Timestamp.fromDate(new Date(ey, em - 1, ed, 23, 59, 59));

    const turnosSnap = await getDocs(query(
      collection(db, 'turnos'),
      where('objectiveId', '==', srv.objectiveId),
      where('startTime', '>=', rangeStart),
      where('startTime', '<=', rangeEnd)
    ));
    const shiftIds = turnosSnap.docs
      .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
      .map(d => d.id);

    // Buscar ausencias y novedades vinculadas (chunks de 30)
    const ausIds: string[] = [];
    const novIds: string[] = [];
    for (let i = 0; i < shiftIds.length; i += 30) {
      const chunk = shiftIds.slice(i, i + 30);
      const [ausSnap, novSnap] = await Promise.all([
        getDocs(query(collection(db, 'ausencias'), where('shiftId', 'in', chunk))),
        getDocs(query(collection(db, 'novedades'), where('shiftId', 'in', chunk))),
      ]);
      ausSnap.docs.forEach(d => ausIds.push(d.id));
      novSnap.docs.forEach(d => novIds.push(d.id));
    }

    const msg = [
      `¿Eliminar el servicio "${srv.clientName} - ${srv.objectiveName}"?`,
      `Período: ${srv.startDate} → ${srv.endDate}`,
      '',
      'Se eliminarán los datos de ese período:',
      `• ${shiftIds.length} turno(s)`,
      `• ${ausIds.length} ausencia(s)`,
      `• ${novIds.length} novedad(es)`,
      '',
      'Esta acción no se puede deshacer.',
    ].join('\n');
    if (!confirm(msg)) return;

    try {
      await Promise.all([
        deleteDocsByIdsForEmpresa('turnos', shiftIds, empresaId, migracionCompleta),
        deleteDocsByIdsForEmpresa('ausencias', ausIds, empresaId, migracionCompleta),
        deleteDocsByIdsForEmpresa('novedades', novIds, empresaId, migracionCompleta),
      ]);
      await deleteSlaForEmpresa(id, empresaId, migracionCompleta);
      await registrarAuditoria('DELETE_CONTRACT', `Eliminó contrato: ${srv.clientName} - ${srv.objectiveName} (${shiftIds.length} turnos)`);
      addToast(`Servicio eliminado con ${shiftIds.length} turno(s)`, 'success');
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
          calculateMonthlyBreakdown([p], srv.startDate, srv.endDate).forEach((mb) => {
            if (mb.monthKey === sk) {
              const pax = p.quantity || 1;
              const minRot = p.coverageType === '24hs' ? pax * 2 : pax;
              guards += Math.max(minRot, Math.ceil(mb.totalHours / 200));
            }
          });
        });
        calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate).forEach((mb) => {
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
      calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate).forEach((mb) => {
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
      const bd = calculateMonthlyBreakdown(srv.positions, srv.startDate, srv.endDate);
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
            <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase shadow-xl flex gap-2 items-center">
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
                <div key={label} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm px-4 pt-3.5 pb-3">
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
                  <div key={group.key} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
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
                  <div key={label} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm px-4 pt-3.5 pb-3">
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
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm px-6 py-4 overflow-hidden">
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
                    const bd = calculateMonthlyBreakdown([pos], srv.startDate, srv.endDate);
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
              <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-2xl px-5 py-3 mb-4">
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
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[3rem] border dark:border-slate-700 shadow-xl">
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
                 <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Cliente</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-sm dark:text-white" value={form.clientId} onChange={handleClientChange}><option value="">Seleccionar...</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                 <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Objetivo</label><select className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-sm dark:text-white" value={form.objectiveId} onChange={handleObjectiveChange} disabled={!form.clientId}><option value="">Seleccionar...</option>{availableObjectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                 <div className="grid grid-cols-2 gap-4">
                     <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Inicio</label><input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-xs dark:text-white" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})}/></div>
                     <div><label className="text-[10px] font-black uppercase text-slate-400 ml-1">Fin</label><input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-2xl font-bold text-xs dark:text-white" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})}/></div>
                 </div>
                 
                 <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border dark:border-slate-700/50">
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

               <div className="lg:col-span-2 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-[2.5rem] border dark:border-slate-700/50">
                  <div className="flex justify-between items-center mb-6">
                     <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2"><Briefcase size={18} className="text-indigo-500"/> Estructura Operativa</h3>
                     <button onClick={openAddPositionModal} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 shadow-md transition-colors"><Plus size={11}/> Agregar Puesto</button>
                  </div>
                  <div className="space-y-3">
                     {form.positions.map((pos) => (
                        <div key={pos.id} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border dark:border-slate-700 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
                           <div className="flex-1 text-left">
                              <div className="flex items-center gap-3"><h4 className="font-bold text-slate-800 dark:text-white text-sm uppercase">{pos.name}</h4><span className="bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-300 px-2 py-0.5 rounded text-[9px] font-black uppercase">{pos.quantity} PAX</span></div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/50 px-2 rounded">{pos.coverageType === '24hs' ? '24 HS' : pos.coverageType.toUpperCase()}</span>
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
            <div className="mt-8 flex justify-end gap-4 border-t dark:border-slate-700 pt-6"><button onClick={() => setView('list')} className="text-slate-400 font-bold uppercase text-xs hover:text-slate-600 transition-colors">Cancelar</button><button onClick={handleSave} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-8 py-3 rounded-xl font-black uppercase text-xs shadow-xl transition-transform active:scale-95"><Save size={16} className="mr-2 inline"/> Guardar</button></div>
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

                    {positionForm.coverageType === '24hs' && (
                        <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-800 rounded-2xl p-4 space-y-3">
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
                        <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-2xl border border-orange-100 dark:border-orange-800">
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
                                    <span className="text-[9px] text-slate-400 block mb-1">Días Habilitados</span>
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
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl border dark:border-slate-700">
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
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-2xl p-4">
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
                    <div className="pt-4 flex gap-3"><button onClick={() => { setShowPositionModal(false); setEditingShiftCode(null); }} className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-500 font-bold rounded-xl uppercase text-xs hover:bg-slate-200">Cancelar</button><button onClick={handleSavePosition} className="flex-1 py-3 bg-indigo-600 text-white font-black rounded-xl uppercase text-xs shadow-xl hover:bg-indigo-700">Confirmar</button></div>
                 </div>
              </div>
           </div>
        )}
    </DashboardLayout>
  );
}