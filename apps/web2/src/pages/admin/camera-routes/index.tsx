import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';
import {
  Building2,
  Camera,
  Clock,
  Edit2,
  HelpCircle,
  MapPin,
  Plus,
  Siren,
  X,
} from 'lucide-react';

type ClientDoc = { id: string; name?: string; fantasyName?: string; objetivos?: any[] };
type ObjectiveFlat = { id: string; name: string; clientId: string; clientName: string };
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
  const [routes, setRoutes] = useState<CameraRoute[]>([]);
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveFlat[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newNvrId, setNewNvrId] = useState('default');
  const [newChannel, setNewChannel] = useState('1');
  const [creating, setCreating] = useState(false);
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
        camera_name: form.camera_name.trim() || null,
        enabled: form.enabled,
        objective_id: form.objective_id || null,
        post_id: form.post_id.trim() || null,
        event_type: form.event_type.trim() || 'Tripwire',
        schedule_enabled: form.schedule_enabled,
        schedule_days: form.schedule_days,
        schedule_time_start: form.schedule_time_start.trim() || null,
        schedule_time_end: form.schedule_time_end.trim() || null,
        schedule_timezone: form.schedule_timezone.trim() || 'America/Argentina/Buenos_Aires',
      });
      toast.success('Ruta guardada');
      setEditingId(null);
    } catch (e) {
      console.error(e);
      toast.error('Error al guardar');
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
          camera_name: `NVR ${routeKey}`,
          objective_id: null,
          post_id: null,
          event_type: 'Tripwire',
          created_manually: true,
          first_seen_at: serverTimestamp(),
        },
        { merge: true }
      );
      toast.success(`Ruta ${routeKey} creada. Asigná cliente y objetivo editándola.`);
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

  return (
    <>
      <Head>
        <title>Cámaras NVR · CronoApp</title>
      </Head>
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
              <Camera className="text-indigo-600 dark:text-indigo-400" size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-800 dark:text-white">Cámaras NVR</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Asigná cliente, objetivo y horario de atención por cada ruta (NVR + canal). Las alertas solo se crean dentro del horario configurado.
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
                <strong>Automático:</strong> Cuando el NVR envía la <strong>primera alerta</strong> al webhook (HTTP POST con imagen), el sistema crea la ruta con id <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">NVR_ID__CANAL</code> (ej. <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">default__2</code>) y aparece en esta tabla. Después editá la fila para asignar cliente, objetivo y horario.
              </li>
              <li>
                <strong>Dónde envía la NVR:</strong> Configurá el equipo para que suba las fotos a la URL del webhook. Si la NVR solo soporta HTTP, usá el proxy (<code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">scripts/nvr-http-to-https-proxy.js</code>) en una PC de la misma red; el proxy reenvía por HTTPS a la Cloud Function. La URL final debe incluir <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">?key=TU_SECRETO</code> (el mismo que está en Firestore <code className="bg-slate-200 dark:bg-slate-600 px-1 rounded font-mono text-xs">nvr_config/webhook</code>).
              </li>
              <li>
                <strong>Manual:</strong> Si querés pre-crear la ruta antes de que llegue cualquier evento, usá el botón &quot;Crear ruta manualmente&quot; abajo e ingresá el ID de NVR y el número de canal. La ruta aparecerá en la lista para que la edites; luego configurá el dispositivo para que envíe a la misma URL del webhook.
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setShowCreateForm((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl"
              >
                <Plus size={18} />
                {showCreateForm ? 'Ocultar formulario' : 'Crear ruta manualmente'}
              </button>
            </div>
            {showCreateForm && (
              <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">ID NVR (si no envía nada, usamos &quot;default&quot;)</label>
                  <input
                    type="text"
                    value={newNvrId}
                    onChange={(e) => setNewNvrId(e.target.value)}
                    placeholder="default"
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3 font-bold">Ruta (NVR__canal)</th>
                    <th className="px-4 py-3 font-bold">Cámara</th>
                    <th className="px-4 py-3 font-bold">Cliente</th>
                    <th className="px-4 py-3 font-bold">Objetivo</th>
                    <th className="px-4 py-3 font-bold">Puesto</th>
                    <th className="px-4 py-3 font-bold">Horario atención</th>
                    <th className="px-4 py-3 font-bold">Estado</th>
                    <th className="px-4 py-3 font-bold w-20">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                        No hay rutas. Las rutas se crean automáticamente cuando un NVR envía la primera alerta; después configuralas acá.
                      </td>
                    </tr>
                  )}
                  {routes.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                    >
                      <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">{r.id}</td>
                      <td className="px-4 py-3 text-slate-800 dark:text-white">{r.camera_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{getClientName(r.objective_id)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{getObjectiveName(r.objective_id)}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{r.post_id || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{formatScheduleSummary(r)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            r.enabled !== false ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {r.enabled !== false ? 'Activa' : 'Desactivada'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="p-2 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400"
                          title="Editar"
                        >
                          <Edit2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal edición */}
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
                <div>
                  <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Nombre cámara</label>
                  <input
                    type="text"
                    value={form.camera_name}
                    onChange={(e) => setForm((f) => ({ ...f, camera_name: e.target.value }))}
                    placeholder="Ej: Entrada principal"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                  />
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

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl"
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
