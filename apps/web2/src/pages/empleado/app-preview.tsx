import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import QRCode from 'qrcode';
import AuthGuard from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import {
  buildExpoGoPreviewUrl,
  readStoredExpoHost,
  storeExpoHost,
} from '@/components/empleado/MobilePreviewQrPanel';

export default function EmpleadoAppPreviewPage() {
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const [expoHost, setExpoHost] = useState('');
  const [expoQr, setExpoQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const empId = useMemo(() => {
    const raw = router.query.emp;
    return typeof raw === 'string' ? raw.trim() : '';
  }, [router.query.emp]);

  const metroFromQuery = useMemo(() => {
    const raw = router.query.metro;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return '';
  }, [router.query.metro]);

  const effectiveMetro = metroFromQuery || expoHost;

  const webPreviewHref = empId
    ? `/empleado/dashboard?preview=${encodeURIComponent(empId)}`
    : '/empleado/dashboard?picker=1';

  const expoUrl = useMemo(() => {
    if (!empId || !effectiveMetro.trim()) return '';
    return buildExpoGoPreviewUrl(effectiveMetro, empId);
  }, [empId, effectiveMetro]);

  useEffect(() => {
    const stored = readStoredExpoHost();
    if (stored) setExpoHost(stored);
    else if (metroFromQuery) setExpoHost(metroFromQuery);
  }, [metroFromQuery]);

  useEffect(() => {
    if (!expoUrl) {
      setExpoQr(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(expoUrl, { width: 180, margin: 1 })
      .then((v) => { if (!cancelled) setExpoQr(v); })
      .catch(() => { if (!cancelled) setExpoQr(null); });
    return () => { cancelled = true; };
  }, [expoUrl]);

  useEffect(() => {
    if (!router.isReady || !empId || isSuperAdmin) return;
    window.location.replace(webPreviewHref);
  }, [router.isReady, empId, isSuperAdmin, webPreviewHref]);

  function saveMetro() {
    storeExpoHost(expoHost);
  }

  function copyExpoUrl() {
    if (!expoUrl) return;
    void navigator.clipboard.writeText(expoUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <AuthGuard>
      <Head>
        <title>Abrir app guardia | CronoApp</title>
      </Head>
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-lg space-y-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">COSP · Puente app móvil</p>
            <h1 className="text-xl font-black mt-2">Preview guardia en el celular</h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              Este enlace HTTPS funciona desde cualquier QR. Elegí cómo continuar:
            </p>
            {empId ? (
              <p className="text-[11px] text-slate-500 font-mono mt-3 break-all">emp={empId}</p>
            ) : (
              <p className="text-sm text-amber-400 mt-3">Falta el parámetro emp en la URL.</p>
            )}
          </div>

          <Link
            href={webPreviewHref}
            className="block w-full text-center rounded-2xl bg-indigo-600 hover:bg-indigo-500 py-3.5 text-sm font-black"
          >
            1 · Ver portal web (siempre funciona)
          </Link>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
            <p className="text-xs font-black text-orange-400 uppercase">2 · Expo Go (lab)</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Misma Wi‑Fi, <code className="text-slate-300">npm run dev:mobile</code> en la PC, SuperAdmin logueado en la app.
              Escaneá el QR de abajo <span className="text-white font-bold">desde Expo Go</span>, no con la cámara.
            </p>
            <input
              type="text"
              value={expoHost}
              onChange={(e) => setExpoHost(e.target.value)}
              onBlur={saveMetro}
              placeholder="192.168.0.49:8081"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-slate-600"
            />
            {expoQr ? (
              <img src={expoQr} alt="QR Expo Go" className="rounded-xl bg-white p-2 mx-auto block" />
            ) : (
              <p className="text-[11px] text-amber-400 text-center py-2">Ingresá IP:puerto de Metro para generar el QR Expo.</p>
            )}
            {expoUrl ? (
              <div className="flex gap-2">
                <p className="text-[9px] text-slate-500 font-mono break-all flex-1">{expoUrl}</p>
                <button
                  type="button"
                  onClick={copyExpoUrl}
                  className="shrink-0 px-3 py-1 rounded-lg bg-orange-600 text-[10px] font-bold"
                >
                  {copied ? 'OK' : 'Copiar'}
                </button>
              </div>
            ) : null}
          </div>

          <Link
            href="/empleado/dashboard?picker=1"
            className="block w-full text-center rounded-2xl border border-slate-800 py-3 text-xs font-bold text-slate-400 hover:text-white"
          >
            Volver al selector de guardias
          </Link>
        </div>
      </div>
    </AuthGuard>
  );
}
