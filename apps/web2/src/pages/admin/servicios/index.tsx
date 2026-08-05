import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, PageHeader, ModuleShell } from '@/components/ui';
import { slaService, ServiceSLA, ServicePosition, ShiftVariant, HorarioVersion, PositionAssignment, ServiceRule, RuleAction, RuleActionType, ServiceRotation, RotationPeriod, RotationEntry } from '@/services/slaService';
import { useToast } from '@/context/ToastContext';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { FirebaseError } from 'firebase/app'; 
import { collection, addDoc, serverTimestamp, query, orderBy, where, getDocs, writeBatch, doc, Timestamp } from 'firebase/firestore';
import {
  Shield, Calendar, Users, Plus, Trash2, Edit2, Copy, Zap,
  Search, Save, X, MapPin, Briefcase, Table, Settings,
  AlertCircle, Info, Sun, Moon, Activity, RotateCw, CheckCircle, FileText,
  Clock, Layers, Building2, ChevronDown, ChevronRight, LayoutGrid, List, UserCheck
} from 'lucide-react';
import { ServiceShiftSchemeModal } from '@/components/servicios/ServiceShiftSchemeModal';
import { ServiceShiftSchemeIcon } from '@/components/servicios/ServiceShiftSchemeIcon';
import { analyzeShiftSchemesForService } from '@/lib/servicios/shiftSchemeAdvisor';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import {
  filterSlaRowsByEmpresa, belongsToEmpresaView, belongsToEmpresa, shouldScopeQueriesToEmpresa,
  collectTurnoIdsForSlaDelete, deleteSlaWithRelatedDataForEmpresa, deleteDocsByIdsForEmpresa, TenantIsolationError,
  empresaCollectionQuery,
} from '@/lib/multiempresa';
import { isSlaContractActive } from '@/lib/slaPlanningMatch';
import {
  analyzeShiftComposition,
  calculateMonthlyBreakdown,
  computePositionDayComposition,
  parseYmdToLocalDate,
  WEEK_DAY_CODES,
} from '@/lib/servicios/slaHoursCalculator';

import { toYyyyMmDd, slaCoversCalendarMonth } from '@/lib/firestoreDates';

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

type SrvGroupItem = { key: string; clientName: string; objectiveName: string; services: (ServiceSLA & { id: string })[] };
type ClientGroupItem = { clientId: string; clientName: string; objectives: SrvGroupItem[]; totalActiveObjs: number; totalHoursKpi: number; totalPositions: number; hasActive: boolean };

function buildClientGroups(
  groupedServices: SrvGroupItem[],
  getHours: (srv: ServiceSLA & { id: string }) => number
): ClientGroupItem[] {
  const map: Record<string, SrvGroupItem[]> = {};
  groupedServices.forEach(g => {
    const cid = g.services[0]?.clientId || g.clientName;
    if (!map[cid]) map[cid] = [];
    map[cid].push(g);
  });
  return Object.entries(map).map(([cid, objs]) => {
    const totalHoursKpi = objs.reduce(
      (s, g) => s + g.services.reduce((s2, srv) => s2 + getHours(srv), 0), 0
    );
    const totalPositions = objs.reduce((s, g) => {
      const srv = g.services[0];
      return s + (srv?.positions?.reduce((s2, p) => s2 + (p.quantity || 1), 0) || 0);
    }, 0);
    const totalActiveObjs = objs.filter(og =>
      og.services.some(s => isSlaContractActive(s.status))
    ).length;
    return {
      clientId: cid,
      clientName: objs[0].clientName,
      objectives: objs,
      totalActiveObjs,
      totalHoursKpi,
      totalPositions,
      hasActive: totalActiveObjs > 0,
    };
  }).sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'));
}

export default function ServiciosSLAPage() {
  const { addToast } = useToast();
  const { empresaId, empresa } = useEmpresa();
  const { isSuperAdmin, rolePermissions } = useAuth();
  const canDeleteService = isSuperAdmin || (rolePermissions['SERVICES'] || []).includes('delete');
  const canCreateService = isSuperAdmin || (rolePermissions['SERVICES'] || []).includes('create');
  const canUpdateService = isSuperAdmin || (rolePermissions['SERVICES'] || []).includes('update');
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
      name: string; start: string; end: string; code: string; days: string[]; specificDates: string[];
      hasBlock2: boolean; block2Start: string; block2End: string;
  }>({
      name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'], specificDates: [],
      hasBlock2: false, block2Start: '18:00', block2End: '22:00',
  });
  const [customShiftDateMode, setCustomShiftDateMode] = useState<'weekdays' | 'dates'>('weekdays');
  const [pendingDate, setPendingDate] = useState('');

  const [isEditing, setIsEditing] = useState(false);
  const [externalChange, setExternalChange] = useState(false);

  // Historial de horarios
  const [showHorarioForm, setShowHorarioForm] = useState(false);
  const [horarioFormDesde, setHorarioFormDesde] = useState('');
  const [horarioFormAnchorM, setHorarioFormAnchorM] = useState('07:00');
  const [horarioFormAnchorD12, setHorarioFormAnchorD12] = useState('07:00');
  const [horarioFormPuesto, setHorarioFormPuesto] = useState<'ALL' | string>('ALL');
  const [horarioFormCustomTimes, setHorarioFormCustomTimes] = useState<Record<string, { startTime: string; endTime: string }>>({});
  const [savingHorario, setSavingHorario] = useState(false);
  const [showExcludedDatesPicker, setShowExcludedDatesPicker] = useState(false);
  const [excludedDatesScope, setExcludedDatesScope] = useState<'ALL' | string>('ALL');
  const savedSelfRef = useRef(false); // evita falsos positivos por nuestros propios guardados
  // Código del turno que se está editando (null = modo "agregar nuevo")
  const [editingShiftCode, setEditingShiftCode] = useState<string | null>(null);

  // Cobertura de dotación
  const [coverageEmps, setCoverageEmps] = useState<any[]>([]);
  const [coverageEditEmpId, setCoverageEditEmpId] = useState<string | null>(null);
  const [coverageEditSlots, setCoverageEditSlots] = useState<Array<{ positionName: string; shiftCodes: string[] }>>([]);
  const [editingRule, setEditingRule] = useState<ServiceRule | null>(null);
  const [editingRuleIsNew, setEditingRuleIsNew] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(true);
  const [condicionesOpen, setCondicionesOpen] = useState(true);
  const [rotacionesOpen, setRotacionesOpen] = useState(true);
  const [editingRotation, setEditingRotation] = useState<ServiceRotation | null>(null);
  const [editingRotationIsNew, setEditingRotationIsNew] = useState(false);

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

  // Empleados del objetivo activo (para la sección Cobertura)
  useEffect(() => {
    if (!form.objectiveId || view !== 'form') { setCoverageEmps([]); return; }
    getDocs(query(collection(db, 'empleados'), where('preferredObjectiveId', '==', form.objectiveId)))
      .then(snap => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter((e: any) => e.status !== 'inactivo')
          .sort((a: any, b: any) => (a.name || a.firstName || '').localeCompare(b.name || b.firstName || '', 'es'));
        setCoverageEmps(rows);
      })
      .catch(() => setCoverageEmps([]));
  }, [form.objectiveId, view]);

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

        unsub = onSnapshotFresh(q, (snapshot) => {
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

  // Suscripción turnos RFZ/TURA — extras solicitados por cliente.
  // Nota: se filtra el código en memoria (evita índice compuesto empresaId+code que no existe
  // y que haría fallar la query silenciosamente, dejando la lista vacía).
  useEffect(() => {
    if (!empresaId) return;
    const q = empresaCollectionQuery('turnos', empresaId, scopeEmpresa);
    const unsub = onSnapshotFresh(q, snap => {
      const rows = snap.docs
        .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(t => ['RFZ', 'TURA'].includes(String(t.code || '').toUpperCase()));
      setRfzTuraExtras(rows);
    }, (e) => console.error('[servicios] RFZ/TURA extras error:', e));
    return unsub;
  }, [empresaId, scopeEmpresa, migracionCompleta]);

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
      const { hasBlock2, block2Start, block2End } = newCustomShift;
      const splitActive = hasBlock2 && !!block2Start && !!block2End;
      const hours = splitActive
          ? calculateShiftHours(newCustomShift.start, newCustomShift.end) + calculateShiftHours(block2Start, block2End)
          : calculateShiftHours(newCustomShift.start, newCustomShift.end);
      const code = newCustomShift.code || newCustomShift.name.substring(0, 2).toUpperCase();

      const newVariant: ShiftVariant = {
          code, name: newCustomShift.name, startTime: newCustomShift.start, endTime: newCustomShift.end,
          hours, isCustom: true,
          ...(splitActive ? { blocks: [
              { startTime: newCustomShift.start, endTime: newCustomShift.end },
              { startTime: block2Start!, endTime: block2End! },
          ] } : {}),
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
      const hasBlock2 = Array.isArray(v.blocks) && v.blocks.length >= 2;
      setNewCustomShift({
          name: v.name, start: v.startTime, end: v.endTime, code: v.code,
          days: v.days || [], specificDates: v.specificDates || [],
          hasBlock2, block2Start: hasBlock2 ? v.blocks![1].startTime : '18:00',
          block2End: hasBlock2 ? v.blocks![1].endTime : '22:00',
      });
      setEditingShiftCode(v.code);
  };

  const cancelEditShift = () => {
      setNewCustomShift({ name: '', start: '20:00', end: '05:00', code: '', days: ['V', 'S'], specificDates: [], hasBlock2: false, block2Start: '18:00', block2End: '22:00' });
      setCustomShiftDateMode('weekdays');
      setPendingDate('');
      setEditingShiftCode(null);
  };

  const removeCustomVariant = (code: string) => {
      setPositionForm(prev => ({ ...prev, allowedShiftTypes: prev.allowedShiftTypes.filter(v => v.code !== code) }));
      if (editingShiftCode === code) cancelEditShift();
  };

  // ── Historial de horarios ────────────────────────────────────────────────────

  const isCustomPosition = (pos: { allowedShiftTypes: ShiftVariant[] }) =>
    pos.allowedShiftTypes.length > 0 && pos.allowedShiftTypes.every(s => s.isCustom);

  /** Deriva bandas M/T/N/D12/N12 a partir de dos anclas horarias. */
  const buildBandasFromAnchors = (anchorM: string, anchorD12: string): HorarioVersion['bandas'] => {
    const variants = rebuild24hsVariants(anchorM, anchorD12);
    const result: HorarioVersion['bandas'] = {};
    for (const v of variants) result[v.code] = { startTime: v.startTime, endTime: v.endTime, hours: v.hours };
    return result;
  };

  /** Deriva bandas para un puesto con turnos personalizados. */
  const buildBandasForCustom = (
    customTimes: Record<string, { startTime: string; endTime: string }>,
    shifts: ShiftVariant[],
  ): HorarioVersion['bandas'] => {
    const result: HorarioVersion['bandas'] = {};
    for (const sh of shifts) {
      const override = customTimes[sh.code];
      const start = override?.startTime || sh.startTime;
      const end = override?.endTime || sh.endTime;
      result[sh.code] = { startTime: start, endTime: end, hours: calculateShiftHours(start, end) };
    }
    return result;
  };

  /** Actualiza startTime/endTime en turnos del objetivo a partir de `desde`, opcionalmente filtrando por puesto. */
  const actualizarTurnosHorario = async (
    objectiveId: string,
    desde: string,
    bandas: HorarioVersion['bandas'],
    positionName?: string,
  ): Promise<number> => {
    // Incluye todos los códigos presentes en bandas (cubre custom además de los estándar)
    const WORK_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'REF', 'ESC', 'FT', ...Object.keys(bandas)]);
    const desdeTs = Timestamp.fromDate(new Date(desde + 'T00:00:00'));
    // Solo filtramos por objectiveId para evitar índice compuesto con rango;
    // el filtro de fecha se aplica en JS.
    const snap = await getDocs(
      query(
        collection(db, 'turnos'),
        where('objectiveId', '==', objectiveId),
      ),
    );

    const ops: Array<{ ref: ReturnType<typeof doc>; start: ReturnType<typeof Timestamp.fromDate>; end: ReturnType<typeof Timestamp.fromDate> }> = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      // Filtrar por fecha (en JS para evitar índice compuesto)
      if (!data.startTime || data.startTime.seconds < desdeTs.seconds) continue;
      // Filtrar por puesto si se especificó uno
      if (positionName && String(data.positionName || '').trim() !== positionName.trim()) continue;
      const code = String(data.code || '').toUpperCase();
      const banda = bandas[code];
      if (!WORK_CODES.has(code) || !banda) continue;

      const turnoDt: Date = data.startTime?.toDate?.();
      if (!turnoDt) continue;

      const [sh, sm] = banda.startTime.split(':').map(Number);
      const start = new Date(turnoDt.getFullYear(), turnoDt.getMonth(), turnoDt.getDate());
      start.setHours(sh, sm, 0, 0);

      const [eh, em] = banda.endTime.split(':').map(Number);
      const end = new Date(start);
      end.setHours(eh, em, 0, 0);
      if (end <= start) end.setTime(end.getTime() + 24 * 3600000);

      ops.push({ ref: docSnap.ref as ReturnType<typeof doc>, start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) });
    }

    const CHUNK = 400;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + CHUNK)) batch.update(op.ref, { startTime: op.start, endTime: op.end });
      await batch.commit();
    }
    return ops.length;
  };

  const handleApplyHorarioVersion = async () => {
    if (!form.id || !horarioFormDesde) { addToast('Ingresá la fecha de inicio del cambio', 'error'); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (horarioFormDesde < today) { addToast('La fecha debe ser hoy o posterior', 'error'); return; }

    const applyToAll = horarioFormPuesto === 'ALL';
    const targetPosName = applyToAll ? null : horarioFormPuesto;
    const selectedPos = targetPosName ? form.positions.find(p => p.name === targetPosName) : null;
    const posIsCustom = selectedPos ? isCustomPosition(selectedPos) : false;

    const bandas = posIsCustom
      ? buildBandasForCustom(horarioFormCustomTimes, selectedPos!.allowedShiftTypes)
      : buildBandasFromAnchors(horarioFormAnchorM, horarioFormAnchorD12);

    const currentUser = (await import('@/lib/firebase')).auth.currentUser;
    const changedBy = currentUser?.displayName || currentUser?.email || 'Sistema';

    const newVersiones: HorarioVersion[] = [
      ...(form.horarioVersiones || []).filter(v => !(v.desde === horarioFormDesde && (v as any).puesto === (targetPosName ?? undefined))),
      { desde: horarioFormDesde, bandas, changedBy, ...(targetPosName ? { puesto: targetPosName } : {}) } as HorarioVersion & { puesto?: string; changedBy?: string },
    ].sort((a, b) => a.desde.localeCompare(b.desde));

    // Actualizar allowedShiftTypes solo en los puestos afectados
    const newPositions = form.positions.map(pos => {
      if (!applyToAll && pos.name !== targetPosName) return pos;
      return {
        ...pos,
        allowedShiftTypes: pos.allowedShiftTypes.map(sh => {
          const b = bandas[sh.code.toUpperCase()] || bandas[sh.code];
          return b ? { ...sh, startTime: b.startTime, endTime: b.endTime, hours: b.hours } : sh;
        }),
      };
    });

    try {
      setSavingHorario(true);
      await slaService.update(form.id, {
        horarioVersiones: JSON.parse(JSON.stringify(newVersiones)),
        positions: JSON.parse(JSON.stringify(newPositions)),
      } as Partial<ServiceSLA>, { empresaId, migracionCompleta });

      const count = await actualizarTurnosHorario(
        form.objectiveId,
        horarioFormDesde,
        bandas,
        targetPosName ?? undefined,
      );
      setForm(prev => ({ ...prev, horarioVersiones: newVersiones, positions: newPositions }));
      const puestoLabel = targetPosName ? `puesto "${targetPosName}"` : 'todos los puestos';
      addToast(`Horario actualizado (${puestoLabel}) · ${count} turno(s) reprogramado(s)`, 'success');
      await registrarAuditoria('UPDATE_HORARIO', `Cambio de horario desde ${horarioFormDesde} · ${puestoLabel} · ${form.clientName} - ${form.objectiveName}`);
      setShowHorarioForm(false);
    } catch (e) {
      addToast('Error al actualizar horario', 'error');
      console.error(e);
    } finally {
      setSavingHorario(false);
    }
  };

  const initCustomTimesForPos = (pos: { allowedShiftTypes: ShiftVariant[] }) => {
    const times: Record<string, { startTime: string; endTime: string }> = {};
    for (const sh of pos.allowedShiftTypes) {
      times[sh.code] = { startTime: sh.startTime.slice(0, 5), endTime: sh.endTime.slice(0, 5) };
    }
    setHorarioFormCustomTimes(times);
  };

  const openHorarioForm = () => {
    const firstPos = form.positions[0];
    const mShift = form.positions.flatMap(p => p.allowedShiftTypes).find(s => s.code === 'M');
    const d12Shift = form.positions.flatMap(p => p.allowedShiftTypes).find(s => s.code === 'D12');
    setHorarioFormAnchorM(mShift?.startTime?.slice(0, 5) || '07:00');
    setHorarioFormAnchorD12(d12Shift?.startTime?.slice(0, 5) || '07:00');
    setHorarioFormDesde('');
    const initialPos = form.positions.length === 1 ? form.positions[0].name : 'ALL';
    setHorarioFormPuesto(initialPos);
    if (form.positions.length === 1 && isCustomPosition(form.positions[0])) {
      initCustomTimesForPos(form.positions[0]);
    }
    setShowHorarioForm(true);
  };

  // ── Fin historial de horarios ─────────────────────────────────────────────────

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

  // ── Cobertura de dotación ──────────────────────────────────────────────
  const startEditCoverage = (empId: string) => {
    const existing = (form.positionAssignments || []).find(a => a.employeeId === empId);
    setCoverageEditSlots(existing?.slots ? existing.slots.map(s => ({ ...s, shiftCodes: [...s.shiftCodes] })) : []);
    setCoverageEditEmpId(empId);
  };
  const cancelEditCoverage = () => { setCoverageEditEmpId(null); setCoverageEditSlots([]); };
  const saveCoverage = (empId: string, empName: string) => {
    const cleanSlots = coverageEditSlots.filter(s => s.positionName);
    const existing = form.positionAssignments || [];
    let updated: PositionAssignment[];
    if (cleanSlots.length === 0) {
      updated = existing.filter(a => a.employeeId !== empId);
    } else {
      const entry: PositionAssignment = { employeeId: empId, employeeName: empName, slots: cleanSlots };
      const idx = existing.findIndex(a => a.employeeId === empId);
      updated = idx >= 0 ? existing.map((a, i) => i === idx ? entry : a) : [...existing, entry];
    }
    setForm({ ...form, positionAssignments: updated });
    cancelEditCoverage();
  };
  const removeCoverage = (empId: string) => {
    setForm({ ...form, positionAssignments: (form.positionAssignments || []).filter(a => a.employeeId !== empId) });
    if (coverageEditEmpId === empId) cancelEditCoverage();
  };
  const toggleCoveragePosition = (positionName: string) => {
    const exists = coverageEditSlots.find(s => s.positionName === positionName);
    if (exists) {
      setCoverageEditSlots(coverageEditSlots.filter(s => s.positionName !== positionName));
    } else {
      setCoverageEditSlots([...coverageEditSlots, { positionName, shiftCodes: [] }]);
    }
  };
  
  const RULE_ABSENCE_CODES = ['F','FF','FP','FT','V','L','E','A','AA','PG'];
  const allServiceWorkCodes: string[] = (() => {
    const codes = new Set<string>();
    for (const pos of form.positions) {
      for (const sv of (pos.allowedShiftTypes || [])) {
        if (sv.code) codes.add(sv.code);
      }
    }
    return codes.size > 0 ? Array.from(codes) : ['M','T','N','D12','N12','RET','ESC','REF'];
  })();
  const RULE_TRIGGER_CODES = [...RULE_ABSENCE_CODES, ...allServiceWorkCodes];

  function getPositionCodes(posName: string, positions: ServicePosition[]): string[] {
    const pos = positions.find(p => p.name === posName);
    if (!pos?.allowedShiftTypes?.length) return ['M','T','N','D12','N12','RET','ESC','REF'];
    return pos.allowedShiftTypes.map((sv: ShiftVariant) => sv.code);
  }
  function getAssignCodes(posName: string): string[] {
    const work = getPositionCodes(posName, form.positions);
    return [...work, ...['F','FF','FP','FT'].filter(c => !work.includes(c))];
  }

  function startNewRule() {
    const r: ServiceRule = { id: 'rule_' + Date.now(), name: '', triggers: [{ employeeId: '', employeeName: '', shiftCode: 'F', shiftCodes: [] }], actions: [{ type: 'EXCLUDE' as RuleActionType, positionName: '', shiftCode: '' }] };
    setEditingRule(r);
    setEditingRuleIsNew(true);
  }
  function cancelEditRule() { setEditingRule(null); setEditingRuleIsNew(false); }
  function saveRule() {
    if (!editingRule) return;
    const curr = form.serviceRules || [];
    const updated = curr.some((r: ServiceRule) => r.id === editingRule.id)
      ? curr.map((r: ServiceRule) => r.id === editingRule.id ? editingRule : r)
      : [...curr, editingRule];
    setForm({ ...form, serviceRules: updated });
    setEditingRule(null); setEditingRuleIsNew(false);
  }
  function deleteRule(id: string) {
    setForm({ ...form, serviceRules: (form.serviceRules || []).filter((r: ServiceRule) => r.id !== id) });
    if (editingRule?.id === id) { setEditingRule(null); setEditingRuleIsNew(false); }
  }
  function startNewRotation() {
    setEditingRotation({ id: Date.now().toString(), name: '', periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: [] }], weekStartDay: 1 });
    setEditingRotationIsNew(true);
  }
  function cancelEditRotation() { setEditingRotation(null); setEditingRotationIsNew(false); }
  function saveRotation() {
    if (!editingRotation) return;
    const curr = form.serviceRotations || [];
    const updated = curr.some((r: ServiceRotation) => r.id === editingRotation.id)
      ? curr.map((r: ServiceRotation) => r.id === editingRotation.id ? editingRotation : r)
      : [...curr, editingRotation];
    setForm({ ...form, serviceRotations: updated });
    setEditingRotation(null); setEditingRotationIsNew(false);
  }
  function deleteRotation(id: string) {
    setForm({ ...form, serviceRotations: (form.serviceRotations || []).filter((r: ServiceRotation) => r.id !== id) });
    if (editingRotation?.id === id) { setEditingRotation(null); setEditingRotationIsNew(false); }
  }
  function updRotPeriod(pidx: number, updP: RotationPeriod) {
    if (!editingRotation) return;
    setEditingRotation({ ...editingRotation, periods: editingRotation.periods.map((p: RotationPeriod, i: number) => i === pidx ? updP : p) });
  }
  function addRotEntry(pidx: number) {
    if (!editingRotation) return;
    const p = editingRotation.periods[pidx];
    updRotPeriod(pidx, { ...p, entries: [...p.entries, { employeeId: '', employeeName: '', positionName: '', shiftCode: '' }] });
  }
  function removeRotEntry(pidx: number, eidx: number) {
    if (!editingRotation) return;
    const p = editingRotation.periods[pidx];
    updRotPeriod(pidx, { ...p, entries: p.entries.filter((_: any, i: number) => i !== eidx) });
  }
  function updRotEntry(pidx: number, eidx: number, field: string, val: string) {
    if (!editingRotation) return;
    const p = editingRotation.periods[pidx];
    const entries = p.entries.map((e: RotationEntry, i: number) => {
      if (i !== eidx) return e;
      const next: any = { ...e, [field]: val };
      if (field === 'employeeId') {
        const emp = coverageEmps.find((em: any) => em.id === val);
        next.employeeName = emp ? (emp.name || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()) : '';
      }
      return next;
    });
    updRotPeriod(pidx, { ...p, entries });
  }

  function addRREntry() {
    if (!editingRotation) return;
    const _p0 = editingRotation.periods[0] || { label: '', trigger: { type: 'WEEKLY' as any }, entries: [] };
    setEditingRotation({ ...editingRotation, periods: [{ ..._p0, entries: [..._p0.entries, { employeeId: '', employeeName: '', positionName: '', shiftCode: '' }] }] });
  }
  function removeRREntry(eidx: number) {
    if (!editingRotation) return;
    const _p0 = editingRotation.periods[0];
    if (!_p0) return;
    setEditingRotation({ ...editingRotation, periods: [{ ..._p0, entries: _p0.entries.filter((_: any, i: number) => i !== eidx) }] });
  }
  function updRREntry(eidx: number, field: string, val: string) {
    if (!editingRotation) return;
    const _p0 = editingRotation.periods[0];
    if (!_p0) return;
    const _e = _p0.entries.map((e: RotationEntry, i: number) => {
      if (i !== eidx) return e;
      const next: any = { ...e };
      if (field === 'sequence') {
        const _raw = val.trim().toUpperCase();
        // Sin separadores → split caracter a caracter (para códigos de 1 letra: F, N, T, M…)
        // Con espacios o comas → split por separador (para códigos multi-char: D12, N12, REF…)
        next.sequence = (!_raw.includes(' ') && !_raw.includes(','))
          ? _raw.split('').filter((c: string) => /[A-Z]/.test(c))
          : _raw.split(/[\s,]+/).filter(Boolean);
      } else {
        next[field] = val;
      }
      if (field === 'employeeId') {
        const emp = coverageEmps.find((em: any) => em.id === val);
        next.employeeName = emp ? (emp.name || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()) : '';
      }
      return next;
    });
    setEditingRotation({ ...editingRotation, periods: [{ ..._p0, entries: _e }] });
  }
  function updTrigger(idx: number, field: string, val: string) {
    if (!editingRule) return;
    const triggers = editingRule.triggers.map((t, i) => {
      if (i !== idx) return t;
      const next: any = { ...t, [field]: val };
      if (field === 'employeeId') {
        const emp = coverageEmps.find((e: any) => e.id === val);
        next.employeeName = emp ? (emp.name || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()) : '';
      }
      return next;
    });
    setEditingRule({ ...editingRule, triggers });
  }
  function toggleTriggerCode(idx: number, code: string) {
    if (!editingRule) return;
    const triggers = editingRule.triggers.map((t, i) => {
      if (i !== idx) return t;
      const cur = (t as any).shiftCodes?.length ? (t as any).shiftCodes as string[] : (t.shiftCode ? [t.shiftCode] : []);
      const next = cur.includes(code) ? cur.filter((x: string) => x !== code) : [...cur, code];
      return { ...t, shiftCodes: next, shiftCode: next[0] || 'F' };
    });
    setEditingRule({ ...editingRule, triggers });
  }
  function updAction(idx: number, field: string, val: string) {
    if (!editingRule) return;
    const actions = editingRule.actions.map((a: RuleAction, i: number) => {
      if (i !== idx) return a;
      const next: any = { ...a, [field]: val };
      if (field === 'employeeId') {
        const emp = coverageEmps.find((e: any) => e.id === val);
        next.employeeName = emp ? (emp.name || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim()) : '';
      }
      return next as RuleAction;
    });
    setEditingRule({ ...editingRule, actions });
  }

const toggleCoverageShiftCode = (positionName: string, code: string) => {
    setCoverageEditSlots(coverageEditSlots.map(s => {
      if (s.positionName !== positionName) return s;
      const codes = s.shiftCodes.includes(code) ? s.shiftCodes.filter(c => c !== code) : [...s.shiftCodes, code];
      return { ...s, shiftCodes: codes };
    }));
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
    if (!canDeleteService) { addToast('Sin permiso para eliminar servicios', 'error'); return; }
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
  const [srvStatusFilter, setSrvStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [srvFeatureFilter, setSrvFeatureFilter] = useState<'all' | 'rotaciones' | 'condiciones'>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [listMode, setListMode] = useState<'objectives' | 'clients'>('objectives');
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const toggleClient = (id: string) =>
    setExpandedClients(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [rfzTuraExtras, setRfzTuraExtras] = useState<any[]>([]);
  const [shiftModal, setShiftModal] = useState<{
    open: boolean;
    service: (ServiceSLA & { id: string }) | null;
  }>({ open: false, service: null });

  const toggleGroup = (key: string) =>
    setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });


  const groupedServices = useMemo((): SrvGroupItem[] => {
    const q = srvSearch.toLowerCase().trim();
    const filtered = (services as (ServiceSLA & { id: string })[]).filter(s => {
      if (q && !(s.clientName||'').toLowerCase().includes(q) && !(s.objectiveName||'').toLowerCase().includes(q)) return false;
      // Filtro activo/inactivo: usa el mes seleccionado en los KPIs (kpiMonth 0-based)
      if (srvStatusFilter === 'active' && !slaCoversCalendarMonth(s.startDate, s.endDate, kpiYear, kpiMonth)) return false;
      if (srvStatusFilter === 'inactive' && slaCoversCalendarMonth(s.startDate, s.endDate, kpiYear, kpiMonth)) return false;
      if (srvFeatureFilter === 'rotaciones' && !(s.serviceRotations?.length)) return false;
      if (srvFeatureFilter === 'condiciones' && !(s.serviceRules?.length)) return false;
      return true;
    });
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
  }, [services, srvSearch, srvStatusFilter, srvFeatureFilter, clientNameById, kpiYear, kpiMonth]);


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

  const clientGroups = buildClientGroups(groupedServices, getServiceHoursForKpiMonth);

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
            {canCreateService && (
            <button onClick={openNew} className="bg-indigo-600 hover:bg-indigo-700 transition-colors text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase shadow-sm flex gap-2 items-center">
              <Plus size={14}/> Nuevo Servicio
            </button>
            )}
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

          {/* Filtros rápidos */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
              {(['all', 'active', 'inactive'] as const).map(v => (
                <button key={v} onClick={() => setSrvStatusFilter(v)}
                  title={v === 'active' ? `Vigentes en ${kpiCurrent.label}` : v === 'inactive' ? `Sin cobertura en ${kpiCurrent.label}` : undefined}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${srvStatusFilter === v ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {v === 'all' ? 'Todos' : v === 'active' ? '● Activos' : '○ Sin cobertura'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
              {(['all', 'rotaciones', 'condiciones'] as const).map(v => (
                <button key={v} onClick={() => setSrvFeatureFilter(v)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${srvFeatureFilter === v ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {v === 'all' ? 'Todos' : v === 'rotaciones' ? '⟳ Rotaciones' : '⚡ Condiciones'}
                </button>
              ))}
            </div>
          </div>

          {/* Toggle de vista */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
            <button
              onClick={() => setListMode('objectives')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${listMode === 'objectives' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <LayoutGrid size={11}/> Por Objetivo
            </button>
            <button
              onClick={() => setListMode('clients')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${listMode === 'clients' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Building2 size={11}/> Por Cliente
            </button>
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
            {listMode === 'clients'
              ? `${clientGroups.length} cliente${clientGroups.length !== 1 ? 's' : ''} · ${groupedServices.length} objetivo${groupedServices.length !== 1 ? 's' : ''}`
              : `${groupedServices.length} objetivo${groupedServices.length !== 1 ? 's' : ''}`}
            {srvSearch && ` · búsqueda: "${srvSearch}"`}
            {srvStatusFilter !== 'all' && ` · ${srvStatusFilter === 'active' ? `activos en ${kpiCurrent.label}` : `sin cobertura en ${kpiCurrent.label}`}`}
            {srvFeatureFilter !== 'all' && ` · con ${srvFeatureFilter}`}
          </p>

          {/* Vista por cliente */}
          {listMode === 'clients' && (
            loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <RotateCw size={20} className="animate-spin mr-2"/> Cargando...
              </div>
            ) : clientGroups.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm font-bold">No se encontraron clientes.</div>
            ) : (
              <div className="space-y-3">
                {clientGroups.map(cg => {
                  const isExp = expandedClients.has(cg.clientId);
                  return (
                    <div key={cg.clientId} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                      {/* Accent */}
                      <div className={`h-1 w-full ${cg.hasActive ? 'bg-indigo-600' : 'bg-slate-300'}`}/>
                      {/* Header clickeable */}
                      <button
                        onClick={() => toggleClient(cg.clientId)}
                        className="w-full flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                      >
                        <div className="p-2.5 rounded-xl shrink-0" style={{ background: cg.hasActive ? '#4f46e51a' : '#94a3b81a' }}>
                          <Building2 size={16} color={cg.hasActive ? '#4f46e5' : '#94a3b8'}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase truncate">{cg.clientName}</h3>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase shrink-0 ${cg.hasActive ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-400'}`}>
                              {cg.hasActive ? 'Activo' : 'Inactivo'}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                              <MapPin size={9}/> {cg.objectives.length} objetivo{cg.objectives.length !== 1 ? 's' : ''}
                              {cg.totalActiveObjs > 0 && cg.totalActiveObjs < cg.objectives.length && (
                                <span className="text-emerald-500">({cg.totalActiveObjs} activo{cg.totalActiveObjs !== 1 ? 's' : ''})</span>
                              )}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                              <Clock size={9}/> {cg.totalHoursKpi.toLocaleString('es-AR')} h/mes
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                              <Users size={9}/> {cg.totalPositions} puesto{cg.totalPositions !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-slate-300 dark:text-slate-600">
                          {isExp ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                        </div>
                      </button>

                      {/* Objetivos expandidos */}
                      {isExp && (
                        <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
                          {cg.objectives.map(group => {
                            const srvCubreKpiMes = (srv: ServiceSLA & { id: string }) => {
                              const mStart = new Date(kpiYear, kpiMonth, 1);
                              const mEnd = new Date(kpiYear, kpiMonth + 1, 0);
                              const sStart = parseYmdToLocalDate((srv.startDate || '').trim().slice(0, 10));
                              const sEnd = parseYmdToLocalDate((srv.endDate || '').trim().slice(0, 10));
                              return !!sStart && !!sEnd && !(sStart > mEnd || sEnd < mStart);
                            };
                            const currentSrv = group.services.find(srvCubreKpiMes) || group.services[0];
                            const hasObjActive = group.services.some(s => isSlaContractActive(s.status));
                            const slaR = getResolvedSlaForMargin(currentSrv);
                            const total = serviceTotals.get(serviceSlaRowKey(currentSrv)) ?? 0;
                            return (
                              <div key={group.key} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                {/* Indicador activo */}
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasObjActive ? 'bg-emerald-400' : 'bg-slate-300'}`}/>
                                {/* Nombre objetivo */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-black text-slate-700 dark:text-white uppercase truncate flex items-center gap-1.5">
                                    <MapPin size={9} className="text-indigo-400 shrink-0"/>{group.objectiveName}
                                  </p>
                                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                    <span className="text-[9px] font-mono font-bold text-slate-400">
                                      {currentSrv.startDate} → {currentSrv.endDate}
                                    </span>
                                    {group.services.length > 1 && (
                                      <span className="text-[9px] font-black text-indigo-400">{group.services.length} contratos</span>
                                    )}
                                    {currentSrv.positions.length > 0 && (
                                      <span className="text-[9px] text-slate-400 flex items-center gap-0.5">
                                        <Users size={8}/> {currentSrv.positions.reduce((s, p) => s + (p.quantity || 1), 0)} puesto{currentSrv.positions.reduce((s, p) => s + (p.quantity || 1), 0) !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {/* SLA + horas */}
                                <div className="text-right shrink-0">
                                  <p className="text-base font-black text-indigo-600 dark:text-indigo-400 tabular-nums leading-tight">
                                    {slaR.sla}<span className="text-[9px] font-bold ml-0.5">h</span>
                                    <span className="text-[8px] font-black text-slate-400 uppercase ml-1">SLA</span>
                                  </p>
                                  <p className="text-[8px] font-bold text-slate-400 tabular-nums">Total: {total} h</p>
                                </div>
                                {/* Badge estado */}
                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase shrink-0 ${hasObjActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                  {hasObjActive ? 'Activo' : 'Inactivo'}
                                </span>
                                {/* Acciones */}
                                <div className="flex gap-1 shrink-0">
                                  <button onClick={() => handleNewVersion(currentSrv)} title="Nueva versión" className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors">
                                    <Copy size={11}/>
                                  </button>
                                  {canUpdateService && (
                                  <button onClick={() => handleEdit(currentSrv)} title="Editar" className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                                    <Edit2 size={11}/>
                                  </button>
                                  )}
                                  {canDeleteService && (
                                  <button onClick={() => currentSrv.id && handleDelete(currentSrv.id)} title="Eliminar" className="p-1.5 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 transition-colors">
                                    <Trash2 size={11}/>
                                  </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Grid de grupos (vista por objetivo) */}
          {listMode === 'objectives' && loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <RotateCw size={20} className="animate-spin mr-2"/> Cargando...
            </div>
          )}
          {listMode === 'objectives' && !loading && groupedServices.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-sm font-bold">No se encontraron contratos.</div>
          )}
          {listMode === 'objectives' && !loading && groupedServices.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {groupedServices.map(group => {
                // Contrato vigente en el mes mostrado (kpi) — si no hay, el más reciente.
                const srvCubreKpiMes = (srv: ServiceSLA & { id: string }) => {
                  const mStart = new Date(kpiYear, kpiMonth, 1);
                  const mEnd = new Date(kpiYear, kpiMonth + 1, 0);
                  const sStart = parseYmdToLocalDate((srv.startDate || '').trim().slice(0, 10));
                  const sEnd = parseYmdToLocalDate((srv.endDate || '').trim().slice(0, 10));
                  return !!sStart && !!sEnd && !(sStart > mEnd || sEnd < mStart);
                };
                const currentSrv = group.services.find(srvCubreKpiMes) || group.services[0];
                const orderedServices = currentSrv
                  ? [currentSrv, ...group.services.filter(s => s !== currentSrv)]
                  : group.services;
                const latestSrv = currentSrv;
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
                          {(isExpanded ? orderedServices : orderedServices.slice(0,1)).map(srv => {
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
                                    {canUpdateService && (
                                    <button onClick={() => { handleEdit(srv); }} title="Editar" className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                                      <Edit2 size={11}/>
                                    </button>
                                    )}
                                    {canDeleteService && (
                                    <button onClick={() => { srv.id && handleDelete(srv.id); }} title="Eliminar" className="p-1.5 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 transition-colors">
                                      <Trash2 size={11}/>
                                    </button>
                                    )}
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
                  {canUpdateService && (
                  <button onClick={() => { handleEdit(srv); close(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-black text-xs uppercase hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors">
                    <Edit2 size={13}/> Editar
                  </button>
                  )}
                  {canDeleteService && (
                  <button onClick={() => { srv.id && handleDelete(srv.id); close(); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-black text-xs uppercase hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors">
                    <Trash2 size={13}/> Eliminar
                  </button>
                  )}
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
                     const excludeMonth = (monthDays: Array<{ date: Date; ds: string }>) => {
                         const validDs = monthDays.filter(d => d.ds).map(d => d.ds);
                         if (isAll) {
                             const next = new Set(slaGlobal);
                             validDs.forEach(ds => next.add(ds));
                             setForm({ ...form, excludedDates: Array.from(next).sort() });
                         } else if (scopePosIdx >= 0) {
                             const nextPositions = form.positions.map((p, i) => {
                                 if (i !== scopePosIdx) return p;
                                 const cur = new Set(p.excludedDates || []);
                                 validDs.forEach(ds => cur.add(ds));
                                 return { ...p, excludedDates: Array.from(cur).sort() };
                             });
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
                                                         <div className="flex items-center justify-between mb-2">
                                                             <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">{label}</p>
                                                             <button type="button" onClick={() => excludeMonth(days)} className="text-[9px] font-black text-rose-400 hover:text-rose-600 uppercase">Excluir todo</button>
                                                         </div>
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

            {/* ── Cobertura de dotación ── */}
            <div className="mt-8 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-xl border dark:border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setCoverageOpen(o => !o)} className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2 hover:text-indigo-600 transition-colors">
                  <UserCheck size={16} className="text-indigo-500"/> Cobertura de Dotación
                  <ChevronDown size={14} className={`text-slate-400 ml-1 transition-transform duration-200 ${coverageOpen ? 'rotate-180' : ''}`}/>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (form.positionAssignments !== undefined) {
                      setForm({ ...form, positionAssignments: undefined as any });
                    } else {
                      setForm({ ...form, positionAssignments: [] });
                    }
                    setCoverageEditEmpId(null);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black border transition-colors ${form.positionAssignments !== undefined ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-600 hover:bg-slate-50'}`}
                >
                  {form.positionAssignments !== undefined ? 'Activada' : 'Activar cobertura'}
                </button>
              </div>
              {coverageOpen && (form.positionAssignments === undefined ? (
                <p className="text-[10px] text-slate-400">
                  En puestos <span className="font-bold text-slate-500">personalizados</span> no hay rotación obligatoria M→T→N: definí en qué puesto y bandas puede trabajar cada guardia (ej. solo M, o M y T sin N). En puestos <span className="font-bold text-slate-500">24 h</span> la rotación de bandas la arma el motor con esquema 6+2. El planificador respeta estas restricciones.
                </p>
              ) : form.positions.length === 0 ? (
                <p className="text-[10px] text-slate-400">Definí al menos un puesto para configurar restricciones de cobertura.</p>
              ) : coverageEmps.length === 0 ? (
                <p className="text-[10px] text-slate-400">No hay guardias con este objetivo como preferido en RRHH. Asignalos desde el módulo RRHH y volvé a esta sección.</p>
              ) : (
                <div className="space-y-2">
                  {coverageEmps.map((emp: any) => {
                    const empName = emp.name || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim() || emp.id;
                    const assignment = (form.positionAssignments || []).find((a: PositionAssignment) => a.employeeId === emp.id);
                    const isEditingEmp = coverageEditEmpId === emp.id;
                    return (
                      <div key={emp.id} className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-2.5">
                          <span className="text-xs font-black text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">{empName}</span>
                          {!isEditingEmp && (
                            <>
                              <div className="flex flex-wrap gap-1">
                                {assignment?.slots?.length ? assignment.slots.map((s: any) => (
                                  <span key={s.positionName} className="text-[9px] font-black bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 px-2 py-0.5 rounded-lg">
                                    {s.positionName}{s.shiftCodes.length > 0 ? ` · ${s.shiftCodes.join(', ')}` : ''}
                                  </span>
                                )) : (
                                  <span className="text-[9px] text-slate-400 italic">Sin restricciones</span>
                                )}
                              </div>
                              <button onClick={() => startEditCoverage(emp.id)} className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors shrink-0"><Edit2 size={12}/></button>
                              {assignment && <button onClick={() => removeCoverage(emp.id)} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors shrink-0"><X size={12}/></button>}
                            </>
                          )}
                        </div>
                        {isEditingEmp && (
                          <div className="border-t dark:border-slate-700 px-4 py-3 space-y-3 bg-slate-50 dark:bg-slate-900/30">
                            <p className="text-[10px] font-black uppercase text-slate-400">Puestos permitidos para {empName}:</p>
                            {form.positions.map((pos: ServicePosition) => {
                              const slot = coverageEditSlots.find(s => s.positionName === pos.name);
                              const active = !!slot;
                              return (
                                <div key={pos.id} className="space-y-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleCoveragePosition(pos.name)}
                                    className={`flex items-center gap-2 text-xs font-bold transition-colors ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-400'}`}
                                  >
                                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${active ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300 dark:border-slate-600'}`}>
                                      {active && <CheckCircle size={10} className="text-white"/>}
                                    </div>
                                    {pos.name}
                                  </button>
                                  {active && pos.allowedShiftTypes.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 ml-6">
                                      {pos.allowedShiftTypes.map((sv: ShiftVariant) => (
                                        <button
                                          key={sv.code}
                                          type="button"
                                          onClick={() => toggleCoverageShiftCode(pos.name, sv.code)}
                                          className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${slot!.shiftCodes.includes(sv.code) ? 'bg-indigo-600 text-white border-indigo-600' : slot!.shiftCodes.length === 0 ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 border-indigo-300 dark:border-indigo-700' : 'bg-slate-100 dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}
                                        >
                                          {sv.code}
                                        </button>
                                      ))}
                                      {slot!.shiftCodes.length === 0 && (
                                        <span className="text-[9px] text-slate-400 italic self-center">Todas las bandas</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
                              <button
                                type="button"
                                onClick={() => saveCoverage(emp.id, empName)}
                                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors"
                              >
                                <Save size={11}/> Guardar
                              </button>
                              <button type="button" onClick={cancelEditCoverage} className="px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
                              {assignment && (
                                <button type="button" onClick={() => removeCoverage(emp.id)} className="ml-auto flex items-center gap-1 text-[10px] font-black text-rose-500 hover:bg-rose-50 px-3 py-1.5 rounded-xl transition-colors"><Trash2 size={10}/> Quitar restricción</button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>


            {/* ── Condiciones ── */}
            <div className="mt-8 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-xl border dark:border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setCondicionesOpen(o => !o)} className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2 hover:text-violet-600 transition-colors">
                  <Zap size={16} className="text-violet-500"/> Condiciones
                  <ChevronDown size={14} className={`text-slate-400 ml-1 transition-transform duration-200 ${condicionesOpen ? 'rotate-180' : ''}`}/>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (form.serviceRules !== undefined) {
                      setForm({ ...form, serviceRules: undefined as any });
                      setEditingRule(null);
                    } else {
                      setForm({ ...form, serviceRules: [] });
                    }
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black border transition-colors ${form.serviceRules !== undefined ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-600 hover:bg-slate-50'}`}
                >
                  {form.serviceRules !== undefined ? 'Activadas' : 'Activar condiciones'}
                </button>
              </div>
              {condicionesOpen && (form.serviceRules === undefined ? (
                <p className="text-[10px] text-slate-400">
                  Activá las condiciones para definir reglas IF→THEN: cuando un empleado tiene cierto código asignado, el planificador puede excluir puestos, mover guardias o restringir bandas automáticamente.
                </p>
              ) : (
                <div className="space-y-2">
                  {(form.serviceRules || []).map((rule: ServiceRule) => {
                    const isEditingThis = editingRule?.id === rule.id && !editingRuleIsNew;
                    const ruleIdx = (form.serviceRules || []).indexOf(rule);
                    return (
                      <div key={rule.id} className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden">
                        {!isEditingThis && (
                          <div className="flex items-start gap-3 px-4 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{rule.name || ('Regla ' + (ruleIdx + 1))}</p>
                              <p className="text-[9px] text-slate-400 mt-0.5 truncate">
                                SI {rule.triggers.map(t => { const codes = (t as any).shiftCodes?.length ? (t as any).shiftCodes.join('/') : t.shiftCode; return (t.employeeName || t.employeeId) + '∈{' + codes + '}'; }).join(' Y ')}
                                {' → '}{rule.actions.length} acción{rule.actions.length !== 1 ? 'es' : ''}
                              </p>
                            </div>
                            <button onClick={() => { setEditingRule(JSON.parse(JSON.stringify(rule))); setEditingRuleIsNew(false); }} className="p-1.5 rounded-lg text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors shrink-0"><Edit2 size={12}/></button>
                            <button onClick={() => deleteRule(rule.id)} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors shrink-0"><X size={12}/></button>
                          </div>
                        )}
                        {isEditingThis && editingRule && (
                          
                        <div className="px-4 py-3 space-y-4 bg-slate-50 dark:bg-slate-900/30">
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Nombre</p>
                            <input value={editingRule.name || ''} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })} placeholder="Ej: Sosa Franco - excluir puestos" className="w-full text-xs bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-violet-400" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-2">SI (todas deben cumplirse):</p>
                            {editingRule.triggers.map((t, ti) => (
                              <div key={ti} className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <select value={t.employeeId} onChange={e => updTrigger(ti, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  <option value="">— empleado —</option>
                                  {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                </select>
                                <span className="text-[9px] text-slate-400 shrink-0">tiene alguno de:</span>
                                <div className="flex flex-wrap gap-0.5">
                                  {RULE_TRIGGER_CODES.map(cc => {
                                    const _active = ((t as any).shiftCodes?.length ? (t as any).shiftCodes as string[] : [t.shiftCode]).includes(cc);
                                    return <button key={cc} type="button" onClick={() => toggleTriggerCode(ti, cc)} className={`text-[8px] font-black px-1.5 py-0.5 rounded border transition-colors ${_active ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-300 dark:border-slate-600 hover:border-violet-400'}`}>{cc}</button>;
                                  })}
                                </div>
                                {editingRule.triggers.length > 1 && (
                                  <button type="button" onClick={() => setEditingRule({ ...editingRule, triggers: editingRule.triggers.filter((_: any, i: number) => i !== ti) })} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={() => setEditingRule({ ...editingRule, triggers: [...editingRule.triggers, { employeeId: '', employeeName: '', shiftCode: 'F', shiftCodes: [] }] })} className="flex items-center gap-1 text-[9px] font-black text-violet-500 hover:text-violet-700 mt-1"><Plus size={9}/> Agregar condición</button>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-2">ENTONCES (acciones):</p>
                            {editingRule.actions.map((act: RuleAction, ai: number) => (
                              <div key={ai} className="flex items-start gap-2 mb-2 p-2 bg-white dark:bg-slate-800 rounded-lg border dark:border-slate-700 flex-wrap">
                                <select value={act.type} onChange={e => updAction(ai, 'type', e.target.value)} className="w-36 text-[9px] font-black bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5 shrink-0">
                                  <option value="EXCLUDE">Excluir puesto</option>
                                  <option value="MOVE">Mover guardia</option>
                                  <option value="RESTRICT">Restringir empleado</option>
                                  <option value="ASSIGN">Asignar empleado</option>
                                </select>
                                {act.type === 'EXCLUDE' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] text-slate-400">puesto</span>
                                    <select value={act.positionName || ''} onChange={e => updAction(ai, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">— puesto —</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">banda</span>
                                    <select value={act.shiftCode || ''} onChange={e => updAction(ai, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getPositionCodes(act.positionName || '', form.positions).map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                {act.type === 'MOVE' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] text-slate-400">de puesto</span>
                                    <select value={act.positionName || ''} onChange={e => updAction(ai, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <select value={act.shiftCode || ''} onChange={e => updAction(ai, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getPositionCodes(act.positionName || '', form.positions).map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <span className="text-[9px] text-violet-500 font-black">→</span>
                                    <select value={act.toPositionName || ''} onChange={e => updAction(ai, 'toPositionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <select value={act.toShiftCode || ''} onChange={e => updAction(ai, 'toShiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getPositionCodes(act.toPositionName || '', form.positions).map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                {act.type === 'RESTRICT' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <select value={act.employeeId || ''} onChange={e => updAction(ai, 'employeeId', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">— empleado —</option>
                                      {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">solo código</span>
                                    <select value={act.allowedCode || ''} onChange={e => updAction(ai, 'allowedCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {allServiceWorkCodes.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                {act.type === 'ASSIGN' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <select value={act.employeeId || ''} onChange={e => updAction(ai, 'employeeId', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">— empleado —</option>
                                      {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">→ puesto</span>
                                    <select value={act.positionName || ''} onChange={e => updAction(ai, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">banda</span>
                                    <select value={act.shiftCode || ''} onChange={e => updAction(ai, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getAssignCodes(act.positionName || '').map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                <button type="button" onClick={() => setEditingRule({ ...editingRule, actions: editingRule.actions.filter((_: any, i: number) => i !== ai) })} className="ml-auto p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                              </div>
                            ))}
                            <button type="button" onClick={() => setEditingRule({ ...editingRule, actions: [...editingRule.actions, { type: 'EXCLUDE' as RuleActionType, positionName: '', shiftCode: '' }] })} className="flex items-center gap-1 text-[9px] font-black text-violet-500 hover:text-violet-700 mt-1"><Plus size={9}/> Agregar acción</button>
                          </div>
                          <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
                            <button type="button" onClick={saveRule} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors"><Save size={11}/> Guardar</button>
                            <button type="button" onClick={cancelEditRule} className="px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
                            <button type="button" onClick={() => deleteRule(editingRule.id)} className="ml-auto flex items-center gap-1 text-[10px] font-black text-rose-500 hover:bg-rose-50 px-3 py-1.5 rounded-xl transition-colors"><Trash2 size={10}/> Eliminar</button>
                          </div>
                        </div>
                        )}
                      </div>
                    );
                  })}
                  {editingRuleIsNew && editingRule && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border-2 border-violet-300 dark:border-violet-700 overflow-hidden">
                      
                        <div className="px-4 py-3 space-y-4 bg-slate-50 dark:bg-slate-900/30">
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Nombre</p>
                            <input value={editingRule.name || ''} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })} placeholder="Ej: Sosa Franco - excluir puestos" className="w-full text-xs bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-violet-400" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-2">SI (todas deben cumplirse):</p>
                            {editingRule.triggers.map((t, ti) => (
                              <div key={ti} className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <select value={t.employeeId} onChange={e => updTrigger(ti, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  <option value="">— empleado —</option>
                                  {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                </select>
                                <span className="text-[9px] text-slate-400 shrink-0">tiene alguno de:</span>
                                <div className="flex flex-wrap gap-0.5">
                                  {RULE_TRIGGER_CODES.map(cc => {
                                    const _active = ((t as any).shiftCodes?.length ? (t as any).shiftCodes as string[] : [t.shiftCode]).includes(cc);
                                    return <button key={cc} type="button" onClick={() => toggleTriggerCode(ti, cc)} className={`text-[8px] font-black px-1.5 py-0.5 rounded border transition-colors ${_active ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-300 dark:border-slate-600 hover:border-violet-400'}`}>{cc}</button>;
                                  })}
                                </div>
                                {editingRule.triggers.length > 1 && (
                                  <button type="button" onClick={() => setEditingRule({ ...editingRule, triggers: editingRule.triggers.filter((_: any, i: number) => i !== ti) })} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={() => setEditingRule({ ...editingRule, triggers: [...editingRule.triggers, { employeeId: '', employeeName: '', shiftCode: 'F', shiftCodes: [] }] })} className="flex items-center gap-1 text-[9px] font-black text-violet-500 hover:text-violet-700 mt-1"><Plus size={9}/> Agregar condición</button>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-2">ENTONCES (acciones):</p>
                            {editingRule.actions.map((act: RuleAction, ai: number) => (
                              <div key={ai} className="flex items-start gap-2 mb-2 p-2 bg-white dark:bg-slate-800 rounded-lg border dark:border-slate-700 flex-wrap">
                                <select value={act.type} onChange={e => updAction(ai, 'type', e.target.value)} className="w-36 text-[9px] font-black bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5 shrink-0">
                                  <option value="EXCLUDE">Excluir puesto</option>
                                  <option value="MOVE">Mover guardia</option>
                                  <option value="RESTRICT">Restringir empleado</option>
                                  <option value="ASSIGN">Asignar empleado</option>
                                </select>
                                {act.type === 'EXCLUDE' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] text-slate-400">puesto</span>
                                    <select value={act.positionName || ''} onChange={e => updAction(ai, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">— puesto —</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">banda</span>
                                    <select value={act.shiftCode || ''} onChange={e => updAction(ai, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getPositionCodes(act.positionName || '', form.positions).map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                {act.type === 'MOVE' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] text-slate-400">de puesto</span>
                                    <select value={act.positionName || ''} onChange={e => updAction(ai, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <select value={act.shiftCode || ''} onChange={e => updAction(ai, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getPositionCodes(act.positionName || '', form.positions).map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <span className="text-[9px] text-violet-500 font-black">→</span>
                                    <select value={act.toPositionName || ''} onChange={e => updAction(ai, 'toPositionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <select value={act.toShiftCode || ''} onChange={e => updAction(ai, 'toShiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getPositionCodes(act.toPositionName || '', form.positions).map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                {act.type === 'RESTRICT' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <select value={act.employeeId || ''} onChange={e => updAction(ai, 'employeeId', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">— empleado —</option>
                                      {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">solo código</span>
                                    <select value={act.allowedCode || ''} onChange={e => updAction(ai, 'allowedCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {allServiceWorkCodes.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                {act.type === 'ASSIGN' && (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <select value={act.employeeId || ''} onChange={e => updAction(ai, 'employeeId', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">— empleado —</option>
                                      {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">→ puesto</span>
                                    <select value={act.positionName || ''} onChange={e => updAction(ai, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                    </select>
                                    <span className="text-[9px] text-slate-400">banda</span>
                                    <select value={act.shiftCode || ''} onChange={e => updAction(ai, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="">—</option>
                                      {getAssignCodes(act.positionName || '').map((c: string) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  </div>
                                )}
                                <button type="button" onClick={() => setEditingRule({ ...editingRule, actions: editingRule.actions.filter((_: any, i: number) => i !== ai) })} className="ml-auto p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                              </div>
                            ))}
                            <button type="button" onClick={() => setEditingRule({ ...editingRule, actions: [...editingRule.actions, { type: 'EXCLUDE' as RuleActionType, positionName: '', shiftCode: '' }] })} className="flex items-center gap-1 text-[9px] font-black text-violet-500 hover:text-violet-700 mt-1"><Plus size={9}/> Agregar acción</button>
                          </div>
                          <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
                            <button type="button" onClick={saveRule} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors"><Save size={11}/> Guardar</button>
                            <button type="button" onClick={cancelEditRule} className="px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
                            
                          </div>
                        </div>
                    </div>
                  )}
                  {!editingRuleIsNew && (
                    <button type="button" onClick={startNewRule} className="flex items-center gap-2 text-[10px] font-black text-violet-600 hover:text-violet-700 px-2 py-1.5 rounded-xl hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
                      <Plus size={11}/> Nueva condición
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* ── Rotaciones ── */}
            <div className="mt-8 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-xl border dark:border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => setRotacionesOpen(o => !o)} className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2 hover:text-teal-600 transition-colors">
                  <RotateCw size={16} className="text-teal-500"/> Rotaciones
                  <ChevronDown size={14} className={`text-slate-400 ml-1 transition-transform duration-200 ${rotacionesOpen ? 'rotate-180' : ''}`}/>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (form.serviceRotations !== undefined) {
                      setForm({ ...form, serviceRotations: undefined as any });
                      setEditingRotation(null);
                    } else {
                      setForm({ ...form, serviceRotations: [] });
                    }
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black border transition-colors ${form.serviceRotations !== undefined ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-600 hover:bg-slate-50'}`}
                >
                  {form.serviceRotations !== undefined ? 'Activadas' : 'Activar rotaciones'}
                </button>
              </div>
              {rotacionesOpen && (form.serviceRotations === undefined ? (
                <p className="text-[10px] text-slate-400">
                  Activá las rotaciones para definir ciclos periódicos donde los empleados rotan entre puestos y bandas automáticamente (semanal, quincenal, por día de la semana, etc.).
                </p>
              ) : (
                <div className="space-y-2">
                  {(form.serviceRotations || []).map((rot: ServiceRotation, rotIdx: number) => {
                    const isEditingThis = editingRotation?.id === rot.id && !editingRotationIsNew;
                    return (
                      <div key={rot.id} className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden">
                        {!isEditingThis && (
                          <div className="flex items-start gap-3 px-4 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{rot.name || ('Rotación ' + (rotIdx + 1))}</p>
                              <p className="text-[9px] text-slate-400 mt-0.5 truncate">
                                {rot.periods.length} período{rot.periods.length !== 1 ? 's' : ''}{rot.periods.length > 0 ? ' · ' + rot.periods.map((p: RotationPeriod) => p.label || p.trigger.type).join(' / ') : ''}
                              </p>
                            </div>
                            <button onClick={() => { setEditingRotation(JSON.parse(JSON.stringify(rot))); setEditingRotationIsNew(false); }} className="p-1.5 rounded-lg text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/30 transition-colors shrink-0"><Edit2 size={12}/></button>
                            <button onClick={() => deleteRotation(rot.id)} className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 transition-colors shrink-0"><X size={12}/></button>
                          </div>
                        )}
                        {isEditingThis && editingRotation && (
                          <div className="px-4 py-3 space-y-4 bg-slate-50 dark:bg-slate-900/30">
                            <div className="flex gap-3 flex-wrap">
                              <div className="flex-1 min-w-40">
                                <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Nombre</p>
                                <input value={editingRotation.name || ''} onChange={e => setEditingRotation({ ...editingRotation, name: e.target.value })} placeholder="Ej: Rotación semanal Control/S3" className="w-full text-xs bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-teal-400" />
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Inicio semana</p>
                                <select value={editingRotation.weekStartDay ?? 1} onChange={e => setEditingRotation({ ...editingRotation, weekStartDay: Number(e.target.value) })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d, i) => <option key={i+1} value={i+1}>{d}</option>)}
                                </select>
                              </div>
                              <div>
                                <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Modo</p>
                                <div className="flex rounded-lg overflow-hidden border dark:border-slate-600">
                                  <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: undefined })} className={!editingRotation.cycleMode ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Por período</button>
                                  <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: 'round_robin', periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: editingRotation.periods[0]?.entries || [] }] })} className={editingRotation.cycleMode === 'round_robin' ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Rota sem. a sem.</button>
                                  <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: 'cycle_rotation', cycleWorkDays: editingRotation.cycleWorkDays || 5, cycleOffDays: editingRotation.cycleOffDays || 1, periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: editingRotation.periods[0]?.entries || [] }] })} className={editingRotation.cycleMode === 'cycle_rotation' ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Rota por ciclo</button>
                                  <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: 'custom_sequence', sequenceAnchorDate: editingRotation.sequenceAnchorDate || '', periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: (editingRotation.periods[0]?.entries || []).map((e: any) => ({ ...e, sequence: e.sequence || [] })) }] })} className={editingRotation.cycleMode === 'custom_sequence' ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Por patrón</button>
                                </div>
                              </div>
                              {(editingRotation.cycleMode === 'round_robin' || (!editingRotation.cycleMode && editingRotation.periods.some((p: RotationPeriod) => p.trigger.type === 'WEEKLY'))) && (
                                <div>
                                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Semana de ref. (sem. 0)</p>
                                  <div className="flex items-center gap-1">
                                    <button type="button" title="Semana anterior" disabled={!editingRotation.referenceWeekStart} onClick={() => { const d = new Date((editingRotation.referenceWeekStart || '') + 'T00:00:00'); d.setDate(d.getDate() - 7); setEditingRotation({ ...editingRotation, referenceWeekStart: d.toISOString().split('T')[0] }); }} className="text-[10px] px-1.5 py-1 rounded border dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-100 disabled:opacity-40">←</button>
                                    <input type="date" value={editingRotation.referenceWeekStart || ''} onChange={e => setEditingRotation({ ...editingRotation, referenceWeekStart: e.target.value })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                    <button type="button" title="Semana siguiente" disabled={!editingRotation.referenceWeekStart} onClick={() => { const d = new Date((editingRotation.referenceWeekStart || '') + 'T00:00:00'); d.setDate(d.getDate() + 7); setEditingRotation({ ...editingRotation, referenceWeekStart: d.toISOString().split('T')[0] }); }} className="text-[10px] px-1.5 py-1 rounded border dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-100 disabled:opacity-40">→</button>
                                  </div>
                                  <p className="text-[9px] text-slate-400 mt-0.5">Lunes donde emp[0] usa su código base. Puede ser del mes anterior.</p>
                                </div>
                              )}
                              {(editingRotation.cycleMode === 'round_robin' || editingRotation.cycleMode === 'cycle_rotation') && (
                                <div>
                                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Ciclo</p>
                                  <div className="flex items-center gap-1.5">
                                    <input type="number" min="1" max="7" value={editingRotation.cycleWorkDays ?? ''} onChange={e => setEditingRotation({ ...editingRotation, cycleWorkDays: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="días" className="w-14 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5 text-center" />
                                    <span className="text-[9px] text-slate-400">+</span>
                                    <input type="number" min="1" max="7" value={editingRotation.cycleOffDays ?? ''} onChange={e => setEditingRotation({ ...editingRotation, cycleOffDays: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="F" className="w-10 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5 text-center" />
                                  </div>
                                  <p className="text-[9px] text-slate-400 mt-0.5">Días trabajo + días franco. Ej: 5+1 coloca F automático al planificar.</p>
                                </div>
                              )}
                              {editingRotation.cycleMode === 'cycle_rotation' && editingRotation.cycleWorkDays && editingRotation.cycleOffDays && (
                                <div>
                                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Inicio ciclo (auto-ancla)</p>
                                  <div className="flex items-center gap-1">
                                    <input type="date" value={editingRotation.cycleStartDate || ''} onChange={e => setEditingRotation({ ...editingRotation, cycleStartDate: e.target.value })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                    <button type="button" title="Auto-calcular anclas escalonadas" disabled={!editingRotation.cycleStartDate} onClick={() => { const _e0 = editingRotation.periods[0]?.entries || []; const _N = _e0.length; if (!_N || !editingRotation.cycleStartDate) return; const _cl = (editingRotation.cycleWorkDays || 5) + (editingRotation.cycleOffDays || 1); const _sg = Math.floor(_cl / _N); const _sm = new Date(editingRotation.cycleStartDate + 'T00:00:00').getTime(); const _ue = _e0.map((e: any, i: number) => ({ ...e, cycleAnchorDate: new Date(_sm - i * _sg * 86400000).toISOString().split('T')[0] })); setEditingRotation({ ...editingRotation, periods: [{ ...editingRotation.periods[0], entries: _ue }] }); }} className="text-[9px] font-black px-2 py-1.5 rounded-lg bg-teal-600 text-white disabled:opacity-40">Auto</button>
                                  </div>
                                  <p className="text-[9px] text-slate-400 mt-0.5">Escalona anclas desde el primer día. Podés ajustar cada una.</p>
                                </div>
                              )}
                              {editingRotation.cycleMode === 'custom_sequence' && (
                                <div>
                                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Día 0 del patrón</p>
                                  <input type="date" value={editingRotation.sequenceAnchorDate || ''} onChange={e => setEditingRotation({ ...editingRotation, sequenceAnchorDate: e.target.value })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                  <p className="text-[9px] text-slate-400 mt-0.5">Fecha del día 1 de la secuencia de cada empleado.</p>
                                </div>
                              )}
                              <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cumplirCondicion: !editingRotation.cumplirCondicion })} className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-black border transition-colors ${editingRotation.cumplirCondicion ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-300 dark:border-slate-600 hover:bg-slate-50'}`}>
                                {editingRotation.cumplirCondicion ? '✓' : '○'} Cumplir condiciones
                              </button>
                            </div>
                            {editingRotation.cycleMode === 'custom_sequence' ? (
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Empleados y secuencias:</p>
                            {(editingRotation.periods[0]?.entries || []).map((entry: RotationEntry, eidx: number) => (
                              <div key={eidx} className="mb-2 p-2 bg-slate-50 dark:bg-slate-700 rounded-lg border dark:border-slate-600">
                                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                  <select value={entry.employeeId} onChange={e => updRREntry(eidx, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                    <option value="">— empleado —</option>
                                    {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                  </select>
                                  <select value={entry.positionName} onChange={e => updRREntry(eidx, 'positionName', e.target.value)} className="text-[9px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                    <option value="">— puesto —</option>
                                    {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                  </select>
                                  <button type="button" onClick={() => removeRREntry(eidx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                                </div>
                                <input type="text" placeholder="F N N N N N F T T T T T  (con espacios para D12/N12)" value={((entry as any).sequence || []).join(' ')} onChange={e => updRREntry(eidx, 'sequence', e.target.value)} className="w-full text-[10px] font-mono bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                {(entry as any).sequence?.length ? <p className="text-[9px] text-teal-600 mt-0.5">{(entry as any).sequence.length} días · ciclo de {(entry as any).sequence.length} días</p> : <p className="text-[9px] text-slate-400 mt-0.5">Ej: F N N N N N F T T T T T (separados por espacio)</p>}
                              </div>
                            ))}
                            <button type="button" onClick={addRREntry} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar empleado</button>
                          </div>
                        ) : (editingRotation.cycleMode === 'round_robin' || editingRotation.cycleMode === 'cycle_rotation') ? (
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Asignaciones (rotan en orden):</p>
                            {(editingRotation.periods[0]?.entries || []).map((entry: RotationEntry, eidx: number) => (
                              <div key={eidx} className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                <select value={entry.employeeId} onChange={e => updRREntry(eidx, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  <option value="">— empleado —</option>
                                  {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                </select>
                                <span className="text-[9px] text-slate-400">→</span>
                                <select value={entry.positionName} onChange={e => updRREntry(eidx, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  <option value="">— puesto —</option>
                                  {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                </select>
                                <select value={entry.shiftCode} onChange={e => updRREntry(eidx, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  <option value="">— banda —</option>
                                  {getPositionCodes(entry.positionName, form.positions).map((cc: string) => <option key={cc} value={cc}>{cc}</option>)}
                                </select>
                                {editingRotation.cycleWorkDays && (
                                  <input type="date" title="Último franco conocido (ancla del ciclo)" value={entry.cycleAnchorDate || ''} onChange={e => updRREntry(eidx, 'cycleAnchorDate', e.target.value)} className="w-28 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                )}
                                <button type="button" onClick={() => removeRREntry(eidx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                              </div>
                            ))}
                            <button type="button" onClick={addRREntry} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar empleado</button>
                          </div>
                        ) : (
                        <div>
                          <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Períodos:</p>
                          {editingRotation.periods.map((period: RotationPeriod, pidx: number) => (
                                <div key={pidx} className="mb-3 p-3 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700">
                                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                                    <input value={period.label} onChange={e => updRotPeriod(pidx, { ...period, label: e.target.value })} placeholder="Ej: Semana A" className="flex-1 min-w-24 text-[10px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                    <select value={period.trigger.type} onChange={e => updRotPeriod(pidx, { ...period, trigger: { type: e.target.value as any } })} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                      <option value="WEEKLY">Ciclo semanal</option>
                                      <option value="DAY_OF_WEEK">Día de la semana</option>
                                      <option value="DATE_RANGE">Rango de fechas</option>
                                      <option value="FORTNIGHT">Quincena</option>
                                      <option value="WEEK_OF_MONTH">Semana del mes</option>
                                    </select>
                                    <button type="button" onClick={() => setEditingRotation({ ...editingRotation, periods: editingRotation.periods.filter((_: any, i: number) => i !== pidx) })} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                                  </div>
                                  {period.trigger.type === 'DAY_OF_WEEK' && (
                                    <div className="flex flex-wrap gap-1 mb-2">
                                      {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d, i) => {
                                        const dayNum = i + 1;
                                        const active = (period.trigger.days || []).includes(dayNum);
                                        return (
                                          <button key={dayNum} type="button" onClick={() => {
                                            const days = active ? (period.trigger.days || []).filter((x: number) => x !== dayNum) : [...(period.trigger.days || []), dayNum];
                                            updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, days } });
                                          }} className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}>{d}</button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {period.trigger.type === 'DATE_RANGE' && (
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                      <input type="date" value={period.trigger.fromDate || ''} onChange={e => updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, fromDate: e.target.value } })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                      <span className="text-[9px] text-slate-400">→</span>
                                      <input type="date" value={period.trigger.toDate || ''} onChange={e => updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, toDate: e.target.value } })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                    </div>
                                  )}
                                  {period.trigger.type === 'FORTNIGHT' && (
                                    <div className="flex gap-2 mb-2">
                                      {(['FIRST','SECOND'] as Array<'FIRST'|'SECOND'>).map(h => (
                                        <button key={h} type="button" onClick={() => updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, half: h } })} className={`text-[9px] font-black px-3 py-1 rounded-lg border transition-colors ${period.trigger.half === h ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}>{h === 'FIRST' ? '1ra quincena' : '2da quincena'}</button>
                                      ))}
                                    </div>
                                  )}
                                  {period.trigger.type === 'WEEK_OF_MONTH' && (
                                    <div className="flex flex-wrap gap-1 mb-2">
                                      {[1,2,3,4].map(wn => {
                                        const active = (period.trigger.weekNumbers || []).includes(wn);
                                        return (
                                          <button key={wn} type="button" onClick={() => {
                                            const weekNumbers = active ? (period.trigger.weekNumbers || []).filter((x: number) => x !== wn) : [...(period.trigger.weekNumbers || []), wn];
                                            updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, weekNumbers } });
                                          }} className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}>Sem {wn}</button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Asignaciones:</p>
                                  {period.entries.map((entry: RotationEntry, eidx: number) => (
                                    <div key={eidx} className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                      <select value={entry.employeeId} onChange={e => updRotEntry(pidx, eidx, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                        <option value="">— empleado —</option>
                                        {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                      </select>
                                      <span className="text-[9px] text-slate-400">→</span>
                                      <select value={entry.positionName} onChange={e => updRotEntry(pidx, eidx, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                        <option value="">— puesto —</option>
                                        {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                      </select>
                                      <select value={entry.shiftCode} onChange={e => updRotEntry(pidx, eidx, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                        <option value="">— banda —</option>
                                        {getPositionCodes(entry.positionName, form.positions).map((cc: string) => <option key={cc} value={cc}>{cc}</option>)}
                                      </select>
                                      <button type="button" onClick={() => removeRotEntry(pidx, eidx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => addRotEntry(pidx)} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar empleado</button>
                                </div>
                              ))}
                              <button type="button" onClick={() => setEditingRotation({ ...editingRotation, periods: [...editingRotation.periods, { label: '', trigger: { type: 'WEEKLY' as any }, entries: [] }] })} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar período</button>
                            </div>
                            )}
                            <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
                              <button type="button" onClick={saveRotation} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors"><Save size={11}/> Guardar</button>
                              <button type="button" onClick={cancelEditRotation} className="px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
                              <button type="button" onClick={() => deleteRotation(editingRotation.id)} className="ml-auto flex items-center gap-1 text-[10px] font-black text-rose-500 hover:bg-rose-50 px-3 py-1.5 rounded-xl transition-colors"><Trash2 size={10}/> Eliminar</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {editingRotationIsNew && editingRotation && (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border-2 border-teal-300 dark:border-teal-700 overflow-hidden">
                      <div className="px-4 py-3 space-y-4 bg-slate-50 dark:bg-slate-900/30">
                        <div className="flex gap-3 flex-wrap">
                          <div className="flex-1 min-w-40">
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Nombre</p>
                            <input value={editingRotation.name || ''} onChange={e => setEditingRotation({ ...editingRotation, name: e.target.value })} placeholder="Ej: Rotación semanal Control/S3" className="w-full text-xs bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-teal-400" />
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Inicio semana</p>
                            <select value={editingRotation.weekStartDay ?? 1} onChange={e => setEditingRotation({ ...editingRotation, weekStartDay: Number(e.target.value) })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                              {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d, i) => <option key={i+1} value={i+1}>{d}</option>)}
                            </select>
                          </div>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Modo</p>
                            <div className="flex rounded-lg overflow-hidden border dark:border-slate-600">
                              <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: undefined })} className={!editingRotation.cycleMode ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Por período</button>
                              <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: 'round_robin', periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: editingRotation.periods[0]?.entries || [] }] })} className={editingRotation.cycleMode === 'round_robin' ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Rota sem. a sem.</button>
                              <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: 'cycle_rotation', cycleWorkDays: editingRotation.cycleWorkDays || 5, cycleOffDays: editingRotation.cycleOffDays || 1, periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: editingRotation.periods[0]?.entries || [] }] })} className={editingRotation.cycleMode === 'cycle_rotation' ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Rota por ciclo</button>
                              <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cycleMode: 'custom_sequence', sequenceAnchorDate: editingRotation.sequenceAnchorDate || '', periods: [{ label: '', trigger: { type: 'WEEKLY' as any }, entries: (editingRotation.periods[0]?.entries || []).map((e: any) => ({ ...e, sequence: e.sequence || [] })) }] })} className={editingRotation.cycleMode === 'custom_sequence' ? 'text-[9px] font-black px-3 py-1.5 bg-teal-600 text-white' : 'text-[9px] font-black px-3 py-1.5 bg-white dark:bg-slate-800 text-slate-400 hover:bg-slate-50'}>Por patrón</button>
                            </div>
                          </div>
                          {(editingRotation.cycleMode === 'round_robin' || (!editingRotation.cycleMode && editingRotation.periods.some((p: RotationPeriod) => p.trigger.type === 'WEEKLY'))) && (
                            <div>
                              <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Semana de ref. (sem. 0)</p>
                              <div className="flex items-center gap-1">
                                <button type="button" title="Semana anterior" disabled={!editingRotation.referenceWeekStart} onClick={() => { const d = new Date((editingRotation.referenceWeekStart || '') + 'T00:00:00'); d.setDate(d.getDate() - 7); setEditingRotation({ ...editingRotation, referenceWeekStart: d.toISOString().split('T')[0] }); }} className="text-[10px] px-1.5 py-1 rounded border dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-100 disabled:opacity-40">←</button>
                                <input type="date" value={editingRotation.referenceWeekStart || ''} onChange={e => setEditingRotation({ ...editingRotation, referenceWeekStart: e.target.value })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                <button type="button" title="Semana siguiente" disabled={!editingRotation.referenceWeekStart} onClick={() => { const d = new Date((editingRotation.referenceWeekStart || '') + 'T00:00:00'); d.setDate(d.getDate() + 7); setEditingRotation({ ...editingRotation, referenceWeekStart: d.toISOString().split('T')[0] }); }} className="text-[10px] px-1.5 py-1 rounded border dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:bg-slate-100 disabled:opacity-40">→</button>
                              </div>
                              <p className="text-[9px] text-slate-400 mt-0.5">Lunes donde emp[0] usa su código base. Puede ser del mes anterior.</p>
                            </div>
                          )}
                          {(editingRotation.cycleMode === 'round_robin' || editingRotation.cycleMode === 'cycle_rotation') && (
                            <div>
                              <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Ciclo</p>
                              <div className="flex items-center gap-1.5">
                                <input type="number" min="1" max="7" value={editingRotation.cycleWorkDays ?? ''} onChange={e => setEditingRotation({ ...editingRotation, cycleWorkDays: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="días" className="w-14 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5 text-center" />
                                <span className="text-[9px] text-slate-400">+</span>
                                <input type="number" min="1" max="7" value={editingRotation.cycleOffDays ?? ''} onChange={e => setEditingRotation({ ...editingRotation, cycleOffDays: e.target.value ? parseInt(e.target.value) : undefined })} placeholder="F" className="w-10 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5 text-center" />
                              </div>
                              <p className="text-[9px] text-slate-400 mt-0.5">Días trabajo + días franco. Ej: 5+1 coloca F automático al planificar.</p>
                            </div>
                          )}
                          {editingRotation.cycleMode === 'cycle_rotation' && editingRotation.cycleWorkDays && editingRotation.cycleOffDays && (
                            <div>
                              <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Inicio ciclo (auto-ancla)</p>
                              <div className="flex items-center gap-1">
                                <input type="date" value={editingRotation.cycleStartDate || ''} onChange={e => setEditingRotation({ ...editingRotation, cycleStartDate: e.target.value })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                <button type="button" title="Auto-calcular anclas escalonadas" disabled={!editingRotation.cycleStartDate} onClick={() => { const _e0 = editingRotation.periods[0]?.entries || []; const _N = _e0.length; if (!_N || !editingRotation.cycleStartDate) return; const _cl = (editingRotation.cycleWorkDays || 5) + (editingRotation.cycleOffDays || 1); const _sg = Math.floor(_cl / _N); const _sm = new Date(editingRotation.cycleStartDate + 'T00:00:00').getTime(); const _ue = _e0.map((e: any, i: number) => ({ ...e, cycleAnchorDate: new Date(_sm - i * _sg * 86400000).toISOString().split('T')[0] })); setEditingRotation({ ...editingRotation, periods: [{ ...editingRotation.periods[0], entries: _ue }] }); }} className="text-[9px] font-black px-2 py-1.5 rounded-lg bg-teal-600 text-white disabled:opacity-40">Auto</button>
                              </div>
                              <p className="text-[9px] text-slate-400 mt-0.5">Escalona anclas desde el primer día. Podés ajustar cada una.</p>
                            </div>
                          )}
                          {editingRotation.cycleMode === 'custom_sequence' && (
                            <div>
                              <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Día 0 del patrón</p>
                              <input type="date" value={editingRotation.sequenceAnchorDate || ''} onChange={e => setEditingRotation({ ...editingRotation, sequenceAnchorDate: e.target.value })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                              <p className="text-[9px] text-slate-400 mt-0.5">Fecha del día 1 de la secuencia de cada empleado.</p>
                            </div>
                          )}
                          <button type="button" onClick={() => setEditingRotation({ ...editingRotation, cumplirCondicion: !editingRotation.cumplirCondicion })} className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-black border transition-colors ${editingRotation.cumplirCondicion ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-300 dark:border-slate-600 hover:bg-slate-50'}`}>
                            {editingRotation.cumplirCondicion ? '✓' : '○'} Cumplir condiciones
                          </button>
                        </div>
                        {editingRotation.cycleMode === 'custom_sequence' ? (
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Empleados y secuencias:</p>
                    {(editingRotation.periods[0]?.entries || []).map((entry: RotationEntry, eidx: number) => (
                      <div key={eidx} className="mb-2 p-2 bg-slate-50 dark:bg-slate-700 rounded-lg border dark:border-slate-600">
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <select value={entry.employeeId} onChange={e => updRREntry(eidx, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                            <option value="">— empleado —</option>
                            {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                          </select>
                          <select value={entry.positionName} onChange={e => updRREntry(eidx, 'positionName', e.target.value)} className="text-[9px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                            <option value="">— puesto —</option>
                            {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                          </select>
                          <button type="button" onClick={() => removeRREntry(eidx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                        </div>
                        <input type="text" placeholder="F N N N N N F T T T T T  (con espacios para D12/N12)" value={((entry as any).sequence || []).join(' ')} onChange={e => updRREntry(eidx, 'sequence', e.target.value)} className="w-full text-[10px] font-mono bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                        {(entry as any).sequence?.length ? <p className="text-[9px] text-teal-600 mt-0.5">{(entry as any).sequence.length} días · ciclo de {(entry as any).sequence.length} días</p> : <p className="text-[9px] text-slate-400 mt-0.5">Ej: F N N N N N F T T T T T (separados por espacio)</p>}
                      </div>
                    ))}
                    <button type="button" onClick={addRREntry} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar empleado</button>
                  </div>
                ) : (editingRotation.cycleMode === 'round_robin' || editingRotation.cycleMode === 'cycle_rotation') ? (
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Asignaciones (rotan en orden):</p>
                    {(editingRotation.periods[0]?.entries || []).map((entry: RotationEntry, eidx: number) => (
                      <div key={eidx} className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <select value={entry.employeeId} onChange={e => updRREntry(eidx, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                          <option value="">— empleado —</option>
                          {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                        </select>
                        <span className="text-[9px] text-slate-400">→</span>
                        <select value={entry.positionName} onChange={e => updRREntry(eidx, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                          <option value="">— puesto —</option>
                          {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </select>
                        <select value={entry.shiftCode} onChange={e => updRREntry(eidx, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                          <option value="">— banda —</option>
                          {getPositionCodes(entry.positionName, form.positions).map((cc: string) => <option key={cc} value={cc}>{cc}</option>)}
                        </select>
                        {editingRotation.cycleWorkDays && (
                          <input type="date" title="Último franco conocido (ancla del ciclo)" value={entry.cycleAnchorDate || ''} onChange={e => updRREntry(eidx, 'cycleAnchorDate', e.target.value)} className="w-28 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                        )}
                        <button type="button" onClick={() => removeRREntry(eidx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                      </div>
                    ))}
                    <button type="button" onClick={addRREntry} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar empleado</button>
                  </div>
                ) : (
                <div>
                  <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Períodos:</p>
                  {editingRotation.periods.map((period: RotationPeriod, pidx: number) => (
                            <div key={pidx} className="mb-3 p-3 bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <input value={period.label} onChange={e => updRotPeriod(pidx, { ...period, label: e.target.value })} placeholder="Ej: Semana A" className="flex-1 min-w-24 text-[10px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                <select value={period.trigger.type} onChange={e => updRotPeriod(pidx, { ...period, trigger: { type: e.target.value as any } })} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                  <option value="WEEKLY">Ciclo semanal</option>
                                  <option value="DAY_OF_WEEK">Día de la semana</option>
                                  <option value="DATE_RANGE">Rango de fechas</option>
                                  <option value="FORTNIGHT">Quincena</option>
                                  <option value="WEEK_OF_MONTH">Semana del mes</option>
                                </select>
                                <button type="button" onClick={() => setEditingRotation({ ...editingRotation, periods: editingRotation.periods.filter((_: any, i: number) => i !== pidx) })} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                              </div>
                              {period.trigger.type === 'DAY_OF_WEEK' && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d, i) => {
                                    const dayNum = i + 1;
                                    const active = (period.trigger.days || []).includes(dayNum);
                                    return (
                                      <button key={dayNum} type="button" onClick={() => {
                                        const days = active ? (period.trigger.days || []).filter((x: number) => x !== dayNum) : [...(period.trigger.days || []), dayNum];
                                        updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, days } });
                                      }} className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}>{d}</button>
                                    );
                                  })}
                                </div>
                              )}
                              {period.trigger.type === 'DATE_RANGE' && (
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <input type="date" value={period.trigger.fromDate || ''} onChange={e => updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, fromDate: e.target.value } })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                  <span className="text-[9px] text-slate-400">→</span>
                                  <input type="date" value={period.trigger.toDate || ''} onChange={e => updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, toDate: e.target.value } })} className="text-[10px] bg-white dark:bg-slate-800 border dark:border-slate-600 rounded-lg px-2 py-1.5" />
                                </div>
                              )}
                              {period.trigger.type === 'FORTNIGHT' && (
                                <div className="flex gap-2 mb-2">
                                  {(['FIRST','SECOND'] as Array<'FIRST'|'SECOND'>).map(h => (
                                    <button key={h} type="button" onClick={() => updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, half: h } })} className={`text-[9px] font-black px-3 py-1 rounded-lg border transition-colors ${period.trigger.half === h ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}>{h === 'FIRST' ? '1ra quincena' : '2da quincena'}</button>
                                  ))}
                                </div>
                              )}
                              {period.trigger.type === 'WEEK_OF_MONTH' && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {[1,2,3,4].map(wn => {
                                    const active = (period.trigger.weekNumbers || []).includes(wn);
                                    return (
                                      <button key={wn} type="button" onClick={() => {
                                        const weekNumbers = active ? (period.trigger.weekNumbers || []).filter((x: number) => x !== wn) : [...(period.trigger.weekNumbers || []), wn];
                                        updRotPeriod(pidx, { ...period, trigger: { ...period.trigger, weekNumbers } });
                                      }} className={`text-[9px] font-black px-2 py-1 rounded-lg border transition-colors ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-slate-400 border-slate-200 dark:border-slate-600'}`}>Sem {wn}</button>
                                    );
                                  })}
                                </div>
                              )}
                              <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Asignaciones:</p>
                              {period.entries.map((entry: RotationEntry, eidx: number) => (
                                <div key={eidx} className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                  <select value={entry.employeeId} onChange={e => updRotEntry(pidx, eidx, 'employeeId', e.target.value)} className="flex-1 min-w-0 text-[10px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                    <option value="">— empleado —</option>
                                    {coverageEmps.map((e: any) => <option key={e.id} value={e.id}>{e.name || ((e.firstName || '') + ' ' + (e.lastName || '')).trim()}</option>)}
                                  </select>
                                  <span className="text-[9px] text-slate-400">→</span>
                                  <select value={entry.positionName} onChange={e => updRotEntry(pidx, eidx, 'positionName', e.target.value)} className="text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                    <option value="">— puesto —</option>
                                    {form.positions.map((p: ServicePosition) => <option key={p.id} value={p.name}>{p.name}</option>)}
                                  </select>
                                  <select value={entry.shiftCode} onChange={e => updRotEntry(pidx, eidx, 'shiftCode', e.target.value)} className="w-20 text-[9px] bg-slate-50 dark:bg-slate-700 border dark:border-slate-600 rounded-lg px-2 py-1.5">
                                    <option value="">— banda —</option>
                                    {getPositionCodes(entry.positionName, form.positions).map((cc: string) => <option key={cc} value={cc}>{cc}</option>)}
                                  </select>
                                  <button type="button" onClick={() => removeRotEntry(pidx, eidx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded-lg shrink-0"><X size={10}/></button>
                                </div>
                              ))}
                              <button type="button" onClick={() => addRotEntry(pidx)} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar empleado</button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setEditingRotation({ ...editingRotation, periods: [...editingRotation.periods, { label: '', trigger: { type: 'WEEKLY' as any }, entries: [] }] })} className="flex items-center gap-1 text-[9px] font-black text-teal-500 hover:text-teal-700 mt-1"><Plus size={9}/> Agregar período</button>
                        </div>
                        )}
                        <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
                          <button type="button" onClick={saveRotation} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-colors"><Save size={11}/> Guardar</button>
                          <button type="button" onClick={cancelEditRotation} className="px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">Cancelar</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {!editingRotationIsNew && (
                    <button type="button" onClick={startNewRotation} className="flex items-center gap-2 text-[10px] font-black text-teal-600 hover:text-teal-700 px-2 py-1.5 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors">
                      <Plus size={11}/> Nueva rotación
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* ── Historial de horarios (solo al editar un contrato existente) ── */}
            {isEditing && form.id && (
              <div className="mt-8 bg-slate-50 dark:bg-slate-900/30 p-6 rounded-xl border dark:border-slate-700/50">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black uppercase text-slate-700 dark:text-white flex items-center gap-2">
                    <Clock size={16} className="text-indigo-500"/> Historial de Horarios
                  </h3>
                  {!showHorarioForm && (
                    <button
                      onClick={openHorarioForm}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-1 shadow-md transition-colors"
                    >
                      <Plus size={11}/> Cambiar desde fecha
                    </button>
                  )}
                </div>

                {/* Timeline de versiones */}
                {(!form.horarioVersiones || form.horarioVersiones.length === 0) ? (
                  <p className="text-[10px] text-slate-400">
                    Sin cambios de horario registrados — el horario base es el definido en cada puesto.
                  </p>
                ) : (
                  <div className="space-y-1 mb-4">
                    {[...form.horarioVersiones]
                      .sort((a, b) => b.desde.localeCompare(a.desde))
                      .map((v, i) => (
                        <div key={i} className="flex items-start gap-3 text-[10px] py-1 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                          <span className="font-black text-indigo-600 dark:text-indigo-400 w-24 shrink-0">Desde {v.desde}</span>
                          {(v as any).puesto && (
                            <span className="text-[9px] font-black bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded shrink-0">{(v as any).puesto}</span>
                          )}
                          <span className="text-slate-600 dark:text-slate-400 flex-1">
                            {Object.entries(v.bandas)
                              .map(([c, b]) => `${c} ${b.startTime}–${b.endTime}`)
                              .join(' · ')}
                          </span>
                          {(v as any).changedBy && (
                            <span className="text-[9px] text-slate-400 shrink-0 italic">{(v as any).changedBy}</span>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                {/* Formulario inline para nueva versión */}
                {showHorarioForm && (() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const selPos = horarioFormPuesto !== 'ALL' ? form.positions.find(p => p.name === horarioFormPuesto) : null;
                  const posCustom = selPos ? isCustomPosition(selPos) : false;
                  const preview = posCustom
                    ? buildBandasForCustom(horarioFormCustomTimes, selPos!.allowedShiftTypes)
                    : buildBandasFromAnchors(horarioFormAnchorM, horarioFormAnchorD12);
                  return (
                    <div className="mt-4 bg-white dark:bg-slate-800 p-5 rounded-xl border dark:border-slate-700 space-y-4">
                      <p className="text-[10px] font-black uppercase text-slate-400">Nuevo cambio de horario</p>

                      {/* Selector de puesto */}
                      {form.positions.length > 1 && (
                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">Puesto a modificar</label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setHorarioFormPuesto('ALL');
                                const m = form.positions.flatMap(p => p.allowedShiftTypes).find(s => s.code === 'M');
                                const d = form.positions.flatMap(p => p.allowedShiftTypes).find(s => s.code === 'D12');
                                if (m) setHorarioFormAnchorM(m.startTime.slice(0, 5));
                                if (d) setHorarioFormAnchorD12(d.startTime.slice(0, 5));
                              }}
                              className={`px-3 py-1.5 rounded-xl text-[10px] font-black border transition-colors ${horarioFormPuesto === 'ALL' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-600 hover:bg-slate-200'}`}
                            >Todos los puestos</button>
                            {form.positions.map(pos => (
                              <button
                                key={pos.id}
                                onClick={() => {
                                  setHorarioFormPuesto(pos.name);
                                  if (isCustomPosition(pos)) {
                                    initCustomTimesForPos(pos);
                                  } else {
                                    const m = pos.allowedShiftTypes.find(s => s.code === 'M');
                                    const d = pos.allowedShiftTypes.find(s => s.code === 'D12');
                                    setHorarioFormAnchorM(m?.startTime?.slice(0, 5) || '07:00');
                                    setHorarioFormAnchorD12(d?.startTime?.slice(0, 5) || '07:00');
                                  }
                                }}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-black border transition-colors ${horarioFormPuesto === pos.name ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-600 hover:bg-slate-200'}`}
                              >
                                {pos.name}
                                {isCustomPosition(pos) && <span className="ml-1 text-[8px] opacity-70">custom</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Fecha */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Desde (fecha)</label>
                          <input
                            type="date"
                            value={horarioFormDesde}
                            min={today}
                            onChange={e => setHorarioFormDesde(e.target.value)}
                            className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl text-xs font-bold dark:text-white"
                          />
                          {horarioFormDesde && horarioFormDesde < today && (
                            <p className="text-[9px] text-rose-500 font-bold mt-1">La fecha debe ser hoy o posterior</p>
                          )}
                        </div>
                        {/* Anclas para puestos estándar */}
                        {!posCustom && (
                          <>
                            <div>
                              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Inicio M → T → N</label>
                              <input
                                type="time"
                                value={horarioFormAnchorM}
                                onChange={e => setHorarioFormAnchorM(e.target.value)}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl text-xs font-bold dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase text-slate-400 block mb-1">Inicio D12 → N12</label>
                              <input
                                type="time"
                                value={horarioFormAnchorD12}
                                onChange={e => setHorarioFormAnchorD12(e.target.value)}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-xl text-xs font-bold dark:text-white"
                              />
                            </div>
                          </>
                        )}
                      </div>

                      {/* Inputs individuales para puestos custom */}
                      {posCustom && selPos && (
                        <div>
                          <label className="text-[10px] font-black uppercase text-slate-400 block mb-2">Horarios por turno (puesto custom)</label>
                          <div className="space-y-2">
                            {selPos.allowedShiftTypes.filter(s => s.isCustom).map(sh => (
                              <div key={sh.code} className="grid grid-cols-3 gap-2 items-center">
                                <span className="text-[11px] font-black text-slate-700 dark:text-slate-300">{sh.code} <span className="font-normal text-slate-400">{sh.name}</span></span>
                                <div>
                                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">Inicio</label>
                                  <input
                                    type="time"
                                    value={horarioFormCustomTimes[sh.code]?.startTime || sh.startTime.slice(0, 5)}
                                    onChange={e => setHorarioFormCustomTimes(prev => ({ ...prev, [sh.code]: { ...prev[sh.code], startTime: e.target.value, endTime: prev[sh.code]?.endTime || sh.endTime.slice(0, 5) } }))}
                                    className="w-full p-2 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-lg text-xs font-bold dark:text-white"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">Fin</label>
                                  <input
                                    type="time"
                                    value={horarioFormCustomTimes[sh.code]?.endTime || sh.endTime.slice(0, 5)}
                                    onChange={e => setHorarioFormCustomTimes(prev => ({ ...prev, [sh.code]: { startTime: prev[sh.code]?.startTime || sh.startTime.slice(0, 5), endTime: e.target.value } }))}
                                    className="w-full p-2 bg-slate-50 dark:bg-slate-900 border dark:border-slate-600 rounded-lg text-xs font-bold dark:text-white"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Preview */}
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(preview).map(([c, b]) => (
                          <span key={c} className="text-[10px] font-black bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-700">
                            {c} {b.startTime} – {b.endTime} · {b.hours}h
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={() => setShowHorarioForm(false)}
                          className="flex-1 py-2 bg-slate-100 dark:bg-slate-700 text-slate-500 font-bold rounded-xl text-xs uppercase hover:bg-slate-200 transition-colors"
                        >Cancelar</button>
                        <button
                          onClick={handleApplyHorarioVersion}
                          disabled={savingHorario || !horarioFormDesde || horarioFormDesde < today}
                          className="flex-1 py-2 bg-indigo-600 text-white font-black rounded-xl text-xs uppercase shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {savingHorario ? 'Aplicando…' : 'Aplicar cambio'}
                        </button>
                      </div>
                      <p className="text-[9px] text-slate-400">
                        Al confirmar: se actualiza el SLA y se reprograman todos los turnos existentes de este objetivo a partir de la fecha indicada.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

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
                             {['M', 'T', 'N'].every((c) =>
                                positionForm.allowedShiftTypes.some((x) => x.code === c && !x.isCustom),
                             ) && (
                                <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/30 p-3 text-[10px] text-indigo-900 dark:text-indigo-100">
                                    <p className="font-black uppercase text-indigo-600 dark:text-indigo-300 mb-1">M + T + N en puesto personalizado</p>
                                    <p>
                                        No es cobertura <b>24 horas rotativa</b>: son <b>3 cupos en simultáneo</b> por día
                                        (tres guardias: mañana, tarde y noche). Si querés que cada guardia rote M→T→N en el mes,
                                        cambiá el tipo de cobertura a <b>24 HORAS (Lunes a Lunes)</b>.
                                    </p>
                                </div>
                             )}
                            
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
                                    <div className="w-20"><span className="text-[9px] text-slate-400">{newCustomShift.hasBlock2 ? 'B1 inicio' : 'Inicio'}</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border text-center" value={newCustomShift.start} onChange={e => setNewCustomShift({...newCustomShift, start: e.target.value})}/></div>
                                    <div className="w-20"><span className="text-[9px] text-slate-400">{newCustomShift.hasBlock2 ? 'B1 fin' : 'Fin'}</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border text-center" value={newCustomShift.end} onChange={e => setNewCustomShift({...newCustomShift, end: e.target.value})}/></div>
                                </div>
                                {/* Turno cortado — segundo bloque */}
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => setNewCustomShift(prev => ({ ...prev, hasBlock2: !prev.hasBlock2 }))} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black border transition-colors ${newCustomShift.hasBlock2 ? 'bg-amber-100 border-amber-400 text-amber-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'}`}>
                                        ✂ {newCustomShift.hasBlock2 ? 'Turno cortado activo' : 'Agregar turno cortado'}
                                    </button>
                                    {newCustomShift.hasBlock2 && newCustomShift.block2Start && newCustomShift.block2End && (
                                        <span className="text-[9px] text-amber-600 font-bold">
                                            {calculateShiftHours(newCustomShift.start, newCustomShift.end) + calculateShiftHours(newCustomShift.block2Start, newCustomShift.block2End)}h total
                                        </span>
                                    )}
                                </div>
                                {newCustomShift.hasBlock2 && (
                                    <div className="flex gap-2 items-end bg-amber-50 border border-amber-200 rounded-lg p-2">
                                        <span className="text-[9px] font-black text-amber-600 self-end pb-1.5">Bloque 2</span>
                                        <div className="w-20"><span className="text-[9px] text-slate-400">Inicio</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border border-amber-300 text-center" value={newCustomShift.block2Start} onChange={e => setNewCustomShift({...newCustomShift, block2Start: e.target.value})}/></div>
                                        <div className="w-20"><span className="text-[9px] text-slate-400">Fin</span><input type="time" className="w-full p-2 text-xs font-bold rounded-lg border border-amber-300 text-center" value={newCustomShift.block2End} onChange={e => setNewCustomShift({...newCustomShift, block2End: e.target.value})}/></div>
                                    </div>
                                )}
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
                                <div key={`shift_row_${vIdx}`} className={`flex items-center gap-3 bg-white dark:bg-slate-800 px-3 py-2.5 rounded-xl border shadow-sm transition-all ${isBeingEdited ? 'border-indigo-400 ring-2 ring-indigo-200' : 'dark:border-slate-600'}`}>
                                    {/* Sigla editable inline — key estable por índice para no perder foco al tipear */}
                                    <input
                                      value={v.code}
                                      maxLength={3}
                                      title="Sigla del turno en planificador (hasta 3 letras)"
                                      className={`w-12 h-8 text-center text-[10px] font-black rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-400 uppercase cursor-text ${v.isCustom ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 text-orange-600' : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 text-indigo-700 dark:text-indigo-300'}`}
                                      onChange={e => {
                                        const prevCode = v.code;
                                        const newCode = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
                                        setPositionForm(prev => ({
                                          ...prev,
                                          allowedShiftTypes: prev.allowedShiftTypes.map((x, i) =>
                                            i === vIdx ? { ...x, code: newCode } : x
                                          ),
                                        }));
                                        // Mantener vínculo de edición si estábamos editando este turno
                                        if (editingShiftCode !== null && editingShiftCode === prevCode) {
                                          setEditingShiftCode(newCode);
                                          setNewCustomShift(prev => ({ ...prev, code: newCode }));
                                        }
                                      }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-black text-slate-700 dark:text-white uppercase leading-none">{v.name}</p>
                                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            {v.blocks && v.blocks.length >= 2
                                                ? <p className="text-[9px] text-amber-600 font-mono font-black">✂ {v.blocks[0].startTime}–{v.blocks[0].endTime} + {v.blocks[1].startTime}–{v.blocks[1].endTime} · {v.hours}h</p>
                                                : <p className="text-[9px] text-slate-400 font-mono">{v.startTime} – {v.endTime} · {v.hours}h</p>
                                            }
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
