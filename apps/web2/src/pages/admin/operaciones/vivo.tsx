import React, { useEffect, useRef, useState, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ArrowLeft, Radio, AlertCircle, Camera, Wifi, WifiOff, X } from 'lucide-react';
import Link from 'next/link';
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';

const TUNNEL_WS_URL = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_TUNNEL_WS_URL || '').trim() : '';

interface CameraRoute {
  id: string;
  nvrId: string;
  channel: number;
  camera_name: string;
  enabled: boolean;
}

interface NvrDevice {
  id: string;
  name?: string;
  agent_registered?: boolean;
  stream_via_tunnel?: boolean;
}

export default function VivoPage() {
  const router = useRouter();
  const { nvrId: urlNvrId, channel: urlChannel } = router.query as { nvrId?: string; channel?: string };

  const [cameras, setCameras] = useState<CameraRoute[]>([]);
  const [nvrs, setNvrs] = useState<Record<string, NvrDevice>>({});
  const [activeNvrId, setActiveNvrId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<number | null>(null);
  const [tunnelFrame, setTunnelFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const autoConnectedRef = useRef(false);

  // Cargar camera_routes
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'camera_routes'), (snap) => {
      const routes: CameraRoute[] = [];
      snap.forEach((d) => {
        const id = d.id;
        const parts = id.split('__');
        if (parts.length !== 2) return;
        const nvrId = parts[0];
        const channel = parseInt(parts[1], 10);
        if (!nvrId || !Number.isFinite(channel) || channel < 1) return;
        if (d.data().enabled === false) return;
        routes.push({ id, nvrId, channel, camera_name: d.data().camera_name || `Canal ${channel}`, enabled: true });
      });
      routes.sort((a, b) => a.nvrId.localeCompare(b.nvrId) || a.channel - b.channel);
      setCameras(routes);

      // Cargar nvr_devices para cada NVR único
      const nvrIds = [...new Set(routes.map(r => r.nvrId))];
      nvrIds.forEach(async (nId) => {
        const snap = await getDoc(doc(db, 'nvr_devices', nId));
        if (snap.exists() && mountedRef.current) {
          setNvrs(prev => ({ ...prev, [nId]: { id: nId, ...snap.data() } as NvrDevice }));
        }
      });
    });
    return () => { mountedRef.current = false; unsub(); };
  }, []);

  const connectToCamera = useCallback(async (nvrId: string, channel: number) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setTunnelFrame(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setActiveNvrId(nvrId);
    setActiveChannel(channel);
    setStatus('connecting');
    setErrorMsg(null);

    if (!TUNNEL_WS_URL) {
      setStatus('error');
      setErrorMsg('Variable NEXT_PUBLIC_TUNNEL_WS_URL no configurada.');
      return;
    }
    const user = getAuth().currentUser;
    if (!user) {
      setStatus('error');
      setErrorMsg('Iniciá sesión para ver en vivo.');
      return;
    }
    const token = await user.getIdToken();
    const base = TUNNEL_WS_URL.replace(/\/$/, '');
    const wsUrl = `${base}/live?nvrId=${encodeURIComponent(nvrId)}&channel=${encodeURIComponent(String(channel))}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    let firstFrame = true;
    ws.onmessage = (ev) => {
      if (!ev.data) return;
      if (firstFrame) { firstFrame = false; if (mountedRef.current) setStatus('connected'); }
      const applyFrame = (blob: Blob) => {
        if (!mountedRef.current || blob.size === 0) return;
        const url = URL.createObjectURL(blob);
        setTunnelFrame(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      };
      const d = ev.data;
      if (d instanceof ArrayBuffer) { applyFrame(new Blob([d], { type: 'image/jpeg' })); return; }
      if (d instanceof Blob) { applyFrame(d); return; }
      if (typeof (d as Blob).arrayBuffer === 'function') {
        (d as Blob).arrayBuffer().then(buf => { if (buf?.byteLength > 0) applyFrame(new Blob([buf], { type: 'image/jpeg' })); }).catch(() => {});
      }
    };
    ws.onerror = () => { if (mountedRef.current) { setStatus('error'); setErrorMsg('Error de conexión al túnel.'); } };
    ws.onclose = (e) => {
      if (!mountedRef.current) return;
      if (e.code === 4002 || e.reason?.includes('no conectado') || e.reason?.includes('Agente')) {
        setStatus('error'); setErrorMsg('El agente NVR no está conectado. Verificá que esté corriendo.');
      } else if (e.code !== 1000) {
        setStatus('error'); setErrorMsg(`Túnel cerrado (${e.code}). ¿El agente está corriendo?`);
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(1000, 'user_disconnect'); wsRef.current = null; }
    setTunnelFrame(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setStatus('idle');
    setActiveNvrId(null);
    setActiveChannel(null);
    setErrorMsg(null);
  }, []);

  // Auto-conectar si vienen params en la URL (desde modal de alerta)
  useEffect(() => {
    if (!urlNvrId || !urlChannel || autoConnectedRef.current) return;
    const ch = parseInt(String(urlChannel), 10);
    if (!Number.isFinite(ch) || ch < 1) return;
    autoConnectedRef.current = true;
    connectToCamera(String(urlNvrId), ch);
  }, [urlNvrId, urlChannel, connectToCamera]);

  useEffect(() => () => { mountedRef.current = false; disconnect(); }, [disconnect]);

  const activeCamera = cameras.find(c => c.nvrId === activeNvrId && c.channel === activeChannel);
  const nvrGroups = cameras.reduce((acc, cam) => {
    if (!acc[cam.nvrId]) acc[cam.nvrId] = [];
    acc[cam.nvrId].push(cam);
    return acc;
  }, {} as Record<string, CameraRoute[]>);

  return (
    <>
      <Head><title>Video en vivo – Operaciones</title></Head>
      <DashboardLayout>
        <div className="p-4 md:p-6 max-w-6xl mx-auto">

          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Link href="/admin/operaciones" className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600" aria-label="Volver a Operaciones">
              <ArrowLeft size={20} />
            </Link>
            <Radio className="text-emerald-600" size={24} />
            <h1 className="text-xl font-bold text-slate-800">Video en vivo</h1>
          </div>

          {/* Panel de reproducción activo */}
          {activeNvrId && (
            <div className="mb-6 rounded-xl overflow-hidden border border-slate-200 shadow-lg bg-slate-900">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-white">
                <div className="flex items-center gap-3">
                  {status === 'connected' && (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse inline-block" /> EN VIVO
                    </span>
                  )}
                  {status === 'connecting' && <span className="text-xs text-amber-400 animate-pulse">Conectando...</span>}
                  {status === 'error' && <span className="text-xs text-rose-400">Sin señal</span>}
                  <span className="text-sm font-semibold">{activeCamera?.camera_name || `Canal ${activeChannel}`}</span>
                  <span className="text-slate-400 text-xs">{activeNvrId} · Canal {activeChannel}</span>
                </div>
                <button type="button" onClick={disconnect} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Cerrar">
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-[360px] flex items-center justify-center bg-black">
                {tunnelFrame ? (
                  <img src={tunnelFrame} alt="Canal en vivo" className="max-w-full max-h-[65vh] object-contain" />
                ) : errorMsg ? (
                  <div className="text-center p-8">
                    <AlertCircle className="text-rose-400 mx-auto mb-3" size={36} />
                    <p className="text-slate-300 text-sm max-w-xs">{errorMsg}</p>
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm">Conectando al agente...</p>
                )}
              </div>
            </div>
          )}

          {/* Tarjetas de cámaras agrupadas por NVR */}
          {cameras.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Camera size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-medium">No hay cámaras configuradas.</p>
              <p className="text-sm mt-1">
                Configurá canales en{' '}
                <Link href="/admin/camera-routes" className="text-indigo-600 hover:underline">Cámaras / Rutas</Link>.
              </p>
            </div>
          ) : (
            Object.entries(nvrGroups).map(([nvrId, cams]) => {
              const nvr = nvrs[nvrId];
              const isOnline = nvr?.agent_registered === true || nvr?.stream_via_tunnel === true;
              return (
                <div key={nvrId} className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    {isOnline
                      ? <Wifi size={15} className="text-emerald-500" />
                      : <WifiOff size={15} className="text-slate-400" />}
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                      {nvr?.name || nvrId}
                    </h2>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {isOnline ? 'Agente en línea' : 'Agente desconectado'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {cams.map(cam => {
                      const isActive = cam.nvrId === activeNvrId && cam.channel === activeChannel;
                      return (
                        <button
                          key={cam.id}
                          type="button"
                          onClick={() => isActive ? disconnect() : connectToCamera(cam.nvrId, cam.channel)}
                          className={`rounded-xl border-2 overflow-hidden text-left transition-all hover:shadow-md active:scale-95 ${
                            isActive ? 'border-emerald-500 ring-2 ring-emerald-100 shadow-md' : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="aspect-video bg-slate-900 flex items-center justify-center relative">
                            {isActive && tunnelFrame ? (
                              <img src={tunnelFrame} alt={cam.camera_name} className="w-full h-full object-cover" />
                            ) : (
                              <Camera size={22} className={isActive ? 'text-emerald-400' : 'text-slate-600'} />
                            )}
                            {isActive && status === 'connected' && (
                              <span className="absolute top-1.5 right-1.5 bg-rose-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                VIVO
                              </span>
                            )}
                            {isActive && status === 'connecting' && (
                              <span className="absolute top-1.5 right-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse">
                                ...
                              </span>
                            )}
                          </div>
                          <div className="p-2 bg-white">
                            <p className="text-xs font-bold text-slate-800 truncate">{cam.camera_name}</p>
                            <p className="text-[10px] text-slate-400">Canal {cam.channel}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DashboardLayout>
    </>
  );
}
