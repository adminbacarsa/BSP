import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { useSetPageHeader } from '@/context/PageHeaderContext';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, query, where, onSnapshot, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';
import {
  Building2,
  Camera,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit2,
  HelpCircle,
  Layers,
  MapPin,
  Plus,
  Search,
  Siren,
  Trash2,
  X,
} from 'lucide-react';

type ClientDoc = { id: string; name?: string; fantasyName?: string; objetivos?: any[] };
type ObjectiveFlat = { id: string; name: string; clientId: string; clientName: string };
/** Dispositivo NVR: número de serie, cliente, objetivo, canales, retención, activación, horario y conexión para vivo */
type NvrDevice = {
  id: string;
  serial_number?: string;
  client_id?: string | null;
  objective_id?: string | null;
  channel_count?: number;
  name?: string;
  alert_retention_days?: number | null;
  enabled?: boolean;
  schedule_enabled?: boolean;
  schedule_days?: number[];
  schedule_time_start?: string;
  schedule_time_end?: string;
  schedule_timezone?: string;
  created_from_alert?: boolean;
  first_seen_at?: any;
  updated_at?: any;
  /** IP del NVR para video en vivo (ej. 192.168.0.102) */
  stream_ip?: string | null;
  /** Puerto HTTP/WebSocket (por defecto 80) */
  stream_port?: number | string | null;
  /** Usuario para conectar al NVR */
  stream_user?: string | null;
  /** Contraseña (se guarda en Firestore; solo para uso interno "Ver en vivo") */
  stream_password?: string | null;
};
type CameraRoute = {
  id: string;
  camera_name?: string;
  enabled?: boolean;
  objective_id?: string | null;
  post_id?: string | null;
  event_type?: string;
  created_from_alert?: boolean;
  first_seen_at?: any;
  schedule_enabled?: boolean;
  schedule_days?: number[];
  schedule_time_start?: string;
  schedule_time_end?: string;
  schedule_timezone?: string;
  alert_group_id?: string | null;
  /** Posición o clasificación del canal (ej. Entrada, Perimetral, Hall) */
  position?: string | null;
  nvr_serial?: string | null;
};

const DAYS_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sab'];

function formatScheduleSummary(r: CameraRoute): string {
  if (!r.schedule_enabled) return '24 hs';
  const parts: string[] = [];
  if (Array.isArray(r.schedule_days) && r.schedule_days.length > 0) {
    if (r.schedule_days.length === 7) parts.push('Todos los días');
    else if (r.schedule_days.length === 2 && r.schedule_days.includes(0) && r.schedule_days.includes(6)) parts.push('Sáb y Dom');
    else parts.push(r.schedule_days.map((d) => DAYS_LABELS[d]).join(', '));
  }
  if (r.schedule_time_start || r.schedule_time_end) {
    parts.push(`${r.schedule_time_start || '00:00'} - ${r.schedule_time_end || '24:00'}`);
  }
  return parts.length ? parts.join(' · ') : '24 hs';
}

function CameraRoutesPage() {
  const setPageHeader = useSetPageHeader();
  const [routes, setRoutes] = useState<CameraRoute[]>([]);
  const [nvrDevices, setNvrDevices] = useState<NvrDevice[]>([]);
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveFlat[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAddNvrForm, setShowAddNvrForm] = useState(false);
  const [newNvrId, setNewNvrId] = useState('default');
  const [newChannel, setNewChannel] = useState('1');
  const [creating, setCreating] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [tableGroupBy, setTableGroupBy] = useState<'byNvr' | 'byObjective' | 'flat'>('byNvr');
  const [expandedObjectiveKey, setExpandedObjectiveKey] = useState<string | null>(null);
  /** En vista por objetivo: NVR expandido para ver canales (formato "objectiveKey__nvrId") */
  const [expandedNvrUnderObjective, setExpandedNvrUnderObjective] = useState<string | null>(null);
  const [filterClientId, setFilterClientId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedNvrId, setSelectedNvrId] = useState<string | null>(null);
  const [nvrForm, setNvrForm] = useState({
    clientId: '',
    objective_id: '',
    channel_count: '16',
    alert_retention_days: '30',
    enabled: true,
    schedule_enabled: false,
    schedule_days: [] as number[],
    schedule_time_start: '',
    schedule_time_end: '',
    schedule_timezone: 'America/Argentina/Buenos_Aires',
    stream_ip: '',
    stream_port: '80',
    stream_user: 'admin',
    stream_password: '',
  });
  const [nvrSaving, setNvrSaving] = useState(false);
  /** Número de canal para "Agregar canal" dentro del modal NVR */
  const [newChannelForNvr, setNewChannelForNvr] = useState('1');
  const [form, setForm] = useState({
    camera_name: '',
    enabled: true,
    clientId: '',
    objective_id: '',
    post_id: '',
    event_type: 'Tripwire',
    schedule_enabled: false,
    schedule_days: [] as number[],
    schedule_time_start: '',
    schedule_time_end: '',
    schedule_timezone: 'America/Argentina/Buenos_Aires',
    alert_group_id: '',
    position: '',
  });
  const [addNvrForm, setAddNvrForm] = useState({
    serial_number: '',
    channel_count: '16',
    clientId: '',
    objective_id: '',
    alert_retention_days: '30',
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'camera_routes'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CameraRoute));
      list.sort((a, b) => {
        const ta = a.first_seen_at?.seconds ?? 0;
        const tb = b.first_seen_at?.seconds ?? 0;
        return tb - ta;
      });
      setRoutes(list);
    }, (err) => {
      console.error('camera_routes', err);
      toast.error('Error al cargar rutas de cámara');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'nvr_devices'), (snap) => {
      setNvrDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as NvrDevice)));
    }, (err) => {
      console.error('nvr_devices', err);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    getDocs(collection(db, 'clients')).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc));
      setClients(list);
      const objs: ObjectiveFlat[] = [];
      list.forEach((c) => {
        const name = c.name || c.fantasyName || c.id;
        (c.objetivos || []).forEach((o: any) => {
          objs.push({
            id: o.id || o.name || '',
            name: o.name || o.id || 'Objetivo',
            clientId: c.id,
            clientName: name,
          });
        });
      });
      setObjectives(objs);
    });
  }, []);

  const objectivesByClient = useMemo(
    () => (form.clientId ? objectives.filter((o) => o.clientId === form.clientId) : objectives),
    [objectives, form.clientId]
  );

  const openEdit = (r: CameraRoute) => {
    const obj = objectives.find((o) => o.id === r.objective_id || o.name === r.objective_id);
    setForm({
      camera_name: r.camera_name || '',
      enabled: r.enabled !== false,
      clientId: obj?.clientId || '',
      objective_id: r.objective_id || '',
      post_id: r.post_id || '',
      event_type: r.event_type || 'Tripwire',
      schedule_enabled: !!r.schedule_enabled,
      schedule_days: Array.isArray(r.schedule_days) ? [...r.schedule_days] : [],
      schedule_time_start: r.schedule_time_start || '',
      schedule_time_end: r.schedule_time_end || '',
      schedule_timezone: r.schedule_timezone || 'America/Argentina/Buenos_Aires',
      alert_group_id: (r as any).alert_group_id ?? '',
      position: (r as any).position ?? '',
    });
    setEditingId(r.id);
  };

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      schedule_days: prev.schedule_days.includes(day)
        ? prev.schedule_days.filter((d) => d !== day)
        : [...prev.schedule_days, day].sort((a, b) => a - b),
    }));
  };

  const handleSave = async () => {
    if (!editingId) return;
    try {
      await updateDoc(doc(db, 'camera_routes', editingId), {
        camera_name: (form.camera_name ?? '').trim() || null,
        enabled: form.enabled,
        objective_id: form.objective_id || null,
        post_id: form.post_id.trim() || null,
        event_type: form.event_type.trim() || 'Tripwire',
        schedule_enabled: form.schedule_enabled,
        schedule_days: form.schedule_days,
        schedule_time_start: form.schedule_time_start.trim() || null,
        schedule_time_end: form.schedule_time_end.trim() || null,
        schedule_timezone: form.schedule_timezone.trim() || 'America/Argentina/Buenos_Aires',
        alert_group_id: (form.alert_group_id ?? '').trim() || null,
        position: (form.position ?? '').trim() || null,
      });
      toast.success('Canal guardado');
      setEditingId(null);
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar');
    }
  };

  const handleDeleteRoute = async (routeId: string) => {
    if (!confirm('¿Eliminar esta cámara/ruta? Dejará de recibir alertas y tendrás que volver a configurarla si la agregás de nuevo.')) return;
    try {
      await deleteDoc(doc(db, 'camera_routes', routeId));
      toast.success('Ruta eliminada');
      setEditingId(null);
    } catch (e) {
      console.error(e);
      toast.error('Error al eliminar');
    }
  };

  const getClientName = (objectiveId: string | null | undefined) => {
    if (!objectiveId) return '—';
    const o = objectives.find((ob) => ob.id === objectiveId || ob.name === objectiveId);
    return o?.clientName ?? '—';
  };
  const getObjectiveName = (objectiveId: string | null | undefined) => {
    if (!objectiveId) return '—';
    const o = objectives.find((ob) => ob.id === objectiveId || ob.name === objectiveId);
    return o?.name ?? objectiveId;
  };

  const getNvrId = (r: CameraRoute) => (r.id && r.id.includes('__') ? r.id.split('__')[0] : r.id || '—');
  const getChannelFromId = (r: CameraRoute) => (r.id && r.id.includes('__') ? r.id.split('__')[1] : '—');

  const filteredRoutes = useMemo(() => {
    let list = routes;
    if (filterClientId) {
      list = list.filter((r) => {
        const o = objectives.find((ob) => ob.id === r.objective_id || ob.name === r.objective_id);
        return o && o.clientId === filterClientId;
      });
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.camera_name || '').toLowerCase().includes(q) ||
          (r.id || '').toLowerCase().includes(q) ||
          getObjectiveName(r.objective_id).toLowerCase().includes(q) ||
          getClientName(r.objective_id).toLowerCase().includes(q)
      );
    }
    return list;
  }, [routes, filterClientId, searchText, objectives]);

  const groupedByNvr = useMemo(() => {
    const map: Record<string, CameraRoute[]> = {};
    filteredRoutes.forEach((r) => {
      const nvrId = getNvrId(r) || 'sin-nvr';
      if (!map[nvrId]) map[nvrId] = [];
      map[nvrId].push(r);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRoutes]);

  /** Lista de NVRs para tarjetas: nvr_devices + NVRs que solo aparecen en rutas (ej. default) */
  const nvrListForCards = useMemo(() => {
    const ids = new Set<string>();
    nvrDevices.forEach((n) => ids.add(n.id));
    routes.forEach((r) => ids.add(getNvrId(r) || 'default'));
    return Array.from(ids)
      .filter((id) => {
        const device = nvrDevices.find((n) => n.id === id);
        const routesOfNvr = routes.filter((r) => getNvrId(r) === id);
        const objId = device?.objective_id ?? routesOfNvr[0]?.objective_id;
        const obj = objectives.find((o) => o.id === objId || o.name === objId);
        const clientIdForNvr = device?.client_id ?? obj?.clientId;
        if (filterClientId && clientIdForNvr !== filterClientId) return false;
        if (searchText.trim()) {
          const q = searchText.trim().toLowerCase();
          const clientName = device?.client_id ? (clients.find((c) => c.id === device.client_id)?.name || clients.find((c) => c.id === device.client_id)?.fantasyName || '') : (obj ? (clients.find((c) => c.id === obj.clientId)?.name || '') : '');
          const objName = device?.objective_id ? getObjectiveName(device.objective_id) : getObjectiveName(routesOfNvr[0]?.objective_id);
          return id.toLowerCase().includes(q) || (clientName || '').toLowerCase().includes(q) || (objName || '').toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => a.localeCompare(b))
      .map((nvrId) => {
        const device = nvrDevices.find((n) => n.id === nvrId);
        const nvrRoutes = routes.filter((r) => getNvrId(r) === nvrId);
        const clientName = device?.client_id ? (clients.find((c) => c.id === device.client_id)?.name || clients.find((c) => c.id === device.client_id)?.fantasyName) : getClientName(nvrRoutes[0]?.objective_id);
        const objectiveName = device?.objective_id ? getObjectiveName(device.objective_id) : getObjectiveName(nvrRoutes[0]?.objective_id);
        return { nvrId, device, routes: nvrRoutes, clientName: clientName || '—', objectiveName: objectiveName || '—' };
      });
  }, [nvrDevices, routes, filterClientId, searchText, objectives, clients]);

  useEffect(() => {
    if (!selectedNvrId) return;
    const device = nvrDevices.find((n) => n.id === selectedNvrId);
    const nvrRoutes = routes.filter((r) => getNvrId(r) === selectedNvrId);
    const firstRoute = nvrRoutes[0];
    const obj = firstRoute ? objectives.find((o) => o.id === firstRoute.objective_id || o.name === firstRoute.objective_id) : null;
    setNvrForm({
      clientId: device?.client_id ?? obj?.clientId ?? '',
      objective_id: device?.objective_id ?? firstRoute?.objective_id ?? '',
      channel_count: device?.channel_count != null ? String(device.channel_count) : '16',
      alert_retention_days: device?.alert_retention_days != null ? String(device.alert_retention_days) : '30',
      enabled: device?.enabled !== false,
      schedule_enabled: !!device?.schedule_enabled,
      schedule_days: Array.isArray(device?.schedule_days) ? [...device.schedule_days] : [],
      schedule_time_start: device?.schedule_time_start ?? '',
      schedule_time_end: device?.schedule_time_end ?? '',
      schedule_timezone: device?.schedule_timezone ?? 'America/Argentina/Buenos_Aires',
      stream_ip: device?.stream_ip ?? '',
      stream_port: device?.stream_port != null ? String(device.stream_port) : '80',
      stream_user: device?.stream_user ?? 'admin',
      stream_password: device?.stream_password ?? '',
    });
  }, [selectedNvrId, nvrDevices, routes, objectives]);

  useEffect(() => {
    setPageHeader({ title: 'NVR | Servidor' });
    return () => setPageHeader({ title: null });
  }, [setPageHeader]);

  /** Siguiente número de canal sugerido para este NVR (1, 2, 3... sin huecos) */
  const nextChannelForSelectedNvr = useMemo(() => {
    if (!selectedNvrId) return 1;
    const existing = routes.filter((r) => getNvrId(r) === selectedNvrId).map((r) => parseInt(getChannelFromId(r) || '0', 10)).filter(Number.isFinite);
    if (existing.length === 0) return 1;
    const max = Math.max(...existing);
    return max + 1;
  }, [selectedNvrId, routes]);

  useEffect(() => {
    if (selectedNvrId) setNewChannelForNvr(String(nextChannelForSelectedNvr));
  }, [selectedNvrId, nextChannelForSelectedNvr]);

  const toggleDayNvr = (day: number) => {
    setNvrForm((prev) => ({
      ...prev,
      schedule_days: prev.schedule_days.includes(day)
        ? prev.schedule_days.filter((d) => d !== day)
        : [...prev.schedule_days, day].sort((a, b) => a - b),
    }));
  };

  const groupedByObjective = useMemo(() => {
    const map: Record<string, { name: string; routes: CameraRoute[] }> = {};
    filteredRoutes.forEach((r) => {
      const key = r.objective_id || '_sin_asignar';
      const name = r.objective_id ? getObjectiveName(r.objective_id) : 'Sin asignar';
      if (!map[key]) map[key] = { name, routes: [] };
      map[key].routes.push(r);
    });
    return Object.entries(map).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [filteredRoutes, objectives]);

  const buildRouteKey = (nvrId: string, channel: string) => {
    const id = (nvrId || 'default').trim() || 'default';
    const ch = parseInt(String(channel), 10);
    return Number.isFinite(ch) ? `${id}__${ch}` : null;
  };

  const handleCreateRoute = async () => {
    const routeKey = buildRouteKey(newNvrId, newChannel);
    if (!routeKey) {
      toast.error('Canal debe ser un número');
      return;
    }
    if (routes.some((r) => r.id === routeKey)) {
      toast.error('Esa ruta ya existe. Editá la existente.');
      return;
    }
    setCreating(true);
    try {
      await setDoc(
        doc(db, 'camera_routes', routeKey),
        {
          enabled: true,
          camera_name: `Canal ${newChannel}`,
          objective_id: null,
          post_id: null,
          event_type: 'Tripwire',
          created_manually: true,
          first_seen_at: serverTimestamp(),
          nvr_serial: newNvrId.trim() || null,
        },
        { merge: true }
      );
      toast.success(`Canal ${routeKey} creado. Configurá cliente y objetivo en el NVR o por canal.`);
      setShowCreateForm(false);
      setNewNvrId('default');
      setNewChannel('1');
      openEdit({ id: routeKey } as CameraRoute);
    } catch (e) {
      console.error(e);
      toast.error('Error al crear la ruta');
    } finally {
      setCreating(false);
    }
  };

  /** Agregar un canal al NVR abierto en el modal (selectedNvrId) */
  const handleAddChannelToNvr = async () => {
    if (!selectedNvrId) return;
    const routeKey = buildRouteKey(selectedNvrId, newChannelForNvr);
    if (!routeKey) {
      toast.error('Canal debe ser un número');
      return;
    }
    if (routes.some((r) => r.id === routeKey)) {
      toast.error(`El canal ${newChannelForNvr} ya existe en este NVR.`);
      return;
    }
    setNvrSaving(true);
    try {
      await setDoc(
        doc(db, 'camera_routes', routeKey),
        {
          enabled: true,
          camera_name: `Canal ${newChannelForNvr}`,
          client_id: nvrForm.clientId || null,
          objective_id: nvrForm.objective_id || null,
          post_id: null,
          event_type: 'Tripwire',
          created_manually: true,
          first_seen_at: serverTimestamp(),
          nvr_serial: selectedNvrId,
        },
        { merge: true }
      );
      toast.success(`Canal ${routeKey} agregado. Podés editar nombre y horario en la tabla.`);
      const nextCh = parseInt(newChannelForNvr, 10);
      setNewChannelForNvr(Number.isFinite(nextCh) ? String(nextCh + 1) : '1');
    } catch (e) {
      console.error(e);
      toast.error('Error al agregar canal');
    } finally {
      setNvrSaving(false);
    }
  };

  const handleAddNvr = async () => {
    const serial = (addNvrForm.serial_number || '').trim().replace(/\s+/g, '');
    if (!serial) {
      toast.error('Ingresá el número de serie del NVR');
      return;
    }
    const chCount = parseInt(addNvrForm.channel_count, 10);
    if (!Number.isFinite(chCount) || chCount < 1 || chCount > 64) {
      toast.error('Cantidad de canales debe ser entre 1 y 64');
      return;
    }
    if (nvrDevices.some((n) => n.id === serial)) {
      toast.error('Ya existe un NVR con ese número de serie. Agregá canales con "Crear canal" si hace falta.');
      return;
    }
    setCreating(true);
    try {
      const retentionDays = Math.max(1, Math.min(365, parseInt(addNvrForm.alert_retention_days, 10) || 30));
      await setDoc(doc(db, 'nvr_devices', serial), {
        serial_number: serial,
        channel_count: chCount,
        client_id: addNvrForm.clientId || null,
        objective_id: addNvrForm.objective_id || null,
        alert_retention_days: retentionDays,
        first_seen_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
      for (let ch = 1; ch <= chCount; ch++) {
        const routeKey = `${serial}__${ch}`;
        await setDoc(doc(db, 'camera_routes', routeKey), {
          enabled: true,
          camera_name: `Canal ${ch}`,
          client_id: addNvrForm.clientId || null,
          objective_id: addNvrForm.objective_id || null,
          post_id: null,
          event_type: 'Tripwire',
          created_manually: true,
          first_seen_at: serverTimestamp(),
          nvr_serial: serial,
        }, { merge: true });
      }
      toast.success(`NVR ${serial} agregado con ${chCount} canales. Hacé clic en la tarjeta para configurar canales.`);
      setShowAddNvrForm(false);
      setAddNvrForm({ serial_number: '', channel_count: '16', clientId: '', objective_id: '', alert_retention_days: '30' });
      setSelectedNvrId(serial);
    } catch (e) {
      console.error(e);
      toast.error('Error al agregar NVR');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveNvrParams = async () => {
    if (!selectedNvrId) return;
    const days = Math.max(1, Math.min(365, parseInt(nvrForm.alert_retention_days, 10) || 30));
    const chCount = Math.max(1, Math.min(64, parseInt(nvrForm.channel_count, 10) || 16));
    const clientId = nvrForm.clientId || null;
    const objectiveId = nvrForm.objective_id || null;
    setNvrSaving(true);
    try {
      await setDoc(
        doc(db, 'nvr_devices', selectedNvrId),
        {
          serial_number: selectedNvrId,
          client_id: clientId,
          objective_id: objectiveId,
          channel_count: chCount,
          alert_retention_days: days,
          enabled: nvrForm.enabled,
          schedule_enabled: nvrForm.schedule_enabled,
          schedule_days: nvrForm.schedule_days,
          schedule_time_start: (nvrForm.schedule_time_start || '').trim() || null,
          schedule_time_end: (nvrForm.schedule_time_end || '').trim() || null,
          schedule_timezone: (nvrForm.schedule_timezone || '').trim() || 'America/Argentina/Buenos_Aires',
          stream_ip: (nvrForm.stream_ip || '').trim() || null,
          stream_port: (nvrForm.stream_port || '').toString().trim() || null,
          stream_user: (nvrForm.stream_user || '').trim() || null,
          stream_password: (nvrForm.stream_password || '').trim() || null,
          updated_at: serverTimestamp(),
        },
        { merge: true }
      );
      // Sincronizar cliente y objetivo a todos los canales de esta NVR (los canales pertenecen a la NVR)
      const routesSnap = await getDocs(query(collection(db, 'camera_routes'), where('nvr_serial', '==', selectedNvrId)));
      for (const d of routesSnap.docs) {
        await updateDoc(d.ref, { client_id: clientId, objective_id: objectiveId });
      }
      if (routesSnap.size > 0) {
        toast.success(`Parámetros del NVR guardados. ${routesSnap.size} canal(es) actualizados con el mismo cliente y objetivo.`);
      } else {
        toast.success('Parámetros del NVR guardados.');
      }
      setNvrForm((f) => ({ ...f, alert_retention_days: String(days), channel_count: String(chCount) }));
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar');
    } finally {
      setNvrSaving(false);
    }
  };

  const handleDeleteNvr = async (nvrIdArg?: string) => {
    const id = nvrIdArg ?? selectedNvrId;
    if (!id) return;
    const nvrRoutes = routes.filter((r) => getNvrId(r) === id);
    if (!confirm(`¿Eliminar el NVR ${id}? Se borrarán el dispositivo y ${nvrRoutes.length} canal(es). Esta acción no se puede deshacer.`)) return;
    setNvrSaving(true);
    try {
      await deleteDoc(doc(db, 'nvr_devices', id));
      for (const r of nvrRoutes) {
        await deleteDoc(doc(db, 'camera_routes', r.id));
      }
      toast.success(`NVR ${id} eliminado.`);
      if (id === selectedNvrId) setSelectedNvrId(null);
      if (editingId && (editingId === id || editingId.startsWith(id + '__'))) setEditingId(null);
    } catch (e) {
      console.error(e);
      toast.error('Error al eliminar');
    } finally {
      setNvrSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>NVR | Servidor · CronoApp</title>
      </Head>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
              <Camera className="text-indigo-600 dark:text-indigo-400" size={28} />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 dark:text-white">NVR | Servidor</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Cada <strong>NVR</strong> tiene cliente y objetivo; al hacer clic en un NVR ves sus canales y la configuración.
              </p>
            </div>
          </div>

          {/* Cómo se detecta / crea la vinculación */}
          <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
              <HelpCircle size={18} className="text-indigo-500" />
              ¿Cómo se agrega una NVR?
            </h3>
            <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-disc list-inside">
              <li>
                <strong>Alta desde agente (recomendado):</strong> Si tenés el <strong>agente</strong> en la PC que monitorea el NVR, usá el script <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">registrar-nvr.ps1</code> (o la API <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">nvrOnboard</code>) con el <strong>token de registro</strong> (Firestore <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">nvr_config/registration</code>), número de serie, IP, cliente y objetivo. La plataforma crea la NVR y todos los canales con ese cliente/objetivo y devuelve un <strong>agent_secret</strong> para el agente. Así las alertas y el &quot;Ver en vivo&quot; (incluso por túnel si el agente está en otra red) quedan asociados a esta NVR. Ver <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">PASO-A-PASO-CONEXION-Y-VIVO.md</code> en el repo.
              </li>
              <li>
                <strong>Agregar NVR (manual):</strong> Usá el botón &quot;Agregar NVR&quot; con el <strong>número de serie</strong>, cantidad de canales, cliente y objetivo. Se crean los canales 1 a N para ese NVR. En la URL del webhook del agente/N8N configurá el mismo <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">nvrId</code> para que las alertas se asocien.
              </li>
              <li>
                <strong>Automático:</strong> Si llega una alerta de un NVR/canal aún no registrado, se crea el canal (id <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">SERIAL__CANAL</code>) y el registro del NVR. Después asigná cliente y objetivo desde acá (clic en la NVR).
              </li>
              <li>
                <strong>Por canal:</strong> En el modal del NVR (clic en la tarjeta o fila) editá cada canal: <strong>nombre de cámara</strong>, <strong>posición</strong>, grupo de alertas y horario. La posición sirve para reportes (ej. Entrada, Perimetral).
              </li>
              <li>
                <strong>Retención:</strong> En cada NVR (clic en la tarjeta o fila) definís cuántos días se guardan las imágenes de las alertas; después se borran y solo queda el informe del evento.
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => { setShowAddNvrForm((v) => !v); setShowCreateForm(false); }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl"
              >
                <Plus size={18} />
                {showAddNvrForm ? 'Ocultar' : 'Agregar NVR'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreateForm((v) => !v); setShowAddNvrForm(false); }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white text-sm font-bold rounded-xl"
              >
                <Plus size={18} />
                {showCreateForm ? 'Ocultar' : 'Crear canal suelto'}
              </button>
            </div>
            {showAddNvrForm && (
              <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Número de serie del NVR</label>
                  <input type="text" value={addNvrForm.serial_number} onChange={(e) => setAddNvrForm((f) => ({ ...f, serial_number: e.target.value }))} placeholder="Ej: 17589859" className="w-40 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-mono text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Cantidad de canales</label>
                  <input type="number" min={1} max={64} value={addNvrForm.channel_count} onChange={(e) => setAddNvrForm((f) => ({ ...f, channel_count: e.target.value }))} className="w-24 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Cliente</label>
                  <select value={addNvrForm.clientId} onChange={(e) => setAddNvrForm((f) => ({ ...f, clientId: e.target.value, objective_id: '' }))} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm">
                    <option value="">Sin asignar</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.fantasyName || c.id}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Objetivo</label>
                  <select value={addNvrForm.objective_id} onChange={(e) => setAddNvrForm((f) => ({ ...f, objective_id: e.target.value }))} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm">
                    <option value="">Sin asignar</option>
                    {(addNvrForm.clientId ? objectives.filter((o) => o.clientId === addNvrForm.clientId) : objectives).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Guardar imágenes (días)</label>
                  <input type="number" min={1} max={365} value={addNvrForm.alert_retention_days} onChange={(e) => setAddNvrForm((f) => ({ ...f, alert_retention_days: e.target.value }))} className="w-20 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                </div>
                <button type="button" onClick={handleAddNvr} disabled={creating || !addNvrForm.serial_number.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm">{creating ? 'Creando…' : 'Crear NVR y canales'}</button>
              </div>
            )}
            {showCreateForm && (
              <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Número de serie del NVR (o &quot;default&quot;)</label>
                  <input
                    type="text"
                    value={newNvrId}
                    onChange={(e) => setNewNvrId(e.target.value)}
                    placeholder="17589859 o default"
                    className="w-40 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Canal (número)</label>
                  <input
                    type="text"
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value)}
                    placeholder="1"
                    className="w-24 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-mono text-sm"
                  />
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400 font-mono">
                  → Ruta: <strong className="text-slate-700 dark:text-slate-200">{buildRouteKey(newNvrId, newChannel) || '—'}</strong>
                </div>
                <button
                  type="button"
                  onClick={handleCreateRoute}
                  disabled={creating || !buildRouteKey(newNvrId, newChannel)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm"
                >
                  {creating ? 'Creando…' : 'Crear ruta'}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Vista:</span>
              <div className="flex rounded-xl bg-slate-100 dark:bg-slate-700/50 p-1 gap-1">
                <button type="button" onClick={() => setViewMode('cards')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors flex items-center gap-1 ${viewMode === 'cards' ? 'bg-white dark:bg-slate-600 shadow text-indigo-600 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-400 hover:text-slate-800'}`} title="Tarjetas por NVR; clic para ver canales"><Layers size={14} /> Tarjetas</button>
                <button type="button" onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${viewMode === 'table' ? 'bg-white dark:bg-slate-600 shadow text-indigo-600 dark:text-indigo-300' : 'text-slate-600 dark:text-slate-400 hover:text-slate-800'}`} title="Tabla; agrupación debajo">Tabla</button>
              </div>
              {viewMode === 'table' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Agrupar por:</span>
                  <div className="flex rounded-lg bg-slate-100 dark:bg-slate-700/50 p-0.5 gap-0.5">
                    <button type="button" onClick={() => setTableGroupBy('byNvr')} className={`px-2 py-1 rounded text-xs font-medium ${tableGroupBy === 'byNvr' ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-700'}`}>NVR</button>
                    <button type="button" onClick={() => setTableGroupBy('byObjective')} className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${tableGroupBy === 'byObjective' ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-700'}`}><MapPin size={12} /> Objetivo</button>
                    <button type="button" onClick={() => setTableGroupBy('flat')} className={`px-2 py-1 rounded text-xs font-medium ${tableGroupBy === 'flat' ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-700'}`}>Lista plana</button>
                  </div>
                </div>
              )}
              <select value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm">
                <option value="">Todos los clientes</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || c.fantasyName || c.id}</option>
                ))}
              </select>
              <div className="relative flex-1 min-w-[180px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Buscar NVR, canal, objetivo..." className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
              </div>
              <span className="text-xs text-slate-500">
                {viewMode === 'cards' && nvrListForCards.length + ' NVR' + (nvrListForCards.length !== 1 ? 's' : '')}
                {viewMode === 'table' && tableGroupBy === 'byNvr' && groupedByNvr.length + ' NVR' + (groupedByNvr.length !== 1 ? 's' : '')}
                {viewMode === 'table' && tableGroupBy === 'byObjective' && groupedByObjective.length + ' objetivo' + (groupedByObjective.length !== 1 ? 's' : '')}
                {viewMode === 'table' && tableGroupBy === 'flat' && groupedByNvr.length + ' NVR' + (groupedByNvr.length !== 1 ? 's' : '')}
              </span>
            </div>
            {viewMode === 'cards' && (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {nvrListForCards.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-slate-500">
                    {routes.length === 0 ? 'No hay NVRs. Agregá uno con el botón de arriba o esperá la primera alerta.' : 'No hay resultados con el filtro actual.'}
                  </div>
                ) : (
                  nvrListForCards.map(({ nvrId, device, routes: nvrRoutes, clientName, objectiveName }) => (
                    <button
                      key={nvrId}
                      type="button"
                      onClick={() => setSelectedNvrId(nvrId)}
                      className="text-left p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all shadow-sm"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 rounded-xl bg-indigo-100 dark:bg-indigo-900/40">
                          <Camera size={22} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="font-mono font-black text-slate-800 dark:text-white text-lg">{nvrId}</span>
                      </div>
                      <dl className="space-y-1 text-sm">
                        <div><dt className="text-slate-400 inline">Cliente: </dt><dd className="font-semibold text-slate-700 dark:text-slate-200 inline truncate block">{clientName}</dd></div>
                        <div><dt className="text-slate-400 inline">Objetivo: </dt><dd className="font-semibold text-slate-700 dark:text-slate-200 inline truncate block">{objectiveName}</dd></div>
                        <div><dt className="text-slate-400 inline">Canales: </dt><dd className="font-semibold text-slate-700 dark:text-slate-200 inline">{nvrRoutes.length}{device?.channel_count != null ? ` / ${device.channel_count}` : ''}</dd></div>
                        {device?.alert_retention_days != null && (
                          <div><dt className="text-slate-400 inline">Retención imágenes: </dt><dd className="text-slate-600 dark:text-slate-300 inline">{device.alert_retention_days} días</dd></div>
                        )}
                      </dl>
                      <p className="mt-3 text-xs text-indigo-600 dark:text-indigo-400 font-bold">Clic para configurar →</p>
                    </button>
                  ))
                )}
              </div>
            )}
            {viewMode !== 'cards' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3 font-bold">NVR</th>
                    <th className="px-4 py-3 font-bold">Canal</th>
                    <th className="px-4 py-3 font-bold">Ruta (NVR__canal)</th>
                    <th className="px-4 py-3 font-bold">Nombre cámara</th>
                    <th className="px-4 py-3 font-bold">Posición</th>
                    <th className="px-4 py-3 font-bold">Grupo alertas</th>
                    <th className="px-4 py-3 font-bold">Cliente</th>
                    <th className="px-4 py-3 font-bold">Objetivo</th>
                    <th className="px-4 py-3 font-bold">Puesto</th>
                    <th className="px-4 py-3 font-bold">Horario atención</th>
                    <th className="px-4 py-3 font-bold">Estado</th>
                    <th className="px-4 py-3 font-bold w-28">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoutes.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                        {routes.length === 0 ? 'No hay rutas. Las rutas se crean automáticamente cuando un NVR envía la primera alerta; después configuralas acá.' : 'No hay resultados con el filtro actual.'}
                      </td>
                    </tr>
                  )}
                  {tableGroupBy === 'flat' && groupedByNvr.map(([nvrId, nvrRoutes]) => {
                    const nvrMeta = nvrDevices.find((n) => n.id === nvrId);
                    const device = nvrDevices.find((n) => n.id === nvrId);
                    const clientName = device?.client_id ? (clients.find((c) => c.id === device.client_id)?.name || clients.find((c) => c.id === device.client_id)?.fantasyName) : getClientName(nvrRoutes[0]?.objective_id);
                    const objectiveName = device?.objective_id ? getObjectiveName(device.objective_id) : getObjectiveName(nvrRoutes[0]?.objective_id);
                    return (
                      <tr
                        key={nvrId}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedNvrId(nvrId)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedNvrId(nvrId); } }}
                        className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-600 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      >
                        <td colSpan={12} className="px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200">
                          <span className="flex items-center gap-2">
                            <ChevronRight size={16} className="text-slate-400 shrink-0" />
                            <Camera size={16} className="text-indigo-500 shrink-0" />
                            NVR <span className="font-mono text-indigo-600 dark:text-indigo-400">{nvrId}</span>
                            <span className="text-slate-500 font-normal text-xs">— {clientName} · {objectiveName}</span>
                            {nvrMeta?.channel_count != null && <span className="text-slate-400 font-normal">({nvrRoutes.length}/{nvrMeta.channel_count} canales)</span>}
                          </span>
                          <span className="block text-xs font-normal text-slate-500 mt-0.5 pl-6">Clic para ver canales y configurar</span>
                        </td>
                      </tr>
                    );
                  })}
                  {tableGroupBy === 'byNvr' && groupedByNvr.map(([nvrId, nvrRoutes]) => {
                    const nvrMeta = nvrDevices.find((n) => n.id === nvrId);
                    const device = nvrDevices.find((n) => n.id === nvrId);
                    const clientName = device?.client_id ? (clients.find((c) => c.id === device.client_id)?.name || clients.find((c) => c.id === device.client_id)?.fantasyName) : getClientName(nvrRoutes[0]?.objective_id);
                    const objectiveName = device?.objective_id ? getObjectiveName(device.objective_id) : getObjectiveName(nvrRoutes[0]?.objective_id);
                    return (
                      <tr
                        key={nvrId}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedNvrId(nvrId)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedNvrId(nvrId); } }}
                        className="bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-600 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      >
                        <td colSpan={12} className="px-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-200">
                          <span className="flex items-center gap-2">
                            <Camera size={16} className="text-indigo-500 shrink-0" />
                            NVR <span className="font-mono text-indigo-600 dark:text-indigo-400">{nvrId}</span>
                            <span className="text-slate-500 font-normal text-xs">— {clientName} · {objectiveName}</span>
                            {nvrMeta?.channel_count != null && <span className="text-slate-400 font-normal">({nvrRoutes.length}/{nvrMeta.channel_count} canales)</span>}
                          </span>
                          <span className="block text-xs font-normal text-slate-500 mt-0.5">Clic para ver canales y configurar</span>
                        </td>
                      </tr>
                    );
                  })}
                  {tableGroupBy === 'byObjective' && groupedByObjective.map(([key, { name, routes: objRoutes }]) => {
                    const isObjExpanded = expandedObjectiveKey === key;
                    const byNvr: Record<string, CameraRoute[]> = {};
                    objRoutes.forEach((r) => {
                      const nvrId = getNvrId(r) || 'sin-nvr';
                      if (!byNvr[nvrId]) byNvr[nvrId] = [];
                      byNvr[nvrId].push(r);
                    });
                    const nvrsUnderObjective = Object.entries(byNvr).sort((a, b) => a[0].localeCompare(b[0]));
                    return (
                      <React.Fragment key={key}>
                        <tr
                          role="button"
                          tabIndex={0}
                          onClick={() => { setExpandedObjectiveKey((prev) => (prev === key ? null : key)); setExpandedNvrUnderObjective(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedObjectiveKey((prev) => (prev === key ? null : key)); setExpandedNvrUnderObjective(null); } }}
                          className="bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800/50 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                        >
                          <td colSpan={12} className="px-4 py-2 text-sm font-bold text-indigo-800 dark:text-indigo-200">
                            <span className="flex items-center gap-2">
                              {isObjExpanded ? <ChevronDown size={18} className="shrink-0 text-indigo-600" /> : <ChevronRight size={18} className="shrink-0 text-indigo-600" />}
                              <MapPin size={16} className="shrink-0" />
                              Objetivo: {name} — {nvrsUnderObjective.length} NVR{nvrsUnderObjective.length !== 1 ? 's' : ''}, {objRoutes.length} cámara{objRoutes.length !== 1 ? 's' : ''}
                            </span>
                            <span className="block text-xs font-normal text-slate-500 mt-0.5 pl-6">{isObjExpanded ? 'Clic para ocultar' : 'Clic para ver NVRs'}</span>
                          </td>
                        </tr>
                        {isObjExpanded && nvrsUnderObjective.map(([nvrId, nvrChannels]) => {
                          const nvrExpandKey = `${key}__${nvrId}`;
                          const isNvrExpanded = expandedNvrUnderObjective === nvrExpandKey;
                          const device = nvrDevices.find((n) => n.id === nvrId);
                          const clientName = device?.client_id ? (clients.find((c) => c.id === device.client_id)?.name || clients.find((c) => c.id === device.client_id)?.fantasyName) : getClientName(nvrChannels[0]?.objective_id);
                          return (
                            <React.Fragment key={nvrExpandKey}>
                              <tr
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setExpandedNvrUnderObjective((prev) => (prev === nvrExpandKey ? null : nvrExpandKey)); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setExpandedNvrUnderObjective((prev) => (prev === nvrExpandKey ? null : nvrExpandKey)); } }}
                                className="bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-600 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700/60 transition-colors"
                              >
                                <td colSpan={12} className="px-4 py-2 pl-10 text-sm font-medium text-slate-700 dark:text-slate-200">
                                  <span className="flex items-center gap-2">
                                    {isNvrExpanded ? <ChevronDown size={16} className="shrink-0 text-slate-500" /> : <ChevronRight size={16} className="shrink-0 text-slate-500" />}
                                    <Camera size={14} className="text-indigo-500 shrink-0" />
                                    NVR <span className="font-mono text-indigo-600 dark:text-indigo-400">{nvrId}</span>
                                    <span className="text-slate-500 font-normal text-xs">— {clientName}</span>
                                    <span className="text-slate-400 text-xs">({nvrChannels.length} canales)</span>
                                  </span>
                                  <span className="block text-xs font-normal text-slate-500 mt-0.5 pl-6">{isNvrExpanded ? 'Clic para ocultar canales' : 'Clic para ver canales'}</span>
                                </td>
                              </tr>
                              {isNvrExpanded && nvrChannels.map((r) => (
                                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 bg-white dark:bg-slate-800/40">
                                  <td className="px-4 py-2 pl-14 font-mono text-slate-600 dark:text-slate-400 text-xs">{getNvrId(r)}</td>
                                  <td className="px-4 py-2 font-mono text-slate-600 dark:text-slate-400 text-xs">{getChannelFromId(r)}</td>
                                  <td className="px-4 py-2 font-mono text-slate-700 dark:text-slate-300 text-xs">{r.id}</td>
                                  <td className="px-4 py-2 text-slate-800 dark:text-white text-xs">{r.camera_name || '—'}</td>
                                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">{(r as any).position || '—'}</td>
                                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">{(r as any).alert_group_id || '—'}</td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 text-xs">{getClientName(r.objective_id)}</td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300 text-xs">{getObjectiveName(r.objective_id)}</td>
                                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">{r.post_id || '—'}</td>
                                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400 text-xs">{formatScheduleSummary(r)}</td>
                                  <td className="px-4 py-2">
                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${r.enabled !== false ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'}`}>{r.enabled !== false ? 'Activa' : 'Desactivada'}</span>
                                  </td>
                                  <td className="px-4 py-2 flex items-center gap-1">
                                    <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedNvrId(nvrId); }} className="p-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400" title="Abrir NVR"> <Camera size={14} /></button>
                                    <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r); }} className="p-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400" title="Editar"><Edit2 size={14} /></button>
                                    <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteRoute(r.id); }} className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400" title="Eliminar"><Trash2 size={14} /></button>
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  </tbody>
              </table>
            </div>
            )}
          </div>
        </div>

        {/* Modal NVR: parámetros del dispositivo y lista de canales */}
        {selectedNvrId && (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-900/70 overflow-y-auto">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col my-8">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Camera size={22} /> NVR <span className="font-mono text-indigo-500">{selectedNvrId}</span>
                </h2>
                <button type="button" onClick={() => setSelectedNvrId(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"><X size={20} /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Cliente</label>
                    <select value={nvrForm.clientId} onChange={(e) => setNvrForm((f) => ({ ...f, clientId: e.target.value, objective_id: '' }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white">
                      <option value="">Sin asignar</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name || c.fantasyName || c.id}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Objetivo</label>
                    <select value={nvrForm.objective_id} onChange={(e) => setNvrForm((f) => ({ ...f, objective_id: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white">
                      <option value="">Sin asignar</option>
                      {(nvrForm.clientId ? objectives.filter((o) => o.clientId === nvrForm.clientId) : objectives).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Cantidad de canales</label>
                    <input type="number" min={1} max={64} value={nvrForm.channel_count} onChange={(e) => setNvrForm((f) => ({ ...f, channel_count: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Guardar imágenes (días)</label>
                    <input type="number" min={1} max={365} value={nvrForm.alert_retention_days} onChange={(e) => setNvrForm((f) => ({ ...f, alert_retention_days: e.target.value }))} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white" />
                    <p className="text-xs text-slate-500 mt-1">Después se borran las imágenes; queda el informe del evento. Política de este NVR.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-600">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={nvrForm.enabled} onChange={(e) => setNvrForm((f) => ({ ...f, enabled: e.target.checked }))} className="rounded border-slate-300 text-indigo-600" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">NVR activo</span>
                  </label>
                  <span className="text-xs text-slate-500">Si está desactivado, no se generan alertas para este NVR.</span>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/30">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2"><Clock size={16} /> Horario de atención del NVR</h3>
                  <label className="flex items-center gap-2 mb-3 cursor-pointer">
                    <input type="checkbox" checked={nvrForm.schedule_enabled} onChange={(e) => setNvrForm((f) => ({ ...f, schedule_enabled: e.target.checked }))} className="rounded border-slate-300 text-indigo-600" />
                    <span className="text-sm text-slate-600 dark:text-slate-300">Usar horario (solo en este rango se generan alertas)</span>
                  </label>
                  {nvrForm.schedule_enabled && (
                    <div className="space-y-3 mt-3">
                      <div>
                        <span className="block text-xs font-medium text-slate-500 mb-1">Días de la semana</span>
                        <div className="flex flex-wrap gap-2">
                          {DAYS_LABELS.map((label, i) => (
                            <label key={i} className="flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" checked={nvrForm.schedule_days.includes(i)} onChange={() => toggleDayNvr(i)} className="rounded border-slate-300 text-indigo-600" />
                              <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Dejar todos sin marcar = todos los días.</p>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
                          <input type="time" value={nvrForm.schedule_time_start} onChange={(e) => setNvrForm((f) => ({ ...f, schedule_time_start: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
                          <input type="time" value={nvrForm.schedule_time_end} onChange={(e) => setNvrForm((f) => ({ ...f, schedule_time_end: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-500 mb-1">Zona horaria</label>
                          <select value={nvrForm.schedule_timezone} onChange={(e) => setNvrForm((f) => ({ ...f, schedule_timezone: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm">
                            <option value="America/Argentina/Buenos_Aires">America/Argentina/Buenos_Aires</option>
                            <option value="America/Mexico_City">America/Mexico_City</option>
                            <option value="America/New_York">America/New_York</option>
                            <option value="America/Lima">America/Lima</option>
                            <option value="America/Santiago">America/Santiago</option>
                            <option value="Europe/Madrid">Europe/Madrid</option>
                            <option value="UTC">UTC</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2 flex items-center gap-2">Conexión para video en vivo</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Al hacer clic en &quot;Ver en vivo&quot; en una alerta de este NVR, se usan estos datos para conectar al reproductor. Misma red que el NVR.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">IP del NVR</label>
                      <input type="text" value={nvrForm.stream_ip} onChange={(e) => setNvrForm((f) => ({ ...f, stream_ip: e.target.value }))} placeholder="192.168.0.102" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Puerto</label>
                      <input type="text" value={nvrForm.stream_port} onChange={(e) => setNvrForm((f) => ({ ...f, stream_port: e.target.value }))} placeholder="80" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Usuario</label>
                      <input type="text" value={nvrForm.stream_user} onChange={(e) => setNvrForm((f) => ({ ...f, stream_user: e.target.value }))} placeholder="admin" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Contraseña</label>
                      <input type="password" value={nvrForm.stream_password} onChange={(e) => setNvrForm((f) => ({ ...f, stream_password: e.target.value }))} placeholder="••••••••" autoComplete="off" className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm" />
                    </div>
                  </div>
                </div>
                <button type="button" onClick={handleSaveNvrParams} disabled={nvrSaving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm">Guardar parámetros del NVR</button>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/30">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Agregar canal a este NVR</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Creá la ruta del canal (ej. {selectedNvrId}__1, {selectedNvrId}__2). Después podés editar nombre y horario en la tabla.</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Número de canal</label>
                      <input type="number" min={1} max={64} value={newChannelForNvr} onChange={(e) => setNewChannelForNvr(e.target.value)} className="w-24 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm font-mono" />
                    </div>
                    <button type="button" onClick={handleAddChannelToNvr} disabled={nvrSaving} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-lg text-sm flex items-center gap-1">
                      <Plus size={16} /> Agregar canal
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Canales de este NVR</h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-left text-slate-500 dark:text-slate-400">
                          <th className="px-3 py-2 font-bold">Canal</th>
                          <th className="px-3 py-2 font-bold">Nombre</th>
                          <th className="px-3 py-2 font-bold">Posición</th>
                          <th className="px-3 py-2 font-bold">Grupo</th>
                          <th className="px-3 py-2 font-bold">Horario</th>
                          <th className="px-3 py-2 font-bold">Estado</th>
                          <th className="px-3 py-2 font-bold w-24">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {routes.filter((r) => getNvrId(r) === selectedNvrId).sort((a, b) => (getChannelFromId(a) || '').localeCompare(getChannelFromId(b) || '')).map((r) => (
                          <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700/50">
                            <td className="px-3 py-2 font-mono">{getChannelFromId(r)}</td>
                            <td className="px-3 py-2">{r.camera_name || '—'}</td>
                            <td className="px-3 py-2 text-slate-500">{(r as any).position || '—'}</td>
                            <td className="px-3 py-2 text-slate-500">{(r as any).alert_group_id || '—'}</td>
                            <td className="px-3 py-2 text-slate-500">{formatScheduleSummary(r)}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${r.enabled !== false ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50' : 'bg-slate-200 text-slate-600'}`}>{r.enabled !== false ? 'Activa' : 'Off'}</span>
                            </td>
                            <td className="px-3 py-2">
                              <button type="button" onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600" title="Editar canal"><Edit2 size={16} /></button>
                              <button type="button" onClick={() => handleDeleteRoute(r.id)} className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 ml-1" title="Eliminar"><Trash2 size={16} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <button type="button" onClick={handleDeleteNvr} disabled={nvrSaving} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm flex items-center gap-2">
                    <Trash2 size={16} /> Eliminar NVR
                  </button>
                  <p className="text-xs text-slate-500 mt-2">Se eliminará el dispositivo y todas las rutas de canales de este NVR. Esta acción no se puede deshacer.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal edición canal */}
        {editingId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 z-10">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <Siren size={20} /> Editar ruta <span className="font-mono text-indigo-500">{editingId}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {editingId && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">NVR (solo lectura)</label>
                      <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-sm">{editingId.includes('__') ? editingId.split('__')[0] : editingId}</div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Canal en la NVR (solo lectura)</label>
                      <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-sm">{editingId.includes('__') ? editingId.split('__')[1] : '—'}</div>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Nombre en la NVR (o manual)</label>
                  <input
                    type="text"
                    value={form.camera_name ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, camera_name: e.target.value }))}
                    placeholder="Ej: Entrada principal, Patio — como figura en la NVR o como querés verlo en alertas"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">Nombre con el que identificás esta cámara (en la NVR o en la plataforma). Se muestra en alertas y en Operaciones. La ruta (NVR__canal) identifica el canal que envía la NVR.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Posición / clasificación</label>
                  <input
                    type="text"
                    value={form.position ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                    placeholder="Ej: Entrada, Perimetral, Hall planta baja"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">Ubicación o tipo de este canal (para reportes y clasificación).</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Grupo de alertas</label>
                  <input
                    type="text"
                    value={form.alert_group_id ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, alert_group_id: e.target.value }))}
                    placeholder="Ej: entrada, perimetral"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                  <p className="text-xs text-slate-500 mt-1">Si varias cámaras comparten el mismo grupo, en Operaciones se mostrarán como un solo evento (todas las imágenes juntas). Dejá vacío para que cada cámara sea un evento independiente.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={form.enabled}
                    onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                    className="rounded border-slate-300"
                  />
                  <label htmlFor="enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300">Ruta activa (recibir alertas)</label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1"><Building2 size={14} /> Cliente</label>
                  <select
                    value={form.clientId}
                    onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value, objective_id: '' }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.fantasyName || c.id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1"><MapPin size={14} /> Objetivo</label>
                  <select
                    value={form.objective_id}
                    onChange={(e) => setForm((f) => ({ ...f, objective_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {objectivesByClient.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Puesto (opcional)</label>
                  <input
                    type="text"
                    value={form.post_id}
                    onChange={(e) => setForm((f) => ({ ...f, post_id: e.target.value }))}
                    placeholder="Ej: Entrada, Patio"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Tipo de evento</label>
                  <input
                    type="text"
                    value={form.event_type}
                    onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={18} className="text-slate-500" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Horario de atención</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Solo se crean alertas dentro de este horario. Ej: solo de noche o solo fines de semana.
                  </p>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="checkbox"
                      id="schedule_enabled"
                      checked={form.schedule_enabled}
                      onChange={(e) => setForm((f) => ({ ...f, schedule_enabled: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    <label htmlFor="schedule_enabled" className="text-sm font-medium text-slate-700 dark:text-slate-300">Restringir por horario</label>
                  </div>
                  {form.schedule_enabled && (
                    <>
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-slate-500 mb-1">Días (vacío = todos)</label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS_LABELS.map((label, i) => (
                            <label key={i} className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={form.schedule_days.includes(i)}
                                onChange={() => toggleDay(i)}
                                className="rounded border-slate-300"
                              />
                              <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Desde (HH:mm)</label>
                          <input
                            type="text"
                            value={form.schedule_time_start}
                            onChange={(e) => setForm((f) => ({ ...f, schedule_time_start: e.target.value }))}
                            placeholder="22:00"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Hasta (HH:mm)</label>
                          <input
                            type="text"
                            value={form.schedule_time_end}
                            onChange={(e) => setForm((f) => ({ ...f, schedule_time_end: e.target.value }))}
                            placeholder="06:00"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Zona horaria</label>
                        <select
                          value={form.schedule_timezone}
                          onChange={(e) => setForm((f) => ({ ...f, schedule_timezone: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm"
                        >
                          <option value="America/Argentina/Buenos_Aires">Argentina (Buenos Aires)</option>
                          <option value="America/Argentina/Cordoba">Argentina (Córdoba)</option>
                          <option value="UTC">UTC</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 min-w-[120px] px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => editingId && handleDeleteRoute(editingId)}
                    className="px-4 py-2 border border-red-300 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    Eliminar esta ruta
                  </button>
                  {editingId && (() => {
                    const nvrId = editingId.split('__')[0];
                    const nvrRoutes = routes.filter((r) => r.id.startsWith(nvrId + '__'));
                    if (nvrRoutes.length === 0) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => handleDeleteNvr(nvrId)}
                        className="px-4 py-2 border border-red-400 dark:border-red-700 rounded-xl text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 font-medium"
                        title={`Elimina todas las cámaras del NVR ${nvrId}`}
                      >
                        Eliminar NVR {nvrId} ({nvrRoutes.length} cámara{nvrRoutes.length !== 1 ? 's' : ''})
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
      <Toaster position="top-right" />
    </>
  );
}

export default withAuthGuard(CameraRoutesPage, ['admin', 'SuperAdmin', 'Operator', 'Operador', 'Director', 'Auditor']);
