import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageShell, PageHeader, ModuleShell } from '@/components/ui';
import { auth, db } from '@/lib/firebase';
import { readSessionJson, writeSessionJson } from '@/lib/persistSession';
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Toaster, toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { useAuth } from '@/context/AuthContext';
import {
  shouldScopeQueriesToEmpresa,
  empresaCollectionQuery,
  belongsToEmpresaView,
  slaBelongsToEmpresa,
  deleteClientForEmpresa,
  assertClientWritableForEmpresa,
  assertDocBelongsToEmpresa,
  queryAndDeleteForEmpresa,
  updateDocForEmpresa,
  updateClientForEmpresa,
  TenantIsolationError,
  isTenantIsolationError,
  canManageClientInTenant,
  isTenantWriteOwner,
  buildTenantBlockedMessage,
  retagClientRelatedDocsToEmpresa,
  countClientRelatedDocsOtherTenant,
  dedupeClientsById,
  tenantEmpresaIdsMatch,
  getClientIdAliases,
  collectTurnoIdsForSlaDelete,
  deleteSlaWithRelatedDataForEmpresa,
} from '@/lib/multiempresa';
import {
  AlertCircle,
  BarChart3,
  Building2,
  Calculator,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  Globe,
  Grid3x3,
  LayoutList,
  Loader2,
  Mail,
  MapPin,
  Navigation,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import ProformaPanel from '@/components/crm/ProformaPanel';
import CrmDashboardSummary from '@/components/crm/CrmDashboardSummary';
import CrmClientListCard from '@/components/crm/CrmClientListCard';
import { formatMoney } from '@/lib/crm/proformaFormat';
import { resolveObjectiveDisplayName, formatProformaObjectiveLabel } from '@/lib/crm/objectiveIdentity';
import {
  buildProformaObjectiveAliases,
  enrichTurnosForProforma,
  hydrateEmployeeMetaFromTurnoIds,
  normalizeClientObjetivo,
  registerEmployeeMetaAliases,
} from '@/lib/crm/proformaEnrichment';
import {
  fetchSlaRowsForCrmDashboard,
  fetchContractsForCrmDashboard,
  fetchCrmDashboardTurnos,
  loadClientSlaForClient,
  loadClientTurnosForClient,
  indexSlaRowsByClients,
  collectClientIdAliases,
  clientRowMatchesClient,
  type ClientRef,
} from '@/lib/crm/clientDataMatch';
import { resolveTurnoScheduleDateKey } from '@/lib/crm/crmDateUtils';
import { solicitudRefuerzoService } from '@/services/solicitudRefuerzoService';
import { buildProformaObjectiveGrids, buildPeriodLabel, buildProformaSummary } from '@/lib/crm/proformaGrid';
import { turnoEligibleForProformaGrid, type ProformaDetailMode } from '@/lib/crm/proformaMode';
import { isSinCoberturaShift } from '@/lib/crm/proformaVacancy';
import type { ProformaExportBundle } from '@/lib/crm/proformaTypes';
import { exportProformaCsv, exportProformaExcel, exportProformaPdf } from '@/lib/crm/proformaExport';
import { lookupClientByCuitFromAfip, type AfipClientLookupResult } from '@/services/afipClientLookup';
import { callableErrorText } from '@/lib/callableError';
import {
  fetchHoursBalances,
  persistHoursBalancesFromTurnos,
  sumBalancesByClient,
  balancesCoverObjectives,
  overlayLiveSlaOnBalanceRows,
} from '@/lib/hoursBalance';
import {
  calculateMonthlyBreakdown,
} from '@/lib/servicios/slaHoursCalculator';
import {
  CRM_PLANNED_SHIFT_HOURS,
  getDurationHours,
  isCrmPlannedEligibleShift,
  isCrmWorkingShiftCode,
  resolveClientIdForTurno,
  resolveCrmPlannedShiftHours,
  sumPlannedHoursForClient,
  groupTurnosByClient,
  buildSlaCodeHoursHintFromServices,
  buildSlaCodeHoursHintByObjectiveId,
  toDateSafe,
} from '@/lib/crm/plannedHours';
import { slaHoursForServiceInRange, sumVigenteSlaHoursInRange, pickVigenteSlasForPeriod } from '@/lib/crm/slaObjectiveHours';
import { buildSlaExclusionContext, isTurnoOnSlaExcludedSlot } from '@/lib/crm/slaExclusionForPlanned';
import { buildCrmTrendBuckets, crmTrendChartTitle, crmRangeLabel, crmRangeSpan, crmMetricsCacheKey, type CrmRangeMode } from '@/lib/crm/crmDashboardBuckets';
import { aggregateCrmHoursByClient, buildCrmDailyTrendSeries } from '@/lib/crm/crmDashboardAggregate';
import type { CrmTrendPoint, ClientListFilter, ClientListSort } from '@/components/crm/CrmDashboardSummary';
import { slaFootprintFromServices, summarizeCrmCommercial, type CrmSlaFootprint } from '@/lib/crm/crmCommercialStats';
import { coalescePlannedTurnosForCell, coalescePlannedCellBillableHours } from '@/lib/planificacion/planningTurnoCoalesce';
import {
  applyRefuerzoHorasVendidasToGrids,
  applyRefuerzoHorasVendidasToBreakdown,
  solicitudIdsBilledInRange,
} from '@/lib/refuerzo/refuerzoProforma';

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/** Incrementar cuando cambia la fórmula de KPIs (plan = base + ext + adel) para invalidar snapshot/cache. */
const CRM_DASHBOARD_METRICS_VERSION = 5;

function crmBurnVisual(burnRate: number) {
  const burn = Math.round(burnRate || 0);
  const hex = burn >= 110 ? '#ef4444' : burn >= 90 ? '#f59e0b' : '#10b981';
  const textCls = burn >= 110 ? 'text-rose-600' : burn >= 90 ? 'text-amber-500' : 'text-emerald-600';
  const badgeCls = burn >= 110
    ? 'bg-rose-50 text-rose-600 border-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-800'
    : burn >= 90
      ? 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800'
      : 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800';
  return { burn, hex, textCls, badgeCls };
}

function crmEjecLabel(real: number, sla: number, planned: number): string {
  const r = Math.round(real || 0);
  if (r > 0) return `${r} hs`;
  if ((sla || 0) > 0 || (planned || 0) > 0) return 'Sin fichadas';
  return '0 hs';
}

/** Firestore / imports legacy: ACTIVE, activo, etc. → etiqueta UI en español. */
function formatClientStatusLabel(status: unknown): string {
  const u = String(status ?? 'ACTIVO').trim().toUpperCase();
  if (u === 'ACTIVE' || u === 'ACTIVO') return 'ACTIVO';
  if (u === 'INACTIVE' || u === 'INACTIVO') return 'INACTIVO';
  return u || 'ACTIVO';
}

function isClientStatusActivo(status: unknown): boolean {
  const u = String(status ?? 'ACTIVO').trim().toUpperCase();
  return u === 'ACTIVO' || u === 'ACTIVE';
}

function resolveCanonicalClientIdForCrmRow(
  rowClientId: unknown,
  clientList: { id: string }[],
): string | null {
  const cid = String(rowClientId ?? '').trim();
  if (!cid) return null;
  for (const c of clientList) {
    if (c.id === cid) return c.id;
    if (getClientIdAliases(c.id).includes(cid)) return c.id;
  }
  return null;
}

const SHIFT_CODE_HOURS = CRM_PLANNED_SHIFT_HOURS;
const isWorkingCode = isCrmWorkingShiftCode;

const sumContractSlaHours = (
  positions: any[],
  startStr: string,
  endStr: string,
  excludedDates: string[] | undefined,
  rangeStart: Date | null,
  rangeEnd: Date | null,
  totalMonthlyHours?: number,
) => {
  if (rangeStart && rangeEnd) {
    const srv = { positions, startDate: startStr, endDate: endStr, excludedDates, totalMonthlyHours };
    return slaHoursForServiceInRange(srv, rangeStart, rangeEnd);
  }
  return Math.round(
    calculateMonthlyBreakdown(positions, startStr, endStr, excludedDates).reduce((acc, m) => acc + m.totalHours, 0),
  );
};

const getDateKeyInTimezone = (date: Date) => {
  const parts = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;
  return `${year}-${month}-${day}`;
};

const monthRangeYmd = (year: number, month: number) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: `${year}-${pad(month + 1)}-01`,
    end: `${year}-${pad(month + 1)}-${pad(lastDay)}`,
  };
};

const clampDateRange = (start: Date | null, end: Date | null, min: Date | null, max: Date | null) => {
  const s = start && min ? (start > min ? start : min) : (start || min);
  const e = end && max ? (end < max ? end : max) : (end || max);
  if (s && e && s > e) return null;
  return { start: s, end: e };
};

type RangeMode = CrmRangeMode;
type ViewMode = 'grid' | 'list';
type ProformaBase = 'requested' | 'planned' | 'executed';

export default function CRMPage() {
  const router = useRouter();
  const { empresaId, empresa } = useEmpresa();
  const { user: authUser, isSuperAdmin, allEmpresas } = useAuth();
  const migracionCompleta = (empresa as any)?.migracionCompleta === true;
  const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
  const tenantAccess = useMemo(
    () => ({ isSuperAdmin, allEmpresas }),
    [isSuperAdmin, allEmpresas],
  );

  const [view, setView] = useState<'list' | 'detail'>('list');
  const [activeTab, setActiveTab] = useState('INFO');
  const [currentUserName, setCurrentUserName] = useState('Cargando...');

  const [rangeMode, setRangeMode] = useState<RangeMode>('month');
  const [rangeMonth, setRangeMonth] = useState(new Date().getMonth());
  const [rangeYear, setRangeYear] = useState(new Date().getFullYear());
  const [clientListSort, setClientListSort] = useState<ClientListSort>('name');
  const [clientListFilter, setClientListFilter] = useState<ClientListFilter>('all');
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState<Date | null>(null);
  const metricsRunRef = useRef(0);
  const clientsFetchGenRef = useRef(0);
  const metricsCache = useRef<Map<string, { metrics: any; trend: any[]; updatedAt: Date; footprint?: CrmSlaFootprint | null }>>(new Map());
  const periodMetricsRef = useRef<Map<string, {
    metrics: Record<string, any>;
    totals: { totalSold: number; totalPlanned: number; totalExecuted: number };
    updatedAt: Date;
  }>>(new Map());
  const sharedEmpMetaRef = useRef<Record<string, { legajo?: string; name?: string }>>({});

  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);

  const [clientServices, setClientServices] = useState<any[]>([]);
  const [clientContracts, setClientContracts] = useState<any[]>([]);
  const [clientQuotes, setClientQuotes] = useState<any[]>([]);
  const [foreignRelatedCounts, setForeignRelatedCounts] = useState({ servicios_sla: 0, turnos: 0 });
  const [retaggingRelated, setRetaggingRelated] = useState(false);

  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [calculatingMetrics, setCalculatingMetrics] = useState(false);
  const [metricsLoadProgress, setMetricsLoadProgress] = useState<{ pct: number; label: string } | null>(null);
  const [dashboardIsStale, setDashboardIsStale] = useState(false);

  const [globalMetrics, setGlobalMetrics] = useState({ totalSold: 0, totalPlanned: 0, totalExecuted: 0, criticalClients: [] as any[] });
  const [clientMetricsMap, setClientMetricsMap] = useState<Record<string, any>>({});
  const [crmTrendSeries, setCrmTrendSeries] = useState<CrmTrendPoint[]>([]);
  const [slaFootprint, setSlaFootprint] = useState<CrmSlaFootprint | null>(null);

  // --- INFO ---
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState<any>({});

  // --- SLA SERVICES ---
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [tempService, setTempService] = useState<any>({});

  // --- OBJECTIVES (SEDES) ---
  const [objectiveForm, setObjectiveForm] = useState({ name: '', address: '', lat: '', lng: '', contact: '', notes: '', allowRemoteCheckIn: false });
  const [editingObjectiveIndex, setEditingObjectiveIndex] = useState<number | null>(null); // null=cerrado, -1=nuevo, 0+=editando
  const [isGeocodingSede, setIsGeocodingSede] = useState(false);

  // --- CONTRACTS ---
  const [contractFormOpen, setContractFormOpen] = useState(false);
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState({ name: '', startDate: '', endDate: '', totalHours: '', driveUrl: '', type: 'cerrado' });

  // --- SERVICES (SLA) ---
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const EMPTY_SVC_FORM = { open: false, sourceId: null as string | null, objectiveName: '', startDate: '', endDate: '', draftPositions: [] as any[] };
  const [serviceVersionForm, setServiceVersionForm] = useState(EMPTY_SVC_FORM);
  const [editingPositionIdx, setEditingPositionIdx] = useState<{ serviceId: string; idx: number } | null>(null);
  const [positionForm, setPositionForm] = useState({ positionName: '', coverageType: '24hs', quantity: 1, allowedShiftTypes: [] as any[], preferenciaGenero: 'INDISTINTO' as string });
  const [addingPositionToService, setAddingPositionToService] = useState<string | null>(null);
  // draft positions editor dentro del form de nuevo servicio / nueva versión
  const [draftPosForm, setDraftPosForm] = useState({ positionName: '', coverageType: '24hs', quantity: 1, preferenciaGenero: 'INDISTINTO' as string });
  const [editingDraftPosIdx, setEditingDraftPosIdx] = useState<number | null>(null);
  const [addingDraftPos, setAddingDraftPos] = useState(false);

  // --- NUEVO CLIENTE ---
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    name: '', legalName: '', taxId: '', ivaStatus: '', address: '', city: '', state: '', postalCode: '',
    tipoPersona: '', estadoClave: '', actividadPrincipal: '', afipImpuestos: '',
    contactName: '', phone: '', email: '',
  });
  const [savingNewClient, setSavingNewClient] = useState(false);
  const [afipLookupLoading, setAfipLookupLoading] = useState<'new' | 'edit' | 'client' | null>(null);

  // --- HISTORIAL ---
  const [historyNote, setHistoryNote] = useState('');

  // --- PORTAL CLIENTE ---
  // undefined = sin cargar, [] = cargado vacío, [...] = lista de usuarios
  const [portalUserMap, setPortalUserMap] = useState<Record<string, any[] | undefined>>({});
  const [portalFormOpen, setPortalFormOpen] = useState(false);
  const [portalEditingDocId, setPortalEditingDocId] = useState<string | null>(null);
  const [portalForm, setPortalForm] = useState({ nombre: '', email: '' });
  const [portalObjectiveIds, setPortalObjectiveIds] = useState<string[]>([]);
  const [portalSaving, setPortalSaving] = useState(false);
  const [portalResendingId, setPortalResendingId] = useState<string | null>(null);
  const [portalDeletingId, setPortalDeletingId] = useState<string | null>(null);
  const [portalError, setPortalError] = useState('');

  // --- PROFORMA ---
  const [proformaMonth, setProformaMonth] = useState(new Date().getMonth());
  const [proformaYear, setProformaYear] = useState(new Date().getFullYear());
  const [proformaStartDate, setProformaStartDate] = useState('');
  const [proformaEndDate, setProformaEndDate] = useState('');
  const [proformaDetailMode, setProformaDetailMode] = useState<ProformaDetailMode>('auto');
  const [proformaBase, setProformaBase] = useState<ProformaBase>('requested');
  const [proformaHourlyValue, setProformaHourlyValue] = useState('');
  const [proformaTotals, setProformaTotals] = useState({
    planned: 0,
    executed: 0,
    sinCobertura: 0,
    loading: false,
  });
  const [proformaBreakdown, setProformaBreakdown] = useState<any[]>([]);
  const [proformaBundle, setProformaBundle] = useState<ProformaExportBundle | null>(null);
  const [proformaExporting, setProformaExporting] = useState(false);
  const [empMetaMap, setEmpMetaMap] = useState<Record<string, { legajo?: string; name?: string }>>({});
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSelectedClient(null);
    setView('list');
    void fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, migracionCompleta]);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setCurrentUserName(u?.displayName || u?.email || 'Operador');
    });
  }, []);

  const crmRestoredRef = useRef(false);
  useEffect(() => {
    if (!router.isReady || loadingClients) return;
    const qid = String(router.query.clientId ?? '').trim();
    if (qid) {
      if (view === 'detail') return;
      void openClientDetail({ id: qid });
      router.replace('/admin/crm', undefined, { shallow: true });
      return;
    }
    if (crmRestoredRef.current || view === 'detail' || !clients.length) return;
    crmRestoredRef.current = true;
    const saved = readSessionJson<{ clientId?: string; tab?: string }>('cosp:crm:view');
    if (saved?.clientId) {
      void openClientDetail({ id: saved.clientId });
      if (saved.tab) setActiveTab(saved.tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query.clientId, loadingClients, clients.length]);

  useEffect(() => {
    writeSessionJson('cosp:crm:view', {
      clientId: selectedClient?.id || '',
      tab: activeTab,
    });
  }, [selectedClient?.id, activeTab]);

  const loadPortalUserForClient = async (clientId: string) => {
    try {
      const snap = await getDocs(query(collection(db, 'client_users'), where('clientId', '==', clientId)));
      setPortalUserMap(prev => ({ ...prev, [clientId]: snap.docs.map(d => ({ id: d.id, ...d.data() })) }));
    } catch (e) {
      console.error(e);
      setPortalUserMap(prev => ({ ...prev, [clientId]: [] }));
    }
  };

  const closePortalForm = () => {
    setPortalFormOpen(false);
    setPortalEditingDocId(null);
    setPortalForm({ nombre: '', email: '' });
    setPortalObjectiveIds([]);
    setPortalError('');
  };

  const handleSavePortalUser = async () => {
    if (!selectedClient?.id) return;
    if (!portalForm.nombre.trim()) { setPortalError('Completá el nombre.'); return; }
    if (!portalEditingDocId && !portalForm.email.trim()) { setPortalError('Completá el email.'); return; }
    setPortalSaving(true);
    setPortalError('');
    try {
      if (portalEditingDocId) {
        await updateDoc(doc(db, 'client_users', portalEditingDocId), {
          nombre: portalForm.nombre.trim(),
          objectiveIds: portalObjectiveIds,
        });
        toast.success('Usuario actualizado');
      } else {
        const fn = httpsCallable(getFunctions(), 'createClientPortalAccess');
        await fn({
          clientId: selectedClient.id,
          clientName: selectedClient.name,
          nombre: portalForm.nombre.trim(),
          email: portalForm.email.trim(),
          objectiveIds: portalObjectiveIds,
          empresaId: empresaId || '',
        });
        toast.success('Acceso enviado por email al cliente');
      }
      closePortalForm();
      loadPortalUserForClient(selectedClient.id);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('no configurado')) setPortalError('Servicio de email no configurado en el servidor.');
      else if (msg.includes('ya está vinculado')) setPortalError(msg);
      else setPortalError('Error al guardar. Intentá nuevamente.');
    } finally {
      setPortalSaving(false);
    }
  };

  const handleResendPortalAccess = async (pu: any) => {
    if (!selectedClient?.id) return;
    setPortalResendingId(pu.id);
    try {
      const fn = httpsCallable(getFunctions(), 'createClientPortalAccess');
      await fn({
        clientId: selectedClient.id,
        clientName: selectedClient.name,
        nombre: pu.nombre,
        email: pu.email,
        objectiveIds: pu.objectiveIds || [],
      });
      toast.success(`Acceso reenviado a ${pu.email}`);
      loadPortalUserForClient(selectedClient.id);
    } catch {
      toast.error('Error al reenviar acceso');
    } finally {
      setPortalResendingId(null);
    }
  };

  const handleDeletePortalUser = async (docId: string) => {
    if (!confirm('¿Eliminar este acceso de portal? El usuario no podrá ingresar al portal.')) return;
    setPortalDeletingId(docId);
    try {
      await deleteDoc(doc(db, 'client_users', docId));
      toast.success('Acceso eliminado');
      if (selectedClient?.id) loadPortalUserForClient(selectedClient.id);
    } catch {
      toast.error('Error al eliminar acceso');
    } finally {
      setPortalDeletingId(null);
    }
  };

  const canDeleteClient = (c: { empresaId?: unknown; id?: string }) =>
    canManageClientInTenant(c, empresaId, migracionCompleta, tenantAccess);

  const assertClientWritable = async (
    clientId: string,
    label?: string,
    action: 'guardar' | 'eliminar' = 'guardar',
  ) => {
    const fresh = await assertClientWritableForEmpresa(
      clientId,
      empresaId,
      migracionCompleta,
      action,
      tenantAccess,
    );
    if (label && fresh.name && String(fresh.name) !== label) {
      console.warn('[CRM] nombre desactualizado al validar', { clientId, label, dbName: fresh.name });
    }
    return fresh;
  };

  const openClientDetail = async (c: { id: string; name?: string }) => {
    try {
      const fresh = await assertClientWritable(c.id, c.name);
      setSelectedClient(fresh);
      setView('detail');
      await loadClientFullData(fresh);
      loadPortalUserForClient(fresh.id);
    } catch (e: unknown) {
      toast.error(isTenantIsolationError(e) ? e.message : (e instanceof Error ? e.message : 'No se puede abrir este cliente'));
    }
  };

  const selectedClientWritable = useMemo(
    () => (selectedClient ? canManageClientInTenant(selectedClient, empresaId, migracionCompleta, tenantAccess) : false),
    [selectedClient, empresaId, migracionCompleta, tenantAccess],
  );

  useEffect(() => {
    if (view !== 'detail' || !selectedClient?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await assertClientWritable(selectedClient.id, selectedClient.name);
        if (!cancelled) setSelectedClient(fresh);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = isTenantIsolationError(e)
          ? e.message
          : (e instanceof Error ? e.message : 'Cliente no editable en esta empresa');
        toast.error(msg);
        if (isTenantIsolationError(e)) {
          setView('list');
          setSelectedClient(null);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedClient?.id, empresaId, migracionCompleta, isSuperAdmin, allEmpresas]);

  const clientDeleteToast = (
    name: string,
    r: { deletedTurnos: number; deletedSla: number; foreignTurnosLeft: number; foreignSlaLeft: number },
  ) => {
    let msg = `"${name}" eliminado (${r.deletedTurnos} turnos, ${r.deletedSla} SLA)`;
    if (r.foreignTurnosLeft > 0 || r.foreignSlaLeft > 0) {
      msg += `. Quedaron ${r.foreignTurnosLeft} turno(s) y ${r.foreignSlaLeft} SLA de otra empresa (ID compartido; Bacarsa no se tocó).`;
    }
    return msg;
  };

  const fetchClients = async () => {
    const gen = ++clientsFetchGenRef.current;
    const showBlockingLoader = clients.length === 0;
    if (showBlockingLoader) setLoadingClients(true);
    try {
      const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
      let snap;
      if (scopeEmpresa) {
        snap = await getDocs(query(collection(db, 'clients'), where('empresaId', '==', empresaId)));
      } else {
        try {
          snap = await getDocs(query(collection(db, 'clients'), orderBy('name')));
        } catch {
          snap = await getDocs(collection(db, 'clients'));
        }
      }
      const data = dedupeClientsById(
        snap.docs
          .map((x) => ({ ...x.data(), id: x.id }))
          .filter((c) => canManageClientInTenant(c, empresaId, migracionCompleta, tenantAccess)),
      ).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
      if (gen !== clientsFetchGenRef.current) return;
      setClients(data);
    } catch (e) {
      console.error(e);
      if (gen === clientsFetchGenRef.current) setClients([]);
      toast.error('Error al cargar clientes');
    } finally {
      if (gen === clientsFetchGenRef.current) setLoadingClients(false);
    }
  };

  const loadClientFullData = async (client: { id: string; name?: string; legalName?: string }) => {
    setLoadingClientData(true);
    setForeignRelatedCounts({ servicios_sla: 0, turnos: 0 });
    try {
      const [srvResult, contResult, quoResult] = await Promise.allSettled([
        loadClientSlaForClient(
          { id: client.id, name: client.name, legalName: client.legalName, objetivos: (client as any).objetivos },
          { empresaId, scopeEmpresa },
        ),
        getDocs(query(collection(db, 'contracts'), where('clientId', '==', client.id))),
        getDocs(query(collection(db, 'quotes'), where('clientId', '==', client.id))),
      ]);

      if (srvResult.status === 'fulfilled') {
        setClientServices(srvResult.value);
      } else {
        console.error('Error cargando SLA:', srvResult.reason);
        setClientServices([]);
      }

      if (contResult.status === 'fulfilled') {
        setClientContracts(contResult.value.docs.map((x) => ({ id: x.id, ...x.data() })));
      } else {
        console.error('Error cargando contratos:', contResult.reason);
        setClientContracts([]);
      }

      if (quoResult.status === 'fulfilled') {
        setClientQuotes(quoResult.value.docs.map((x) => ({ id: x.id, ...x.data() })));
      } else {
        console.error('Error cargando cotizaciones:', quoResult.reason);
        setClientQuotes([]);
      }
    } catch (e) {
      console.error(e);
      toast.error('Error al cargar contratos, SLA o cotizaciones');
    } finally {
      setLoadingClientData(false);
    }
    void countClientRelatedDocsOtherTenant(client.id, empresaId, migracionCompleta)
      .then(setForeignRelatedCounts)
      .catch(() => setForeignRelatedCounts({ servicios_sla: 0, turnos: 0 }));
  };

  const getRangeLabel = () => crmRangeLabel(rangeMode, rangeMonth, rangeYear);

  const getRangeDates = () => crmRangeSpan(rangeMode, rangeMonth, rangeYear);

  const periodCacheKey = (periodKey: string) => `${empresaId}__${periodKey}`;

  const totalsFromClientMetrics = (metrics: Record<string, any>) => {
    let totalSold = 0;
    let totalPlanned = 0;
    let totalExecuted = 0;
    Object.values(metrics || {}).forEach((m: any) => {
      totalSold += Number(m?.sla) || 0;
      totalPlanned += Number(m?.planned) || 0;
      totalExecuted += Number(m?.real) || 0;
    });
    return { totalSold, totalPlanned, totalExecuted };
  };

  const buildMetricsFromHours = (
    byClient: Record<string, { sla: number; planned: number; real: number }>,
    contractedByClient: Record<string, number> = {},
    closedByClient: Record<string, number> = {},
  ) => {
    const metrics: Record<string, any> = {};
    let totalSold = 0;
    let totalPlanned = 0;
    let totalExecuted = 0;
    clients.forEach((c) => {
      const row = byClient[c.id] || { sla: 0, planned: 0, real: 0 };
      const sla = Math.round(row.sla || 0);
      const planned = Math.round(row.planned || 0);
      const real = Math.round(row.real || 0);
      const contracted = Math.round(contractedByClient[c.id] || 0);
      const contractClosed = Math.round(closedByClient[c.id] || 0);
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
        burnRate: sla > 0 ? (real / sla) * 100 : 0,
        hasActivity: sla > 0 || planned > 0 || real > 0,
      };
    });
    return { metrics, totalSold, totalPlanned, totalExecuted };
  };

  const storePeriodMetrics = (
    periodKey: string,
    byClient: Record<string, { sla: number; planned: number; real: number }>,
    contractedByClient?: Record<string, number>,
    closedByClient?: Record<string, number>,
  ) => {
    const built = buildMetricsFromHours(byClient, contractedByClient, closedByClient);
    periodMetricsRef.current.set(periodCacheKey(periodKey), {
      metrics: built.metrics,
      totals: { totalSold: built.totalSold, totalPlanned: built.totalPlanned, totalExecuted: built.totalExecuted },
      updatedAt: new Date(),
    });
    return built;
  };

  const trendSeriesFromBuckets = (buckets: { key: string; label: string }[]): CrmTrendPoint[] =>
    buckets.map((b) => {
      const e = periodMetricsRef.current.get(periodCacheKey(b.key));
      return {
        label: b.label,
        sla: Math.round(e?.totals.totalSold ?? 0),
        planificado: Math.round(e?.totals.totalPlanned ?? 0),
        ejecutado: Math.round(e?.totals.totalExecuted ?? 0),
      };
    });

  const mergeClientMetricsFromBuckets = (buckets: { key: string }[]) => {
    const metrics: Record<string, any> = {};
    clients.forEach((c) => {
      let sla = 0;
      let planned = 0;
      let real = 0;
      let contracted = 0;
      let contractClosed = 0;
      buckets.forEach((b) => {
        const hit = periodMetricsRef.current.get(periodCacheKey(b.key));
        const m = hit?.metrics?.[c.id];
        sla += Number(m?.sla) || 0;
        planned += Number(m?.planned) || 0;
        real += Number(m?.real) || 0;
        contracted += Number(m?.contracted) || 0;
        contractClosed += Number(m?.contractClosed) || 0;
      });
      metrics[c.id] = {
        sla,
        planned,
        real,
        contracted,
        contractClosed,
        contractMismatch: contractClosed > 0 && contractClosed !== sla,
        burnRate: sla > 0 ? (real / sla) * 100 : 0,
        hasActivity: sla > 0 || planned > 0 || real > 0,
      };
    });
    return metrics;
  };

  const applyPeriodCache = (
    buckets: { key: string; label: string }[],
    cacheKey: string,
  ) => {
    if (!buckets.length) return false;
    if (!buckets.every((b) => periodMetricsRef.current.has(periodCacheKey(b.key)))) return false;
    const trendSeries = trendSeriesFromBuckets(buckets);
    const metrics = mergeClientMetricsFromBuckets(buckets);
    const totals = totalsFromClientMetrics(metrics);
    const updatedAt = buckets.reduce((latest, b) => {
      const t = periodMetricsRef.current.get(periodCacheKey(b.key))?.updatedAt;
      if (!t) return latest;
      return !latest || t > latest ? t : latest;
    }, null as Date | null) || new Date();
    setClientMetricsMap(metrics);
    setGlobalMetrics({ ...totals, criticalClients: [] });
    setCrmTrendSeries(trendSeries);
    setMetricsUpdatedAt(updatedAt);
    setSlaFootprint(null);
    metricsCache.current.set(cacheKey, {
      metrics,
      trend: trendSeries,
      updatedAt,
      footprint: null,
    });
    return true;
  };

  const calculateDashboardMetrics = async () => {
    const runId = ++metricsRunRef.current;
    const cacheKey = crmMetricsCacheKey(empresaId || '', CRM_DASHBOARD_METRICS_VERSION, rangeMode, rangeMonth, rangeYear);
    const bucketsEarly = buildCrmTrendBuckets(rangeMode, rangeMonth, rangeYear);
    const selectedPeriodKey = `${rangeYear}-${String(rangeMonth + 1).padStart(2, '0')}`;
    const cached = metricsCache.current.get(cacheKey);
    if (cached) {
      setClientMetricsMap(cached.metrics);
      setCrmTrendSeries(cached.trend);
      setGlobalMetrics({ ...totalsFromClientMetrics(cached.metrics), criticalClients: [] });
      setMetricsUpdatedAt(cached.updatedAt);
      setSlaFootprint(cached.footprint ?? null);
      setCalculatingMetrics(false);
      setMetricsLoadProgress(null);
      setDashboardIsStale(false);
      return;
    }
    setCalculatingMetrics(true);
    setMetricsLoadProgress({ pct: 8, label: 'Cargando información…' });
    const bumpProgress = (pct: number, label: string) => {
      if (runId !== metricsRunRef.current) return;
      setMetricsLoadProgress({ pct, label });
    };
    const snapRef = doc(db, 'crm_metrics_snapshot', cacheKey);
    if (rangeMode !== 'all' && empresaId) {
      try {
        const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
        const clientRefs: ClientRef[] = clients.map((c) => ({
          id: c.id,
          name: c.name,
          legalName: c.legalName,
          objetivos: c.objetivos || [],
        }));
        const { start, end } = getRangeDates();
        if (!start || !end) throw new Error('rango CRM sin fechas');
        const objectiveIds = [
          ...new Set(
            clients.flatMap((c) =>
              (c.objetivos || []).map((o: any) => String(o.id ?? o.objectiveId ?? '').trim()).filter(Boolean),
            ),
          ),
        ];
        bumpProgress(18, 'Cargando información…');
        const [balanceRows, slaRows, contractRows] = await Promise.all([
          fetchHoursBalances({
            empresaId,
            periodKeys: bucketsEarly.map((b) => b.key),
            migracionCompleta,
            objectiveIds,
          }),
          fetchSlaRowsForCrmDashboard(clientRefs, { empresaId, scopeEmpresa, migracionCompleta }),
          fetchContractsForCrmDashboard(clientRefs, { empresaId, scopeEmpresa }),
        ]);
        const bucketKeys = bucketsEarly.map((b) => b.key);
        const selectedRows = balanceRows.filter((r) => bucketKeys.includes(r.periodKey));
        const vigente = pickVigenteSlasForPeriod(slaRows, start, end);
        const neededIds = vigente
          .map((s) => String(s.objectiveId ?? '').trim())
          .filter(Boolean);
        const coverKeys = bucketKeys;
        bumpProgress(36, 'Revisando extracto…');
        const extractReady = balancesCoverObjectives(selectedRows, coverKeys, neededIds);
        if (extractReady && runId === metricsRunRef.current) {
          bumpProgress(88, 'Armando resumen…');
          const contractedByClient: Record<string, number> = {};
          const closedByClient: Record<string, number> = {};
          contractRows.forEach((c: any) => {
            if (!c.clientId) return;
            const canonical = resolveCanonicalClientIdForCrmRow(c.clientId, clients);
            if (!canonical) return;
            if (scopeEmpresa) {
              if (!clients.some((cl) => cl.id === canonical)) return;
              const docEmp = String(c.empresaId ?? '').trim();
              if (docEmp && !tenantEmpresaIdsMatch(docEmp, empresaId)) return;
            }
            const totalHours = Number(c.totalHours) || 0;
            const cStart = c.startDate ? new Date(c.startDate) : null;
            const cEnd = c.endDate ? new Date(c.endDate) : null;
            const clamped = clampDateRange(cStart, cEnd, start, end);
            if (!clamped && (cStart || cEnd) && rangeMode !== 'all') return;
            contractedByClient[canonical] = (contractedByClient[canonical] || 0) + totalHours;
            if (c.type === 'cerrado') closedByClient[canonical] = (closedByClient[canonical] || 0) + totalHours;
          });
          const balancesLive = overlayLiveSlaOnBalanceRows(balanceRows, slaRows);
          bucketKeys.forEach((pk) => {
            storePeriodMetrics(pk, sumBalancesByClient(balancesLive.filter((r) => r.periodKey === pk)));
          });
          const metrics = mergeClientMetricsFromBuckets(bucketsEarly);
          clients.forEach((c) => {
            const row = metrics[c.id] || { sla: 0, planned: 0, real: 0 };
            const contracted = Math.round(contractedByClient[c.id] || 0);
            const contractClosed = Math.round(closedByClient[c.id] || 0);
            metrics[c.id] = {
              ...row,
              contracted,
              contractClosed,
              contractMismatch: contractClosed > 0 && contractClosed !== row.sla,
            };
          });
          const { totalSold, totalPlanned, totalExecuted } = totalsFromClientMetrics(metrics);
          const footprint = slaFootprintFromServices(slaRows, start, end);
          setClientMetricsMap(metrics);
          setGlobalMetrics({ totalSold, totalPlanned, totalExecuted, criticalClients: [] });
          setSlaFootprint(footprint);
          bumpProgress(72, 'Tendencia diaria…');
          const tenantClientIds = new Set(clients.map((c) => c.id));
          const slaDocsByClient = indexSlaRowsByClients(slaRows, clientRefs);
          const [turnosRaw, sEmployees] = await Promise.all([
            fetchCrmDashboardTurnos(empresaId, scopeEmpresa, start, end, clientRefs),
            getDocs(empresaCollectionQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>),
          ]);
          if (runId !== metricsRunRef.current) return;
          const validEmp: Record<string, boolean> = {};
          sEmployees.forEach((d) => {
            const e = d.data() as any;
            if (!belongsToEmpresaView(e, empresaId, migracionCompleta)) return;
            validEmp[d.id] = true;
          });
          const tenantAliasSet = new Set(collectClientIdAliases(clientRefs));
          const allTurnos = turnosRaw.filter((t) => {
            if (!scopeEmpresa) return true;
            const cid = String(t.clientId ?? '').trim();
            if (cid && tenantAliasSet.has(cid)) return true;
            if (clientRefs.some((c) => clientRowMatchesClient(t, c))) return true;
            return belongsToEmpresaView(t, empresaId, migracionCompleta);
          });
          const trendSeries = buildCrmDailyTrendSeries(
            clientRefs,
            slaDocsByClient,
            allTurnos,
            validEmp,
            start,
            end,
            tenantClientIds,
          );
          setCrmTrendSeries(trendSeries);
          const now = new Date();
          setMetricsUpdatedAt(now);
          metricsCache.current.set(cacheKey, { metrics, trend: trendSeries, updatedAt: now, footprint });
          setCalculatingMetrics(false);
          setMetricsLoadProgress(null);
          setDashboardIsStale(false);
          return;
        }
      } catch (err) {
        console.warn('[crm] hours_balances', err);
      }
    }

    // C1 — snapshot Firestore (aislado: un fallo aquí no rompe el cálculo)
    bumpProgress(42, 'Buscando datos guardados…');
    try {
      const snapDoc = await getDoc(snapRef);
      if (snapDoc.exists()) {
        const snap = snapDoc.data();
        const computedAt: Date = snap.computedAt?.toDate?.() ?? new Date(0);
        const ageMs = Date.now() - computedAt.getTime();
        if (ageMs < 2 * 3_600_000 && runId === metricsRunRef.current) {
          const m = snap.clientMetricsMap ?? {};
          const t = snap.trendSeries ?? [];
          const g = snap.globalMetrics ?? { totalSold: 0, totalPlanned: 0, totalExecuted: 0 };
          const footprint = (snap.slaFootprint as CrmSlaFootprint | undefined) ?? null;
          setClientMetricsMap(m);
          setGlobalMetrics({ ...g, criticalClients: [] });
          setCrmTrendSeries(t);
          setSlaFootprint(footprint);
          setMetricsUpdatedAt(computedAt);
          metricsCache.current.set(cacheKey, { metrics: m, trend: t, updatedAt: computedAt, footprint });
          if (rangeMode === 'month') {
            periodMetricsRef.current.set(periodCacheKey(selectedPeriodKey), {
              metrics: m,
              totals: {
                totalSold: Number(g.totalSold) || 0,
                totalPlanned: Number(g.totalPlanned) || 0,
                totalExecuted: Number(g.totalExecuted) || 0,
              },
              updatedAt: computedAt,
            });
          }
          setCalculatingMetrics(false);
          setMetricsLoadProgress(null);
          setDashboardIsStale(false);
          return;
        }
      }
    } catch { /* snapshot no disponible — continúa con cálculo normal */ }

    try {
      bumpProgress(52, 'Cargando contratos SLA…');
      const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
      const tenantClientIds = new Set(clients.map((c) => c.id));
      const clientRefs: ClientRef[] = clients.map((c) => ({
        id: c.id,
        name: c.name,
        legalName: c.legalName,
        objetivos: c.objetivos || [],
      }));
      const buckets = buildCrmTrendBuckets(rangeMode, rangeMonth, rangeYear);
      const { start, end } = getRangeDates();
      let turnoStart = start ?? buckets[0]?.start ?? new Date(2000, 0, 1);
      let turnoEnd = end ?? buckets[buckets.length - 1]?.end ?? new Date(2099, 11, 31, 23, 59, 59, 999);
      for (const b of buckets) {
        if (b.start < turnoStart) turnoStart = b.start;
        if (b.end > turnoEnd) turnoEnd = b.end;
      }

      const applyContractRowsToMaps = (
        contractRows: any[],
        contractedByClient: Record<string, number>,
        closedByClient: Record<string, number>,
      ) => {
        contractRows.forEach((c) => {
          if (!c.clientId) return;
          const canonical = resolveCanonicalClientIdForCrmRow(c.clientId, clients);
          if (!canonical) return;
          const cid = canonical;
          if (scopeEmpresa) {
            if (!tenantClientIds.has(cid)) return;
            const docEmp = String(c.empresaId ?? '').trim();
            if (docEmp && !tenantEmpresaIdsMatch(docEmp, empresaId)) return;
          }
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
      };

      const [slaRows, contractRows] = await Promise.all([
        fetchSlaRowsForCrmDashboard(clientRefs, {
          empresaId,
          scopeEmpresa,
          migracionCompleta,
        }),
        fetchContractsForCrmDashboard(clientRefs, { empresaId, scopeEmpresa }),
      ]);
      if (runId !== metricsRunRef.current) return;

      const slaDocsByClient = indexSlaRowsByClients(slaRows, clientRefs);
      const slaByClient: Record<string, number> = {};
      const contractedByClient: Record<string, number> = {};
      const closedByClient: Record<string, number> = {};

      clientRefs.forEach((clientRef) => {
        const clientSlas = slaDocsByClient.get(clientRef.id) || [];
        if (rangeMode === 'all') {
          slaByClient[clientRef.id] = sumVigenteSlaHoursInRange(clientSlas, null, null, clientRef.id);
        } else {
          slaByClient[clientRef.id] = sumVigenteSlaHoursInRange(clientSlas, start, end, clientRef.id);
        }
      });

      applyContractRowsToMaps(contractRows, contractedByClient, closedByClient);

      let phase1Sold = 0;
      setClientMetricsMap((prev) => {
        const next: Record<string, any> = { ...prev };
        clients.forEach((c) => {
          const sla = Math.round(slaByClient[c.id] || 0);
          const contracted = Math.round(contractedByClient[c.id] || 0);
          const contractClosed = Math.round(closedByClient[c.id] || 0);
          phase1Sold += sla;
          next[c.id] = {
            ...prev[c.id],
            sla,
            contracted,
            contractClosed,
            contractMismatch: contractClosed > 0 && contractClosed !== sla,
            hasActivity: sla > 0 || (prev[c.id]?.planned || 0) > 0 || (prev[c.id]?.real || 0) > 0,
          };
        });
        return next;
      });
      setGlobalMetrics((prev) => ({ ...prev, totalSold: phase1Sold }));
      bumpProgress(62, 'Cargando turnos…');

      const [turnosRaw, sEmployees] = await Promise.all([
        fetchCrmDashboardTurnos(empresaId, scopeEmpresa, turnoStart, turnoEnd, clientRefs),
        getDocs(empresaCollectionQuery('empleados', empresaId, scopeEmpresa) as ReturnType<typeof query>),
      ]);
      if (runId !== metricsRunRef.current) return;
      bumpProgress(80, 'Calculando horas…');

      const tenantAliasSet = new Set(collectClientIdAliases(clientRefs));

      const validEmp: Record<string, boolean> = {};
      const sharedMeta: Record<string, { legajo?: string; name?: string }> = {};
      sEmployees.forEach((d) => {
        const e = d.data() as any;
        if (!belongsToEmpresaView(e, empresaId, migracionCompleta)) return;
        validEmp[d.id] = true;
        registerEmployeeMetaAliases(sharedMeta, d.id, e);
      });
      sharedEmpMetaRef.current = sharedMeta;

      const allTurnos = turnosRaw.filter((t) => {
        if (!scopeEmpresa) return true;
        const cid = String(t.clientId ?? '').trim();
        if (cid && tenantAliasSet.has(cid)) return true;
        if (clientRefs.some((c) => clientRowMatchesClient(t, c))) return true;
        return belongsToEmpresaView(t, empresaId, migracionCompleta);
      });

      const turnosByClient = groupTurnosByClient(allTurnos, clientRefs, tenantClientIds);

      buckets.forEach((b) => {
        storePeriodMetrics(
          b.key,
          aggregateCrmHoursByClient(
            clientRefs,
            slaDocsByClient,
            allTurnos,
            validEmp,
            b.start,
            b.end,
            tenantClientIds,
            turnosByClient,
          ),
        );
      });
      const trendStart = start ?? buckets[0]?.start ?? new Date(2000, 0, 1);
      const trendEnd = end ?? buckets[buckets.length - 1]?.end ?? new Date(2099, 11, 31, 23, 59, 59, 999);
      const trendSeries = buildCrmDailyTrendSeries(
        clientRefs,
        slaDocsByClient,
        allTurnos,
        validEmp,
        trendStart,
        trendEnd,
        tenantClientIds,
      );
      const metrics = mergeClientMetricsFromBuckets(buckets);
      clients.forEach((c) => {
        const row = metrics[c.id] || { sla: 0, planned: 0, real: 0 };
        const contracted = Math.round(contractedByClient[c.id] || 0);
        const contractClosed = Math.round(closedByClient[c.id] || 0);
        metrics[c.id] = {
          ...row,
          contracted,
          contractClosed,
          contractMismatch: contractClosed > 0 && contractClosed !== row.sla,
        };
      });
      const { totalSold, totalPlanned, totalExecuted } = totalsFromClientMetrics(metrics);
      const footprint = slaFootprintFromServices(slaRows, start, end);
      bumpProgress(92, 'Armando resumen…');
      setCrmTrendSeries(trendSeries);

      setClientMetricsMap(metrics);
      setGlobalMetrics({ totalSold, totalPlanned, totalExecuted, criticalClients: [] });
      setSlaFootprint(footprint);
      const now = new Date();
      setMetricsUpdatedAt(now);
      metricsCache.current.set(cacheKey, { metrics, trend: trendSeries, updatedAt: now, footprint });
      if (empresaId && slaRows.length && allTurnos.length) {
        void persistHoursBalancesFromTurnos({
          empresaId,
          services: slaRows as any,
          turnos: allTurnos,
          months: buckets.map((b) => ({ year: b.start.getFullYear(), month: b.start.getMonth() + 1 })),
          rebuiltFrom: 'crm-bootstrap',
        }).catch((err) => console.warn('[crm] hours_balances bootstrap', err));
      }
      setDoc(snapRef, {
        empresaId,
        computedAt: serverTimestamp(),
        globalMetrics: { totalSold, totalPlanned, totalExecuted },
        clientMetricsMap: metrics,
        trendSeries,
        slaFootprint: footprint,
      }).catch(() => { /* escritura no crítica */ });
    } catch (e) {
      console.error(e);
      toast.error('Error al calcular métricas');
    } finally {
      if (runId === metricsRunRef.current) {
        setCalculatingMetrics(false);
        setMetricsLoadProgress(null);
        setDashboardIsStale(false);
      }
    }
  };

  const mergeAfipIntoClientForm = <T extends typeof newClientForm>(form: T, afip: AfipClientLookupResult): T => ({
    ...form,
    taxId: afip.taxId,
    legalName: afip.legalName,
    name: String(form.name || '').trim() ? form.name : afip.name,
    address: afip.address || form.address,
    city: afip.city || form.city,
    state: afip.state || form.state,
    postalCode: afip.postalCode || form.postalCode,
    ivaStatus: afip.ivaStatus || form.ivaStatus,
    tipoPersona: afip.tipoPersona || form.tipoPersona,
    estadoClave: afip.estadoClave || form.estadoClave,
    actividadPrincipal: afip.actividadPrincipal || form.actividadPrincipal,
    afipImpuestos: afip.afipImpuestos || form.afipImpuestos,
  });

  const mergeAfipIntoClientRecord = (base: any, afip: AfipClientLookupResult) => ({
    ...base,
    taxId: afip.taxId,
    legalName: afip.legalName,
    name: String(base?.name || '').trim() || afip.name,
    address: afip.address || base?.address || '',
    city: afip.city || base?.city || '',
    state: afip.state || base?.state || '',
    postalCode: afip.postalCode || base?.postalCode || '',
    ivaStatus: afip.ivaStatus || base?.ivaStatus || '',
    tipoPersona: afip.tipoPersona || base?.tipoPersona || '',
    estadoClave: afip.estadoClave || base?.estadoClave || '',
    actividadPrincipal: afip.actividadPrincipal || base?.actividadPrincipal || '',
    afipImpuestos: afip.afipImpuestos || base?.afipImpuestos || '',
  });

  const afipLookupErrorToast = (e: unknown) => {
    const err = e as { code?: string; message?: string };
    const msg = callableErrorText(e);
    if (err.code === 'functions/unauthenticated' || /sesión|iniciar sesión/i.test(msg)) {
      toast.error('Sesión expirada. Cerrá sesión y volvé a entrar, luego probá AFIP de nuevo.');
    } else if (err.code === 'functions/permission-denied') {
      toast.error(msg || 'No tenés permiso para consultar AFIP.');
    } else if (err.code === 'functions/not-found') {
      toast.error(
        msg ||
          'CUIT no encontrado en el padrón AFIP. Si en ARCA web sí aparece, activá certificado de producción en Configuración → Empresas.',
        { duration: 16_000 },
      );
    } else if (err.code === 'functions/failed-precondition' || /401|certificado afip|AFIP rechazó|no configurado/i.test(msg)) {
      const hint = /no configurado/i.test(msg)
        ? ' Cargá el certificado en Configuración → Empresas (empresa activa).'
        : '';
      toast.error((msg || 'Error de certificado o ambiente AFIP.') + hint, { duration: 14000 });
    } else toast.error(msg || 'Error al consultar AFIP');
  };

  const handleAfipLookup = async (target: 'new' | 'edit' | 'client') => {
    if (!authUser) {
      toast.error('Sesión expirada. Volvé a iniciar sesión.');
      return;
    }
    if (!empresaId?.trim()) {
      toast.error('Seleccioná una empresa en el panel antes de consultar AFIP.');
      return;
    }
    const taxId = target === 'new'
      ? newClientForm.taxId
      : target === 'edit'
        ? String(infoForm.taxId || '')
        : String(selectedClient?.taxId || '');
    const digits = String(taxId || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      toast.error('El cliente necesita un CUIT de 11 dígitos (cargalo en Editar si falta)');
      return;
    }

    if (target === 'new') {
      setAfipLookupLoading('new');
      try {
        const data = await lookupClientByCuitFromAfip(taxId, empresaId);
        setNewClientForm((f) => mergeAfipIntoClientForm(f, data));
        toast.success(`Datos cargados desde AFIP: ${data.legalName}`);
        if (data.afipWarning) toast.warning(data.afipWarning, { duration: 14_000 });
      } catch (e: unknown) {
        afipLookupErrorToast(e);
      } finally {
        setAfipLookupLoading(null);
      }
      return;
    }

    if (!selectedClient?.id || !selectedClientWritable) return;

    setAfipLookupLoading(target);
    try {
      const fresh = await assertClientWritable(selectedClient.id, selectedClient.name);
      const data = await lookupClientByCuitFromAfip(taxId, empresaId);
      const base = target === 'edit' ? { ...fresh, ...infoForm } : fresh;
      const patch = mergeAfipIntoClientRecord(base, data);
      if (!patch.name?.trim()) {
        toast.error('Falta nombre comercial; completalo y volvé a guardar');
        return;
      }
      const { id: _id, collection: _col, ...patchClean } = patch as Record<string, unknown>;
      await updateClientForEmpresa(fresh.id, patchClean, empresaId, migracionCompleta, tenantAccess);
      setSelectedClient({ ...fresh, ...patch });
      setInfoForm({ ...fresh, ...patch });
      setIsEditingInfo(false);
      toast.success(`Ficha actualizada desde AFIP: ${data.legalName}`);
      if (data.afipWarning) toast.warning(data.afipWarning, { duration: 14_000 });
    } catch (e: unknown) {
      afipLookupErrorToast(e);
    } finally {
      setAfipLookupLoading(null);
    }
  };

  const handleCreateClient = async () => {
    if (!newClientForm.name.trim()) { toast.error('El nombre del cliente es requerido'); return; }
    setSavingNewClient(true);
    try {
      const payload: any = { ...newClientForm, status: 'ACTIVO', createdAt: serverTimestamp() };
      if (empresaId) payload.empresaId = empresaId;
      await addDoc(collection(db, 'clients'), payload);
      toast.success(`"${newClientForm.name}" creado`);
      setNewClientOpen(false);
      setNewClientForm({
        name: '', legalName: '', taxId: '', ivaStatus: '', address: '', city: '', state: '', postalCode: '',
        tipoPersona: '', estadoClave: '', actividadPrincipal: '', afipImpuestos: '',
        contactName: '', phone: '', email: '',
      });
      fetchClients();
    } catch (e) {
      console.error(e);
      toast.error('Error al crear el cliente');
    } finally {
      setSavingNewClient(false);
    }
  };

  const handleSaveInfo = async () => {
    if (!selectedClient?.id) return;
    if (!infoForm?.name) return;
    try {
      const fresh = await assertClientWritable(selectedClient.id, selectedClient.name);
      const { id: _id, collection: _col, ...patch } = infoForm as Record<string, unknown>;
      await updateClientForEmpresa(fresh.id, patch, empresaId, migracionCompleta, tenantAccess);
      setSelectedClient({ ...fresh, ...patch });
      setIsEditingInfo(false);
      toast.success('Actualizado');
    } catch (e: unknown) {
      console.error(e);
      toast.error(isTenantIsolationError(e) ? e.message : (e instanceof Error ? e.message : 'Error al guardar'));
    }
  };

  const handleRetagRelatedDocs = async () => {
    if (!selectedClient?.id || !isSuperAdmin) return;
    const n = foreignRelatedCounts.servicios_sla + foreignRelatedCounts.turnos;
    if (n === 0) return;
    if (
      !confirm(
        `¿Re-etiquetar ${foreignRelatedCounts.servicios_sla} SLA y ${foreignRelatedCounts.turnos} turnos de «${selectedClient.name}» con empresaId «${empresaId}»?\n\nNo modifica el cliente en Bacarsa; solo registros con el mismo clientId que aún digan otra empresa.`,
      )
    ) {
      return;
    }
    setRetaggingRelated(true);
    try {
      await assertClientWritable(selectedClient.id, selectedClient.name);
      const r = await retagClientRelatedDocsToEmpresa(selectedClient.id, empresaId, migracionCompleta);
      toast.success(`Etiquetas corregidas: ${r.servicios_sla} SLA, ${r.turnos} turnos`);
      await loadClientFullData(selectedClient);
    } catch (e: unknown) {
      toast.error(isTenantIsolationError(e) ? e.message : (e instanceof Error ? e.message : 'Error al corregir etiquetas'));
    } finally {
      setRetaggingRelated(false);
    }
  };

  const handleSaveService = async () => {
    if (!editingServiceId || !selectedClient?.id) return;
    try {
      await assertClientWritable(selectedClient.id, selectedClient.name);
      await updateDocForEmpresa('servicios_sla', editingServiceId, tempService, empresaId, migracionCompleta);
      setEditingServiceId(null);
      await loadClientFullData(selectedClient);
      toast.success('SLA Actualizado');
    } catch (e) {
      console.error(e);
      toast.error('Error al actualizar SLA');
    }
  };

  const handleDeleteService = async (s: {
    id: string;
    clientId?: string;
    objectiveId?: string;
    objectiveName?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    if (!selectedClient?.id || !s.id) return;
    try {
      await assertClientWritable(selectedClient.id, selectedClient.name);
      const clientObjetivos = selectedClient.objetivos || [];
      const shiftIds = await collectTurnoIdsForSlaDelete(
        {
          id: s.id,
          clientId: s.clientId || selectedClient.id,
          objectiveId: s.objectiveId,
          objectiveName: s.objectiveName,
          startDate: s.startDate,
          endDate: s.endDate,
        },
        empresaId,
        migracionCompleta,
        clientObjetivos,
      );
      if (!confirm(
        `¿Eliminar el servicio «${s.objectiveName || s.id}» (${s.startDate || '?'} → ${s.endDate || '?'})?\n\n`
        + `Se borrarán ${shiftIds.length} turno(s) del período y el contrato SLA.\nEsta acción no se puede deshacer.`,
      )) return;

      const r = await deleteSlaWithRelatedDataForEmpresa(
        {
          id: s.id,
          clientId: s.clientId || selectedClient.id,
          objectiveId: s.objectiveId,
          objectiveName: s.objectiveName,
          startDate: s.startDate,
          endDate: s.endDate,
        },
        empresaId,
        migracionCompleta,
        clientObjetivos,
      );
      if (expandedServiceId === s.id) setExpandedServiceId(null);
      await loadClientFullData(selectedClient);
      toast.success(`Servicio eliminado (${r.deletedTurnos} turno(s))`);
    } catch (e) {
      console.error(e);
      toast.error(isTenantIsolationError(e) ? e.message : 'Error al eliminar servicio');
    }
  };

  // Determina el estado de un servicio según su rango de fechas
  const getServiceStatus = (s: any): 'activo' | 'proximo' | 'historico' => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = s.startDate ? new Date(s.startDate + 'T00:00:00') : null;
    const end = s.endDate ? new Date(s.endDate + 'T23:59:59') : null;
    if (start && start > today) return 'proximo';
    if (end && end < today) return 'historico';
    return 'activo';
  };

  // Guarda un puesto editado en un servicio
  const handleSavePosition = async (serviceId: string, positions: any[], idx: number | null) => {
    if (!selectedClient?.id) return;
    const updated = [...positions];
    const payload = { ...positionForm, name: positionForm.positionName || (positionForm as any).name || '' };
    if (idx === null) updated.push(payload);
    else updated[idx] = payload;
    try {
      await updateDocForEmpresa('servicios_sla', serviceId, { positions: updated }, empresaId, migracionCompleta);
      await loadClientFullData(selectedClient);
      setEditingPositionIdx(null);
      setAddingPositionToService(null);
      setPositionForm({ positionName: '', coverageType: '24hs', quantity: 1, allowedShiftTypes: [], preferenciaGenero: 'INDISTINTO' });
      toast.success('Puesto guardado');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar puesto');
    }
  };

  // Elimina un puesto
  const handleDeletePosition = async (serviceId: string, positions: any[], idx: number) => {
    if (!selectedClient?.id) return;
    if (!window.confirm('¿Eliminar este puesto?')) return;
    const updated = positions.filter((_, i) => i !== idx);
    try {
      await updateDocForEmpresa('servicios_sla', serviceId, { positions: updated }, empresaId, migracionCompleta);
      await loadClientFullData(selectedClient);
      toast.success('Puesto eliminado');
    } catch (e) {
      toast.error('Error al eliminar puesto');
    }
  };

  // Crea un servicio nuevo o una nueva versión de uno existente
  const handleCreateServiceVersion = async () => {
    if (!selectedClient?.id) return;
    if (!serviceVersionForm.startDate || !serviceVersionForm.endDate) return toast.error('Completá las fechas');
    if (!serviceVersionForm.objectiveName.trim()) return toast.error('Ingresá el nombre del servicio/objetivo');
    const source = serviceVersionForm.sourceId ? clientServices.find(s => s.id === serviceVersionForm.sourceId) : null;
    try {
      await addDoc(collection(db, 'servicios_sla'), {
        clientId: selectedClient.id,
        objectiveName: serviceVersionForm.objectiveName.trim(),
        objectiveId: source?.objectiveId || serviceVersionForm.objectiveName.trim(),
        positions: serviceVersionForm.draftPositions,
        startDate: serviceVersionForm.startDate,
        endDate: serviceVersionForm.endDate,
        ...(scopeEmpresa && empresaId ? { empresaId } : {}),
        createdAt: serverTimestamp(),
      });
      setServiceVersionForm(EMPTY_SVC_FORM);
      setAddingDraftPos(false);
      setEditingDraftPosIdx(null);
      await loadClientFullData(selectedClient);
      toast.success(source ? 'Nueva versión creada' : 'Servicio creado');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar');
    }
  };

  const openNewService = () => {
    setServiceVersionForm({ ...EMPTY_SVC_FORM, open: true });
    setAddingDraftPos(false);
    setEditingDraftPosIdx(null);
    setExpandedServiceId(null);
  };

  const openNewVersion = (s: any) => {
    setServiceVersionForm({
      open: true,
      sourceId: s.id,
      objectiveName: s.objectiveName || '',
      startDate: '',
      endDate: '',
      draftPositions: Array.isArray(s.positions) ? s.positions.map((p: any) => ({ ...p })) : [],
    });
    setAddingDraftPos(false);
    setEditingDraftPosIdx(null);
    setExpandedServiceId(null);
  };

  const handleAddHistory = async () => {
    if (!selectedClient?.id) return;
    const noteText = (historyNote || '').trim();
    if (!noteText) return;
    const note = { date: new Date().toISOString(), note: noteText, user: currentUserName };
    try {
      await updateClientForEmpresa(selectedClient.id, { historial: arrayUnion(note) }, empresaId, migracionCompleta, tenantAccess);
      setSelectedClient({ ...selectedClient, historial: [...(selectedClient.historial || []), note] });
      setHistoryNote('');
      toast.success('Nota guardada');
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar nota');
    }
  };

  useEffect(() => {
    if (clients.length === 0) {
      setClientMetricsMap({});
      setCrmTrendSeries([]);
      setSlaFootprint(null);
      setGlobalMetrics({ totalSold: 0, totalPlanned: 0, totalExecuted: 0, criticalClients: [] });
      return;
    }
    void calculateDashboardMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, rangeMode, rangeMonth, rangeYear, empresaId, migracionCompleta]);

  const clientsForList = useMemo(() => {
    let list = [...clients];
    if (clientListFilter === 'activos') {
      list = list.filter((c) => isClientStatusActivo(c.status));
    } else if (clientListFilter === 'con_sla') {
      list = list.filter((c) => (clientMetricsMap[c.id]?.sla || 0) > 0);
    } else if (clientListFilter === 'sla_sin_plan') {
      list = list.filter((c) => (clientMetricsMap[c.id]?.sla || 0) > 0 && Math.round(clientMetricsMap[c.id]?.planned || 0) <= 0);
    } else if (clientListFilter === 'hueco_plan') {
      list = list.filter((c) => {
        const sla = Math.round(clientMetricsMap[c.id]?.sla || 0);
        const planned = Math.round(clientMetricsMap[c.id]?.planned || 0);
        return sla > 0 && planned > 0 && planned < sla;
      });
    } else if (clientListFilter === 'sin_fichadas') {
      list = list.filter((c) => {
        const sla = Math.round(clientMetricsMap[c.id]?.sla || 0);
        const planned = Math.round(clientMetricsMap[c.id]?.planned || 0);
        const real = Math.round(clientMetricsMap[c.id]?.real || 0);
        return (sla > 0 || planned > 0) && real <= 0;
      });
    } else if (clientListFilter === 'burn_alerta') {
      list = list.filter((c) => (clientMetricsMap[c.id]?.burnRate || 0) >= 90);
    }
    const nameOf = (c: { name?: string }) => String(c.name || '').toLocaleLowerCase('es-AR');
    list.sort((a, b) => {
      const ma = clientMetricsMap[a.id] || {};
      const mb = clientMetricsMap[b.id] || {};
      if (clientListSort === 'burn_desc') return (mb.burnRate || 0) - (ma.burnRate || 0);
      if (clientListSort === 'sla_desc') return (mb.sla || 0) - (ma.sla || 0);
      if (clientListSort === 'plan_gap') {
        const ga = (ma.planned || 0) - (ma.sla || 0);
        const gb = (mb.planned || 0) - (mb.sla || 0);
        return gb - ga;
      }
      return nameOf(a).localeCompare(nameOf(b), 'es');
    });
    return list;
  }, [clients, clientMetricsMap, clientListFilter, clientListSort]);


  const resetObjectiveForm = () => {
    setObjectiveForm({ name: '', address: '', lat: '', lng: '', contact: '', notes: '', allowRemoteCheckIn: false });
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
      allowRemoteCheckIn: !!obj?.allowRemoteCheckIn,
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
      allowRemoteCheckIn: !!objectiveForm.allowRemoteCheckIn,
    };
    if (payload.lat !== null && Number.isNaN(payload.lat)) return toast.error('Latitud inválida');
    if (payload.lng !== null && Number.isNaN(payload.lng)) return toast.error('Longitud inválida');

    if (editingObjectiveIndex !== null && editingObjectiveIndex >= 0) objetivos[editingObjectiveIndex] = { ...objetivos[editingObjectiveIndex], ...payload };
    else objetivos.push({ id: String(Date.now()), ...payload });

    try {
      await updateClientForEmpresa(selectedClient.id, { objetivos }, empresaId, migracionCompleta, tenantAccess);
      setSelectedClient({ ...selectedClient, objetivos });
      resetObjectiveForm();
      toast.success('Objetivo guardado');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al guardar objetivo');
    }
  };

  const handleDeleteObjective = async (idx: number) => {
    if (!selectedClient?.id) return;
    if (!window.confirm('¿Eliminar este objetivo? Se eliminarán también todos sus turnos.')) return;
    const objectiveToDelete = (selectedClient.objetivos || [])[idx];
    const objetivos = (selectedClient.objetivos || []).filter((_: any, i: number) => i !== idx);
    try {
      await assertClientWritable(selectedClient.id, selectedClient.name);
      let deletedShifts = 0;
      if (objectiveToDelete?.id) {
        const turnosQ = query(collection(db, 'turnos'), where('objectiveId', '==', objectiveToDelete.id));
        const turnosSnap = await getDocs(turnosQ);
        const foreign = turnosSnap.docs.filter((d) =>
          !isTenantWriteOwner(d.data(), empresaId, migracionCompleta),
        );
        deletedShifts = await queryAndDeleteForEmpresa('turnos', turnosQ, empresaId, migracionCompleta);
        if (foreign.length > 0) {
          toast.message(`${foreign.length} turno(s) de otra empresa siguen con ese objetivo (ID compartido).`);
        }
      }
      await updateClientForEmpresa(selectedClient.id, { objetivos }, empresaId, migracionCompleta, tenantAccess);
      setSelectedClient({ ...selectedClient, objetivos });
      if (editingObjectiveIndex === idx) resetObjectiveForm();
      toast.success(`Objetivo eliminado${deletedShifts > 0 ? ` (${deletedShifts} turnos eliminados)` : ''}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al eliminar objetivo');
    }
  };

  const handleRepairObjectiveId = async (o: any, idx: number) => {
    if (!selectedClient?.id) return;
    // Busca en turnos el objectiveId original usando el nombre del objetivo
    try {
      const snap = await getDocs(query(collection(db, 'turnos'), where('objectiveName', '==', o.name), where('clientId', '==', selectedClient.id)));
      const found = snap.docs.find(d => d.data().objectiveId);
      if (!found) {
        // Fallback: buscar por nombre en empleados
        const empSnap = await getDocs(
          scopeEmpresa
            ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
            : collection(db, 'empleados'),
        );
        // No podemos cruzar directamente, pedir al usuario
        toast.error('No se encontraron turnos para recuperar el ID. Revisar en Firebase Console.');
        return;
      }
      const restoredId = found.data().objectiveId;
      const objetivos = [...(selectedClient.objetivos || [])];
      objetivos[idx] = { ...objetivos[idx], id: restoredId };
      await updateClientForEmpresa(selectedClient.id, { objetivos }, empresaId, migracionCompleta, tenantAccess);
      setSelectedClient({ ...selectedClient, objetivos });
      toast.success(`ID restaurado: ${restoredId}`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al restaurar ID');
    }
  };

  const parseSedeCoord = (raw: string): number => parseFloat(String(raw ?? '').trim().replace(',', '.'));

  const handleGeocodeSede = async () => {
    const addr = objectiveForm.address.trim();
    const lat = parseSedeCoord(objectiveForm.lat);
    const lng = parseSedeCoord(objectiveForm.lng);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    if (!addr && !hasCoords) {
      return toast.error('Ingrese una dirección o coordenadas válidas');
    }
    setIsGeocodingSede(true);
    const headers: Record<string, string> = {
      'Accept-Language': 'es',
      'User-Agent': 'COSP-v1/comtroldata.web.app',
    };
    const nom = async (params: string) => {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&${params}`, { headers });
      const d = await r.json();
      return d?.length > 0 ? d[0] : null;
    };
    try {
      if (!addr && hasCoords) {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=18&addressdetails=1`,
          { headers },
        );
        if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
        const data = await r.json() as { display_name?: string };
        const normalized = { lat: lat.toFixed(6), lng: lng.toFixed(6) };
        if (data?.display_name) {
          setObjectiveForm((f) => ({
            ...f,
            ...normalized,
            address: data.display_name!,
          }));
          toast.success(`Dirección encontrada: ${data.display_name.split(',').slice(0, 2).join(',')}`);
        } else {
          setObjectiveForm((f) => ({ ...f, ...normalized }));
          toast.success('Coordenadas confirmadas (sin dirección en el mapa)');
        }
        return;
      }

      // Parseo para formato importado con comas
      const parts = addr.split(',').map((p: string) => p.trim()).filter(Boolean);
      const street = parts[0] || addr;
      const city = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase() : 'Córdoba';
      let result =
        await nom(`street=${encodeURIComponent(street)}&city=${encodeURIComponent(city)}&country=Argentina`) ||
        await nom(`q=${encodeURIComponent(`${street}, ${city}, Argentina`)}`) ||
        await nom(`q=${encodeURIComponent(addr.replace(/,/g, ', '))}`);
      if (result) {
        setObjectiveForm(f => ({ ...f, lat: parseFloat(result.lat).toFixed(6), lng: parseFloat(result.lon).toFixed(6) }));
        toast.success(`Coordenadas encontradas: ${result.display_name.split(',').slice(0,2).join(',')}`);
      } else if (hasCoords) {
        setObjectiveForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
        toast.warning('No se encontró la dirección. Se mantienen las coordenadas ingresadas.');
      } else {
        toast.error('No se encontró la dirección. Ingresá las coordenadas manualmente desde Google Maps.');
      }
    } catch {
      toast.error('Error al geolocalizar');
    } finally {
      setIsGeocodingSede(false);
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
      await loadClientFullData(selectedClient);
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
      await loadClientFullData(selectedClient);
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
      const clientRef = {
        id: selectedClient.id,
        name: selectedClient.name,
        legalName: selectedClient.legalName,
        objetivos: selectedClient.objetivos || [],
      };

      const servicesForProforma = await loadClientSlaForClient(clientRef, { empresaId, scopeEmpresa });
      if (servicesForProforma.length !== clientServices.length) {
        setClientServices(servicesForProforma);
      }

      const periodYmd = proformaStartDate && proformaEndDate
        ? { start: proformaStartDate, end: proformaEndDate }
        : monthRangeYmd(proformaYear, proformaMonth);

      const objetivoStubs = (selectedClient.objetivos || []).map((o: any) => {
        const { id, name } = normalizeClientObjetivo(o);
        return {
          objectiveId: id,
          objectiveName: name,
          startDate: periodYmd.start,
          endDate: periodYmd.end,
        };
      });
      const slaInRange = [...servicesForProforma, ...objetivoStubs];

      const objectiveAliases = buildProformaObjectiveAliases(
        selectedClient.id,
        selectedClient.objetivos || [],
        slaInRange,
      );

      const slaExclusion = buildSlaExclusionContext(servicesForProforma, start, end);
      const slaCodeHoursHint = buildSlaCodeHoursHintFromServices(servicesForProforma);
      const slaCodeHoursHintByObjective = buildSlaCodeHoursHintByObjectiveId(servicesForProforma);

      const turnosList = await loadClientTurnosForClient(clientRef, start, end, { empresaId, scopeEmpresa });
      const turnosEnriched = enrichTurnosForProforma(turnosList, {
        clientId: selectedClient.id,
        objetivos: selectedClient.objetivos || [],
        slas: servicesForProforma,
      });
      const solicitudesRefuerzo = await solicitudRefuerzoService.getByClient(selectedClient.id);
      const billedSolicitudIds = solicitudIdsBilledInRange(solicitudesRefuerzo, { start, end });
      const planned = { total: 0, byObjective: {} as any };
      const executed = { total: 0, byObjective: {} as any };
      const sinCobertura = { total: 0, byObjective: {} as any };

      const turnoPassesSlaExclusion = (t: any) => {
        if (!slaExclusion) return true;
        const plannedStart = toDateSafe(t.startTime);
        const dateKey =
          resolveTurnoScheduleDateKey(t) || (plannedStart ? getDateKeyInTimezone(plannedStart) : '');
        if (!dateKey) return true;
        return !isTurnoOnSlaExcludedSlot(t, slaExclusion, {
          scheduleDateKey: dateKey,
          positionName: String(t.positionName ?? ''),
        });
      };

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

      const plannedCellGroups = new Map<string, { rows: any[]; objectiveName: string; positionName: string; dateKey: string }>();

      turnosEnriched.forEach((t) => {
        if (!isCrmPlannedEligibleShift(t, slaExclusion)) return;
        if (t.solicitudRefuerzoId && billedSolicitudIds.has(String(t.solicitudRefuerzoId))) return;
        const code = String((t.code || t.type || '')).trim().toUpperCase();

        const plannedStart = toDateSafe(t.startTime);
        if (!plannedStart) return;
        const plannedEnd = toDateSafe(t.endTime);
        const realStart = toDateSafe(t.realStartTime);
        const realEnd = toDateSafe(t.realEndTime);

        const rowCtx = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: selectedClient.id };
        const objectiveName = formatProformaObjectiveLabel(
          String(t.objectiveId || ''),
          resolveObjectiveDisplayName(rowCtx, objectiveAliases),
        );
        const positionName = (t.positionName || 'Sin puesto').toString().trim();

        const dateKey = resolveTurnoScheduleDateKey(t) || getDateKeyInTimezone(plannedStart!);
        const periodStartKey = getDateKeyInTimezone(start);
        const periodEndKey = getDateKeyInTimezone(end);
        if (dateKey >= periodStartKey && dateKey <= periodEndKey) {
          const objId = String(t.objectiveId || objectiveName);
          const empId = String(t.employeeId || 'unknown');
          const cellKey = `${objId}_${empId}_${dateKey}`;
          const bucket = plannedCellGroups.get(cellKey) || { rows: [], objectiveName, positionName, dateKey };
          bucket.rows.push(t);
          plannedCellGroups.set(cellKey, bucket);
        }

        if (realStart && realStart >= start && realStart <= end) {
          const execEnd = realEnd || plannedEnd;
          if (isWorkingCode(code) && execEnd) {
            let hrs = getDurationHours(realStart, execEnd);
            if (SHIFT_CODE_HOURS[code]) hrs = SHIFT_CODE_HOURS[code];
            if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) hrs = SHIFT_CODE_HOURS[code] || 8;
            executed.total += hrs;
            add(executed, objectiveName, positionName, getDateKeyInTimezone(realStart), hrs);
          }
        }
      });

      plannedCellGroups.forEach(({ rows, objectiveName, positionName, dateKey }) => {
        const objId = String(rows[0]?.objectiveId ?? '').trim();
        const cellHint = (objId && slaCodeHoursHintByObjective[objId]) || slaCodeHoursHint;
        const merged = coalescePlannedTurnosForCell(rows, cellHint);
        const hrs = coalescePlannedCellBillableHours(rows, cellHint);
        if (!merged || hrs <= 0) return;
        planned.total += hrs;
        add(planned, objectiveName, positionName, dateKey, hrs);
      });

      const sinCoberturaCellGroups = new Map<string, { rows: any[]; objectiveName: string; positionName: string; dateKey: string }>();
      turnosEnriched.forEach((t) => {
        if (!isSinCoberturaShift(t)) return;
        if (!turnoPassesSlaExclusion(t)) return;
        const plannedStart = toDateSafe(t.startTime);
        if (!plannedStart) return;
        const rowCtx = { objectiveId: t.objectiveId, objectiveName: t.objectiveName, clientId: selectedClient.id };
        const objectiveName = formatProformaObjectiveLabel(
          String(t.objectiveId || ''),
          resolveObjectiveDisplayName(rowCtx, objectiveAliases),
        );
        const positionName = (t.positionName || 'Sin puesto').toString().trim();
        const dateKey = resolveTurnoScheduleDateKey(t) || getDateKeyInTimezone(plannedStart);
        const periodStartKey = getDateKeyInTimezone(start);
        const periodEndKey = getDateKeyInTimezone(end);
        if (dateKey < periodStartKey || dateKey > periodEndKey) return;
        const objId = String(t.objectiveId || objectiveName);
        const empId = String(t.employeeId || 'SIN_COBERTURA');
        const cellKey = `${objId}_${empId}_${dateKey}`;
        const bucket = sinCoberturaCellGroups.get(cellKey) || { rows: [], objectiveName, positionName, dateKey };
        bucket.rows.push(t);
        sinCoberturaCellGroups.set(cellKey, bucket);
      });
      sinCoberturaCellGroups.forEach(({ rows, objectiveName, positionName, dateKey }) => {
        const objId = String(rows[0]?.objectiveId ?? '').trim();
        const cellHint = (objId && slaCodeHoursHintByObjective[objId]) || slaCodeHoursHint;
        const hrs = coalescePlannedCellBillableHours(rows, cellHint);
        if (hrs <= 0) return;
        sinCobertura.total += hrs;
        add(sinCobertura, objectiveName, positionName, dateKey, hrs);
      });

      const refuerzoHorasVendidas = applyRefuerzoHorasVendidasToBreakdown(planned, solicitudesRefuerzo, { start, end }, normalize);
      applyRefuerzoHorasVendidasToBreakdown(executed, solicitudesRefuerzo, { start, end }, normalize);

      const breakdownSource = proformaDetailMode === 'sin_cobertura'
        ? sinCobertura
        : proformaDetailMode === 'executed'
          ? executed
          : proformaDetailMode === 'planned'
            ? planned
            : (clientContracts || []).some((c) => c.type === 'abierto') ? executed : planned;
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

      let empMeta: Record<string, { legajo?: string; name?: string }>;
      if (Object.keys(sharedEmpMetaRef.current).length > 0) {
        empMeta = { ...sharedEmpMetaRef.current };
      } else {
        const empSnap = await getDocs(
          scopeEmpresa
            ? query(collection(db, 'empleados'), where('empresaId', '==', empresaId))
            : collection(db, 'empleados'),
        );
        empMeta = {};
        empSnap.docs.forEach((d) => {
          const data = d.data() as any;
          if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
          registerEmployeeMetaAliases(empMeta, d.id, data);
        });
      }
      const turnoEmpIds = turnosEnriched.map((t) => String(t.employeeId ?? ''));
      // Batch lookup: reemplaza hasta 120 getDoc individuales por queries de 10 en paralelo
      const pendingEmpIds = [...new Set(turnoEmpIds.filter(
        (eid) => eid && eid !== 'unknown' && eid !== 'VACANTE' && !empMeta[eid],
      ))].slice(0, 120);
      if (pendingEmpIds.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < pendingEmpIds.length; i += 10) chunks.push(pendingEmpIds.slice(i, i + 10));
        await Promise.all(chunks.map(async (chunk) => {
          const snap = await getDocs(query(collection(db, 'empleados'), where('__name__', 'in', chunk)));
          snap.docs.forEach((d) => registerEmployeeMetaAliases(empMeta, d.id, d.data() as any));
        }));
      }
      setEmpMetaMap(empMeta);

      const useExecutedForAuto = (clientContracts || []).some((c) => c.type === 'abierto');
      const turnosRaw = turnosEnriched.filter((t) => {
        if (t.solicitudRefuerzoId && billedSolicitudIds.has(String(t.solicitudRefuerzoId))) return false;
        if (!turnoEligibleForProformaGrid(t, proformaDetailMode, useExecutedForAuto)) return false;
        if (proformaDetailMode === 'sin_cobertura') return turnoPassesSlaExclusion(t);
        return isCrmPlannedEligibleShift(t, slaExclusion);
      }) as any[];
      const turnos = turnosRaw;
      const baseGrids = buildProformaObjectiveGrids({
        turnos,
        empMeta,
        clientId: selectedClient.id,
        objectiveAliases,
        slaInRange,
        slaExclusion,
        start,
        end,
        mode: proformaDetailMode,
        useExecutedForAuto,
        slaCodeHoursHint,
        slaCodeHoursHintByObjective,
      });
      const grids = applyRefuerzoHorasVendidasToGrids(baseGrids, solicitudesRefuerzo, { start, end });
      const vigenteSlas = pickVigenteSlasForPeriod(servicesForProforma, start, end, selectedClient.id);
      const slaHoursByObjectiveId: Record<string, number> = {};
      for (const srv of vigenteSlas) {
        const oid = String((srv as any).objectiveId ?? '').trim();
        if (oid) slaHoursByObjectiveId[oid] = (slaHoursByObjectiveId[oid] || 0) + slaHoursForServiceInRange(srv, start, end);
      }
      const summary = buildProformaSummary(grids, slaHoursByObjectiveId);
      setProformaBundle({
        clientName: selectedClient.name || '',
        legalName: selectedClient.legalName || '',
        taxId: selectedClient.taxId || '',
        address: selectedClient.address || '',
        periodLabel: buildPeriodLabel(start, end),
        startDate: proformaStartDate,
        endDate: proformaEndDate,
        issuedAt: new Date(),
        empresaName: (empresa as any)?.name || 'COSP',
        summary,
        objectives: grids,
        sourceDebug: {
          clientId: selectedClient.id,
          turnosLoaded: turnosList.length,
          turnosEligible: turnos.length,
          objectiveBlocks: grids.length,
          catalogObjectives: (selectedClient.objetivos || []).filter((o: any) => normalizeClientObjetivo(o).id).length,
        },
      });

      const modeIsExecuted = proformaDetailMode === 'executed' || (proformaDetailMode === 'auto' && useExecutedForAuto);
      const modeIsSinCobertura = proformaDetailMode === 'sin_cobertura';
      const gridTotal = Math.round(grids.reduce((a: number, g: any) => a + g.grandTotal.total, 0));
      const plannedBase = Math.round(sumPlannedHoursForClient(
        turnosList,
        clientRef,
        { start, end },
        slaExclusion,
        slaCodeHoursHint,
        slaCodeHoursHintByObjective,
      ));
      setProformaTotals({
        planned: plannedBase + Math.round(refuerzoHorasVendidas),
        executed: modeIsExecuted
          ? gridTotal + Math.round(refuerzoHorasVendidas)
          : Math.round(executed.total),
        sinCobertura: modeIsSinCobertura ? gridTotal : Math.round(sinCobertura.total),
        loading: false,
      });
    } catch (e) {
      console.error(e);
      setProformaTotals((p) => ({ ...p, loading: false }));
      setProformaBundle(null);
      toast.error(`Error al calcular turnos${e instanceof Error && e.message ? `: ${e.message}` : ''}`);
    }
  };

  const proformaActive = activeTab === 'PREFACTURA';

  useEffect(() => {
    if (!proformaActive) return;
    const { start, end } = monthRangeYmd(proformaYear, proformaMonth);
    setProformaStartDate(start);
    setProformaEndDate(end);
  }, [proformaActive, proformaMonth, proformaYear]);

  useEffect(() => {
    if (!proformaActive || !selectedClient?.id) return;
    calculateProformaTurnos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proformaActive, selectedClient?.id, clientServices, proformaMonth, proformaYear, proformaStartDate, proformaEndDate, proformaDetailMode]);

  const handleExportProformaPdf = () => {
    if (!proformaBundle) return;
    setProformaExporting(true);
    try {
      exportProformaPdf({ ...proformaBundle, issuedAt: new Date() });
      toast.success('PDF generado');
    } catch (e) {
      console.error(e);
      toast.error('Error al generar PDF');
    } finally {
      setProformaExporting(false);
    }
  };

  const handleExportProformaCsv = () => {
    if (!proformaBundle) return;
    setProformaExporting(true);
    try {
      exportProformaCsv({ ...proformaBundle, issuedAt: new Date() });
      toast.success('CSV descargado');
    } catch (e) {
      console.error(e);
      toast.error('Error al generar CSV');
    } finally {
      setProformaExporting(false);
    }
  };

  const handleExportProformaExcel = () => {
    if (!proformaBundle) return;
    setProformaExporting(true);
    try {
      exportProformaExcel({ ...proformaBundle, issuedAt: new Date() });
      toast.success('Excel descargado');
    } catch (e) {
      console.error(e);
      toast.error('Error al generar Excel');
    } finally {
      setProformaExporting(false);
    }
  };

  const baseHours = useMemo(() => {
    if (!selectedClient) return 0;
    const { start, end } = getProformaRange();
    const requested = Math.round(sumVigenteSlaHoursInRange(clientServices || [], start, end, selectedClient.id));
    if (proformaBase === 'requested') return requested;
    if (proformaBase === 'planned') return proformaTotals.planned;
    return proformaTotals.executed;
  }, [selectedClient, clientServices, proformaBase, proformaTotals, proformaStartDate, proformaEndDate, proformaMonth, proformaYear]);

  const totalEstimate = useMemo(() => {
    const hourly = Number(proformaHourlyValue) || 0;
    return baseHours * hourly;
  }, [baseHours, proformaHourlyValue]);

  const conSlaCount = useMemo(
    () => clients.filter((c) => (clientMetricsMap[c.id]?.sla || 0) > 0).length,
    [clients, clientMetricsMap],
  );

  const commercial = useMemo(
    () => summarizeCrmCommercial(clients, clientMetricsMap, slaFootprint, globalMetrics.totalSold),
    [clients, clientMetricsMap, slaFootprint, globalMetrics.totalSold],
  );

  type ClientItem = { id: string } & Record<string, any>;

  return (
    <DashboardLayout>
      <Head><title>CRM Clientes | CronoApp</title></Head>
      <Toaster position="top-center" richColors />

      {view === 'list' && (
        <ModuleShell<ClientItem>
          title="CRM Clientes"
          subtitle="Gestión comercial y contratos"
          icon={Building2}
          iconColor="bg-indigo-600"
          items={clientsForList as ClientItem[]}
          loading={loadingClients && clients.length === 0}
          emptyText={
            clientListFilter === 'sla_sin_plan'
              ? 'Ningún cliente con SLA sin malla en este período.'
              : clientListFilter === 'hueco_plan'
                ? 'Ningún cliente con plan menor al SLA en este período.'
                : clientListFilter === 'sin_fichadas'
                  ? 'Ningún cliente sin fichadas (con SLA o plan) en este período.'
              : clientListFilter === 'con_sla'
              ? 'Ningún cliente con horas SLA en este período. Elegí otro mes o usá filtro «Todos».'
              : 'Sin clientes para mostrar.'
          }
          searchPlaceholder="Buscar cliente..."
          searchFn={(c, q) => (c.name || '').toLowerCase().includes(q)}
          action={
            <button
              onClick={() => setNewClientOpen(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-colors"
            >
              <Plus size={13} /> Cliente
            </button>
          }
          accentFn={(c) => (!isClientStatusActivo(c.status) ? 'bg-slate-400' : 'bg-indigo-600')}
          topContent={
            <CrmDashboardSummary
              rangeLabel={getRangeLabel()}
              trendTitle={crmTrendChartTitle(rangeMode, rangeMonth, rangeYear)}
              rangeMode={rangeMode}
              rangeMonth={rangeMonth}
              rangeYear={rangeYear}
              onRangeModeChange={setRangeMode}
              onRangeMonthChange={setRangeMonth}
              onRangeYearChange={setRangeYear}
              totalSold={globalMetrics.totalSold}
              totalPlanned={globalMetrics.totalPlanned}
              totalExecuted={globalMetrics.totalExecuted}
              trendSeries={crmTrendSeries}
              calculatingMetrics={calculatingMetrics}
              loadProgress={metricsLoadProgress}
              isStale={dashboardIsStale}
              metricsUpdatedAt={metricsUpdatedAt}
              clientsCount={clients.length}
              conSlaCount={conSlaCount}
              commercial={commercial}
              clientListFilter={clientListFilter}
              clientListSort={clientListSort}
              onClientListFilterChange={setClientListFilter}
              onClientListSortChange={setClientListSort}
            />
          }
          renderCardSummary={(c) => {
            const m = clientMetricsMap[c.id] || {};
            const { burn, textCls: burnTextCls } = crmBurnVisual(m.burnRate || 0);
            const planGap = (m.planned || 0) - (m.sla || 0);
            const ejecLabel = crmEjecLabel(m.real || 0, m.sla || 0, m.planned || 0);
            const ejecMuted = Math.round(m.real || 0) === 0 && ((m.sla || 0) > 0 || (m.planned || 0) > 0);
            return (
              <CrmClientListCard
                name={c.name}
                taxId={c.taxId}
                empresaId={c.empresaId}
                statusLabel={formatClientStatusLabel((c as any).status)}
                statusActivo={isClientStatusActivo((c as any).status)}
                showEmpresaId={isSuperAdmin}
                metric={m}
                ejecLabel={ejecLabel}
                ejecMuted={ejecMuted}
                burnPct={burn}
                burnTextCls={burnTextCls}
                planGap={planGap}
              />
            );
          }}
          defaultView="list"
          renderRowSummary={(c) => {
            const m = clientMetricsMap[c.id] || {};
            const { burn, textCls: burnTextCls } = crmBurnVisual(m.burnRate || 0);
            return (
              <div className="flex items-center gap-4 w-full">
                <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 text-indigo-600">
                  <Building2 size={16} aria-hidden />
                </div>
                <div className="flex-1 min-w-0 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-1 lg:gap-6 items-center">
                  <div>
                    <span className="font-bold text-sm text-slate-900 dark:text-white">{c.name}</span>
                    <span className="text-slate-300 mx-2">·</span>
                    <span className="text-[10px] font-medium text-slate-500">{c.taxId || 'Sin CUIT'}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                    <span><span className="text-slate-400">SLA</span> {(m.sla || 0).toLocaleString('es-AR')} hs</span>
                    <span><span className="text-slate-400">Plan</span> {(m.planned || 0).toLocaleString('es-AR')} hs</span>
                    <span><span className="text-slate-400">Ejec</span> {crmEjecLabel(m.real || 0, m.sla || 0, m.planned || 0)}</span>
                    <span className={burnTextCls}>Burn {burn}%</span>
                  </div>
                </div>
              </div>
            );
          }}
          renderExpanded={(c, close) => {
            const m = clientMetricsMap[c.id] || {};
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(c.contactName || c.contactPhone || c.contactEmail) && (
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                      <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Contacto</p>
                      {c.contactName && <p className="text-xs font-black text-slate-700 dark:text-white">{c.contactName}</p>}
                      {c.contactPhone && <p className="text-[10px] text-slate-400">{c.contactPhone}</p>}
                      {c.contactEmail && <p className="text-[10px] text-slate-400 truncate">{c.contactEmail}</p>}
                    </div>
                  )}
                  {c.address && (
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                      <p className="text-[9px] font-black uppercase text-slate-400 mb-1">Dirección</p>
                      <p className="text-xs font-bold text-slate-700 dark:text-white">{c.address}</p>
                      {c.city && <p className="text-[10px] text-slate-400">{c.city}{c.province ? `, ${c.province}` : ''}</p>}
                    </div>
                  )}
                  <div className="bg-white dark:bg-slate-800 p-3 rounded-xl border dark:border-slate-700">
                    <p className="text-[9px] font-black uppercase text-slate-400 mb-2">Resumen</p>
                    <div className="flex gap-4">
                      <div>
                        <p className="text-[8px] text-slate-400 uppercase">SLA</p>
                        <p className="text-base font-black text-indigo-600 dark:text-indigo-400">{m.sla || 0} hs</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-slate-400 uppercase">Sedes</p>
                        <p className="text-base font-black text-slate-700 dark:text-white">{(c.objetivos || []).length}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-slate-400 uppercase">Estado</p>
                        <p className="text-base font-black text-slate-700 dark:text-white">{c.status || 'ACTIVO'}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  {isSuperAdmin && canDeleteClient(c) && (
                    <button
                      onClick={async () => {
                        const empresaLabel = empresa?.name || empresaId;
                        if (!confirm(`¿Eliminar permanentemente a "${c.name}"?\nEmpresa: ${empresaLabel}\nSe eliminarán turnos y SLA solo de esta empresa.`)) return;
                        try {
                          await assertClientWritable(c.id, c.name, 'eliminar');
                          const result = await deleteClientForEmpresa(c.id, empresaId, migracionCompleta);
                          toast.success(clientDeleteToast(c.name, result));
                          fetchClients();
                          close();
                        } catch (e: unknown) {
                          toast.error(isTenantIsolationError(e) ? e.message : (e instanceof Error ? e.message : 'Error al eliminar el cliente'));
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-black text-xs uppercase hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors"
                    >
                      <Trash2 size={13}/> Eliminar
                    </button>
                  )}
                  <button
                    onClick={() => { void openClientDetail(c); setActiveTab('PREFACTURA'); close(); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs uppercase transition-colors border"
                    style={{ backgroundColor: 'var(--surf2, #fef3c7)', color: '#b45309', borderColor: '#fde68a' }}
                  >
                    <FileText size={13}/> Prefacturar
                  </button>
                  <button
                    onClick={() => { void openClientDetail(c); close(); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase hover:bg-indigo-700 transition-colors shadow-sm"
                  >
                    <ExternalLink size={13}/> Ver Detalle
                  </button>
                </div>
              </div>
            );
          }}
        />
      )}

      {view === 'detail' && selectedClient && (
        <PageShell className={activeTab === 'PREFACTURA' ? 'p-2 md:p-3' : ''}>
          <div className={activeTab === 'PREFACTURA' ? 'w-full max-w-none space-y-4' : 'max-w-7xl mx-auto space-y-6'}>
            <PageHeader
              title="CRM Clientes"
              subtitle={selectedClient.name}
              icon={Building2}
              actions={
                <button onClick={() => setView('list')} className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-5 py-2 rounded-xl text-[10px] font-black uppercase text-slate-500 dark:text-slate-300 hover:bg-slate-50 transition-colors">
                  Volver al Listado
                </button>
              }
            />
            {!selectedClientWritable && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                Este cliente pertenece a otra empresa (p. ej. Bacarsa). No podés editarlo desde «{empresa?.name || empresaId}».
                Volvé al listado o cambiá el selector superior.
              </div>
            )}
            {selectedClientWritable &&
              (foreignRelatedCounts.servicios_sla > 0 || foreignRelatedCounts.turnos > 0) && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-bold text-violet-900 space-y-2">
                <p>
                  Hay datos vinculados a este cliente que siguen etiquetados como otra empresa (
                  {foreignRelatedCounts.servicios_sla} SLA, {foreignRelatedCounts.turnos} turnos).
                  Por eso al guardar un SLA puede aparecer «pertenece a bacarsa».
                </p>
                {isSuperAdmin && (
                  <button
                    type="button"
                    disabled={retaggingRelated}
                    onClick={() => void handleRetagRelatedDocs()}
                    className="px-4 py-2 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase hover:bg-violet-700 disabled:opacity-50"
                  >
                    {retaggingRelated ? 'Corrigiendo…' : `Corregir etiquetas a «${empresaId}»`}
                  </button>
                )}
              </div>
            )}
          <div className={`flex flex-col gap-8 ${activeTab === 'PREFACTURA' ? '' : 'lg:flex-row'}`}>
            <div className={`w-full space-y-6 ${activeTab === 'PREFACTURA' ? 'hidden' : 'lg:w-1/4'}`}>
              <div className="rounded-xl border p-8 text-center shadow-sm sticky top-6" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="w-24 h-24 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 mx-auto mb-6 shadow-lg">
                  <Building2 size={40} />
                </div>
                <h2 className="text-2xl font-black text-slate-800 leading-tight">{selectedClient.name}</h2>
                <p className="text-[10px] font-black text-slate-300 uppercase mt-2">{selectedClient.taxId}</p>
                {isSuperAdmin && canDeleteClient(selectedClient) && (
                  <button
                    onClick={async () => {
                      const empresaLabel = empresa?.name || empresaId;
                      if (!confirm(`¿Eliminar permanentemente a "${selectedClient.name}"?\nEmpresa: ${empresaLabel}\nSe eliminarán turnos y SLA solo de esta empresa.`)) return;
                      try {
                        await assertClientWritable(selectedClient.id, selectedClient.name, 'eliminar');
                        const result = await deleteClientForEmpresa(
                          selectedClient.id,
                          empresaId,
                          migracionCompleta,
                        );
                        toast.success(clientDeleteToast(selectedClient.name, result));
                        setSelectedClient(null);
                        setView('list');
                        fetchClients();
                      } catch (e: unknown) {
                        console.error(e);
                        toast.error(e instanceof TenantIsolationError ? e.message : (e instanceof Error ? e.message : 'Error al eliminar el cliente'));
                      }
                    }}
                    className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-rose-200 text-rose-500 hover:bg-rose-50 text-xs font-black uppercase transition-colors"
                  >
                    <Trash2 size={13}/> Eliminar cliente
                  </button>
                )}
              </div>

              {/* Acceso Portal Cliente */}
              <div className="rounded-xl border p-5 shadow-sm space-y-3" style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-indigo-500" />
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Portal Cliente</p>
                  </div>
                  {!portalFormOpen && (
                    <button
                      onClick={() => {
                        setPortalEditingDocId(null);
                        setPortalForm({ nombre: '', email: '' });
                        setPortalObjectiveIds([]);
                        setPortalFormOpen(true);
                        setPortalError('');
                        if (portalUserMap[selectedClient.id] === undefined) loadPortalUserForClient(selectedClient.id);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase transition-colors"
                    >
                      <UserPlus size={12} /> Agregar
                    </button>
                  )}
                </div>

                {/* Lista de usuarios */}
                {portalUserMap[selectedClient?.id] === undefined && !portalFormOpen ? (
                  <p className="text-[10px] text-slate-400 font-medium">Verificando...</p>
                ) : (portalUserMap[selectedClient?.id] ?? []).length === 0 && !portalFormOpen ? (
                  <p className="text-[10px] text-slate-400 font-medium">Sin accesos creados.</p>
                ) : (
                  <div className="space-y-2">
                    {(portalUserMap[selectedClient?.id] ?? []).map((pu: any) => (
                      <div key={pu.id} className="border border-slate-200 rounded-xl p-3 space-y-1.5">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-slate-800 truncate">{pu.nombre}</p>
                            <p className="text-[10px] text-slate-500 font-medium truncate">{pu.email}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {(pu.objectiveIds?.length ?? 0) > 0 ? (
                                <span className="text-[10px] text-indigo-500 font-bold">{pu.objectiveIds.length} obj.</span>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium">Todos los obj.</span>
                              )}
                              {pu.portalInvite?.sentAt && (
                                <span className="text-[10px] text-slate-400">· {pu.portalInvite.sentAt?.toDate?.()?.toLocaleDateString?.('es-AR') || ''}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button
                              title="Editar"
                              onClick={() => {
                                setPortalEditingDocId(pu.id);
                                setPortalForm({ nombre: pu.nombre || '', email: pu.email || '' });
                                setPortalObjectiveIds(pu.objectiveIds || []);
                                setPortalFormOpen(true);
                                setPortalError('');
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              title="Reenviar acceso"
                              onClick={() => handleResendPortalAccess(pu)}
                              disabled={portalResendingId === pu.id}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40"
                            >
                              {portalResendingId === pu.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            </button>
                            <button
                              title="Eliminar acceso"
                              onClick={() => handleDeletePortalUser(pu.id)}
                              disabled={portalDeletingId === pu.id}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
                            >
                              {portalDeletingId === pu.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulario crear / editar */}
                {portalFormOpen && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                      {portalEditingDocId ? 'Editar usuario' : 'Nuevo acceso'}
                    </p>
                    {portalError && (
                      <div className="flex items-center gap-1.5 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-[10px] font-bold text-rose-600">
                        <AlertCircle size={12} /> {portalError}
                      </div>
                    )}
                    <input
                      value={portalForm.nombre} onChange={e => setPortalForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre del contacto *"
                      className="w-full p-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    {!portalEditingDocId && (
                      <div className="relative">
                        <Mail size={13} className="absolute left-3 top-2.5 text-slate-400" />
                        <input
                          type="email" value={portalForm.email} onChange={e => setPortalForm(f => ({ ...f, email: e.target.value }))}
                          placeholder="Email *"
                          className="w-full pl-8 pr-3 py-2.5 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>
                    )}
                    {portalEditingDocId && (
                      <p className="text-[10px] text-slate-400 font-medium px-1">
                        Email: <span className="font-bold text-slate-600">{portalForm.email}</span>
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSavePortalUser} disabled={portalSaving}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2 rounded-xl text-[10px] font-black uppercase transition-colors"
                      >
                        {portalSaving ? <Loader2 size={12} className="animate-spin" /> : portalEditingDocId ? <Edit2 size={12} /> : <Send size={12} />}
                        {portalEditingDocId ? 'Guardar' : 'Enviar acceso'}
                      </button>
                      <button
                        onClick={closePortalForm}
                        className="flex-1 border border-slate-200 hover:bg-slate-50 py-2 rounded-xl text-[10px] font-black uppercase text-slate-600 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>

                    {(selectedClient?.objetivos?.length ?? 0) > 0 && (
                      <div className="border border-slate-200 rounded-xl p-3">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2">
                          Objetivos{' '}
                          <span className="font-medium normal-case tracking-normal text-slate-400">
                            {portalObjectiveIds.length === 0 ? '(todos)' : `(${portalObjectiveIds.length} sel.)`}
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                          {selectedClient.objetivos.filter((o: any) => o.id && o.name).map((o: any) => {
                            const sel = portalObjectiveIds.includes(o.id);
                            return (
                              <button
                                key={o.id} type="button"
                                onClick={() => setPortalObjectiveIds(prev =>
                                  sel ? prev.filter(id => id !== o.id) : [...prev, o.id]
                                )}
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-all border ${
                                  sel ? 'bg-indigo-600 text-white border-indigo-600'
                                      : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                                }`}
                              >
                                {o.name}
                              </button>
                            );
                          })}
                        </div>
                        {portalObjectiveIds.length > 0 && (
                          <button type="button" onClick={() => setPortalObjectiveIds([])}
                            className="mt-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 underline transition-colors">
                            Limpiar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={`rounded-xl border shadow-sm overflow-hidden flex flex-col min-h-[600px] ${activeTab === 'PREFACTURA' ? 'w-full' : 'flex-1'}`} style={{ backgroundColor: 'var(--surf)', borderColor: 'var(--border)' }}>
              <div className="flex border-b overflow-x-auto">
                {['INFO', 'CONTRATOS', 'SERVICIOS', 'SEDES', 'PREFACTURA', 'COTIZACIONES', 'HISTORIAL'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={`${activeTab === 'PREFACTURA' ? 'px-4 py-3' : 'px-8 py-6'} shrink-0 text-[10px] font-black uppercase tracking-widest border-b-[4px] transition-all ${
                      activeTab === t ? 'border-indigo-600 text-indigo-600 bg-indigo-50/30' : 'border-transparent text-slate-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className={`flex-1 space-y-6 ${activeTab === 'PREFACTURA' ? 'p-2 md:p-3' : 'p-10'}`}>
                {activeTab === 'INFO' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-xl font-black text-slate-800 uppercase">Ficha Técnica</h3>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">Datos del cliente</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {!isEditingInfo && (
                          <button
                            type="button"
                            disabled={!selectedClientWritable || afipLookupLoading === 'client'}
                            onClick={() => void handleAfipLookup('client')}
                            className="font-black text-[10px] uppercase px-4 py-2 rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50 flex items-center gap-1.5 disabled:opacity-40"
                            title="Consultar AFIP y guardar en la ficha del cliente"
                          >
                            {afipLookupLoading === 'client' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Actualizar desde AFIP
                          </button>
                        )}
                        <button
                          disabled={!selectedClientWritable}
                          onClick={() => { if (!selectedClientWritable) return; setInfoForm(selectedClient); setIsEditingInfo(!isEditingInfo); }}
                          className={`font-black text-[10px] uppercase px-4 py-2 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isEditingInfo ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'border border-indigo-200 text-indigo-600 hover:bg-indigo-50'}`}
                        >
                          {isEditingInfo ? 'Cancelar' : 'Editar'}
                        </button>
                      </div>
                    </div>

                    {isEditingInfo ? (
                      <div className="space-y-4">
                        {/* Identidad */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Identidad</p>
                          </div>
                          <div className="p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Nombre Comercial</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Nombre comercial" value={infoForm.name || ''} onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Razón Social</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Razón social" value={infoForm.legalName || ''} onChange={(e) => setInfoForm({ ...infoForm, legalName: e.target.value })} />
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">CUIT / Tax ID</label>
                                <div className="flex gap-2">
                                  <input className="borderw-full flex-1 p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="XX-XXXXXXXX-X" value={infoForm.taxId || ''} onChange={(e) => setInfoForm({ ...infoForm, taxId: e.target.value })} />
                                  <button
                                    type="button"
                                    disabled={!selectedClientWritable || afipLookupLoading === 'edit'}
                                    onClick={() => void handleAfipLookup('edit')}
                                    className="shrink-0 px-3 py-2 rounded-xl border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-40"
                                    title="Consultar AFIP y guardar en la ficha"
                                  >
                                    {afipLookupLoading === 'edit' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                    AFIP y guardar
                                  </button>
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Condición IVA</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Condición IVA" value={infoForm.ivaStatus || ''} onChange={(e) => setInfoForm({ ...infoForm, ivaStatus: e.target.value })} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Domicilio */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Domicilio</p>
                          </div>
                          <div className="p-4 space-y-3">
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Dirección</label>
                              <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Dirección" value={infoForm.address || ''} onChange={(e) => setInfoForm({ ...infoForm, address: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Ciudad</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Ciudad" value={infoForm.city || ''} onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Provincia</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Provincia" value={infoForm.state || ''} onChange={(e) => setInfoForm({ ...infoForm, state: e.target.value })} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Contacto */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Contacto</p>
                          </div>
                          <div className="p-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Nombre de contacto</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Contacto" value={infoForm.contactName || ''} onChange={(e) => setInfoForm({ ...infoForm, contactName: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Teléfono</label>
                                <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Teléfono" value={infoForm.phone || ''} onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })} />
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Email</label>
                              <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Email" value={infoForm.email || ''} onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })} />
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button onClick={handleSaveInfo} className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-2.5 rounded-xl font-black uppercase text-xs transition-colors">
                            Guardar cambios
                          </button>
                          <button onClick={() => setIsEditingInfo(false)} className="bg-white hover:bg-slate-50 border border-slate-200 px-6 py-2.5 rounded-xl font-black uppercase text-xs transition-colors">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Identidad */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Identidad</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            <div className="grid grid-cols-2 divide-x divide-slate-100">
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Nombre Comercial</p>
                                <p className="font-black text-slate-800">{selectedClient.name || '-'}</p>
                              </div>
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Razón Social</p>
                                <p className="font-black text-slate-800">{selectedClient.legalName || '-'}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 divide-x divide-slate-100">
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">CUIT / Tax ID</p>
                                <p className="font-black text-slate-800 text-lg">{selectedClient.taxId || '-'}</p>
                              </div>
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Condición IVA</p>
                                <p className="font-black text-slate-800">{selectedClient.ivaStatus || '-'}</p>
                              </div>
                            </div>
                            {(selectedClient.tipoPersona || selectedClient.estadoClave || selectedClient.actividadPrincipal) && (
                              <div className="grid grid-cols-2 divide-x divide-slate-100">
                                {selectedClient.tipoPersona ? (
                                  <div className="px-4 py-3">
                                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Tipo (AFIP)</p>
                                    <p className="font-black text-slate-800">
                                      {selectedClient.tipoPersona === 'FISICA' ? 'Persona física' : selectedClient.tipoPersona === 'JURIDICA' ? 'Persona jurídica' : selectedClient.tipoPersona}
                                    </p>
                                  </div>
                                ) : <div className="px-4 py-3" />}
                                {selectedClient.estadoClave ? (
                                  <div className="px-4 py-3">
                                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Estado clave (AFIP)</p>
                                    <p className="font-black text-slate-800">{selectedClient.estadoClave}</p>
                                  </div>
                                ) : null}
                              </div>
                            )}
                            {selectedClient.actividadPrincipal ? (
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Actividad principal (AFIP)</p>
                                <p className="font-bold text-slate-700 text-sm leading-snug">{selectedClient.actividadPrincipal}</p>
                              </div>
                            ) : null}
                            {selectedClient.afipImpuestos ? (
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Impuestos (AFIP)</p>
                                <p className="font-bold text-slate-600 text-xs leading-relaxed">{selectedClient.afipImpuestos}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Domicilio */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Domicilio</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            <div className="px-4 py-3">
                              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Dirección</p>
                              <p className="font-black text-slate-800">{selectedClient.address || '-'}</p>
                            </div>
                            <div className="grid grid-cols-2 divide-x divide-slate-100">
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Ciudad</p>
                                <p className="font-black text-slate-800">{selectedClient.city || '-'}</p>
                              </div>
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Provincia</p>
                                <p className="font-black text-slate-800">{selectedClient.state || '-'}</p>
                              </div>
                            </div>
                            {selectedClient.postalCode ? (
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Código postal</p>
                                <p className="font-black text-slate-800">{selectedClient.postalCode}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {/* Contacto */}
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 border-b" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)' }}>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Contacto</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            <div className="grid grid-cols-2 divide-x divide-slate-100">
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Nombre</p>
                                <p className="font-black text-slate-800">{selectedClient.contactName || '-'}</p>
                              </div>
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Teléfono</p>
                                <p className="font-black text-slate-800">{selectedClient.phone || '-'}</p>
                              </div>
                            </div>
                            <div className="px-4 py-3">
                              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Email</p>
                              <p className="font-black text-slate-800">{selectedClient.email || '-'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'CONTRATOS' && (
                  loadingClientData ? (
                    <div className="py-16 text-center text-slate-400">
                      <Loader2 className="animate-spin mx-auto mb-2" size={24} />
                      <p className="text-sm font-bold">Cargando contratos…</p>
                    </div>
                  ) : (
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-black text-slate-800 uppercase">Acuerdos Administrativos</h3>
                        <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full">{clientContracts.length}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { contractFormOpen && !editingContractId ? resetContractForm() : (resetContractForm(), setContractFormOpen(true)); }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors"
                        >
                          <Plus size={13} /> Nuevo Contrato
                        </button>
                        <button onClick={() => setActiveTab('PREFACTURA')} className="bg-white border hover:bg-slate-50 px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors">
                          <Receipt size={13} /> Prefactura
                        </button>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-4 bg-slate-50 rounded-xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Contratos</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.length}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Hs Totales</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.reduce((acc, c) => acc + (Number(c.totalHours) || 0), 0)} hs</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Abiertos</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.filter((c) => c.type === 'abierto').length}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-xl border">
                        <p className="text-[10px] font-black text-slate-400 uppercase">Temporales</p>
                        <p className="text-2xl font-black text-slate-800">{clientContracts.filter((c) => c.type === 'temporal').length}</p>
                      </div>
                    </div>

                    {/* New contract inline form */}
                    {contractFormOpen && !editingContractId && (
                      <div className="border-2 border-indigo-200 bg-indigo-50/50 rounded-xl p-5 space-y-3">
                        <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Nuevo contrato</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Nombre del contrato" value={contractForm.name} onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })} />
                          <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Horas totales" value={contractForm.totalHours} onChange={(e) => setContractForm({ ...contractForm, totalHours: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <select className="w-full p-3 rounded-xl border border-slate-200 bg-white font-black uppercase text-[10px] focus:outline-none focus:ring-2 focus:ring-indigo-400" value={contractForm.type} onChange={(e) => setContractForm({ ...contractForm, type: e.target.value })}>
                            <option value="cerrado">Cerrado</option>
                            <option value="abierto">Abierto</option>
                            <option value="temporal">Temporal</option>
                          </select>
                          <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Link / ID de Drive" value={contractForm.driveUrl} onChange={(e) => setContractForm({ ...contractForm, driveUrl: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Inicio (YYYY-MM-DD)" value={contractForm.startDate} onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} />
                          <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Fin (YYYY-MM-DD)" value={contractForm.endDate} onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })} />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleSaveContract} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">Guardar</button>
                          <button onClick={resetContractForm} className="bg-white hover:bg-slate-50 border border-slate-200 px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">Cancelar</button>
                        </div>
                      </div>
                    )}

                    {/* Contracts list */}
                    {clientContracts.length === 0 && !contractFormOpen ? (
                      <div className="text-center py-12 text-slate-400">
                        <FileText size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-bold">Sin contratos registrados</p>
                        <p className="text-[11px]">Hacé clic en "Nuevo Contrato" para agregar uno</p>
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                        {clientContracts.map((c) => {
                          const badge = c.type === 'cerrado' ? 'bg-slate-50 text-slate-500 border-slate-200' : c.type === 'abierto' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100';
                          const iconColor = c.type === 'abierto' ? 'bg-amber-100 text-amber-600' : c.type === 'temporal' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500';
                          const cStart = c.startDate ? new Date(c.startDate) : null;
                          const cEnd = c.endDate ? new Date(c.endDate) : null;
                          const slaInRange = c.type === 'cerrado' ? Math.round(
                            sumVigenteSlaHoursInRange(
                              clientServices || [],
                              cStart || new Date(0),
                              cEnd || new Date(),
                              selectedClient.id,
                            ),
                          ) : null;
                          const contractHours = Math.round(Number(c.totalHours) || 0);
                          const ok = slaInRange !== null ? contractHours === slaInRange : false;
                          const isExpanded = editingContractId === c.id;

                          return (
                            <div key={c.id}>
                              <div
                                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-indigo-50/60' : ''}`}
                                onClick={() => isExpanded ? resetContractForm() : startEditContract(c)}
                              >
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconColor}`}>
                                  <FileText size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-black text-slate-800 text-sm uppercase truncate">{c.name}</p>
                                  <p className="text-[11px] font-bold text-slate-400">{c.startDate || '-'} → {c.endDate || '-'}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {c.type && <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${badge}`}>{c.type}</span>}
                                  {slaInRange !== null && (
                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${ok ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                      {ok ? `OK ${slaInRange}hs` : `${slaInRange}hs SLA`}
                                    </span>
                                  )}
                                  <span className="font-black text-indigo-600 text-sm">{c.totalHours}hs</span>
                                  {c.driveUrl && (
                                    <a href={c.driveUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1.5 hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 rounded-lg transition-colors" title="Abrir Drive">
                                      <ExternalLink size={14} />
                                    </a>
                                  )}
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteContract(c.id); }} aria-label={`Eliminar contrato: ${c.name || 'sin nombre'}`} className="p-1.5 hover:bg-rose-50 text-rose-400 hover:text-rose-600 rounded-lg transition-colors">
                                    <Trash2 size={14} aria-hidden="true" />
                                  </button>
                                  {isExpanded ? <ChevronUp size={16} className="text-indigo-400" /> : <ChevronDown size={16} className="text-slate-300" />}
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="px-4 pb-4 pt-2 bg-indigo-50/40 border-t border-indigo-100 space-y-3">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Nombre del contrato" value={contractForm.name} onChange={(e) => setContractForm({ ...contractForm, name: e.target.value })} />
                                    <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Horas totales" value={contractForm.totalHours} onChange={(e) => setContractForm({ ...contractForm, totalHours: e.target.value })} />
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <select className="w-full p-3 rounded-xl border border-slate-200 bg-white font-black uppercase text-[10px] focus:outline-none focus:ring-2 focus:ring-indigo-400" value={contractForm.type} onChange={(e) => setContractForm({ ...contractForm, type: e.target.value })}>
                                      <option value="cerrado">Cerrado</option>
                                      <option value="abierto">Abierto</option>
                                      <option value="temporal">Temporal</option>
                                    </select>
                                    <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Link / ID de Drive" value={contractForm.driveUrl} onChange={(e) => setContractForm({ ...contractForm, driveUrl: e.target.value })} />
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Inicio (YYYY-MM-DD)" value={contractForm.startDate} onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} />
                                    <input className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} placeholder="Fin (YYYY-MM-DD)" value={contractForm.endDate} onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })} />
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={handleSaveContract} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">Actualizar</button>
                                    <button onClick={resetContractForm} className="bg-white hover:bg-slate-50 border border-slate-200 px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">Cancelar</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  )
                )}

                {activeTab === 'SERVICIOS' && (() => {
                  if (loadingClientData) {
                    return (
                      <div className="py-16 text-center text-slate-400">
                        <Loader2 className="animate-spin mx-auto mb-2" size={24} />
                        <p className="text-sm font-bold">Cargando servicios (SLA)…</p>
                      </div>
                    );
                  }
                  const sortedServices = [...clientServices].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
                  const COVERAGE_LABELS: Record<string, string> = { '24hs': '24 hs', '12hs_diurno': '12 hs Diurno', '12hs_nocturno': '12 hs Nocturno', 'custom': 'Personalizado' };

                  const StatusBadge = ({ s }: { s: any }) => {
                    const status = getServiceStatus(s);
                    if (status === 'activo') return <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-600 border-emerald-100">ACTIVO</span>;
                    if (status === 'proximo') return <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-600 border-indigo-100">PRÓXIMO</span>;
                    return <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-slate-100 text-slate-400 border-slate-200">HISTÓRICO</span>;
                  };

                  // Editor de puestos reutilizable (para form de nuevo servicio / nueva versión)
                  const DraftPositionsEditor = () => (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Puestos / Posiciones</p>
                        {!addingDraftPos && editingDraftPosIdx === null && (
                          <button onClick={() => { setAddingDraftPos(true); setDraftPosForm({ positionName: '', coverageType: '24hs', quantity: 1, preferenciaGenero: 'INDISTINTO' }); }} className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase">
                            <Plus size={11} /> Agregar puesto
                          </button>
                        )}
                      </div>

                      {serviceVersionForm.draftPositions.length === 0 && !addingDraftPos && (
                        <p className="text-xs text-slate-400 italic">Sin puestos — podés agregarlos ahora o después de crear el servicio.</p>
                      )}

                      <div className={`${serviceVersionForm.draftPositions.length > 0 || addingDraftPos ? 'border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white' : ''}`}>
                        {serviceVersionForm.draftPositions.map((pos: any, idx: number) => (
                          <div key={idx}>
                            {editingDraftPosIdx === idx ? (
                              <div className="px-3 py-2 bg-indigo-50/40 space-y-2">
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Nombre</label>
                                    <input className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.positionName} onChange={(e) => setDraftPosForm({ ...draftPosForm, positionName: e.target.value })} />
                                  </div>
                                  <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cobertura</label>
                                    <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.coverageType} onChange={(e) => setDraftPosForm({ ...draftPosForm, coverageType: e.target.value })}>
                                      <option value="24hs">24 hs</option>
                                      <option value="12hs_diurno">12 hs Diurno</option>
                                      <option value="12hs_nocturno">12 hs Nocturno</option>
                                      <option value="custom">Personalizado</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Guardias</label>
                                    <input type="number" min={1} className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.quantity} onChange={(e) => setDraftPosForm({ ...draftPosForm, quantity: Number(e.target.value) })} />
                                  </div>
                                </div>
                                <div>
                                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Género requerido</label>
                                  <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.preferenciaGenero || 'INDISTINTO'} onChange={(e) => setDraftPosForm({ ...draftPosForm, preferenciaGenero: e.target.value })}>
                                    <option value="INDISTINTO">Indistinto</option>
                                    <option value="M">Masculino</option>
                                    <option value="F">Femenino</option>
                                  </select>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => {
                                    const updated = [...serviceVersionForm.draftPositions];
                                    updated[idx] = { ...pos, ...draftPosForm, positionName: draftPosForm.positionName };
                                    setServiceVersionForm({ ...serviceVersionForm, draftPositions: updated });
                                    setEditingDraftPosIdx(null);
                                  }} className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg font-black uppercase text-[10px]">OK</button>
                                  <button onClick={() => setEditingDraftPosIdx(null)} className="text-slate-400 border border-slate-200 px-4 py-1.5 rounded-lg font-black uppercase text-[10px]">Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 px-3 py-2.5">
                                <div className="w-6 h-6 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
                                  <Users size={12} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-black text-slate-800 text-xs truncate">{pos.positionName || pos.name || 'Sin nombre'}</p>
                                  <p className="text-[10px] font-bold text-slate-400">{COVERAGE_LABELS[pos.coverageType] || pos.coverageType} · {pos.quantity || 1} guardia{(pos.quantity || 1) !== 1 ? 's' : ''}</p>
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={() => { setEditingDraftPosIdx(idx); setDraftPosForm({ positionName: pos.positionName || pos.name || '', coverageType: pos.coverageType || '24hs', quantity: pos.quantity || 1, preferenciaGenero: pos.preferenciaGenero || 'INDISTINTO' }); }} className="p-1 hover:bg-indigo-50 text-indigo-400 rounded transition-colors"><Edit2 size={11} /></button>
                                  <button onClick={() => setServiceVersionForm({ ...serviceVersionForm, draftPositions: serviceVersionForm.draftPositions.filter((_: any, i: number) => i !== idx) })} className="p-1 hover:bg-rose-50 text-rose-400 rounded transition-colors"><Trash2 size={11} /></button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}

                        {addingDraftPos && (
                          <div className="px-3 py-2 bg-emerald-50/40 space-y-2">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Nombre</label>
                                <input autoFocus className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Ej: Acceso principal" value={draftPosForm.positionName} onChange={(e) => setDraftPosForm({ ...draftPosForm, positionName: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cobertura</label>
                                <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.coverageType} onChange={(e) => setDraftPosForm({ ...draftPosForm, coverageType: e.target.value })}>
                                  <option value="24hs">24 hs</option>
                                  <option value="12hs_diurno">12 hs Diurno</option>
                                  <option value="12hs_nocturno">12 hs Nocturno</option>
                                  <option value="custom">Personalizado</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Guardias</label>
                                <input type="number" min={1} className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.quantity} onChange={(e) => setDraftPosForm({ ...draftPosForm, quantity: Number(e.target.value) })} />
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Género requerido</label>
                              <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={draftPosForm.preferenciaGenero || 'INDISTINTO'} onChange={(e) => setDraftPosForm({ ...draftPosForm, preferenciaGenero: e.target.value })}>
                                <option value="INDISTINTO">Indistinto</option>
                                <option value="M">Masculino</option>
                                <option value="F">Femenino</option>
                              </select>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => {
                                setServiceVersionForm({ ...serviceVersionForm, draftPositions: [...serviceVersionForm.draftPositions, { positionName: draftPosForm.positionName, coverageType: draftPosForm.coverageType, quantity: draftPosForm.quantity, preferenciaGenero: draftPosForm.preferenciaGenero || 'INDISTINTO', allowedShiftTypes: [] }] });
                                setDraftPosForm({ positionName: '', coverageType: '24hs', quantity: 1, preferenciaGenero: 'INDISTINTO' });
                                setAddingDraftPos(false);
                              }} className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg font-black uppercase text-[10px]">Agregar</button>
                              <button onClick={() => setAddingDraftPos(false)} className="text-slate-400 border border-slate-200 px-4 py-1.5 rounded-lg font-black uppercase text-[10px]">Cancelar</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );

                  return (
                    <div className="space-y-4">
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-black text-slate-800 uppercase">Configuración SLA</h3>
                          <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full">{clientServices.length}</span>
                        </div>
                        {!serviceVersionForm.open && (
                          <button onClick={openNewService} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors">
                            <Plus size={13} /> Nuevo Servicio
                          </button>
                        )}
                      </div>

                      {/* Form: nuevo servicio o nueva versión */}
                      {serviceVersionForm.open && (
                        <div className="border-2 border-indigo-200 bg-indigo-50/30 rounded-xl p-5 space-y-4">
                          <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">
                            {serviceVersionForm.sourceId ? 'Nueva versión del servicio' : 'Nuevo servicio'}
                          </p>

                          {/* Nombre */}
                          <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Nombre del objetivo / servicio</label>
                            <input
                              className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                              placeholder="Ej: Planta Norte"
                              value={serviceVersionForm.objectiveName}
                              onChange={(e) => setServiceVersionForm({ ...serviceVersionForm, objectiveName: e.target.value })}
                            />
                          </div>

                          {/* Fechas */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Fecha inicio</label>
                              <input type="date" className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} value={serviceVersionForm.startDate} onChange={(e) => setServiceVersionForm({ ...serviceVersionForm, startDate: e.target.value })} />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Fecha fin</label>
                              <input type="date" className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }} value={serviceVersionForm.endDate} onChange={(e) => setServiceVersionForm({ ...serviceVersionForm, endDate: e.target.value })} />
                            </div>
                          </div>

                          {/* Editor de puestos */}
                          <DraftPositionsEditor />

                          <div className="flex gap-2 pt-1">
                            <button onClick={handleCreateServiceVersion} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">
                              {serviceVersionForm.sourceId ? 'Crear versión' : 'Crear servicio'}
                            </button>
                            <button onClick={() => { setServiceVersionForm(EMPTY_SVC_FORM); setAddingDraftPos(false); setEditingDraftPosIdx(null); }} className="bg-white hover:bg-slate-50 border border-slate-200 px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">Cancelar</button>
                          </div>
                        </div>
                      )}

                      {sortedServices.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                          <BarChart3 size={32} className="mx-auto mb-2 opacity-30" />
                          <p className="text-sm font-bold">Sin servicios configurados</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {sortedServices.map((s) => {
                            const positions: any[] = Array.isArray(s.positions)
                              ? s.positions
                              : Object.values((s.positions as Record<string, unknown>) || {});
                            const slaHs = sumContractSlaHours(s.positions, s.startDate, s.endDate, s.excludedDates, null, null, s.totalMonthlyHours);
                            const isExpanded = expandedServiceId === s.id;

                            return (
                              <div key={s.id} className="border border-slate-200 rounded-xl overflow-hidden">
                                {/* Service row header */}
                                <div
                                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-indigo-50/40' : ''}`}
                                  onClick={() => setExpandedServiceId(isExpanded ? null : s.id)}
                                >
                                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${getServiceStatus(s) === 'activo' ? 'bg-emerald-100 text-emerald-600' : getServiceStatus(s) === 'proximo' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                                    <BarChart3 size={16} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-black text-slate-800 text-sm uppercase truncate">{s.objectiveName}</p>
                                      <StatusBadge s={s} />
                                    </div>
                                    <p className="text-[11px] font-bold text-slate-400">{s.startDate || '?'} → {s.endDate || '?'} · {positions.length} puesto{positions.length !== 1 ? 's' : ''}</p>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="bg-indigo-50 text-indigo-600 text-[10px] font-black px-2 py-0.5 rounded-full border border-indigo-100">{slaHs} hs</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openNewVersion(s); }}
                                      title="Nueva versión"
                                      className="p-1.5 hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 rounded-lg transition-colors"
                                    >
                                      <Copy size={14} />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); void handleDeleteService(s); }}
                                      title="Eliminar servicio y turnos del período"
                                      className="p-1.5 hover:bg-rose-50 text-rose-400 hover:text-rose-600 rounded-lg transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                    {isExpanded ? <ChevronUp size={16} className="text-indigo-400" /> : <ChevronDown size={16} className="text-slate-300" />}
                                  </div>
                                </div>

                                {/* Expanded: positions list */}
                                {isExpanded && (
                                  <div className="border-t border-indigo-100 bg-slate-50/40">
                                    {/* Nombre editable */}
                                    <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                                      <span className="text-[10px] font-black text-slate-400 uppercase">Nombre del servicio:</span>
                                      {editingServiceId === s.id ? (
                                        <div className="flex items-center gap-2 flex-1">
                                          <input className="flex-1 p-1.5 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={tempService.objectiveName || ''} onChange={(e) => setTempService({ ...tempService, objectiveName: e.target.value })} />
                                          <button onClick={handleSaveService} className="bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[10px]">OK</button>
                                          <button onClick={() => setEditingServiceId(null)} className="text-slate-400 px-2 py-1.5 rounded-lg font-black uppercase text-[10px]">✕</button>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-black text-slate-700">{s.objectiveName}</span>
                                          <button onClick={() => { setEditingServiceId(s.id); setTempService(s); }} className="text-indigo-400 hover:text-indigo-600"><Edit2 size={12} /></button>
                                        </div>
                                      )}
                                    </div>

                                    {/* Positions list */}
                                    <div className="px-4 pb-3 space-y-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Puestos / Posiciones</p>
                                        <button
                                          onClick={() => { setAddingPositionToService(s.id); setEditingPositionIdx(null); setPositionForm({ positionName: '', coverageType: '24hs', quantity: 1, allowedShiftTypes: [], preferenciaGenero: 'INDISTINTO' }); }}
                                          className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase"
                                        >
                                          <Plus size={12} /> Agregar puesto
                                        </button>
                                      </div>

                                      {positions.length === 0 && addingPositionToService !== s.id && (
                                        <div className="text-center py-4 text-slate-400">
                                          <Users size={20} className="mx-auto mb-1 opacity-30" />
                                          <p className="text-xs font-bold">Sin puestos definidos</p>
                                        </div>
                                      )}

                                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
                                        {positions.map((pos: any, idx: number) => {
                                          const isEditingThis = editingPositionIdx?.serviceId === s.id && editingPositionIdx?.idx === idx;
                                          return (
                                            <div key={idx}>
                                              {/* Position row */}
                                              <div className={`flex items-center gap-3 px-3 py-2.5 ${isEditingThis ? 'bg-indigo-50/60' : ''}`}>
                                                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
                                                  <Users size={14} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <p className="font-black text-slate-800 text-xs truncate">{pos.positionName || pos.name || 'Sin nombre'}</p>
                                                  <p className="text-[10px] font-bold text-slate-400">{COVERAGE_LABELS[pos.coverageType] || pos.coverageType} · {pos.quantity || pos.qty || 1} guardia{(pos.quantity || pos.qty || 1) !== 1 ? 's' : ''}</p>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                  {pos.preferenciaGenero === 'M' && <span className="text-[9px] font-black text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded" title="Solo masculino">♂</span>}
                                                  {pos.preferenciaGenero === 'F' && <span className="text-[9px] font-black text-pink-700 bg-pink-100 px-1.5 py-0.5 rounded" title="Solo femenino">♀</span>}
                                                  {pos.activeDays && pos.activeDays.length < 7 && (
                                                    <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                                      {pos.activeDays.join('')}
                                                    </span>
                                                  )}
                                                  <button
                                                    onClick={() => {
                                                      setEditingPositionIdx({ serviceId: s.id, idx });
                                                      setAddingPositionToService(null);
                                                      setPositionForm({
                                                        positionName: pos.positionName || pos.name || '',
                                                        coverageType: pos.coverageType || '24hs',
                                                        quantity: pos.quantity || pos.qty || 1,
                                                        allowedShiftTypes: pos.allowedShiftTypes || [],
                                                        preferenciaGenero: pos.preferenciaGenero || 'INDISTINTO',
                                                      });
                                                    }}
                                                    className="p-1 hover:bg-indigo-50 text-indigo-400 hover:text-indigo-600 rounded transition-colors"
                                                  >
                                                    <Edit2 size={12} />
                                                  </button>
                                                  <button onClick={() => handleDeletePosition(s.id, positions, idx)} className="p-1 hover:bg-rose-50 text-rose-400 hover:text-rose-600 rounded transition-colors">
                                                    <Trash2 size={12} />
                                                  </button>
                                                </div>
                                              </div>
                                              {/* Inline edit for this position */}
                                              {isEditingThis && (
                                                <div className="px-3 pb-3 pt-2 bg-indigo-50/40 border-t border-indigo-100 space-y-2">
                                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                    <div>
                                                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Nombre del puesto</label>
                                                      <input className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.positionName} onChange={(e) => setPositionForm({ ...positionForm, positionName: e.target.value })} />
                                                    </div>
                                                    <div>
                                                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cobertura</label>
                                                      <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.coverageType} onChange={(e) => setPositionForm({ ...positionForm, coverageType: e.target.value })}>
                                                        <option value="24hs">24 hs</option>
                                                        <option value="12hs_diurno">12 hs Diurno</option>
                                                        <option value="12hs_nocturno">12 hs Nocturno</option>
                                                        <option value="custom">Personalizado</option>
                                                      </select>
                                                    </div>
                                                    <div>
                                                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cant. guardias</label>
                                                      <input type="number" min={1} className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.quantity} onChange={(e) => setPositionForm({ ...positionForm, quantity: Number(e.target.value) })} />
                                                    </div>
                                                    <div>
                                                      <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Género requerido</label>
                                                      <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.preferenciaGenero || 'INDISTINTO'} onChange={(e) => setPositionForm({ ...positionForm, preferenciaGenero: e.target.value })}>
                                                        <option value="INDISTINTO">Indistinto</option>
                                                        <option value="M">Masculino</option>
                                                        <option value="F">Femenino</option>
                                                      </select>
                                                    </div>
                                                  </div>
                                                  <div className="flex gap-2 pt-1">
                                                    <button onClick={() => handleSavePosition(s.id, positions, idx)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg font-black uppercase text-[10px] transition-colors">Guardar</button>
                                                    <button onClick={() => setEditingPositionIdx(null)} className="bg-white hover:bg-slate-50 border border-slate-200 px-4 py-1.5 rounded-lg font-black uppercase text-[10px] transition-colors">Cancelar</button>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}

                                        {/* Add new position form */}
                                        {addingPositionToService === s.id && (
                                          <div className="px-3 pb-3 pt-2 bg-emerald-50/40 border-t border-emerald-100 space-y-2">
                                            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-wider">Nuevo puesto</p>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Nombre del puesto</label>
                                                <input className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Ej: Acceso principal" value={positionForm.positionName} onChange={(e) => setPositionForm({ ...positionForm, positionName: e.target.value })} />
                                              </div>
                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cobertura</label>
                                                <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.coverageType} onChange={(e) => setPositionForm({ ...positionForm, coverageType: e.target.value })}>
                                                  <option value="24hs">24 hs</option>
                                                  <option value="12hs_diurno">12 hs Diurno</option>
                                                  <option value="12hs_nocturno">12 hs Nocturno</option>
                                                  <option value="custom">Personalizado</option>
                                                </select>
                                              </div>
                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Cant. guardias</label>
                                                <input type="number" min={1} className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.quantity} onChange={(e) => setPositionForm({ ...positionForm, quantity: Number(e.target.value) })} />
                                              </div>
                                              <div>
                                                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Género requerido</label>
                                                <select className="w-full p-2 rounded-lg border border-slate-200 bg-white font-bold text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" value={positionForm.preferenciaGenero || 'INDISTINTO'} onChange={(e) => setPositionForm({ ...positionForm, preferenciaGenero: e.target.value })}>
                                                  <option value="INDISTINTO">Indistinto</option>
                                                  <option value="M">Masculino</option>
                                                  <option value="F">Femenino</option>
                                                </select>
                                              </div>
                                            </div>
                                            <div className="flex gap-2 pt-1">
                                              <button onClick={() => handleSavePosition(s.id, positions, null)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-1.5 rounded-lg font-black uppercase text-[10px] transition-colors">Agregar</button>
                                              <button onClick={() => { setAddingPositionToService(null); setPositionForm({ positionName: '', coverageType: '24hs', quantity: 1, allowedShiftTypes: [], preferenciaGenero: 'INDISTINTO' }); }} className="bg-white hover:bg-slate-50 border border-slate-200 px-4 py-1.5 rounded-lg font-black uppercase text-[10px] transition-colors">Cancelar</button>
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* SLA summary */}
                                      <div className="mt-2 flex items-center justify-between text-[10px] font-black text-slate-400 uppercase">
                                        <span>{positions.length} puesto{positions.length !== 1 ? 's' : ''} · {slaHs} hs SLA total del período</span>
                                        <button
                                          onClick={() => openNewVersion(s)}
                                          className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700"
                                        >
                                          <Copy size={12} /> Nueva versión
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {activeTab === 'SEDES' && (
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-black text-slate-800 uppercase">Sedes / Objetivos</h3>
                        <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full">
                          {(selectedClient.objetivos || []).length}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setObjectiveForm({ name: '', address: '', lat: '', lng: '', contact: '', notes: '', allowRemoteCheckIn: false });
                          setEditingObjectiveIndex(editingObjectiveIndex === -1 ? null : -1);
                        }}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors"
                      >
                        <Plus size={13} /> Nueva Sede
                      </button>
                    </div>

                    {/* Inline new-sede form */}
                    {editingObjectiveIndex === -1 && (
                      <div className="border-2 border-indigo-200 bg-indigo-50/50 rounded-xl p-5 space-y-3">
                        <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">Nueva sede</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <input
                            className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                            placeholder="Nombre de la sede"
                            value={objectiveForm.name}
                            onChange={(e) => setObjectiveForm({ ...objectiveForm, name: e.target.value })}
                          />
                          <div className="flex gap-2">
                            <input
                              className="borderflex-1 p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                              placeholder="Dirección completa"
                              value={objectiveForm.address}
                              onChange={(e) => setObjectiveForm({ ...objectiveForm, address: e.target.value })}
                            />
                            <button
                              onClick={handleGeocodeSede}
                              disabled={isGeocodingSede}
                              title="Geolocalizar por dirección o coordenadas"
                              className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1 text-[10px] font-black disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {isGeocodingSede ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <input
                            className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                            placeholder="Latitud"
                            value={objectiveForm.lat}
                            onChange={(e) => setObjectiveForm({ ...objectiveForm, lat: e.target.value })}
                          />
                          <input
                            className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                            placeholder="Longitud"
                            value={objectiveForm.lng}
                            onChange={(e) => setObjectiveForm({ ...objectiveForm, lng: e.target.value })}
                          />
                          <input
                            className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                            placeholder="Contacto"
                            value={objectiveForm.contact}
                            onChange={(e) => setObjectiveForm({ ...objectiveForm, contact: e.target.value })}
                          />
                        </div>
                        <input
                          className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                          placeholder="Notas"
                          value={objectiveForm.notes}
                          onChange={(e) => setObjectiveForm({ ...objectiveForm, notes: e.target.value })}
                        />
                        <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${objectiveForm.allowRemoteCheckIn ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                          <div
                            className={`relative w-10 h-5 rounded-full transition-colors ${objectiveForm.allowRemoteCheckIn ? 'bg-amber-500' : 'bg-slate-300'}`}
                            onClick={() => setObjectiveForm({ ...objectiveForm, allowRemoteCheckIn: !objectiveForm.allowRemoteCheckIn })}
                          >
                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${objectiveForm.allowRemoteCheckIn ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                          </div>
                          <div>
                            <div className={`text-xs font-black uppercase ${objectiveForm.allowRemoteCheckIn ? 'text-amber-700' : 'text-slate-500'}`}>
                              {objectiveForm.allowRemoteCheckIn ? 'Check-in remoto habilitado' : 'Check-in por GPS (requiere cercanía)'}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {objectiveForm.allowRemoteCheckIn
                                ? 'El empleado puede marcar presencia sin importar su ubicación'
                                : 'El empleado debe estar a menos de 80m del objetivo para marcar'}
                            </div>
                          </div>
                        </label>
                        <div className="flex gap-2 pt-1">
                          <button onClick={handleSaveObjective} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">
                            Guardar
                          </button>
                          <button onClick={resetObjectiveForm} className="bg-white hover:bg-slate-50 border border-slate-200 px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sedes list */}
                    {(selectedClient.objetivos || []).length === 0 && editingObjectiveIndex !== -1 ? (
                      <div className="text-center py-12 text-slate-400">
                        <MapPin size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-bold">Sin sedes registradas</p>
                        <p className="text-[11px]">Hacé clic en "Nueva Sede" para agregar una</p>
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                        {(selectedClient.objetivos || []).map((o: any, idx: number) => (
                          <div key={idx}>
                            {/* Row */}
                            <div
                              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${editingObjectiveIndex === idx ? 'bg-indigo-50/60' : ''}`}
                              onClick={() => {
                                if (editingObjectiveIndex === idx) {
                                  resetObjectiveForm();
                                } else {
                                  startEditObjective(o, idx);
                                }
                              }}
                            >
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${o.lat && o.lng ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                <MapPin size={16} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-black text-slate-800 text-sm uppercase truncate">{o.name}</p>
                                <p className="text-[11px] font-bold text-slate-400 truncate">{o.address || 'Sin dirección'}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {!o.id && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRepairObjectiveId(o, idx); }}
                                    className="bg-rose-100 text-rose-700 text-[10px] font-black px-2 py-0.5 rounded-full hover:bg-rose-200 transition-colors"
                                    title="ID perdido — clic para restaurar"
                                  >⚠ Reparar ID</button>
                                )}
                                {o.allowRemoteCheckIn && (
                                  <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full" title="Check-in remoto habilitado">REMOTO</span>
                                )}
                                {o.lat && o.lng ? (
                                  <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-0.5 rounded-full">GPS</span>
                                ) : (
                                  <span className="bg-slate-100 text-slate-400 text-[10px] font-black px-2 py-0.5 rounded-full">Sin GPS</span>
                                )}
                                {o.lat && o.lng ? (
                                  <a
                                    href={`https://www.google.com/maps?q=${o.lat},${o.lng}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg transition-colors"
                                    title="Ver en Google Maps"
                                  >
                                    <Globe size={14} />
                                  </a>
                                ) : null}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteObjective(idx); }}
                                  className="p-1.5 hover:bg-rose-50 text-rose-400 hover:text-rose-600 rounded-lg transition-colors"
                                  title="Eliminar"
                                >
                                  <Trash2 size={14} />
                                </button>
                                {editingObjectiveIndex === idx ? <ChevronUp size={16} className="text-indigo-400" /> : <ChevronDown size={16} className="text-slate-300" />}
                              </div>
                            </div>

                            {/* Inline edit form (expanded) */}
                            {editingObjectiveIndex === idx && (
                              <div className="px-4 pb-4 pt-2 bg-indigo-50/40 border-t border-indigo-100 space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <input
                                    className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                                    placeholder="Nombre de la sede"
                                    value={objectiveForm.name}
                                    onChange={(e) => setObjectiveForm({ ...objectiveForm, name: e.target.value })}
                                  />
                                  <div className="flex gap-2">
                                    <input
                                      className="borderflex-1 p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                                      placeholder="Dirección completa"
                                      value={objectiveForm.address}
                                      onChange={(e) => setObjectiveForm({ ...objectiveForm, address: e.target.value })}
                                    />
                                    <button
                                      onClick={handleGeocodeSede}
                                      disabled={isGeocodingSede}
                                      title="Geolocalizar por dirección o coordenadas"
                                      className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1 text-[10px] font-black disabled:opacity-50 transition-colors"
                                    >
                                      {isGeocodingSede ? <Loader2 size={14} className="animate-spin" /> : <Navigation size={14} />}
                                    </button>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <input
                                    className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                                    placeholder="Latitud"
                                    value={objectiveForm.lat}
                                    onChange={(e) => setObjectiveForm({ ...objectiveForm, lat: e.target.value })}
                                  />
                                  <input
                                    className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                                    placeholder="Longitud"
                                    value={objectiveForm.lng}
                                    onChange={(e) => setObjectiveForm({ ...objectiveForm, lng: e.target.value })}
                                  />
                                  <input
                                    className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                                    placeholder="Contacto"
                                    value={objectiveForm.contact}
                                    onChange={(e) => setObjectiveForm({ ...objectiveForm, contact: e.target.value })}
                                  />
                                </div>
                                <input
                                  className="borderw-full p-3 rounded-xl font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" style={{ backgroundColor: 'var(--surf2)', borderColor: 'var(--border)', color: 'var(--txt)' }}
                                  placeholder="Notas"
                                  value={objectiveForm.notes}
                                  onChange={(e) => setObjectiveForm({ ...objectiveForm, notes: e.target.value })}
                                />
                                <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${objectiveForm.allowRemoteCheckIn ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                                  <div
                                    className={`relative w-10 h-5 rounded-full transition-colors ${objectiveForm.allowRemoteCheckIn ? 'bg-amber-500' : 'bg-slate-300'}`}
                                    onClick={() => setObjectiveForm({ ...objectiveForm, allowRemoteCheckIn: !objectiveForm.allowRemoteCheckIn })}
                                  >
                                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${objectiveForm.allowRemoteCheckIn ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                                  </div>
                                  <div>
                                    <div className={`text-xs font-black uppercase ${objectiveForm.allowRemoteCheckIn ? 'text-amber-700' : 'text-slate-500'}`}>
                                      {objectiveForm.allowRemoteCheckIn ? 'Check-in remoto habilitado' : 'Check-in por GPS (requiere cercanía)'}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      {objectiveForm.allowRemoteCheckIn
                                        ? 'El empleado puede marcar presencia sin importar su ubicación'
                                        : 'El empleado debe estar a menos de 80m del objetivo para marcar'}
                                    </div>
                                  </div>
                                </label>
                                <div className="flex gap-2 pt-1">
                                  <button onClick={handleSaveObjective} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">
                                    Actualizar
                                  </button>
                                  <button onClick={resetObjectiveForm} className="bg-white hover:bg-slate-50 border border-slate-200 px-6 py-2 rounded-xl font-black uppercase text-xs transition-colors">
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                  </div>
                )}

                {activeTab === 'PREFACTURA' && (
                  <ProformaPanel
                    client={selectedClient}
                    empresaName={empresa?.name}
                    proformaMonth={proformaMonth}
                    proformaYear={proformaYear}
                    proformaStartDate={proformaStartDate}
                    proformaEndDate={proformaEndDate}
                    proformaDetailMode={proformaDetailMode}
                    proformaBase={proformaBase}
                    proformaHourlyValue={proformaHourlyValue}
                    proformaTotals={proformaTotals}
                    proformaBreakdown={proformaBreakdown}
                    proformaBundle={proformaBundle}
                    baseHours={baseHours}
                    totalEstimate={totalEstimate}
                    monthsEs={MONTHS_ES}
                    expandedKeys={expandedKeys}
                    onMonthChange={setProformaMonth}
                    onYearChange={setProformaYear}
                    onStartDateChange={setProformaStartDate}
                    onEndDateChange={setProformaEndDate}
                    onDetailModeChange={setProformaDetailMode}
                    onBaseChange={setProformaBase}
                    onHourlyValueChange={setProformaHourlyValue}
                    onRecalculate={calculateProformaTurnos}
                    onToggleExpanded={toggleExpandedKey}
                    onExportPdf={handleExportProformaPdf}
                    onExportCsv={handleExportProformaCsv}
                    onExportExcel={handleExportProformaExcel}
                    exporting={proformaExporting}
                  />
                )}

                {activeTab === 'COTIZACIONES' && (
                  loadingClientData ? (
                    <div className="py-16 text-center text-slate-400">
                      <Loader2 className="animate-spin mx-auto mb-2" size={24} />
                      <p className="text-sm font-bold">Cargando cotizaciones…</p>
                    </div>
                  ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl font-black text-slate-800 uppercase">Propuestas</h3>
                        <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full">{clientQuotes.length}</span>
                      </div>
                      <button onClick={() => router.push('/admin/cotizador')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-1.5 transition-colors">
                        <Plus size={13} /> Nueva
                      </button>
                    </div>

                    {clientQuotes.length === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <FileText size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-bold">Sin propuestas registradas</p>
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                        {clientQuotes.map((q) => (
                          <div key={q.id} className="flex items-center gap-3 px-4 py-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
                              <FileText size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-black text-slate-800 text-sm">{q.createdAt?.toDate?.().toLocaleDateString?.() || '-'}</p>
                              <p className="text-[11px] font-bold text-slate-400">{formatMoney(q.results?.valorTotalContrato)}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {q.pdfUrl || q.pdf || q.fileUrl || q.url ? (
                                <a href={q.pdfUrl || q.pdf || q.fileUrl || q.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-colors">
                                  <Printer size={13} /> PDF
                                </a>
                              ) : (
                                <span className="text-[10px] font-bold text-slate-300">Sin PDF</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  )
                )}

                {activeTab === 'HISTORIAL' && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black text-slate-800 uppercase">Historial</h3>
                      <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full">{(selectedClient.historial || []).length}</span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        className="flex-1 p-3 border border-slate-200 rounded-xl bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="Agregar nota..."
                        value={historyNote}
                        onChange={(e) => setHistoryNote(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddHistory(); }}
                      />
                      <button onClick={handleAddHistory} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 rounded-xl transition-colors">
                        <Send size={18} />
                      </button>
                    </div>

                    {(selectedClient.historial || []).length === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <Send size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-bold">Sin notas registradas</p>
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                        {[...(selectedClient.historial || [])].reverse().map((h: any, i: number) => (
                          <div key={i} className="flex items-start gap-3 px-4 py-3">
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Send size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-black text-slate-400 uppercase">{h.user} · {new Date(h.date).toLocaleString()}</p>
                              <p className="text-sm font-bold text-slate-700 mt-0.5">{h.note}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          </div>
        </PageShell>
      )}
      {newClientOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setNewClientOpen(false)}>
          <div className="bg-white rounded-xl p-8 w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-black text-slate-800 uppercase">Nuevo Cliente</h3>
              <button onClick={() => setNewClientOpen(false)} className="p-2 rounded-xl hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Nombre comercial *</label>
                <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Ej: Empresa SA" value={newClientForm.name} onChange={(e) => setNewClientForm({ ...newClientForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Razón social</label>
                  <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Razón social" value={newClientForm.legalName} onChange={(e) => setNewClientForm({ ...newClientForm, legalName: e.target.value })} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">CUIT</label>
                  <div className="flex gap-2">
                    <input className="w-full flex-1 p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="XX-XXXXXXXX-X" value={newClientForm.taxId} onChange={(e) => setNewClientForm({ ...newClientForm, taxId: e.target.value })} />
                    <button
                      type="button"
                      disabled={afipLookupLoading === 'new'}
                      onClick={() => void handleAfipLookup('new')}
                      className="shrink-0 px-3 py-2 rounded-xl border border-indigo-200 text-indigo-600 hover:bg-indigo-50 text-[10px] font-black uppercase flex items-center gap-1 disabled:opacity-40"
                      title="Consultar padrón AFIP"
                    >
                      {afipLookupLoading === 'new' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      AFIP
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Condición IVA</label>
                  <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Resp. Inscripto..." value={newClientForm.ivaStatus} onChange={(e) => setNewClientForm({ ...newClientForm, ivaStatus: e.target.value })} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Teléfono</label>
                  <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Teléfono" value={newClientForm.phone} onChange={(e) => setNewClientForm({ ...newClientForm, phone: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Email</label>
                <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="email@empresa.com" value={newClientForm.email} onChange={(e) => setNewClientForm({ ...newClientForm, email: e.target.value })} />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Dirección</label>
                <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Dirección" value={newClientForm.address} onChange={(e) => setNewClientForm({ ...newClientForm, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Ciudad</label>
                  <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Ciudad" value={newClientForm.city} onChange={(e) => setNewClientForm({ ...newClientForm, city: e.target.value })} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Provincia</label>
                  <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Provincia" value={newClientForm.state} onChange={(e) => setNewClientForm({ ...newClientForm, state: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Contacto</label>
                <input className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Nombre del contacto" value={newClientForm.contactName} onChange={(e) => setNewClientForm({ ...newClientForm, contactName: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setNewClientOpen(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-500 font-black text-[10px] uppercase hover:bg-slate-50 transition-colors">Cancelar</button>
              <button onClick={handleCreateClient} disabled={savingNewClient} className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-black text-[10px] uppercase hover:bg-indigo-700 transition-colors disabled:opacity-40">
                {savingNewClient ? 'Creando...' : 'Crear Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
