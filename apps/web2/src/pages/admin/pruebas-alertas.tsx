import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { Siren, Upload, Image, Calendar, CheckCircle, Building2, MapPin } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { withAuthGuard } from '@/components/common/withAuthGuard';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, limit, onSnapshot } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';

type Objective = { id: string; name: string; clientId: string; clientName: string; lat?: number; lng?: number };

function toDate(d: unknown): Date {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  if (typeof d === 'object' && d !== null && 'seconds' in d) return new Date((d as { seconds: number }).seconds * 1000);
  return new Date(String(d));
}

function formatDateTime(dateObj: unknown): string {
  try {
    return toDate(dateObj).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
  } catch {
    return '—';
  }
}

const parseCoord = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function PruebasAlertasPage() {
  const [cameraName, setCameraName] = useState('Prueba desde plataforma');
  const [channelId, setChannelId] = useState(2);
  const [eventType, setEventType] = useState('Tripwire');
  const [objectType, setObjectType] = useState('human');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string>('');
  const [alerts, setAlerts] = useState<Array<{ id: string; timestamp: unknown; camera_name?: string; status?: string; image_url?: string; simulated?: boolean }>>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      const objs: Objective[] = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        const clientName = data.name || data.fantasyName || d.id;
        if (data.objetivos && Array.isArray(data.objetivos)) {
          data.objetivos.forEach((o: any) => {
            const lat = parseCoord(o.lat ?? o.latitude ?? o.coords?.lat ?? o.location?.lat);
            const lng = parseCoord(o.lng ?? o.longitude ?? o.coords?.lng ?? o.location?.lng);
            objs.push({
              id: o.id || o.name,
              name: o.name || o.id || 'Objetivo',
              clientId: d.id,
              clientName,
              lat: lat ?? undefined,
              lng: lng ?? undefined,
            });
          });
        }
      });
      setObjectives(objs);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (objectives.length > 0 && !selectedObjectiveId) setSelectedObjectiveId(objectives[0].id);
  }, [objectives.length]);

  const uniqueClients = React.useMemo(() => {
    const map = new Map<string, string>();
    objectives.forEach((o) => map.set(o.clientId, o.clientName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [objectives]);

  const objectivesByClient = React.useMemo(() => {
    return selectedClientId ? objectives.filter((o) => o.clientId === selectedClientId) : objectives;
  }, [objectives, selectedClientId]);

  useEffect(() => {
    if (selectedClientId && !objectivesByClient.some((o) => o.id === selectedObjectiveId)) {
      setSelectedObjectiveId(objectivesByClient[0]?.id || '');
    }
  }, [selectedClientId, objectivesByClient, selectedObjectiveId]);

  useEffect(() => {
    const q = query(collection(db, 'alerts'), limit(50));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data(), timestamp: doc.data().timestamp } as any));
        list.sort((a, b) => {
          const ta = a.timestamp?.seconds ?? (a.timestamp ? new Date(a.timestamp).getTime() / 1000 : 0);
          const tb = b.timestamp?.seconds ?? (b.timestamp ? new Date(b.timestamp).getTime() / 1000 : 0);
          return tb - ta;
        });
        setAlerts(list.slice(0, 20));
      },
      (err) => {
        console.error('Error leyendo alertas:', err);
        toast.error('No se pueden cargar las alertas. Revisá permisos Firestore.');
      }
    );
    return () => unsub();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageFile) {
      toast.error('Seleccioná una imagen.');
      return;
    }
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string)?.split(',')[1] || (reader.result as string);
        if (!base64) {
          toast.error('No se pudo leer la imagen.');
          setLoading(false);
          return;
        }
        const simulateNvrAlert = httpsCallable(functions, 'simulateNvrAlert');
        const res = await simulateNvrAlert({
          imageBase64: base64,
          camera_name: cameraName || undefined,
          channel_id: channelId,
          event_type: eventType || undefined,
          object_type: objectType || undefined,
          objective_id: selectedObjectiveId || undefined,
        });
        const data = res.data as { ok?: boolean; alertId?: string };
        if (data?.ok && data?.alertId) {
          toast.success(`Alerta creada: ${data.alertId}. Operador y guardias la verán.`);
          setImageFile(null);
        } else {
          toast.error('Respuesta inesperada del servidor.');
        }
        setLoading(false);
      };
      reader.onerror = () => {
        toast.error('Error al leer el archivo.');
        setLoading(false);
      };
      reader.readAsDataURL(imageFile);
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err ? String((err as { message: string }).message) : 'Error al crear la alerta.';
      toast.error(message);
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <Head><title>Pruebas NVR – Simular alertas | CronoApp</title></Head>
      <div className="p-6 max-w-5xl mx-auto min-h-screen flex flex-col gap-8 animate-in fade-in">
        <div className="flex items-center gap-4 border-b border-slate-200 dark:border-slate-700 pb-6">
          <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-2xl">
            <Siren className="text-amber-600 dark:text-amber-400" size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Pruebas NVR – Simular alertas</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Creá una alerta de prueba. Se guarda en la base de datos y el operador y los guardias la ven como una alerta real (incluye notificación si hay tokens).</p>
          </div>
        </div>

        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Upload size={20} /> Crear alerta de prueba
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Imagen (obligatorio)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-amber-100 file:text-amber-800 dark:file:bg-amber-900/50 dark:file:text-amber-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1"><Building2 size={14} /> Cliente</label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              >
                <option value="">Todos los clientes</option>
                {uniqueClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1 flex items-center gap-1"><MapPin size={14} /> Objetivo (donde se verá en el mapa)</label>
              <select
                value={selectedObjectiveId}
                onChange={(e) => setSelectedObjectiveId(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              >
                {objectivesByClient.length === 0 ? (
                  <option value="">Sin objetivos — cargá clientes con objetivos</option>
                ) : (
                  objectivesByClient.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} {o.clientName ? `(${o.clientName})` : ''}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Nombre cámara</label>
              <input
                type="text"
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
                placeholder="Ej: Entrada Principal"
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Canal</label>
              <input
                type="number"
                min={1}
                value={channelId}
                onChange={(e) => setChannelId(Number(e.target.value) || 2)}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Tipo de evento</label>
              <input
                type="text"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="Tripwire"
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Objeto detectado</label>
              <select
                value={objectType}
                onChange={(e) => setObjectType(e.target.value)}
                className="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
              >
                <option value="human">Persona</option>
                <option value="vehicle">Vehículo</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading || !imageFile}
                className="px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg flex items-center gap-2"
              >
                {loading ? 'Creando…' : 'Crear alerta de prueba'}
                <CheckCircle size={18} />
              </button>
            </div>
          </form>
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Calendar size={20} /> Últimas alertas (operador y guardias las ven acá y en Centro de Control)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-600 text-left text-slate-500 dark:text-slate-400">
                  <th className="pb-2 pr-2">Fecha/hora</th>
                  <th className="pb-2 pr-2">Cámara</th>
                  <th className="pb-2 pr-2">Estado</th>
                  <th className="pb-2 pr-2">Imagen</th>
                </tr>
              </thead>
              <tbody>
                {alerts.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">Aún no hay alertas.</td></tr>
                )}
                {alerts.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-slate-700">
                    <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">{formatDateTime(a.timestamp)}</td>
                    <td className="py-2 pr-2 font-medium text-slate-800 dark:text-white">
                      {a.camera_name || '—'} {a.simulated && <span className="text-amber-600 text-xs">(prueba)</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.status === 'pending' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-600 dark:text-slate-200'}`}>
                        {a.status || 'pending'}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      {a.image_url ? (
                        <a href={a.image_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                          <Image size={14} /> Ver
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <Toaster position="top-right" />
    </DashboardLayout>
  );
}

export default withAuthGuard(PruebasAlertasPage, ['admin', 'SuperAdmin', 'Operator', 'Operador', 'Director', 'Auditor']);
