import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';

const DEFAULT_ORIGIN = 'https://comtroldata.web.app';

export function buildApkPreviewUrl(empDocId: string): string {
  const base = process.env.NEXT_PUBLIC_MOBILE_PREVIEW_LINK_BASE?.trim();
  if (base) {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}emp=${encodeURIComponent(empDocId)}`;
  }
  return `cosp-guardia://preview?emp=${encodeURIComponent(empDocId)}`;
}

/** Expo Go + expo-router: exp://IP:8081/--/preview?emp=... */
export function buildExpoGoPreviewUrl(hostPort: string, empDocId: string): string {
  const raw = hostPort.trim().replace(/^exp:\/\//i, '').replace(/\/+$/, '');
  const withoutPath = raw.split('/')[0] ?? raw;
  const normalized = withoutPath.includes(':') ? withoutPath : `${withoutPath}:8081`;
  return `exp://${normalized}/--/preview?emp=${encodeURIComponent(empDocId)}`;
}

/** Preview web SuperAdmin (navegador). */
export function buildWebPreviewUrl(origin: string, empDocId: string): string {
  const base = origin.replace(/\/+$/, '') || DEFAULT_ORIGIN;
  return `${base}/empleado/dashboard?preview=${encodeURIComponent(empDocId)}`;
}

/**
 * Enlace HTTPS recomendado para QR: abre comtroldata.web.app y redirige a app o web.
 * Escaneable con cualquier lector QR (cámara del celular).
 */
export function buildAppBridgeUrl(origin: string, empDocId: string, metroHost?: string): string {
  const base = origin.replace(/\/+$/, '') || DEFAULT_ORIGIN;
  const params = new URLSearchParams({ emp: empDocId });
  const metro = metroHost?.trim();
  if (metro) {
    const normalized = metro.replace(/^exp:\/\//i, '').split('/')[0] ?? metro;
    params.set('metro', normalized);
  }
  return `${base}/empleado/app-preview?${params.toString()}`;
}

export function readStoredExpoHost(): string {
  if (typeof window === 'undefined') return '';
  return (
    window.localStorage.getItem(EXPO_HOST_STORAGE_KEY) ||
    process.env.NEXT_PUBLIC_MOBILE_EXPO_PREVIEW_HOST?.trim() ||
    ''
  );
}

export function storeExpoHost(hostPort: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EXPO_HOST_STORAGE_KEY, hostPort.trim());
}

type Props = {
  empDocId: string;
  employeeName: string;
  compact?: boolean;
};

type QrMode = 'bridge' | 'web' | 'expo' | 'apk';

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<QrMode>('bridge');
  const [expoHost, setExpoHost] = useState('');
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);

  useEffect(() => {
    setExpoHost(readStoredExpoHost());
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin || DEFAULT_ORIGIN);
    }
  }, []);

  const url = useMemo(() => {
    switch (mode) {
      case 'web':
        return buildWebPreviewUrl(origin, empDocId);
      case 'bridge':
        return buildAppBridgeUrl(origin, empDocId, expoHost);
      case 'apk':
        return buildApkPreviewUrl(empDocId);
      case 'expo':
        if (!expoHost.trim()) return '';
        return buildExpoGoPreviewUrl(expoHost, empDocId);
      default:
        return '';
    }
  }, [mode, expoHost, empDocId, origin]);

  useEffect(() => {
    if (!url) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(url, { width: compact ? 120 : 148, margin: 1 })
      .then((value) => {
        if (!cancelled) setDataUrl(value);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, compact]);

  function saveHost() {
    storeExpoHost(expoHost);
  }

  const needsMetro = mode === 'expo' || mode === 'bridge';

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/80 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-2 self-stretch">
        <p className="text-[11px] font-black uppercase tracking-wide text-orange-400 flex-1 min-w-[120px]">
          QR ingreso · {employeeName}
        </p>
        <div className="flex flex-wrap rounded-lg overflow-hidden border border-slate-700 text-[9px] font-black uppercase">
          {(
            [
              ['bridge', 'App HTTPS'],
              ['web', 'Solo web'],
              ['expo', 'Expo'],
              ['apk', 'APK'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`px-2 py-1 ${mode === key ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-snug">
        {mode === 'bridge' && (
          <>
            <span className="text-emerald-300 font-bold">Recomendado:</span> enlace{' '}
            <code className="text-slate-300">comtroldata.web.app/empleado/app-preview</code>. La cámara del celular
            abre el navegador e intenta lanzar la app (Expo o APK). Si no hay app, cae al portal web.
          </>
        )}
        {mode === 'web' && (
          <>
            Solo navegador:{' '}
            <code className="text-slate-300">/empleado/dashboard?preview=…</code> (vista previa SuperAdmin web).
          </>
        )}
        {mode === 'expo' && (
          <>
            Directo a Expo Go (<code className="text-slate-400">exp://</code>). Requiere Metro en la PC y misma Wi‑Fi.
          </>
        )}
        {mode === 'apk' && (
          <>
            Directo al APK instalado (<code className="text-slate-400">cosp-guardia://</code>). No funciona con Expo Go.
          </>
        )}
      </p>

      {needsMetro ? (
        <div className="flex gap-2 items-center self-stretch">
          <input
            type="text"
            value={expoHost}
            onChange={(e) => setExpoHost(e.target.value)}
            onBlur={saveHost}
            placeholder="IP Metro opcional · 192.168.0.49:8081"
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono placeholder-slate-600"
          />
          <button
            type="button"
            onClick={saveHost}
            className="shrink-0 px-2 py-1.5 rounded-lg bg-slate-700 text-[10px] font-bold text-white hover:bg-slate-600"
          >
            Guardar IP
          </button>
        </div>
      ) : null}

      {url && dataUrl ? (
        <img src={dataUrl} alt={`QR preview ${employeeName}`} className="rounded-xl bg-white p-2 self-center" />
      ) : mode === 'expo' && !expoHost.trim() ? (
        <p className="text-[11px] text-amber-400 text-center py-4">
          Ingresá IP:puerto de Metro (ej. 192.168.0.49:8081)
        </p>
      ) : (
        <div className="w-[148px] h-[148px] rounded-xl bg-slate-800 animate-pulse self-center" />
      )}

      {url ? (
        <p className="text-[9px] text-slate-500 font-mono break-all text-center">{url}</p>
      ) : null}
    </div>
  );
}

export { buildAppBridgeUrl as buildMobilePreviewUrl };
