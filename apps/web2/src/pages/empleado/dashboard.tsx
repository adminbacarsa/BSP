import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AuthGuard from '@/components/auth/AuthGuard';
import { Calendar, MapPin, Bell, FileText, CheckCircle, AlertTriangle, Navigation, BellRing, Sun, Sunset, Moon, ArrowLeftRight, Search, X } from 'lucide-react';
import { app, db, functions, storage } from '@/lib/firebase';
import { collection, doc, serverTimestamp, addDoc, setDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, updateDoc, getDocs, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

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
};

type ObjectiveLocation = { lat: number; lng: number; name: string; clientName?: string; address?: string };

const toDate = (val: any) => {
  if (!val) return null;
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
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [objectivesMap, setObjectivesMap] = useState<Record<string, ObjectiveLocation>>({});
  const [checkingShiftId, setCheckingShiftId] = useState<string | null>(null);
  const [reportType, setReportType] = useState<'AUSENCIA' | 'NOVEDAD' | 'BAJA_ANTICIPADA'>('AUSENCIA');
  const [reportReason, setReportReason] = useState('');
  const [reportShiftId, setReportShiftId] = useState('');
  const [licenseType, setLicenseType] = useState<'VACATION' | 'SICK_LEAVE' | 'OTHER'>('OTHER');
  const [licenseReason, setLicenseReason] = useState('');
  const [licenseStart, setLicenseStart] = useState('');
  const [licenseEnd, setLicenseEnd] = useState('');
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseFileUrl, setLicenseFileUrl] = useState('');
  const [licenseFileName, setLicenseFileName] = useState('');
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [absenceStart, setAbsenceStart] = useState('');
  const [absenceEnd, setAbsenceEnd] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleView, setScheduleView] = useState<'HOY' | 'SEMANA' | 'MES'>('HOY');
  const [showUpcomingTable, setShowUpcomingTable] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
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
  const monthInbox = useMemo(() => {
    const now = new Date();
    return inbox.filter((n) => {
      const d = toDate(n.createdAt);
      if (!d) return false;
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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

  const { user } = useAuth();
  const router = useRouter();
  const previousShiftRef = useRef<Map<string, Shift>>(new Map());

  const loadObjectives = async () => {
    try {
      const callable = httpsCallable(functions, 'getEmployeeObjectives');
      const result: any = await callable({});
      setObjectivesMap(result.data?.data || {});
    } catch (e) {
      console.error(e);
      addToast('Error cargando objetivos', 'error');
    }
  };

  const fetchShifts = async () => {
    if (!user) return;
    setLoadingShifts(true);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      const callable = httpsCallable(functions, 'getEmployeeShifts');
      const result: any = await callable({ startDate: start.toISOString(), endDate: end.toISOString() });
      const list: Shift[] = (result.data?.data || []).sort((a: any, b: any) => {
        const ad = toDate(a.startTime)?.getTime() ?? 0;
        const bd = toDate(b.startTime)?.getTime() ?? 0;
        return ad - bd;
      });

      const newMap = new Map<string, Shift>();
      list.forEach((s) => newMap.set(s.id, s));
      newMap.forEach((current, id) => {
        const previous = previousShiftRef.current.get(id);
        if (previous) {
          const fields: Array<keyof Shift> = ['startTime', 'endTime', 'objectiveName', 'clientName', 'objectiveId', 'positionName', 'status'];
          const changed = fields.some((f) => normalizeField((previous as any)[f]) !== normalizeField((current as any)[f]));
          if (changed) {
            const when = formatDate(current.startTime);
            const obj = current.objectiveName || current.clientName || 'Objetivo';
            addToast(`Cambio en tu cronograma: ${when} · ${obj}`, 'info');
          }
        }
      });
      previousShiftRef.current = newMap;
      setShifts(list);
    } catch (e) {
      console.error(e);
      addToast('Error cargando cronograma', 'error');
    } finally {
      setLoadingShifts(false);
    }
  };

  const displayName = useMemo(() => {
    if (!user) return 'Empleado';
    if (user.displayName) return user.displayName;
    if (user.email) return user.email.split('@')[0];
    return 'Empleado';
  }, [user]);

  const scrollToSection = (id: string, open?: () => void) => {
    if (open) open();
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  };

  useEffect(() => {
    if (!user) return;
    let cleanup = () => {};
    loadObjectives();
    fetchShifts();
    const t = setInterval(() => fetchShifts(), 60000);
    return () => clearInterval(t);
  }, [user?.uid]);

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
    if (licenseType !== 'SICK_LEAVE') {
      setLicenseFile(null);
      setLicenseFileUrl('');
      setLicenseFileName('');
    }
  }, [licenseType]);

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
      const unsub = onSnapshot(
        q,
        (snap) => {
          inboxBucketsRef.current[key] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          rebuild();
        },
        (err) => {
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
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return sortedShifts.find((s) => {
      const start = toDate(s.startTime);
      return start && start >= startOfDay && start <= endOfDay;
    });
  }, [sortedShifts]);

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
        return !!s.checkInTime || s.isPresent || status.includes('present') || status.includes('inprogress');
      })
      .sort((a, b) => (toDate(b.startTime)?.getTime() || 0) - (toDate(a.startTime)?.getTime() || 0));
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
        await callable({
          shiftId: item.shiftId,
          coords: item.coords,
          offline: true,
          recordedAt: item.recordedAt || item.createdAt || new Date().toISOString()
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
    if (!objective) {
      addToast('Objetivo sin ubicación', 'error');
      return;
    }

    let coords: { latitude: number; longitude: number } | null = null;
    setCheckingShiftId(shift.id);
    try {
      coords = await getCoords();
      const distanceKm = haversineKm(coords.latitude, coords.longitude, objective.lat, objective.lng);
      if (distanceKm > 0.08) {
        addToast('Estás a más de 80 mts del objetivo', 'error');
        return;
      }

      if (!navigator.onLine) {
        const list = loadPendingCheckins();
        list.push({
          shiftId: shift.id,
          coords: { lat: coords.latitude, lng: coords.longitude },
          createdAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          offline: true
        });
        savePendingCheckins(list);
        addToast('Sin conexión. Presente guardado y se enviará luego.', 'info');
        return;
      }

      const callable = httpsCallable(functions, 'requestCheckIn');
      await callable({
        shiftId: shift.id,
        coords: { lat: coords.latitude, lng: coords.longitude },
        offline: false,
        recordedAt: new Date().toISOString()
      });

      addToast('Solicitud de presente enviada', 'success');
    } catch (e: any) {
      console.error(e);
      const message = (e?.message || '').toString().toLowerCase();
      const isNetwork = !navigator.onLine || message.includes('network') || message.includes('unavailable');
      if (isNetwork && coords) {
        const list = loadPendingCheckins();
        list.push({
          shiftId: shift.id,
          coords: { lat: coords.latitude, lng: coords.longitude },
          createdAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          offline: true
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

  const handleSubmitReport = async () => {
    if (!user) return;
    if (!reportReason.trim()) {
      addToast('Indicá el motivo', 'error');
      return;
    }
    try {
      if (reportType === 'AUSENCIA') {
        if (!absenceStart || !absenceEnd) {
          addToast('Seleccioná fechas', 'error');
          return;
        }
        const manageAbsences = httpsCallable(functions, 'manageAbsences');
        await manageAbsences({
          action: 'CREATE_ABSENCE',
          payload: {
            employeeId: user.uid,
            employeeName: user.displayName || user.email || 'Empleado',
            clientId: 'INTERNO',
            type: 'OTHER',
            startDate: absenceStart,
            endDate: absenceEnd,
            reason: reportReason,
            category: 'ABSENCE_REPORT'
          }
        });
        addToast('Ausencia registrada', 'success');
      } else {
        await addDoc(collection(db, 'novedades'), {
          source: 'EMPLEADO',
          type: reportType,
          status: 'PENDIENTE',
          employeeId: user.uid,
          employeeName: user.displayName || user.email || 'Empleado',
          shiftId: reportShiftId || null,
          reason: reportReason,
          createdAt: serverTimestamp()
        });
        addToast('Reporte enviado', 'success');
      }
      setReportReason('');
      setReportShiftId('');
      setAbsenceStart('');
      setAbsenceEnd('');
    } catch (e) {
      console.error(e);
      addToast('No se pudo enviar el reporte', 'error');
    }
  };

  const handleSubmitLicense = async () => {
    if (!user) return;
    if (!licenseStart || !licenseEnd || !licenseReason.trim()) {
      addToast('Completá fechas y motivo', 'error');
      return;
    }
    if (licenseType === 'SICK_LEAVE' && !licenseFile) {
      addToast('Adjuntá el certificado médico', 'error');
      return;
    }
    try {
      let fileUrl = licenseFileUrl;
      let fileName = licenseFileName;
      if (licenseType === 'SICK_LEAVE' && licenseFile && !fileUrl) {
        setLicenseUploading(true);
        const safeName = `${Date.now()}_${licenseFile.name.replace(/\s+/g, '_')}`;
        const fileRef = ref(storage, `absences/${user.uid}/${safeName}`);
        await uploadBytes(fileRef, licenseFile);
        fileUrl = await getDownloadURL(fileRef);
        fileName = licenseFile.name;
        setLicenseFileUrl(fileUrl);
        setLicenseFileName(fileName);
        setLicenseUploading(false);
      }
      const manageAbsences = httpsCallable(functions, 'manageAbsences');
      await manageAbsences({
        action: 'CREATE_ABSENCE',
        payload: {
          employeeId: user.uid,
          employeeName: user.displayName || user.email || 'Empleado',
          clientId: 'INTERNO',
          type: licenseType,
          startDate: licenseStart,
          endDate: licenseEnd,
          reason: licenseReason,
          category: 'LICENSE_REQUEST',
          certificateUrl: fileUrl || null,
          certificateName: fileName || null,
          certificateUploadedAt: fileUrl ? new Date().toISOString() : null
        }
      });
      addToast('Licencia solicitada', 'success');
      setLicenseReason('');
      setLicenseStart('');
      setLicenseEnd('');
      setLicenseFile(null);
      setLicenseFileUrl('');
      setLicenseFileName('');
    } catch (e) {
      console.error(e);
      addToast('No se pudo solicitar la licencia', 'error');
    } finally {
      setLicenseUploading(false);
    }
  };

  const loadSwapRequests = async () => {
    if (!user) return;
    try {
      const callable = httpsCallable(functions, 'getMySwapRequests');
      const result: any = await callable({});
      setSwapRequests(result.data?.data || []);
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
      addToast('Falta configurar VAPID KEY', 'error');
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
  const markNotificationRead = async (id: string, subject?: string) => {
    try {
      await updateDoc(doc(db, 'user_notifications', id), { read: true });
      const empName = displayName || user?.email || 'Empleado';
      await addDoc(collection(db, 'audit_logs'), {
        action: 'Notificación leída por empleado',
        module: 'OPERACIONES',
        details: `${empName} leyó: ${subject || id}`,
        timestamp: serverTimestamp(),
        actorName: empName,
        actorUid: user?.uid || null,
      });
    } catch (e) {
      console.error(e);
      addToast('No se pudo marcar como leída', 'error');
    }
  };
  const markAllUnreadRead = async () => {
    if (unreadInbox.length === 0) return;
    try {
      await Promise.all(unreadInbox.map((n) => updateDoc(doc(db, 'user_notifications', n.id), { read: true })));
      const empName = displayName || user?.email || 'Empleado';
      await addDoc(collection(db, 'audit_logs'), {
        action: 'Notificaciones leídas por empleado',
        module: 'OPERACIONES',
        details: `${empName} marcó ${unreadInbox.length} notificación(es) como leída(s)`,
        timestamp: serverTimestamp(),
        actorName: empName,
        actorUid: user?.uid || null,
      });
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
    await setDoc(doc(db, 'device_tokens', token), {
      uid: user.uid,
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
          const title = payload?.notification?.title || 'CronoApp';
          const body = payload?.notification?.body || '';
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

  return (
    <AuthGuard>
      <Head>
        <title>Portal Empleado | CronoApp</title>
      </Head>
      <div className="min-h-screen bg-slate-950">
        {hasUnread && (
          <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black uppercase">Notificaciones pendientes</div>
                <button
                  onClick={markAllUnreadRead}
                  className="px-3 py-2 rounded-lg text-[10px] font-black uppercase bg-indigo-600 text-white"
                >
                  Marcar todas
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Para continuar, marcá como leída cada notificación.
              </p>
              <div className="mt-4 max-h-72 overflow-y-auto space-y-2">
                {unreadInbox.map((n: any) => (
                  <div key={n.id} className="border border-slate-800 rounded-xl p-3 bg-slate-950/50">
                    <div className="text-xs font-bold">{n.title || 'Notificación'}</div>
                    <div className="text-[11px] text-slate-300 mt-1">{n.body || n.message || ''}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-rose-500 font-bold">No leída</span>
                      <button
                        onClick={() => markNotificationRead(n.id, n.title || n.body)}
                        className="px-3 py-1 rounded-lg text-[10px] font-black uppercase bg-slate-800 text-white"
                      >
                        Marcar leída
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {showNotifications && (
          <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bell size={16} className="text-indigo-300" />
                  <div className="text-sm font-black uppercase">Notificaciones</div>
                </div>
                <button
                  onClick={() => setShowNotifications(false)}
                  className="text-slate-300 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-4">
                {loadingInbox ? (
                  <p className="text-xs text-slate-400">Cargando notificaciones...</p>
                ) : monthInbox.length === 0 ? (
                  <div className="text-xs text-slate-400 text-center py-12">
                    CRONO APP | BACAR SA. 2026
                  </div>
                ) : (
                  <div className={`overflow-y-auto pr-1 max-h-96 ${allMonthRead ? 'space-y-2' : 'space-y-3'}`}>
                    {monthInbox.map((n) => {
                      const type = (n?.data?.type || '').toString().toUpperCase();
                      let actionLabel = 'Cambio';
                      if (type === 'ASSIGNED' || type === 'PLANIFICACION') actionLabel = 'Asignado';
                      else if (type === 'REMOVED' || type === 'FRANCO_REMOVED' || type === 'UNASSIGNED') actionLabel = 'Eliminado';
                      else if (type === 'SHIFT_UPDATE') actionLabel = 'Modificado';
                      else if (type === 'FRANCO') actionLabel = 'Franco asignado';
                      else if (type === 'CHECKIN') actionLabel = 'Presente';
                      else if (type === 'RETENTION' || type === 'RETENCION') actionLabel = 'Retención';
                      return (
                        <div
                          key={n.id}
                          onClick={() => !n.read && markNotificationRead(n.id, n.title || n.body)}
                          className={`border border-slate-800 rounded-xl cursor-pointer ${
                            allMonthRead ? 'p-2' : 'p-3'
                          } ${n.read ? 'bg-slate-950/60' : 'bg-slate-950/30'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-xs font-black text-slate-200 uppercase">{n.title || 'CronoApp'}</div>
                              <div className="text-[11px] text-slate-400">{actionLabel}: {n.body || ''}</div>
                              <div className="text-[10px] mt-1">
                                <span className="text-slate-400">
                                  {formatDate(n.createdAt)} · {formatTime(n.createdAt)}
                                </span>
                                <span className={`ml-2 ${n.read ? 'text-slate-400' : 'text-rose-500 font-bold'}`}>
                                  {n.read ? 'Leída' : 'No leída'}
                                </span>
                              </div>
                            </div>
                            {!n.read && (
                              <button
                                onClick={() => markNotificationRead(n.id, n.title || n.body)}
                                className="text-[10px] font-black uppercase text-indigo-300"
                              >
                                Marcar leída
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {notifStatus === 'enabled' && (
                <div className="pt-4 flex justify-end">
                  <button
                    onClick={disableNotifications}
                    disabled={notifBusy}
                    title="Desactivar notificaciones"
                    className="text-sky-300/70 disabled:opacity-50"
                  >
                    <BellRing size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4 bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
              <div className="w-12 h-12 rounded-full bg-indigo-500 text-white font-black flex items-center justify-center">
                {displayName?.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-xs text-slate-400">Bienvenido,</p>
                <h1 className="text-xl font-black text-white">{displayName}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-3">
              <span className={`text-[10px] font-black uppercase ${notifStatus === 'enabled' ? 'text-emerald-600' : notifStatus === 'denied' ? 'text-rose-600' : 'text-slate-400'}`}>
                Notificaciones: {notifStatus === 'enabled' ? 'Activas' : notifStatus === 'denied' ? 'Bloqueadas' : 'Inactivas'}
              </span>
              <button
                onClick={() => setShowNotifications(true)}
                className="relative p-2 rounded-lg text-indigo-300 hover:text-white"
                title="Ver notificaciones"
              >
                <Bell size={16} />
                {hasUnread && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
                )}
              </button>
              {notifStatus !== 'enabled' && (
                <button
                  onClick={enableNotifications}
                  disabled={notifBusy}
                  className="px-3 py-2 rounded-lg text-[10px] font-black uppercase bg-indigo-600 text-white disabled:opacity-50 flex items-center gap-2"
                >
                  <BellRing size={14} /> Activar
                </button>
              )}
            </div>
          </header>

          <section className="bg-indigo-600 text-white rounded-3xl p-6 shadow-lg shadow-indigo-900/30 flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative">
            <div className="pr-16">
              <div className="text-xs font-black uppercase text-indigo-100">Próximo turno</div>
              <div className="text-2xl font-black mt-1">
                {todayShiftAny ? 'HOY' : nextShift ? formatDate(nextShift.startTime).toUpperCase() : 'Sin turno'}
              </div>
              {todayShiftAny?.isFranco ? (
                <div className="text-sm text-indigo-100">
                  HOY estás de franco!! Disfrutá tu día libre.
                </div>
              ) : (
                <div className="text-sm text-indigo-100">
                  {todayShift
                    ? `${formatTime(todayShift.startTime)} - ${formatTime(todayShift.endTime)}`
                    : nextShift
                    ? `${formatTime(nextShift.startTime)} - ${formatTime(nextShift.endTime)}`
                    : 'No hay turnos próximos'}
                </div>
              )}
              {todayElapsed && (
                <div className="text-xs text-indigo-100 mt-2">
                  Tiempo en servicio: {todayElapsed}
                </div>
              )}
              {todayShift && (
                <div className="text-xs text-indigo-100 mt-2">
                  Cliente: {todayObjective?.clientName || todayShift.clientName || '-'} · Objetivo: {todayObjective?.name || todayShift.objectiveName || '-'} · Puesto: {todayShift.positionName || '-'}
                </div>
              )}
              {!todayShiftAny?.isFranco && (todayShift || nextShift) && (
                <div className="text-xs bg-indigo-500/60 inline-flex mt-3 px-3 py-1 rounded-full">
                  Obj: {(todayObjective?.name || todayShift?.objectiveName || todayShift?.clientName || nextShiftObjective?.name || nextShift?.objectiveName || nextShift?.clientName || 'Objetivo')}
                </div>
              )}
              <div className="text-xs text-indigo-100 mt-2">
                {nextFranco && daysToFranco !== null
                  ? `Próximo Franco: ${formatDate(new Date())} → ${formatDate(nextFranco.startTime)} · ${daysToFranco} días`
                  : 'Sin Francos Asignados.'}
              </div>
              {blueShift && !blueShift.isFranco && blueCountdownMinutes !== null && (
                <div className="text-xs text-indigo-100 mt-2">
                  Faltan {blueCountdownMinutes} minutos para poder dar presente.
                </div>
              )}
              {blueShift && !blueShift.isFranco && blueHasPendingRequest && (
                <div className="text-xs font-bold text-amber-200 mt-2">Solicitud de presente enviada</div>
              )}
              {blueShift && !blueShift.isFranco && blueIsConfirmedPresent && (
                <div className="text-xs font-bold text-emerald-200 mt-2">Presente confirmado</div>
              )}
            </div>
            {(todayShift || nextShift) && (
              <div className="w-12 h-12 rounded-full bg-indigo-500/70 flex items-center justify-center absolute right-6 top-1/2 -translate-y-1/2">
                {(() => {
                  const Icon = todayShift ? todayShiftIcon : nextShiftIcon;
                  return <Icon size={24} className="text-white" />;
                })()}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => scrollToSection('reportes', () => setShowReport(true))}
                className="px-4 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs font-black uppercase w-full sm:w-auto"
              >
                Reportar novedad
              </button>
              <button
                onClick={() => scrollToSection('licencias', () => setShowLicense(true))}
                className="px-4 py-3 rounded-2xl bg-slate-900/80 border border-slate-800 text-xs font-black uppercase w-full sm:w-auto"
              >
                Mis licencias
              </button>
              {blueCanRequest && blueShift && (
                <button
                  onClick={() => handleCheckIn(blueShift)}
                  disabled={checkingShiftId === blueShift.id}
                  className={`px-4 py-3 rounded-2xl text-xs font-black uppercase flex items-center gap-2 w-full sm:w-auto ${
                    checkingShiftId === blueShift.id
                      ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                      : 'bg-emerald-500 text-emerald-950'
                  }`}
                >
                  <Navigation size={14} /> Dar Presente
                </button>
              )}
            </div>
          </section>

          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-3 text-white">
            <div className="grid grid-cols-5 gap-2">
              <button
                onClick={() => {
                  const next = !showReport;
                  setShowReport(next);
                  if (next) {
                    setShowLicense(false);
                    setShowSwap(false);
                    setShowCompletedPanel(false);
                    setShowPresentHistory(false);
                  }
                }}
                className={`h-12 w-full rounded-xl text-[10px] font-black uppercase flex items-center justify-center ${
                  showReport ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
                title="Reportar ausencia o novedad"
              >
                <AlertTriangle size={18} />
              </button>
              <button
                onClick={() => {
                  const next = !showLicense;
                  setShowLicense(next);
                  if (next) {
                    setShowReport(false);
                    setShowSwap(false);
                    setShowCompletedPanel(false);
                    setShowPresentHistory(false);
                  }
                }}
                className={`h-12 w-full rounded-xl text-[10px] font-black uppercase flex items-center justify-center ${
                  showLicense ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
                title="Solicitar licencia"
              >
                <FileText size={18} />
              </button>
              <button
                onClick={() => {
                  const next = !showSwap;
                  setShowSwap(next);
                  if (next) {
                    setShowReport(false);
                    setShowLicense(false);
                    setShowCompletedPanel(false);
                    setShowPresentHistory(false);
                  }
                }}
                className={`h-12 w-full rounded-xl text-[10px] font-black uppercase flex items-center justify-center ${
                  showSwap ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
                title="Intercambio de turno o franco"
              >
                <ArrowLeftRight size={18} />
              </button>
              <button
                onClick={() => {
                  const next = !showCompletedPanel;
                  setShowCompletedPanel(next);
                  if (next) {
                    setShowReport(false);
                    setShowLicense(false);
                    setShowSwap(false);
                    setShowPresentHistory(false);
                  }
                }}
                className={`h-12 w-full rounded-xl text-[10px] font-black uppercase flex items-center justify-center ${
                  showCompletedPanel ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
                title="Turnos realizados"
              >
                <Calendar size={18} />
              </button>
              <button
                onClick={() => {
                  const next = !showPresentHistory;
                  setShowPresentHistory(next);
                  if (next) {
                    setShowReport(false);
                    setShowLicense(false);
                    setShowSwap(false);
                    setShowCompletedPanel(false);
                  }
                }}
                className={`h-12 w-full rounded-xl text-[10px] font-black uppercase flex items-center justify-center ${
                  showPresentHistory ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                }`}
                title="Historial de presentes"
              >
                <CheckCircle size={18} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-4 text-white">
              <div className="flex items-center gap-3">
                <Calendar className="text-indigo-300" />
                <h2 className="font-black uppercase text-sm flex-1">Cronograma</h2>
                <button
                  onClick={() => setShowSchedule((v) => !v)}
                  className="text-xs font-black uppercase text-indigo-300"
                >
                  {showSchedule ? 'Ocultar' : 'Abrir'}
                </button>
              </div>
              {showSchedule && (
                <>
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <button
                      onClick={refreshLocation}
                      className="px-3 py-2 rounded-lg text-[10px] font-black uppercase bg-slate-800 text-slate-200"
                    >
                      Actualizar ubicación
                    </button>
                    <span className="text-[10px] text-slate-400">
                      {locationUpdatedAt ? `GPS ${locationUpdatedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : 'GPS sin actualizar'}
                    </span>
                    {pendingCheckins > 0 && (
                      <span className="text-[10px] font-bold text-amber-400">
                        {pendingCheckins} presente(s) pendiente(s)
                      </span>
                    )}
                    {locationError && <span className="text-[10px] font-bold text-rose-500">{locationError}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    {(['HOY', 'SEMANA', 'MES'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setScheduleView(opt)}
                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase ${
                          scheduleView === opt ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {opt === 'HOY' ? 'Hoy' : opt === 'SEMANA' ? 'Semana' : 'Mes'}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowUpcomingTable((v) => !v)}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase ${
                        showUpcomingTable ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="text-sky-300">L</span>
                    </button>
                  </div>
                  {loadingShifts ? (
                    <div className="text-sm text-slate-400 mt-4">Cargando turnos...</div>
                  ) : upcomingShifts.length === 0 ? (
                    <div className="text-sm text-slate-400 mt-4">No hay turnos en este período.</div>
                  ) : showUpcomingTable ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-[10px] text-slate-300 border-collapse whitespace-nowrap">
                        <thead>
                          <tr className="text-[9px] uppercase text-slate-400 border-b border-slate-800">
                            <th className="py-1 pr-1 text-left">Fec</th>
                            <th className="py-1 pr-1 text-left">Hor</th>
                            <th className="py-1 pr-1 text-left">Obj</th>
                            <th className="py-1 pr-1 text-left">TR</th>
                            <th className="py-1 pr-1 text-left">Est</th>
                          </tr>
                        </thead>
                        <tbody>
                          {upcomingShifts.map((shift) => {
                            const rawStatus = shift.status || (shift.isPresent ? 'PRESENT' : 'ASSIGNED');
                            const endDate = toDate(shift.endTime);
                            const shouldFinalize = (shift.isCompleted || rawStatus === 'COMPLETED' || rawStatus === 'Completed') || (endDate && endDate < now);
                            const objectiveData = shift.objectiveId ? objectivesMap[shift.objectiveId] : null;
                            const objectiveLabel = shift.isFranco
                              ? 'Franco'
                              : (objectiveData?.name || shift.objectiveName || shift.clientName || 'Objetivo');
                            const isAbsent = shift.isAbsent || rawStatus === 'ABSENT' || rawStatus === 'AUSENTE';
                            const statusLetter = isAbsent ? 'A' : shouldFinalize ? 'F' : (shift.isPresent ? 'P' : 'S');
                            const plannedDuration = formatDurationRange(shift.startTime, shift.endTime);
                            return (
                              <tr key={shift.id} className="border-b border-slate-900/60">
                                <td className="py-1 pr-1">{formatDate(shift.startTime)}</td>
                                <td className="py-1 pr-1">
                                  {shift.isFranco
                                    ? 'Franco'
                                    : `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`}
                                </td>
                                <td className="py-1 pr-1 truncate max-w-[100px]">{objectiveLabel}</td>
                                <td className="py-1 pr-1">{plannedDuration}</td>
                                <td className="py-1 pr-1">{statusLetter}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="space-y-3 mt-4">
                      {upcomingShifts.map((shift) => {
                        const rawStatus = shift.status || (shift.isPresent ? 'PRESENT' : 'ASSIGNED');
                        const endDate = toDate(shift.endTime);
                        const shouldFinalize = (shift.isCompleted || rawStatus === 'COMPLETED' || rawStatus === 'Completed') || (endDate && endDate < now);
                        const status = shouldFinalize ? 'FINALIZADO' : rawStatus;
                        const isConfirmedPresent = shift.isPresent || status === 'PRESENT' || status === 'InProgress';
                        const hasPendingRequest = !!shift.checkInRequestedAt && !isConfirmedPresent;
                        const isApprovedRequest = (shift.checkInRequestStatus === 'APPROVED' || shouldFinalize) && !hasPendingRequest;
                        const isFranco = !!shift.isFranco;
                        const objectiveLabel = isFranco ? 'Franco' : (shift.objectiveName || shift.clientName || 'Objetivo');
                        const objectiveData = shift.objectiveId ? objectivesMap[shift.objectiveId] : null;
                        const distanceKm =
                          location && objectiveData
                            ? haversineKm(location.lat, location.lng, objectiveData.lat, objectiveData.lng)
                            : null;
                        const checkInBase = shift.checkInTime || shift.startTime;
                        const elapsed = checkInBase ? now.getTime() - (toDate(checkInBase)?.getTime() || now.getTime()) : 0;
                        const start = toDate(shift.startTime);
                        const diffMinutes = start ? (start.getTime() - now.getTime()) / 60000 : 999;
                        const timeOk = diffMinutes <= 15 && diffMinutes >= -5;
                        const distanceOk = distanceKm !== null && distanceKm <= 0.08;
                        const canRequest = !isFranco && timeOk && distanceOk && !hasPendingRequest && !isConfirmedPresent;
                        const showDetails = !!expandedShiftIds[shift.id];
                        return (
                          <div
                            key={shift.id}
                            className={`border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${
                              isFranco ? 'bg-emerald-900/30' : 'bg-slate-950/50'
                            }`}
                          >
                            <div>
                              <div className={`text-xs font-black uppercase ${isFranco ? 'text-emerald-300' : 'text-slate-400'}`}>{objectiveLabel}</div>
                              <div className={`text-sm font-bold ${isFranco ? 'text-emerald-200' : 'text-white'}`}>
                                {isFranco
                                  ? 'Franco asignado'
                                  : `${formatDate(shift.startTime)} · ${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`}
                              </div>
                              {!isFranco && <div className="text-xs text-slate-400">Estado: {status}</div>}
                              <button
                                onClick={() =>
                                  setExpandedShiftIds((prev) => ({ ...prev, [shift.id]: !prev[shift.id] }))
                                }
                                className={`text-[10px] font-black uppercase mt-1 ${isFranco ? 'text-emerald-300' : 'text-indigo-300'}`}
                              >
                                {showDetails ? 'Ver menos' : 'Ver más'}
                              </button>
                              {showDetails && (
                                <div className="mt-2 space-y-1">
                                  <div className="text-[11px] text-slate-400">
                                    Cliente: {objectiveData?.clientName || shift.clientName || '-'}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    Puesto: {shift.positionName || '-'}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    Dirección: {objectiveData?.address || '-'}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    Distancia al objetivo: {formatDistance(distanceKm)}
                                  </div>
                                </div>
                              )}
                              {isConfirmedPresent && (
                                <div className="text-xs font-bold text-emerald-600 mt-1">Tiempo en servicio: {formatDuration(elapsed)}</div>
                              )}
                              {hasPendingRequest && (
                                <div className="text-[10px] font-bold text-amber-600 mt-1">Solicitud de presente enviada</div>
                              )}
                              {isApprovedRequest && (
                                <div className="text-[10px] font-bold text-emerald-600 mt-1">Solicitud de presente aceptada</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {isConfirmedPresent ? (
                                <span className="px-3 py-2 text-xs font-black uppercase rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center gap-1">
                                  <CheckCircle size={14} /> Presente
                                </span>
                              ) : isFranco ? null : (
                                <button
                                  onClick={() => handleCheckIn(shift)}
                                  disabled={checkingShiftId === shift.id || !canRequest}
                                  className={`px-4 py-2 text-xs font-black uppercase rounded-lg flex items-center gap-2 ${
                                    checkingShiftId === shift.id || !canRequest
                                      ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                  }`}
                                >
                                  <Navigation size={14} />
                                  {checkingShiftId === shift.id ? 'Validando...' : hasPendingRequest ? 'Solicitado' : 'Dar Presente'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="bg-emerald-950/30 border border-emerald-800/40 rounded-2xl p-6 space-y-4 text-white">
              <div className="flex items-center gap-3">
                <MapPin className="text-emerald-300" />
                <h2 className="font-black uppercase text-sm">Próximo Presente</h2>
              </div>
              {nextShift ? (
                <div className="space-y-2">
                  <p className="text-sm font-bold text-white">{nextShiftObjective?.name || nextShift.objectiveName || 'Objetivo'}</p>
                  <p className="text-xs text-slate-400">Cliente: {nextShiftObjective?.clientName || nextShift.clientName || '-'}</p>
                  <p className="text-xs text-slate-400">Puesto: {nextShift.positionName || '-'}</p>
                  <p className="text-xs text-slate-400">
                    {formatDate(nextShift.startTime)} · {formatTime(nextShift.startTime)} - {formatTime(nextShift.endTime)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-400">No hay turnos próximos.</p>
              )}
            </section>

            <section className={`bg-slate-900/70 border border-slate-800 rounded-2xl space-y-4 text-white ${showCompletedPanel ? 'p-6' : 'p-3'}`}>
              <div className="hidden" />
              {showCompletedPanel && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {(['HOY', 'SEMANA', 'MES'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setCompletedView(opt)}
                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase ${
                          completedView === opt ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {opt === 'HOY' ? 'Hoy' : opt === 'SEMANA' ? 'Semana' : 'Mes'}
                      </button>
                    ))}
                  </div>
                  {completedShifts.length === 0 ? (
                    <p className="text-xs text-slate-400">No hay turnos realizados en este período.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px] text-slate-300 border-collapse whitespace-nowrap">
                        <thead>
                          <tr className="text-[9px] uppercase text-slate-400 border-b border-slate-800">
                            <th className="py-1 pr-1 text-left">Fec</th>
                            <th className="py-1 pr-1 text-left">Hor</th>
                            <th className="py-1 pr-1 text-left">Obj</th>
                            <th className="py-1 pr-1 text-left">TR</th>
                            <th className="py-1 pr-1 text-left">Est</th>
                          </tr>
                        </thead>
                        <tbody>
                          {completedShifts.map((shift) => {
                            const rawStatus = shift.status || (shift.isPresent ? 'PRESENT' : 'ASSIGNED');
                            const endDate = toDate(shift.endTime);
                            const shouldFinalize = (shift.isCompleted || rawStatus === 'COMPLETED' || rawStatus === 'Completed') || (endDate && endDate < now);
                            const objectiveData = shift.objectiveId ? objectivesMap[shift.objectiveId] : null;
                            const objectiveLabel = shift.isFranco
                              ? 'Franco'
                              : (objectiveData?.name || shift.objectiveName || shift.clientName || 'Objetivo');
                            const realStart = shift.checkInTime || shift.startTime;
                            const realDuration = shift.isFranco ? '-' : formatDurationRange(realStart, shift.endTime);
                            const isAbsent = shift.isAbsent || rawStatus === 'ABSENT' || rawStatus === 'AUSENTE';
                            const statusLetter = isAbsent ? 'A' : shouldFinalize ? 'F' : (shift.isPresent ? 'P' : 'S');
                            return (
                              <tr key={shift.id} className="border-b border-slate-900/60">
                                <td className="py-1 pr-1">{formatDate(shift.startTime)}</td>
                                <td className="py-1 pr-1">
                                  {shift.isFranco
                                    ? 'Franco'
                                    : `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`}
                                </td>
                                <td className="py-1 pr-1 truncate max-w-[100px]">{objectiveLabel}</td>
                                <td className="py-1 pr-1">{realDuration}</td>
                                <td className="py-1 pr-1">{statusLetter}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              {!showCompletedPanel && (
                <div className="text-[10px] text-slate-500 text-center py-3">
                  CRONO APP | BACAR SA. 2026
                </div>
              )}
            </section>
          </div>

          {showSwap && (
            <div className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-4xl">
                <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 text-white">
                  <div className="flex items-center gap-3">
                    <ArrowLeftRight className="text-sky-300" />
                    <h2 className="font-black uppercase text-sm flex-1">Intercambio de turno o franco</h2>
                    <button onClick={() => setShowSwap(false)} className="text-slate-300 hover:text-white">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                <p className="text-[11px] text-slate-400">
                  Dentro del mes en curso. Compatibles por grupo: 8 hs, 12 hs o franco.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Mi turno/franco</label>
                    <select
                      className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white"
                      value={swapShiftId}
                      onChange={(e) => {
                        setSwapShiftId(e.target.value);
                        setSwapCandidates([]);
                        setSwapTargetShiftId('');
                        setSwapSearched(false);
                        setSwapSearch('');
                        setSwapPersonKey('');
                      }}
                    >
                      <option value="">Seleccionar</option>
                      {shifts
                        .filter((s) => {
                          const d = toDate(s.startTime);
                          if (!d) return false;
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          const minDate = new Date(today);
                          minDate.setDate(minDate.getDate() + 1);
                          return d >= minDate && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
                        })
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {formatSwapOption(s)}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400">Compañero</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      value={swapSearch}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSwapSearch(value);
                        const match = swapPeople.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
                        if (match) {
                          setSwapPersonKey(match.key);
                          setSwapTargetShiftId('');
                        } else if (swapPersonKey) {
                          setSwapPersonKey('');
                          setSwapTargetShiftId('');
                        }
                      }}
                      placeholder="Buscar compañero..."
                      list="swap-people-list"
                      className="w-full pl-9 pr-3 py-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white placeholder:text-slate-600"
                    />
                    <datalist id="swap-people-list">
                      {filteredSwapPeople.map((p) => (
                        <option key={p.key} value={p.name} />
                      ))}
                    </datalist>
                  </div>
                  {swapSearched && swapPeople.length === 0 && (
                    <p className="text-[11px] text-slate-500">No hay compañeros compatibles para este turno.</p>
                  )}
                  {swapSearched && swapPeople.length > 0 && filteredSwapPeople.length === 0 && (
                    <p className="text-[11px] text-slate-500">Sin resultados para la búsqueda.</p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400">Turno del compañero</label>
                  <select
                    className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white"
                    value={swapTargetShiftId}
                    onChange={(e) => setSwapTargetShiftId(e.target.value)}
                    disabled={!swapPersonKey}
                  >
                    <option value="">Seleccionar turno</option>
                    {swapCandidateShifts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatSwapOption(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleCreateSwap}
                  disabled={!swapShiftId || !swapTargetShiftId || swapBusy}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  Enviar solicitud
                </button>

                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase text-slate-400">Solicitudes</div>
                  {swapRequests.filter((r: any) => !['CANCELLED', 'REJECTED', 'CANCELADO', 'RECHAZADO'].includes((r.status || '').toString().toUpperCase())).length === 0 ? (
                    <p className="text-xs text-slate-500">Sin solicitudes recientes.</p>
                  ) : (
                    swapRequests
                      .filter((r: any) => !['CANCELLED', 'REJECTED', 'CANCELADO', 'RECHAZADO'].includes((r.status || '').toString().toUpperCase()))
                      .map((r: any) => {
                      const isTarget = r.targetUid === user?.uid;
                      const isRequester = r.requesterUid === user?.uid;
                      const status = (r.status || '').toString();
                      const requesterDetails = getSwapRequestDetails(r, 'requester');
                      const targetDetails = getSwapRequestDetails(r, 'target');
                      const targetLabel = isTarget ? 'Tu turno' : 'Propone';
                      const statusUpper = status.toUpperCase();
                      return (
                        <div key={r.id} className="border border-slate-800 rounded-xl p-3 text-xs">
                          <div className="font-bold text-slate-200">
                            {r.requesterName || 'Empleado'} ↔ {r.targetName || 'Empleado'}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {formatDate(r.requesterShiftDate)} · {r.objectiveName || 'Objetivo'} · {status}
                          </div>
                          <div className="text-[11px] text-slate-300 mt-1">
                            Solicita: Cliente {requesterDetails.client} · Objetivo {requesterDetails.objective} · Puesto {requesterDetails.position}
                          </div>
                          <div className="text-[11px] text-slate-300">
                            {targetLabel}: Cliente {targetDetails.client} · Objetivo {targetDetails.objective} · Puesto {targetDetails.position}
                          </div>
                          {status === 'PENDING_PEER' && isTarget && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleRespondSwap(r.id, true)}
                                disabled={swapBusy}
                                className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
                              >
                                Aceptar
                              </button>
                              <button
                                onClick={() => handleRespondSwap(r.id, false)}
                                disabled={swapBusy}
                                className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
                              >
                                Rechazar
                              </button>
                            </div>
                          )}
                          {status === 'PENDING_REQUESTER' && isRequester && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleConfirmSwap(r.id, true)}
                                disabled={swapBusy}
                                className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
                              >
                                Confirmar
                              </button>
                              <button
                                onClick={() => handleConfirmSwap(r.id, false)}
                                disabled={swapBusy}
                                className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                          {isRequester && !['APPROVED', 'REJECTED', 'CANCELLED'].includes(statusUpper) && status !== 'PENDING_REQUESTER' && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleCancelSwap(r.id)}
                                disabled={swapBusy}
                                className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
                              >
                                Cancelar solicitud
                              </button>
                            </div>
                          )}
                          {status === 'PENDING_APPROVAL' && (
                            <div className="text-[10px] text-amber-300 mt-2">Pendiente de autorización</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
                </section>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {showReport && (
              <div className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-3xl">
                  <section id="reportes" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-white">
                    <div className="flex items-center gap-3">
                      <Bell className="text-amber-300" />
                      <h2 className="font-black uppercase text-sm flex-1">Reportar ausencia o novedad</h2>
                      <button onClick={() => setShowReport(false)} className="text-slate-300 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-3 mt-4 max-h-[70vh] overflow-y-auto pr-1">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Tipo</label>
                    <select className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={reportType} onChange={(e) => setReportType(e.target.value as any)}>
                      <option value="AUSENCIA">Ausencia</option>
                      <option value="NOVEDAD">Novedad</option>
                      <option value="BAJA_ANTICIPADA">Baja anticipada</option>
                    </select>
                  </div>
                  {reportType !== 'AUSENCIA' && (
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-400">Turno (opcional)</label>
                      <select className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={reportShiftId} onChange={(e) => setReportShiftId(e.target.value)}>
                        <option value="">Sin turno</option>
                        {shifts.map((s) => (
                          <option key={s.id} value={s.id}>
                            {formatDate(s.startTime)} · {formatTime(s.startTime)} · {s.objectiveName || 'Objetivo'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {reportType === 'AUSENCIA' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-400">Desde</label>
                        <input type="date" className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={absenceStart} onChange={(e) => setAbsenceStart(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-slate-400">Hasta</label>
                        <input type="date" className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={absenceEnd} onChange={(e) => setAbsenceEnd(e.target.value)} />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Motivo</label>
                    <textarea className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm h-24 bg-slate-950 text-white" value={reportReason} onChange={(e) => setReportReason(e.target.value)} />
                  </div>
                  <button onClick={handleSubmitReport} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2">
                    <AlertTriangle size={16} /> Enviar reporte
                  </button>
                </div>
                  </section>
                </div>
              </div>
            )}

            {showLicense && (
              <div className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="w-full max-w-3xl">
                  <section id="licencias" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-white">
                    <div className="flex items-center gap-3">
                      <FileText className="text-rose-300" />
                      <h2 className="font-black uppercase text-sm flex-1">Solicitar licencia</h2>
                      <button onClick={() => setShowLicense(false)} className="text-slate-300 hover:text-white">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-3 mt-4 max-h-[70vh] overflow-y-auto pr-1">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400">Tipo</label>
                  <select className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={licenseType} onChange={(e) => setLicenseType(e.target.value as any)}>
                    <option value="OTHER">Licencia</option>
                    <option value="SICK_LEAVE">Licencia médica</option>
                    <option value="VACATION">Vacaciones</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Desde</label>
                    <input type="date" className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={licenseStart} onChange={(e) => setLicenseStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Hasta</label>
                    <input type="date" className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white" value={licenseEnd} onChange={(e) => setLicenseEnd(e.target.value)} />
                  </div>
                </div>
                {licenseType === 'SICK_LEAVE' && (
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">Certificado médico (PDF/JPG/PNG)</label>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => setLicenseFile(e.target.files?.[0] || null)}
                      className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm bg-slate-950 text-white"
                    />
                    {licenseFile && (
                      <p className="text-[10px] text-slate-400 mt-1">{licenseFile.name}</p>
                    )}
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400">Motivo</label>
                  <textarea className="w-full p-3 border border-slate-800 rounded-xl font-bold text-sm h-24 bg-slate-950 text-white" value={licenseReason} onChange={(e) => setLicenseReason(e.target.value)} />
                </div>
                <button onClick={handleSubmitLicense} disabled={licenseUploading} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 disabled:opacity-50">
                  <FileText size={16} /> {licenseUploading ? 'Subiendo...' : 'Solicitar licencia'}
                </button>
              </div>
                  </section>
                </div>
              </div>
            )}
          </div>

          {showPresentHistory && (
            <div className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-4xl">
                <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 text-white">
                  <div className="flex items-center gap-3">
                    <Calendar className="text-indigo-300" />
                    <h2 className="font-black uppercase text-sm flex-1">Historial de presentes</h2>
                    <button onClick={() => setShowPresentHistory(false)} className="text-slate-300 hover:text-white">
                      <X size={16} />
                    </button>
                  </div>
                  {presentHistory.length === 0 ? (
                    <p className="text-xs text-slate-400 mt-3">Sin presentes registrados este mes.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto max-h-[70vh]">
                      <table className="w-full text-[10px] text-slate-300 border-collapse whitespace-nowrap">
                        <thead>
                          <tr className="text-[9px] uppercase text-slate-400 border-b border-slate-800">
                            <th className="py-1 pr-1 text-left">Fec</th>
                            <th className="py-1 pr-1 text-left">Obj</th>
                            <th className="py-1 pr-1 text-left">Ing</th>
                            <th className="py-1 pr-1 text-left">Sal</th>
                            <th className="py-1 pr-1 text-left">TR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {presentHistory.map((shift) => {
                            const objectiveData = shift.objectiveId ? objectivesMap[shift.objectiveId] : null;
                            const objectiveLabel = objectiveData?.name || shift.objectiveName || shift.clientName || 'Objetivo';
                            const realStart = shift.checkInTime || shift.startTime;
                            const realDuration = formatDurationRange(realStart, shift.endTime);
                            return (
                              <tr key={shift.id} className="border-b border-slate-900/60">
                                <td className="py-1 pr-1">{formatDate(shift.startTime)}</td>
                                <td className="py-1 pr-1 truncate max-w-[100px]">{objectiveLabel}</td>
                                <td className="py-1 pr-1">{formatTime(realStart)}</td>
                                <td className="py-1 pr-1">{formatTime(shift.endTime)}</td>
                                <td className="py-1 pr-1">{realDuration}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
