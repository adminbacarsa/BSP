import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';
export const PANEL_VERSION = 'v3';

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

export function buildWebPreviewUrl(origin: string, empDocId: string): string {
  const base = origin.replace(/\/+$/, '') || DEFAULT_ORIGIN;
  return `${base}/empleado/dashboard?preview=${encodeURIComponent(empDocId)}`;
}

/** QR escaneable con la cámara del celular (HTTPS). */
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

type QrMode = 'bridge' | 'expo';

function CopyButton({ text }: { text: string }) {
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
      className="shrink-0 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white"
    >
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [bridgeQr, setBridgeQr] = useState<string | null>(null);
  const [expoQr, setExpoQr] = useState<string | null>(null);
  const [mode, setMode] = useState<QrMode>('bridge');
  const [expoHost, setExpoHost] = useState('');
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setExpoHost(readStoredExpoHost());
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin || DEFAULT_ORIGIN);
    }
  }, []);

  const bridgeUrl = useMemo(
    () => buildAppBridgeUrl(origin, empDocId, expoHost),
    [origin, empDocId, expoHost],
  );

  const expoUrl = useMemo(() => {
    if (!expoHost.trim()) return '';
    return buildExpoGoPreviewUrl(expoHost, empDocId);
  }, [expoHost, empDocId]);

  const webUrl = useMemo(() => buildWebPreviewUrl(origin, empDocId), [origin, empDocId]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(bridgeUrl, { width: compact ? 132 : 160, margin: 1 })
      .then((v) => { if (!cancelled) setBridgeQr(v); })
      .catch(() => { if (!cancelled) setBridgeQr(null); });
    return () => { cancelled = true; };
  }, [bridgeUrl, compact]);

  useEffect(() => {
    if (!expoUrl) {
      setExpoQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(expoUrl, { width: compact ? 132 : 160, margin: 1 })
      .then((v) => { if (!cancelled) setExpoQr(v); })
      .catch(() => { if (!cancelled) setExpoQr(null); });
    return () => { cancelled = true; };
  }, [expoUrl, compact]);

  function saveHost() {
    storeExpoHost(expoHost);
  }

  const activeQr = mode === 'expo' ? expoQr : bridgeQr;
  const activeUrl = mode === 'expo' ? expoUrl : bridgeUrl;

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/90 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-2.5`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[140px]">
          <p className="text-[11px] font-black uppercase tracking-wide text-orange-400">
            App móvil · {employeeName}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Panel {PANEL_VERSION} · Ctrl+F5 si ves tabs APK viejas</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-slate-700 text-[9px] font-black uppercase">
          <button
            type="button"
            onClick={() => setMode('bridge')}
            className={`px-2.5 py-1 ${mode === 'bridge' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            HTTPS
          </button>
          <button
            type="button"
            onClick={() => setMode('expo')}
            className={`px-2.5 py-1 ${mode === 'expo' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            Expo Go
          </button>
        </div>
      </div>

      {mode === 'bridge' ? (
        <p className="text-[11px] text-slate-400 leading-snug">
          <span className="text-emerald-300 font-bold">Escaneá con la cámara del celular.</span> Abre{' '}
          <code className="text-slate-300">comtroldata.web.app/empleado/app-preview</code> y desde ahí podés
          lanzar Expo Go (con IP abajo) o ver el portal web.
        </p>
      ) : (
        <p className="text-[11px] text-amber-300 leading-snug font-semibold">
          Escaneá este QR <span className="underline">desde la app Expo Go</span> (pestaña Projects → Scan QR).
          No funciona con la cámara del sistema ni con el modo APK.
        </p>
      )}

      <div className="flex gap-2 items-center self-stretch">
        <input
          type="text"
          value={expoHost}
          onChange={(e) => setExpoHost(e.target.value)}
          onBlur={saveHost}
          placeholder="IP Metro · 192.168.0.49:8081 (npm run dev:mobile)"
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono placeholder-slate-600"
        />
        <button
          type="button"
          onClick={saveHost}
          className="shrink-0 px-2 py-1.5 rounded-lg bg-slate-700 text-[10px] font-bold text-white hover:bg-slate-600"
        >
          Guardar
        </button>
      </div>

      {mode === 'expo' && !expoHost.trim() ? (
        <p className="text-[11px] text-amber-400 text-center py-3">
          Cargá la IP:puerto que muestra Metro al ejecutar npm run dev:mobile
        </p>
      ) : activeQr ? (
        <img src={activeQr} alt={`QR ${employeeName}`} className="rounded-xl bg-white p-2 self-center" />
      ) : (
        <div className="w-[160px] h-[160px] rounded-xl bg-slate-800 animate-pulse self-center" />
      )}

      {activeUrl ? (
        <div className="flex gap-2 items-start">
          <p className="text-[9px] text-slate-500 font-mono break-all flex-1 text-center">{activeUrl}</p>
          <CopyButton text={activeUrl} />
        </div>
      ) : null}

      <a
        href={webUrl}
        className="text-center text-[11px] font-bold text-indigo-400 hover:text-indigo-300 underline"
      >
        Abrir preview web en esta pestaña
      </a>

      {!compact ? (
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[10px] text-slate-500 hover:text-slate-300 self-start"
        >
          {showAdvanced ? '▾ Ocultar' : '▸'} APK instalado (cosp-guardia://)
        </button>
      ) : null}
      {showAdvanced && !compact ? (
        <p className="text-[10px] text-slate-500 font-mono break-all">{buildApkPreviewUrl(empDocId)}</p>
      ) : null}
    </div>
  );
}

export { buildAppBridgeUrl as buildMobilePreviewUrl };
