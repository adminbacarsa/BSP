import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { doc, onSnapshot } from 'firebase/firestore';
import { GraduationCap, Lock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingSession } from '@/hooks/useTrainingSession';

export function TrainingGate() {
  const { user } = useAuth();
  const { empresa } = useEmpresa();
  const { session } = useTrainingSession();
  const router = useRouter();
  const [requiresTraining, setRequiresTraining] = useState(false);

  useEffect(() => {
    if (!user?.uid) { setRequiresTraining(false); return; }
    const ref = doc(db, 'system_users', user.uid);
    return onSnapshot(ref, snap => {
      setRequiresTraining(!!(snap.data()?.requiresTraining));
    });
  }, [user?.uid]);

  if (!empresa?.isTrainingEmpresa) return null;
  if (!requiresTraining) return null;
  if (session?.status === 'completed') return null;
  // Permitir la página de capacitación y el dashboard (que muestra el modo training)
  if (router.pathname === '/admin/capacitacion' || router.pathname === '/admin') return null;

  return (
    <div className="fixed inset-0 z-[800] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-amber-200 dark:border-amber-800 p-8 max-w-sm w-full mx-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-amber-500" />
        </div>
        <h2 className="text-lg font-black text-slate-900 dark:text-white mb-2">
          Capacitación requerida
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
          Debés completar el circuito de capacitación antes de poder navegar la plataforma.
          Seguí las instrucciones del coach.
        </p>
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-2.5 px-6 rounded-xl transition-colors"
        >
          <GraduationCap size={16} />
          Ir al panel de capacitación
        </Link>
      </div>
    </div>
  );
}
