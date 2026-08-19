import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AuthGuard from '@/components/auth/AuthGuard';
import { useAuth } from '@/context/AuthContext';
import { buildApkPreviewUrl, buildExpoGoPreviewUrl } from '@/components/empleado/MobilePreviewQrPanel';

const EXPO_HOST_STORAGE_KEY = 'cosp_expo_preview_host';

function readMetroFromStorage(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(EXPO_HOST_STORAGE_KEY) || '';
}

export default function EmpleadoAppPreviewPage() {
  const router = useRouter();
  const { isSuperAdmin } = useAuth();
  const [status, setStatus] = useState('Preparando enlace…');
  const triedRef = useRef(false);

  const empId = useMemo(() => {
    const raw = router.query.emp;
    return typeof raw === 'string' ? raw.trim() : '';
  }, [router.query.emp]);

  const metroFromQuery = useMemo(() => {
    const raw = router.query.metro;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) return value;
    return readMetroFromStorage();
  }, [router.query.metro]);

  const webPreviewHref = empId ? `/empleado/dashboard?preview=${encodeURIComponent(empId)}` : '/empleado/dashboard?picker=1';

  useEffect(() => {
    if (!router.isReady || !empId || triedRef.current) return;
    if (!isSuperAdmin) {
      setStatus('Redirigiendo al portal web…');
      window.location.replace(webPreviewHref);
      return;
    }

    triedRef.current = true;
    const targets: string[] = [];
    if (metroFromQuery) {
      targets.push(buildExpoGoPreviewUrl(metroFromQuery, empId));
    }
    targets.push(buildApkPreviewUrl(empId));

    let index = 0;
    const tryNext = () => {
      if (index >= targets.length) {
        setStatus('No se detectó la app. Abriendo vista previa web…');
        window.setTimeout(() => {
          window.location.replace(webPreviewHref);
        }, 800);
        return;
      }
      const url = targets[index];
      index += 1;
      setStatus(index === 1 ? 'Intentando abrir COSP Guardia…' : 'Probando enlace alternativo…');
      window.location.href = url;
      window.setTimeout(tryNext, 1800);
    };

    tryNext();
  }, [router.isReady, empId, isSuperAdmin, metroFromQuery, webPreviewHref]);

  function openExpo() {
    if (!empId || !metroFromQuery) return;
    window.location.href = buildExpoGoPreviewUrl(metroFromQuery, empId);
  }

  function openApk() {
    if (!empId) return;
    window.location.href = buildApkPreviewUrl(empId);
  }

  return (
    <AuthGuard>
      <Head>
        <title>Abrir app guardia | CronoApp</title>
      </Head>
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-lg space-y-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-400">COSP · Preview app</p>
            <h1 className="text-xl font-black mt-2">Abrir COSP Guardia</h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">{status}</p>
            {empId ? (
              <p className="text-[11px] text-slate-500 font-mono mt-3 break-all">Legajo doc: {empId}</p>
            ) : (
              <p className="text-sm text-amber-400 mt-3">Falta el parámetro emp en la URL.</p>
            )}
          </div>

          <div className="space-y-2">
            <Link
              href={webPreviewHref}
              className="block w-full text-center rounded-2xl bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-black"
            >
              Ver en portal web (navegador)
            </Link>
            {metroFromQuery && empId ? (
              <button
                type="button"
                onClick={openExpo}
                className="w-full rounded-2xl bg-orange-600 hover:bg-orange-500 py-3 text-sm font-black"
              >
                Abrir en Expo Go
              </button>
            ) : (
              <p className="text-[11px] text-slate-500 text-center">
                Para Expo Go: generá el QR desde el panel con IP Metro guardada, o agregá{' '}
                <code className="text-slate-300">?metro=192.168.x.x:8081</code> a esta URL.
              </p>
            )}
            {empId ? (
              <button
                type="button"
                onClick={openApk}
                className="w-full rounded-2xl border border-slate-700 hover:bg-slate-800 py-3 text-sm font-bold text-slate-200"
              >
                Abrir APK (cosp-guardia://)
              </button>
            ) : null}
            <Link
              href="/empleado/dashboard?picker=1"
              className="block w-full text-center rounded-2xl border border-slate-800 py-3 text-xs font-bold text-slate-400 hover:text-white"
            >
              Volver al selector de guardias
            </Link>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
