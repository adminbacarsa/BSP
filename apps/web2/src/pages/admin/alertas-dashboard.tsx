import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, onSnapshot, getDocs } from 'firebase/firestore';
import { Toaster, toast } from 'sonner';
import { Siren, Filter, CheckCircle, Clock, Building2, Camera, Loader2, Radio, FileText } from 'lucide-react';

type ClientDoc = { id: string; name?: string; fantasyName?: string; objetivos?: { id: string; name?: string }[] };
type AlertDoc = {
  id: string;
  timestamp?: { seconds: number } | Date;
  camera_name?: string;
  source_camera_name?: string;
  route_key?: string;
  objective_id?: string;
  client_id?: string;
  nvr_name?: string;
  vendor?: string;
  status?: string;
  resolution_type?: string;
  guard_notes?: string;
  resolvedAt?: { seconds: number } | Date;
  resolvedBy?: string;
  event_type?: string;
  event_time_readable?: string;
  image_url?: string;
  image_urls?: string[];
};

const RESOLUTION_OPTIONS = [
  { id: 'visto', label: 'Visto / Atendido' },
  { id: 'verificado_guardia', label: 'Verificado por guardia' },
  { id: 'incidente_reportado', label: 'Incidente reportado' },
  { id: 'en_revision', label: 'En revisión' },
  { id: 'falso_positivo', label: 'Falso positivo' },
  { id: 'otro', label: 'Otro' },
];

function formatDate(ts: any): string {
  if (!ts) return '—';
  try {
    const s = ts?.seconds ?? (ts instanceof Date ? ts.getTime() / 1000 : null);
    if (s == null) return '—';
    return new Date(s * 1000).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export default function AlertasDashboardPage() {
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClientId, setFilterClientId] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'resolved'>('all');
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

  useEffect(() => {
    getDocs(collection(db, 'clients')).then((snap) => {
      setClients(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ClientDoc)));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'alerts'), orderBy('timestamp', 'desc'), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AlertDoc)));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error('Error al cargar alertas');
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const filteredAlerts = useMemo(() => {
    let list = alerts;
    if (filterClientId) {
      list = list.filter((a) => {
        const cid = a.client_id || objectivesFlat.find((o) => o.id === a.objective_id)?.clientId;
        return cid === filterClientId;
      });
    }
    if (filterVendor) list = list.filter((a) => (a.vendor || 'dahua') === filterVendor);
    if (filterStatus === 'pending') list = list.filter((a) => a.status !== 'resolved' && a.status !== 'acknowledged');
    if (filterStatus === 'resolved') list = list.filter((a) => a.status === 'resolved' || a.status === 'acknowledged');
    if (dateFrom) {
      const fromMs = new Date(dateFrom).getTime();
      list = list.filter((a) => {
        const s = (a.timestamp as any)?.seconds ?? 0;
        return s * 1000 >= fromMs;
      });
    }
    if (dateTo) {
      const toMs = new Date(dateTo + 'T23:59:59').getTime();
      list = list.filter((a) => {
        const s = (a.timestamp as any)?.seconds ?? 0;
        return s * 1000 <= toMs;
      });
    }
    return list;
  }, [alerts, filterClientId, filterVendor, filterStatus, dateFrom, dateTo, objectivesFlat]);

  const stats = useMemo(() => {
    const pending = filteredAlerts.filter((a) => (a.status || 'pending') !== 'resolved' && a.status !== 'acknowledged').length;
    const resolved = filteredAlerts.filter((a) => a.status === 'resolved' || a.status === 'acknowledged').length;
    const today = new Date().toLocaleDateString('en-CA');
    const todayCount = filteredAlerts.filter((a) => {
      const s = (a.timestamp as any)?.seconds;
      return s && new Date(s * 1000).toLocaleDateString('en-CA') === today;
    }).length;
    const resolvedToday = filteredAlerts.filter((a) => {
      const s = (a.resolvedAt as any)?.seconds;
      return s && new Date(s * 1000).toLocaleDateString('en-CA') === today;
    }).length;
    return { total: filteredAlerts.length, pending, resolved, todayCount, resolvedToday };
  }, [filteredAlerts]);

  const kpiByEventType = useMemo(() => {
    const map: Record<string, number> = {};
    filteredAlerts.forEach((a) => {
      const t = a.event_type || 'Otro';
      map[t] = (map[t] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filteredAlerts]);

  const kpiByVendor = useMemo(() => {
    const map: Record<string, number> = {};
    filteredAlerts.forEach((a) => {
      const v = a.vendor || 'dahua';
      map[v] = (map[v] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredAlerts]);

  const getClientNameForKpi = (a: AlertDoc): string => {
    if (a.client_id) {
      const c = clients.find((x) => x.id === a.client_id);
      return c?.name || c?.fantasyName || a.client_id;
    }
    const o = objectivesFlat.find((ob) => ob.id === a.objective_id);
    return o?.clientName ?? 'Sin asignar';
  };

  const kpiByClient = useMemo(() => {
    const map: Record<string, number> = {};
    filteredAlerts.forEach((a) => {
      const name = getClientNameForKpi(a);
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filteredAlerts, clients, objectivesFlat]);

  const getClientName = (a: AlertDoc) => {
    if (a.client_id) {
      const c = clients.find((x) => x.id === a.client_id);
      return c?.name || c?.fantasyName || a.client_id;
    }
    const o = objectivesFlat.find((ob) => ob.id === a.objective_id);
    return o?.clientName ?? '—';
  };
  const getObjectiveName = (a: AlertDoc) => {
    const o = objectivesFlat.find((ob) => ob.id === a.objective_id);
    return o?.name ?? a.objective_id ?? '—';
  };
  const displayCamera = (a: AlertDoc) => {
    const cam = a.source_camera_name || a.camera_name || a.route_key || '—';
    return a.nvr_name ? `${a.nvr_name} · ${cam}` : cam;
  };

  const isResolved = (a: AlertDoc) => a.status === 'resolved' || a.status === 'acknowledged';

  return (
    <>
      <Head>
        <title>Dashboard alertas | CronoApp</title>
      </Head>
      <DashboardLayout>
        <Toaster />
        <div className="p-4 max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
              <Siren size={24} className="text-rose-500" />
              Dashboard de alertas
            </h1>
            <span className="text-sm text-slate-500">Por cliente, tipo y tratamiento (Dahua · Hikvision)</span>
          </div>
          <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 mb-6 flex items-center gap-2 flex-wrap">
            <FileText size={18} className="text-slate-500 shrink-0" />
            Vista de consulta: aquí solo se muestran las alertas y su resolución. Las alertas se resuelven en{' '}
            <Link href="/admin/operaciones" className="font-bold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
              <Radio size={16} /> Operaciones
            </Link>
            . El detalle por evento está en <Link href="/admin/reportes-eventos-camaras" className="font-bold text-slate-700 hover:underline">Reporte de eventos</Link>.
          </p>

          {/* KPIs principales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 text-sm font-medium mb-1">
                <Camera size={18} /> Total (filtros)
              </div>
              <div className="text-2xl font-black text-slate-800">{stats.total}</div>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-amber-700 text-sm font-medium mb-1">
                <Clock size={18} /> Pendientes
              </div>
              <div className="text-2xl font-black text-amber-800">{stats.pending}</div>
            </div>
            <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium mb-1">
                <CheckCircle size={18} /> Resueltas
              </div>
              <div className="text-2xl font-black text-emerald-800">{stats.resolved}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500 text-sm font-medium mb-1">Recibidas hoy</div>
              <div className="text-2xl font-black text-slate-800">{stats.todayCount}</div>
            </div>
          </div>

          {/* KPIs por dimensión: cliente, tipo evento, fabricante, resueltas hoy */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 text-sm font-bold mb-3">
                <Building2 size={18} /> Por cliente
              </div>
              <ul className="space-y-1.5 text-sm">
                {kpiByClient.length === 0 ? <li className="text-slate-400 italic">Sin datos</li> : kpiByClient.map(([name, count]) => (
                  <li key={name} className="flex justify-between items-center">
                    <span className="text-slate-700 truncate max-w-[160px]" title={name}>{name}</span>
                    <span className="font-black text-slate-800">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 text-sm font-bold mb-3">
                <Siren size={18} /> Por tipo de evento
              </div>
              <ul className="space-y-1.5 text-sm">
                {kpiByEventType.length === 0 ? <li className="text-slate-400 italic">Sin datos</li> : kpiByEventType.map(([type, count]) => (
                  <li key={type} className="flex justify-between items-center">
                    <span className="text-slate-700 truncate max-w-[160px]" title={type}>{type}</span>
                    <span className="font-black text-slate-800">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 text-sm font-bold mb-3">
                <Camera size={18} /> Por fabricante · Resueltas hoy
              </div>
              <ul className="space-y-1.5 text-sm mb-3">
                {kpiByVendor.length === 0 ? <li className="text-slate-400 italic">Sin datos</li> : kpiByVendor.map(([vendor, count]) => (
                  <li key={vendor} className="flex justify-between items-center">
                    <span className="text-slate-700 capitalize">{vendor}</span>
                    <span className="font-black text-slate-800">{count}</span>
                  </li>
                ))}
              </ul>
              <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-sm">
                <span className="text-slate-600">Resueltas hoy</span>
                <span className="font-black text-emerald-700">{stats.resolvedToday}</span>
              </div>
            </div>
          </div>

          {/* Filtros */}
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
                  onChange={(e) => setFilterClientId(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm min-w-[180px]"
                >
                  <option value="">Todos</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.fantasyName || c.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Fabricante</label>
                <select
                  value={filterVendor}
                  onChange={(e) => setFilterVendor(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm min-w-[120px]"
                >
                  <option value="">Todos</option>
                  <option value="dahua">Dahua</option>
                  <option value="hikvision">Hikvision</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm min-w-[120px]"
                >
                  <option value="all">Todos</option>
                  <option value="pending">Pendientes</option>
                  <option value="resolved">Resueltas</option>
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
              <span className="text-sm text-slate-500 font-medium">{filteredAlerts.length} alerta(s)</span>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-12 text-center text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 size={20} className="animate-spin" /> Cargando alertas...
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600 font-bold">
                      <th className="px-4 py-3">Fecha y hora</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Objetivo</th>
                      <th className="px-4 py-3">Cámara</th>
                      <th className="px-4 py-3">Tipo evento</th>
                      <th className="px-4 py-3">Fabricante</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3">Resolución / Tratamiento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAlerts.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                          No hay alertas con los filtros aplicados.
                        </td>
                      </tr>
                    )}
                    {filteredAlerts.map((a) => (
                      <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{formatDate(a.timestamp)}</td>
                        <td className="px-4 py-3 text-slate-800">{getClientName(a)}</td>
                        <td className="px-4 py-3 text-slate-600">{getObjectiveName(a)}</td>
                        <td className="px-4 py-3 text-slate-600">{displayCamera(a)}</td>
                        <td className="px-4 py-3 text-slate-700">{a.event_type || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                            {a.vendor || 'dahua'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${isResolved(a) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                            {isResolved(a) ? 'Resuelta' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[200px]">
                          {isResolved(a) ? (
                            <span title={a.guard_notes || ''}>
                              {RESOLUTION_OPTIONS.find((r) => r.id === a.resolution_type)?.label || a.resolution_type || '—'}
                              {a.guard_notes ? ` · ${a.guard_notes.slice(0, 30)}${a.guard_notes.length > 30 ? '…' : ''}` : ''}
                            </span>
                          ) : (
                            '—'
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
