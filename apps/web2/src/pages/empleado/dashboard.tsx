import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AuthGuard from '@/components/auth/AuthGuard';
import { Calendar, MapPin, Bell, FileText, CheckCircle, AlertTriangle, Navigation, BellRing, Sun, Sunset, Moon, ArrowLeftRight, Search, X, CreditCard, Star, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { eventoService, serviciosParaFecha, type Evento, type ServicioEvento } from '@/services/eventoService';
import { solicitudEventoService, type SolicitudEvento } from '@/services/solicitudEventoService';
import CredencialDigital from '@/components/empleado/CredencialDigital';
import { app, db, functions, storage, auth, onSnapshotFresh } from '@/lib/firebase';
import { collection, doc, serverTimestamp, addDoc, setDoc, deleteDoc, query, where, orderBy, limit, updateDoc, getDocs, getDoc, Timestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { stampEmpresaId } from '@/lib/multiempresa';

type Shift = {
  id: string;
  startTime?: any;
  endTime?: any;
  objectiveId?: string;
  objectiveName?: string;
  clientName?: string;
  positionName?: string;
  status?: string;
  isPresent?: boolean;
  isCompleted?: boolean;
  isAbsent?: boolean;
  isFranco?: boolean;
  checkInTime?: any;
  checkInRequestedAt?: any;
  checkInRequestStatus?: string;
  lateArrivalAt?: any;
  // Campos de evento
  eventoId?: string;
  eventoNombre?: string;
  servicioId?: string;
  servicioNombre?: string;
  code?: string;
  type?: string;
  hours?: number;
};

type ObjectiveLocation = { lat: number; lng: number; name: string; clientName?: string; address?: string; allowRemoteCheckIn?: boolean };

const toDate = (val: any) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val.toDate) return val.toDate();
  const seconds = val.seconds ?? val._seconds;
  if (typeof seconds === 'number') return new Date(seconds * 1000);
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const formatDate = (val: any) => {
  const d = toDate(val);
  return d ? d.toLocaleDateString('es-AR') : '-';
};

const formatTime = (val: any) => {
  const d = toDate(val);
  return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '-';
};

// INGRESO: llegó antes o dentro de los 5 min post-inicio → hora planificada.
// Si llegó más de 5 min tarde → se muestra el tiempo real (llegó tarde).
const clampStart = (realVal: any, planVal: any, toleranceMin = 5): Date | null => {
  const real = toDate(realVal);
  const plan = toDate(planVal);
  if (!real || !plan) return real;
  const diffMin = (real.getTime() - plan.getTime()) / 60000; // positivo = llegó tarde
  return diffMin <= toleranceMin ? plan : real;
};

// EGRESO: dentro de ±5 min del horario de fin → hora planificada.
// Si salió más de 5 min tarde (retención real) → se muestra el tiempo real.
const clampEnd = (realVal: any, planVal: any, toleranceMin = 5): Date | null => {
  const real = toDate(realVal);
  const plan = toDate(planVal);
  if (!real || !plan) return real;
  const diffMin = Math.abs((real.getTime() - plan.getTime()) / 60000);
  return diffMin <= toleranceMin ? plan : real;
};

// Compat alias para useReportes (ambos usos eran simétricos, se mantiene)
const clampToShiftTime = clampEnd;

const formatDuration = (ms: number) => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const formatDurationRange = (startVal: any, endVal: any) => {
  const start = toDate(startVal);
  const end = toDate(endVal);
  if (!start || !end) return '-';
  return formatDuration(end.getTime() - start.getTime());
};

const PENDING_CHECKINS_KEY = 'pending_checkins';
const SWAP_PEOPLE_CACHE_KEY = 'swap_people_cache';

const isFinalizedShift = (shift: Shift, now: Date) => {
  const status = (shift.status || '').toString().toLowerCase();
  const endDate = toDate(shift.endTime);
  const startDate = toDate(shift.startTime);
  const startDay = startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) : null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return (
    shift.isCompleted ||
    shift.isAbsent ||
    status === 'completed' ||
    status === 'finalizado' ||
    status === 'finalized' ||
    status === 'final' ||
    status === 'ausente' ||
    status === 'absent' ||
    status.includes('final') ||
    status.includes('complet') ||
    status.includes('ausent') ||
    (endDate && endDate < now) ||
    (!endDate && startDay && startDay < today)
  );
};

const formatDistance = (km: number | null) => {
  if (km === null) return '-';
  const meters = Math.round(km * 1000);
  return `${meters} m`;
};

const normalizeField = (val: any) => {
  if (!val) return null;
  const d = toDate(val);
  if (d) return d.getTime();
  return val;
};

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function EmployeeDashboard() {
  const { addToast } = useToast();
  const { empresa: empresaCtx } = useEmpresa();
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [empProfile, setEmpProfile] = useState<{ firstName?: string; lastName?: string; fileNumber?: string; dni?: string; cuil?: string; category?: string; photoUrl?: string; empresaId?: string } | null>(null);
  const [empresaNombre, setEmpresaNombre] = useState<string>('');
  const [empresaColor, setEmpresaColor] = useState<string>('#6366f1');
  const [showCredencial, setShowCredencial] = useState(false);
  const [showCredencialVista, setShowCredencialVista] = useState(false);
  // Ref para el handler de back button (Android PWA)
  const backCloserRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onPop = () => { backCloserRef.current?.(); backCloserRef.current = null; };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [empDocIdSt, setEmpDocIdSt] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [objectivesMap, setObjectivesMap] = useState<Record<string, ObjectiveLocation>>({});
  const [eventosMap, setEventosMap] = useState<Record<string, any>>({});
  const [eventosDisponibles, setEventosDisponibles] = useState<Evento[]>([]);
  const [mySolicitudes, setMySolicitudes] = useState<SolicitudEvento[]>([]);
  const [loadingEventosDisp, setLoadingEventosDisp] = useState(false);
  const [showEventosDisp, setShowEventosDisp] = useState(false);
  const [solicitandoId, setSolicitandoId] = useState<string | null>(null);
  const [respondiendoConvId, setRespondiendoConvId] = useState<string | null>(null);
  const [checkingShiftId, setCheckingShiftId] = useState<string | null>(null);
  const [absenceType, setAbsenceType] = useState<'Vacaciones' | 'Enfermedad' | 'ART' | 'Ausencia con aviso' | 'Licencia Esp.'>('Vacaciones');
  const [absenceReason, setAbsenceReason] = useState('');
  const [absenceStart, setAbsenceStart] = useState('');
  const [absenceEnd, setAbsenceEnd] = useState('');
  const [absenceFile, setAbsenceFile] = useState<File | null>(null);
  const [absenceFileUrl, setAbsenceFileUrl] = useState('');
  const [absenceFileName, setAbsenceFileName] = useState('');
  const [absenceUploading, setAbsenceUploading] = useState(false);
  // Ausencias AA pendientes de justificación (para upload de certificado)
  const [myPendingAbsences, setMyPendingAbsences] = useState<Array<{ id: string; startDate: string; reason?: string; objectiveName?: string; positionName?: string; certificateUrl?: string }>>([]);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certUploadingId, setCertUploadingId] = useState<string | null>(null);
  const [showCertModal, setShowCertModal] = useState<string | null>(null); // ausenciaId
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleView, setScheduleView] = useState<'HOY' | 'SEMANA' | 'MES'>('HOY');
  const [showUpcomingTable, setShowUpcomingTable] = useState(false);
  const [showAbsenceRequest, setShowAbsenceRequest] = useState(false);
  const [now, setNow] = useState(new Date());
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<Date | null>(null);
  const [expandedShiftIds, setExpandedShiftIds] = useState<Record<string, boolean>>({});
  const [notifStatus, setNotifStatus] = useState<'off' | 'enabled' | 'denied' | 'error'>('off');
  const [notifBusy, setNotifBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [inbox, setInbox] = useState<any[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const inboxBucketsRef = useRef<Record<string, any[]>>({});
  const inboxFallbackRef = useRef<Set<string>>(new Set());
  const ADMIN_NOTIF_TYPES = new Set([
    'RETENCION_DETECTADA','RETENCION_LARGA','VACANTE_PROTOCOLO_COBERTURA',
    'RELEVO_NO_PRESENTADO','POSICION_SIN_RELEVO','RECARGO_12H',
    'AUSENCIA_AUTO','AUSENCIA_CORTO_PLAZO','AVISO_AUSENCIA_ANTICIPADA',
    'INGRESO_AUTOREGISTRO_ALERTA','RELEVO_INMINENTE',
  ]);
  const monthInbox = useMemo(() => {
    const now = new Date();
    return inbox.filter((n) => {
      const d = toDate(n.createdAt);
      if (!d) return false;
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false;
      // Excluir notificaciones de admin (target:'admin' o tipos operativos conocidos)
      if (n.target === 'admin') return false;
      if (ADMIN_NOTIF_TYPES.has(n.type)) return false;
      return true;
    });
  }, [inbox]);
  const unreadInbox = useMemo(() => monthInbox.filter((n) => !n.read), [monthInbox]);
  const allMonthRead = monthInbox.length > 0 && monthInbox.every((n) => n.read);
  const hasUnread = monthInbox.some((n) => !n.read);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCompletedPanel, setShowCompletedPanel] = useState(false);
  const [completedView, setCompletedView] = useState<'HOY' | 'SEMANA' | 'MES'>('MES');
  const [showPresentHistory, setShowPresentHistory] = useState(false);
  const [pendingCheckins, setPendingCheckins] = useState(0);
  const [lateArrivalSent, setLateArrivalSent] = useState<Record<string, boolean>>({});
  const [showSwap, setShowSwap] = useState(false);
  const [swapShiftId, setSwapShiftId] = useState('');
  const [swapTargetShiftId, setSwapTargetShiftId] = useState('');
  const [swapCandidates, setSwapCandidates] = useState<any[]>([]);
  const [swapPeopleList, setSwapPeopleList] = useState<{ key: string; name: string }[]>([]);
  const [swapRequests, setSwapRequests] = useState<any[]>([]);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapSearched, setSwapSearched] = useState(false);
  const [swapSearch, setSwapSearch] = useState('');
  const [swapPersonKey, setSwapPersonKey] = useState('');
  const [portalFeatures, setPortalFeatures] = useState({
    checkIn: true,
    reportAbsence: true,
    requestLicense: true,
    swapShifts: true,
    viewSchedule: true,
    viewEvents: true,
  });

  const [deviceVerified, setDeviceVerified] = useState<boolean | null>(null);

  const { user, isSuperAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  // ── Superadmin preview mode ──────────────────────────────────────────────
  const previewEmpId = (router.isReady && isSuperAdmin) ? ((router.query.preview as string) || null) : null;
  const isPreviewMode = !!(isSuperAdmin && previewEmpId);
  const [previewEmployees, setPreviewEmployees] = useState<Array<{ id: string; name: string; empresa?: string; fileNumber?: string }>>([]);
  const [previewSearch, setPreviewSearch] = useState('');
  const [showPreviewPicker, setShowPreviewPicker] = useState(false);
  const [previewEmpresaFilter, setPreviewEmpresaFilter] = useState<string | null>(null);

  const previousShiftRef = useRef<Map<string, Shift>>(new Map());
  const shiftInitialLoadDone = useRef(false);
  const [shiftAlerts, setShiftAlerts] = useState<Array<{ id: string; type: 'MODIFIED' | 'ADDED' | 'REMOVED'; shift: Shift; prev?: Shift; at: Date }>>([]);
  const empDocIdRef = useRef<string | null>(null);
  const [showLogoutMenu, setShowLogoutMenu] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load employees for superadmin preview picker
  useEffect(() => {
    if (!isSuperAdmin) return;
    getDocs(query(collection(db, 'empleados'), orderBy('lastName'), limit(500))).then(snap => {
      setPreviewEmployees(snap.docs.map(d => {
        const data = d.data();
        const name = `${data.lastName || ''}, ${data.firstName || data.nombre || ''}`.trim().replace(/^,\s*/, '');
        return { id: d.id, name: name || d.id, empresa: data.empresaId || '', fileNumber: data.fileNumber || data.legajo || '' };
      }));
    }).catch(() => {});
  }, [isSuperAdmin]);

  const startPressTimer = () => {
    pressTimerRef.current = setTimeout(() => setShowLogoutMenu(true), 1500);
  };
  const cancelPressTimer = () => {
    if (pressTimerRef.current) { clearTimeout(pressTimerRef.current); pressTimerRef.current = null; }
  };
  const handleLogout = async () => {
    try { await signOut(auth); } catch (_) {}
    window.location.href = '/login';
  };

  // Resolve empleados document ID once and cache it
  const resolveEmpDocId = async (): Promise<string | null> => {
    if (empDocIdRef.current) return empDocIdRef.current;
    if (!user) return null;

    // 1. Buscar por campo uid (forma correcta para usuarios del portal)
    const byUid = await getDocs(query(collection(db, 'empleados'), where('uid', '==', user.uid)));
    if (!byUid.empty) {
      // Si hay varios con ese uid (datos sucios), preferir el que coincida por email
      const emailMatch = user.email
        ? byUid.docs.find(d => (d.data().email || '').toLowerCase() === user.email!.toLowerCase())
        : null;
      const best = emailMatch || byUid.docs[0];
      empDocIdRef.current = best.id; return best.id;
    }

    // 2. Buscar por ID del documento igual al uid (caso raro, legado)
    const byId = await getDoc(doc(db, 'empleados', user.uid));
    if (byId.exists()) { empDocIdRef.current = byId.id; return byId.id; }

    // 3. Fallback por email
    if (user.email) {
      const byEmail = await getDocs(query(collection(db, 'empleados'), where('email', '==', user.email.trim())));
      if (!byEmail.empty) { empDocIdRef.current = byEmail.docs[0].id; return byEmail.docs[0].id; }
    }
    return null;
  };

  const loadObjectives = async () => {
    const map: Record<string, ObjectiveLocation> = {};

    const addEntry = (key: string, entry: ObjectiveLocation) => {
      if (!key) return;
      map[key] = entry;
    };

    // 1) Colección standalone "objetivos" (para lat/lng del check-in)
    try {
      const snap = await getDocs(collection(db, 'objetivos'));
      snap.forEach(d => {
        const data = d.data();
        const entry: ObjectiveLocation = {
          lat: data.lat || data.latitude || 0,
          lng: data.lng || data.longitude || 0,
          name: data.name || data.nombre || d.id,
          clientName: data.clientName || data.nombreCliente || '',
          address: data.address || data.direccion || '',
        };
        addEntry(d.id, entry);               // por Firestore doc ID
        if (data.name)   addEntry(data.name, entry);    // por nombre
        if (data.nombre) addEntry(data.nombre, entry);  // por nombre (ES)
        if (data.id)     addEntry(String(data.id), entry); // por campo id explícito
      });
    } catch (_) {}

    // 2) Colección "clients" (la que usa el planificador) → objetivos embebidos
    try {
      const clientsSnap = await getDocs(collection(db, 'clients'));
      clientsSnap.forEach(cd => {
        const cdata = cd.data();
        const clientName = cdata.name || cdata.nombre || cdata.razonSocial || '';
        (cdata.objetivos || []).forEach((o: any) => {
          const entry: ObjectiveLocation = {
            lat: o.lat || o.latitude || 0,
            lng: o.lng || o.longitude || 0,
            name: o.name || o.nombre || String(o.id || ''),
            clientName: o.clientName || clientName,
            address: o.address || o.direccion || '',
            allowRemoteCheckIn: !!o.allowRemoteCheckIn,
          };
          if (o.id)     addEntry(String(o.id), entry);   // objectiveId en turnos = String(o.id)
          if (o.name)   addEntry(o.name, entry);
          if (o.nombre) addEntry(o.nombre, entry);
        });
      });
    } catch (_) {}

    setObjectivesMap(map);
  };

  const fetchShifts = async (): Promise<() => void> => {
    if (!user) return () => {};
    setLoadingShifts(true);

    let empDocId: string | null = null;

    // Superadmin preview mode: use the query param directly, skip resolveEmpDocId
    if (isPreviewMode && previewEmpId) {
      empDocId = previewEmpId;
      setEmpDocIdSt(empDocId);
    } else {
      try {
        empDocId = await resolveEmpDocId();
        if (empDocId) setEmpDocIdSt(empDocId);
      } catch (resolveErr: any) {
        console.error('[dashboard] resolveEmpDocId error:', resolveErr?.code, resolveErr?.message);
        addToast(`Sin acceso al perfil (${resolveErr?.code || 'error'})`, 'error');
        setLoadingShifts(false);
        return () => {};
      }

      if (!empDocId) {
        // Superadmin sin preview param: mostrar picker en vez de redirigir a login
        if (isSuperAdmin) {
          setLoadingShifts(false);
          setShowPreviewPicker(true);
          return () => {};
        }
        console.warn('[dashboard] No empleados doc found for uid:', user.uid, 'email:', user.email);
        addToast('Perfil de empleado no encontrado. Contactar al administrador.', 'error');
        setTimeout(() => { signOut(auth).catch(() => {}); window.location.href = '/login'; }, 3000);
        setShifts([]);
        setLoadingShifts(false);
        return () => {};
      }
    }

    // Cargar datos del empleado desde Firestore (no depender del displayName de Firebase Auth)
    try {
      const empDoc = await getDoc(doc(db, 'empleados', empDocId));
      if (empDoc.exists()) {
        const d = empDoc.data();
        setEmpProfile({
          firstName: d.firstName || d.nombre,
          lastName: d.lastName || d.apellido,
          fileNumber: d.fileNumber || d.legajo,
          dni: d.dni || d.document,
          cuil: d.cuil,
          category: d.category || d.cargo,
          photoUrl: d.photoUrl || d.fotoUrl || undefined,
          empresaId: d.empresaId || undefined,
        });
        if (d.empresaId) {
          getDoc(doc(db, 'empresas', d.empresaId))
            .then(eDoc => {
              if (eDoc.exists()) {
                const ed = eDoc.data();
                setEmpresaNombre(ed.name || ed.nombre || '');
                if (ed.primaryColor) setEmpresaColor(ed.primaryColor);
              }
            })
            .catch(() => {});
        }
      }
    } catch (_) {}

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, 'turnos'),
      where('employeeId', '==', empDocId),
      where('startTime', '>=', Timestamp.fromDate(start)),
      where('startTime', '<=', Timestamp.fromDate(end))
    );

    const applyShiftList = (list: Shift[]) => {
      const newMap = new Map<string, Shift>();
      list.forEach((s) => newMap.set(s.id, s));

      if (shiftInitialLoadDone.current) {
        const newAlerts: Array<{ id: string; type: 'MODIFIED' | 'ADDED' | 'REMOVED'; shift: Shift; prev?: Shift; at: Date }> = [];
        newMap.forEach((current, id) => {
          const previous = previousShiftRef.current.get(id);
          if (previous) {
            const fields: Array<keyof Shift> = ['startTime', 'endTime', 'objectiveName', 'clientName', 'objectiveId', 'positionName'];
            const changed = fields.some((f) => normalizeField((previous as any)[f]) !== normalizeField((current as any)[f]));
            if (changed) {
              newAlerts.push({ id: `modified-${id}-${Date.now()}`, type: 'MODIFIED', shift: current, prev: previous, at: new Date() });
            }
          } else {
            newAlerts.push({ id: `added-${id}-${Date.now()}`, type: 'ADDED', shift: current, at: new Date() });
          }
        });
        previousShiftRef.current.forEach((previous, id) => {
          if (!newMap.has(id)) {
            newAlerts.push({ id: `removed-${id}-${Date.now()}`, type: 'REMOVED', shift: previous, at: new Date() });
          }
        });
        if (newAlerts.length > 0) {
          setShiftAlerts(prev => [...newAlerts, ...prev].slice(0, 5));
        }
      } else {
        shiftInitialLoadDone.current = true;
      }

      previousShiftRef.current = newMap;
      setShifts(list);
      setLoadingShifts(false);
    };

    const loadShiftsOnce = async () => {
      try {
        const snap = await getDocs(q);
        const list: Shift[] = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Shift))
          .sort((a: any, b: any) => {
            const ad = toDate(a.startTime)?.getTime() ?? 0;
            const bd = toDate(b.startTime)?.getTime() ?? 0;
            return ad - bd;
          });
        applyShiftList(list);
      } catch (e: any) {
        console.error('[dashboard] getDocs shifts error:', e?.code, e?.message);
        addToast(`Error cargando cronograma (${e?.code || 'error'})`, 'error');
        setLoadingShifts(false);
      }
    };

    await loadShiftsOnce();

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadShiftsOnce();
    };
    document.addEventListener('visibilitychange', onVisible);
    const refreshInterval = setInterval(loadShiftsOnce, 5 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(refreshInterval);
    };
  };

  const displayName = useMemo(() => {
    // Priorizar nombre real del documento Firestore (no Firebase Auth displayName)
    if (empProfile?.lastName || empProfile?.firstName) {
      return `${empProfile.lastName || ''}${empProfile.lastName && empProfile.firstName ? ', ' : ''}${empProfile.firstName || ''}`.trim();
    }
    if (!user) return 'Empleado';
    if (user.email) return user.email.split('@')[0];
    return 'Empleado';
  }, [user, empProfile]);

  const scrollToSection = (id: string, open?: () => void) => {
    if (open) open();
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };

  useEffect(() => {
    if (!user || authLoading) return;
    // In preview mode, wait until router is ready and previewEmpId is resolved
    if (isSuperAdmin && !router.isReady) return;
    let unsub: (() => void) | null = null;
    loadObjectives();
    fetchShifts().then(u => { unsub = u; });
    return () => { if (unsub) unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, authLoading, previewEmpId]);

  // Cargar documentos de evento para turnos EV
  useEffect(() => {
    const ids = [...new Set(shifts.filter(s => s.eventoId).map(s => s.eventoId as string))];
    if (ids.length === 0) return;
    Promise.all(ids.map(id => getDoc(doc(db, 'eventos', id))))
      .then(docs => {
        const map: Record<string, any> = {};
        docs.forEach(d => { if (d.exists()) map[d.id] = { id: d.id, ...d.data() }; });
        setEventosMap(map);
      })
      .catch(() => {});
  }, [shifts]);

  // Cargar eventos disponibles para solicitar + solicitudes propias
  useEffect(() => {
    const empresaId = empProfile?.empresaId;
    const empId = empDocIdSt;
    if (!empresaId || !empId) return;
    setLoadingEventosDisp(true);
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const to = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(nextMonth.getDate()).padStart(2, '0')}`;
    Promise.all([
      eventoService.getByEmpresaAndRange(empresaId, from, to),
      solicitudEventoService.getByEmpleado(empId, empresaId, from, to),
    ]).then(([evs, sols]) => {
      setEventosDisponibles(evs);
      setMySolicitudes(sols);
    }).catch(() => {}).finally(() => setLoadingEventosDisp(false));
  }, [empProfile?.empresaId, empDocIdSt]);

  useEffect(() => {
    if (!user || authLoading) return;
    // Superadmin en modo preview: saltar verificación de dispositivo
    if (isSuperAdmin) { setDeviceVerified(true); return; }
    const localDeviceId = typeof window !== 'undefined' ? localStorage.getItem('cosp_device_id') : null;
    // Verificar si el empleado tiene bypassDeviceCheck activo (para pruebas / acceso directo)
    resolveEmpDocId().then(async (empDocId) => {
      if (empDocId) {
        const empSnap = await getDoc(doc(db, 'empleados', empDocId));
        if (empSnap.exists() && empSnap.data()?.bypassDeviceCheck === true) {
          setDeviceVerified(true);
          return;
        }
      }
      getDoc(doc(db, 'device_tokens', user.uid)).then(snap => {
        if (!snap.exists()) { setDeviceVerified(false); return; }
        const d = snap.data();
        if (!d.verified) { setDeviceVerified(false); return; }
        // Sin deviceId almacenado (activación anterior) → compatible hacia atrás
        if (!d.deviceId) { setDeviceVerified(true); return; }
        setDeviceVerified(d.deviceId === localDeviceId);
      }).catch(() => setDeviceVerified(null));
    }).catch(() => {
      // Si falla resolver el doc, caer en el chequeo normal
      getDoc(doc(db, 'device_tokens', user.uid)).then(snap => {
        if (!snap.exists()) { setDeviceVerified(false); return; }
        const d = snap.data();
        if (!d.verified) { setDeviceVerified(false); return; }
        if (!d.deviceId) { setDeviceVerified(true); return; }
        setDeviceVerified(d.deviceId === localDeviceId);
      }).catch(() => setDeviceVerified(null));
    });
  }, [user?.uid, authLoading]);

  useEffect(() => {
    if (!user) return;
    loadSwapRequests();
    const t = setInterval(() => loadSwapRequests(), 60000);
    return () => clearInterval(t);
  }, [user?.uid]);

  useEffect(() => {
    if (hasUnread) setShowNotifications(true);
  }, [hasUnread]);


  useEffect(() => {
    if (!user) return;
    setLoadingInbox(true);
    inboxBucketsRef.current = {};
    const unsubs: Array<() => void> = [];
    const rebuild = () => {
      const merged = Object.values(inboxBucketsRef.current).flat();
      const unique = Array.from(new Map(merged.map((n) => [n.id, n])).values());
      unique.sort((a: any, b: any) => {
        const ad = toDate(a.createdAt)?.getTime() ?? 0;
        const bd = toDate(b.createdAt)?.getTime() ?? 0;
        return bd - ad;
      });
      setInbox(unique.slice(0, 10));
      setLoadingInbox(false);
    };
    const register = (key: string, q: any, fallback?: () => any) => {
      const unsub = onSnapshotFresh(
        q,
        (snap: any) => {
          inboxBucketsRef.current[key] = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
          rebuild();
        },
        (err: any) => {
          console.error(err);
          const message = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
          const needsIndex = message.includes('requires an index') || message.includes('failed-precondition');
          if (fallback && needsIndex && !inboxFallbackRef.current.has(key)) {
            inboxFallbackRef.current.add(key);
            unsub();
            register(key, fallback());
            return;
          }
          setLoadingInbox(false);
        }
      );
      unsubs.push(unsub);
    };
    register(
      `uid:${user.uid}`,
      query(
        collection(db, 'user_notifications'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(20)
      ),
      () => query(collection(db, 'user_notifications'), where('uid', '==', user.uid), limit(20))
    );
    (async () => {
      try {
        const ids = new Set<string>();
        const byId = await getDoc(doc(db, 'empleados', user.uid));
        if (byId.exists()) ids.add(byId.id);
        const byUid = await getDocs(query(collection(db, 'empleados'), where('uid', '==', user.uid)));
        byUid.docs.forEach((d) => ids.add(d.id));
        if (user.email) {
          const email = user.email.trim();
          const byEmail = await getDocs(query(collection(db, 'empleados'), where('email', '==', email)));
          byEmail.docs.forEach((d) => ids.add(d.id));
        }
        ids.forEach((id) => {
          register(
            `emp:${id}`,
            query(
              collection(db, 'user_notifications'),
              where('employeeId', '==', id),
              orderBy('createdAt', 'desc'),
              limit(20)
            ),
            () => query(collection(db, 'user_notifications'), where('employeeId', '==', id), limit(20))
          );
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => unsubs.forEach((u) => u());
  }, [user?.uid]);

  const dateKey = (d: Date) => {
    const fmt = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = fmt.formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value || '0000';
    const m = parts.find((p) => p.type === 'month')?.value || '00';
    const day = parts.find((p) => p.type === 'day')?.value || '00';
    return `${y}-${m}-${day}`;
  };

  const dateFromKey = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const sortedShifts = useMemo(() => {
    return [...shifts].sort((a, b) => {
      const ad = toDate(a.startTime)?.getTime() ?? 0;
      const bd = toDate(b.startTime)?.getTime() ?? 0;
      return ad - bd;
    });
  }, [shifts]);

  const todayShiftAny = useMemo(() => {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return sortedShifts.find((s) => {
      const start = toDate(s.startTime);
      const end = toDate(s.endTime);
      if (!start || start < startOfDay || start > endOfDay) return false;
      // Si el turno ya terminó, no mostrarlo en el hero (pasar al siguiente)
      if (end && end < now) return false;
      return true;
    });
  }, [sortedShifts, now]);

  const todayShift = useMemo(() => {
    return todayShiftAny && !todayShiftAny.isFranco ? todayShiftAny : undefined;
  }, [todayShiftAny]);

  const nextShift = useMemo(() => {
    const now = new Date();
    const today = dateKey(now);
    return sortedShifts.find((s) => {
      const start = toDate(s.startTime);
      return start && dateKey(start) > today && !s.isFranco;
    });
  }, [sortedShifts]);

  const nextShiftObjective = nextShift?.objectiveId ? objectivesMap[nextShift.objectiveId] : null;
  const todayObjective = todayShift?.objectiveId ? objectivesMap[todayShift.objectiveId] : null;
  const todayShiftIcon = useMemo(() => {
    const base = (todayShift?.code || todayShift?.type || '').toString().toUpperCase();
    if (base.startsWith('N') || base === 'N12') return Moon;
    if (base.startsWith('T')) return Sunset;
    if (base.startsWith('M') || base === 'D12') return Sun;
    return Sun;
  }, [todayShift]);

  const nextShiftIcon = useMemo(() => {
    const base = (nextShift?.code || nextShift?.type || '').toString().toUpperCase();
    if (base.startsWith('N') || base === 'N12') return Moon;
    if (base.startsWith('T')) return Sunset;
    if (base.startsWith('M') || base === 'D12') return Sun;
    return Sun;
  }, [nextShift]);

  const todayElapsed = useMemo(() => {
    if (!todayShift) return null;
    const rawStatus = todayShift.status || (todayShift.isPresent ? 'PRESENT' : 'ASSIGNED');
    const isConfirmed = todayShift.isPresent || rawStatus === 'PRESENT' || rawStatus === 'InProgress';
    if (!isConfirmed) return null;
    const base = todayShift.checkInTime || todayShift.startTime;
    const baseDate = toDate(base);
    if (!baseDate) return null;
    return formatDuration(now.getTime() - baseDate.getTime());
  }, [todayShift, now]);

  const blueShift = todayShift || nextShift;
  const blueShiftObjective = blueShift?.objectiveId ? objectivesMap[blueShift.objectiveId] : null;
  const blueShiftStatus = (blueShift?.status || (blueShift?.isPresent ? 'PRESENT' : 'ASSIGNED')).toString();
  const blueIsConfirmedPresent = !!blueShift && (blueShift.isPresent || blueShiftStatus === 'PRESENT' || blueShiftStatus === 'InProgress');
  const blueHasPendingRequest = !!blueShift?.checkInRequestedAt && !blueIsConfirmedPresent;
  const blueStart = blueShift ? toDate(blueShift.startTime) : null;
  const blueDiffMinutes = blueStart ? Math.round((blueStart.getTime() - now.getTime()) / 60000) : null;
  const blueCountdownMinutes = blueDiffMinutes !== null && blueDiffMinutes <= 30 && blueDiffMinutes > 15 ? blueDiffMinutes : null;
  const blueTimeOk = blueDiffMinutes !== null && blueDiffMinutes <= 15 && blueDiffMinutes >= -5;
  const blueCanRequest = !!blueShift && !blueShift.isFranco && blueTimeOk && !blueHasPendingRequest && !blueIsConfirmedPresent;
  const blueLateWindow = blueDiffMinutes !== null && blueDiffMinutes < -5 && blueDiffMinutes >= -120;
  const blueIsLateNotified = !!(blueShift && (lateArrivalSent[blueShift?.id || ''] || blueShift.lateArrivalAt));
  const blueLateCanRequest = !!blueShift && !blueShift.isFranco && blueLateWindow && !blueHasPendingRequest && !blueIsConfirmedPresent;

  const nextFranco = useMemo(() => {
    const todayKey = dateKey(new Date());
    return sortedShifts.find((s) => {
      const start = toDate(s.startTime);
      if (!start || !s.isFranco) return false;
      const key = dateKey(start);
      return key > todayKey;
    });
  }, [sortedShifts]);

  const daysToFranco = useMemo(() => {
    if (!nextFranco) return null;
    const start = toDate(nextFranco.startTime);
    if (!start) return null;
    const todayKey = dateKey(new Date());
    const francoKey = dateKey(start);
    const diffMs = dateFromKey(francoKey).getTime() - dateFromKey(todayKey).getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }, [nextFranco]);

  const getShiftTypeLabel = (s: any) => {
    const code = (s?.code || s?.type || '').toString().toUpperCase();
    if (s?.isFranco || code === 'F') return 'Franco';
    if (code) return code;
    if (s?.hours) return `${s.hours}h`;
    return 'Turno';
  };

  const handleSolicitarEvento = async (evento: Evento, servicio: ServicioEvento) => {
    const empresaId = empProfile?.empresaId;
    const empId = empDocIdSt;
    if (!empresaId || !empId) return;
    setSolicitandoId(servicio.id);
    try {
      await solicitudEventoService.add({
        empresaId,
        eventoId: evento.id!,
        eventoNombre: evento.nombre,
        servicioId: servicio.id,
        servicioNombre: servicio.nombre,
        servicioFecha: servicio.fecha,
        empleadoId: empId,
        empleadoNombre: empProfile?.firstName ? `${empProfile.lastName || ''} ${empProfile.firstName || ''}`.trim() : (user?.email || empId),
      });
      setMySolicitudes(prev => [...prev, {
        empresaId, eventoId: evento.id!, eventoNombre: evento.nombre,
        servicioId: servicio.id, servicioNombre: servicio.nombre,
        servicioFecha: servicio.fecha, empleadoId: empId,
        empleadoNombre: '',
        tipo: 'guardia_solicita' as const,
        status: 'pendiente' as const,
      }]);
      addToast('Solicitud enviada', 'success');
    } catch {
      addToast('Error al enviar la solicitud', 'error');
    } finally {
      setSolicitandoId(null);
    }
  };

  const handleResponderConvocatoria = async (sol: SolicitudEvento, respuesta: 'aprobada' | 'rechazada') => {
    if (!sol.id) return;
    setRespondiendoConvId(sol.id);
    try {
      if (respuesta === 'aprobada') {
        const callable = httpsCallable(functions, 'respondEventoConvocatoria');
        await callable({ solicitudId: sol.id, accept: true });
      } else {
        await solicitudEventoService.responderConvocatoria(sol.id, respuesta);
      }
      setMySolicitudes(prev => prev.map(s => s.id === sol.id ? { ...s, status: respuesta } : s));
      addToast(respuesta === 'aprobada' ? '¡Confirmaste tu participación!' : 'Rechazaste la convocatoria', 'success');
    } catch {
      addToast('Error al responder', 'error');
    } finally {
      setRespondiendoConvId(null);
    }
  };

  // Devuelve info del servicio de evento para mostrar en el portal
  const getEvData = (shift: Shift) => {
    if (!shift.eventoId) return null;
    const evento = eventosMap[shift.eventoId];
    const servicio = evento?.servicios?.find((s: any) => s.id === shift.servicioId) ?? null;
    const tipoTurno = servicio?.tipoTurno ?? null;
    const horarioBadge = tipoTurno === '3x8' ? '3×8h'
      : tipoTurno === '2x12' ? '2×12h'
      : (servicio?.horaInicio && servicio?.horaFin) ? `${servicio.horaInicio}–${servicio.horaFin}`
      : null;
    const ubi = servicio?.ubicacion ?? null;
    const direccion = ubi?.tipo === 'nueva' ? (ubi.direccion ?? null) : (ubi?.objectiveNombre ?? null);
    const lat = ubi?.tipo === 'nueva' ? (ubi.latitud ?? null) : null;
    const lng = ubi?.tipo === 'nueva' ? (ubi.longitud ?? null) : null;
    const mapsUrl = (lat && lng)
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : direccion ? `https://www.google.com/maps/search/${encodeURIComponent(direccion)}` : null;
    return {
      nombre: servicio?.nombre ?? shift.servicioNombre ?? shift.eventoNombre ?? 'Evento',
      eventoNombre: evento?.nombre ?? shift.eventoNombre ?? null,
      clienteNombre: evento?.clienteNombre ?? null,
      horarioBadge,
      direccion,
      mapsUrl,
      requisitos: servicio?.requisitos ?? null,
      instrucciones: servicio?.instrucciones ?? null,
    };
  };

  const formatSwapOption = (s: any) => {
    const timeRange = s?.endTime ? `${formatTime(s.startTime)} - ${formatTime(s.endTime)}` : formatTime(s.startTime);
    const objectiveData = s?.objectiveId ? objectivesMap[s.objectiveId] : null;
    const client = s?.clientName || objectiveData?.clientName || '-';
    const objective = s?.objectiveName || objectiveData?.name || '-';
    const position = s?.positionName || '-';
    return `${formatDate(s.startTime)} · ${timeRange} · ${getShiftTypeLabel(s)} · Cliente: ${client} · Objetivo: ${objective} · Puesto: ${position}`;
  };

  const getShiftDetails = (s: any) => {
    if (!s) return null;
    const objectiveData = s?.objectiveId ? objectivesMap[s.objectiveId] : null;
    const client = s?.clientName || objectiveData?.clientName || '-';
    const objective = s?.objectiveName || objectiveData?.name || '-';
    const position = s?.positionName || '-';
    return { client, objective, position };
  };

  const getSwapRequestDetails = (r: any, side: 'requester' | 'target') => {
    const shiftId = side === 'requester' ? r?.requesterShiftId : r?.targetShiftId;
    const shift = shiftId ? shiftsById.get(shiftId) : null;
    const fromShift = getShiftDetails(shift);
    if (fromShift) return fromShift;
    const client = side === 'requester' ? (r?.requesterClientName || '-') : (r?.targetClientName || '-');
    const objective = side === 'requester' ? (r?.requesterObjectiveName || r?.objectiveName || '-') : (r?.targetObjectiveName || r?.objectiveName || '-');
    const position = side === 'requester' ? (r?.requesterPositionName || '-') : (r?.targetPositionName || '-');
    return { client, objective, position };
  };

  const swapPeople = useMemo(() => {
    const list = swapPeopleList.length
      ? swapPeopleList
      : swapCandidates.map((c) => {
          const id = c?.employeeId ? String(c.employeeId) : '';
          const name = (c?.employeeName || '').toString().trim();
          const key = id || (name ? `name:${name}` : '');
          return { key, name: name || 'Empleado' };
        }).filter((p) => p.key);
    const map = new Map<string, { key: string; name: string }>();
    list.forEach((p) => {
      if (!map.has(p.key)) map.set(p.key, p);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [swapCandidates, swapPeopleList]);

  const filteredSwapPeople = useMemo(() => {
    const q = swapSearch.trim().toLowerCase();
    if (!q) return swapPeople;
    return swapPeople.filter((p) => p.name.toLowerCase().includes(q));
  }, [swapPeople, swapSearch]);

  const swapCandidateShifts = useMemo(() => {
    if (!swapPersonKey) return [];
    return swapCandidates.filter((c) => {
      const id = c?.employeeId ? String(c.employeeId) : '';
      const name = (c?.employeeName || '').toString().trim();
      const key = id || (name ? `name:${name}` : '');
      return key === swapPersonKey;
    });
  }, [swapCandidates, swapPersonKey]);

  const shiftsById = useMemo(() => {
    const map = new Map<string, Shift>();
    shifts.forEach((s) => {
      if (s?.id) map.set(s.id, s);
    });
    return map;
  }, [shifts]);

  const visibleShifts = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    let end = new Date(now);
    if (scheduleView === 'HOY') {
      end = new Date(now);
    } else if (scheduleView === 'SEMANA') {
      end.setDate(end.getDate() + 6);
    } else {
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    end.setHours(23, 59, 59, 999);

    const byRange = shifts.filter((s) => {
      const sStart = toDate(s.startTime);
      return sStart ? sStart >= start && sStart <= end : false;
    });
    return byRange;
  }, [shifts, scheduleView]);

  const completedShifts = useMemo(() => {
    const now = new Date();
    let start = new Date(now);
    start.setHours(0, 0, 0, 0);
    let end = new Date(now);
    if (completedView === 'HOY') {
      end = new Date(now);
    } else if (completedView === 'SEMANA') {
      start.setDate(start.getDate() - 6);
      end.setDate(end.getDate() + 0);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    end.setHours(23, 59, 59, 999);
    return shifts.filter((s) => {
      const sStart = toDate(s.startTime);
      if (!sStart || sStart < start || sStart > end) return false;
      return isFinalizedShift(s, now);
    });
  }, [shifts, completedView]);

  const presentHistory = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return shifts
      .filter((s) => {
        if (s.isFranco) return false;
        const sStart = toDate(s.startTime);
        if (!sStart || sStart < start || sStart > end) return false;
        const status = (s.status || '').toString().toLowerCase();
        // Incluir: con check-in, presentes activos, o turnos completados (estuvieron presentes)
        const wasPresent = !!s.checkInTime || s.isPresent || status.includes('present') || status.includes('inprogress');
        const wasCompleted = (s.isCompleted || status.includes('complet') || status.includes('final')) && !s.isAbsent && !status.includes('ausent') && !status.includes('absent');
        return wasPresent || wasCompleted;
      })
      .sort((a, b) => (toDate(b.startTime)?.getTime() || 0) - (toDate(a.startTime)?.getTime() || 0));
  }, [shifts]);

  const monthlyCompleted = useMemo(() => {
    const n = new Date();
    const start = new Date(n.getFullYear(), n.getMonth(), 1);
    const end = new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999);
    return shifts.filter(s => {
      const d = toDate(s.startTime);
      return d && d >= start && d <= end && isFinalizedShift(s, n);
    }).length;
  }, [shifts]);

  const monthlyHours = useMemo(() => {
    const n = new Date();
    const start = new Date(n.getFullYear(), n.getMonth(), 1);
    const end = new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999);
    const total = shifts.filter(s => {
      const d = toDate(s.startTime);
      return d && d >= start && d <= end && isFinalizedShift(s, n) && !s.isFranco;
    }).reduce((acc, s) => {
      const st = toDate(s.startTime);
      const en = toDate(s.endTime);
      if (!st || !en) return acc;
      const diff = (en.getTime() - st.getTime()) / 3600000;
      return acc + Math.max(0, Math.min(diff, 13));
    }, 0);
    return total.toFixed(0);
  }, [shifts]);

  const monthlyTardanzas = useMemo(() => {
    const n = new Date();
    const start = new Date(n.getFullYear(), n.getMonth(), 1);
    const end = new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999);
    return shifts.filter(s => {
      const d = toDate(s.startTime);
      return d && d >= start && d <= end && !!s.lateArrivalAt;
    }).length;
  }, [shifts]);

  useEffect(() => {
    if (hasUnread) setShowNotifications(true);
  }, [hasUnread]);

  const upcomingShifts = useMemo(() => {
    const now = new Date();
    return visibleShifts.filter((s) => {
      return !isFinalizedShift(s, now);
    });
  }, [visibleShifts]);

  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null);

  const shiftsByDate = useMemo(() => {
    const map: Record<string, Shift> = {};
    shifts.forEach(s => {
      const d = toDate(s.startTime);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      map[key] = s;
    });
    return map;
  }, [shifts]);

  const getObjectiveForShift = (shift: Shift) => {
    if (shift.objectiveId && objectivesMap[shift.objectiveId]) return objectivesMap[shift.objectiveId];
    return null;
  };

  const getCoords = (): Promise<{ latitude: number; longitude: number }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  };

  const refreshLocation = async () => {
    try {
      const coords = await getCoords();
      setLocation({ lat: coords.latitude, lng: coords.longitude });
      setLocationUpdatedAt(new Date());
      setLocationError('');
    } catch (e: any) {
      setLocationError('No se pudo obtener la ubicación');
    }
  };

  const loadPendingCheckins = () => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(PENDING_CHECKINS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const savePendingCheckins = (list: any[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PENDING_CHECKINS_KEY, JSON.stringify(list));
    setPendingCheckins(list.length);
  };

  const loadSwapPeopleCache = () => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(SWAP_PEOPLE_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const saveSwapPeopleCache = (list: { key: string; name: string }[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SWAP_PEOPLE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: list }));
  };

  const flushPendingCheckins = async () => {
    if (!navigator.onLine) return;
    const list = loadPendingCheckins();
    if (list.length === 0) return;
    const callable = httpsCallable(functions, 'requestCheckIn');
    const remaining: any[] = [];
    for (const item of list) {
      try {
        const idempotencyKey = item.idempotencyKey || `ci_${item.shiftId}_${item.recordedAt || item.createdAt || ''}`;
        await callable({
          shiftId: item.shiftId,
          coords: item.coords,
          offline: true,
          recordedAt: item.recordedAt || item.createdAt || new Date().toISOString(),
          idempotencyKey,
        });
      } catch {
        remaining.push(item);
      }
    }
    savePendingCheckins(remaining);
    if (remaining.length === 0) {
      addToast('Presente enviado automáticamente', 'success');
    }
  };

  useEffect(() => {
    if (!user) return;
    const list = loadPendingCheckins();
    setPendingCheckins(list.length);
    flushPendingCheckins();
    const onOnline = () => flushPendingCheckins();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user?.uid]);

  const handleCheckIn = async (shift: Shift) => {
    if (!user) return;
    const start = toDate(shift.startTime);
    const end = toDate(shift.endTime);
    if (!start || !end) {
      addToast('Turno inválido', 'error');
      return;
    }

    const now = new Date();
    const diffMinutes = (start.getTime() - now.getTime()) / 60000;
    if (diffMinutes > 15) {
      addToast('Muy temprano para fichar (15 min antes)', 'error');
      return;
    }

    const objective = getObjectiveForShift(shift);
    const remoteAllowed = objective?.allowRemoteCheckIn === true;

    // Si el objetivo no tiene coordenadas Y no permite remoto, bloquear
    if (!objective || (!objective.lat && !objective.lng && !remoteAllowed)) {
      addToast('Objetivo sin ubicación configurada', 'error');
      return;
    }

    let coords: { latitude: number; longitude: number } | null = null;
    setCheckingShiftId(shift.id);
    try {
      // Si el objetivo permite check-in remoto, omitir verificación de distancia
      if (!remoteAllowed) {
        if (!objective.lat || !objective.lng) {
          addToast('Objetivo sin coordenadas GPS', 'error');
          return;
        }
        coords = await getCoords();
        const distanceKm = haversineKm(coords.latitude, coords.longitude, objective.lat, objective.lng);
        if (distanceKm > 0.08) {
          addToast(`Estás a más de 80 mts del objetivo (${Math.round(distanceKm * 1000)}m)`, 'error');
          return;
        }
      } else {
        // Igual intentamos obtener coords pero sin bloquear si falla
        try { coords = await getCoords(); } catch (_) {}
      }

      if (!navigator.onLine) {
        const idempotencyKey = `ci_${shift.id}_${new Date().toISOString()}`;
        const list = loadPendingCheckins();
        list.push({
          shiftId: shift.id,
          coords: coords ? { lat: coords.latitude, lng: coords.longitude } : null,
          createdAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          offline: true,
          idempotencyKey,
        });
        savePendingCheckins(list);
        addToast('Sin conexión. Presente guardado y se enviará luego.', 'info');
        return;
      }

      const idempotencyKey = `ci_${shift.id}_${new Date().toISOString()}`;
      const callable = httpsCallable(functions, 'requestCheckIn');
      await callable({
        shiftId: shift.id,
        coords: coords ? { lat: coords.latitude, lng: coords.longitude } : null,
        offline: false,
        recordedAt: new Date().toISOString(),
        idempotencyKey,
      });

      addToast('Solicitud de presente enviada', 'success');
    } catch (e: any) {
      console.error(e);
      const message = (e?.message || '').toString().toLowerCase();
      const isNetwork = !navigator.onLine || message.includes('network') || message.includes('unavailable');
      if (isNetwork && coords) {
        const idempotencyKey = `ci_${shift.id}_${new Date().toISOString()}`;
        const list = loadPendingCheckins();
        list.push({
          shiftId: shift.id,
          coords: { lat: coords.latitude, lng: coords.longitude },
          createdAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          offline: true,
          idempotencyKey,
        });
        savePendingCheckins(list);
        addToast('Sin conexión. Presente guardado y se enviará luego.', 'info');
      } else {
        addToast('No se pudo registrar el presente', 'error');
      }
    } finally {
      setCheckingShiftId(null);
    }
  };

  const handleLlegadaTarde = async (shift: Shift) => {
    if (!user) return;
    setCheckingShiftId(shift.id);
    try {
      const callable = httpsCallable(functions, 'notificarLlegadaTarde');
      await callable({ shiftId: shift.id });
      setLateArrivalSent(prev => ({ ...prev, [shift.id]: true }));
      addToast('Operaciones fue notificado de tu llegada tarde', 'info');
    } catch (e) {
      console.error(e);
      addToast('Error al notificar llegada tarde', 'error');
    } finally {
      setCheckingShiftId(null);
    }
  };

  const handleSubmitAbsenceRequest = async () => {
    if (!user) return;
    if (!absenceStart || !absenceEnd) {
      addToast('Seleccioná las fechas', 'error');
      return;
    }
    if (!absenceReason.trim()) {
      addToast('Indicá el motivo', 'error');
      return;
    }
    try {
      // ── Clasificar urgencia según tiempo al turno ──────────────────
      const nowTime = new Date();
      const todayStr = dateKey(nowTime);
      let absenceCase = 'PROGRAMADA';
      let minutesBeforeShift: number | null = null;
      let handledBy = 'PLANNING';
      let linkedShiftId: string | null = null;
      let linkedObjectiveId: string | null = null;
      let linkedObjectiveName: string | null = null;
      let linkedPositionName: string | null = null;
      let linkedClientId: string | null = null;

      if (absenceStart === todayStr) {
        const targetShift = sortedShifts.find(s => {
          const d = toDate(s.startTime);
          return d && dateKey(d) === todayStr && !s.isFranco;
        });
        if (targetShift) {
          linkedShiftId = targetShift.id;
          linkedObjectiveId = (targetShift as any).objectiveId || null;
          linkedObjectiveName = targetShift.objectiveName || null;
          linkedPositionName = targetShift.positionName || null;
          linkedClientId = (targetShift as any).clientId || null;
          const shiftStart = toDate(targetShift.startTime);
          if (shiftStart) {
            minutesBeforeShift = Math.round((shiftStart.getTime() - nowTime.getTime()) / 60000);
            const isAdminHours = nowTime.getHours() >= 8 && nowTime.getHours() < 20;
            if (minutesBeforeShift < 240) {          // < 4h (incluyendo ya iniciado)
              absenceCase = 'CORTO_PLAZO'; handledBy = 'OPERATIONS';
            } else if (minutesBeforeShift < 480) {   // 4-8h
              absenceCase = 'ANTICIPADA'; handledBy = isAdminHours ? 'PLANNING' : 'OPERATIONS';
            }
          }
        }
      }

      let fileUrl = absenceFileUrl;
      let fileName = absenceFileName;
      let certificateStoragePath: string | null = null;
      if ((absenceType === 'Enfermedad' || absenceType === 'ART') && absenceFile && !fileUrl) {
        setAbsenceUploading(true);
        const safeName = `${Date.now()}_${absenceFile.name.replace(/\s+/g, '_')}`;
        certificateStoragePath = `absences/${user.uid}/${safeName}`;
        const fileRef = ref(storage, certificateStoragePath);
        await uploadBytes(fileRef, absenceFile);
        fileUrl = await getDownloadURL(fileRef);
        fileName = absenceFile.name;
        setAbsenceFileUrl(fileUrl);
        setAbsenceFileName(fileName);
      }
      await addDoc(collection(db, 'ausencias'), stampEmpresaId({
        employeeId: user.uid,
        employeeName: displayName || user.email || 'Empleado',
        type: absenceType,
        startDate: absenceStart,
        endDate: absenceEnd,
        status: 'Pendiente',
        hasCertificate: !!fileUrl,
        certificateUrl: fileUrl || null,
        certificateName: fileName || null,
        certificateStoragePath,
        reason: absenceReason,
        source: 'EMPLEADO',
        createdAt: serverTimestamp(),
        absenceCase,
        minutesBeforeShift,
        handledBy,
        receivedAt: serverTimestamp(),
        shiftId: linkedShiftId,
        objectiveId: linkedObjectiveId,
        objectiveName: linkedObjectiveName,
        positionName: linkedPositionName,
        clientId: linkedClientId,
      }, String(empProfile?.empresaId || 'bacarsa').trim()));
      const toastMsg = absenceCase === 'CORTO_PLAZO'
        ? 'Aviso urgente enviado — Operaciones fue notificado'
        : absenceCase === 'ANTICIPADA'
        ? 'Aviso enviado — RRHH y Planificación fueron notificados'
        : 'Solicitud enviada — RRHH revisará tu pedido';
      addToast(toastMsg, 'success');
      setAbsenceReason('');
      setAbsenceStart('');
      setAbsenceEnd('');
      setAbsenceFile(null);
      setAbsenceFileUrl('');
      setAbsenceFileName('');
      setShowAbsenceRequest(false);
    } catch (e) {
      console.error(e);
      addToast('No se pudo enviar la solicitud', 'error');
    } finally {
      setAbsenceUploading(false);
    }
  };

  // Cargar ausencias AA pendientes del empleado (últimos 7 días, sin certificado)
  const loadMyPendingAbsences = async () => {
    if (!user) return;
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const fromStr = sevenDaysAgo.toISOString().slice(0, 10);
      const snap = await getDocs(query(
        collection(db, 'ausencias'),
        where('employeeId', '==', user.uid),
        where('startDate', '>=', fromStr),
        where('status', 'in', ['Confirmada', 'Injustificada']),
      ));
      const pending = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter((a: any) => {
          const t = String(a.absenceType || a.type || '').toLowerCase();
          return (t === 'aa' || t === 'no presentacion' || t === 'no presentación') && !a.certificateUrl && !a.certificateDriveLink;
        });
      setMyPendingAbsences(pending);
    } catch (e) {
      console.error('[loadMyPendingAbsences]', e);
    }
  };

  // Subir certificado a una ausencia AA existente
  const handleUploadCertificate = async (ausenciaId: string) => {
    if (!user || !certFile) return;
    setCertUploadingId(ausenciaId);
    try {
      const safeName = `${Date.now()}_${certFile.name.replace(/\s+/g, '_')}`;
      const certificateStoragePath = `absences/${user.uid}/${safeName}`;
      const fileRef = ref(storage, certificateStoragePath);
      await uploadBytes(fileRef, certFile);
      const url = await getDownloadURL(fileRef);
      await updateDoc(doc(db, 'ausencias', ausenciaId), {
        certificateUrl: url,
        certificateName: certFile.name,
        certificateStoragePath,
        certificateUploadedAt: serverTimestamp(),
        hasCertificate: true,
        status: 'Confirmada', // vuelve a Confirmada para que RRHH la revise
      });
      addToast('Certificado enviado — RRHH fue notificado', 'success');
      setCertFile(null);
      setShowCertModal(null);
      await loadMyPendingAbsences();
    } catch (e) {
      console.error(e);
      addToast('Error al subir el certificado', 'error');
    } finally {
      setCertUploadingId(null);
    }
  };

  const loadSwapRequests = async () => {
    if (!user) return;
    try {
      const empDocId = await resolveEmpDocId();
      if (!empDocId) return;
      const snap = await getDocs(query(
        collection(db, 'swap_requests'),
        where('requesterId', '==', empDocId)
      ));
      const snap2 = await getDocs(query(
        collection(db, 'swap_requests'),
        where('targetId', '==', empDocId)
      ));
      const all = [...snap.docs, ...snap2.docs].map(d => ({ id: d.id, ...d.data() }));
      const unique = Array.from(new Map(all.map(r => [r.id, r])).values());
      setSwapRequests(unique);
    } catch (e) {
      console.error(e);
    }
  };

  const loadSwapCandidates = async () => {
    if (!user || !swapShiftId) return;
    setSwapBusy(true);
    setSwapSearched(true);
    try {
      const callable = httpsCallable(functions, 'getSwapCandidates');
      const result: any = await callable({ shiftId: swapShiftId });
      const list = (result.data?.data || []).map((c: any) => {
        if (!c) return c;
        if ((!c.objectiveName || !c.clientName) && c.objectiveId && objectivesMap[c.objectiveId]) {
          const obj = objectivesMap[c.objectiveId];
          return {
            ...c,
            objectiveName: c.objectiveName || obj.name,
            clientName: c.clientName || obj.clientName
          };
        }
        return c;
      });
      setSwapCandidates(list);
    } catch (e) {
      console.error(e);
      addToast('No se pudieron cargar candidatos', 'error');
    } finally {
      setSwapBusy(false);
    }
  };

  const loadSwapPeople = async (force = false) => {
    if (!user) return;
    if (!force && swapPeopleList.length > 0) return;
    const cache = loadSwapPeopleCache();
    if (!force && cache?.data?.length) {
      setSwapPeopleList(cache.data);
      if (cache.ts && Date.now() - cache.ts < 10 * 60 * 1000) return;
    }
    try {
      const callable = httpsCallable(functions, 'getSwapPeople');
      const result: any = await callable({});
      const list = (result.data?.data || []).map((p: any) => ({
        key: p?.id ? String(p.id) : `name:${p?.name || 'Empleado'}`,
        name: (p?.name || 'Empleado').toString()
      }));
      setSwapPeopleList(list);
      saveSwapPeopleCache(list);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!swapShiftId) {
      setSwapCandidates([]);
      setSwapSearched(false);
      return;
    }
    loadSwapCandidates();
  }, [swapShiftId]);

  useEffect(() => {
    if (!showSwap) return;
    loadSwapPeople();
  }, [showSwap, user?.uid]);

  useEffect(() => {
    if (swapPersonKey && !swapPeople.find((p) => p.key === swapPersonKey)) {
      setSwapPersonKey('');
      setSwapTargetShiftId('');
    }
  }, [swapPeople, swapPersonKey]);

  const handleCreateSwap = async () => {
    if (!user || !swapShiftId || !swapTargetShiftId) {
      addToast('Seleccioná turno y compañero', 'error');
      return;
    }
    setSwapBusy(true);
    try {
      const callable = httpsCallable(functions, 'createSwapRequest');
      await callable({ myShiftId: swapShiftId, targetShiftId: swapTargetShiftId });
      addToast('Solicitud de intercambio enviada', 'success');
      setSwapShiftId('');
      setSwapTargetShiftId('');
      setSwapCandidates([]);
      loadSwapRequests();
    } catch (e: any) {
      console.error(e);
      addToast('No se pudo enviar la solicitud', 'error');
    } finally {
      setSwapBusy(false);
    }
  };

  const handleRespondSwap = async (requestId: string, accept: boolean) => {
    if (!user) return;
    setSwapBusy(true);
    try {
      const callable = httpsCallable(functions, 'respondSwapRequest');
      await callable({ requestId, accept });
      loadSwapRequests();
    } catch (e) {
      console.error(e);
      addToast('No se pudo responder', 'error');
    } finally {
      setSwapBusy(false);
    }
  };

  const handleConfirmSwap = async (requestId: string, confirm: boolean) => {
    if (!user) return;
    setSwapBusy(true);
    try {
      const callable = httpsCallable(functions, 'confirmSwapRequest');
      await callable({ requestId, confirm });
      loadSwapRequests();
    } catch (e) {
      console.error(e);
      addToast('No se pudo confirmar', 'error');
    } finally {
      setSwapBusy(false);
    }
  };

  const handleCancelSwap = async (requestId: string) => {
    if (!user) return;
    setSwapBusy(true);
    try {
      const callable = httpsCallable(functions, 'cancelSwapRequest');
      await callable({ requestId });
      loadSwapRequests();
    } catch (e) {
      console.error(e);
      addToast('No se pudo cancelar', 'error');
    } finally {
      setSwapBusy(false);
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') setNotifStatus('enabled');
    else if (Notification.permission === 'denied') setNotifStatus('denied');
    else setNotifStatus('off');
  }, []);

  const enableNotifications = async () => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) {
      addToast('Este navegador no soporta notificaciones', 'error');
      return;
    }
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      // Push notifications not configured in this environment — fail silently
      return;
    }
    setNotifBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setNotifStatus('denied');
        addToast('Permiso de notificaciones denegado', 'error');
        return;
      }
      await ensureFcmToken();
      addToast('Notificaciones activadas', 'success');
    } catch (e) {
      console.error(e);
      setNotifStatus('error');
      addToast('No se pudieron activar notificaciones', 'error');
    } finally {
      setNotifBusy(false);
    }
  };

  const disableNotifications = async () => {
    if (typeof window === 'undefined') return;
    setNotifBusy(true);
    try {
      const token = localStorage.getItem('fcm_token');
      try {
        if (token) {
          await deleteDoc(doc(db, 'device_tokens', token));
        } else {
          const callable = httpsCallable(functions, 'deleteMyTokens');
          await callable({});
        }
      } catch (e) {
        console.warn('No se pudo borrar token en servidor', e);
      }
      try {
        const { getMessaging, deleteToken } = await import('firebase/messaging');
        const messaging = getMessaging(app);
        await deleteToken(messaging);
      } catch (e) {
        console.warn('No se pudo borrar token local', e);
      }
      localStorage.removeItem('fcm_token');
      setNotifStatus('off');
      addToast('Notificaciones desactivadas', 'success');
    } catch (e) {
      console.error(e);
      addToast('No se pudieron desactivar', 'error');
    } finally {
      setNotifBusy(false);
    }
  };

  const sendTestNotification = async () => {
    if (!user) return;
    setTestBusy(true);
    try {
      const callable = httpsCallable(functions, 'sendTestNotification');
      await callable({ title: 'Prueba CronoApp', body: 'Si ves esto, las notificaciones funcionan.' });
      addToast('Notificación de prueba enviada', 'success');
    } catch (e) {
      console.error(e);
      addToast('No se pudo enviar la prueba', 'error');
    } finally {
      setTestBusy(false);
    }
  };
  const markNotificationRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), { read: true, readAt: serverTimestamp() });
    } catch (e) {
      console.error(e);
      addToast('No se pudo marcar como leída', 'error');
    }
  };
  const markAllUnreadRead = async () => {
    if (unreadInbox.length === 0) return;
    try {
      const now = serverTimestamp();
      await Promise.all(unreadInbox.map((n) => updateDoc(doc(db, 'user_notifications', n.id), { read: true, readAt: now })));
    } catch (e) {
      console.error(e);
      addToast('No se pudieron marcar todas', 'error');
    }
  };
  const ensureFcmToken = async () => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) return;
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const { getMessaging, getToken } = await import('firebase/messaging');
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return;
    const oldToken = localStorage.getItem('fcm_token');
    if (oldToken && oldToken !== token) {
      try {
        await deleteDoc(doc(db, 'device_tokens', oldToken));
      } catch (e) {
        console.warn('No se pudo borrar token viejo', e);
      }
    }
    // Asegurar que empDocId esté resuelto antes de guardar el token
    let empDocId = empDocIdRef.current;
    if (!empDocId) {
      try { empDocId = await resolveEmpDocId(); } catch (_) {}
    }
    await setDoc(doc(db, 'device_tokens', token), {
      uid: user.uid,
      employeeId: empDocId || null,
      empresaId: empProfile?.empresaId || null,
      role: 'employee',
      token,
      platform: 'web',
      updatedAt: serverTimestamp()
    }, { merge: true });
    localStorage.setItem('fcm_token', token);
    setNotifStatus('enabled');
  };
  useEffect(() => {
    if (showSchedule) {
      refreshLocation();
    }
  }, [showSchedule]);

  useEffect(() => {
    if (!user) return;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        await ensureFcmToken();
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        const { getMessaging, onMessage } = await import('firebase/messaging');
        const messaging = getMessaging(app);
        unsub = onMessage(messaging, (payload) => {
          const title = payload?.data?.title || payload?.notification?.title || 'CronoApp';
          const body  = payload?.data?.body  || payload?.notification?.body  || '';
          const notificationId = payload?.data?.notificationId;
          const link = payload?.data?.link || '/empleado/dashboard';
          try {
            if (Notification.permission === 'granted') {
              const n = new Notification(title, { body });
              n.onclick = () => {
                if (notificationId) markNotificationRead(notificationId);
                window.location.href = link;
              };
            }
          } catch {}
          addToast(title, 'info');
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!router.isReady) return;
    const notifId = router.query.notif;
    if (typeof notifId === 'string' && notifId.trim()) {
      markNotificationRead(notifId);
      router.replace('/empleado/dashboard', undefined, { shallow: true });
    }
  }, [router.isReady, router.query.notif]);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'empleados', user.uid)).then(snap => {
      if (snap.exists()) {
        const pf = snap.data().portalFeatures;
        if (pf && typeof pf === 'object') setPortalFeatures(prev => ({ ...prev, ...pf }));
      }
    }).catch(console.error);
  }, [user?.uid]);

  // Cargar ausencias AA pendientes al montar y cuando cambia el usuario
  useEffect(() => {
    if (user) loadMyPendingAbsences();
  }, [user?.uid]);

  return (
    <AuthGuard>
      <Head><title>Portal Empleado | CronoApp</title></Head>

      {/* ── Superadmin preview banner ── */}
      {isPreviewMode && (
        <div className="sticky top-0 z-50 flex items-center gap-2 bg-orange-600 px-3 py-2 text-white text-xs font-bold">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
          <span className="flex-1 truncate">PREVIEW · {empProfile ? `${empProfile.lastName || ''} ${empProfile.firstName || ''}`.trim() || previewEmpId : previewEmpId}</span>
          <button onClick={() => setShowPreviewPicker(true)} className="shrink-0 bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-[10px] font-black uppercase">Cambiar</button>
          <button onClick={() => router.push('/admin')} className="shrink-0 bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-[10px] font-black uppercase">← Admin</button>
        </div>
      )}

      {/* ── Superadmin employee picker overlay ── */}
      {isSuperAdmin && showPreviewPicker && (() => {
        const empresas = Array.from(new Set(previewEmployees.map(e => e.empresa).filter(Boolean))).sort() as string[];
        const filtered = previewEmployees.filter(e => {
          const matchEmpresa = !previewEmpresaFilter || e.empresa === previewEmpresaFilter;
          const matchSearch = !previewSearch || e.name.toLowerCase().includes(previewSearch.toLowerCase()) || (e.fileNumber && e.fileNumber.toLowerCase().includes(previewSearch.toLowerCase()));
          return matchEmpresa && matchSearch;
        });
        return (
          <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-slate-800">
              <svg className="w-5 h-5 text-orange-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-black text-sm">Vista previa portal empleado</h2>
                <p className="text-slate-500 text-[11px]">{filtered.length} empleado{filtered.length !== 1 ? 's' : ''}{previewEmpresaFilter ? ` · ${previewEmpresaFilter}` : ` · ${empresas.length} empresa${empresas.length !== 1 ? 's' : ''}`}</p>
              </div>
              {isPreviewMode
                ? <button onClick={() => setShowPreviewPicker(false)} className="text-slate-400 hover:text-white p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
                : <button onClick={() => router.push('/admin')} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">← Admin</button>
              }
            </div>
            {/* Empresa filter chips */}
            {empresas.length > 1 && (
              <div className="flex gap-2 px-4 py-2.5 overflow-x-auto border-b border-slate-800/60 scrollbar-none">
                <button
                  onClick={() => setPreviewEmpresaFilter(null)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${!previewEmpresaFilter ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >Todas</button>
                {empresas.map(emp => (
                  <button
                    key={emp}
                    onClick={() => setPreviewEmpresaFilter(previewEmpresaFilter === emp ? null : emp)}
                    className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors ${previewEmpresaFilter === emp ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                  >{emp}</button>
                ))}
              </div>
            )}
            {/* Search */}
            <div className="px-4 py-2.5 border-b border-slate-800/60">
              <div className="bg-slate-800 rounded-xl px-3 py-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <input
                  autoFocus
                  type="text"
                  placeholder="Buscar por nombre o legajo..."
                  value={previewSearch}
                  onChange={e => setPreviewSearch(e.target.value)}
                  className="bg-transparent text-white text-sm flex-1 outline-none placeholder-slate-500"
                />
                {previewSearch && <button onClick={() => setPreviewSearch('')} className="text-slate-500 hover:text-white"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>}
              </div>
            </div>
            {/* Employee list */}
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
              {filtered.slice(0, 80).map(emp => (
                <button
                  key={emp.id}
                  onClick={() => { setShowPreviewPicker(false); setPreviewSearch(''); router.push(`/empleado/dashboard?preview=${emp.id}`); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-colors ${previewEmpId === emp.id ? 'bg-orange-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-200 hover:bg-slate-800'}`}
                >
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-black text-white shrink-0">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{emp.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {emp.fileNumber ? <span className="text-slate-300 font-mono">#{emp.fileNumber}</span> : null}
                      {emp.fileNumber && emp.empresa ? <span className="mx-1">·</span> : null}
                      {emp.empresa ? <span>{emp.empresa}</span> : null}
                    </p>
                  </div>
                  {previewEmpId === emp.id && <svg className="w-4 h-4 text-white shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>}
                </button>
              ))}
              {filtered.length === 0 && previewEmployees.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-10">Cargando empleados...</p>
              )}
              {filtered.length === 0 && previewEmployees.length > 0 && (
                <p className="text-slate-500 text-sm text-center py-10">Sin resultados para "{previewSearch}"</p>
              )}
              {filtered.length > 80 && (
                <p className="text-slate-600 text-[11px] text-center py-3">Mostrando 80 de {filtered.length} — refiná la búsqueda</p>
              )}
            </div>
          </div>
        );
      })()}

      {!isOnline && (
        <div role="alert" aria-live="assertive" className="sticky top-0 z-50 flex items-center gap-2 bg-amber-50 border-b-2 border-amber-400 px-4 py-2.5 text-amber-800 text-xs font-medium">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M12 12h.01M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" /></svg>
          Sin conexión — los cambios se guardarán cuando se restaure la red
        </div>
      )}
      {deviceVerified === false && (
        <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 rounded-full bg-rose-900/30 flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
          </div>
          <h1 className="text-white font-black text-xl mb-2">Dispositivo no autorizado</h1>
          <p className="text-slate-400 text-sm max-w-xs mb-8">Este celular no está registrado para tu cuenta. Solo podés acceder desde el dispositivo que activaste con el mail de alta.</p>
          <button
            onClick={() => router.push('/empleado/activar/')}
            className="w-full max-w-xs bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl transition-colors mb-3"
          >
            Activar este dispositivo
          </button>
          <button
            onClick={handleLogout}
            className="text-slate-500 text-sm hover:text-slate-300 transition-colors"
          >
            Cerrar sesión
          </button>
        </div>
      )}
      <div className="min-h-screen bg-slate-950 pb-28">

        {/* ===== OVERLAY: NOTIFICACIONES NO LEÍDAS ===== */}
        {hasUnread && (
          <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black uppercase">Notificaciones pendientes</div>
                <button onClick={markAllUnreadRead} className="px-3 py-2 rounded-lg text-[10px] font-black uppercase bg-indigo-600 text-white">Marcar todas</button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">Para continuar, marcá como leída cada notificación.</p>
              <div className="mt-4 max-h-72 overflow-y-auto space-y-2">
                {unreadInbox.map((n: any) => (
                  <div key={n.id} className="border border-slate-800 rounded-xl p-3 bg-slate-950/50">
                    <div className="text-xs font-bold">{n.title || n.titulo || 'Notificación'}</div>
                    <div className="text-[11px] text-slate-300 mt-1">{n.body || n.mensaje || n.message || ''}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-rose-500 font-bold">No leída</span>
                      <button onClick={() => markNotificationRead(n.id)} className="px-3 py-1 rounded-lg text-[10px] font-black uppercase bg-slate-800 text-white">Marcar leída</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== PANEL: NOTIFICACIONES ===== */}
        {showNotifications && (
          <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Bell size={16} className="text-indigo-300"/><div className="text-sm font-black uppercase">Notificaciones</div></div>
                <button onClick={() => setShowNotifications(false)} className="text-slate-300 hover:text-white"><X size={18}/></button>
              </div>
              <div className="mt-4">
                {loadingInbox ? (
                  <p className="text-xs text-slate-400">Cargando...</p>
                ) : monthInbox.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-12">Sin notificaciones este mes.</div>
                ) : (
                  <div className="overflow-y-auto pr-1 max-h-96 space-y-2">
                    {monthInbox.map((n) => {
                      const type = (n?.data?.type || '').toString().toUpperCase();
                      let actionLabel = 'Cambio';
                      if (type === 'ASSIGNED' || type === 'PLANIFICACION') actionLabel = 'Asignado';
                      else if (type === 'REMOVED' || type === 'FRANCO_REMOVED' || type === 'UNASSIGNED') actionLabel = 'Eliminado';
                      else if (type === 'SHIFT_UPDATE') actionLabel = 'Modificado';
                      else if (type === 'FRANCO') actionLabel = 'Franco asignado';
                      else if (type === 'CHECKIN') actionLabel = 'Presente';
                      else if (type === 'INGRESO_AUTOREGISTRO' || type === 'INGRESO_AUTOREGISTRO_ALERTA') actionLabel = 'Ingreso';
                      else if (type === 'LLEGADA_TARDE_AVISO') actionLabel = 'Llegada tarde';
                      else if (type === 'RETENTION' || type === 'RETENCION') actionLabel = 'Retención';
                      else if (type === 'EXTENSION_PLANIFICADA') actionLabel = 'Extensión planificada';
                      else if (type === 'ADELANTO_PLANIFICADO') actionLabel = 'Adelanto planificado';
                      else if (type === 'RET_LIBERACION_PLANIFICADA') actionLabel = 'Stand-by RET';
                      return (
                        <div key={n.id} onClick={() => !n.read && markNotificationRead(n.id)}
                          className={`border border-slate-800 rounded-xl cursor-pointer p-3 ${n.read ? 'bg-slate-950/60' : 'bg-indigo-950/30 border-indigo-800/40'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-black text-slate-200 uppercase">{n.title || n.titulo || 'CronoApp'}</div>
                              <div className="text-[11px] text-slate-400">{actionLabel}: {n.body || n.mensaje || ''}</div>
                              <div className="text-[10px] mt-1">
                                <span className="text-slate-500">{formatDate(n.createdAt)} · {formatTime(n.createdAt)}</span>
                                <span className={`ml-2 font-bold ${n.read ? 'text-slate-600' : 'text-rose-400'}`}>{n.read ? 'Leída' : 'No leída'}</span>
                              </div>
                            </div>
                            {!n.read && <button onClick={() => markNotificationRead(n.id)} className="text-[10px] font-black uppercase text-indigo-400 shrink-0">✓</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {!!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY && (
                <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-bold uppercase">Notificaciones push</span>
                  {notifStatus === 'enabled' ? (
                    <button onClick={disableNotifications} disabled={notifBusy} className="text-[11px] font-black text-sky-400 disabled:opacity-50 flex items-center gap-1">
                      <BellRing size={13}/> Activadas · Desactivar
                    </button>
                  ) : (
                    <button onClick={enableNotifications} disabled={notifBusy} className="text-[11px] font-black text-indigo-400 disabled:opacity-50 flex items-center gap-1">
                      <BellRing size={13}/> Activar push
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== HEADER ===== */}
        <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="w-9 h-9 rounded-full text-white font-black flex items-center justify-center text-sm shrink-0 select-none cursor-pointer active:scale-95 transition-transform"
                style={{ backgroundColor: empresaColor }}
                onMouseDown={startPressTimer}
                onMouseUp={cancelPressTimer}
                onMouseLeave={cancelPressTimer}
                onTouchStart={startPressTimer}
                onTouchEnd={cancelPressTimer}
              >
                {displayName?.slice(0, 2).toUpperCase()}
              </div>
              {showLogoutMenu && (
                <div className="absolute top-10 left-0 z-50 bg-slate-800 border border-slate-700 rounded-xl shadow-xl p-1 min-w-[140px]">
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-900/30 rounded-lg transition-colors"
                  >
                    Cerrar sesión
                  </button>
                  <button
                    onClick={() => setShowLogoutMenu(false)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-700/50 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-slate-500 font-bold leading-none">Portal Empleado</p>
              {empProfile?.lastName || empProfile?.firstName ? (
                <>
                  <p className="text-sm font-black text-white leading-tight truncate max-w-[140px] uppercase">{empProfile.lastName}</p>
                  <p className="text-[11px] font-bold text-slate-300 leading-tight truncate max-w-[140px]">{empProfile.firstName}</p>
                </>
              ) : (
                <p className="text-sm font-black text-white leading-tight truncate max-w-[140px]">{displayName}</p>
              )}
            </div>
          </div>
          {(empresaNombre || empresaCtx?.name) ? (
            <div className="flex-1 flex flex-col items-center min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 leading-none">Empresa</p>
              <p className="text-xs font-black text-white leading-tight truncate max-w-full text-center uppercase">{empresaNombre || empresaCtx?.name}</p>
            </div>
          ) : <div className="flex-1"/>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (showCredencial) {
                  backCloserRef.current = null;
                  setShowCredencial(false);
                  history.back();
                } else {
                  history.pushState({ overlay: 'credencial' }, '');
                  backCloserRef.current = () => setShowCredencial(false);
                  setShowCredencial(true);
                }
              }}
              className="relative p-2 text-slate-400 hover:text-yellow-400 transition-colors"
              title="Mi Credencial"
            >
              <CreditCard size={20}/>
            </button>
            <button onClick={() => setShowNotifications(true)} className="relative p-2 text-slate-400 hover:text-white transition-colors">
              <Bell size={20}/>
              {hasUnread && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full animate-pulse"/>}
              {notifStatus !== 'enabled' && !!process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-indigo-500 rounded-full flex items-center justify-center">
                  <BellRing size={8} className="text-white"/>
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

          {/* ===== ALERTAS DE CRONOGRAMA ===== */}
          {shiftAlerts.length > 0 && (
            <div className="space-y-2">
              {shiftAlerts.map(alert => {
                const isAdded = alert.type === 'ADDED';
                const isRemoved = alert.type === 'REMOVED';
                const bgCls = isAdded
                  ? 'bg-indigo-950/70 border-indigo-800/50'
                  : isRemoved
                  ? 'bg-rose-950/70 border-rose-800/50'
                  : 'bg-amber-950/70 border-amber-800/50';
                const titleCls = isAdded ? 'text-indigo-300' : isRemoved ? 'text-rose-300' : 'text-amber-300';
                const iconCls = isAdded ? 'text-indigo-400' : isRemoved ? 'text-rose-400' : 'text-amber-400';
                const label = isAdded ? 'Turno nuevo asignado' : isRemoved ? 'Turno eliminado' : 'Turno modificado';
                const prevTime = alert.prev ? `${formatTime(alert.prev.startTime)} – ${formatTime(alert.prev.endTime)}` : null;
                const newTime = !alert.shift.isFranco ? `${formatTime(alert.shift.startTime)} – ${formatTime(alert.shift.endTime)}` : null;
                const timeChanged = prevTime && newTime && prevTime !== newTime;
                return (
                  <div key={alert.id} className={`${bgCls} border rounded-2xl px-4 py-3 flex items-start gap-3`}>
                    <div className={`shrink-0 mt-0.5 ${iconCls}`}>
                      {isAdded ? <Calendar size={16}/> : isRemoved ? <X size={16}/> : <AlertTriangle size={16}/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-black uppercase tracking-wider ${titleCls}`}>{label}</p>
                      <p className="text-xs font-bold text-slate-300 mt-0.5">
                        {formatDate(alert.shift.startTime)}
                        {newTime && ` · ${newTime}`}
                      </p>
                      {(alert.shift.objectiveName || alert.shift.clientName) && (
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {alert.shift.objectiveName || alert.shift.clientName}
                        </p>
                      )}
                      {timeChanged && (
                        <p className="text-[10px] text-slate-600 mt-1">Antes: {prevTime}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setShiftAlerts(prev => prev.filter(a => a.id !== alert.id))}
                      className="text-slate-600 hover:text-slate-400 transition-colors shrink-0 mt-0.5"
                      aria-label="Descartar alerta"
                    >
                      <X size={14}/>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ===== ESTADO DEL DÍA — status + acciones en una sola fila ===== */}
          {/* ===== HERO: PRÓXIMO TURNO ===== */}
          <div className="rounded-3xl p-6 text-white shadow-2xl relative overflow-hidden" style={{ backgroundColor: empresaColor, boxShadow: `0 25px 50px -12px ${empresaColor}66` }}>
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/5 rounded-full pointer-events-none"/>
            <div className="absolute -bottom-10 -left-4 w-32 h-32 bg-white/5 rounded-full pointer-events-none"/>
            <div className="relative">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-[10px] font-black uppercase text-indigo-200 tracking-widest">Próximo Turno</p>
                {empresaNombre ? (
                  <span className="flex items-center gap-1 px-2.5 py-1 bg-white/10 rounded-full text-[10px] font-black text-indigo-100 border border-white/10 max-w-[160px] truncate">
                    🏢 {empresaNombre}
                  </span>
                ) : null}
              </div>
              <p className="text-3xl font-black mt-1 leading-none">
                {todayShiftAny ? 'HOY' : nextShift ? (() => {
                  const d = toDate(nextShift.startTime);
                  if (!d) return formatDate(nextShift.startTime).toUpperCase();
                  const todayMidnight = new Date(now); todayMidnight.setHours(0,0,0,0);
                  const diffDays = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000);
                  if (diffDays === 1) return 'MAÑANA';
                  if (diffDays <= 6) return d.toLocaleDateString('es-AR', { weekday: 'long' }).toUpperCase();
                  return formatDate(nextShift.startTime).toUpperCase();
                })() : 'Sin turno próximo'}
              </p>
              {todayShiftAny?.isFranco ? (
                <div className="mt-3">
                  <span className="px-4 py-2 bg-emerald-500/25 border border-emerald-400/30 rounded-2xl text-sm font-black text-emerald-200 inline-flex items-center gap-2">
                    🌿 Franco — Día libre
                  </span>
                </div>
              ) : (
                <p className="text-xl font-bold text-indigo-100 mt-1">
                  {todayShift
                    ? `${formatTime(todayShift.startTime)} – ${formatTime(todayShift.endTime)}`
                    : nextShift
                    ? `${formatTime(nextShift.startTime)} – ${formatTime(nextShift.endTime)}`
                    : 'No hay turnos programados'}
                </p>
              )}
              {(todayShift || nextShift) && !todayShiftAny?.isFranco && (() => {
                const heroShift = todayShift || nextShift;
                const evData = heroShift ? getEvData(heroShift) : null;
                if (evData) {
                  return (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="px-3 py-1 bg-yellow-400/20 border border-yellow-400/30 rounded-full text-xs font-black text-yellow-200">
                        🎯 {evData.nombre}
                      </span>
                      {evData.eventoNombre && evData.eventoNombre !== evData.nombre && (
                        <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100">{evData.eventoNombre}</span>
                      )}
                      {evData.clienteNombre && (
                        <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100">{evData.clienteNombre}</span>
                      )}
                      {evData.horarioBadge && (
                        <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100">{evData.horarioBadge}</span>
                      )}
                      {evData.direccion && (
                        <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100 flex items-center gap-1 max-w-full">
                          <MapPin size={10} className="shrink-0"/> <span className="truncate">{evData.direccion}</span>
                        </span>
                      )}
                      {evData.mapsUrl && (
                        <a href={evData.mapsUrl} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-xs font-black text-indigo-200 hover:bg-indigo-500/30 transition-colors">
                          <Navigation size={11}/> Cómo llegar
                        </a>
                      )}
                    </div>
                  );
                }
                const heroObjective = todayObjective || nextShiftObjective;
                const hasCoords = heroObjective && heroObjective.lat && heroObjective.lng;
                const heroMapsUrl = hasCoords
                  ? `https://www.google.com/maps?q=${heroObjective!.lat},${heroObjective!.lng}`
                  : heroObjective?.address
                    ? `https://www.google.com/maps/search/${encodeURIComponent(heroObjective.address)}`
                    : null;
                return (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100">
                    {heroObjective?.name || heroShift?.objectiveName || (heroShift?.objectiveId ? objectivesMap[heroShift.objectiveId]?.name : null) || 'Objetivo'}
                  </span>
                  {heroObjective?.clientName || heroShift?.clientName ? (
                    <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100">
                      {heroObjective?.clientName || heroShift?.clientName}
                    </span>
                  ) : null}
                  {heroObjective?.address && (
                    <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100 flex items-center gap-1 max-w-full">
                      <MapPin size={10} className="shrink-0"/> <span className="truncate">{heroObjective.address}</span>
                    </span>
                  )}
                  {heroShift?.positionName && (
                    <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-bold text-indigo-100">
                      {heroShift.positionName}
                    </span>
                  )}
                  {heroMapsUrl && (
                    <a href={heroMapsUrl} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-xs font-black text-indigo-200 hover:bg-indigo-500/30 transition-colors">
                      <Navigation size={11}/> Cómo llegar
                    </a>
                  )}
                </div>
                );
              })()}
              {todayElapsed && (
                <p className="text-xs text-indigo-200 mt-2 flex items-center gap-1">⏱ En servicio: {todayElapsed}</p>
              )}
              {blueShift && !blueShift.isFranco && blueCountdownMinutes !== null && blueCountdownMinutes > 0 && (
                <p className="text-xs text-indigo-200 mt-2">Podés dar presente en {blueCountdownMinutes} min</p>
              )}
              {nextFranco && daysToFranco !== null && (
                <p className="text-xs text-indigo-200/70 mt-2">Próximo franco: {formatDate(nextFranco.startTime)} ({daysToFranco} días)</p>
              )}
              {pendingCheckins > 0 && (
                <p className="text-xs text-amber-300 mt-2 font-bold">{pendingCheckins} presente(s) pendiente(s) de sincronizar</p>
              )}

              {/* PRESENTE */}
              {portalFeatures.checkIn && blueIsConfirmedPresent && blueShift && (
                <div className="mt-4 flex flex-col gap-1 bg-emerald-500/20 border border-emerald-400/30 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={18} className="text-emerald-300"/>
                    <span className="text-sm font-black text-emerald-200">
                      Tu turno comenzó a las {formatTime(blueShift.startTime)}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-emerald-300/90 pl-7">Presente confirmado</span>
                </div>
              )}
              {portalFeatures.checkIn && blueHasPendingRequest && !blueIsConfirmedPresent && (
                <div className="mt-4 flex items-center gap-2 bg-amber-500/20 border border-amber-400/30 rounded-2xl px-4 py-3">
                  <span className="text-sm font-black text-amber-200">Solicitud de presente enviada…</span>
                </div>
              )}
              {portalFeatures.checkIn && blueCanRequest && blueShift && (
                <button
                  onClick={() => handleCheckIn(blueShift)}
                  disabled={checkingShiftId === blueShift.id}
                  className="mt-4 w-full py-3.5 bg-white text-indigo-700 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-indigo-50 disabled:opacity-60 transition-all active:scale-95"
                >
                  <Navigation size={18}/>
                  {checkingShiftId === blueShift.id ? 'Validando ubicación...' : 'Dar Presente'}
                </button>
              )}
              {portalFeatures.checkIn && blueLateCanRequest && !blueIsLateNotified && blueShift && (
                <button
                  onClick={() => handleLlegadaTarde(blueShift)}
                  disabled={checkingShiftId === blueShift.id}
                  className="mt-4 w-full py-3.5 bg-amber-500 text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-amber-400 disabled:opacity-60 transition-all active:scale-95"
                >
                  <AlertTriangle size={18}/>
                  {checkingShiftId === blueShift.id ? 'Enviando...' : 'Llegué Tarde'}
                </button>
              )}
              {portalFeatures.checkIn && blueIsLateNotified && !blueIsConfirmedPresent && !blueHasPendingRequest && blueShift && !blueShift.isFranco && (
                <button
                  onClick={() => handleCheckIn(blueShift)}
                  disabled={checkingShiftId === blueShift.id}
                  className="mt-4 w-full py-3.5 bg-emerald-500 text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 shadow-lg hover:bg-emerald-400 disabled:opacity-60 transition-all active:scale-95"
                >
                  <Navigation size={18}/>
                  {checkingShiftId === blueShift.id ? 'Validando ubicación...' : 'Ya Llegué'}
                </button>
              )}
            </div>
          </div>

          {/* ===== AUSENCIAS PENDIENTES DE CERTIFICADO ===== */}
          {myPendingAbsences.length > 0 && myPendingAbsences.map(aus => (
            <div key={aus.id} className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={16} className="text-amber-400"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-amber-300">Ausencia sin justificar</p>
                  <p className="text-xs text-amber-200/70 mt-0.5">{aus.startDate}{aus.objectiveName ? ` — ${aus.objectiveName}` : ''}{aus.positionName ? ` · ${aus.positionName}` : ''}</p>
                  <p className="text-[10px] text-amber-200/50 mt-1">Si tenés certificado médico, subilo antes de las 23:59 para evitar que quede como injustificada.</p>
                </div>
              </div>
              <button
                onClick={() => { setShowCertModal(aus.id); setCertFile(null); }}
                className="w-full py-2.5 bg-amber-500 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2"
              >
                <FileText size={14}/> Subir certificado
              </button>
            </div>
          ))}

          {/* MODAL: UPLOAD CERTIFICADO */}
          {showCertModal && (
            <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center p-4">
              <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl text-white">
                <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 mb-4"/>
                <div className="px-5 pb-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <FileText className="text-amber-400" size={18}/>
                    <h2 className="font-black uppercase text-sm flex-1">Subir certificado médico</h2>
                    <button onClick={() => setShowCertModal(null)} className="text-slate-400 hover:text-white"><X size={18}/></button>
                  </div>
                  <p className="text-xs text-slate-400">Adjuntá el certificado médico (PDF, JPG o PNG). RRHH lo revisará y clasificará tu ausencia.</p>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Certificado (PDF / JPG / PNG / foto)</label>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      capture="environment"
                      onChange={e => setCertFile(e.target.files?.[0] || null)}
                      className="w-full mt-1 p-3 border border-slate-800 rounded-xl text-sm bg-slate-950 text-white"
                    />
                    {certFile && <p className="text-[10px] text-slate-400 mt-1">{certFile.name}</p>}
                  </div>
                  <button
                    onClick={() => handleUploadCertificate(showCertModal)}
                    disabled={!certFile || certUploadingId === showCertModal}
                    className="w-full py-3.5 bg-amber-500 text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <FileText size={16}/>
                    {certUploadingId === showCertModal ? 'Subiendo...' : 'Enviar certificado'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ===== HOY + MAÑANA ===== */}
          {(() => {
            const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1);
            const tmrwKey = dateKey(tmrw);
            const tmrwShift = shiftsByDate[tmrwKey];
            const tmrwObjective = tmrwShift?.objectiveId ? objectivesMap[tmrwShift.objectiveId] : null;
            const todayCards = [
              { label: 'Hoy', shift: todayShiftAny, objective: todayObjective },
              { label: 'Mañana', shift: tmrwShift, objective: tmrwObjective },
            ];
            return (
              <div className="grid grid-cols-2 gap-3">
                {todayCards.map(({ label, shift, objective }) => (
                  <div key={label} className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
                    <p className="text-[9px] font-black uppercase text-slate-500 mb-2 tracking-widest">{label}</p>
                    {shift ? (
                      shift.isFranco ? (
                        <div>
                          <p className="text-sm font-black text-emerald-400">Franco</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">Día libre</p>
                        </div>
                      ) : (() => {
                        const evd = getEvData(shift);
                        return (
                          <div>
                            <p className="text-sm font-black text-white truncate leading-tight">
                              {evd ? evd.nombre : (objective?.name || shift.objectiveName || (shift.objectiveId ? objectivesMap[shift.objectiveId]?.name : null) || 'Sin objetivo')}
                            </p>
                            <p className="text-[11px] text-indigo-400 font-bold mt-1">
                              {evd?.horarioBadge ?? `${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`}
                            </p>
                            {(evd ? evd.clienteNombre : objective?.clientName) && (
                              <p className="text-[9px] text-slate-600 truncate mt-0.5">{evd ? evd.clienteNombre : objective?.clientName}</p>
                            )}
                            {evd?.direccion && (
                              <p className="text-[9px] text-slate-500 truncate mt-0.5 flex items-center gap-1">
                                <MapPin size={8} className="shrink-0"/> {evd.direccion}
                              </p>
                            )}
                            {shift.isPresent && (
                              <p className="text-[9px] text-emerald-400 font-bold mt-1.5 flex items-center gap-1">
                                <CheckCircle size={8}/> Presente
                              </p>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-xs text-slate-600 font-bold">Sin turno</p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ===== CREDENCIAL ===== */}
          <button
            onClick={() => {
              history.pushState({ overlay: 'credencialVista' }, '');
              backCloserRef.current = () => setShowCredencialVista(false);
              setShowCredencialVista(true);
            }}
            className="w-full bg-slate-900 border border-slate-800 hover:border-yellow-700/60 rounded-2xl px-4 py-3 transition-all active:scale-[0.99] group flex items-center justify-center gap-2"
          >
            <CreditCard size={16} className="text-slate-400 group-hover:text-yellow-400 transition-colors shrink-0"/>
            <span className="text-xs font-black text-slate-400 group-hover:text-yellow-400 uppercase transition-colors">Ver credencial</span>
          </button>

          {/* ===== EVENTOS DISPONIBLES ===== */}
          {/* ── CONVOCATORIAS PENDIENTES DEL ADMIN ── */}
          {(() => {
            const convPendientes = mySolicitudes.filter(s => s.tipo === 'admin_convoca' && s.status === 'convocado');
            if (convPendientes.length === 0) return null;
            return (
              <div className="bg-slate-900 border border-yellow-600/50 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-800">
                  <span className="text-yellow-400 text-base">📣</span>
                  <span className="text-xs font-black text-yellow-300 uppercase tracking-wide">Convocatorias pendientes</span>
                  <span className="ml-auto px-1.5 py-0.5 bg-yellow-500 text-yellow-900 rounded-full text-[9px] font-black">{convPendientes.length}</span>
                </div>
                <div className="divide-y divide-slate-800">
                  {convPendientes.map(sol => (
                    <div key={sol.id} className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-white truncate">{sol.eventoNombre}</p>
                        <p className="text-[10px] text-yellow-500/80">{sol.servicioNombre}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{sol.servicioFecha}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                        <button
                          onClick={() => void handleResponderConvocatoria(sol, 'aprobada')}
                          disabled={respondiendoConvId === sol.id}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-black transition-colors"
                        >
                          Acepto
                        </button>
                        <button
                          onClick={() => void handleResponderConvocatoria(sol, 'rechazada')}
                          disabled={respondiendoConvId === sol.id}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded-xl text-[10px] font-black transition-colors"
                        >
                          No puedo
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {(() => {
            const serviciosDisp = eventosDisponibles.flatMap(ev =>
              (ev.servicios ?? [])
                .filter(s => s.status !== 'cancelado' && s.fecha >= new Date().toISOString().slice(0, 10))
                .map(s => ({ evento: ev, servicio: s }))
            );
            if (serviciosDisp.length === 0 && !loadingEventosDisp) return null;
            const pendientes = mySolicitudes.filter(s => s.status === 'pendiente').length;
            return (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setShowEventosDisp(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Star size={14} className="text-yellow-400"/>
                    <span className="text-xs font-black text-slate-300 uppercase tracking-wide">Eventos disponibles</span>
                    {pendientes > 0 && (
                      <span className="px-1.5 py-0.5 bg-yellow-500 text-yellow-900 rounded-full text-[9px] font-black">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {showEventosDisp ? <ChevronUp size={14} className="text-slate-500"/> : <ChevronDown size={14} className="text-slate-500"/>}
                </button>
                {showEventosDisp && (
                  <div className="border-t border-slate-800">
                    {loadingEventosDisp ? (
                      <p className="text-center text-[11px] text-slate-500 py-4">Cargando...</p>
                    ) : serviciosDisp.length === 0 ? (
                      <p className="text-center text-[11px] text-slate-500 py-4">Sin eventos disponibles</p>
                    ) : (
                      <div className="divide-y divide-slate-800/60">
                        {serviciosDisp.map(({ evento, servicio }) => {
                          const sol = mySolicitudes.find(s => s.servicioId === servicio.id);
                          const horarioBadge = servicio.tipoTurno === '3x8' ? '3×8h'
                            : servicio.tipoTurno === '2x12' ? '2×12h'
                            : `${servicio.horaInicio}–${servicio.horaFin}`;
                          const ubi = servicio.ubicacion;
                          const lugar = ubi?.tipo === 'nueva' ? (ubi.direccion || null) : (ubi?.objectiveNombre || null);
                          return (
                            <div key={servicio.id} className="px-4 py-3 flex items-start gap-3">
                              <div className="w-9 h-9 rounded-xl bg-yellow-900/40 flex items-center justify-center shrink-0 mt-0.5">
                                <Star size={14} className="text-yellow-400"/>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-black text-white truncate">{servicio.nombre}</p>
                                <p className="text-[10px] text-yellow-500/80 truncate">{evento.nombre}</p>
                                <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                                  <span className="flex items-center gap-1"><Calendar size={9}/>{servicio.fecha}</span>
                                  <span className="flex items-center gap-1"><Clock size={9}/>{horarioBadge}</span>
                                </div>
                                {lugar && <p className="text-[10px] text-slate-600 flex items-center gap-1 mt-0.5"><MapPin size={9} className="shrink-0"/>{lugar}</p>}
                                {servicio.requisitos && <p className="text-[10px] text-amber-500/70 mt-0.5">{servicio.requisitos}</p>}
                              </div>
                              <div className="shrink-0">
                                {sol ? (
                                  <span className={`text-[9px] font-black px-2 py-1 rounded-full ${
                                    sol.status === 'aprobada' ? 'bg-emerald-900/50 text-emerald-400'
                                    : sol.status === 'rechazada' ? 'bg-red-900/50 text-red-400'
                                    : 'bg-yellow-900/50 text-yellow-400'
                                  }`}>
                                    {sol.status === 'aprobada' ? 'Aprobada' : sol.status === 'rechazada' ? 'Rechazada' : 'Pendiente'}
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => void handleSolicitarEvento(evento, servicio)}
                                    disabled={solicitandoId === servicio.id}
                                    className="text-[9px] font-black px-2 py-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-yellow-900 rounded-full transition-colors"
                                  >
                                    {solicitandoId === servicio.id ? '...' : 'Solicitar'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ===== STATS DEL MES ===== */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-[9px] font-black uppercase text-slate-500 mb-1">Realizados</p>
              <p className="text-3xl font-black" style={{ color: empresaColor }}>{monthlyCompleted}</p>
              <p className="text-[9px] text-slate-600">este mes</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-[9px] font-black uppercase text-slate-500 mb-1">Tardanzas</p>
              <p className="text-3xl font-black text-amber-400">{monthlyTardanzas}</p>
              <p className="text-[9px] text-slate-600">este mes</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-[9px] font-black uppercase text-slate-500 mb-1">Presentes</p>
              <p className="text-3xl font-black text-emerald-400">{presentHistory.length}</p>
              <p className="text-[9px] text-slate-600">este mes</p>
            </div>
          </div>

          {/* ===== CRONOGRAMA ===== */}
          {portalFeatures.viewSchedule && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar size={15} className="text-indigo-400"/>
                  <h2 className="text-sm font-black text-white uppercase">Cronograma</h2>
                </div>
                <div className="flex gap-1">
                  {(['HOY', 'SEMANA', 'MES'] as const).map(opt => (
                    <button key={opt} onClick={() => setScheduleView(opt)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${scheduleView === opt ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>
                      {opt === 'HOY' ? 'Hoy' : opt === 'SEMANA' ? 'Semana' : 'Mes'}
                    </button>
                  ))}
                </div>
              </div>
              {loadingShifts ? (
                <div className="p-8 text-center text-slate-500 text-xs">Cargando turnos...</div>
              ) : scheduleView !== 'HOY' ? (() => {
                // ── VISTA CALENDARIO (SEMANA / MES) ──────────────────────────
                const todayD = new Date();
                const todayKey = `${todayD.getFullYear()}-${String(todayD.getMonth()+1).padStart(2,'0')}-${String(todayD.getDate()).padStart(2,'0')}`;
                const DAY_ABBR = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];
                const selShift = selectedCalendarDay ? shiftsByDate[selectedCalendarDay] : null;
                const selObjData = selShift?.objectiveId ? objectivesMap[selShift.objectiveId] : null;
                const selEvData = selShift ? getEvData(selShift) : null;
                const selLabel = selShift?.isFranco ? 'Franco' : (selEvData?.nombre || selObjData?.name || selShift?.objectiveName || selShift?.clientName || (selShift?.objectiveId ? objectivesMap[selShift.objectiveId]?.name : null) || 'Sin objetivo');
                const selMapsUrl = selEvData?.mapsUrl ?? (selObjData && selObjData.lat && selObjData.lng
                  ? `https://www.google.com/maps?q=${selObjData.lat},${selObjData.lng}`
                  : selObjData?.address ? `https://www.google.com/maps/search/${encodeURIComponent(selObjData.address)}` : null);

                const getCellStyle = (key: string, selected: boolean) => {
                  const s = shiftsByDate[key];
                  if (!s) return { bg: 'bg-slate-800/30', numColor: 'text-slate-600', code: '' };
                  if (s.isFranco) return {
                    bg: selected ? 'bg-emerald-500' : 'bg-emerald-900/60',
                    numColor: 'text-white',
                    code: s.code || 'F',
                  };
                  if (s.isPresent || (s.status||'').toLowerCase().includes('present')) return {
                    bg: selected ? 'bg-indigo-400' : 'bg-indigo-700/70',
                    numColor: 'text-white',
                    code: s.code || 'T',
                  };
                  return {
                    bg: selected ? 'bg-indigo-500' : 'bg-indigo-900/60',
                    numColor: 'text-white',
                    code: s.code || 'T',
                  };
                };

                let calDays: Array<{ key: string; day: number } | null> = [];
                if (scheduleView === 'SEMANA') {
                  for (let i = 0; i < 7; i++) {
                    const d = new Date(todayD); d.setDate(todayD.getDate() + i);
                    calDays.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, day: d.getDate() });
                  }
                } else {
                  const year = todayD.getFullYear(), month = todayD.getMonth();
                  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  for (let i = 0; i < firstDow; i++) calDays.push(null);
                  for (let d = 1; d <= daysInMonth; d++) {
                    calDays.push({ key: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d });
                  }
                }

                // Headers dinámicos: para SEMANA usan el día real, para MES siempre Lu-Do
                const headerLabels = scheduleView === 'SEMANA'
                  ? calDays.filter(Boolean).map(d => DAY_ABBR[new Date(d!.key + 'T12:00:00').getDay()])
                  : ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];

                return (
                  <div className="p-3">
                    {/* Grid header */}
                    <div className={`grid gap-1 mb-1 ${scheduleView === 'SEMANA' ? 'grid-cols-7' : 'grid-cols-7'}`}>
                      {headerLabels.map((l, i) => (
                        <div key={i} className="text-center text-[9px] font-black text-slate-600 uppercase py-1">{l}</div>
                      ))}
                    </div>
                    {/* Calendar grid */}
                    <div className={`grid gap-1 ${scheduleView === 'SEMANA' ? 'grid-cols-7' : 'grid-cols-7'}`}>
                      {calDays.map((cell, i) => {
                        if (!cell) return <div key={`empty-${i}`}/>;
                        const isToday = cell.key === todayKey;
                        const isSelected = cell.key === selectedCalendarDay;
                        const hasShift = !!shiftsByDate[cell.key];
                        const { bg, numColor, code } = getCellStyle(cell.key, isSelected);
                        return (
                          <button key={cell.key}
                            onClick={() => setSelectedCalendarDay(isSelected ? null : cell.key)}
                            className={`rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all
                              ${scheduleView === 'SEMANA' ? 'py-3' : 'py-2'}
                              ${bg}
                              ${isToday && !isSelected ? 'ring-2 ring-white' : ''}
                              ${isSelected ? 'shadow-lg shadow-indigo-900/60 scale-105' : ''}
                              ${hasShift ? 'cursor-pointer active:scale-95' : 'cursor-default opacity-30'}
                            `}>
                            <span className={`text-[9px] font-bold leading-none ${code ? numColor : 'text-slate-600'}`}>{cell.day}</span>
                            {code ? (
                              <span className="text-[12px] font-black text-white leading-none">{code.toUpperCase().slice(0,2)}</span>
                            ) : (
                              <span className="text-[11px] text-transparent leading-none">·</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Detail panel for selected day */}
                    {selectedCalendarDay && (
                      <div className="mt-3 border rounded-xl overflow-hidden border-indigo-800/50">
                        {/* Date header bar */}
                        <div className="bg-indigo-600/30 border-b border-indigo-800/50 px-3 py-2 flex items-center justify-between">
                          <span className="text-[11px] font-black text-indigo-200 uppercase tracking-wide">
                            {new Date(selectedCalendarDay + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
                          </span>
                          <button onClick={() => setSelectedCalendarDay(null)} className="text-slate-500 hover:text-white transition-colors">
                            <X size={14}/>
                          </button>
                        </div>
                        {selShift ? (
                          <div className="bg-slate-800/60 p-3 space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className={`text-sm font-black ${selShift.isFranco ? 'text-emerald-300' : 'text-white'}`}>{selLabel}</p>
                                {!selShift.isFranco && (
                                  <p className="text-[11px] text-slate-400 font-bold">
                                    {selEvData?.horarioBadge ?? `${formatTime(selShift.startTime)} – ${formatTime(selShift.endTime)}`}
                                  </p>
                                )}
                                {selEvData ? (
                                  <>
                                    {selEvData.eventoNombre && selEvData.eventoNombre !== selEvData.nombre && <p className="text-[10px] text-yellow-400/80 mt-0.5">{selEvData.eventoNombre}</p>}
                                    {selEvData.clienteNombre && <p className="text-[10px] text-slate-500 mt-0.5">{selEvData.clienteNombre}</p>}
                                    {selEvData.direccion && <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5"><MapPin size={9}/> {selEvData.direccion}</p>}
                                    {selEvData.requisitos && <p className="text-[10px] text-amber-400/80 mt-1">Requisitos: {selEvData.requisitos}</p>}
                                    {selEvData.instrucciones && <p className="text-[10px] text-slate-400 mt-0.5">{selEvData.instrucciones}</p>}
                                  </>
                                ) : (
                                  <>
                                    {selObjData?.clientName && <p className="text-[10px] text-slate-500 mt-0.5">{selObjData.clientName}</p>}
                                    {selObjData?.address && <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5"><MapPin size={9}/> {selObjData.address}</p>}
                                    {selShift.positionName && <p className="text-[10px] text-slate-600 mt-0.5">Puesto: {selShift.positionName}</p>}
                                  </>
                                )}
                                {selShift.isPresent && <p className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 mt-1"><CheckCircle size={10}/> Presente registrado</p>}
                              </div>
                              {selMapsUrl && (
                                <a href={selMapsUrl} target="_blank" rel="noopener noreferrer"
                                   className="shrink-0 flex items-center gap-1 text-[9px] font-black text-indigo-300 bg-indigo-950 border border-indigo-800 px-2 py-1.5 rounded-lg">
                                  <Navigation size={10}/> IR
                                </a>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="bg-slate-800/60 p-3 text-center text-[11px] text-slate-500 font-bold">Sin turno asignado</div>
                        )}
                      </div>
                    )}

                    {/* Legend */}
                    <div className="mt-3 flex flex-wrap gap-2 justify-center">
                      <span className="flex items-center gap-1 text-[9px] text-slate-500"><span className="w-3 h-3 rounded bg-indigo-900/40 inline-block"/>Turno</span>
                      <span className="flex items-center gap-1 text-[9px] text-slate-500"><span className="w-3 h-3 rounded bg-emerald-900/40 inline-block"/>Franco</span>
                      <span className="flex items-center gap-1 text-[9px] text-slate-500"><span className="w-3 h-3 rounded ring-2 ring-indigo-500 inline-block"/>Hoy</span>
                    </div>
                  </div>
                );
              })() : upcomingShifts.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-slate-500 text-xs font-bold">Sin turnos en este período.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/60">
                  {upcomingShifts.map(shift => {
                    const objectiveData = shift.objectiveId ? objectivesMap[shift.objectiveId] : null;
                    const evd = getEvData(shift);
                    const objectiveLabel = shift.isFranco ? 'Franco' : (evd?.nombre || objectiveData?.name || shift.objectiveName || shift.clientName || (shift.objectiveId ? objectivesMap[shift.objectiveId]?.name : null) || 'Sin objetivo');
                    const isFranco = !!shift.isFranco;
                    const rawStatus = shift.status || (shift.isPresent ? 'PRESENT' : 'ASSIGNED');
                    const isPresent = shift.isPresent || rawStatus === 'PRESENT' || rawStatus === 'InProgress';
                    const shiftCode = (shift.code || '').toUpperCase();
                    const codeColor = isFranco ? 'bg-emerald-900/40 text-emerald-400' : evd ? 'bg-yellow-900/40 text-yellow-400' : isPresent ? 'bg-indigo-900/40 text-indigo-400' : 'bg-slate-800 text-slate-400';
                    const hasCoords = objectiveData && objectiveData.lat && objectiveData.lng;
                    const mapsUrl = evd?.mapsUrl ?? (hasCoords
                      ? `https://www.google.com/maps?q=${objectiveData!.lat},${objectiveData!.lng}`
                      : objectiveData?.address
                        ? `https://www.google.com/maps/search/${encodeURIComponent(objectiveData.address)}`
                        : null);
                    return (
                      <div key={shift.id} className={`px-4 py-3.5 flex items-start gap-3 ${isFranco ? 'bg-emerald-950/10' : evd ? 'bg-yellow-950/10' : ''}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-xs mt-0.5 ${codeColor}`}>
                          {shiftCode || (isFranco ? 'F' : 'T')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-black truncate ${isFranco ? 'text-emerald-300' : evd ? 'text-yellow-300' : 'text-white'}`}>{objectiveLabel}</p>
                          <p className="text-[11px] text-slate-500">
                            {formatDate(shift.startTime)}
                            {!isFranco && evd?.horarioBadge && ` · ${evd.horarioBadge}`}
                            {!isFranco && !evd?.horarioBadge && ` · ${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`}
                          </p>
                          {!isFranco && evd && (
                            <>
                              {evd.eventoNombre && evd.eventoNombre !== evd.nombre && <p className="text-[10px] text-yellow-500/70 truncate mt-0.5">{evd.eventoNombre}</p>}
                              {evd.direccion && <p className="text-[10px] text-slate-600 truncate mt-0.5 flex items-center gap-1"><MapPin size={9} className="shrink-0"/> {evd.direccion}</p>}
                              {evd.clienteNombre && <p className="text-[10px] text-slate-600 truncate">{evd.clienteNombre}</p>}
                            </>
                          )}
                          {!isFranco && !evd && objectiveData?.address && (
                            <p className="text-[10px] text-slate-600 truncate mt-0.5 flex items-center gap-1">
                              <MapPin size={9} className="shrink-0"/> {objectiveData.address}
                            </p>
                          )}
                          {!isFranco && !evd && objectiveData?.clientName && (
                            <p className="text-[10px] text-slate-600 truncate">{objectiveData.clientName}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {isPresent && <CheckCircle size={16} className="text-emerald-400"/>}
                          {!isPresent && !isFranco && (
                            <span className="text-[9px] font-black uppercase text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">Asig.</span>
                          )}
                          {!isFranco && mapsUrl && (
                            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                               className="flex items-center gap-1 text-[9px] font-black text-indigo-400 bg-indigo-950/50 border border-indigo-900/50 px-2 py-0.5 rounded-full hover:bg-indigo-900/40 transition-colors">
                              <Navigation size={9}/> IR
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===== SWAP REQUESTS PENDIENTES ===== */}
          {portalFeatures.swapShifts && swapRequests.filter((r: any) => {
            const status = (r.status || '').toString().toUpperCase();
            return !['CANCELLED','REJECTED','CANCELADO','RECHAZADO'].includes(status);
          }).length > 0 && (
            <div className="bg-slate-900 border border-amber-800/40 rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase text-amber-400 mb-3 flex items-center gap-2">
                <ArrowLeftRight size={12}/> Solicitudes de Canje pendientes
              </p>
              <div className="space-y-2">
                {swapRequests
                  .filter((r: any) => !['CANCELLED','REJECTED','CANCELADO','RECHAZADO'].includes((r.status || '').toString().toUpperCase()))
                  .slice(0, 3)
                  .map((r: any) => {
                    const isTarget = r.targetUid === user?.uid;
                    const status = (r.status || '').toString();
                    return (
                      <div key={r.id} className="border border-slate-800 rounded-xl p-3 text-xs">
                        <div className="font-bold text-slate-200">{r.requesterName || 'Empleado'} ⇄ {r.targetName || 'Empleado'}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{formatDate(r.requesterShiftDate)} · {status}</div>
                        {status === 'PENDING_PEER' && isTarget && (
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => handleRespondSwap(r.id, true)} disabled={swapBusy} className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50">Aceptar</button>
                            <button onClick={() => handleRespondSwap(r.id, false)} disabled={swapBusy} className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50">Rechazar</button>
                          </div>
                        )}
        {status === 'PENDING_REQUESTER' && r.requesterUid === user?.uid && (
                          <div className="flex gap-2 mt-2">
                            <button onClick={() => handleConfirmSwap(r.id, true)} disabled={swapBusy} className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50">Confirmar</button>
                            <button onClick={() => handleConfirmSwap(r.id, false)} disabled={swapBusy} className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50">Cancelar</button>
                          </div>
                        )}
                        {status === 'PENDING_SUPERVISOR' && (
                          <div className="text-[10px] text-amber-400 mt-2 font-bold">
                            Pendiente de autorización de supervisor en planificación.
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

        </div>


        {/* ===== PANEL: REALIZADOS ===== */}
        {showCompletedPanel && (
          <div className="fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center p-4">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-t-3xl text-white" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 mb-4 shrink-0"/>
              <div className="px-5 pb-2 shrink-0">
                <div className="flex items-center gap-3 mb-3">
                  <Calendar className="text-indigo-400" size={18}/>
                  <h2 className="font-black uppercase text-sm flex-1">Turnos realizados</h2>
                  <button onClick={() => setShowCompletedPanel(false)} className="text-slate-400 hover:text-white"><X size={18}/></button>
                </div>
                <div className="flex gap-2 mb-3">
                  {(['HOY','SEMANA','MES'] as const).map(v => (
                    <button key={v} onClick={() => setCompletedView(v)}
                      className="px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all"
                      style={{ background: completedView === v ? empresaColor : '#1e293b', color: completedView === v ? '#fff' : '#94a3b8' }}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-y-auto px-5 pb-6 space-y-2 flex-1">
                {completedShifts.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">Sin turnos realizados en este período</p>
                ) : completedShifts.map(s => (
                  <div key={s.id} className="bg-slate-800 border border-slate-700 rounded-2xl p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-white truncate">{(s.objectiveName && objectivesMap[s.objectiveName]?.name) || s.objectiveName || (s.objectiveId ? objectivesMap[s.objectiveId]?.name : null) || 'Sin objetivo'}</p>
                        <p className="text-[11px] font-bold mt-0.5" style={{ color: empresaColor }}>{formatDate(s.startTime)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatTime(s.startTime)} – {formatTime(s.endTime)}</p>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/40 shrink-0">
                        <CheckCircle size={10} className="text-emerald-400"/>
                        <span className="text-[9px] font-black text-emerald-300 uppercase">Realizado</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== PANEL: PRESENTES ===== */}
        {showPresentHistory && (
          <div className="fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center p-4">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-t-3xl text-white" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 mb-4 shrink-0"/>
              <div className="px-5 pb-2 shrink-0">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle className="text-emerald-400" size={18}/>
                  <h2 className="font-black uppercase text-sm flex-1">Historial de presentes</h2>
                  <button onClick={() => setShowPresentHistory(false)} className="text-slate-400 hover:text-white"><X size={18}/></button>
                </div>
                <p className="text-[10px] text-slate-500 mb-3">{presentHistory.length} presentes este mes</p>
              </div>
              <div className="overflow-y-auto px-5 pb-6 space-y-2 flex-1">
                {presentHistory.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-8">Sin presentes registrados este mes</p>
                ) : presentHistory.map(s => (
                  <div key={s.id} className="bg-slate-800 border border-slate-700 rounded-2xl p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-white truncate">{(s.objectiveName && objectivesMap[s.objectiveName]?.name) || s.objectiveName || (s.objectiveId ? objectivesMap[s.objectiveId]?.name : null) || 'Sin objetivo'}</p>
                        <p className="text-[11px] font-bold mt-0.5" style={{ color: empresaColor }}>{formatDate(s.startTime)}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatTime(s.startTime)} – {formatTime(s.endTime)}</p>
                        {(s.isPresent || s.checkInTime) && s.startTime && (
                          <p className="text-[9px] text-emerald-400 font-bold mt-1">
                            ✓ Tu turno comenzó a las {formatTime(s.startTime)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/40 shrink-0">
                        <CheckCircle size={10} className="text-emerald-400"/>
                        <span className="text-[9px] font-black text-emerald-300 uppercase">Presente</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== BOTTOM NAV ===== */}
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 px-2 py-2">
          <div className="max-w-2xl mx-auto flex justify-around items-center">
            {(portalFeatures.reportAbsence || portalFeatures.requestLicense) && (
              <button
                onClick={() => { setShowAbsenceRequest(v => !v); setShowSwap(false); setShowCompletedPanel(false); setShowPresentHistory(false); }}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${showAbsenceRequest ? 'text-violet-400 bg-violet-400/10' : 'text-slate-500 hover:text-slate-300'}`}>
                <FileText size={20}/>
                <span className="text-[9px] font-black uppercase">Novedad</span>
              </button>
            )}
            {portalFeatures.swapShifts && (
              <button
                onClick={() => { setShowSwap(v => !v); setShowAbsenceRequest(false); setShowCompletedPanel(false); setShowPresentHistory(false); }}
                className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${showSwap ? 'text-sky-400 bg-sky-400/10' : 'text-slate-500 hover:text-slate-300'}`}>
                <ArrowLeftRight size={20}/>
                <span className="text-[9px] font-black uppercase">Canje</span>
              </button>
            )}
            <button
              onClick={() => { setShowCompletedPanel(v => !v); setShowAbsenceRequest(false); setShowSwap(false); setShowPresentHistory(false); }}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all" style={{ color: showCompletedPanel ? empresaColor : '#64748b', background: showCompletedPanel ? `${empresaColor}18` : 'transparent' }}>
              <Calendar size={20}/>
              <span className="text-[9px] font-black uppercase">Realizados</span>
            </button>
            <button
              onClick={() => { setShowPresentHistory(v => !v); setShowAbsenceRequest(false); setShowSwap(false); setShowCompletedPanel(false); }}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all" style={{ color: showPresentHistory ? empresaColor : '#64748b', background: showPresentHistory ? `${empresaColor}18` : 'transparent' }}>
              <CheckCircle size={20}/>
              <span className="text-[9px] font-black uppercase">Presentes</span>
            </button>
          </div>
        </div>

        {/* ===== MODAL: SOLICITAR NOVEDAD ===== */}
        {showAbsenceRequest && (
          <div className="fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex items-end justify-center p-4">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-t-3xl text-white animate-in slide-in-from-bottom-5">
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mt-3 mb-4"/>
              <div className="px-5 pb-5">
                <div className="flex items-center gap-3 mb-4">
                  <FileText className="text-violet-400" size={18}/>
                  <h2 className="font-black uppercase text-sm flex-1">Solicitar novedad / ausencia</h2>
                  <button onClick={() => setShowAbsenceRequest(false)} className="text-slate-400 hover:text-white"><X size={18}/></button>
                </div>
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Tipo</label>
                    <select className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white mt-1" value={absenceType} onChange={(e) => setAbsenceType(e.target.value as any)}>
                      <option value="Vacaciones">Vacaciones</option>
                      <option value="Licencia Esp.">Licencia Esp.</option>
                      <option value="Enfermedad">Enfermedad</option>
                      <option value="ART">ART</option>
                      <option value="Ausencia con aviso">Hoy no me presento</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[10px] font-black uppercase text-slate-400">Desde</label><input type="date" className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white mt-1" value={absenceStart} onChange={(e) => setAbsenceStart(e.target.value)}/></div>
                    <div><label className="text-[10px] font-black uppercase text-slate-400">Hasta</label><input type="date" className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white mt-1" value={absenceEnd} onChange={(e) => setAbsenceEnd(e.target.value)}/></div>
                  </div>
                  {(absenceType === 'Enfermedad' || absenceType === 'ART') && (
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-400">Certificado (PDF/JPG/PNG) — opcional</label>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { setAbsenceFile(e.target.files?.[0] || null); setAbsenceFileUrl(''); setAbsenceFileName(''); }} className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white mt-1"/>
                      {absenceFile && <p className="text-[10px] text-slate-400 mt-1">{absenceFile.name}</p>}
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Motivo</label>
                    <textarea className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm h-24 bg-slate-950 text-white mt-1 resize-none" placeholder="Describí brevemente el motivo..." value={absenceReason} onChange={(e) => setAbsenceReason(e.target.value)}/>
                  </div>
                  <p className="text-[10px] text-slate-500">Tu solicitud quedará pendiente de aprobación por RRHH.</p>
                  <button onClick={handleSubmitAbsenceRequest} disabled={absenceUploading} className="w-full py-3.5 bg-violet-600 text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    <FileText size={16}/> {absenceUploading ? 'Subiendo...' : 'Enviar solicitud'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== MODAL: CANJE ===== */}
        {showSwap && (
          <div className="fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl text-white">
              <div className="p-5 border-b border-slate-800 flex items-center gap-3">
                <ArrowLeftRight className="text-sky-400" size={18}/>
                <h2 className="font-black uppercase text-sm flex-1">Intercambio de turno / franco</h2>
                <button onClick={() => setShowSwap(false)} className="text-slate-400 hover:text-white"><X size={18}/></button>
              </div>
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                <p className="text-[11px] text-slate-400">Dentro del mes en curso. Compatibles por grupo: 8hs, 12hs o franco.</p>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400">Mi turno/franco</label>
                  <select className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white mt-1" value={swapShiftId} onChange={(e) => { setSwapShiftId(e.target.value); setSwapCandidates([]); setSwapTargetShiftId(''); setSwapSearched(false); setSwapSearch(''); setSwapPersonKey(''); }}>
                    <option value="">Seleccionar</option>
                    {shifts.filter((s) => { const d = toDate(s.startTime); if (!d) return false; const today = new Date(); today.setHours(0,0,0,0); const minDate = new Date(today); minDate.setDate(minDate.getDate() + 1); return d >= minDate && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).map((s) => (<option key={s.id} value={s.id}>{formatSwapOption(s)}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400">Compañero</label>
                  <div className="relative mt-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                    <input value={swapSearch} onChange={(e) => { const value = e.target.value; setSwapSearch(value); const match = swapPeople.find((p) => p.name.toLowerCase() === value.trim().toLowerCase()); if (match) { setSwapPersonKey(match.key); setSwapTargetShiftId(''); } else if (swapPersonKey) { setSwapPersonKey(''); setSwapTargetShiftId(''); } }} placeholder="Buscar compañero..." list="swap-people-list" className="w-full pl-9 pr-3 py-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white placeholder:text-slate-600"/>
                    <datalist id="swap-people-list">{filteredSwapPeople.map((p) => (<option key={p.key} value={p.name}/>))}</datalist>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400">Turno del compañero</label>
                  <select className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white mt-1" value={swapTargetShiftId} onChange={(e) => setSwapTargetShiftId(e.target.value)} disabled={!swapPersonKey}>
                    <option value="">Seleccionar turno</option>
                    {swapCandidateShifts.map((c) => (<option key={c.id} value={c.id}>{formatSwapOption(c)}</option>))}
                  </select>
                </div>
                <button onClick={handleCreateSwap} disabled={!swapShiftId || !swapTargetShiftId || swapBusy} className="w-full py-3.5 bg-sky-600 text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  Enviar solicitud
                </button>
                {swapRequests.filter((r: any) => !['CANCELLED','REJECTED','CANCELADO','RECHAZADO'].includes((r.status||'').toString().toUpperCase())).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <p className="text-[10px] font-black uppercase text-slate-400">Solicitudes activas</p>
                    {swapRequests.filter((r: any) => !['CANCELLED','REJECTED','CANCELADO','RECHAZADO'].includes((r.status||'').toString().toUpperCase())).map((r: any) => {
                      const isTarget = r.targetUid === user?.uid;
                      const isRequester = r.requesterUid === user?.uid;
                      const status = (r.status || '').toString();
                      const statusUpper = status.toUpperCase();
                      return (
                        <div key={r.id} className="border border-slate-800 rounded-xl p-3 text-xs">
                          <div className="font-bold text-slate-200">{r.requesterName || 'Empleado'} ⇄ {r.targetName || 'Empleado'}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{formatDate(r.requesterShiftDate)} · {status}</div>
                          {isRequester && !['APPROVED','REJECTED','CANCELLED'].includes(statusUpper) && status !== 'PENDING_REQUESTER' && (<div className="flex gap-2 mt-2"><button onClick={() => handleCancelSwap(r.id)} disabled={swapBusy} className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50">Cancelar solicitud</button></div>)}
                          {status === 'PENDING_APPROVAL' && <div className="text-[10px] text-amber-300 mt-2">Pendiente de autorización</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== MODAL: CREDENCIAL (editar) ===== */}
        {showCredencial && (
          <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(4px)' }}>
            <button
              onClick={() => { backCloserRef.current = null; setShowCredencial(false); history.back(); }}
              className="fixed z-[70] text-slate-400 hover:text-white transition-colors p-2 rounded-xl hover:bg-slate-800/80"
              style={{ top: 12, right: 12 }}
            >
              <X size={22}/>
            </button>
            <div className="px-4 py-6 flex justify-center">
              <div className="w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[360px] lg:[zoom:1.25] xl:[zoom:1.4]">
              {empDocIdSt && empProfile ? (
                <CredencialDigital empDocId={empDocIdSt} empData={empProfile} empresaNombre={empresaNombre}/>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
                  <p className="text-slate-500 text-sm font-bold">Cargando...</p>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

        {/* ===== MODAL: CREDENCIAL (vista empleado) ===== */}
        {showCredencialVista && (
          <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(4px)' }}>
            <button
              onClick={() => { backCloserRef.current = null; setShowCredencialVista(false); history.back(); }}
              className="fixed z-[70] text-slate-400 hover:text-white transition-colors p-2 rounded-xl hover:bg-slate-800/80"
              style={{ top: 12, right: 12 }}
            >
              <X size={22}/>
            </button>
            <div className="px-4 py-6 flex justify-center">
              <div className="w-full max-w-[300px] sm:max-w-[340px] lg:max-w-[360px] lg:[zoom:1.25] xl:[zoom:1.4]">
              {empDocIdSt && empProfile ? (
                <CredencialDigital empDocId={empDocIdSt} empData={empProfile} empresaNombre={empresaNombre} viewOnly={true}/>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
                  <p className="text-slate-500 text-sm font-bold">Cargando...</p>
                </div>
              )}
              </div>
            </div>
          </div>
        )}

      </div>
    </AuthGuard>
  );
}
