
import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { EmpresaProvider } from '@/context/EmpresaContext';
import Head from 'next/head';
import { initTheme } from '@/lib/themeManager';
import { applyCompanyThemeFromStorage } from '@/lib/companyTheme';
import { useAdminFcm } from '@/hooks/useAdminFcm';

function AdminFcmRegistrar() {
  useAdminFcm();
  return null;
}

const AssistantFloatingBubble = dynamic(
  () => import('@/components/assistant/AssistantFloatingBubble').then((m) => m.AssistantFloatingBubble),
  { ssr: false },
);

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const showAssistant = !router.pathname.startsWith('/empleado')
    && !router.pathname.startsWith('/cliente')
    && !router.pathname.startsWith('/objetivo')
    && !router.pathname.includes('crono-popout')
    && router.pathname !== '/admin/operaciones';
  useEffect(() => {
    initTheme();
    applyCompanyThemeFromStorage();
    // El SDK de Firestore puede lanzar "INTERNAL ASSERTION FAILED" de forma asíncrona
    // cuando el watch stream se reconecta. No afecta datos — solo previene que Next.js
    // muestre el overlay de error en desarrollo.
    const handler = (e: PromiseRejectionEvent) => {
      if (e.reason?.message?.includes('INTERNAL ASSERTION FAILED')) {
        e.preventDefault();
        console.warn('[Firestore] Internal assertion — ignorado (stream reconnect):', e.reason?.message);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  return (
    <AuthProvider>
      <EmpresaProvider>
      <ToastProvider>
        <Head>
          <title>COSP V1.0 | Grupo Bacar</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <AdminFcmRegistrar />
        <Component {...pageProps} />
        {showAssistant && <div className="hidden lg:block"><AssistantFloatingBubble /></div>}
      </ToastProvider>
      </EmpresaProvider>
    </AuthProvider>
  );
}
