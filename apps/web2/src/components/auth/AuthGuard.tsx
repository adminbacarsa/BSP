
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!loading && user) setIsReady(true);
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center max-w-sm w-full">
          <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-xl font-black text-slate-900 mb-2">No pudimos verificar tu acceso</h1>
          <p className="text-sm text-slate-500 font-medium mb-6 leading-relaxed">
            Para ingresar al portal del empleado, necesitás iniciar sesión con tu cuenta de Grupo Bacar.
          </p>
          <Link
            href="/login"
            className="inline-block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-8 rounded-xl transition-all text-sm"
          >
            Ir al inicio de sesión
          </Link>
          <p className="mt-5 text-xs text-slate-400">
            ¿Tenés problemas para ingresar?{' '}
            <a href="mailto:rrhh@grupobacar.com.ar" className="underline hover:text-slate-600">Contactá a RRHH</a>
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
