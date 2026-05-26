import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { ShieldCheck, AlertTriangle, Loader2, Smartphone } from 'lucide-react';

type State = 'loading' | 'activating' | 'success' | 'error' | 'needs_login';

function getDeviceInfo(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: (navigator as any).userAgentData?.platform || navigator.platform || '',
    screenW: String(screen.width),
    screenH: String(screen.height),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: String(navigator.hardwareConcurrency || ''),
  };
}

export default function ActivarDispositivoPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const token = typeof router.query.t === 'string' ? router.query.t : null;

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setState('error');
      setErrorMsg('Enlace inválido o incompleto.');
      return;
    }
    if (!user) {
      setState('needs_login');
      return;
    }
    activate();
  }, [authLoading, user, token]);

  async function activate() {
    setState('activating');
    try {
      const fns = getFunctions(app, 'us-central1');
      const activateDevice = httpsCallable(fns, 'activateDevice');
      await activateDevice({ token, deviceInfo: getDeviceInfo() });
      setState('success');
    } catch (err: any) {
      setState('error');
      const code = err?.code?.replace('functions/', '') || '';
      if (code === 'already-exists') {
        setErrorMsg('Este enlace ya fue utilizado. Tu dispositivo puede estar activo.');
      } else if (code === 'deadline-exceeded') {
        setErrorMsg('El enlace expiró. Pedile al administrador que te reenvíe el mail de acceso.');
      } else if (code === 'permission-denied') {
        setErrorMsg('Este enlace no corresponde a tu cuenta. Cerrá sesión e iniciá con el email al que llegó este mail.');
      } else {
        setErrorMsg(err?.message || 'Error al activar el dispositivo.');
      }
    }
  }

  if (state === 'needs_login') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-8 border border-slate-800 text-center">
          <Smartphone size={48} className="text-teal-400 mx-auto mb-4" />
          <h1 className="text-white font-black text-xl mb-2">Activar dispositivo</h1>
          <p className="text-slate-400 text-sm mb-6">Necesitás iniciar sesión primero para vincular este dispositivo a tu cuenta.</p>
          <button
            onClick={() => router.push(`/empleado/login?returnUrl=${encodeURIComponent(router.asPath)}`)}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl transition-colors"
          >
            Iniciar sesión
          </button>
        </div>
      </div>
    );
  }

  if (state === 'loading' || state === 'activating') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <Loader2 size={48} className="text-teal-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">{state === 'activating' ? 'Verificando enlace...' : 'Cargando...'}</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-8 border border-teal-800 text-center">
          <div className="w-16 h-16 bg-teal-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={32} className="text-teal-400" />
          </div>
          <h1 className="text-white font-black text-xl mb-2">¡Dispositivo activado!</h1>
          <p className="text-slate-400 text-sm mb-6">Este celular quedó vinculado a tu cuenta. Ahora podés marcar presencia desde aquí.</p>
          <button
            onClick={() => router.push('/empleado/dashboard')}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl transition-colors"
          >
            Ir al portal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-8 border border-rose-800 text-center">
        <div className="w-16 h-16 bg-rose-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={32} className="text-rose-400" />
        </div>
        <h1 className="text-white font-black text-xl mb-2">No se pudo activar</h1>
        <p className="text-slate-400 text-sm mb-6">{errorMsg}</p>
        <button
          onClick={() => router.push('/empleado/dashboard')}
          className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition-colors"
        >
          Ir al portal
        </button>
      </div>
    </div>
  );
}
