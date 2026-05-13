import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { db, auth } from '@/lib/firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, deleteDoc, serverTimestamp, getDocs, getDoc, doc
} from 'firebase/firestore';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  ShieldCheck, LogOut, Building2, ChevronRight, ChevronLeft,
  UserCheck, Car, Users, Trash2, Plus, Search, Upload, Download,
  AlertCircle, Lock, Mail, Eye, EyeOff, Loader2, X, CheckCircle2,
  ArrowRightCircle, ArrowLeftCircle
} from 'lucide-react';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface ClienteUser {
  uid: string;
  clientId: string;
  clientName: string;
  nombre: string;
  email: string;
  objectiveIds?: string[];
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
          <div className="text-center py-16 text-slate-400">
            <Building2 size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-bold text-sm">No hay objetivos asignados</p>
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

// ─── GestionObjetivoScreen ────────────────────────────────────────────────────

function GestionObjetivoScreen({
  objetivo, clienteUser, onBack
}: {
  objetivo: ObjetivoInfo;
  clienteUser: ClienteUser;
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'personal' | 'accesos'>('personal');

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
        <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
          {(['personal', 'accesos'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase transition-all ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab === 'personal' ? 'Personal Autorizado' : 'Accesos Hoy'}
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
            <div className="flex items-center gap-2 mb-2">
              <p className="text-xs font-black text-slate-500 uppercase">Accesos de hoy</p>
              <span className="bg-slate-100 text-slate-500 text-[10px] font-black px-2 py-0.5 rounded-full">{accesos.length}</span>
            </div>
            {accesos.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <ArrowRightCircle size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-bold">Sin accesos registrados hoy</p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white">
                {accesos.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${a.type === 'ingreso' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                      {a.type === 'ingreso' ? <ArrowRightCircle size={16} /> : <ArrowLeftCircle size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-slate-800 text-sm truncate">
                        {a.personaNombre || a.text || a.identificador || 'Sin identificar'}
                      </p>
                      <p className="text-[11px] font-bold text-slate-400">
                        {fmtTime(a.createdAt)} · {fmtDate(a.createdAt)}
                      </p>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full flex-shrink-0 ${a.autorizado === false ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {a.autorizado === false ? 'No autorizado' : 'Autorizado'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ClientePortal() {
  const [authState, setAuthState] = useState<'loading' | 'unauth' | 'checking' | 'sin_acceso' | 'ok'>('loading');
  const [clienteUser, setClienteUser] = useState<ClienteUser | null>(null);
  const [objetivos, setObjetivos] = useState<ObjetivoInfo[]>([]);
  const [selectedObjetivo, setSelectedObjetivo] = useState<ObjetivoInfo | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { setAuthState('unauth'); return; }
      setAuthState('checking');
      try {
        const snap = await getDoc(doc(db, 'client_users', user.uid));
        if (!snap.exists()) { setAuthState('sin_acceso'); return; }
        const cu = { uid: user.uid, ...snap.data() } as ClienteUser;
        setClienteUser(cu);

        const clientSnap = await getDoc(doc(db, 'clients', cu.clientId));
        if (!clientSnap.exists()) { setAuthState('sin_acceso'); return; }
        const clientData = clientSnap.data() as any;
        let obs: ObjetivoInfo[] = (clientData.objetivos || [])
          .filter((o: any) => o.id && o.name)
          .map((o: any) => ({ id: o.id, name: o.name, address: o.address }));
        if (cu.objectiveIds && cu.objectiveIds.length > 0) {
          obs = obs.filter(o => cu.objectiveIds!.includes(o.id));
        }
        setObjetivos(obs);
        setAuthState('ok');
      } catch (e) {
        console.error(e);
        setAuthState('sin_acceso');
      }
    });
  }, []);

  const handleLogin = async (user: User) => {
    setAuthState('checking');
    try {
      const snap = await getDoc(doc(db, 'client_users', user.uid));
      if (!snap.exists()) { setAuthState('sin_acceso'); return; }
      const cu = { uid: user.uid, ...snap.data() } as ClienteUser;
      setClienteUser(cu);

      const clientSnap = await getDoc(doc(db, 'clients', cu.clientId));
      if (!clientSnap.exists()) { setAuthState('sin_acceso'); return; }
      const clientData = clientSnap.data() as any;
      let obs: ObjetivoInfo[] = (clientData.objetivos || [])
        .filter((o: any) => o.id && o.name)
        .map((o: any) => ({ id: o.id, name: o.name, address: o.address }));
      if (cu.objectiveIds && cu.objectiveIds.length > 0) {
        obs = obs.filter(o => cu.objectiveIds!.includes(o.id));
      }
      setObjetivos(obs);
      setAuthState('ok');
    } catch (e) {
      console.error(e);
      setAuthState('sin_acceso');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setClienteUser(null);
    setObjetivos([]);
    setSelectedObjetivo(null);
    setAuthState('unauth');
  };

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
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  if (authState === 'sin_acceso') {
    return (
      <>
        <Head><title>Sin acceso — COSP</title></Head>
        <SinAccesoScreen onSignOut={handleSignOut} />
      </>
    );
  }

  if (selectedObjetivo && clienteUser) {
    return (
      <>
        <Head><title>{selectedObjetivo.name} — Portal de Clientes</title></Head>
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
      <ObjetivosGrid
        clienteUser={clienteUser!}
        objetivos={objetivos}
        onSelect={setSelectedObjetivo}
        onSignOut={handleSignOut}
      />
    </>
  );
}
