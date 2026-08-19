import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';
export const PANEL_VERSION = 'v5';

const DEFAULT_ORIGIN = 'https://comtroldata.web.app';

export function buildApkPreviewUrl(empDocId: string): string {
  const base = process.env.NEXT_PUBLIC_MOBILE_PREVIEW_LINK_BASE?.trim();
  if (base) {
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}emp=${encodeURIComponent(empDocId)}`;
  }
  return `cosp-guardia://preview?emp=${encodeURIComponent(empDocId)}`;
}

/** Escaneá ESTE con la app Expo Go → abre COSP Guardia nativo. */
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

/** Escaneá con la cámara del celular → abre Chrome/Safari. */
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

function CopyButton({ text, label }: { text: string; label: string }) {
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
      className="px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-[9px] font-bold text-white"
    >
      {copied ? '✓' : label}
    </button>
  );
}

function QrBlock({
  title,
  subtitle,
  borderClass,
  titleClass,
  dataUrl,
  url,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  borderClass: string;
  titleClass: string;
  dataUrl: string | null;
  url: string;
  emptyHint?: string;
}) {
  return (
    <div className={`flex-1 min-w-[140px] rounded-xl border-2 ${borderClass} p-3 flex flex-col items-center gap-2`}>
      <p className={`text-[10px] font-black uppercase text-center ${titleClass}`}>{title}</p>
      <p className="text-[9px] text-slate-400 text-center leading-snug">{subtitle}</p>
      {dataUrl ? (
        <img src={dataUrl} alt={title} className="rounded-lg bg-white p-2 w-[130px] h-[130px] object-contain" />
      ) : (
        <div className="w-[130px] h-[130px] rounded-lg bg-slate-800 flex items-center justify-center p-2">
          <p className="text-[9px] text-amber-400 text-center">{emptyHint || '…'}</p>
        </div>
      )}
      {url ? (
        <>
          <p className="text-[8px] text-slate-500 font-mono break-all text-center leading-tight">{url}</p>
          <CopyButton text={url} label="Copiar" />
        </>
      ) : null}
    </div>
  );
}

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [httpsQr, setHttpsQr] = useState<string | null>(null);
  const [expoQr, setExpoQr] = useState<string | null>(null);
  const [expoHost, setExpoHost] = useState('');
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN);

  useEffect(() => {
    setExpoHost(readStoredExpoHost());
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
      setOrigin(window.location.origin);
    }
  }, []);

  const httpsUrl = useMemo(
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
    QRCode.toDataURL(httpsUrl, { width: 140, margin: 2, errorCorrectionLevel: 'M' })
      .then((v) => { if (!cancelled) setHttpsQr(v); })
      .catch(() => { if (!cancelled) setHttpsQr(null); });
    return () => { cancelled = true; };
  }, [httpsUrl]);

  useEffect(() => {
    if (!expoUrl) {
      setExpoQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(expoUrl, { width: 140, margin: 2, errorCorrectionLevel: 'M' })
      .then((v) => { if (!cancelled) setExpoQr(v); })
      .catch(() => { if (!cancelled) setExpoQr(null); });
    return () => { cancelled = true; };
  }, [expoUrl]);

  function saveHost() {
    storeExpoHost(expoHost);
  }

  return (
    <div className={`rounded-2xl border border-slate-700 bg-slate-900/95 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-3`}>
      <div>
        <p className="text-[11px] font-black uppercase text-orange-400">App móvil · {employeeName}</p>
        <p className="text-[10px] text-slate-500">Panel {PANEL_VERSION} · Ctrl+Shift+R si no ves dos QR</p>
      </div>

      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={expoHost}
          onChange={(e) => setExpoHost(e.target.value)}
          onBlur={saveHost}
          placeholder="IP Metro · 192.168.0.49:8081"
          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono"
        />
        <button type="button" onClick={saveHost} className="px-2 py-1.5 rounded-lg bg-slate-700 text-[10px] font-bold text-white">
          Guardar
        </button>
      </div>

      <div className={`flex gap-3 ${compact ? 'flex-col' : 'flex-row flex-wrap'}`}>
        <QrBlock
          title="① Cámara / Chrome"
          subtitle="Escaneá con la app Cámara. Abre el portal web en el navegador."
          borderClass="border-emerald-700/70"
          titleClass="text-emerald-400"
          dataUrl={httpsQr}
          url={httpsUrl}
        />
        <QrBlock
          title="② Expo Go"
          subtitle="Abrí Expo Go → Scan QR → escaneá ESTE código (no el verde)."
          borderClass="border-orange-600/70"
          titleClass="text-orange-400"
          dataUrl={expoQr}
          url={expoUrl}
          emptyHint="Cargá IP Metro arriba y Guardar"
        />
      </div>

      <div className="rounded-lg bg-amber-950/40 border border-amber-800/50 px-3 py-2 text-[10px] text-amber-200 leading-relaxed">
        <span className="font-black">Importante:</span> si escaneás el QR verde (https) con Expo Go, te manda a la web — es normal.
        Para la app nativa usá el QR naranja <span className="font-bold">②</span> dentro de Expo Go, con{' '}
        <code className="text-amber-100">npm run dev:mobile</code> corriendo en la PC.
      </div>

      <a href={webUrl} className="text-center text-[11px] font-bold text-indigo-400 hover:text-indigo-300 underline">
        Preview web en esta pestaña
      </a>
    </div>
  );
}

export { buildAppBridgeUrl as buildMobilePreviewUrl };
