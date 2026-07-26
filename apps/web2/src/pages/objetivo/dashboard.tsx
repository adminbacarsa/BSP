import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { db, auth, storage, onSnapshotFresh } from '@/lib/firebase';
import {
  collection, query, where, orderBy,
  addDoc, deleteDoc, serverTimestamp, getDocs, getDoc, doc, Timestamp, setDoc
} from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  ShieldCheck, LogOut, Mic, MicOff, Camera, Image as ImageIcon,
  AlertTriangle, ArrowRightCircle, ArrowLeftCircle, Navigation,
  Users, Siren, Bell, Send, X, Clock, CheckCircle2, Loader2,
  ChevronLeft, ChevronRight, Search, Building2, MapPin, Plus,
  Activity, Lock, Mail, Eye, EyeOff, AlertCircle, Tag, Zap,
  UserCheck, Car, UserX, ScanLine, ShieldAlert, ShieldOff, Trash2,
  Upload, Download
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

interface PersonalAutorizado {
  id: string;
  objectiveId: string;
  clientId: string;
  nombre: string;
  dni?: string;
  legajo?: string;
  patente?: string;
  tipo: 'empleado' | 'vehiculo' | 'visitante';
  cargo?: string;
  observaciones?: string;
  activo: boolean;
  creadoEn?: any;
  creadoPor?: string;
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
  empresaId?: string;
}

interface ClienteConObjetivos {
  id: string;
  name: string;
  objetivos: ObjetivoInfo[];
}

interface ObjetivoConsigna {
  id: string;
  objectiveId: string;
  objectiveName?: string;
  texto: string;
  status: 'ACTIVE' | 'INACTIVE';
  creadoPorNombre?: string;
  createdAt?: any;
}

interface ConsignaLectura {
  id: string;
  consignaId: string;
  objectiveId: string;
  userUid: string;
  userName: string;
  readAt?: any;
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

// Parsea el PDF417 del dorso del DNI argentino
// Formato: @APELLIDO@NOMBRE@SEGUNDO_NOMBRE@DNI@SEXO@FECHA_NAC@...
const parseDNIBarcode = (raw: string): { dni: string; nombre: string; apellido: string } | null => {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.startsWith('@') ? raw.slice(1) : raw;
  const parts = clean.split('@');
  if (parts.length < 4) return null;
  const dni = parts[3]?.trim().replace(/\D/g, '');
  if (!dni || !/^\d{7,8}$/.test(dni)) return null;
  return { apellido: parts[0]?.trim() || '', nombre: parts[1]?.trim() || '', dni };
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

// ─── Scanner DNI (PDF417) ─────────────────────────────────────────────────────

function DNIScannerModal({ onResult, onClose }: {
  onResult: (data: { dni: string; nombre: string; apellido: string }) => void;
  onClose: () => void;
}) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef   = useRef<any>(null);
  const [fase, setFase] = useState<'init' | 'scan' | 'noSupport' | 'noCamera'>('init');

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      clearInterval(loopRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };

    const init = async () => {
      if (!('BarcodeDetector' in window)) { setFase('noSupport'); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setFase('scan');

        const detector = new (window as any).BarcodeDetector({ formats: ['pdf417', 'qr_code', 'code_128'] });
        loopRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            for (const code of codes) {
              const parsed = parseDNIBarcode(code.rawValue);
              if (parsed?.dni) { cleanup(); onResult(parsed); return; }
            }
          } catch { /* continuar */ }
        }, 350);
      } catch { setFase('noCamera'); }
    };

    init();
    return () => { cancelled = true; cleanup(); };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="px-5 pt-safe pt-10 pb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-white font-black text-lg">Escanear DNI</p>
          <p className="text-slate-400 text-xs mt-0.5">Código de barras del dorso del documento</p>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center active:bg-white/20">
          <X size={20} className="text-white" />
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />

        {fase === 'scan' && (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Marco de escaneo — proporción tarjeta ID */}
            <div className="relative" style={{ width: '85vw', maxWidth: 360, aspectRatio: '1.586' }}>
              <div className="absolute inset-0 rounded-2xl border-2 border-white/20 bg-transparent" />
              {/* Esquinas */}
              {[
                'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-2xl',
                'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-2xl',
                'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-2xl',
                'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-2xl',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-10 h-10 border-indigo-400 ${cls}`} />
              ))}
              {/* Línea de escaneo animada */}
              <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent rounded-full"
                style={{ animation: 'scanLine 2.5s ease-in-out infinite', top: '50%' }} />
            </div>
          </div>
        )}

        {fase === 'init' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={40} className="text-indigo-400 animate-spin" />
          </div>
        )}

        {(fase === 'noSupport' || fase === 'noCamera') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center bg-black/80">
            <AlertCircle size={52} className="text-amber-400" />
            <div>
              <p className="text-white font-black text-lg">
                {fase === 'noSupport' ? 'Escáner no disponible' : 'Sin acceso a cámara'}
              </p>
              <p className="text-slate-300 text-sm mt-2 leading-relaxed">
                {fase === 'noSupport'
                  ? 'Esta función requiere Chrome en Android. Ingresá el DNI manualmente.'
                  : 'Verificá los permisos de cámara en el navegador.'}
              </p>
            </div>
            <button onClick={onClose}
              className="px-8 py-4 rounded-2xl bg-white text-slate-900 font-black text-sm active:scale-95 transition-all">
              Ingresar manualmente
            </button>
          </div>
        )}
      </div>

      <div className="px-6 pb-10 pt-5 text-center flex-shrink-0">
        {fase === 'scan' && (
          <>
            <p className="text-slate-300 text-sm">Apuntá al código de barras del <strong className="text-white">dorso</strong> del DNI</p>
            <p className="text-slate-500 text-xs mt-1">El escaneo es automático</p>
          </>
        )}
      </div>

      <style>{`@keyframes scanLine { 0%,100%{transform:translateY(-16px);opacity:.4} 50%{transform:translateY(16px);opacity:1} }`}</style>
    </div>
  );
}

// ─── Control de Acceso ────────────────────────────────────────────────────────

function AccesoRapidoPanel({ onSave, onClose, objectiveId, turno, objetivo, entries, empleadoNombre, isAdmin }: {
  onSave: () => void; onClose: () => void; objectiveId: string;
  turno: TurnoActivo | null; objetivo: ObjetivoInfo;
  entries: LibroEntry[]; empleadoNombre: string; isAdmin: boolean;
}) {
  const [modo,          setModo]          = useState<'persona' | 'vehiculo'>('persona');
  const [busqueda,      setBusqueda]      = useState('');
  const [buscando,      setBuscando]      = useState(false);
  const [encontrado,    setEncontrado]    = useState<PersonaEncontrada | null>(null);
  const [sinResultados, setSinResultados] = useState(false);
  const [nombreManual,  setNombreManual]  = useState('');
  const [saving,        setSaving]        = useState(false);
  const [exito,         setExito]         = useState<'ingreso' | 'egreso' | null>(null);
  const [showScanner,   setShowScanner]   = useState(false);
  const [showGestionar, setShowGestionar] = useState(false);

  // Lista de autorizados del objetivo
  const [autorizados,   setAutorizados]   = useState<PersonalAutorizado[]>([]);
  const [nuevoNombre,   setNuevoNombre]   = useState('');
  const [nuevoDNI,      setNuevoDNI]      = useState('');
  const [nuevoLegajo,   setNuevoLegajo]   = useState('');
  const [nuevoTipo,     setNuevoTipo]     = useState<'empleado' | 'vehiculo' | 'visitante'>('empleado');
  const [nuevoCargo,    setNuevoCargo]    = useState('');
  const [guardandoAuth, setGuardandoAuth] = useState(false);
  const [csvRows,       setCsvRows]       = useState<any[] | null>(null);
  const [importando,    setImportando]    = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Cargar personal autorizado del objetivo
  useEffect(() => {
    getDocs(query(collection(db, 'personal_autorizado'), where('objectiveId', '==', objectiveId)))
      .then(snap => setAutorizados(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalAutorizado)).filter(a => a.activo !== false)
      )).catch(() => {});
  }, [objectiveId]);

  const accesosDehoy = entries
    .filter(e => e.type === 'ingreso' || e.type === 'egreso')
    .slice().sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));

  const getEstado = (id: string): 'ADENTRO' | 'AFUERA' => {
    const propios = accesosDehoy.filter(e => e.identificador === id);
    return !propios.length || propios[0].type === 'egreso' ? 'AFUERA' : 'ADENTRO';
  };

  const resetBusqueda = () => { setEncontrado(null); setSinResultados(false); setNombreManual(''); };

  // Busca en la lista de autorizados del objetivo (client-side)
  const buscarEnLista = (txt: string): PersonaEncontrada | null => {
    const q = txt.toLowerCase().trim();
    const found = autorizados.find(a =>
      (a.dni    && a.dni.toLowerCase()            === q) ||
      (a.legajo && String(a.legajo).toLowerCase() === q) ||
      (a.patente && a.patente.toLowerCase()       === q) ||
      (a.nombre && a.nombre.toLowerCase().includes(q))
    );
    if (!found) return null;
    return {
      docId: found.id, nombre: found.nombre,
      identificador: found.dni || found.legajo || found.patente || txt,
      identificadorTipo: found.dni ? 'dni' : found.legajo ? 'legajo' : found.patente ? 'patente' : 'nombre',
      tipo: found.tipo === 'vehiculo' ? 'vehiculo' : 'empleado',
      autorizado: true, extra: found.cargo || '',
    };
  };

  const buscar = async () => {
    const txt = busqueda.trim(); if (!txt) return;

    if (modo === 'vehiculo') {
      const patente = txt.toUpperCase();
      const enLista = autorizados.find(a => a.patente?.toUpperCase() === patente);
      setEncontrado({ nombre: patente, identificador: patente, identificadorTipo: 'patente', tipo: 'vehiculo', autorizado: !!enLista, extra: enLista?.cargo || '' });
      setSinResultados(false); return;
    }

    // 1. Lista de autorizados del objetivo
    const enLista = buscarEnLista(txt);
    if (enLista) { setEncontrado(enLista); setSinResultados(false); return; }

    // 2. Colección empleados (persona conocida pero no autorizada para este objetivo)
    setBuscando(true); resetBusqueda();
    try {
      const tenantEmpresaId = String(objetivo.empresaId ?? '').trim();
      const empCol = tenantEmpresaId
        ? query(collection(db, 'empleados'), where('empresaId', '==', tenantEmpresaId))
        : collection(db, 'empleados');
      const snap = await getDocs(empCol);
      const q = txt.toLowerCase(); let found: PersonaEncontrada | null = null;
      for (const d of snap.docs) {
        const data = d.data();
        const nombre = [data.firstName, data.lastName].filter(Boolean).join(' ');
        const legajo = String(data.legajo || data.employeeNumber || '');
        const dni    = String(data.dni    || data.document       || '');
        if (legajo === q || dni === q || nombre.toLowerCase() === q || nombre.toLowerCase().includes(q)) {
          found = {
            docId: d.id, nombre: nombre || 'Empleado',
            identificador: legajo || dni || txt,
            identificadorTipo: legajo === q ? 'legajo' : dni === q ? 'dni' : 'nombre',
            tipo: 'empleado', autorizado: false,
            extra: data.cargo || data.position || '',
          };
          break;
        }
      }
      if (found) setEncontrado(found);
      else { setSinResultados(true); setNombreManual(txt); }
    } catch { setSinResultados(true); }
    finally { setBuscando(false); }
  };

  // Resultado del scanner DNI
  const handleScanResult = async (data: { dni: string; nombre: string; apellido: string }) => {
    setShowScanner(false);
    const fullName = `${data.apellido} ${data.nombre}`.trim();
    setBusqueda(data.dni);
    const enLista = buscarEnLista(data.dni);
    if (enLista) { setEncontrado(enLista); setSinResultados(false); return; }
    setBuscando(true); resetBusqueda();
    try {
      const tenantEmpresaId = String(objetivo.empresaId ?? '').trim();
      const empCol = tenantEmpresaId
        ? query(collection(db, 'empleados'), where('empresaId', '==', tenantEmpresaId))
        : collection(db, 'empleados');
      const snap = await getDocs(empCol);
      let found: PersonaEncontrada | null = null;
      for (const d of snap.docs) {
        const emp = d.data();
        const dni = String(emp.dni || emp.document || '');
        if (dni === data.dni) {
          const nombre = [emp.firstName, emp.lastName].filter(Boolean).join(' ');
          found = { docId: d.id, nombre, identificador: data.dni, identificadorTipo: 'dni', tipo: 'empleado', autorizado: false, extra: emp.cargo || '' };
          break;
        }
      }
      if (found) setEncontrado(found);
      else { setSinResultados(true); setNombreManual(fullName || data.dni); }
    } catch { setSinResultados(true); }
    finally { setBuscando(false); }
  };

  const registrar = async () => {
    const nombre = encontrado?.nombre || nombreManual.trim();
    const identificador = encontrado?.identificador || busqueda.trim();
    if (!nombre) return;
    const accion: 'ingreso' | 'egreso' = encontrado
      ? (getEstado(encontrado.identificador) === 'ADENTRO' ? 'egreso' : 'ingreso') : 'ingreso';
    setSaving(true);
    try {
      await addDoc(collection(db, 'libro_guardia'), {
        objectiveId, clientId: turno?.clientId || objetivo.clientId || '',
        objetivoNombre: objetivo.name || '', clientName: objetivo.clientName || '',
        shiftId: turno?.id || '', employeeId: auth.currentUser?.uid || '',
        empleadoNombre, type: accion, etiqueta: 'ACCESO',
        gravedad: encontrado?.autorizado ? 'BAJA' : (sinResultados ? 'MEDIA' : 'MEDIA'),
        text: `${accion === 'ingreso' ? 'Ingreso' : 'Egreso'} · ${nombre}`,
        identificador, identificadorTipo: encontrado?.identificadorTipo || 'nombre',
        personaNombre: nombre, personaId: encontrado?.docId || '',
        personaTipo: encontrado?.tipo || 'visitante', autorizado: encontrado?.autorizado ?? false,
        createdAt: serverTimestamp(),
      });
      setExito(accion);
      setTimeout(() => { onSave(); onClose(); }, 1600);
    } catch (e: any) { alert('Error: ' + e.message); setSaving(false); }
  };

  // Agregar a la lista de autorizados del objetivo
  const descargarPlantilla = () => {
    const csv = 'nombre,dni,legajo,patente,tipo,cargo\nJuan García,35123456,1234,,empleado,Vigilador\nMaria López,27654321,,,empleado,Operadora\nAB 123 CD,,,,vehiculo,Camión reparto';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'plantilla_personal_autorizado.csv';
    a.click();
  };

  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { setCsvRows([]); return; }
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const row: any = {};
        headers.forEach((h, i) => { row[h] = cols[i] || ''; });
        return {
          nombre: row.nombre || row.name || '',
          dni:    row.dni || row.documento || '',
          legajo: row.legajo || row.numero || '',
          patente:row.patente || '',
          tipo:   (['empleado','vehiculo','visitante'].includes(row.tipo) ? row.tipo : 'empleado') as any,
          cargo:  row.cargo || row.puesto || '',
        };
      }).filter(r => r.nombre.trim());
      setCsvRows(rows);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const importarCSV = async () => {
    if (!csvRows?.length) return;
    setImportando(true);
    try {
      for (const row of csvRows) {
        await addDoc(collection(db, 'personal_autorizado'), {
          objectiveId, clientId: objetivo.clientId || '',
          nombre: row.nombre, tipo: row.tipo, cargo: row.cargo,
          ...(row.dni     && { dni: row.dni }),
          ...(row.legajo  && { legajo: row.legajo }),
          ...(row.patente && { patente: row.patente }),
          activo: true, creadoEn: serverTimestamp(), creadoPor: auth.currentUser?.uid || '',
        });
      }
      await getDocs(query(collection(db, 'personal_autorizado'), where('objectiveId', '==', objectiveId)))
        .then(snap => setAutorizados(snap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalAutorizado)).filter(a => a.activo !== false)));
      setCsvRows(null);
    } catch (e: any) { alert('Error al importar: ' + e.message); }
    finally { setImportando(false); }
  };

  const agregarAutorizado = async (desde?: PersonaEncontrada) => {
    const nombre = desde?.nombre || nuevoNombre.trim(); if (!nombre) return;
    setGuardandoAuth(true);
    try {
      const payload: any = {
        objectiveId, clientId: objetivo.clientId || '', nombre,
        tipo: desde?.tipo === 'vehiculo' ? 'vehiculo' : nuevoTipo,
        cargo: desde?.extra || nuevoCargo.trim(),
        activo: true, creadoEn: serverTimestamp(), creadoPor: auth.currentUser?.uid || '',
      };
      if (desde?.identificadorTipo === 'dni')    payload.dni    = desde.identificador;
      if (desde?.identificadorTipo === 'legajo') payload.legajo = desde.identificador;
      if (desde?.identificadorTipo === 'patente')payload.patente= desde.identificador;
      if (!desde && nuevoDNI.trim())    payload.dni    = nuevoDNI.trim();
      if (!desde && nuevoLegajo.trim()) payload.legajo = nuevoLegajo.trim();
      const ref2 = await addDoc(collection(db, 'personal_autorizado'), payload);
      const newA: PersonalAutorizado = { id: ref2.id, ...payload };
      setAutorizados(prev => [...prev, newA]);
      if (desde && encontrado) setEncontrado({ ...encontrado, autorizado: true });
      setNuevoNombre(''); setNuevoDNI(''); setNuevoLegajo(''); setNuevoCargo(''); setNuevoTipo('empleado');
    } catch (e: any) { alert('Error: ' + e.message); }
    finally { setGuardandoAuth(false); }
  };

  const quitarAutorizado = async (id: string) => {
    if (!confirm('¿Quitar de autorizados?')) return;
    try { await deleteDoc(doc(db, 'personal_autorizado', id)); setAutorizados(prev => prev.filter(a => a.id !== id)); }
    catch (e: any) { alert('Error: ' + e.message); }
  };

  const estado    = encontrado ? getEstado(encontrado.identificador) : null;
  const accionBtn = estado === 'ADENTRO' ? 'egreso' : 'ingreso';

  // Quién está adentro ahora
  const adentroAhora: LibroEntry[] = [];
  const seen = new Set<string>();
  for (const e of [...accesosDehoy].reverse()) {
    if (!e.identificador || seen.has(e.identificador)) continue;
    seen.add(e.identificador);
    if (e.type === 'ingreso') adentroAhora.push(e);
  }

  if (exito) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`flex flex-col items-center gap-4 px-12 py-12 rounded-3xl shadow-2xl ${exito === 'ingreso' ? 'bg-emerald-600' : 'bg-blue-600'}`}>
        <CheckCircle2 size={64} className="text-white" strokeWidth={1.5} />
        <p className="text-white font-black text-xl tracking-wide">{exito === 'ingreso' ? 'INGRESO' : 'EGRESO'} REGISTRADO</p>
      </div>
    </div>
  );

  return (
    <>
      {showScanner && <DNIScannerModal onResult={handleScanResult} onClose={() => setShowScanner(false)} />}

      <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-sm"
        onClick={ev => { if (ev.target === ev.currentTarget) onClose(); }}>
        <div className="bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[95dvh]">

          <div className="flex justify-center pt-3 cursor-pointer" onClick={onClose}>
            <div className="w-10 h-1 rounded-full bg-slate-200" />
          </div>
          <div className="px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div>
              <h3 className="text-slate-900 font-black text-base">Control de Acceso</h3>
              <p className="text-slate-400 text-[11px] mt-0.5">{objetivo.name} · {autorizados.length} autorizados</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
              <X size={17} className="text-slate-500" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 pb-8 flex flex-col gap-5">

            {/* Modo Persona / Vehículo */}
            <div className="grid grid-cols-2 gap-1.5 bg-slate-100 rounded-2xl p-1.5">
              {([['persona', UserCheck, 'Persona'], ['vehiculo', Car, 'Vehículo']] as const).map(([m, Icon, lbl]) => (
                <button key={m} onClick={() => { setModo(m); setBusqueda(''); resetBusqueda(); }}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black transition-all ${modo === m ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                  <Icon size={17} /> {lbl}
                </button>
              ))}
            </div>

            {/* Input búsqueda + scan */}
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                {modo === 'persona' ? 'DNI, Legajo o Nombre' : 'Patente del vehículo'}
              </p>
              <div className="flex gap-2">
                {modo === 'persona' && (
                  <button onClick={() => setShowScanner(true)}
                    className="w-14 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center active:scale-95 transition-all hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600">
                    <ScanLine size={20} />
                  </button>
                )}
                <input ref={inputRef}
                  value={busqueda}
                  onChange={e => { setBusqueda(modo === 'vehiculo' ? e.target.value.toUpperCase() : e.target.value); resetBusqueda(); }}
                  onKeyDown={e => e.key === 'Enter' && buscar()}
                  placeholder={modo === 'persona' ? 'Ej: 35123456  ·  García Juan  ·  Leg.42' : 'Ej: AB 123 CD'}
                  autoCapitalize={modo === 'vehiculo' ? 'characters' : 'words'}
                  autoComplete="off"
                  className="flex-1 px-4 py-4 rounded-2xl border-2 border-slate-200 text-base font-bold text-slate-900 placeholder-slate-300 outline-none focus:border-indigo-400 transition-all"
                />
                <button onClick={buscar} disabled={buscando || !busqueda.trim()}
                  className="w-14 rounded-2xl bg-indigo-600 text-white disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center">
                  {buscando ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
                </button>
              </div>
              {modo === 'persona' && (
                <p className="text-[10px] text-slate-400 mt-1.5 ml-1">
                  Toca <ScanLine size={10} className="inline" /> para escanear el DNI con la cámara
                </p>
              )}
            </div>

            {/* Resultado */}
            {encontrado && (
              <div className="flex flex-col gap-3">
                <div className={`rounded-2xl border-2 p-4 ${
                  encontrado.tipo === 'vehiculo' ? 'bg-sky-50 border-sky-200' :
                  encontrado.autorizado          ? 'bg-emerald-50 border-emerald-200' :
                                                 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                      encontrado.tipo === 'vehiculo' ? 'bg-sky-100' :
                      encontrado.autorizado          ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                      {encontrado.tipo === 'vehiculo'
                        ? <Car size={26} className="text-sky-600" />
                        : encontrado.autorizado
                        ? <ShieldCheck size={26} className="text-emerald-600" />
                        : <ShieldOff size={26} className="text-amber-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-900 text-lg leading-tight">{encontrado.nombre}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {encontrado.tipo === 'vehiculo' ? 'Vehículo' : `${encontrado.identificadorTipo.toUpperCase()}: ${encontrado.identificador}`}
                        {encontrado.extra && ` · ${encontrado.extra}`}
                      </p>
                      {/* Badge autorización */}
                      <span className={`mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black border ${
                        encontrado.tipo === 'vehiculo'
                          ? 'bg-sky-50 border-sky-200 text-sky-700'
                          : encontrado.autorizado
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                        {encontrado.tipo === 'vehiculo' ? '🚗 Vehículo' :
                         encontrado.autorizado ? '✓ Autorizado para este objetivo' : '⚠ No autorizado para este objetivo'}
                      </span>
                      {/* Estado adentro/afuera */}
                      <div className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ml-2 ${
                        estado === 'ADENTRO' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                        <span className={`w-2 h-2 rounded-full ${estado === 'ADENTRO' ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`} />
                        {estado === 'ADENTRO' ? 'ADENTRO' : 'AFUERA'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Admin: agregar a autorizados si no está en la lista */}
                {isAdmin && !encontrado.autorizado && (
                  <button onClick={() => agregarAutorizado(encontrado)} disabled={guardandoAuth}
                    className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 text-indigo-700 font-bold text-sm active:scale-95 transition-all disabled:opacity-60">
                    {guardandoAuth ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
                    Agregar a autorizados de este objetivo
                  </button>
                )}
              </div>
            )}

            {/* No encontrado */}
            {sinResultados && (
              <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <UserX size={20} className="text-amber-600" />
                  </div>
                  <div>
                    <p className="font-black text-amber-900 text-sm">No registrado en el sistema</p>
                    <p className="text-xs text-amber-600">Ingresá el nombre para registrar como visitante</p>
                  </div>
                </div>
                <input type="text" value={nombreManual} onChange={e => setNombreManual(e.target.value)}
                  placeholder="Nombre completo..."
                  className="w-full px-4 py-3 rounded-xl border-2 border-amber-200 bg-white text-sm font-medium text-slate-800 placeholder-slate-300 outline-none focus:border-amber-400 transition-all"
                />
              </div>
            )}

            {/* Botón acción principal */}
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

            {/* Adentro ahora */}
            {adentroAhora.length > 0 && (
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Adentro ahora · {adentroAhora.length}</p>
                <div className="flex flex-col gap-1.5">
                  {adentroAhora.map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                      <p className="text-sm font-bold text-slate-700 flex-1 truncate">{e.personaNombre || e.text}</p>
                      <span className="text-[11px] text-slate-400">{fmtEntryTime(e.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Movimientos del día */}
            {accesosDehoy.length > 0 && (
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Movimientos de hoy</p>
                <div className="flex flex-col gap-1.5">
                  {accesosDehoy.map(e => (
                    <div key={e.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      {e.type === 'ingreso'
                        ? <ArrowRightCircle size={14} className="text-emerald-500 flex-shrink-0" />
                        : <ArrowLeftCircle  size={14} className="text-blue-500 flex-shrink-0" />}
                      <p className="text-xs font-medium text-slate-600 flex-1 truncate">{e.personaNombre || e.text}</p>
                      <span className={`text-[10px] font-black ${e.type === 'ingreso' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {e.type === 'ingreso' ? 'ENT' : 'SAL'} {fmtEntryTime(e.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Gestionar autorizados (admin) */}
            {isAdmin && (
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <button onClick={() => setShowGestionar(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-2 text-slate-700 font-black text-sm">
                    <ShieldAlert size={16} className="text-indigo-500" />
                    Personal autorizado · {autorizados.length}
                  </div>
                  <ChevronRight size={16} className={`text-slate-400 transition-transform ${showGestionar ? 'rotate-90' : ''}`} />
                </button>

                {showGestionar && (
                  <div className="px-4 pb-4 flex flex-col gap-4 pt-3">
                    {/* Lista */}
                    {autorizados.length === 0
                      ? <p className="text-sm text-slate-400 text-center py-4">Sin personal autorizado aún</p>
                      : autorizados.map(a => (
                        <div key={a.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${a.tipo === 'vehiculo' ? 'bg-sky-100' : 'bg-indigo-100'}`}>
                            {a.tipo === 'vehiculo' ? <Car size={14} className="text-sky-600" /> : <UserCheck size={14} className="text-indigo-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{a.nombre}</p>
                            <p className="text-[11px] text-slate-400">
                              {[a.dni && `DNI: ${a.dni}`, a.legajo && `Leg: ${a.legajo}`, a.patente, a.cargo].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button onClick={() => quitarAutorizado(a.id)}
                            className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0 active:scale-90 transition-all">
                            <Trash2 size={13} className="text-red-500" />
                          </button>
                        </div>
                      ))
                    }

                    {/* Formulario agregar */}
                    <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2.5">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Agregar nuevo</p>
                      <div className="grid grid-cols-3 gap-1.5 bg-white rounded-xl border border-slate-200 p-1">
                        {(['empleado', 'vehiculo', 'visitante'] as const).map(t => (
                          <button key={t} onClick={() => setNuevoTipo(t)}
                            className={`py-2 rounded-lg text-xs font-black transition-all capitalize ${nuevoTipo === t ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                            {t === 'vehiculo' ? 'Vehículo' : t === 'visitante' ? 'Visitante' : 'Empleado'}
                          </button>
                        ))}
                      </div>
                      <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} placeholder="Nombre *"
                        className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-300 outline-none focus:border-indigo-400 transition-all" />
                      <div className="grid grid-cols-2 gap-2">
                        <input value={nuevoTipo === 'vehiculo' ? '' : nuevoDNI} onChange={e => setNuevoDNI(e.target.value)}
                          placeholder={nuevoTipo === 'vehiculo' ? 'Patente' : 'DNI'}
                          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-300 outline-none focus:border-indigo-400 transition-all" />
                        <input value={nuevoTipo === 'vehiculo' ? '' : nuevoLegajo} onChange={e => setNuevoLegajo(e.target.value)}
                          placeholder={nuevoTipo === 'vehiculo' ? '—' : 'Legajo'}
                          disabled={nuevoTipo === 'vehiculo'}
                          className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-300 outline-none focus:border-indigo-400 transition-all disabled:opacity-40" />
                      </div>
                      <input value={nuevoCargo} onChange={e => setNuevoCargo(e.target.value)} placeholder="Cargo / Sector (opcional)"
                        className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-300 outline-none focus:border-indigo-400 transition-all" />
                      <button onClick={() => agregarAutorizado()} disabled={guardandoAuth || !nuevoNombre.trim()}
                        className="w-full py-3 rounded-xl bg-indigo-600 text-white font-black text-sm active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                        {guardandoAuth ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
                        Agregar autorizado
                      </button>

                      {/* CSV Import */}
                      <div className="border-t border-slate-200 pt-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Importar desde CSV</p>
                        <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSVFile} />

                        {csvRows === null ? (
                          <div className="flex gap-2">
                            <button onClick={() => csvInputRef.current?.click()}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold active:scale-95 transition-all hover:bg-slate-50">
                              <Upload size={13} /> Importar CSV
                            </button>
                            <button onClick={descargarPlantilla}
                              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 text-xs font-bold active:scale-95 transition-all hover:bg-slate-50">
                              <Download size={13} /> Plantilla
                            </button>
                          </div>
                        ) : csvRows.length === 0 ? (
                          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                            <p className="text-xs font-bold text-amber-700">CSV sin registros válidos</p>
                            <button onClick={() => setCsvRows(null)} className="text-amber-500"><X size={14} /></button>
                          </div>
                        ) : (
                          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-black text-indigo-700">{csvRows.length} registros listos</p>
                              <button onClick={() => setCsvRows(null)} className="text-indigo-400"><X size={14} /></button>
                            </div>
                            <div className="max-h-28 overflow-y-auto flex flex-col gap-1">
                              {csvRows.slice(0, 8).map((r, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px] text-indigo-800">
                                  <span className="font-bold truncate flex-1">{r.nombre}</span>
                                  {r.dni && <span className="text-indigo-500">DNI: {r.dni}</span>}
                                  {r.legajo && <span className="text-indigo-500">Leg: {r.legajo}</span>}
                                  {r.patente && <span className="text-indigo-500">{r.patente}</span>}
                                </div>
                              ))}
                              {csvRows.length > 8 && <p className="text-[10px] text-indigo-400 font-bold">…y {csvRows.length - 8} más</p>}
                            </div>
                            <button onClick={importarCSV} disabled={importando}
                              className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-black text-xs active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                              {importando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                              Confirmar importación
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </>
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
  const [consignas, setConsignas] = useState<ObjetivoConsigna[]>([]);
  const [lecturas, setLecturas] = useState<ConsignaLectura[]>([]);
  const listEndRef = useRef<HTMLDivElement>(null);
  const [horaActual, setHoraActual] = useState(() =>
    new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })
  );
  useEffect(() => {
    const id = setInterval(() => setHoraActual(
      new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })
    ), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'objetivo_consignas'),
      where('objectiveId', '==', objetivo.id),
      where('status', '==', 'ACTIVE'),
    );
    const unsub = onSnapshotFresh(q, snap => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as ObjetivoConsigna))
        .sort((a, b) => {
          const ta = toDate(a.createdAt)?.getTime() ?? 0;
          const tb = toDate(b.createdAt)?.getTime() ?? 0;
          return tb - ta;
        });
      setConsignas(rows);
    }, () => setConsignas([]));
    return unsub;
  }, [objetivo.id]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setLecturas([]);
      return;
    }
    const q = query(
      collection(db, 'objetivo_consigna_lecturas'),
      where('objectiveId', '==', objetivo.id),
      where('userUid', '==', uid),
    );
    const unsub = onSnapshotFresh(q, snap => {
      setLecturas(snap.docs.map(d => ({ id: d.id, ...d.data() } as ConsignaLectura)));
    }, () => setLecturas([]));
    return unsub;
  }, [objetivo.id]);

  const leidasSet = new Set(lecturas.map(l => l.consignaId));
  const consignasPendientes = consignas.filter(c => !leidasSet.has(c.id));

  const marcarConsignaLeida = async (consigna: ObjetivoConsigna) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const lecturaId = `${consigna.id}_${uid}`;
    await setDoc(doc(db, 'objetivo_consigna_lecturas', lecturaId), {
      consignaId: consigna.id,
      objectiveId: objetivo.id,
      objectiveName: objetivo.name,
      userUid: uid,
      userName: empNombre,
      readAt: serverTimestamp(),
    }, { merge: true });
  };

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
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-slate-800 font-black text-lg leading-tight">{objetivo.name}</h1>
            {objetivo.clientName && <p className="text-slate-500 text-xs mt-0.5">{objetivo.clientName}</p>}
            {objetivo.address && <p className="text-slate-400 text-[11px] mt-0.5 flex items-center gap-1"><MapPin size={10} />{objetivo.address}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-black text-slate-800 tabular-nums leading-none" aria-live="polite">{horaActual}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 capitalize">
              {new Date().toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {turno ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
              <CheckCircle2 size={11} /> Turno activo · {fmtTime(turno.startTime)}–{fmtTime(turno.endTime)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold" title="Estás viendo el libro como supervisor — no sos el guardia del turno">
              <ShieldCheck size={11} strokeWidth={2} /> Vista supervisión
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
        {consignas.length > 0 && (
          <section className="rounded-2xl border border-violet-200 bg-violet-50 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-violet-100 flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-700 flex items-center gap-1.5">
                  <Lock size={11} /> Consignas vigentes
                </p>
                <p className="text-[11px] text-violet-500 font-medium mt-0.5">
                  {consignasPendientes.length > 0
                    ? `${consignasPendientes.length} pendiente${consignasPendientes.length !== 1 ? 's' : ''} de lectura`
                    : 'Todas leídas por este usuario'}
                </p>
              </div>
              <span className="px-2 py-1 rounded-full bg-white text-violet-700 text-[10px] font-black border border-violet-100">
                {consignas.length}
              </span>
            </div>
            <div className="divide-y divide-violet-100">
              {consignas.map(consigna => {
                const leida = leidasSet.has(consigna.id);
                return (
                  <article key={consigna.id} className="px-4 py-3 bg-white/55">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 whitespace-pre-wrap">{consigna.texto}</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {consigna.creadoPorNombre ? `Emitida por ${consigna.creadoPorNombre}` : 'Consigna operativa'}
                          {consigna.createdAt ? ` · ${fmtEntryDate(consigna.createdAt)} ${fmtEntryTime(consigna.createdAt)}` : ''}
                        </p>
                      </div>
                      {leida ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black border border-emerald-200">
                          <CheckCircle2 size={11} /> Leída
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => marcarConsignaLeida(consigna)}
                          className="shrink-0 px-3 py-2 rounded-xl bg-violet-600 text-white text-[10px] font-black uppercase shadow-sm active:scale-95"
                        >
                          Leído
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

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
            aria-label="Registrar ingreso o egreso de persona autorizada"
            className="flex items-center gap-2 px-5 py-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-black text-sm shadow-lg shadow-slate-200/60 transition-all active:scale-95 hover:bg-slate-50">
            <UserCheck size={17} className="text-indigo-500" aria-hidden="true"/> Ingreso / Egreso
          </button>
          <button onClick={() => setShowNueva(true)}
            aria-label="Agregar nueva novedad al libro de guardia"
            className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm shadow-lg shadow-indigo-500/25 transition-all active:scale-95">
            <Plus size={18} aria-hidden="true"/> Nueva novedad
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
          empleadoNombre={empNombre} objectiveId={objetivo.id} turno={turno} objetivo={objetivo} entries={entries} isAdmin={isAdmin} />
      )}
    </div>
  );
}

// ─── Portal principal ──────────────────────────────────────────────────────────

export default function ObjetivoPortal() {
  const [fireUser,    setFireUser]    = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
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
    const unsub = onSnapshotFresh(q, snap => { const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as LibroEntry)); setEntries(docs); setTotalHoy(docs.length); });
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
      const obs: ObjetivoInfo[] = (data.objetivos || []).map((o: any) => ({
        id: o.id,
        name: o.name || o.nombre || '',
        address: o.address || o.direccion || '',
        clientName: data.name || data.nombre || '',
        clientId: d.id,
        empresaId: data.empresaId || undefined,
      })).filter((o: ObjetivoInfo) => o.id && o.name);
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
        if (found) { setObjetivo({ id: t.objectiveId!, name: found.name || t.objectiveName || 'Objetivo', address: found.address || found.direccion || '', clientName: data.name || data.nombre || t.clientName || '', clientId: clientDoc.id, empresaId: data.empresaId || undefined }); return; }
      }
    } catch { /* ignorar */ }
    setObjetivo({ id: t.objectiveId!, name: t.objectiveName || 'Objetivo', address: '', clientName: t.clientName || '', clientId: t.clientId || '', empresaId: undefined });
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

  const offlineBanner = !isOnline ? (
    <div role="alert" aria-live="assertive" className="sticky top-0 z-50 flex items-center gap-2 bg-amber-50 border-b-2 border-amber-400 px-4 py-2.5 text-amber-800 text-xs font-medium">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M12 12h.01M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" /></svg>
      Sin conexión — los cambios se guardarán cuando se restaure la red
    </div>
  ) : null;

  if (!fireUser) return <><Head><title>Libro de Guardia · COSP</title></Head>{offlineBanner}<LoginScreen onLogin={u => setFireUser(u)} /></>;
  if (isAdmin && !objetivo) return <><Head><title>Libro de Guardia · COSP</title></Head>{offlineBanner}<SelectorObjetivo clientes={clientes} onSelect={obj => setObjetivo(obj)} onLogout={handleLogout} nombre={empNombre} /></>;
  if (!isAdmin && !turno) return <><Head><title>Libro de Guardia · COSP</title></Head>{offlineBanner}<SinTurno nombre={empNombre} onLogout={handleLogout} /></>;
  if (!objetivo) return null;

  return <><Head><title>{objetivo.name} · Libro de Guardia</title></Head>{offlineBanner}<LibroGuardia objetivo={objetivo} turno={turno} entries={entries} totalHoy={totalHoy} empNombre={empNombre} isAdmin={isAdmin} onBack={isAdmin ? () => setObjetivo(null) : undefined} onLogout={handleLogout} /></>;
}
