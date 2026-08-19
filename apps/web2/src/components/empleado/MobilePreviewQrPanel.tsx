import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';
export const PANEL_VERSION = 'v4';

const DEFAULT_ORIGIN = 'https://comtroldata.web.app';

export function buildApkPreviewUrl(empDocId: string): string {
  const base = process.env.NEXT_PUBLIC_MOBILE_PREVIEW_LINK_BASE?.trim();
  if (base) {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}emp=${encodeURIComponent(empDocId)}`;
  }
  return `cosp-guardia://preview?emp=${encodeURIComponent(empDocId)}`;
}

export function buildExpoGoPreviewUrl(hostPort: string, empDocId: string): string {
  const raw = hostPort.trim().replace(/^exp:\/\//i, '').replace(/\/+$/, '');
  const withoutPath = raw.split('/')[0] ?? raw;
  const normalized = withoutPath.includes(':') ? withoutPath : `${withoutPath}:8081`;
  return `exp://${normalized}/--/preview?emp=${encodeURIComponent(empDocId)}`;
}

export function buildWebPreviewUrl(origin: string, empDocId: string): string {
  const base = (origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
  return `${base}/empleado/dashboard?preview=${encodeURIComponent(empDocId)}`;
}

/** Único QR válido para la cámara del celular (HTTPS). */
export function buildAppBridgeUrl(origin: string, empDocId: string, metroHost?: string): string {
  const base = (origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
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

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white"
    >
      {copied ? 'Copiado ✓' : label || 'Copiar enlace'}
    </button>
  );
}

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [cameraQr, setCameraQr] = useState<string | null>(null);
  const [expoHost, setExpoHost] = useState('');
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);

  useEffect(() => {
    setExpoHost(readStoredExpoHost());
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
      setOrigin(window.location.origin);
    }
  }, []);

  const cameraUrl = useMemo(
    () => buildAppBridgeUrl(origin, empDocId, expoHost),
    [origin, empDocId, expoHost],
  );

  const webUrl = useMemo(() => buildWebPreviewUrl(origin, empDocId), [origin, empDocId]);

  const expoUrl = useMemo(() => {
    if (!expoHost.trim()) return '';
    return buildExpoGoPreviewUrl(expoHost, empDocId);
  }, [expoHost, empDocId]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(cameraUrl, { width: compact ? 140 : 168, margin: 2, errorCorrectionLevel: 'M' })
      .then((v) => { if (!cancelled) setCameraQr(v); })
      .catch(() => { if (!cancelled) setCameraQr(null); });
    return () => { cancelled = true; };
  }, [cameraUrl, compact]);

  function saveHost() {
    storeExpoHost(expoHost);
  }

  return (
    <div className={`rounded-2xl border-2 border-emerald-700/60 bg-slate-900/95 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-3`}>
      <div>
        <p className="text-[11px] font-black uppercase tracking-wide text-emerald-400">
          QR para cámara del celular · {employeeName}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">Panel {PANEL_VERSION}</p>
      </div>

      <div className="rounded-xl bg-emerald-950/50 border border-emerald-800/50 px-3 py-2">
        <p className="text-[11px] text-emerald-200 leading-relaxed font-semibold">
          Escaneá SOLO este QR con la app Cámara. Abre Chrome/Safari con un enlace https:// (no exp:// ni cosp-guardia://).
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          Si el teléfono dice «no hay aplicación», estás escaneando otro QR (Expo/APK) o tenés caché vieja — Ctrl+Shift+R.
        </p>
      </div>

      {cameraQr ? (
        <img src={cameraQr} alt={`QR HTTPS ${employeeName}`} className="rounded-xl bg-white p-3 self-center shadow-lg" />
      ) : (
        <div className="w-[168px] h-[168px] rounded-xl bg-slate-800 animate-pulse self-center" />
      )}

      <p className="text-[10px] text-emerald-300/90 font-mono break-all text-center leading-relaxed">{cameraUrl}</p>

      <div className="flex flex-wrap gap-2 justify-center">
        <CopyButton text={cameraUrl} label="Copiar enlace HTTPS" />
        <a
          href={cameraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-[10px] font-bold text-white"
        >
          Abrir enlace
        </a>
      </div>

      <div className="border-t border-slate-800 pt-3 space-y-2">
        <p className="text-[10px] font-black uppercase text-slate-500">IP Metro (opcional, lab Expo Go)</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={expoHost}
            onChange={(e) => setExpoHost(e.target.value)}
            onBlur={saveHost}
            placeholder="192.168.0.49:8081"
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono"
          />
          <button type="button" onClick={saveHost} className="px-2 py-1.5 rounded-lg bg-slate-700 text-[10px] font-bold text-white">
            Guardar
          </button>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Tras escanear el QR HTTPS, en la página elegí «Abrir en Expo Go» o copiá este enlace en Expo Go → Enter URL manually:
        </p>
        {expoUrl ? (
          <div className="flex gap-2 items-start">
            <p className="text-[9px] text-orange-300/80 font-mono break-all flex-1">{expoUrl}</p>
            <CopyButton text={expoUrl} label="Copiar exp://" />
          </div>
        ) : (
          <p className="text-[10px] text-amber-500">Cargá IP Metro para ver el enlace exp://</p>
        )}
        <p className="text-[10px] text-slate-600">
          exp:// no funciona con la cámara — solo dentro de Expo Go o pegando la URL.
        </p>
      </div>

      <a href={webUrl} className="text-center text-[11px] font-bold text-indigo-400 hover:text-indigo-300 underline">
        Preview web directo (esta pestaña)
      </a>
    </div>
  );
}

export { buildAppBridgeUrl as buildMobilePreviewUrl };
