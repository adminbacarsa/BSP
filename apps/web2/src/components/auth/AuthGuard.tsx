
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (user) {
        setIsReady(true);
      } else {
        console.log("AuthGuard: No hay usuario activo.");
        // NO REDIRIGIMOS AUTOMÁTICAMENTE para evitar el bucle.
      }
    }
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6 text-center">
        <div className="bg-rose-500/10 p-4 rounded-full mb-4">
          <svg className="w-12 h-12 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        </div>
        <h1 className="text-xl font-bold mb-2">Sesión no detectada</h1>
        <p className="text-slate-400 mb-6 max-w-sm">
           El sistema no detecta tu usuario. Esto evita que entres en un bucle infinito.
        </p>
        <Link 
          href="/login"
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-xl transition-all"
        >
          Ir al Login Manualmente
        </Link>
        <p className="mt-8 text-xs text-slate-600">
           Si acabas de loguearte y ves esto, revisa los 'Dominios Autorizados' en Firebase Console.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
