import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { app } from '@/lib/firebase';
import { ShieldCheck, AlertTriangle, Loader2, Smartphone, Eye, EyeOff } from 'lucide-react';

type State = 'loading' | 'form' | 'activating' | 'success' | 'error';

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

function getOrCreateDeviceId(): string {
  const key = 'cosp_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export default function ActivarDispositivoPage() {
  const router = useRouter();
  const [state, setState] = useState<State>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const token = typeof router.query.t === 'string' ? router.query.t : null;

  useEffect(() => {
    if (!router.isReady) return;
    if (!token) {
      setState('error');
      setErrorMsg('Enlace inválido o incompleto.');
      return;
    }
    setState('form');
  }, [router.isReady, token]);

  async function handleActivate() {
    if (!password || password.length < 6) {
      setErrorMsg('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setErrorMsg('');
    setState('activating');
    try {
      const fns = getFunctions(app, 'us-central1');
      const activateAndSetPassword = httpsCallable<
        { token: string; password: string; deviceId: string; deviceInfo: Record<string, string> },
        { email: string; employeeId: string }
      >(fns, 'activateAndSetPassword');

      const deviceId = getOrCreateDeviceId();
      const { data } = await activateAndSetPassword({
        token: token!,
        password,
        deviceId,
        deviceInfo: getDeviceInfo(),
      });

      // Auto sign-in con las credenciales recién creadas
      const auth = getAuth(app);
      await signInWithEmailAndPassword(auth, data.email, password);

      setState('success');
    } catch (err: any) {
      setState('error');
      const code = err?.code?.replace('functions/', '') || '';
      if (code === 'already-exists') {
        setErrorMsg('Este enlace ya fue utilizado. Tu dispositivo puede estar activo — intentá ingresar al portal.');
      } else if (code === 'deadline-exceeded') {
        setErrorMsg('El enlace expiró. Pedile al administrador que te reenvíe el mail de acceso.');
      } else if (code === 'invalid-argument') {
        setErrorMsg(err?.message || 'Datos inválidos.');
        setState('form');
      } else {
        setErrorMsg(err?.message || 'Error al activar el dispositivo.');
      }
    }
  }

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <Loader2 size={48} className="text-teal-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Cargando...</p>
      </div>
    );
  }

  if (state === 'activating') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
        <Loader2 size={48} className="text-teal-400 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Activando tu cuenta...</p>
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
          <h1 className="text-white font-black text-xl mb-2">¡Cuenta activada!</h1>
          <p className="text-slate-400 text-sm mb-6">Tu contraseña fue creada y este celular quedó vinculado a tu cuenta. Ahora podés marcar presencia desde aquí.</p>
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

  if (state === 'error') {
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

  // state === 'form'
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-8 border border-slate-800">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-teal-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Smartphone size={32} className="text-teal-400" />
          </div>
          <h1 className="text-white font-black text-xl mb-1">Activar mi cuenta</h1>
          <p className="text-slate-400 text-sm">Creá tu contraseña para acceder al portal desde este celular.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">Nueva contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setErrorMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && handleActivate()}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:border-teal-500 placeholder-slate-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {errorMsg && (
            <p className="text-rose-400 text-sm">{errorMsg}</p>
          )}

          <button
            onClick={handleActivate}
            disabled={!password}
            className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors"
          >
            Activar mi cuenta
          </button>
        </div>
      </div>
    </div>
  );
}
