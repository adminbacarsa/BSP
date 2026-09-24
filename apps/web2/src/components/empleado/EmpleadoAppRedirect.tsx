import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Loader2 } from 'lucide-react';
import { mapLegacyEmpleadoToApp } from '@/lib/employeeAppPaths';

/**
 * Redirige rutas legacy /empleado/* al portal Expo en /app (misma sesión Firebase Auth).
 */
export default function EmpleadoAppRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const target = mapLegacyEmpleadoToApp(router.asPath || '/empleado/dashboard');
    window.location.replace(target);
  }, [router.isReady, router.asPath]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 text-slate-600">
      <Loader2 className="animate-spin text-indigo-600" size={32} aria-hidden />
      <p className="text-sm font-semibold">Redirigiendo al portal del guardia…</p>
    </div>
  );
}
