import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';
export const PANEL_VERSION = 'prod-2';

const FALLBACK_ORIGIN = 'https://comtroldata.web.app';

export function getPreviewOrigin(): string {
  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }
  return FALLBACK_ORIGIN;
}

export function buildApkPreviewUrl(empDocId: string): string {
  return `cosp-guardia://preview?emp=${encodeURIComponent(empDocId)}`;
}

export function buildExpoGoPreviewUrl(hostPort: string, empDocId: string): string {
  const normalized = normalizeMetroHost(hostPort);
  if (!normalized) return '';
  return `exp://${normalized}/--/preview?emp=${encodeURIComponent(empDocId)}`;
}

export function normalizeMetroHost(input: string): string {
  const match = input.trim().match(/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?/);
  if (!match) return '';
  return `${match[1]}:${match[2] || '8081'}`;
}

/** Preview SuperAdmin en producción (mismo dominio donde estás logueado). */
export function buildWebPreviewUrl(origin: string, empDocId: string): string {
  const base = origin || getPreviewOrigin();
  return `${base}/empleado/dashboard?preview=${encodeURIComponent(empDocId)}`;
}

export function buildAppBridgeUrl(origin: string, empDocId: string, _metroHost?: string): string {
  return buildWebPreviewUrl(origin, empDocId);
}

export function readStoredExpoHost(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(EXPO_HOST_STORAGE_KEY) || '';
}

export function storeExpoHost(hostPort: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeMetroHost(hostPort);
  if (normalized) window.localStorage.setItem(EXPO_HOST_STORAGE_KEY, normalized);
}

type Props = {
  empDocId: string;
  employeeName: string;
  compact?: boolean;
};

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
      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold text-white"
    >
      {copied ? 'Copiado ✓' : 'Copiar enlace'}
    </button>
  );
}

export function MobilePreviewQrPanel({ empDocId, employeeName, compact }: Props) {
  const [prodQr, setProdQr] = useState<string | null>(null);
  const [showDev, setShowDev] = useState(false);
  const [expoHost, setExpoHost] = useState('');
  const [expoQr, setExpoQr] = useState<string | null>(null);
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN);

  const prodUrl = useMemo(() => buildWebPreviewUrl(origin, empDocId), [origin, empDocId]);
  const expoUrl = useMemo(() => (expoHost ? buildExpoGoPreviewUrl(expoHost, empDocId) : ''), [expoHost, empDocId]);
  const pickerUrl = `${origin}/empleado/dashboard?picker=1`;

  useEffect(() => {
    setOrigin(getPreviewOrigin());
    setExpoHost(readStoredExpoHost());
  }, []);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(prodUrl, { width: compact ? 140 : 168, margin: 2 })
      .then((v) => { if (!cancelled) setProdQr(v); })
      .catch(() => { if (!cancelled) setProdQr(null); });
    return () => { cancelled = true; };
  }, [prodUrl, compact]);

  useEffect(() => {
    if (!expoUrl || !showDev) {
      setExpoQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(expoUrl, { width: 130, margin: 2 })
      .then((v) => { if (!cancelled) setExpoQr(v); })
      .catch(() => { if (!cancelled) setExpoQr(null); });
    return () => { cancelled = true; };
  }, [expoUrl, showDev]);

  return (
    <div className={`rounded-2xl border border-indigo-700/50 bg-slate-900/95 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-3`}>
      <div>
        <p className="text-[11px] font-black uppercase text-indigo-300">Producción · {employeeName}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">Panel {PANEL_VERSION} · Producción · {origin.replace(/^https?:\/\//, '')}</p>
      </div>

      <div className="rounded-xl bg-indigo-950/60 border border-indigo-800/40 px-3 py-2.5 text-[11px] text-indigo-100 leading-relaxed">
        <p className="font-bold text-white mb-1">Preview web en producción</p>
        <p>
          Escaneá con la cámara del celular o abrí el enlace. Entrás al portal del guardia en{' '}
          <strong>{origin.replace(/^https?:\/\//, '')}</strong> (producción, misma sesión SuperAdmin).
        </p>
      </div>

      {prodQr ? (
        <img src={prodQr} alt="QR producción" className="rounded-xl bg-white p-3 self-center" />
      ) : null}

      <p className="text-[10px] text-indigo-200/80 font-mono break-all text-center">{prodUrl}</p>
      <div className="flex flex-wrap gap-2 justify-center">
        <CopyButton text={prodUrl} />
        <a
          href={prodUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-[10px] font-bold text-white"
        >
          Abrir preview
        </a>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-[10px] text-slate-400 leading-relaxed">
        <p className="font-bold text-slate-300 mb-1">App móvil nativa (APK)</p>
        <p>
          Sin APK instalado no hay app en prod desde QR. Cuando exista el build EAS, el QR será{' '}
          <code className="text-slate-500">cosp-guardia://preview</code> y login SuperAdmin en el celular.
        </p>
        <p className="mt-1 text-slate-500">Hoy: usá el preview web de arriba o el selector →</p>
        <a href={pickerUrl} className="text-indigo-400 underline font-semibold">
          Elegir otro guardia
        </a>
      </div>

      <button
        type="button"
        onClick={() => setShowDev((v) => !v)}
        className="text-[10px] text-slate-600 hover:text-slate-400 text-left"
      >
        {showDev ? '▾ Ocultar' : '▸'} Modo lab (Expo Go + notebook) — no producción
      </button>

      {showDev ? (
        <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 space-y-2">
          <p className="text-[10px] text-amber-200/90">
            Solo desarrollo: Metro en tu PC (<code>npm run dev:mobile</code>). IP de la terminal, escaneá con Expo Go.
          </p>
          <input
            type="text"
            value={expoHost}
            onChange={(e) => setExpoHost(e.target.value)}
            onBlur={() => storeExpoHost(expoHost)}
            placeholder="192.168.100.186:8081"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] font-mono text-white"
          />
          {expoQr ? <img src={expoQr} alt="QR Expo lab" className="rounded-lg bg-white p-2 self-center mx-auto" /> : null}
          {expoUrl ? <p className="text-[9px] font-mono text-amber-300/70 break-all">{expoUrl}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export { buildWebPreviewUrl as buildMobilePreviewUrl };
