import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ArrowLeft, ExternalLink, Radio, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';

const PLAYER_BASE = '/dahua-sdk/live.html';
const TUNNEL_WS_URL = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_TUNNEL_WS_URL || '').trim() : '';

/**
 * Página de video en vivo Dahua (NVR/cámara).
 * - Con ?nvrId=...&channel=...: si el NVR tiene stream_via_tunnel o agent_registered y hay NEXT_PUBLIC_TUNNEL_WS_URL, usa túnel saliente; si no, conexión directa al NVR (iframe + postMessage).
 */
export default function VivoPage() {
  const router = useRouter();
  const { nvrId, channel } = router.query as { nvrId?: string; channel?: string };
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [nvrParams, setNvrParams] = useState<{ ip: string; port: number; user: string; pass: string; channel: number } | null>(null);
  const [useTunnel, setUseTunnel] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [tunnelFrame, setTunnelFrame] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!nvrId || !channel) {
      setNvrParams(null);
      setUseTunnel(false);
      setLoadError(null);
      return;
    }
    const ch = parseInt(String(channel), 10);
    if (!Number.isFinite(ch) || ch < 1) {
      setLoadError('Canal inválido');
      return;
    }
    let cancelled = false;
    setLoadError(null);
    setUseTunnel(false);
    getDoc(doc(db, 'nvr_devices', nvrId))
      .then(async (snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setLoadError('NVR no encontrado. Configurá la conexión en Cámaras → NVR.');
          return;
        }
        const data = snap.data();
        const viaTunnel = Boolean(TUNNEL_WS_URL && (data?.stream_via_tunnel === true || data?.agent_registered === true));
        if (viaTunnel) {
          setUseTunnel(true);
          setNvrParams(null);
          const user = getAuth().currentUser;
          if (!user) {
            setLoadError('Iniciá sesión para ver en vivo por túnel.');
            return;
          }
          const token = await user.getIdToken();
          const base = TUNNEL_WS_URL.replace(/\/$/, '');
          const wsUrl = `${base}/live?nvrId=${encodeURIComponent(nvrId)}&channel=${encodeURIComponent(String(ch))}&token=${encodeURIComponent(token)}`;
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;
          ws.binaryType = 'arraybuffer';
          ws.onmessage = (ev) => {
            if (cancelled || !ev.data) return;
            const d = ev.data;
            const applyFrame = (blob: Blob) => {
              if (blob.size > 0) {
                const url = URL.createObjectURL(blob);
                setTunnelFrame((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return url;
                });
              }
            };
            if (d instanceof ArrayBuffer) {
              applyFrame(new Blob([d], { type: 'image/jpeg' }));
              return;
            }
            if (d instanceof Blob) {
              applyFrame(d);
              return;
            }
            if (typeof (d as Blob).arrayBuffer === 'function') {
              (d as Blob).arrayBuffer().then((buf) => {
                if (!cancelled && buf && buf.byteLength > 0) applyFrame(new Blob([buf], { type: 'image/jpeg' }));
              }).catch(() => {});
              return;
            }
          };
          ws.onerror = () => { if (!cancelled) setLoadError('Error de conexión al túnel.'); };
          ws.onclose = (e) => { if (!cancelled && e.code !== 1000) setLoadError('Túnel cerrado. ¿El agente está conectado?'); };
          return;
        }
        const ip = (data?.stream_ip || '').toString().trim();
        if (!ip) {
          setLoadError('Este NVR no tiene IP de conexión. Entrá a Cámaras, seleccioná el NVR y completá "Conexión para video en vivo".');
          return;
        }
        const port = parseInt(String(data?.stream_port || 80), 10) || 80;
        setNvrParams({
          ip,
          port,
          user: (data?.stream_user || 'admin').toString().trim(),
          pass: (data?.stream_password || '').toString(),
          channel: ch,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError('Error al cargar datos del NVR. Revisá permisos.');
          console.error(err);
        }
      });
    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setTunnelFrame((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [nvrId, channel]);

  useEffect(() => {
    if (!nvrParams || !iframeRef.current || !iframeReady) return;
    try {
      const win = iframeRef.current.contentWindow;
      if (win) {
        win.postMessage(
          {
            type: 'DahuaConnect',
            ip: nvrParams.ip,
            port: nvrParams.port,
            user: nvrParams.user,
            pass: nvrParams.pass,
            channel: nvrParams.channel,
            subtype: 0,
            autoConnect: true,
          },
          window.location.origin
        );
      }
    } catch (e) {
      console.error('postMessage to player', e);
    }
  }, [nvrParams, iframeReady]);

  const playerUrl = PLAYER_BASE;
  const fromAlert = Boolean(nvrId && channel);

  return (
    <>
      <Head>
        <title>Vivo – Operaciones</title>
      </Head>
      <DashboardLayout>
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <Link
                href="/admin/operaciones"
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                aria-label="Volver a Operaciones"
              >
                <ArrowLeft size={20} />
              </Link>
              <div className="flex items-center gap-2">
                <Radio className="text-emerald-600" size={24} />
                <h1 className="text-xl font-bold text-slate-800">Video en vivo</h1>
                {fromAlert && nvrParams && (
                  <span className="text-sm font-medium text-slate-500">NVR {nvrId} · Canal {channel}</span>
                )}
              </div>
            </div>
            <a
              href={playerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <ExternalLink size={16} />
              Abrir en nueva pestaña
            </a>
          </div>

          {!fromAlert && (
            <p className="text-sm text-slate-500 mb-4">
              Reproductor Dahua H5 (sin plugins). IP por defecto: <strong>192.168.0.102</strong>. Debe estar en la misma red que el NVR/cámara.
            </p>
          )}

          {loadError && (
            <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
              <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-medium text-amber-800">{loadError}</p>
                <Link href="/admin/camera-routes" className="text-sm text-amber-700 hover:underline mt-1 inline-block">Ir a NVR y canales →</Link>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-900" style={{ minHeight: '480px' }}>
            {useTunnel ? (
              <div className="w-full min-h-[520px] flex items-center justify-center bg-black">
                {tunnelFrame ? (
                  <img src={tunnelFrame} alt="Canal en vivo (túnel)" className="max-w-full max-h-[80vh] object-contain" />
                ) : loadError ? (
                  <p className="text-amber-400 text-sm">{loadError}</p>
                ) : (
                  <p className="text-slate-400 text-sm">Conectando al agente...</p>
                )}
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                src={playerUrl}
                title="Reproductor en vivo Dahua"
                className="w-full h-full min-h-[520px] border-0"
                allow="autoplay"
                onLoad={() => setIframeReady(true)}
              />
            )}
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}
