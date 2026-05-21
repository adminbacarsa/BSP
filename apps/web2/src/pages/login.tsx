
import { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { ShieldCheck, Lock, Mail, Loader2, AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { auth, db, ensureFirebaseEmulatorsConnected } from '@/lib/firebase';

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATOR === 'true';

const ADMIN_ROLES = ['admin', 'superadmin', 'manager', 'scheduler', 'supervisor', 'operator', 'hrmanager'];
const EMPLOYEE_ROLES = ['employee', 'empleado'];

function normalizeRoleKey(role: string): string {
  return role.toLowerCase().replace(/_/g, '').trim();
}

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Recovery
  const [mode, setMode]             = useState<'login' | 'recovery'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent]   = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (USE_EMULATOR) ensureFirebaseEmulatorsConnected();

      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;

      const token = await cred.user.getIdTokenResult(true);
      const claimRole = normalizeRoleKey(String(token.claims.role ?? ''));
      const claimType = normalizeRoleKey(String(token.claims.type ?? ''));

      if (ADMIN_ROLES.includes(claimRole)) {
        window.location.href = '/admin/dashboard';
        return;
      }
      if (EMPLOYEE_ROLES.includes(claimRole) || EMPLOYEE_ROLES.includes(claimType)) {
        window.location.href = '/empleado/dashboard';
        return;
      }

      let isAdmin = false;
      try {
        const sysSnap = await getDoc(doc(db, 'system_users', uid));
        if (sysSnap.exists()) {
          const sysRole = normalizeRoleKey(String(sysSnap.data().role ?? ''));
          if (ADMIN_ROLES.includes(sysRole) || !EMPLOYEE_ROLES.includes(sysRole)) isAdmin = true;
        }
      } catch (fireErr) {
        console.warn('[login] system_users', fireErr);
        if (claimRole === 'superadmin') isAdmin = true;
      }

      if (isAdmin) {
        window.location.href = '/admin/dashboard';
        return;
      }

      try {
        const byEmail = await getDocs(
          query(collection(db, 'empleados'), where('email', '==', (cred.user.email || '').trim())),
        );
        if (!byEmail.empty) {
          window.location.href = '/empleado/dashboard';
          return;
        }
      } catch (fireErr) {
        console.warn('[login] empleados', fireErr);
      }

      setLoading(false);
      setError(
        USE_EMULATOR
          ? 'Usuario creado en Auth pero sin perfil en el emulador. Ejecutá npm run seed y volvé a entrar.'
          : 'Tu cuenta no tiene perfil asignado. Contactá al administrador.',
      );
    } catch (err: unknown) {
      setLoading(false);
      const code = (err as { code?: string })?.code ?? '';
      const msg = err instanceof Error ? err.message : String(err);
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(code)) {
        setError(
          USE_EMULATOR
            ? 'Correo o contraseña incorrectos en el emulador. Probá admin@bacarsa.com.ar / admin1234 (npm run seed).'
            : 'Correo o contraseña incorrectos.',
        );
      } else if (code === 'auth/too-many-requests') {
        setError('Muchos intentos fallidos. Esperá unos minutos.');
      } else if (USE_EMULATOR && /fetch|network|Failed to fetch/i.test(msg)) {
        setError('No se conecta al emulador Auth (puerto 9099). Ejecutá npm run emulators en la raíz del repo.');
      } else {
        setError(USE_EMULATOR ? `Error de login (lab): ${code || msg}` : 'Error de conexión. Intentá nuevamente.');
      }
    }
  };

  // ── RECOVERY ──────────────────────────────────────────────────────────────
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setResetError('');
    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setResetSent(true);
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        setResetError('No existe una cuenta con ese correo.');
      } else {
        setResetError('Error al enviar el correo. Intentá nuevamente.');
      }
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {USE_EMULATOR && (
        <div className="w-full bg-amber-400 text-amber-950 text-center text-xs font-bold py-2 px-3">
          Modo emulador — admin@bacarsa.com.ar / admin1234 · guardia@bacarsa.com.ar / guardia1234
        </div>
      )}
      <div className="flex flex-1 w-full min-h-0">

      {/* ── PANEL IZQUIERDO (branding) ──────────────────────────────── */}
      <aside className="hidden lg:flex w-[45%] bg-indigo-700 flex-col justify-between p-12 relative overflow-hidden">
        {/* Decoración de fondo */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-500/40 rounded-full translate-x-1/3 translate-y-1/3" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/20 rounded-full" />
        </div>

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center">
            <ShieldCheck size={22} className="text-white" aria-hidden="true" />
          </div>
          <div>
            <span className="text-white font-black text-lg tracking-tight">COSP V 1.0</span>
            <p className="text-indigo-200 text-[11px] font-medium">Seguridad Privada</p>
            <p className="text-indigo-200 text-[10px] font-medium">Grupo Bacar</p>
          </div>
        </div>

        {/* Tagline central */}
        <div className="relative z-10">
          <h1 className="text-white text-4xl font-black leading-tight tracking-tight mb-4">
            Control Operativo<br />de Seguridad<br />Privada
          </h1>
          <p className="text-indigo-200 text-sm font-medium leading-relaxed max-w-xs">
            Gestión de personal, planificación de turnos y monitoreo en tiempo real.
          </p>
        </div>

        {/* Footer */}
        <footer className="relative z-10">
          <p className="text-indigo-200 text-[11px] font-medium">
            © {new Date().getFullYear()} Grupo Bacar · Todos los derechos reservados
          </p>
        </footer>
      </aside>

      {/* ── PANEL DERECHO (formulario) ──────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">

          {/* Logo mobile */}
          <div className="flex lg:hidden flex-col items-center mb-10">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-3">
              <ShieldCheck size={26} className="text-white" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">COSP V 1.0</h1>
            <p className="text-[11px] text-slate-500 font-medium">Grupo Bacar</p>
          </div>

          {/* ── VISTA LOGIN ── */}
          {mode === 'login' && (
            <div className="animate-in fade-in duration-200">
              <div className="mb-8">
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bienvenido</h2>
                <p className="text-sm text-slate-500 font-medium mt-1">Ingresá con tu cuenta de acceso</p>
              </div>

              {error && (
                <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" /> {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-3 text-slate-400" size={16} aria-hidden="true" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                      placeholder="correo@empresa.com"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Contraseña</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3 text-slate-400" size={16} aria-hidden="true" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(p => !p)}
                      aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      aria-pressed={showPass}
                      className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPass ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setMode('recovery'); setResetEmail(email); setResetSent(false); setResetError(''); }}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-black py-3.5 rounded-xl shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 text-sm tracking-wide mt-2"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : 'INGRESAR'}
                </button>
              </form>
            </div>
          )}

          {/* ── VISTA RECUPERACIÓN ── */}
          {mode === 'recovery' && (
            <div className="animate-in fade-in duration-200">
              <button
                onClick={() => { setMode('login'); setResetSent(false); setResetError(''); }}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors mb-8"
              >
                <ArrowLeft size={14} /> Volver al login
              </button>

              {!resetSent ? (
                <>
                  <div className="mb-8">
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">Recuperar acceso</h2>
                    <p className="text-sm text-slate-500 font-medium mt-1">
                      Te enviamos un link para restablecer tu contraseña.
                    </p>
                  </div>

                  {resetError && (
                    <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-2">
                      <AlertCircle size={16} className="shrink-0" /> {resetError}
                    </div>
                  )}

                  <form onSubmit={handleReset} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Email de tu cuenta</label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-3 text-slate-400" size={16} aria-hidden="true" />
                        <input
                          type="email"
                          value={resetEmail}
                          onChange={e => setResetEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                          placeholder="correo@empresa.com"
                          required
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-black py-3.5 rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 text-sm tracking-wide"
                    >
                      {resetLoading ? <Loader2 size={18} className="animate-spin" /> : 'ENVIAR LINK'}
                    </button>
                  </form>
                </>
              ) : (
                <div className="text-center animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
                    <CheckCircle2 size={36} className="text-emerald-600" />
                  </div>
                  <h2 className="text-xl font-black text-slate-900 mb-2">¡Correo enviado!</h2>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">
                    Revisá tu bandeja de entrada en <span className="font-bold text-slate-700">{resetEmail}</span> y seguí el link para crear una nueva contraseña.
                  </p>
                  <button
                    onClick={() => { setMode('login'); setResetSent(false); }}
                    className="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    Volver al login
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
      </div>
    </div>
  );
}
