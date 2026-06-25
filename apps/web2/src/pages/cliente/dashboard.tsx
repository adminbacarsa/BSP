import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { db, auth } from '@/lib/firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, deleteDoc, updateDoc, serverTimestamp, getDocs, getDoc, doc,
  Timestamp,
} from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, User, getIdTokenResult } from 'firebase/auth';
import {
  ShieldCheck, LogOut, Building2, ChevronRight, ChevronLeft,
  UserCheck, Car, Users, Trash2, Plus, Search, Upload, Download,
  AlertCircle, Lock, Mail, Phone, Eye, EyeOff, Loader2, X, CheckCircle2,
  ArrowRightCircle, ArrowLeftCircle, CalendarDays, Clock, Ban,
  UserPlus, Truck, AlertTriangle, ShieldPlus, UserPlus2, CheckCircle, XCircle,
} from 'lucide-react';
import { solicitudRefuerzoService, SolicitudRefuerzo, SolicitudEstado } from '@/services/solicitudRefuerzoService';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ClienteUser {
  uid: string;
  clientId: string;
  clientName: string;
  nombre: string;
  email: string;
  objectiveIds?: string[];
  empresaId?: string;
}

interface ObjetivoInfo {
  id: string;
  name: string;
  address?: string;
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
  activo: boolean;
}

interface AccesoEntry {
  id: string;
  type: 'ingreso' | 'egreso';
  personaNombre?: string;
  text?: string;
  createdAt: any;
  autorizado?: boolean;
  identificador?: string;
}

interface VisitaProgramada {
  id: string;
  objectiveId: string;
  clientId: string;
  tipo: 'persona' | 'vehiculo';
  nombre: string;
  dni?: string;
  patente?: string;
  fecha: string;       // YYYY-MM-DD
  horaIngreso: string; // HH:MM
  horaSalida?: string;
  motivo?: string;
  estado: 'programada' | 'cancelada';
  creadoEn: any;
  creadoPor: string;
}

interface CsvRow {
  nombre: string;
  dni?: string;
  legajo?: string;
  patente?: string;
  tipo: 'empleado' | 'vehiculo' | 'visitante';
  cargo?: string;
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

const fmtDate = (val: any) => {
  const d = toDate(val);
  return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '--/--';
};

const parseCsv = (text: string): CsvRow[] => {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  const idx = (names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iNombre = idx(['nombre', 'name']);
  const iDni = idx(['dni', 'documento']);
  const iLegajo = idx(['legajo', 'file_number']);
  const iPatente = idx(['patente', 'matricula', 'dominio']);
  const iTipo = idx(['tipo', 'type', 'categoria']);
  const iCargo = idx(['cargo', 'puesto', 'position']);

  const TIPOS_VALIDOS = ['empleado', 'vehiculo', 'visitante'];

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    const nombre = iNombre >= 0 ? cols[iNombre] || '' : '';
    if (!nombre) return null;

    const rawTipo = (iTipo >= 0 ? cols[iTipo] || '' : '').toLowerCase();
    const tipo: 'empleado' | 'vehiculo' | 'visitante' = TIPOS_VALIDOS.includes(rawTipo)
      ? rawTipo as any
      : 'empleado';

    return {
      nombre,
      dni: iDni >= 0 ? cols[iDni] || undefined : undefined,
      legajo: iLegajo >= 0 ? cols[iLegajo] || undefined : undefined,
      patente: iPatente >= 0 ? cols[iPatente] || undefined : undefined,
      tipo,
      cargo: iCargo >= 0 ? cols[iCargo] || undefined : undefined,
    } as CsvRow;
  }).filter(Boolean) as CsvRow[];
};

const generateCsvTemplate = () => {
  const content = 'nombre,dni,legajo,patente,tipo,cargo\nJuan Pérez,12345678,001,,empleado,Operario\nABC123,,,ABC123,vehiculo,Camioneta empresa\nMaría García,87654321,,,visitante,Proveedor';
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_personal_autorizado.csv';
  a.click();
  URL.revokeObjectURL(url);
};

// ─── LoginScreen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pass) { setErr('Completá email y contraseña.'); return; }
    setBusy(true); setErr('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      onLogin(cred.user);
    } catch (err: any) {
      if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(err.code)) {
        setErr('Correo o contraseña incorrectos.');
      } else {
        setErr('Error de conexión. Intentá nuevamente.');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
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
            Portal de<br />Clientes
          </h2>
          <p className="text-indigo-200 text-sm font-medium leading-relaxed max-w-xs">
            Gestioná el personal autorizado y consultá los accesos de tus objetivos de seguridad.
          </p>
        </div>
        <div className="relative z-10">
          <p className="text-indigo-300 text-[11px] font-medium">
            © {new Date().getFullYear()} Grupo Bacar · Todos los derechos reservados
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex lg:hidden flex-col items-center mb-10">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-3">
              <ShieldCheck size={26} className="text-white" />
            </div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">Portal de Clientes</h1>
            <p className="text-[11px] text-slate-500 font-medium">COSP V1.0 · Grupo Bacar</p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Bienvenido</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Ingresá con tu cuenta de cliente</p>
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
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                  placeholder="correo@empresa.com" required autoCapitalize="none" autoCorrect="off"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 text-slate-400" size={16} />
                <input
                  type={showPass ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
                  placeholder="••••••••" required
                />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit" disabled={busy}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-black py-3.5 rounded-xl shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              {busy ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── SinAccesoScreen ──────────────────────────────────────────────────────────

function SinAccesoScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={32} className="text-rose-500" />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2">Sin acceso al portal</h2>
        <p className="text-sm text-slate-500 font-medium mb-6">
          Tu cuenta no tiene permisos para acceder al portal de clientes. Contactá al administrador del sistema.
        </p>
        <button
          onClick={onSignOut}
          className="bg-slate-900 hover:bg-slate-700 text-white font-black px-6 py-3 rounded-xl transition-colors flex items-center gap-2 mx-auto"
        >
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

// ─── ObjetivosGrid ────────────────────────────────────────────────────────────

function ObjetivosGrid({
  clienteUser, objetivos, onSelect, onSignOut
}: {
  clienteUser: ClienteUser;
  objetivos: ObjetivoInfo[];
  onSelect: (o: ObjetivoInfo) => void;
  onSignOut: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="font-black text-slate-900 text-sm leading-tight">{clienteUser.clientName}</p>
            <p className="text-[11px] text-slate-400 font-medium">Portal de Clientes</p>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs font-bold transition-colors p-2"
        >
          <LogOut size={16} /> Salir
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-900">Mis objetivos</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Seleccioná un objetivo para gestionar su personal autorizado</p>
        </div>

        {objetivos.length === 0 ? (
          <div className="text-center py-16 px-4 max-w-sm mx-auto" role="status">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={32} className="text-slate-300" aria-hidden="true"/>
            </div>
            <h2 className="font-black text-slate-800 text-base mb-2">No hay objetivos configurados aún</h2>
            <p className="text-sm text-slate-500 font-medium mb-6 leading-relaxed">
              Tu acceso está activo, pero todavía no se asignaron objetivos de seguridad a tu cuenta.
            </p>
            <div className="space-y-2">
              <p className="text-xs text-slate-400 mb-3">Para solicitar la configuración, contactá a Grupo Bacar:</p>
              <a href="tel:+543515000000" className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl transition-colors">
                <Phone size={14} aria-hidden="true"/> Llamar a Grupo Bacar
              </a>
              <a href="mailto:operaciones@grupobacar.com.ar" className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-sm rounded-xl transition-colors">
                <Mail size={14} aria-hidden="true"/> Enviar email
              </a>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {objetivos.map(o => (
              <button
                key={o.id}
                onClick={() => onSelect(o)}
                className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 hover:shadow-sm transition-all text-left group"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                  <Building2 size={20} className="text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-800 text-sm uppercase truncate">{o.name}</p>
                  {o.address && <p className="text-[11px] font-bold text-slate-400 truncate mt-0.5">{o.address}</p>}
                </div>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-400 flex-shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AgendaTab ────────────────────────────────────────────────────────────────

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function AgendaTab({ objetivo, clienteUser }: { objetivo: ObjetivoInfo; clienteUser: ClienteUser }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<string>(toYMD(today));
  const [visitas, setVisitas] = useState<VisitaProgramada[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    tipo: 'persona' as 'persona' | 'vehiculo',
    nombre: '',
    dni: '',
    patente: '',
    horaIngreso: '',
    horaSalida: '',
    motivo: '',
  });

  // Cargar visitas del mes visible + mes siguiente (rango amplio)
  useEffect(() => {
    const desde = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-01`;
    const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    const hasta = `${nextYear}-${String(nextMonth+1).padStart(2,'0')}-01`;
    const q = query(
      collection(db, 'visitas_programadas'),
      where('objectiveId', '==', objetivo.id),
      where('fecha', '>=', desde),
      where('fecha', '<', hasta),
      orderBy('fecha')
    );
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as VisitaProgramada));
      docs.sort((a, b) => a.horaIngreso.localeCompare(b.horaIngreso));
      setVisitas(docs);
    });
  }, [objetivo.id, viewYear, viewMonth]);

  // Días del calendario
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const visitasByDay = visitas.reduce<Record<string, VisitaProgramada[]>>((acc, v) => {
    (acc[v.fecha] = acc[v.fecha] || []).push(v);
    return acc;
  }, {});

  const selectedVisitas = visitasByDay[selectedDay] || [];
  const todayYMD = toYMD(today);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleAdd = async () => {
    if (!form.nombre.trim() || !form.horaIngreso) return;
    if (form.tipo === 'vehiculo' && !form.patente.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'visitas_programadas'), {
        objectiveId: objetivo.id,
        clientId: clienteUser.clientId,
        tipo: form.tipo,
        nombre: form.nombre.trim(),
        dni: form.dni.trim() || null,
        patente: form.patente.trim().toUpperCase() || null,
        fecha: selectedDay,
        horaIngreso: form.horaIngreso,
        horaSalida: form.horaSalida || null,
        motivo: form.motivo.trim() || null,
        estado: 'programada',
        creadoEn: serverTimestamp(),
        creadoPor: clienteUser.uid,
      });
      setForm({ tipo: 'persona', nombre: '', dni: '', patente: '', horaIngreso: '', horaSalida: '', motivo: '' });
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('¿Cancelar esta visita?')) return;
    setCancelingId(id);
    try {
      await updateDoc(doc(db, 'visitas_programadas', id), { estado: 'cancelada' });
    } finally {
      setCancelingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta visita?')) return;
    setCancelingId(id);
    try {
      await deleteDoc(doc(db, 'visitas_programadas', id));
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Calendario */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {/* Header mes */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <button onClick={prevMonth} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronLeft size={16} className="text-slate-600" />
          </button>
          <p className="font-black text-slate-800 text-sm uppercase tracking-wide">
            {MESES[viewMonth]} {viewYear}
          </p>
          <button onClick={nextMonth} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <ChevronRight size={16} className="text-slate-600" />
          </button>
        </div>

        {/* Días de la semana */}
        <div className="grid grid-cols-7 border-b border-slate-100">
          {DIAS.map(d => (
            <div key={d} className="py-2 text-center text-[10px] font-black text-slate-400 uppercase">{d}</div>
          ))}
        </div>

        {/* Celdas */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (!day) return <div key={idx} className="h-10" />;
            const ymd = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const isToday = ymd === todayYMD;
            const isSelected = ymd === selectedDay;
            const dayVisitas = visitasByDay[ymd] || [];
            const programadas = dayVisitas.filter(v => v.estado === 'programada');
            return (
              <button
                key={idx}
                onClick={() => setSelectedDay(ymd)}
                className={`h-10 flex flex-col items-center justify-center relative transition-colors ${
                  isSelected ? 'bg-indigo-600' :
                  isToday ? 'bg-indigo-50' :
                  'hover:bg-slate-50'
                }`}
              >
                <span className={`text-xs font-bold ${isSelected ? 'text-white' : isToday ? 'text-indigo-600' : 'text-slate-700'}`}>
                  {day}
                </span>
                {programadas.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5">
                    {programadas.slice(0,3).map((_, i) => (
                      <div key={i} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white/70' : 'bg-indigo-400'}`} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel del día seleccionado */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-slate-500" />
            <p className="text-xs font-black text-slate-700 uppercase tracking-wide">
              {new Date(selectedDay + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            {selectedVisitas.filter(v => v.estado === 'programada').length > 0 && (
              <span className="bg-indigo-100 text-indigo-600 text-[10px] font-black px-2 py-0.5 rounded-full">
                {selectedVisitas.filter(v => v.estado === 'programada').length}
              </span>
            )}
          </div>
          {!formOpen && (
            <button
              onClick={() => setFormOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase transition-colors"
            >
              <Plus size={12} /> Agregar visita
            </button>
          )}
        </div>

        {/* Formulario nueva visita */}
        {formOpen && (
          <div className="border border-indigo-200 bg-indigo-50/40 rounded-2xl p-4 space-y-3">
            <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wider">Nueva visita — {selectedDay}</p>

            {/* Tipo */}
            <div className="grid grid-cols-2 gap-2">
              {(['persona', 'vehiculo'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => setForm(f => ({ ...f, tipo: t }))}
                  className={`py-2.5 rounded-xl text-[10px] font-black uppercase border flex items-center justify-center gap-1.5 transition-colors ${
                    form.tipo === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  {t === 'persona' ? <UserPlus size={13} /> : <Truck size={13} />}
                  {t === 'persona' ? 'Persona' : 'Vehículo'}
                </button>
              ))}
            </div>

            {/* Nombre */}
            <input
              value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder={form.tipo === 'vehiculo' ? 'Nombre del conductor / empresa *' : 'Nombre completo *'}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />

            <div className="grid grid-cols-2 gap-2">
              {form.tipo === 'persona' ? (
                <input
                  value={form.dni} onChange={e => setForm(f => ({ ...f, dni: e.target.value }))}
                  placeholder="DNI (opcional)"
                  className="p-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              ) : (
                <input
                  value={form.patente} onChange={e => setForm(f => ({ ...f, patente: e.target.value.toUpperCase() }))}
                  placeholder="Patente *"
                  className="p-2.5 border border-slate-200 rounded-xl text-sm font-mono font-bold bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 uppercase"
                />
              )}
              <input
                value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                placeholder="Motivo (opcional)"
                className="p-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Hora ingreso *</label>
                <input
                  type="time" value={form.horaIngreso} onChange={e => setForm(f => ({ ...f, horaIngreso: e.target.value }))}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Hora salida</label>
                <input
                  type="time" value={form.horaSalida} onChange={e => setForm(f => ({ ...f, horaSalida: e.target.value }))}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAdd} disabled={saving || !form.nombre.trim() || !form.horaIngreso || (form.tipo === 'vehiculo' && !form.patente.trim())}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-colors"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Guardar visita
              </button>
              <button onClick={() => setFormOpen(false)}
                className="bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-xl text-[10px] font-black uppercase text-slate-600 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Lista de visitas del día */}
        {selectedVisitas.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <CalendarDays size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs font-bold">Sin visitas programadas</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedVisitas.map(v => (
              <div key={v.id} className={`border rounded-2xl p-4 transition-colors ${
                v.estado === 'cancelada' ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-200 bg-white'
              }`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    v.tipo === 'vehiculo' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'
                  }`}>
                    {v.tipo === 'vehiculo' ? <Truck size={16} /> : <UserPlus size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-slate-800 text-sm">{v.nombre}</p>
                      {v.estado === 'cancelada' && (
                        <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">Cancelada</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {v.dni && <span className="text-[11px] text-slate-500 font-medium">DNI {v.dni}</span>}
                      {v.patente && (
                        <span className="text-[11px] font-black text-slate-700 bg-slate-100 px-2 py-0.5 rounded font-mono tracking-widest">
                          {v.patente}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1">
                        <Clock size={10} /> {v.horaIngreso}{v.horaSalida ? ` – ${v.horaSalida}` : ''}
                      </span>
                      {v.motivo && <span className="text-[11px] text-slate-500 font-medium">{v.motivo}</span>}
                    </div>
                  </div>
                  {v.estado === 'programada' && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        title="Cancelar visita"
                        onClick={() => handleCancel(v.id)} disabled={cancelingId === v.id}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        {cancelingId === v.id ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                      </button>
                      <button
                        title="Eliminar"
                        onClick={() => handleDelete(v.id)} disabled={cancelingId === v.id}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── GestionObjetivoScreen ────────────────────────────────────────────────────

function GestionObjetivoScreen({
  objetivo, clienteUser, onBack
}: {
  objetivo: ObjetivoInfo;
  clienteUser: ClienteUser;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'personal' | 'accesos' | 'agenda' | 'refuerzos'>('personal');
  const [accesosHoy, setAccesosHoy] = useState(0);

  useEffect(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'libro_guardia'),
      where('objectiveId', '==', objetivo.id),
      where('type', 'in', ['ingreso', 'egreso'])
    );
    return onSnapshot(q, snap => {
      setAccesosHoy(snap.docs.filter(d => {
        const t = d.data().createdAt;
        if (!t) return false;
        const dt = t.toDate ? t.toDate() : new Date(t.seconds * 1000);
        return dt >= hoy;
      }).length);
    });
  }, [objetivo.id]);

  const [personal, setPersonal] = useState<PersonalAutorizado[]>([]);
  const [accesos, setAccesos] = useState<AccesoEntry[]>([]);
  const [filtro, setFiltro] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({ nombre: '', dni: '', legajo: '', patente: '', tipo: 'empleado' as 'empleado' | 'vehiculo' | 'visitante', cargo: '' });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'personal_autorizado'),
      where('objectiveId', '==', objetivo.id),
      where('activo', '==', true)
    );
    return onSnapshot(q, snap => {
      setPersonal(snap.docs.map(d => ({ id: d.id, ...d.data() } as PersonalAutorizado)));
    });
  }, [objetivo.id]);

  useEffect(() => {
    if (activeTab !== 'accesos') return;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'libro_guardia'),
      where('objectiveId', '==', objetivo.id),
      where('type', 'in', ['ingreso', 'egreso']),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, snap => {
      const entries = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as AccesoEntry))
        .filter(e => {
          const d = toDate(e.createdAt);
          return d && d >= hoy;
        });
      setAccesos(entries);
    });
  }, [activeTab, objetivo.id]);

  const personalFiltrado = personal.filter(p => {
    const q = filtro.toLowerCase();
    return !q || p.nombre.toLowerCase().includes(q) || (p.dni || '').includes(q) || (p.legajo || '').toLowerCase().includes(q);
  });

  const handleAdd = async () => {
    if (!formData.nombre.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'personal_autorizado'), {
        objectiveId: objetivo.id,
        clientId: clienteUser.clientId,
        nombre: formData.nombre.trim(),
        dni: formData.dni.trim() || null,
        legajo: formData.legajo.trim() || null,
        patente: formData.patente.trim() || null,
        tipo: formData.tipo,
        cargo: formData.cargo.trim() || null,
        activo: true,
        creadoEn: serverTimestamp(),
        creadoPor: clienteUser.uid,
      });
      setFormData({ nombre: '', dni: '', legajo: '', patente: '', tipo: 'empleado', cargo: '' });
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este registro?')) return;
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'personal_autorizado', id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      setCsvRows(rows);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleCsvConfirm = async () => {
    if (!csvRows || csvRows.length === 0) return;
    setCsvImporting(true);
    try {
      for (const row of csvRows) {
        await addDoc(collection(db, 'personal_autorizado'), {
          objectiveId: objetivo.id,
          clientId: clienteUser.clientId,
          nombre: row.nombre,
          dni: row.dni || null,
          legajo: row.legajo || null,
          patente: row.patente || null,
          tipo: row.tipo,
          cargo: row.cargo || null,
          activo: true,
          creadoEn: serverTimestamp(),
          creadoPor: clienteUser.uid,
          origenImportacion: 'CSV',
        });
      }
      setCsvRows(null);
    } finally {
      setCsvImporting(false);
    }
  };

  const tipoIcon = (tipo: string) => {
    if (tipo === 'vehiculo') return <Car size={14} />;
    if (tipo === 'visitante') return <Users size={14} />;
    return <UserCheck size={14} />;
  };

  const tipoColor = (tipo: string) => {
    if (tipo === 'vehiculo') return 'bg-amber-50 text-amber-600';
    if (tipo === 'visitante') return 'bg-sky-50 text-sky-600';
    return 'bg-emerald-50 text-emerald-600';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 hover:bg-slate-100 rounded-xl transition-colors">
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-900 text-sm uppercase truncate">{objetivo.name}</p>
          <p className="text-[11px] text-slate-400 font-medium">{clienteUser.clientName}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* ── Resumen del Servicio ── */}
        <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-4 mb-4 shadow-sm shadow-indigo-200 text-white">
          <p className="text-[10px] font-black uppercase tracking-wider text-indigo-200 mb-3">Resumen del servicio</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
              <p className="text-2xl font-black leading-none">{personal.length}</p>
              <p className="text-[10px] font-black text-indigo-200 uppercase mt-1">Autorizados</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
              <p className="text-2xl font-black leading-none text-emerald-300">{accesosHoy}</p>
              <p className="text-[10px] font-black text-indigo-200 uppercase mt-1">Accesos hoy</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm cursor-pointer hover:bg-white/20 transition-colors" onClick={() => setActiveTab('agenda')}>
              <p className="text-2xl font-black leading-none text-violet-200">
                <CalendarDays size={22} className="inline" />
              </p>
              <p className="text-[10px] font-black text-indigo-200 uppercase mt-1">Agenda</p>
            </div>
          </div>
        </div>

        {/* Stats bar — mantiene compatibilidad visual */}
        <div className="grid grid-cols-3 gap-3 mb-6 hidden">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center">
            <p className="text-2xl font-black text-indigo-600">{personal.length}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-0.5">Autorizados</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center">
            <p className="text-2xl font-black text-emerald-600">{accesosHoy}</p>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-0.5">Accesos hoy</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center cursor-pointer hover:border-indigo-300 transition-colors" onClick={() => setActiveTab('agenda')}>
            <p className="text-2xl font-black text-violet-600">
              <CalendarDays size={22} className="inline" />
            </p>
            <p className="text-[10px] font-black text-slate-400 uppercase mt-0.5">Agenda</p>
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
          {([
            { key: 'personal', label: 'Personal' },
            { key: 'accesos', label: 'Accesos hoy' },
            { key: 'agenda', label: 'Agenda' },
            { key: 'refuerzos', label: 'Refuerzos' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab Personal ── */}
        {activeTab === 'personal' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  value={filtro} onChange={e => setFiltro(e.target.value)}
                  placeholder="Buscar por nombre, DNI o legajo..."
                  className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={generateCsvTemplate}
                  className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl text-[10px] font-black uppercase text-slate-600 transition-colors"
                >
                  <Download size={13} /> Plantilla
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-2 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 rounded-xl text-[10px] font-black uppercase text-indigo-600 transition-colors"
                >
                  <Upload size={13} /> Importar CSV
                </button>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
                <button
                  onClick={() => { setFormOpen(p => !p); setCsvRows(null); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase transition-colors"
                >
                  <Plus size={13} /> Agregar
                </button>
              </div>
            </div>

            {/* Preview CSV */}
            {csvRows !== null && (
              <div className="border border-indigo-200 bg-indigo-50 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-indigo-700 uppercase">
                    {csvRows.length === 0 ? 'El CSV no tiene registros válidos' : `${csvRows.length} registro${csvRows.length !== 1 ? 's' : ''} para importar`}
                  </p>
                  <button onClick={() => setCsvRows(null)} className="p-1 hover:bg-indigo-200 rounded-lg transition-colors">
                    <X size={14} className="text-indigo-500" />
                  </button>
                </div>
                {csvRows.length > 0 && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] font-medium text-slate-700">
                        <thead>
                          <tr className="text-[10px] font-black text-slate-400 uppercase">
                            <th className="text-left pb-2">Nombre</th>
                            <th className="text-left pb-2">DNI</th>
                            <th className="text-left pb-2">Legajo</th>
                            <th className="text-left pb-2">Patente</th>
                            <th className="text-left pb-2">Tipo</th>
                            <th className="text-left pb-2">Cargo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-indigo-100">
                          {csvRows.slice(0, 10).map((r, i) => (
                            <tr key={i}>
                              <td className="py-1.5 pr-2 font-bold">{r.nombre}</td>
                              <td className="py-1.5 pr-2">{r.dni || '-'}</td>
                              <td className="py-1.5 pr-2">{r.legajo || '-'}</td>
                              <td className="py-1.5 pr-2">{r.patente || '-'}</td>
                              <td className="py-1.5 pr-2 capitalize">{r.tipo}</td>
                              <td className="py-1.5">{r.cargo || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {csvRows.length > 10 && (
                        <p className="text-[10px] text-indigo-400 font-bold mt-1">...y {csvRows.length - 10} más</p>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleCsvConfirm} disabled={csvImporting}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-colors"
                      >
                        {csvImporting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        Confirmar importación
                      </button>
                      <button
                        onClick={() => setCsvRows(null)}
                        className="bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-xl text-[10px] font-black uppercase text-slate-600 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Formulario agregar */}
            {formOpen && (
              <div className="border border-slate-200 bg-white rounded-2xl p-4 space-y-3">
                <p className="text-xs font-black text-slate-700 uppercase">Nuevo registro</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['empleado', 'vehiculo', 'visitante'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setFormData(f => ({ ...f, tipo: t }))}
                      className={`py-2 rounded-xl text-[10px] font-black uppercase border transition-colors ${formData.tipo === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}
                    >
                      {t === 'vehiculo' ? 'Vehículo' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <input
                  value={formData.nombre} onChange={e => setFormData(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre completo *"
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={formData.dni} onChange={e => setFormData(f => ({ ...f, dni: e.target.value }))}
                    placeholder="DNI"
                    className="p-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <input
                    value={formData.legajo} onChange={e => setFormData(f => ({ ...f, legajo: e.target.value }))}
                    placeholder="Legajo"
                    className="p-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {formData.tipo === 'vehiculo' && (
                    <input
                      value={formData.patente} onChange={e => setFormData(f => ({ ...f, patente: e.target.value }))}
                      placeholder="Patente"
                      className="p-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  )}
                  <input
                    value={formData.cargo} onChange={e => setFormData(f => ({ ...f, cargo: e.target.value }))}
                    placeholder="Cargo / Rol"
                    className="p-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleAdd} disabled={saving || !formData.nombre.trim()}
                    className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-colors"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : null} Guardar
                  </button>
                  <button
                    onClick={() => setFormOpen(false)}
                    className="bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-xl text-[10px] font-black uppercase text-slate-600 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Lista personal */}
            {personalFiltrado.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <UserCheck size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-bold">{filtro ? 'Sin resultados' : 'No hay personal autorizado'}</p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white">
                {personalFiltrado.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tipoColor(p.tipo)}`}>
                      {tipoIcon(p.tipo)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-800 text-sm truncate">{p.nombre}</p>
                      <p className="text-[11px] font-bold text-slate-400 truncate">
                        {[p.dni && `DNI ${p.dni}`, p.legajo && `Leg. ${p.legajo}`, p.patente && `Pat. ${p.patente}`, p.cargo].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(p.id)} disabled={deletingId === p.id}
                      className="p-1.5 hover:bg-rose-50 text-slate-300 hover:text-rose-500 rounded-xl transition-colors flex-shrink-0"
                    >
                      {deletingId === p.id ? <Loader2 size={14} className="animate-spin text-slate-400" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab Accesos ── */}
        {activeTab === 'accesos' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-black text-slate-500 uppercase">Timeline de accesos · hoy</p>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 bg-emerald-50 text-emerald-600 text-[10px] font-black px-2 py-0.5 rounded-full">
                  <ArrowRightCircle size={10}/> {accesos.filter(a=>a.type==='ingreso').length} ingresos
                </span>
                <span className="flex items-center gap-1 bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-0.5 rounded-full">
                  <ArrowLeftCircle size={10}/> {accesos.filter(a=>a.type==='egreso').length} egresos
                </span>
              </div>
            </div>
            {accesos.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ArrowRightCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-bold">Sin accesos registrados hoy</p>
              </div>
            ) : (
              <div className="relative pl-6">
                {/* Timeline vertical line */}
                <div className="absolute left-2.5 top-0 bottom-0 w-px bg-slate-200"/>
                <div className="space-y-3">
                  {accesos.map((a, idx) => (
                    <div key={a.id} className="relative flex items-start gap-3">
                      {/* Timeline dot */}
                      <div className={`absolute -left-4 w-3 h-3 rounded-full border-2 border-white mt-2 flex-shrink-0 ${
                        a.autorizado === false ? 'bg-rose-500' : a.type === 'ingreso' ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}/>
                      <div className={`flex-1 flex items-center gap-3 bg-white border rounded-2xl px-4 py-3 shadow-sm ${
                        a.autorizado === false ? 'border-rose-100' : 'border-slate-200'
                      }`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          a.autorizado === false ? 'bg-rose-50 text-rose-500' :
                          a.type === 'ingreso' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                        }`}>
                          {a.autorizado === false ? <AlertTriangle size={16}/> :
                           a.type === 'ingreso' ? <ArrowRightCircle size={16} /> : <ArrowLeftCircle size={16} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-slate-800 text-sm truncate">
                            {a.personaNombre || a.text || a.identificador || 'Sin identificar'}
                          </p>
                          <p className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <Clock size={9}/>
                            {fmtTime(a.createdAt)}
                            <span className="w-1 h-1 rounded-full bg-slate-300 inline-block"/>
                            <span className="capitalize">{a.type || 'acceso'}</span>
                          </p>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-1 rounded-full flex-shrink-0 ${
                          a.autorizado === false ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                        }`}>
                          {a.autorizado === false ? '✕ No auth.' : '✓ Auth.'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab Agenda ── */}
        {activeTab === 'agenda' && (
          <AgendaTab objetivo={objetivo} clienteUser={clienteUser} />
        )}

        {/* ── Tab Refuerzos ── */}
        {activeTab === 'refuerzos' && (
          <RefuerzosTab objetivo={objetivo} clienteUser={clienteUser} />
        )}
      </div>
    </div>
  );
}

// ─── RefuerzosTab ─────────────────────────────────────────────────────────────

const MIN_HORAS_ANTICIPACION = 8;

function estadoRefuerzo(estado: SolicitudEstado) {
  const map: Record<SolicitudEstado, { label: string; cls: string }> = {
    PENDIENTE:  { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700' },
    APROBADA:   { label: 'Aprobada',   cls: 'bg-teal-100 text-teal-700' },
    RECHAZADA:  { label: 'Rechazada',  cls: 'bg-rose-100 text-rose-700' },
    ASIGNADA:   { label: 'Asignada',   cls: 'bg-indigo-100 text-indigo-700' },
    COMPLETADA: { label: 'Completada', cls: 'bg-slate-100 text-slate-600' },
    CANCELADA:  { label: 'Cancelada',  cls: 'bg-slate-100 text-slate-400' },
  };
  const m = map[estado] ?? { label: estado, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
}

interface SlaPosition { id: string; name: string; shifts: { code: string; name: string; startTime: string; endTime: string }[] }

function RefuerzosTab({ objetivo, clienteUser }: { objetivo: ObjetivoInfo; clienteUser: ClienteUser }) {
  const [tipo, setTipo] = useState<'REFUERZO_PUESTO' | 'AGREGADO_TURNO'>('REFUERZO_PUESTO');
  const [fecha, setFecha] = useState('');
  const [fechasExtra, setFechasExtra] = useState<string[]>([]);  // fechas adicionales para TURA pre-programado
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [motivo, setMotivo] = useState('');
  const [cantidadPax, setCantidadPax] = useState(1);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [solicitudes, setSolicitudes] = useState<SolicitudRefuerzo[]>([]);

  // Puestos del SLA activo
  const [slaPositions, setSlaPositions] = useState<SlaPosition[]>([]);
  const [selPosId, setSelPosId] = useState('');
  const [selShiftCode, setSelShiftCode] = useState('');

  // Guardias en turno (AGREGADO_TURNO)
  const [guardias, setGuardias] = useState<{ shiftId: string; nombre: string; empleadoId: string }[]>([]);
  const [guardiaSelId, setGuardiaSelId] = useState('');

  // Carga puestos del SLA activo del objetivo
  useEffect(() => {
    getDocs(query(
      collection(db, 'servicios_sla'),
      where('objectiveId', '==', objetivo.id),
      where('status', '==', 'active'),
    )).then(snap => {
      // Usar solo el SLA con más puestos (evita duplicados entre contratos históricos)
      let bestPositions: any[] = [];
      snap.docs.forEach(d => {
        const ps = d.data().positions || [];
        if (ps.length > bestPositions.length) bestPositions = ps;
      });
      const posMap = new Map<string, SlaPosition>();
      bestPositions.forEach((p: any) => {
        const key = p.id || p.name;
        if (!key || posMap.has(key)) return;
        const shifts = (p.allowedShiftTypes || []).map((s: any) => ({
          code: s.code, name: s.name || s.code,
          startTime: s.startTime || '', endTime: s.endTime || '',
        })).filter((s: any) => s.startTime);
        if (shifts.length) posMap.set(key, { id: p.id || p.name, name: p.name, shifts });
      });
      setSlaPositions(Array.from(posMap.values()));
    });
  }, [objetivo.id]);

  // Historial real-time
  useEffect(() => {
    return solicitudRefuerzoService.subscribeByClient(clienteUser.clientId, items =>
      setSolicitudes(items.filter(s => s.objectiveId === objetivo.id))
    );
  }, [objetivo.id, clienteUser.clientId]);

  // Guardias en turno (AGREGADO_TURNO) — busca en turnos planificados del objetivo
  useEffect(() => {
    setGuardiaSelId('');
    setGuardias([]);
    if (tipo !== 'AGREGADO_TURNO' || !fecha) return;

    getDocs(query(collection(db, 'turnos'), where('objectiveId', '==', objetivo.id)))
      .then(snap => {
        const seen = new Set<string>();
        const deduped = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter((t: any) => {
            let tFecha: string = typeof t.fecha === 'string' ? t.fecha : '';
            if (!tFecha && t.startTime?.seconds)
              tFecha = new Date(t.startTime.seconds * 1000).toISOString().slice(0, 10);
            return tFecha === fecha && !t.isAbsent && !t.isFranco
              && t.employeeId && t.employeeId !== 'VACANTE'
              && !seen.has(t.employeeId) && !!seen.add(t.employeeId);
          });

        if (deduped.length === 0) { setGuardias([]); return; }

        Promise.all(deduped.map(async (t: any) => {
          let nombre = t.employeeName || t.empleadoName || '';
          if (!nombre) {
            try {
              const empSnap = await getDoc(doc(db, 'empleados', t.employeeId));
              if (empSnap.exists()) {
                const e = empSnap.data();
                nombre = [e.apellido || e.lastName, e.nombre || e.firstName]
                  .filter(Boolean).join(', ')
                  || e.name || t.employeeId;
              }
            } catch { /* keep empty */ }
          }
          return { shiftId: t.id, nombre: nombre || t.employeeId, empleadoId: t.employeeId };
        })).then(lista => setGuardias(lista)).catch(console.error);
      })
      .catch(console.error);
  }, [tipo, fecha, objetivo.id]);

  // Auto-seleccionar turno del puesto → llenar horarios
  const selPosition = slaPositions.find(p => p.id === selPosId);
  const selShift    = selPosition?.shifts.find(s => s.code === selShiftCode);
  useEffect(() => {
    if (selShift) { setStartTime(selShift.startTime); setEndTime(selShift.endTime); }
  }, [selShift?.code, selPosId]);

  const shiftStartMs  = fecha && startTime ? new Date(`${fecha}T${startTime}`).getTime() : 0;
  // Corte: el cliente puede enviar hasta 8hs antes de las 00:00 del día del turno (= 16:00 del día anterior)
  const deadlineMs = fecha ? new Date(`${fecha}T00:00:00`).getTime() - MIN_HORAS_ANTICIPACION * 3600000 : 0;
  const horasRestantes = shiftStartMs ? (shiftStartMs - Date.now()) / 3600000 : 0;
  const anticipacionOk = fecha ? Date.now() <= deadlineMs : false;
  const guardiaSelected = guardias.find(g => g.shiftId === guardiaSelId);

  const canSubmit = fecha && startTime && endTime && motivo.trim() && anticipacionOk &&
    (tipo === 'REFUERZO_PUESTO'
      ? cantidadPax >= 1 && (slaPositions.length === 0 || !!selPosId)
      : !!guardiaSelId);

  const resetForm = () => {
    setFecha(''); setFechasExtra([]); setStartTime(''); setEndTime(''); setMotivo('');
    setCantidadPax(1); setGuardiaSelId(''); setSelPosId(''); setSelShiftCode('');
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const base = {
        empresaId:           clienteUser.empresaId || '',
        clientId:            clienteUser.clientId,
        clientName:          clienteUser.clientName,
        objectiveId:         objetivo.id,
        objectiveName:       objetivo.name,
        tipo, startTime, endTime, motivo,
        origen:              'PORTAL_CLIENTE' as const,
        estado:              'PENDIENTE' as const,
        solicitadoPorUid:    clienteUser.uid,
        solicitadoPorNombre: clienteUser.nombre,
        solicitadoAt:        Timestamp.now(),
      };
      const extras = tipo === 'REFUERZO_PUESTO'
        ? { cantidadPax, positionId: selPosId || undefined, positionName: selPosition?.name }
        : { parentShiftId: guardiaSelected?.shiftId, parentEmpleadoId: guardiaSelected?.empleadoId, parentEmpleadoName: guardiaSelected?.nombre };
      // Para TURA pre-programado: crear una solicitud por cada fecha seleccionada
      const fechasAEnviar = tipo === 'AGREGADO_TURNO' && fechasExtra.length > 0
        ? [fecha, ...fechasExtra]
        : [fecha];
      await Promise.all(fechasAEnviar.map(f => solicitudRefuerzoService.create({ ...base, fecha: f, ...extras })));
      resetForm();
    } catch (e: any) {
      alert(`Error: ${e?.message || 'No se pudo enviar'}`);
    } finally { setSaving(false); }
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="space-y-5">
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-black transition-colors shadow">
          <ShieldPlus size={16}/> Solicitar refuerzo / agregado
        </button>
      )}

      {showForm && (
        <div className="bg-white border-2 border-indigo-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-black text-sm text-indigo-900 flex items-center gap-2"><ShieldPlus size={15}/> Nueva solicitud</h3>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
          </div>

          {/* Tipo */}
          <div className="flex gap-2">
            {(['REFUERZO_PUESTO', 'AGREGADO_TURNO'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={`flex-1 py-2 rounded-xl text-xs font-black border transition-colors ${tipo === t ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                {t === 'REFUERZO_PUESTO' ? '+ Refuerzo de puesto' : '+ Agregado de turno'}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 -mt-1">
            {tipo === 'REFUERZO_PUESTO' ? 'Personal extra para el puesto en una fecha puntual.' : 'Ampliar el horario de un guardia ya asignado al objetivo.'}
          </p>

          {/* REFUERZO: puesto + turno del SLA */}
          {tipo === 'REFUERZO_PUESTO' && slaPositions.length > 0 && (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Puesto</label>
                <select value={selPosId} onChange={e => { setSelPosId(e.target.value); setSelShiftCode(''); setStartTime(''); setEndTime(''); }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400">
                  <option value="">— Elegí un puesto —</option>
                  {slaPositions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {selPosition && (
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Turno del puesto</label>
                  <div className="flex flex-wrap gap-2">
                    {selPosition.shifts.map(s => (
                      <button key={s.code} type="button"
                        onClick={() => setSelShiftCode(s.code)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-colors ${selShiftCode === s.code ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                        <span className="font-black">{s.code}</span>
                        <span className="ml-1 font-normal text-[10px] opacity-80">{s.startTime}–{s.endTime}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fecha */}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
              {tipo === 'AGREGADO_TURNO' ? 'Primera fecha' : 'Fecha'}
            </label>
            <input type="date" min={today} value={fecha} onChange={e => setFecha(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400"/>
          </div>

          {/* Fechas adicionales para TURA pre-programado */}
          {tipo === 'AGREGADO_TURNO' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-500 block">Fechas adicionales (opcional)</label>
              {fechasExtra.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {fechasExtra.map(f => (
                    <span key={f} className="flex items-center gap-1 text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg border border-indigo-200">
                      {f}
                      <button type="button" onClick={() => setFechasExtra(prev => prev.filter(x => x !== f))}
                        className="text-indigo-400 hover:text-rose-600 ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
              <input type="date" min={today}
                value=""
                onChange={e => {
                  const v = e.target.value;
                  if (v && v !== fecha && !fechasExtra.includes(v)) setFechasExtra(prev => [...prev, v]);
                  e.target.value = '';
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400"
                placeholder="Agregar otra fecha"/>
              <p className="text-[9px] text-slate-400">Se creará una solicitud por cada fecha seleccionada</p>
            </div>
          )}

          {/* Horarios — manual si no hay SLA o para AGREGADO */}
          {(tipo === 'AGREGADO_TURNO' || slaPositions.length === 0 || !selShiftCode) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Inicio</label>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400"/>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Fin</label>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400"/>
              </div>
            </div>
          )}
          {/* Horario auto-llenado (readonly) */}
          {tipo === 'REFUERZO_PUESTO' && selShift && (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-bold text-indigo-700">
              <Clock size={13}/> Horario: {selShift.startTime} — {selShift.endTime}
            </div>
          )}

          {/* Alerta anticipación */}
          {fecha && !anticipacionOk && (
            <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-bold">
              <AlertCircle size={14}/>
              Plazo vencido — las solicitudes deben enviarse antes de las 16:00 del día anterior al turno
            </div>
          )}

          {/* Cantidad pax (REFUERZO) */}
          {tipo === 'REFUERZO_PUESTO' && (
            <div>
              <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Cantidad de personas</label>
              <input type="number" min={1} max={20} value={cantidadPax} onChange={e => setCantidadPax(Number(e.target.value))}
                className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400"/>
            </div>
          )}

          {/* Guardia (AGREGADO) */}
          {tipo === 'AGREGADO_TURNO' && (
            <div>
              <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Guardia a ampliar</label>
              {!fecha
                ? <p className="text-xs text-slate-400">Seleccioná la fecha primero</p>
                : guardias.length === 0
                  ? <p className="text-xs text-slate-400">Sin guardias asignados en esa fecha</p>
                  : <select value={guardiaSelId} onChange={e => setGuardiaSelId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-400">
                      <option value="">— Seleccioná un guardia —</option>
                      {guardias.map(g => <option key={g.shiftId} value={g.shiftId}>{g.nombre}</option>)}
                    </select>
              }
            </div>
          )}

          {/* Motivo */}
          <div>
            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Motivo / descripción</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder="Describí el motivo del refuerzo o agregado…"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium resize-none focus:outline-none focus:border-indigo-400"/>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={resetForm} className="px-4 py-2 text-slate-500 text-xs font-bold hover:bg-slate-100 rounded-xl">Cancelar</button>
            <button type="button" disabled={!canSubmit || saving} onClick={handleSubmit}
              className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin"/> : <ShieldPlus size={14}/>}
              Enviar solicitud
            </button>
          </div>
        </div>
      )}

      {/* Historial */}
      <div>
        <h4 className="text-xs font-black uppercase text-slate-500 mb-3">Mis solicitudes</h4>
        {solicitudes.length === 0
          ? <p className="text-xs text-slate-400 text-center py-6">Sin solicitudes para este objetivo</p>
          : <div className="space-y-2">
              {solicitudes.map(s => (
                <div key={s.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-black text-slate-800">
                      {s.tipo === 'REFUERZO_PUESTO'
                        ? `${s.positionName || 'Puesto'} — +${s.cantidadPax ?? 1} persona${(s.cantidadPax ?? 1) !== 1 ? 's' : ''}`
                        : `Agregado · ${s.parentEmpleadoName || 'guardia'}`}
                    </span>
                    {estadoRefuerzo(s.estado)}
                  </div>
                  <p className="text-[11px] text-slate-500">{s.fecha} · {s.startTime}–{s.endTime}</p>
                  {s.motivo && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{s.motivo}</p>}
                  {s.motivoRechazo && <p className="text-[10px] text-rose-500 mt-0.5">Rechazo: {s.motivoRechazo}</p>}
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

// ─── AdminClientSelectorScreen ────────────────────────────────────────────────

function AdminClientSelectorScreen({
  user, onSelect, onSignOut
}: {
  user: User;
  onSelect: (cu: ClienteUser, obs: ObjetivoInfo[]) => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [adminEmpresaId, setAdminEmpresaId] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    const paramEmpId = String(router.query.empresaId ?? '').trim();
    if (paramEmpId) setAdminEmpresaId(paramEmpId);

    const q = paramEmpId
      ? query(collection(db, 'clients'), where('empresaId', '==', paramEmpId), orderBy('name'))
      : query(collection(db, 'clients'), orderBy('name'));

    getDocs(q)
      .then(snap => {
        const seen = new Set<string>();
        setClients(snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(c => seen.has(c.id) ? false : !!seen.add(c.id)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [router.isReady, router.query.empresaId, user.uid]);

  const filtered = clients.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (c: any) => {
    const seenObs = new Set<string>();
    const obs: ObjetivoInfo[] = (c.objetivos || [])
      .filter((o: any) => o.id && o.name && !seenObs.has(o.id) && seenObs.add(o.id))
      .map((o: any) => ({ id: o.id, name: o.name, address: o.address }));
    const cu: ClienteUser = {
      uid: user.uid,
      clientId: c.id,
      clientName: c.name,
      nombre: user.displayName || user.email || 'Administrador',
      email: user.email || '',
      empresaId: (c as any).empresaId || adminEmpresaId || '',
    };
    onSelect(cu, obs);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <p className="font-black text-slate-900 text-sm leading-tight">Portal de Clientes</p>
            <span className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
              <ShieldCheck size={10} aria-hidden="true"/> Modo admin
            </span>
          </div>
        </div>
        <button onClick={onSignOut} className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-xs font-bold transition-colors p-2">
          <LogOut size={16} /> Salir
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-900">Seleccioná un cliente</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Acceso de administrador — podés ver cualquier cliente</p>
        </div>

        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-3 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-indigo-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Building2 size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-bold text-sm">Sin resultados</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map(c => (
              <button key={c.id} onClick={() => handleSelect(c)}
                className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 hover:shadow-sm transition-all text-left group"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-100 transition-colors">
                  <Building2 size={20} className="text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-800 text-sm uppercase truncate">{c.name}</p>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                    {(c.objetivos || []).length} objetivo{(c.objetivos || []).length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-400 flex-shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ['admin', 'superadmin', 'Admin', 'SuperAdmin', 'ADMIN', 'SUPERADMIN',
  'Manager', 'MANAGER', 'Scheduler', 'SCHEDULER', 'Supervisor', 'SUPERVISOR',
  'Operator', 'OPERATOR', 'HR_Manager', 'HR_MANAGER'];

async function resolveAuthUser(user: User): Promise<'client' | 'admin' | 'none'> {
  // 1. ¿Es usuario de portal cliente?
  const cuSnap = await getDoc(doc(db, 'client_users', user.uid));
  if (cuSnap.exists()) return 'client';

  // 2. ¿Tiene claim de admin?
  const tokenResult = await getIdTokenResult(user);
  const role = (tokenResult.claims.role as string) || '';
  if (ADMIN_ROLES.includes(role)) return 'admin';

  // 3. ¿Existe en system_users?
  const sysSnap = await getDoc(doc(db, 'system_users', user.uid));
  if (sysSnap.exists()) return 'admin';

  return 'none';
}

export default function ClientePortal() {
  const [authState, setAuthState] = useState<'loading' | 'unauth' | 'checking' | 'sin_acceso' | 'ok' | 'admin_select'>('loading');
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [clienteUser, setClienteUser] = useState<ClienteUser | null>(null);
  const [objetivos, setObjetivos] = useState<ObjetivoInfo[]>([]);
  const [selectedObjetivo, setSelectedObjetivo] = useState<ObjetivoInfo | null>(null);

  const resolveClientUser = async (user: User) => {
    const snap = await getDoc(doc(db, 'client_users', user.uid));
    if (!snap.exists()) return false;
    const cu = { uid: user.uid, ...snap.data() } as ClienteUser;

    const clientSnap = await getDoc(doc(db, 'clients', cu.clientId));
    if (!clientSnap.exists()) return false;
    const clientData = clientSnap.data() as any;

    // Propagar empresaId desde el doc clients si no viene en client_users
    if (!cu.empresaId && clientData.empresaId) {
      cu.empresaId = clientData.empresaId;
    }

    // Deduplicar objetivos por id
    const seenObs = new Set<string>();
    let obs: ObjetivoInfo[] = (clientData.objetivos || [])
      .filter((o: any) => o.id && o.name && !seenObs.has(o.id) && seenObs.add(o.id))
      .map((o: any) => ({ id: o.id, name: o.name, address: o.address }));
    if (cu.objectiveIds && cu.objectiveIds.length > 0) {
      obs = obs.filter(o => cu.objectiveIds!.includes(o.id));
    }
    setClienteUser(cu);
    setObjetivos(obs);
    return true;
  };

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setAuthState('unauth'); return; }
      setAuthUser(user);
      setAuthState('checking');
      try {
        const kind = await resolveAuthUser(user);
        if (kind === 'client') {
          await resolveClientUser(user);
          setAuthState('ok');
        } else if (kind === 'admin') {
          setAuthState('admin_select');
        } else {
          setAuthState('sin_acceso');
        }
      } catch (e) {
        console.error(e);
        setAuthState('sin_acceso');
      }
    });
  }, []);

  const handleLogin = async (user: User) => {
    setAuthUser(user);
    setAuthState('checking');
    try {
      const kind = await resolveAuthUser(user);
      if (kind === 'client') {
        await resolveClientUser(user);
        setAuthState('ok');
      } else if (kind === 'admin') {
        setAuthState('admin_select');
      } else {
        setAuthState('sin_acceso');
      }
    } catch (e) {
      console.error(e);
      setAuthState('sin_acceso');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setAuthUser(null);
    setClienteUser(null);
    setObjetivos([]);
    setSelectedObjetivo(null);
    setAuthState('unauth');
  };

  const offlineBanner = !isOnline ? (
    <div role="alert" aria-live="assertive" className="sticky top-0 z-50 flex items-center gap-2 bg-amber-50 border-b-2 border-amber-400 px-4 py-2.5 text-amber-800 text-xs font-medium">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M12 12h.01M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" /></svg>
      Sin conexión — los cambios se guardarán cuando se restaure la red
    </div>
  ) : null;

  if (authState === 'loading' || authState === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (authState === 'unauth') {
    return (
      <>
        <Head><title>Portal de Clientes — COSP</title></Head>
        {offlineBanner}
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  if (authState === 'sin_acceso') {
    return (
      <>
        <Head><title>Sin acceso — COSP</title></Head>
        {offlineBanner}
        <SinAccesoScreen onSignOut={handleSignOut} />
      </>
    );
  }

  if (authState === 'admin_select' && authUser) {
    return (
      <>
        <Head><title>Portal de Clientes — Admin</title></Head>
        {offlineBanner}
        <AdminClientSelectorScreen
          user={authUser}
          onSelect={(cu, obs) => {
            setClienteUser(cu);
            setObjetivos(obs);
            setAuthState('ok');
          }}
          onSignOut={handleSignOut}
        />
      </>
    );
  }

  if (selectedObjetivo && clienteUser) {
    return (
      <>
        <Head><title>{selectedObjetivo.name} — Portal de Clientes</title></Head>
        {offlineBanner}
        <GestionObjetivoScreen
          objetivo={selectedObjetivo}
          clienteUser={clienteUser}
          onBack={() => setSelectedObjetivo(null)}
        />
      </>
    );
  }

  return (
    <>
      <Head><title>Portal de Clientes — COSP</title></Head>
      {offlineBanner}
      <ObjetivosGrid
        clienteUser={clienteUser!}
        objetivos={objetivos}
        onSelect={setSelectedObjetivo}
        onSignOut={handleSignOut}
      />
    </>
  );
}
