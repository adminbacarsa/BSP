import { useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AuthGuard from '@/components/auth/AuthGuard';

/** Puente legacy: redirige al preview web en producción. */
export default function EmpleadoAppPreviewPage() {
  const router = useRouter();
  const empId = typeof router.query.emp === 'string' ? router.query.emp.trim() : '';

  useEffect(() => {
    if (!router.isReady) return;
    if (empId) {
      router.replace(`/empleado/dashboard?preview=${encodeURIComponent(empId)}`);
    }
  }, [router, router.isReady, empId]);

  const target = empId
    ? `/empleado/dashboard?preview=${encodeURIComponent(empId)}`
    : '/empleado/dashboard?picker=1';

  return (
    <AuthGuard>
      <Head>
        <title>Preview guardia | CronoApp</title>
      </Head>
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-sm text-slate-400">Redirigiendo al preview en producción…</p>
          <Link href={target} className="inline-block rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-black">
            Abrir portal del guardia
          </Link>
        </div>
      </div>
    </AuthGuard>
  );
}
