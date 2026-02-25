import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';
import { Siren, Filter } from 'lucide-react';

type ClientDoc = { id: string; name?: string; fantasyName?: string; objetivos?: { id: string; name?: string }[] };
type AlertDoc = {
  id: string;
  timestamp?: { seconds: number } | Date;
  camera_name?: string;
  source_camera_name?: string;
  route_key?: string;
  objective_id?: string;
  status?: string;
  resolution_type?: string;
  event_type?: string;
  event_time_readable?: string;
  image_url?: string;
  image_urls?: string[];
};

function formatAlertDate(ts: any): string {
  if (!ts) return '—';
  try {
    const s = ts?.seconds ?? (ts instanceof Date ? ts.getTime() / 1000 : null);
    if (s == null) return '—';
    return new Date(s * 1000).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function ReportesEventosCamarasPage() {
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClientId, setFilterClientId] = useState('');
  const [filterObjectiveId, setFilterObjectiveId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const objectivesFlat = useMemo(() => {
    const out: { id: string; name: string; clientId: string; clientName: string }[] = [];
    clients.forEach((c) => {
      const clientName = c.name || c.fantasyName || c.id;
      (c.objetivos || []).forEach((o: any) => {
        out.push({
          id: o.id || o.name || '',
          name: o.name || o.id || 'Objetivo',
          clientId: c.id,
          clientName,
        });
      });
    });
    return out;
  }, [clients]);

  const objectiveIdsByClient = useMemo(() => {
    const map: Record<string, string[]> = {};
    objectivesFlat.forEach((o) => {
      if (!map[o.clientId]) map[o.clientId] = [];
      if (o.id) map[o.clientId].push(o.id);
    });
    return map;
  }, [objectivesFlat]);

  const objectivesByClient = useMemo(
    () => (filterClientId ? objectivesFlat.filter((o) => o.clientId === filterClientId) : objectivesFlat),
    [objectivesFlat, filterClientId]
  );

  useEffect(() => {
    getDocs(collection(db, 'clients')).then((snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc)));
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'alerts'), orderBy('timestamp', 'desc'), limit(500));
    getDocs(q)
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AlertDoc));
        setAlerts(list);
      })
      .catch((err) => {
        console.error(err);
        toast.error('Error al cargar eventos');
        setAlerts([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredAlerts = useMemo(() => {
    let list = alerts;
    if (filterClientId && objectiveIdsByClient[filterClientId]?.length) {
      const ids = new Set(objectiveIdsByClient[filterClientId]);
      list = list.filter((a) => a.objective_id && ids.has(a.objective_id));
    }
    if (filterObjectiveId) {
      list = list.filter((a) => a.objective_id === filterObjectiveId);
    }
    if (dateFrom) {
      const fromMs = new Date(dateFrom).getTime();
      list = list.filter((a) => {
        const s = a.timestamp?.seconds ?? 0;
        return s * 1000 >= fromMs;
      });
    }
    if (dateTo) {
      const toMs = new Date(dateTo + 'T23:59:59').getTime();
      list = list.filter((a) => {
        const s = a.timestamp?.seconds ?? 0;
        return s * 1000 <= toMs;
      });
    }
    return list;
  }, [alerts, filterClientId, filterObjectiveId, dateFrom, dateTo, objectiveIdsByClient]);

  const getClientName = (objectiveId: string | undefined) => {
    if (!objectiveId) return '—';
    const o = objectivesFlat.find((ob) => ob.id === objectiveId);
    return o?.clientName ?? '—';
  };
  const getObjectiveName = (objectiveId: string | undefined) => {
    if (!objectiveId) return '—';
    const o = objectivesFlat.find((ob) => ob.id === objectiveId);
    return o?.name ?? objectiveId;
  };
  const displayCameraName = (a: AlertDoc) => a.source_camera_name || a.camera_name || a.route_key || '—';

  return (
    <>
      <Head>
        <title>Reporte eventos cámaras | Operaciones</title>
      </Head>
      <DashboardLayout>
        <Toaster />
        <div className="p-4 max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Siren size={24} className="text-rose-500" />
              Reporte de eventos (cámaras NVR)
            </h1>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-end gap-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                <Filter size={18} />
                Filtros
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Cliente</label>
                <select
                  value={filterClientId}
                  onChange={(e) => {
                    setFilterClientId(e.target.value);
                    setFilterObjectiveId('');
                  }}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm min-w-[180px]"
                >
                  <option value="">Todos</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.fantasyName || c.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Objetivo</label>
                <select
                  value={filterObjectiveId}
                  onChange={(e) => setFilterObjectiveId(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm min-w-[180px]"
                >
                  <option value="">Todos</option>
                  {objectivesByClient.map((o) => (
                    <option key={o.id} value={o.id}>{o.clientName} — {o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Desde</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm"
                />
              </div>
              <span className="text-sm text-slate-500 font-medium">{filteredAlerts.length} evento(s)</span>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-12 text-center text-slate-500">Cargando eventos...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600 font-bold">
                      <th className="px-4 py-3">ID evento</th>
                      <th className="px-4 py-3">Cámara</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Objetivo</th>
                      <th className="px-4 py-3">Fecha y hora</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Resolución</th>
                      <th className="px-4 py-3 w-16">Imagen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAlerts.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                          No hay eventos con los filtros aplicados.
                        </td>
                      </tr>
                    )}
                    {filteredAlerts.map((a) => (
                      <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{a.id}</td>
                        <td className="px-4 py-3 text-slate-800">{displayCameraName(a)}</td>
                        <td className="px-4 py-3 text-slate-600">{getClientName(a.objective_id)}</td>
                        <td className="px-4 py-3 text-slate-600">{getObjectiveName(a.objective_id)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatAlertDate(a.timestamp)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${a.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                            {a.status === 'pending' ? 'Pendiente' : (a.status || '—')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{a.resolution_type || '—'}</td>
                        <td className="px-4 py-2">
                          {(a.image_url || (a.image_urls && a.image_urls[0])) ? (
                            <a href={a.image_url || a.image_urls?.[0]} target="_blank" rel="noopener noreferrer" className="block w-12 h-12 rounded border border-slate-200 overflow-hidden bg-slate-100">
                              <img src={a.image_url || a.image_urls?.[0]} alt="" className="w-full h-full object-cover" />
                            </a>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}
