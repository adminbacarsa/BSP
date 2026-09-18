import '@/styles/globals.css';
import type { AppProps } from 'next/app';
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Toaster } from 'sonner';
import { ToastProvider } from '@/context/ToastContext';
import { AuthProvider } from '@/context/AuthContext';
import { EmpresaProvider } from '@/context/EmpresaContext';
import Head from 'next/head';
import { initTheme } from '@/lib/themeManager';
import { applyCompanyThemeFromStorage } from '@/lib/companyTheme';
import { useAdminFcm } from '@/hooks/useAdminFcm';
import { useTrainingEvidence } from '@/hooks/useTrainingEvidence';
import { useTrainingCleanup } from '@/hooks/useTrainingCleanup';
import { useEmpresa } from '@/context/EmpresaContext';

function AdminFcmRegistrar() {
  useAdminFcm();
  return null;
}

function TrainingEvidenceWatcher() {
  useTrainingEvidence();
  useTrainingCleanup();
  return null;
}

function AssistantWrapper() {
  const { empresa } = useEmpresa();
  if (empresa?.isTrainingEmpresa) {
    return <AssistantFloatingBubble />;
  }
  return <div className="hidden lg:block"><AssistantFloatingBubble /></div>;
}

const AssistantFloatingBubble = dynamic(
  () => import('@/components/assistant/AssistantFloatingBubble').then((m) => m.AssistantFloatingBubble),
  { ssr: false },
);

const TrainingCoachBubble = dynamic(
  () => import('@/components/training/TrainingCoachBubble').then((m) => m.TrainingCoachBubble),
  { ssr: false },
);

const TrainingGate = dynamic(
  () => import('@/components/training/TrainingGate').then((m) => m.TrainingGate),
  { ssr: false },
);

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const showTrainingCoach = router.pathname.startsWith('/admin');
  const showAssistant = !router.pathname.startsWith('/empleado')
    && !router.pathname.startsWith('/cliente')
    && !router.pathname.startsWith('/objetivo')
    && !router.pathname.includes('crono-popout')
    && router.pathname !== '/admin/operaciones';
  useEffect(() => {
    initTheme();
    applyCompanyThemeFromStorage();
    // Firestore SDK bug: "INTERNAL ASSERTION FAILED" deja el cliente en estado irrecuperable.
    // Al detectarlo, recargamos la página para restaurar la conexión limpia.
    const isFirestoreAssertion = (msg?: string) =>
      typeof msg === 'string' && msg.includes('INTERNAL ASSERTION FAILED');

    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      if (isFirestoreAssertion(e.reason?.message)) {
        e.preventDefault();
        console.warn('[Firestore] Internal assertion — recargando…');
        setTimeout(() => window.location.reload(), 1500);
      }
    };
    const onError = (e: ErrorEvent) => {
      if (isFirestoreAssertion(e.message)) {
        e.preventDefault();
        console.warn('[Firestore] Internal assertion (sync) — recargando…');
        setTimeout(() => window.location.reload(), 1500);
      }
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
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
        <TrainingEvidenceWatcher />
        <Component {...pageProps} />
        {showAssistant && <AssistantWrapper />}
        {showTrainingCoach && <TrainingCoachBubble />}
        {showTrainingCoach && <TrainingGate />}
        <Toaster position="top-center" richColors closeButton visibleToasts={2} duration={3200} />
      </ToastProvider>
      </EmpresaProvider>
    </AuthProvider>
  );
}
