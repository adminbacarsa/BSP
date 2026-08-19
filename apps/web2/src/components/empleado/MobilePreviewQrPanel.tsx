import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';

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

type QrMode = 'expo' | 'apk';

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<QrMode>('expo');
  const [expoHost, setExpoHost] = useState('');

  useEffect(() => {
    setExpoHost(readStoredExpoHost());
  }, []);

  const url = useMemo(() => {
    if (mode === 'apk') return buildApkPreviewUrl(empDocId);
    if (!expoHost.trim()) return '';
    return buildExpoGoPreviewUrl(expoHost, empDocId);
  }, [mode, expoHost, empDocId]);

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

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/80 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-2 self-stretch">
        <p className="text-[11px] font-black uppercase tracking-wide text-orange-400 flex-1 min-w-[120px]">
          App móvil · QR ingreso
        </p>
        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[10px] font-black uppercase">
          <button
            type="button"
            onClick={() => setMode('expo')}
            className={`px-2.5 py-1 ${mode === 'expo' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            Expo Go
          </button>
          <button
            type="button"
            onClick={() => setMode('apk')}
            className={`px-2.5 py-1 ${mode === 'apk' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            APK
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-snug">
        {mode === 'expo' ? (
          <>
            <span className="text-amber-300 font-bold">Expo Go:</span> mismo Wi‑Fi,{' '}
            <code className="text-slate-300">npm run dev:mobile</code> activo y SuperAdmin logueado en la app.
            Preview como <span className="text-slate-200 font-bold">{employeeName}</span>.
          </>
        ) : (
          <>
            <span className="text-slate-300 font-bold">APK instalado</span> (no Expo Go). Scheme{' '}
            <code className="text-slate-400">cosp-guardia://</code>
          </>
        )}
      </p>

      {mode === 'expo' ? (
        <div className="flex gap-2 items-center self-stretch">
          <input
            type="text"
            value={expoHost}
            onChange={(e) => setExpoHost(e.target.value)}
            onBlur={saveHost}
            placeholder="192.168.0.49:8081"
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
          Ingresá la IP:puerto de Metro (la misma del QR de Expo en la PC, ej. 192.168.0.49:8081)
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

export { buildApkPreviewUrl as buildMobilePreviewUrl };
