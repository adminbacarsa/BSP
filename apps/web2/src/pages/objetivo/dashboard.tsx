import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { db, auth, storage } from '@/lib/firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, serverTimestamp, getDocs, getDoc, doc, Timestamp
} from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  ShieldCheck, LogOut, Mic, MicOff, Camera, Image as ImageIcon,
  AlertTriangle, ArrowRightCircle, ArrowLeftCircle, Navigation,
  Users, Siren, Bell, Send, X, Clock, CheckCircle2, Loader2,
  ChevronLeft, ChevronRight, Search, Building2, MapPin, Plus,
  Activity, Lock, Mail, Eye, EyeOff, AlertCircle, Tag, Zap,
  UserCheck, Car, UserX
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type EntryType = 'novedad' | 'ingreso' | 'egreso' | 'ronda' | 'visita' | 'sos';
type Gravedad  = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';

interface LibroEntry {
  id: string;
  type: EntryType;
  etiqueta?: string;
  gravedad?: Gravedad;
  text?: string;
  accionTomada?: string;
  imageUrl?: string;
  audioUrl?: string;
  transcription?: string;
  empleadoNombre?: string;
  createdAt: any;
  // Control de acceso
  identificador?: string;
  identificadorTipo?: 'legajo' | 'dni' | 'nombre' | 'patente';
  personaNombre?: string;
  personaId?: string;
  personaTipo?: 'empleado' | 'visitante' | 'vehiculo';
  autorizado?: boolean;
}

interface PersonaEncontrada {
  docId?: string;
  nombre: string;
  identificador: string;
  identificadorTipo: 'legajo' | 'dni' | 'nombre' | 'patente';
  tipo: 'empleado' | 'visitante' | 'vehiculo';
  autorizado: boolean;
  extra?: string;
}

interface TurnoActivo {
  id: string;
  objectiveId?: string;
  objectiveName?: string;
  clientName?: string;
  clientId?: string;
  startTime?: any;
  endTime?: any;
}

interface ObjetivoInfo {
  id: string;
  name: string;
  address?: string;
  clientName?: string;
  clientId?: string;
}

interface ClienteConObjetivos {
  id: string;
  name: string;
  objetivos: ObjetivoInfo[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (val.toDate) return val.toDate();
  const s = val.seconds ?? val._seconds;
  if (typeof s === 'number') return new Date(s * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const fmtTime = (val: any) => {
  const d = toDate(val);
  return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
};

const fmtEntryTime = (val: any) => {
  const d = toDate(val);
  return d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
};

const fmtEntryDate = (val: any) => {
  const d = toDate(val);
  return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
};

// ─── Config tipos de entrada ──────────────────────────────────────────────────

const ENTRY_TYPES: { id: EntryType; label: string; icon: any; color: string; light: string; border: string; defaultEtiqueta: string; defaultGravedad: Gravedad }[] = [
  { id: 'novedad', label: 'Novedad',  icon: Bell,             color: 'text-amber-600',   light: 'bg-amber-50',   border: 'border-amber-200',   defaultEtiqueta: 'INCIDENTE', defaultGravedad: 'ALTA'    },
  { id: 'ingreso', label: 'Ingreso',  icon: ArrowRightCircle, color: 'text-emerald-600', light: 'bg-emerald-50', border: 'border-emerald-200', defaultEtiqueta: 'ACCESO',    defaultGravedad: 'BAJA'    },
  { id: 'egreso',  label: 'Egreso',   icon: ArrowLeftCircle,  color: 'text-blue-600',    light: 'bg-blue-50',    border: 'border-blue-200',    defaultEtiqueta: 'ACCESO',    defaultGravedad: 'BAJA'    },
  { id: 'ronda',   label: 'Ronda',    icon: Navigation,        color: 'text-violet-600',  light: 'bg-violet-50',  border: 'border-violet-200',  defaultEtiqueta: 'RONDA',     defaultGravedad: 'BAJA'    },
  { id: 'visita',  label: 'Visita',   icon: Users,             color: 'text-sky-600',     light: 'bg-sky-50',     border: 'border-sky-200',     defaultEtiqueta: 'VISITA',    defaultGravedad: 'BAJA'    },
  { id: 'sos',     label: 'SOS',      icon: Siren,             color: 'text-red-600',     light: 'bg-red-50',     border: 'border-red-200',     defaultEtiqueta: 'SINIESTRO', defaultGravedad: 'CRITICA' },
];

const typeConfig = (t: EntryType) => ENTRY_TYPES.find(x => x.id === t) || ENTRY_TYPES[0];

// ─── Etiquetas agrupadas ──────────────────────────────────────────────────────

interface EtiquetaDef { id: string; label: string; cls: string; defaultGravedad: Gravedad }
interface EtiquetaGrupo { grupo: string; etiquetas: EtiquetaDef[] }

const ETIQUETA_GRUPOS: EtiquetaGrupo[] = [
  {
    grupo: 'Seguridad',
    etiquetas: [
      { id: 'INCIDENTE',  label: 'Incidente',   cls: 'text-red-700 bg-red-50 border-red-200',           defaultGravedad: 'ALTA'    },
      { id: 'SINIESTRO',  label: 'Siniestro',   cls: 'text-red-800 bg-red-100 border-red-300',           defaultGravedad: 'CRITICA' },
      { id: 'INTRUSIÓN',  label: 'Intrusión',   cls: 'text-rose-700 bg-rose-50 border-rose-200',         defaultGravedad: 'ALTA'    },
      { id: 'ROBO_HURTO', label: 'Robo / Hurto',cls: 'text-red-700 bg-red-50 border-red-200',            defaultGravedad: 'ALTA'    },
      { id: 'ALARMA',     label: 'Alarma',      cls: 'text-orange-700 bg-orange-50 border-orange-200',   defaultGravedad: 'MEDIA'   },
      { id: 'HALLAZGO',   label: 'Hallazgo',    cls: 'text-amber-700 bg-amber-50 border-amber-200',      defaultGravedad: 'MEDIA'   },
    ],
  },
  {
    grupo: 'Operación',
    etiquetas: [
      { id: 'RELEVO',   label: 'Relevo',   cls: 'text-slate-700 bg-slate-100 border-slate-300',   defaultGravedad: 'BAJA'  },
      { id: 'ACCESO',   label: 'Acceso',   cls: 'text-blue-700 bg-blue-50 border-blue-200',       defaultGravedad: 'BAJA'  },
      { id: 'RONDA',    label: 'Ronda',    cls: 'text-indigo-700 bg-indigo-50 border-indigo-200', defaultGravedad: 'BAJA'  },
      { id: 'CONSIGNA', label: 'Consigna', cls: 'text-violet-700 bg-violet-50 border-violet-200', defaultGravedad: 'BAJA'  },
      { id: 'VEDA',     label: 'Veda',     cls: 'text-amber-700 bg-amber-50 border-amber-200',    defaultGravedad: 'MEDIA' },
    ],
  },
  {
    grupo: 'Mantenimiento',
    etiquetas: [
      { id: 'FALLA', label: 'Falla', cls: 'text-orange-700 bg-orange-50 border-orange-200', defaultGravedad: 'MEDIA' },
      { id: 'CORTE', label: 'Corte', cls: 'text-orange-800 bg-orange-100 border-orange-300', defaultGravedad: 'MEDIA' },
      { id: 'OBRA',  label: 'Obra',  cls: 'text-yellow-700 bg-yellow-50 border-yellow-200', defaultGravedad: 'BAJA'  },
    ],
  },
  {
    grupo: 'Emergencia Médica',
    etiquetas: [
      { id: 'AUXILIO',  label: 'Auxilio',  cls: 'text-rose-700 bg-rose-50 border-rose-200',   defaultGravedad: 'ALTA' },
      { id: 'TRASLADO', label: 'Traslado', cls: 'text-rose-800 bg-rose-100 border-rose-300',  defaultGravedad: 'ALTA' },
    ],
  },
  {
    grupo: 'Administrativo',
    etiquetas: [
      { id: 'SN',     label: 'S/N',   cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', defaultGravedad: 'BAJA' },
      { id: 'VISITA', label: 'Visita', cls: 'text-teal-700 bg-teal-50 border-teal-200',          defaultGravedad: 'BAJA' },
    ],
  },
];

// Lookup plano para EntradaCard y guardado
const ETIQUETAS_FLAT: EtiquetaDef[] = ETIQUETA_GRUPOS.flatMap(g => g.etiquetas);

const etiquetaCfg = (id: string) => ETIQUETAS_FLAT.find(e => e.id === id);

// ─── Gravedad ─────────────────────────────────────────────────────────────────

const GRAVEDADES: { id: Gravedad; label: string; dot: string; cls: string }[] = [
  { id: 'BAJA',    label: 'Baja',    dot: 'bg-emerald-500', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200'  },
  { id: 'MEDIA',   label: 'Media',   dot: 'bg-amber-400',   cls: 'text-amber-700 bg-amber-50 border-amber-200'        },
  { id: 'ALTA',    label: 'Alta',    dot: 'bg-orange-500',  cls: 'text-orange-700 bg-orange-50 border-orange-200'     },
  { id: 'CRITICA', label: 'Crítica', dot: 'bg-red-600',     cls: 'text-red-700 bg-red-50 border-red-300 font-black'   },
];

const gravedadCfg = (id?: Gravedad) => GRAVEDADES.find(g => g.id === id) || GRAVEDADES[0];

// ─── Login — mismo estilo que /login ─────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [showPass,setShowPass]= useState(false);
  const [err,     setErr]     = useState('');
  const [busy,    setBusy]    = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pass) { setErr('Completá email y contraseña.'); return; }
    setBusy(true); setErr('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      onLogin(cred.user);
    } catch (err: any) {
      if (['auth/invalid-credential','auth/user-not-found','auth/wrong-password'].includes(err.code)) {
        setErr('Correo o contraseña incorrectos.');
      } else {
        setErr('Error de conexión. Intentá nuevamente.');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Panel izquierdo — branding (solo desktop) */}
      <div className="hidden lg:flex w-[45%] bg-indigo-600 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-500/40 rounded-full translate-x-1/3 translate-y-1/3" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/20 rounded-full" />
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center">
            <ShieldCheck size={22} className="text-white" />
          </div>
          <div>
            <span className="text-white font-black text-lg tracking-tight">COSP V 1.0</span>
            <p className="text-indigo-200 text-[11px] font-medium">Seguridad Privada</p>
            <p className="text-indigo-300 text-[10px] font-medium">Grupo Bacar</p>
          </div>
        </div>
        <div className="relative z-10">
          <h2 className="text-white text-4xl font-black leading-tight tracking-tight mb-4">
            Libro de<br />Guardia<br />Digital
          </h2>
          <p className="text-indigo-200 text-sm font-medium leading-relaxed max-w-xs">
            Registro operativo de novedades, ingresos y eventos por objetivo de seguridad.
          </p>
        </div>
        <div className="relative z-10">
          <p className="text-indigo-300 text-[11px] font-medium">
            © {new Date().getFullYear()} Grupo Bacar · Todos los derechos reservados
          </p>
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Logo mobile */}
          <div className="flex lg:hidden flex-col items-center mb-10">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-3">
              <ShieldCheck size={26} className="text-white" />
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Libro de Guardia</h1>
            <p className="text-[11px] text-slate-500 font-medium">COSP V1.0 · Grupo Bacar</p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bienvenido</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Ingresá con tu cuenta de acceso</p>
          </div>

          {err && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" /> {err}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 text-slate-400" size={16} />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                  placeholder="correo@empresa.com" required autoCapitalize="none" autoCorrect="off" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 text-slate-400" size={16} />
                <input type={showPass ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                  placeholder="••••••••" required />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={busy}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-black py-3.5 rounded-xl shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 text-sm tracking-wide mt-2">
              {busy ? <Loader2 size={18} className="animate-spin" /> : 'INGRESAR'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Sin turno activo ─────────────────────────────────────────────────────────

function SinTurno({ nombre, onLogout }: { nombre: string; onLogout: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
        <AlertTriangle size={28} className="text-amber-500" />
      </div>
      <h2 className="text-slate-800 font-black text-lg">Hola, {nombre}</h2>
      <p className="text-slate-500 text-sm mt-2 max-w-xs">No tenés ningún turno activo asignado para hoy.</p>
      <p className="text-slate-400 text-xs mt-1">Contactá con operaciones si crees que es un error.</p>
      <button onClick={onLogout}
        className="mt-6 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
        <LogOut size={15} /> Cerrar sesión
      </button>
    </div>
  );
}

// ─── Selector — dos niveles ────────────────────────────────────────────────────

function SelectorObjetivo({ clientes, onSelect, onLogout, nombre }: {
  clientes: ClienteConObjetivos[];
  onSelect: (obj: ObjetivoInfo) => void;
  onLogout: () => void;
  nombre: string;
}) {
  const [search,        setSearch]        = useState('');
  const [clienteActivo, setClienteActivo] = useState<ClienteConObjetivos | null>(null);

  if (!clienteActivo) {
    const filtered = clientes.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <div className="bg-white border-b border-slate-200 px-4 pt-5 pb-4 shadow-sm flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-600" strokeWidth={1.5} />
              <span className="text-indigo-600 text-xs font-black uppercase tracking-widest">Libro de Guardia</span>
            </div>
            <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500 font-medium bg-white hover:bg-slate-50 transition-colors">
              <LogOut size={12} /> Salir
            </button>
          </div>
          <h1 className="text-slate-800 font-black text-lg mt-2">Clientes</h1>
          <p className="text-slate-400 text-xs">Admin · {nombre}</p>
        </div>
        <div className="px-4 py-3 bg-white border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input type="text" placeholder="Buscar cliente..." value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none" />
            {search && <button onClick={() => setSearch('')}><X size={13} className="text-slate-400" /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 size={28} className="text-slate-300 mb-2" strokeWidth={1.5} />
              <p className="text-slate-400 text-sm">Sin clientes</p>
            </div>
          ) : filtered.map(cliente => (
            <button key={cliente.id} onClick={() => { setSearch(''); setClienteActivo(cliente); }}
              className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3.5 flex items-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
                <Building2 size={18} className="text-indigo-500" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-slate-800 text-sm font-bold truncate">{cliente.name}</p>
                <p className="text-slate-400 text-xs mt-0.5">{cliente.objetivos.length} objetivo{cliente.objetivos.length !== 1 ? 's' : ''}</p>
              </div>
              <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const objFiltered = clienteActivo.objetivos.filter(o => !search || o.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-200 px-4 pt-4 pb-4 shadow-sm flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => { setClienteActivo(null); setSearch(''); }} className="flex items-center gap-1.5 text-indigo-600 text-sm font-bold">
            <ChevronLeft size={16} /> Clientes
          </button>
          <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500 font-medium bg-white hover:bg-slate-50 transition-colors">
            <LogOut size={12} /> Salir
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
            <Building2 size={18} className="text-indigo-500" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-slate-800 font-black text-base leading-tight">{clienteActivo.name}</h1>
            <p className="text-slate-400 text-xs">{clienteActivo.objetivos.length} objetivo{clienteActivo.objetivos.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-3 bg-white border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
          <Search size={14} className="text-slate-400 flex-shrink-0" />
          <input type="text" placeholder="Buscar objetivo..." value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none" />
          {search && <button onClick={() => setSearch('')}><X size={13} className="text-slate-400" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {objFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MapPin size={28} className="text-slate-300 mb-2" strokeWidth={1.5} />
            <p className="text-slate-400 text-sm">Sin objetivos</p>
          </div>
        ) : objFiltered.map(obj => (
          <button key={obj.id} onClick={() => onSelect(obj)}
            className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3.5 flex items-center gap-3 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-slate-400" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-800 text-sm font-bold truncate">{obj.name}</p>
              {obj.address && <p className="text-slate-400 text-xs truncate mt-0.5">{obj.address}</p>}
            </div>
            <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Panel nueva entrada — mobile-first ───────────────────────────────────────

const GRUPO_META: Record<string, { dot: string; activeCls: string }> = {
  'Seguridad':        { dot: 'bg-red-500',     activeCls: 'bg-red-600 border-red-600 text-white'       },
  'Operación':        { dot: 'bg-blue-500',    activeCls: 'bg-blue-600 border-blue-600 text-white'      },
  'Mantenimiento':    { dot: 'bg-orange-500',  activeCls: 'bg-orange-500 border-orange-500 text-white'  },
  'Emergencia Médica':{ dot: 'bg-rose-500',    activeCls: 'bg-rose-600 border-rose-600 text-white'      },
  'Administrativo':   { dot: 'bg-slate-400',   activeCls: 'bg-slate-600 border-slate-600 text-white'    },
};

function NuevaEntradaPanel({ onSave, onClose, empleadoNombre, objectiveId, turno, objetivo }: {
  onSave: () => void; onClose: () => void; empleadoNombre: string;
  objectiveId: string; turno: TurnoActivo | null; objetivo: ObjetivoInfo;
}) {
  const [tipo,         setTipo]         = useState<EntryType>('novedad');
  const [grupoActivo,  setGrupoActivo]  = useState('Seguridad');
  const [etiqueta,     setEtiqueta]     = useState('INCIDENTE');
  const [gravedad,     setGravedad]     = useState<Gravedad>('ALTA');
  const [texto,        setTexto]        = useState('');
  const [accion,       setAccion]       = useState('');
  const [showAccion,   setShowAccion]   = useState(false);
  const [imageFile,    setImageFile]    = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [recording,    setRecording]    = useState(false);
  const [audioBlob,    setAudioBlob]    = useState<Blob | null>(null);
  const [audioUrl,     setAudioUrl]     = useState<string | null>(null);
  const [transcription,setTranscription]= useState('');
  const [saving,       setSaving]       = useState(false);
  const [audioSeconds, setAudioSeconds] = useState(0);

  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const speechRef    = useRef<any>(null);
  const timerRef     = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Al cambiar tipo → defaults de etiqueta, gravedad y grupo activo
  useEffect(() => {
    const cfg = typeConfig(tipo);
    setEtiqueta(cfg.defaultEtiqueta);
    setGravedad(cfg.defaultGravedad);
    const g = ETIQUETA_GRUPOS.find(gr => gr.etiquetas.some(e => e.id === cfg.defaultEtiqueta));
    if (g) setGrupoActivo(g.grupo);
  }, [tipo]);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = []; setAudioSeconds(0);
      timerRef.current = setInterval(() => setAudioSeconds(s => s + 1), 1000);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType });
      mediaRecRef.current = rec;
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob));
      };
      rec.start(); setRecording(true);
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        const recog = new SR(); recog.lang = 'es-AR'; recog.continuous = true; recog.interimResults = false;
        recog.onresult = (ev: any) => {
          const t = Array.from(ev.results).map((r: any) => r[0].transcript).join(' ');
          setTranscription(t);
          setTexto(t);
        };
        recog.start(); speechRef.current = recog;
      }
    } catch { alert('No se pudo acceder al micrófono.'); }
  };

  const stopRecording = () => { mediaRecRef.current?.stop(); speechRef.current?.stop(); setRecording(false); };

  const handleSave = async () => {
    if (!texto.trim() && !imageFile && !audioBlob && !transcription.trim()) { alert('Agregá descripción, foto o audio.'); return; }
    setSaving(true);
    try {
      const ts = Date.now();
      let imgUrl: string | undefined; let audUrl: string | undefined;
      if (imageFile) {
        try { const r = ref(storage, `libro_guardia/${objectiveId}/${ts}_img`); await uploadBytes(r, imageFile); imgUrl = await getDownloadURL(r); } catch { /* opcional */ }
      }
      if (audioBlob) {
        try { const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm'; const r = ref(storage, `libro_guardia/${objectiveId}/${ts}_audio.${ext}`); await uploadBytes(r, audioBlob); audUrl = await getDownloadURL(r); } catch { /* opcional */ }
      }
      await addDoc(collection(db, 'libro_guardia'), {
        objectiveId,
        clientId:       turno?.clientId     || objetivo.clientId    || '',
        objetivoNombre: objetivo.name       || turno?.objectiveName || '',
        clientName:     objetivo.clientName || turno?.clientName    || '',
        shiftId:        turno?.id           || '',
        employeeId:     auth.currentUser?.uid || '',
        empleadoNombre, type: tipo, etiqueta, gravedad,
        text:           texto.trim() || transcription.trim() || '',
        ...(accion.trim() && { accionTomada: accion.trim() }),
        ...(imgUrl        && { imageUrl: imgUrl }),
        ...(audUrl        && { audioUrl: audUrl }),
        ...(transcription && { transcription }),
        createdAt: serverTimestamp(),
      });
      onSave(); onClose();
    } catch (e: any) { alert('Error al guardar: ' + (e?.message || e)); } finally { setSaving(false); }
  };

  const cfg  = typeConfig(tipo);
  const ecfg = etiquetaCfg(etiqueta);
  const etiquetasActivas = ETIQUETA_GRUPOS.find(g => g.grupo === grupoActivo)?.etiquetas || [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[96dvh]">

        {/* Handle + header */}
        <div className="flex justify-center pt-3 pb-0 cursor-pointer" onClick={onClose}>
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>
        <div className="px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="text-slate-900 font-black text-base">Nueva entrada</h3>
            <p className="text-slate-400 text-[11px] mt-0.5">{objetivo.name}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <X size={17} className="text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 flex flex-col gap-5 pb-4">

          {/* Tipo — 2 filas de 3, touch-friendly */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Tipo de registro</p>
            <div className="grid grid-cols-3 gap-2">
              {ENTRY_TYPES.map(t => {
                const Icon = t.icon; const active = tipo === t.id;
                return (
                  <button key={t.id} onClick={() => setTipo(t.id)}
                    className={`flex flex-col items-center gap-2 py-3.5 rounded-2xl border-2 text-xs font-black transition-all active:scale-95 ${active ? `${t.light} ${t.border} ${t.color}` : 'bg-slate-50 border-transparent text-slate-400'}`}>
                    <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Categoría — tabs de grupo + chips */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
              <Tag size={11} /> Categoría
              {ecfg && <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${ecfg.cls}`}>{ecfg.label}</span>}
            </p>

            {/* Tabs de grupo — scroll horizontal */}
            <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {ETIQUETA_GRUPOS.map(g => {
                const meta = GRUPO_META[g.grupo];
                const isActive = grupoActivo === g.grupo;
                const hasSelected = g.etiquetas.some(e => e.id === etiqueta);
                return (
                  <button key={g.grupo} onClick={() => setGrupoActivo(g.grupo)}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-black transition-all whitespace-nowrap ${isActive ? meta.activeCls : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    {!isActive && hasSelected && <span className={`w-2 h-2 rounded-full ${meta.dot}`} />}
                    {g.grupo}
                  </button>
                );
              })}
            </div>

            {/* Chips del grupo activo */}
            <div className="flex flex-wrap gap-2 mt-2">
              {etiquetasActivas.map(e => (
                <button key={e.id}
                  onClick={() => { setEtiqueta(e.id); setGravedad(e.defaultGravedad); }}
                  className={`px-4 py-2.5 rounded-xl border-2 text-sm font-black transition-all active:scale-95 ${etiqueta === e.id ? e.cls + ' border-current' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  {e.label}
                </button>
              ))}
            </div>
          </div>

          {/* Gravedad — 2×2 grid, touch-friendly */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
              <Zap size={11} /> Gravedad
            </p>
            <div className="grid grid-cols-2 gap-2">
              {GRAVEDADES.map(g => (
                <button key={g.id} onClick={() => setGravedad(g.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-sm font-black transition-all active:scale-95 ${gravedad === g.id ? g.cls + ' border-current' : 'bg-slate-50 border-transparent text-slate-400'}`}>
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${gravedad === g.id ? g.dot : 'bg-slate-200'}`} />
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* Descripción */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Descripción</p>
            <textarea
              placeholder={tipo === 'sos' ? '¡Describí la emergencia con detalle!' : `Descripción de la ${cfg.label.toLowerCase()}...`}
              value={texto} onChange={e => setTexto(e.target.value)} rows={4}
              className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 text-sm text-slate-700 placeholder-slate-300 resize-none outline-none focus:border-indigo-400 transition-all"
            />
          </div>

          {/* Acción tomada — colapsable */}
          <div>
            <button onClick={() => setShowAccion(v => !v)}
              className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 hover:text-slate-600 transition-colors">
              <CheckCircle2 size={11} className={showAccion ? 'text-indigo-500' : ''} />
              Acción tomada
              <span className="font-medium normal-case text-slate-300">(opcional)</span>
            </button>
            {showAccion && (
              <textarea
                placeholder="Ej: Se notificó a supervisor, se solicitó refuerzo..."
                value={accion} onChange={e => setAccion(e.target.value)} rows={2}
                className="w-full px-4 py-3 rounded-2xl border-2 border-slate-200 text-sm text-slate-700 placeholder-slate-300 resize-none outline-none focus:border-indigo-400 transition-all"
              />
            )}
          </div>

          {/* Foto + Audio en fila */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">Evidencia</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImage} />
              <button onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-2 py-4 rounded-2xl border-2 border-slate-200 bg-white text-slate-500 font-bold text-xs hover:bg-slate-50 active:scale-95 transition-all">
                <Camera size={22} className="text-slate-400" strokeWidth={1.5} />
                Cámara
              </button>
              <button onClick={recording ? stopRecording : startRecording}
                className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 font-bold text-xs active:scale-95 transition-all ${recording ? 'border-red-200 bg-red-50 text-red-600' : audioUrl ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
                {recording
                  ? <><MicOff size={22} strokeWidth={1.5} className="animate-pulse" />{audioSeconds}s grabando…</>
                  : audioUrl
                  ? <><CheckCircle2 size={22} strokeWidth={1.5} />Audio listo</>
                  : <><Mic size={22} strokeWidth={1.5} className="text-slate-400" />Grabar voz</>
                }
              </button>
            </div>

            {/* Preview imagen */}
            {imagePreview && (
              <div className="relative mb-3">
                <img src={imagePreview} alt="preview" className="w-full rounded-2xl object-cover max-h-52 border border-slate-200" />
                <button onClick={() => { setImageFile(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-md flex items-center justify-center">
                  <X size={14} className="text-slate-500" />
                </button>
              </div>
            )}

            {/* Audio grabado */}
            {audioUrl && !recording && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center gap-3">
                <audio src={audioUrl} controls className="flex-1 h-9" />
                <button onClick={() => { setAudioBlob(null); setAudioUrl(null); setTranscription(''); setAudioSeconds(0); }}
                  className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                  <X size={14} className="text-slate-400" />
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Botón guardar — sticky */}
        <div className="px-5 pb-8 pt-3 border-t border-slate-100 flex-shrink-0 bg-white">
          <button onClick={handleSave} disabled={saving}
            className={`w-full py-4 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] disabled:opacity-60 ${tipo === 'sos' ? 'bg-red-600 shadow-red-500/20' : 'bg-indigo-600 shadow-indigo-500/20'}`}>
            {saving ? <Loader2 size={18} className="animate-spin" /> : <><Send size={16} /> REGISTRAR {cfg.label.toUpperCase()}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Control de Acceso ────────────────────────────────────────────────────────

function AccesoRapidoPanel({ onSave, onClose, objectiveId, turno, objetivo, entries, empleadoNombre }: {
  onSave: () => void; onClose: () => void; objectiveId: string;
  turno: TurnoActivo | null; objetivo: ObjetivoInfo;
  entries: LibroEntry[]; empleadoNombre: string;
}) {
  const [modo,          setModo]          = useState<'persona' | 'vehiculo'>('persona');
  const [busqueda,      setBusqueda]      = useState('');
  const [buscando,      setBuscando]      = useState(false);
  const [encontrado,    setEncontrado]    = useState<PersonaEncontrada | null>(null);
  const [sinResultados, setSinResultados] = useState(false);
  const [nombreManual,  setNombreManual]  = useState('');
  const [saving,        setSaving]        = useState(false);
  const [exito,         setExito]         = useState<'ingreso' | 'egreso' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accesosDehoy = entries
    .filter(e => e.type === 'ingreso' || e.type === 'egreso')
    .slice()
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));

  // Determina si alguien está adentro según el último movimiento del día
  const getEstado = (identificador: string): 'ADENTRO' | 'AFUERA' => {
    const propios = accesosDehoy.filter(e => e.identificador === identificador);
    if (!propios.length) return 'AFUERA';
    return propios[0].type === 'ingreso' ? 'ADENTRO' : 'AFUERA';
  };

  const resetBusqueda = () => { setEncontrado(null); setSinResultados(false); setNombreManual(''); };

  const cambiarModo = (m: 'persona' | 'vehiculo') => { setModo(m); setBusqueda(''); resetBusqueda(); };

  const buscar = async () => {
    const txt = busqueda.trim();
    if (!txt) return;

    if (modo === 'vehiculo') {
      const patente = txt.toUpperCase();
      setEncontrado({ nombre: patente, identificador: patente, identificadorTipo: 'patente', tipo: 'vehiculo', autorizado: true });
      setSinResultados(false);
      return;
    }

    setBuscando(true); resetBusqueda();
    try {
      const snap = await getDocs(collection(db, 'empleados'));
      const q = txt.toLowerCase();
      let found: PersonaEncontrada | null = null;

      for (const d of snap.docs) {
        const data = d.data();
        const nombre = [data.firstName, data.lastName].filter(Boolean).join(' ');
        const legajo = String(data.legajo || data.employeeNumber || '');
        const dni    = String(data.dni    || data.document       || '');

        if (legajo === q || dni === q || nombre.toLowerCase() === q || nombre.toLowerCase().includes(q)) {
          const idTipo: PersonaEncontrada['identificadorTipo'] =
            legajo === q ? 'legajo' : dni === q ? 'dni' : 'nombre';
          found = {
            docId: d.id, nombre: nombre || 'Empleado',
            identificador: legajo || dni || txt, identificadorTipo: idTipo,
            tipo: 'empleado', autorizado: true,
            extra: data.cargo || data.position || data.sector || '',
          };
          break;
        }
      }
      if (found) setEncontrado(found);
      else { setSinResultados(true); setNombreManual(txt); }
    } catch { setSinResultados(true); }
    finally { setBuscando(false); }
  };

  const registrar = async () => {
    const nombre      = encontrado?.nombre || nombreManual.trim();
    const identificador = encontrado?.identificador || busqueda.trim();
    if (!nombre) return;

    const accion: 'ingreso' | 'egreso' = encontrado
      ? (getEstado(encontrado.identificador) === 'ADENTRO' ? 'egreso' : 'ingreso')
      : 'ingreso';

    setSaving(true);
    try {
      await addDoc(collection(db, 'libro_guardia'), {
        objectiveId,
        clientId:       turno?.clientId     || objetivo.clientId    || '',
        objetivoNombre: objetivo.name       || '',
        clientName:     objetivo.clientName || '',
        shiftId:        turno?.id           || '',
        employeeId:     auth.currentUser?.uid || '',
        empleadoNombre,
        type:           accion,
        etiqueta:       'ACCESO',
        gravedad:       (sinResultados && !encontrado) ? 'MEDIA' : 'BAJA',
        text:           `${accion === 'ingreso' ? 'Ingreso' : 'Egreso'} · ${nombre}`,
        identificador,
        identificadorTipo: encontrado?.identificadorTipo || 'nombre',
        personaNombre:  nombre,
        personaId:      encontrado?.docId || '',
        personaTipo:    encontrado?.tipo || 'visitante',
        autorizado:     encontrado?.autorizado ?? false,
        createdAt:      serverTimestamp(),
      });
      setExito(accion);
      setTimeout(() => { onSave(); onClose(); }, 1600);
    } catch (e: any) { alert('Error: ' + e.message); setSaving(false); }
  };

  const estado     = encontrado ? getEstado(encontrado.identificador) : null;
  const accionBtn  = estado === 'ADENTRO' ? 'egreso' : 'ingreso';

  // Pantalla de éxito
  if (exito) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`flex flex-col items-center gap-4 px-10 py-10 rounded-3xl shadow-2xl ${exito === 'ingreso' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
        <CheckCircle2 size={60} className="text-white" strokeWidth={1.5} />
        <p className="text-white font-black text-xl tracking-wide">{exito === 'ingreso' ? 'INGRESO' : 'EGRESO'} REGISTRADO</p>
      </div>
    </div>
  );

  // Cálculo de quién está adentro ahora
  const adentroAhora: LibroEntry[] = [];
  const seen = new Set<string>();
  for (const e of [...accesosDehoy].reverse()) {
    if (!e.identificador || seen.has(e.identificador)) continue;
    seen.add(e.identificador);
    if (e.type === 'ingreso') adentroAhora.push(e);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-sm"
      onClick={ev => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[94dvh]">

        <div className="flex justify-center pt-3 cursor-pointer" onClick={onClose}>
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        <div className="px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="text-slate-900 font-black text-base">Control de Acceso</h3>
            <p className="text-slate-400 text-[11px] mt-0.5">{objetivo.name}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <X size={17} className="text-slate-500" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-8 flex flex-col gap-5">

          {/* Toggle Persona / Vehículo */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 rounded-2xl p-1.5">
            {([['persona', UserCheck, 'Persona'], ['vehiculo', Car, 'Vehículo']] as const).map(([m, Icon, lbl]) => (
              <button key={m} onClick={() => cambiarModo(m)}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black transition-all ${modo === m ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                <Icon size={17} /> {lbl}
              </button>
            ))}
          </div>

          {/* Input de búsqueda */}
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
              {modo === 'persona' ? 'DNI, Legajo o Nombre' : 'Patente del vehículo'}
            </p>
            <div className="flex gap-2">
              <input ref={inputRef}
                value={busqueda}
                onChange={e => { setBusqueda(modo === 'vehiculo' ? e.target.value.toUpperCase() : e.target.value); resetBusqueda(); }}
                onKeyDown={e => e.key === 'Enter' && buscar()}
                placeholder={modo === 'persona' ? 'Ej: 35123456  ·  García Juan  ·  Leg.42' : 'Ej: AB 123 CD'}
                inputMode={modo === 'persona' ? 'text' : 'text'}
                autoCapitalize={modo === 'vehiculo' ? 'characters' : 'words'}
                autoComplete="off"
                className="flex-1 px-4 py-4 rounded-2xl border-2 border-slate-200 text-base font-bold text-slate-900 placeholder-slate-300 outline-none focus:border-indigo-400 transition-all"
              />
              <button onClick={buscar} disabled={buscando || !busqueda.trim()}
                className="w-14 rounded-2xl bg-indigo-600 text-white font-black disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center">
                {buscando ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
              </button>
            </div>
          </div>

          {/* Resultado encontrado */}
          {encontrado && (
            <div className={`rounded-2xl border-2 p-4 ${
              encontrado.tipo === 'vehiculo'   ? 'bg-sky-50 border-sky-200' :
              encontrado.autorizado            ? 'bg-emerald-50 border-emerald-200' :
                                               'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl font-black ${
                  encontrado.tipo === 'vehiculo' ? 'bg-sky-100 text-sky-600' :
                  encontrado.autorizado          ? 'bg-emerald-100 text-emerald-600' :
                                                 'bg-amber-100 text-amber-600'}`}>
                  {encontrado.tipo === 'vehiculo' ? <Car size={26} /> : <UserCheck size={26} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 text-lg leading-tight">{encontrado.nombre}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {encontrado.tipo === 'empleado' ? `Empleado · ${encontrado.identificadorTipo.toUpperCase()}: ${encontrado.identificador}` :
                     encontrado.tipo === 'vehiculo' ? 'Vehículo' : 'Visitante'}
                    {encontrado.extra && ` · ${encontrado.extra}`}
                  </p>
                  <div className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black ${
                    estado === 'ADENTRO'
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-emerald-50 border border-emerald-200 text-emerald-700'}`}>
                    <span className={`w-2 h-2 rounded-full ${estado === 'ADENTRO' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    {estado === 'ADENTRO' ? 'ADENTRO · registrar egreso' : 'AFUERA · puede ingresar'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* No encontrado — registrar como visitante */}
          {sinResultados && (
            <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <UserX size={20} className="text-amber-600" />
                </div>
                <div>
                  <p className="font-black text-amber-900 text-sm">No encontrado en el sistema</p>
                  <p className="text-xs text-amber-600">Registrar como visitante externo</p>
                </div>
              </div>
              <input type="text" value={nombreManual} onChange={e => setNombreManual(e.target.value)}
                placeholder="Nombre completo del visitante..."
                className="w-full px-4 py-3 rounded-xl border-2 border-amber-200 bg-white text-sm font-medium text-slate-800 placeholder-slate-300 outline-none focus:border-amber-400 transition-all"
              />
            </div>
          )}

          {/* Botón principal de acción */}
          {(encontrado || (sinResultados && nombreManual.trim())) && (
            <button onClick={registrar} disabled={saving}
              className={`w-full py-5 rounded-2xl font-black text-white text-base flex items-center justify-center gap-3 shadow-lg active:scale-[0.98] transition-all disabled:opacity-60 ${
                (sinResultados || accionBtn === 'ingreso') ? 'bg-emerald-600 shadow-emerald-500/25' : 'bg-blue-600 shadow-blue-500/25'}`}>
              {saving ? <Loader2 size={22} className="animate-spin" /> : (
                <>
                  {(sinResultados || accionBtn === 'ingreso') ? <ArrowRightCircle size={24} /> : <ArrowLeftCircle size={24} />}
                  REGISTRAR {sinResultados ? 'INGRESO' : accionBtn.toUpperCase()}
                </>
              )}
            </button>
          )}

          {/* Quién está adentro ahora */}
          {adentroAhora.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Adentro ahora ({adentroAhora.length})</p>
              <div className="flex flex-col gap-1.5">
                {adentroAhora.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <p className="text-sm font-bold text-slate-700 flex-1 truncate">{e.personaNombre || e.text}</p>
                    <span className="text-[11px] text-slate-400 flex-shrink-0">{fmtEntryTime(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log cronológico de hoy */}
          {accesosDehoy.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Movimientos de hoy</p>
              <div className="flex flex-col gap-1.5">
                {accesosDehoy.map(e => (
                  <div key={e.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${e.type === 'ingreso' ? 'bg-slate-50 border-slate-100' : 'bg-slate-50 border-slate-100'}`}>
                    {e.type === 'ingreso'
                      ? <ArrowRightCircle size={14} className="text-emerald-500 flex-shrink-0" />
                      : <ArrowLeftCircle  size={14} className="text-blue-500 flex-shrink-0"    />}
                    <p className="text-xs font-medium text-slate-600 flex-1 truncate">{e.personaNombre || e.text}</p>
                    <span className={`text-[10px] font-black ${e.type === 'ingreso' ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {e.type === 'ingreso' ? 'ENT' : 'SAL'} {fmtEntryTime(e.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de entrada ────────────────────────────────────────────────────────

function EntradaCard({ entry }: { entry: LibroEntry }) {
  const cfg  = typeConfig(entry.type);
  const Icon = cfg.icon;
  const ecfg = entry.etiqueta ? etiquetaCfg(entry.etiqueta) : null;
  const gcfg = gravedadCfg(entry.gravedad);
  const [imgExpanded, setImgExpanded] = useState(false);

  return (
    <div className={`bg-white border border-l-4 rounded-xl shadow-sm overflow-hidden ${cfg.border} border-slate-200`}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.light}`}>
          <Icon size={14} className={cfg.color} />
        </div>
        <span className={`text-xs font-black uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
        {ecfg && (
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${ecfg.cls}`}>{ecfg.label}</span>
        )}
        {entry.gravedad && entry.gravedad !== 'BAJA' && (
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border flex items-center gap-1 ${gcfg.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${gcfg.dot}`} />{gcfg.label}
          </span>
        )}
        <span className="text-xs text-slate-400 ml-auto font-medium">{fmtEntryTime(entry.createdAt)}</span>
        <span className="text-[10px] text-slate-300">{fmtEntryDate(entry.createdAt)}</span>
      </div>

      {/* Contenido */}
      <div className="px-4 pb-3 flex flex-col gap-2.5">
        {entry.text && <p className="text-sm text-slate-700 leading-relaxed">{entry.text}</p>}
        {entry.transcription && !entry.text && <p className="text-sm text-slate-600 italic">"{entry.transcription}"</p>}
        {entry.accionTomada && (
          <div className="px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg">
            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider mb-0.5">Acción tomada</p>
            <p className="text-xs text-slate-700">{entry.accionTomada}</p>
          </div>
        )}
        {entry.imageUrl && (
          <img src={entry.imageUrl} alt="" onClick={() => setImgExpanded(true)}
            className="w-full rounded-lg object-cover max-h-52 border border-slate-100 cursor-pointer" />
        )}
        {entry.audioUrl && (
          <div className="flex flex-col gap-1">
            <audio src={entry.audioUrl} controls className="w-full h-8" />
            {entry.transcription && <p className="text-[11px] text-slate-400 italic">"{entry.transcription}"</p>}
          </div>
        )}
        {entry.empleadoNombre && (
          <p className="text-[11px] text-slate-300 pt-1 border-t border-slate-50">{entry.empleadoNombre}</p>
        )}
      </div>

      {imgExpanded && entry.imageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90" onClick={() => setImgExpanded(false)}>
          <img src={entry.imageUrl} alt="" className="max-w-full max-h-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}

// ─── Libro de Guardia ─────────────────────────────────────────────────────────

function LibroGuardia({ objetivo, turno, entries, totalHoy, empNombre, isAdmin, onBack, onLogout }: {
  objetivo: ObjetivoInfo; turno: TurnoActivo | null; entries: LibroEntry[];
  totalHoy: number; empNombre: string; isAdmin: boolean; onBack?: () => void; onLogout: () => void;
}) {
  const [showNueva,  setShowNueva]  = useState(false);
  const [showAcceso, setShowAcceso] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Topbar */}
      <div className="bg-white border-b border-slate-200 px-4 pt-4 pb-3 flex-shrink-0 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          {isAdmin && onBack ? (
            <button onClick={onBack} className="flex items-center gap-1 text-indigo-600 text-sm font-bold">
              <ChevronLeft size={16} /> Clientes
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-indigo-600" strokeWidth={1.5} />
              <span className="text-indigo-600 text-xs font-black uppercase tracking-widest">Libro de Guardia</span>
            </div>
          )}
          <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-500 font-medium bg-white hover:bg-slate-50 transition-colors">
            <LogOut size={12} /> Salir
          </button>
        </div>
        <h1 className="text-slate-800 font-black text-lg leading-tight">{objetivo.name}</h1>
        {objetivo.clientName && <p className="text-slate-500 text-xs mt-0.5">{objetivo.clientName}</p>}
        {objetivo.address && <p className="text-slate-400 text-[11px] mt-0.5 flex items-center gap-1"><MapPin size={10} />{objetivo.address}</p>}
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {turno ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
              <CheckCircle2 size={11} /> Turno activo · {fmtTime(turno.startTime)}–{fmtTime(turno.endTime)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-bold">
              <ShieldCheck size={11} strokeWidth={2} /> Modo admin
            </span>
          )}
          {totalHoy > 0 && (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-500 text-[11px] font-medium">
              <Activity size={10} /> {totalHoy} entr. hoy
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-black text-indigo-600">
            {empNombre.charAt(0).toUpperCase()}
          </div>
          <span className="text-slate-600 text-xs font-medium">{empNombre}</span>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28 flex flex-col gap-3">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-3">
              <Bell size={24} className="text-slate-300" strokeWidth={1.5} />
            </div>
            <p className="text-slate-400 text-sm font-medium">Sin entradas hoy</p>
            <p className="text-slate-300 text-xs mt-1">Registrá la primera novedad del turno</p>
          </div>
        ) : entries.map(e => <EntradaCard key={e.id} entry={e} />)}
        <div ref={listEndRef} />
      </div>

      {/* FABs */}
      <div className="fixed bottom-6 inset-x-0 flex justify-center z-40 pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button onClick={() => setShowAcceso(true)}
            className="flex items-center gap-2 px-5 py-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-sm shadow-lg shadow-slate-200/60 transition-all active:scale-95 hover:bg-slate-50">
            <UserCheck size={17} className="text-indigo-500" /> Acceso
          </button>
          <button onClick={() => setShowNueva(true)}
            className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm shadow-lg shadow-indigo-500/25 transition-all active:scale-95">
            <Plus size={18} /> Nueva entrada
          </button>
        </div>
      </div>

      {showNueva && (
        <NuevaEntradaPanel onClose={() => setShowNueva(false)}
          onSave={() => { setShowNueva(false); setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100); }}
          empleadoNombre={empNombre} objectiveId={objetivo.id} turno={turno} objetivo={objetivo} />
      )}
      {showAcceso && (
        <AccesoRapidoPanel onClose={() => setShowAcceso(false)}
          onSave={() => setShowAcceso(false)}
          empleadoNombre={empNombre} objectiveId={objetivo.id} turno={turno} objetivo={objetivo} entries={entries} />
      )}
    </div>
  );
}

// ─── Portal principal ──────────────────────────────────────────────────────────

export default function ObjetivoPortal() {
  const [fireUser,    setFireUser]    = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [empNombre,   setEmpNombre]   = useState('');
  const [isAdmin,     setIsAdmin]     = useState(false);
  const [turno,       setTurno]       = useState<TurnoActivo | null>(null);
  const [objetivo,    setObjetivo]    = useState<ObjetivoInfo | null>(null);
  const [clientes,    setClientes]    = useState<ClienteConObjetivos[]>([]);
  const [entries,     setEntries]     = useState<LibroEntry[]>([]);
  const [loadingInit, setLoadingInit] = useState(false);
  const [totalHoy,    setTotalHoy]    = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setFireUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  useEffect(() => { if (!fireUser) return; init(fireUser.uid); }, [fireUser]);

  useEffect(() => {
    if (!objetivo) return;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const q = query(collection(db, 'libro_guardia'), where('objectiveId', '==', objetivo.id), where('createdAt', '>=', Timestamp.fromDate(hoy)), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => { const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as LibroEntry)); setEntries(docs); setTotalHoy(docs.length); });
    return () => unsub();
  }, [objetivo?.id]);

  const init = async (uid: string) => {
    setLoadingInit(true);
    try {
      let inSystemUsers = false; let adminName = '';
      try { const s = await getDoc(doc(db, 'system_users', uid)); if (s.exists()) { inSystemUsers = true; const d = s.data(); adminName = [d.firstName, d.lastName].filter(Boolean).join(' ') || d.displayName || d.email || ''; } } catch { /* ignorar */ }
      let inEmpleados = false; let empName = '';
      const empSnap = await getDocs(query(collection(db, 'empleados'), where('uid', '==', uid)));
      if (!empSnap.empty) { inEmpleados = true; const d = empSnap.docs[0].data(); empName = [d.firstName, d.lastName].filter(Boolean).join(' '); }
      const admin = inSystemUsers || !inEmpleados;
      setIsAdmin(admin);
      if (admin) { setEmpNombre(adminName || auth.currentUser?.email || 'Admin'); await loadAllObjetivos(); }
      else { setEmpNombre(empName || fireUser?.email || 'Guardia'); await loadTurnoActivo(uid); }
    } catch (e) { console.error('Error init:', e); } finally { setLoadingInit(false); }
  };

  const loadAllObjetivos = async () => {
    const snap = await getDocs(collection(db, 'clients'));
    const lista: ClienteConObjetivos[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const obs: ObjetivoInfo[] = (data.objetivos || []).map((o: any) => ({ id: o.id, name: o.name || o.nombre || '', address: o.address || o.direccion || '', clientName: data.name || data.nombre || '', clientId: d.id })).filter((o: ObjetivoInfo) => o.id && o.name);
      if (obs.length > 0) lista.push({ id: d.id, name: data.name || data.nombre || d.id, objetivos: obs });
    }
    lista.sort((a, b) => a.name.localeCompare(b.name)); setClientes(lista);
  };

  const loadTurnoActivo = async (uid: string) => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
    const snap = await getDocs(query(collection(db, 'turnos'), where('employeeId', '==', uid), where('startTime', '>=', Timestamp.fromDate(hoy)), where('startTime', '<', Timestamp.fromDate(manana))));
    const turnos = snap.docs.map(d => ({ id: d.id, ...d.data() } as TurnoActivo)).filter(t => !t['isAbsent'] && !t['isFranco'] && !t['draft']);
    if (turnos.length === 0) return;
    const t = turnos[0]; setTurno(t);
    if (t.objectiveId) await resolveObjetivo(t);
  };

  const resolveObjetivo = async (t: TurnoActivo) => {
    if (!t.objectiveId) return;
    try {
      const snap = await getDocs(collection(db, 'clients'));
      for (const clientDoc of snap.docs) {
        const data = clientDoc.data();
        const found = (data.objetivos || []).find((o: any) => o.id === t.objectiveId);
        if (found) { setObjetivo({ id: t.objectiveId!, name: found.name || t.objectiveName || 'Objetivo', address: found.address || found.direccion || '', clientName: data.name || data.nombre || t.clientName || '', clientId: clientDoc.id }); return; }
      }
    } catch { /* ignorar */ }
    setObjetivo({ id: t.objectiveId!, name: t.objectiveName || 'Objetivo', address: '', clientName: t.clientName || '', clientId: t.clientId || '' });
  };

  const handleLogout = () => { signOut(auth); setObjetivo(null); setTurno(null); setIsAdmin(false); };

  if (authLoading || loadingInit) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
        <ShieldCheck size={24} className="text-white" strokeWidth={1.5} />
      </div>
      <Loader2 size={20} className="text-indigo-500 animate-spin" />
    </div>
  );

  if (!fireUser) return <><Head><title>Libro de Guardia · COSP</title></Head><LoginScreen onLogin={u => setFireUser(u)} /></>;
  if (isAdmin && !objetivo) return <><Head><title>Libro de Guardia · COSP</title></Head><SelectorObjetivo clientes={clientes} onSelect={obj => setObjetivo(obj)} onLogout={handleLogout} nombre={empNombre} /></>;
  if (!isAdmin && !turno) return <><Head><title>Libro de Guardia · COSP</title></Head><SinTurno nombre={empNombre} onLogout={handleLogout} /></>;
  if (!objetivo) return null;

  return <><Head><title>{objetivo.name} · Libro de Guardia</title></Head><LibroGuardia objetivo={objetivo} turno={turno} entries={entries} totalHoy={totalHoy} empNombre={empNombre} isAdmin={isAdmin} onBack={isAdmin ? () => setObjetivo(null) : undefined} onLogout={handleLogout} /></>;
}
