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
  Shield, LogOut, Mic, MicOff, Camera, Image as ImageIcon,
  AlertTriangle, ArrowRightCircle, ArrowLeftCircle, Navigation,
  Users, Siren, Bell, Send, X, Clock, CheckCircle2, Loader2,
  ChevronLeft, Search, Building2, MapPin
} from 'lucide-react';


// ─── Tipos ────────────────────────────────────────────────────────────────────

type EntryType = 'novedad' | 'ingreso' | 'egreso' | 'ronda' | 'visita' | 'sos';

interface LibroEntry {
  id: string;
  type: EntryType;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  transcription?: string;
  empleadoNombre?: string;
  createdAt: any;
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

const fmtDate = (val: any) => {
  const d = toDate(val);
  if (!d) return '';
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
};

const fmtEntryTime = (val: any) => {
  const d = toDate(val);
  if (!d) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

// ─── Config de tipos de entrada ────────────────────────────────────────────────

const ENTRY_TYPES: { id: EntryType; label: string; icon: any; color: string; bg: string }[] = [
  { id: 'novedad',  label: 'Novedad',  icon: Bell,             color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  { id: 'ingreso',  label: 'Ingreso',  icon: ArrowRightCircle, color: '#22c55e', bg: 'rgba(34,197,94,0.15)'  },
  { id: 'egreso',   label: 'Egreso',   icon: ArrowLeftCircle,  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  { id: 'ronda',    label: 'Ronda',    icon: Navigation,        color: '#a78bfa', bg: 'rgba(167,139,250,0.15)'},
  { id: 'visita',   label: 'Visita',   icon: Users,             color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
  { id: 'sos',      label: 'SOS',      icon: Siren,             color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
];

const typeConfig = (t: EntryType) => ENTRY_TYPES.find(x => x.id === t) || ENTRY_TYPES[0];

// ─── Pantalla de login ─────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [err,   setErr]   = useState('');
  const [busy,  setBusy]  = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pass) { setErr('Completá email y contraseña.'); return; }
    setBusy(true); setErr('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      onLogin(cred.user);
    } catch {
      setErr('Credenciales incorrectas o sin acceso.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(160deg, #0a1628 0%, #1a3a6b 100%)' }}>
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #0f2040, #2d4a7a)' }}>
            <Shield size={40} className="text-amber-400" strokeWidth={1.5} />
          </div>
          <p className="text-white text-xl font-black tracking-wide">Portal de Objetivo</p>
          <p className="text-slate-400 text-xs mt-1 tracking-wider">Sistema COSP · Libro de Guardia</p>
        </div>
        <form onSubmit={handleLogin} className="flex flex-col gap-3">
          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-400 outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            autoCapitalize="none" autoCorrect="off"
          />
          <input
            type="password" placeholder="Contraseña" value={pass}
            onChange={e => setPass(e.target.value)}
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-400 outline-none"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          />
          {err && <p className="text-red-400 text-xs text-center">{err}</p>}
          <button type="submit" disabled={busy}
            className="w-full py-3 rounded-xl font-black text-sm text-white mt-1 flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: 'linear-gradient(90deg, #c8a84b, #a07830)' }}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Selector de objetivo (modo admin) — dos niveles ─────────────────────────

function SelectorObjetivo({
  clientes,
  onSelect,
  onLogout,
  nombre,
}: {
  clientes: ClienteConObjetivos[];
  onSelect: (obj: ObjetivoInfo) => void;
  onLogout: () => void;
  nombre: string;
}) {
  const [search,          setSearch]          = useState('');
  const [clienteActivo,   setClienteActivo]   = useState<ClienteConObjetivos | null>(null);

  // ── Nivel 1: lista de clientes ──────────────────────────────────────────────
  if (!clienteActivo) {
    const filtered = clientes.filter(c =>
      !search || c.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#080f1e' }}>
        <div className="flex-shrink-0 relative"
          style={{ background: 'linear-gradient(135deg, #0a1628 0%, #1a3a6b 100%)' }}>
          <div className="absolute inset-0 pointer-events-none opacity-20" style={{
            backgroundImage: 'repeating-linear-gradient(135deg, rgba(200,168,75,0.15) 0px, rgba(200,168,75,0.15) 1px, transparent 1px, transparent 14px)',
          }} />
          <div className="relative px-4 pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-amber-400" strokeWidth={1.5} />
                <span className="text-amber-400 text-[11px] font-black uppercase tracking-widest">Libro de Guardia</span>
              </div>
              <button onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                <LogOut size={12} /> Salir
              </button>
            </div>
            <p className="text-white font-black text-lg">Clientes</p>
            <p className="text-slate-400 text-xs mt-0.5">Modo administrador · {nombre}</p>
          </div>
        </div>

        <div className="px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <Search size={14} className="text-slate-500 flex-shrink-0" />
            <input
              type="text" placeholder="Buscar cliente..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
            />
            {search && <button onClick={() => setSearch('')}><X size={14} className="text-slate-500" /></button>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col gap-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Building2 size={28} className="text-slate-600 mb-2" strokeWidth={1.5} />
              <p className="text-slate-500 text-sm">Sin clientes encontrados</p>
            </div>
          ) : (
            filtered.map(cliente => (
              <button key={cliente.id} onClick={() => { setSearch(''); setClienteActivo(cliente); }}
                className="w-full text-left px-4 py-4 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.98]"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* Icono cliente */}
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #0f2040, #2d4a7a)' }}>
                  <Building2 size={20} className="text-amber-400" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-black truncate">{cliente.name}</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    {cliente.objetivos.length} objetivo{cliente.objetivos.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ChevronLeft size={16} className="text-slate-500 rotate-180 flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── Nivel 2: objetivos del cliente seleccionado ─────────────────────────────
  const objFiltered = clienteActivo.objetivos.filter(o =>
    !search || o.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#080f1e' }}>
      <div className="flex-shrink-0 relative"
        style={{ background: 'linear-gradient(135deg, #0a1628 0%, #1a3a6b 100%)' }}>
        <div className="absolute inset-0 pointer-events-none opacity-20" style={{
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(200,168,75,0.15) 0px, rgba(200,168,75,0.15) 1px, transparent 1px, transparent 14px)',
        }} />
        <div className="relative px-4 pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => { setClienteActivo(null); setSearch(''); }}
              className="flex items-center gap-1.5 text-amber-400 text-[11px] font-black">
              <ChevronLeft size={14} /> Clientes
            </button>
            <button onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <LogOut size={12} /> Salir
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #0f2040, #2d4a7a)' }}>
              <Building2 size={18} className="text-amber-400" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-white font-black text-base leading-tight">{clienteActivo.name}</p>
              <p className="text-slate-400 text-xs mt-0.5">
                {clienteActivo.objetivos.length} objetivo{clienteActivo.objetivos.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <Search size={14} className="text-slate-500 flex-shrink-0" />
          <input
            type="text" placeholder="Buscar objetivo..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
          />
          {search && <button onClick={() => setSearch('')}><X size={14} className="text-slate-500" /></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col gap-3">
        {objFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MapPin size={28} className="text-slate-600 mb-2" strokeWidth={1.5} />
            <p className="text-slate-500 text-sm">Sin objetivos encontrados</p>
          </div>
        ) : (
          objFiltered.map(obj => (
            <button key={obj.id} onClick={() => onSelect(obj)}
              className="w-full text-left px-4 py-4 rounded-2xl flex items-center gap-4 transition-all active:scale-[0.98]"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(200,168,75,0.12)', border: '1px solid rgba(200,168,75,0.2)' }}>
                <Shield size={20} className="text-amber-400" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-black truncate">{obj.name}</p>
                {obj.address && <p className="text-slate-500 text-[11px] truncate mt-0.5">{obj.address}</p>}
              </div>
              <ChevronLeft size={16} className="text-slate-500 rotate-180 flex-shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Sin turno activo (empleado sin turno hoy) ─────────────────────────────────

function SinTurno({ nombre, onLogout }: { nombre: string; onLogout: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: 'linear-gradient(160deg, #0a1628 0%, #1a3a6b 100%)' }}>
      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
        style={{ background: 'rgba(245,158,11,0.1)', border: '2px solid rgba(245,158,11,0.3)' }}>
        <AlertTriangle size={36} className="text-amber-400" />
      </div>
      <p className="text-white font-black text-lg">Hola, {nombre}</p>
      <p className="text-slate-400 text-sm mt-2 max-w-xs">
        No tenés ningún turno activo asignado para hoy en este sistema.
      </p>
      <p className="text-slate-500 text-xs mt-1">Si crees que es un error, contactá con operaciones.</p>
      <button onClick={onLogout}
        className="mt-8 px-6 py-2.5 rounded-xl text-sm font-bold text-slate-300 flex items-center gap-2"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
        <LogOut size={16} /> Cerrar sesión
      </button>
    </div>
  );
}

// ─── Panel nueva entrada ────────────────────────────────────────────────────────

function NuevaEntradaPanel({
  onSave, onClose, empleadoNombre, objectiveId, turno, objetivo,
}: {
  onSave: () => void;
  onClose: () => void;
  empleadoNombre: string;
  objectiveId: string;
  turno: TurnoActivo | null;
  objetivo: ObjetivoInfo;
}) {
  const [tipo,          setTipo]          = useState<EntryType>('novedad');
  const [texto,         setTexto]         = useState('');
  const [imageFile,     setImageFile]     = useState<File | null>(null);
  const [imagePreview,  setImagePreview]  = useState<string | null>(null);
  const [recording,     setRecording]     = useState(false);
  const [audioBlob,     setAudioBlob]     = useState<Blob | null>(null);
  const [audioUrl,      setAudioUrl]      = useState<string | null>(null);
  const [transcription, setTranscription] = useState('');
  const [saving,        setSaving]        = useState(false);
  const [audioSeconds,  setAudioSeconds]  = useState(0);

  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const speechRef    = useRef<any>(null);
  const timerRef     = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      setAudioSeconds(0);
      timerRef.current = setInterval(() => setAudioSeconds(s => s + 1), 1000);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const rec = new MediaRecorder(stream, { mimeType });
      mediaRecRef.current = rec;
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };
      rec.start();
      setRecording(true);

      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        const recog = new SR();
        recog.lang = 'es-AR';
        recog.continuous = true;
        recog.interimResults = false;
        recog.onresult = (ev: any) => {
          const t = Array.from(ev.results).map((r: any) => r[0].transcript).join(' ');
          setTranscription(t);
        };
        recog.start();
        speechRef.current = recog;
      }
    } catch {
      alert('No se pudo acceder al micrófono.');
    }
  };

  const stopRecording = () => {
    mediaRecRef.current?.stop();
    speechRef.current?.stop();
    setRecording(false);
  };

  const handleSave = async () => {
    const tieneContenido = texto.trim() || imageFile || audioBlob || transcription.trim();
    if (!tieneContenido) { alert('Agregá texto, foto o audio.'); return; }
    setSaving(true);
    try {
      const ts = Date.now();
      let imgUrl: string | undefined;
      let audUrl: string | undefined;

      if (imageFile) {
        try {
          const r = ref(storage, `libro_guardia/${objectiveId}/${ts}_img`);
          await uploadBytes(r, imageFile);
          imgUrl = await getDownloadURL(r);
        } catch { /* Storage puede no estar en emulador */ }
      }
      if (audioBlob) {
        try {
          const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
          const r = ref(storage, `libro_guardia/${objectiveId}/${ts}_audio.${ext}`);
          await uploadBytes(r, audioBlob);
          audUrl = await getDownloadURL(r);
        } catch { /* Storage puede no estar en emulador */ }
      }

      await addDoc(collection(db, 'libro_guardia'), {
        objectiveId,
        clientId:       turno?.clientId   || objetivo.clientId  || '',
        objetivoNombre: objetivo.name     || turno?.objectiveName || '',
        clientName:     objetivo.clientName || turno?.clientName || '',
        shiftId:        turno?.id         || '',
        employeeId:     auth.currentUser?.uid || '',
        empleadoNombre,
        type:           tipo,
        text:           texto.trim() || transcription.trim() || '',
        ...(imgUrl        && { imageUrl: imgUrl }),
        ...(audUrl        && { audioUrl: audUrl }),
        ...(transcription && { transcription }),
        createdAt: serverTimestamp(),
      });

      onSave();
      onClose();
    } catch (e: any) {
      alert('Error al guardar: ' + (e?.message || e));
    } finally { setSaving(false); }
  };

  const selectedType = typeConfig(tipo);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-t-3xl flex flex-col max-h-[90dvh]"
        style={{ background: '#0f1e3a', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex justify-center pt-3 pb-2 cursor-pointer" onClick={onClose}>
          <div className="w-10 h-1 rounded-full bg-slate-600" />
        </div>
        <div className="px-5 pb-2 flex items-center justify-between">
          <p className="text-white font-black text-base">Nueva entrada</p>
          <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-6 flex flex-col gap-4">
          {/* Selector de tipo */}
          <div className="grid grid-cols-3 gap-2">
            {ENTRY_TYPES.map(t => {
              const Icon = t.icon;
              const active = tipo === t.id;
              return (
                <button key={t.id} onClick={() => setTipo(t.id)}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-2xl transition-all text-xs font-bold"
                  style={{
                    background: active ? t.bg : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${active ? t.color : 'rgba(255,255,255,0.08)'}`,
                    color: active ? t.color : '#94a3b8',
                  }}>
                  <Icon size={20} strokeWidth={active ? 2 : 1.5} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Texto */}
          <textarea
            placeholder={tipo === 'sos' ? '¡Describí la emergencia!' : `Descripción de ${selectedType.label.toLowerCase()}...`}
            value={texto} onChange={e => setTexto(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 rounded-2xl text-sm text-white placeholder-slate-500 resize-none outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />

          {/* Foto */}
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
              className="hidden" onChange={handleImage} />
            <button onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-slate-300"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Camera size={18} /> Foto
            </button>
            <button onClick={() => {
              const inp = document.createElement('input');
              inp.type = 'file'; inp.accept = 'image/*';
              inp.onchange = (e: any) => handleImage(e);
              inp.click();
            }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold text-slate-300"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <ImageIcon size={18} /> Galería
            </button>
          </div>

          {imagePreview && (
            <div className="relative">
              <img src={imagePreview} alt="preview"
                className="w-full rounded-2xl object-cover max-h-48" />
              <button onClick={() => { setImageFile(null); setImagePreview(null); }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.6)' }}>
                <X size={14} className="text-white" />
              </button>
            </div>
          )}

          {/* Audio */}
          {!audioUrl ? (
            <button onClick={recording ? stopRecording : startRecording}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-sm"
              style={{
                background: recording ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                border: `1.5px solid ${recording ? '#ef4444' : 'rgba(255,255,255,0.1)'}`,
                color: recording ? '#ef4444' : '#94a3b8',
              }}>
              {recording
                ? <><MicOff size={20} className="animate-pulse" /> Detener ({audioSeconds}s)</>
                : <><Mic size={20} /> Grabar audio</>}
            </button>
          ) : (
            <div className="flex flex-col gap-2 p-3 rounded-2xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-bold">Audio ({audioSeconds}s)</span>
                <button onClick={() => { setAudioBlob(null); setAudioUrl(null); setTranscription(''); setAudioSeconds(0); }}>
                  <X size={16} className="text-slate-500" />
                </button>
              </div>
              <audio src={audioUrl} controls className="w-full h-8"
                style={{ filter: 'invert(1) hue-rotate(180deg)' }} />
              {transcription && (
                <div className="px-3 py-2 rounded-xl"
                  style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
                  <p className="text-[10px] text-purple-400 font-bold uppercase tracking-wider mb-0.5">Transcripción</p>
                  <p className="text-xs text-slate-300">{transcription}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-6 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-4 rounded-2xl font-black text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: tipo === 'sos' ? '#ef4444' : `linear-gradient(90deg, ${selectedType.color}cc, ${selectedType.color}88)` }}>
            {saving ? <Loader2 size={20} className="animate-spin" /> : <><Send size={18} /> Registrar {selectedType.label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de entrada ─────────────────────────────────────────────────────────

function EntradaCard({ entry }: { entry: LibroEntry }) {
  const cfg = typeConfig(entry.type);
  const Icon = cfg.icon;
  const [imgExpanded, setImgExpanded] = useState(false);

  return (
    <div className="flex gap-3" style={{ marginBottom: 4 }}>
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: cfg.bg, border: `1.5px solid ${cfg.color}55` }}>
          <Icon size={16} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1 w-px" style={{ background: 'rgba(255,255,255,0.06)', minHeight: 16 }} />
      </div>
      <div className="flex-1 pb-3 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
          <span className="text-[10px] text-slate-500">{fmtEntryTime(entry.createdAt)}</span>
        </div>
        {entry.text && <p className="text-sm text-slate-200 leading-relaxed">{entry.text}</p>}
        {entry.transcription && !entry.text && (
          <p className="text-sm text-slate-300 leading-relaxed italic">"{entry.transcription}"</p>
        )}
        {entry.imageUrl && (
          <div className="mt-2">
            <img src={entry.imageUrl} alt="" onClick={() => setImgExpanded(true)}
              className="rounded-xl object-cover cursor-pointer max-h-48 w-full"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
          </div>
        )}
        {entry.audioUrl && (
          <div className="mt-2">
            <audio src={entry.audioUrl} controls className="w-full h-8"
              style={{ filter: 'invert(1) hue-rotate(180deg)' }} />
            {entry.transcription && (
              <p className="mt-1 text-[11px] text-slate-400 italic">"{entry.transcription}"</p>
            )}
          </div>
        )}
        <p className="text-[10px] text-slate-600 mt-1">{entry.empleadoNombre}</p>
      </div>
      {imgExpanded && entry.imageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.9)' }} onClick={() => setImgExpanded(false)}>
          <img src={entry.imageUrl} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
        </div>
      )}
    </div>
  );
}

// ─── Vista del Libro de Guardia ────────────────────────────────────────────────

function LibroGuardia({
  objetivo, turno, entries, totalHoy, empNombre, isAdmin, onBack, onLogout,
}: {
  objetivo: ObjetivoInfo;
  turno: TurnoActivo | null;
  entries: LibroEntry[];
  totalHoy: number;
  empNombre: string;
  isAdmin: boolean;
  onBack?: () => void;
  onLogout: () => void;
}) {
  const [showNueva, setShowNueva] = useState(false);
  const listEndRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const fechaHoy = fmtDate(turno?.startTime) || now.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#080f1e' }}>
      {/* Header */}
      <div className="flex-shrink-0 relative"
        style={{ background: 'linear-gradient(135deg, #0a1628 0%, #1a3a6b 100%)' }}>
        <div className="absolute inset-0 pointer-events-none opacity-20" style={{
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(200,168,75,0.15) 0px, rgba(200,168,75,0.15) 1px, transparent 1px, transparent 14px)',
        }} />
        <div className="relative px-4 pt-4 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {isAdmin && onBack ? (
                <button onClick={onBack}
                  className="flex items-center gap-1 text-amber-400"
                  style={{ fontSize: 11 }}>
                  <ChevronLeft size={14} /> Objetivos
                </button>
              ) : (
                <>
                  <Shield size={18} className="text-amber-400" strokeWidth={1.5} />
                  <span className="text-amber-400 text-[11px] font-black uppercase tracking-widest">Libro de Guardia</span>
                </>
              )}
            </div>
            <button onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <LogOut size={12} /> Salir
            </button>
          </div>

          <p className="text-white font-black text-lg leading-tight">{objetivo.name}</p>
          {objetivo.clientName && <p className="text-slate-400 text-xs mt-0.5">{objetivo.clientName}</p>}
          {objetivo.address    && <p className="text-slate-500 text-[11px] mt-0.5">{objetivo.address}</p>}

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {turno ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
                <CheckCircle2 size={12} className="text-green-400" />
                <span className="text-green-400 text-[11px] font-bold">Turno activo</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(200,168,75,0.12)', border: '1px solid rgba(200,168,75,0.25)' }}>
                <Shield size={12} className="text-amber-400" strokeWidth={1.5} />
                <span className="text-amber-400 text-[11px] font-bold">Modo admin</span>
              </div>
            )}
            {turno && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Clock size={11} className="text-slate-400" />
                <span className="text-slate-300 text-[11px] font-bold">
                  {fmtTime(turno.startTime)} – {fmtTime(turno.endTime)}
                </span>
              </div>
            )}
            <div className="px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <span className="text-slate-300 text-[11px]">{fechaHoy}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-amber-400"
              style={{ background: 'rgba(200,168,75,0.15)', border: '1px solid rgba(200,168,75,0.3)' }}>
              {empNombre.charAt(0).toUpperCase()}
            </div>
            <span className="text-slate-300 text-xs font-bold">{empNombre}</span>
            {totalHoy > 0 && (
              <span className="ml-auto text-[10px] text-slate-500">{totalHoy} entr. hoy</span>
            )}
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <Bell size={28} className="text-slate-600" strokeWidth={1.5} />
            </div>
            <p className="text-slate-500 text-sm">Sin entradas hoy</p>
            <p className="text-slate-600 text-xs">Registrá la primera novedad</p>
          </div>
        ) : (
          entries.map(e => <EntradaCard key={e.id} entry={e} />)
        )}
        <div ref={listEndRef} />
      </div>

      {/* Botón nueva entrada */}
      <div className="fixed bottom-6 inset-x-0 flex justify-center z-40 pointer-events-none">
        <button onClick={() => setShowNueva(true)}
          className="pointer-events-auto flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-white text-sm shadow-2xl active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #c8a84b, #a07830)',
            boxShadow: '0 8px 32px rgba(200,168,75,0.4)',
          }}>
          <Shield size={18} strokeWidth={2} /> Nueva entrada
        </button>
      </div>

      {showNueva && (
        <NuevaEntradaPanel
          onClose={() => setShowNueva(false)}
          onSave={() => {
            setShowNueva(false);
            listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          empleadoNombre={empNombre}
          objectiveId={objetivo.id}
          turno={turno}
          objetivo={objetivo}
        />
      )}
    </div>
  );
}

// ─── Portal principal ──────────────────────────────────────────────────────────

export default function ObjetivoPortal() {
  const [fireUser,     setFireUser]     = useState<User | null>(null);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [empNombre,    setEmpNombre]    = useState('');
  const [isAdmin,      setIsAdmin]      = useState(false);
  const [turno,        setTurno]        = useState<TurnoActivo | null>(null);
  const [objetivo,     setObjetivo]     = useState<ObjetivoInfo | null>(null);
  const [clientes,     setClientes]     = useState<ClienteConObjetivos[]>([]);
  const [entries,      setEntries]      = useState<LibroEntry[]>([]);
  const [loadingInit,  setLoadingInit]  = useState(false);
  const [totalHoy,     setTotalHoy]     = useState(0);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setFireUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!fireUser) return;
    init(fireUser.uid);
  }, [fireUser]);

  // Entries en tiempo real para el objetivo seleccionado
  useEffect(() => {
    if (!objetivo) return;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'libro_guardia'),
      where('objectiveId', '==', objetivo.id),
      where('createdAt', '>=', Timestamp.fromDate(hoy)),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as LibroEntry));
      setEntries(docs);
      setTotalHoy(docs.length);
    });
    return () => unsub();
  }, [objetivo?.id]);

  const init = async (uid: string) => {
    setLoadingInit(true);
    try {
      // 1. Buscar en system_users → definitivamente admin
      let inSystemUsers = false;
      let adminName = '';
      try {
        const sysSnap = await getDoc(doc(db, 'system_users', uid));
        if (sysSnap.exists()) {
          inSystemUsers = true;
          const d = sysSnap.data();
          adminName = [d.firstName, d.lastName].filter(Boolean).join(' ') || d.displayName || d.email || '';
        }
      } catch { /* ignorar error de permisos */ }

      // 2. Buscar en empleados → definitivamente empleado (si lo está)
      let inEmpleados = false;
      let empName = '';
      const empQ = query(collection(db, 'empleados'), where('uid', '==', uid));
      const empSnap = await getDocs(empQ);
      if (!empSnap.empty) {
        inEmpleados = true;
        const d = empSnap.docs[0].data();
        empName = [d.firstName, d.lastName].filter(Boolean).join(' ');
      }

      // 3. Decisión: admin si está en system_users, o si NO está en empleados
      //    (cualquier usuario autenticado no-empleado → admin del portal)
      const admin = inSystemUsers || !inEmpleados;
      setIsAdmin(admin);

      if (admin) {
        setEmpNombre(adminName || auth.currentUser?.email || 'Admin');
        await loadAllObjetivos();
      } else {
        setEmpNombre(empName || fireUser?.email || 'Guardia');
        await loadTurnoActivo(uid);
      }
    } catch (e) {
      console.error('Error init:', e);
    } finally {
      setLoadingInit(false);
    }
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
      })).filter((o: ObjetivoInfo) => o.id && o.name);
      if (obs.length > 0) {
        lista.push({ id: d.id, name: data.name || data.nombre || d.id, objetivos: obs });
      }
    }
    lista.sort((a, b) => a.name.localeCompare(b.name));
    setClientes(lista);
  };

  const loadTurnoActivo = async (uid: string) => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
    const q = query(
      collection(db, 'turnos'),
      where('employeeId', '==', uid),
      where('startTime', '>=', Timestamp.fromDate(hoy)),
      where('startTime', '<',  Timestamp.fromDate(manana)),
    );
    const snap = await getDocs(q);
    const turnos = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as TurnoActivo))
      .filter(t => !t['isAbsent'] && !t['isFranco'] && !t['draft']);

    if (turnos.length === 0) return;
    const t = turnos[0];
    setTurno(t);
    if (t.objectiveId) await resolveObjetivo(t);
  };

  const resolveObjetivo = async (t: TurnoActivo) => {
    if (!t.objectiveId) return;
    try {
      const snap = await getDocs(collection(db, 'clients'));
      for (const clientDoc of snap.docs) {
        const data = clientDoc.data();
        const obs: any[] = data.objetivos || [];
        const found = obs.find((o: any) => o.id === t.objectiveId);
        if (found) {
          setObjetivo({
            id: t.objectiveId,
            name: found.name || t.objectiveName || 'Objetivo',
            address: found.address || found.direccion || '',
            clientName: data.name || data.nombre || t.clientName || '',
            clientId: clientDoc.id,
          });
          return;
        }
      }
    } catch { /* ignorar */ }
    setObjetivo({
      id: t.objectiveId!,
      name: t.objectiveName || 'Objetivo',
      address: '',
      clientName: t.clientName || '',
      clientId: t.clientId || '',
    });
  };

  const handleLogout = () => { signOut(auth); setObjetivo(null); setTurno(null); setIsAdmin(false); };

  // ── Render ──

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a1628' }}>
        <Loader2 size={32} className="text-amber-400 animate-spin" />
      </div>
    );
  }

  if (!fireUser) {
    return (
      <>
        <Head><title>Portal de Objetivo · COSP</title></Head>
        <LoginScreen onLogin={u => setFireUser(u)} />
      </>
    );
  }

  if (loadingInit) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: '#0a1628' }}>
        <Loader2 size={32} className="text-amber-400 animate-spin" />
        <p className="text-slate-400 text-sm">Cargando...</p>
      </div>
    );
  }

  // Admin sin objetivo seleccionado → selector
  if (isAdmin && !objetivo) {
    return (
      <>
        <Head><title>Libro de Guardia · COSP</title></Head>
        <SelectorObjetivo
          clientes={clientes}
          onSelect={obj => setObjetivo(obj)}
          onLogout={handleLogout}
          nombre={empNombre}
        />
      </>
    );
  }

  // Empleado sin turno activo
  if (!isAdmin && !turno) {
    return (
      <>
        <Head><title>Portal de Objetivo · COSP</title></Head>
        <SinTurno nombre={empNombre} onLogout={handleLogout} />
      </>
    );
  }

  // Libro de guardia (admin o empleado con turno)
  if (!objetivo) return null;

  return (
    <>
      <Head><title>{objetivo.name} · Libro de Guardia</title></Head>
      <LibroGuardia
        objetivo={objetivo}
        turno={turno}
        entries={entries}
        totalHoy={totalHoy}
        empNombre={empNombre}
        isAdmin={isAdmin}
        onBack={isAdmin ? () => setObjetivo(null) : undefined}
        onLogout={handleLogout}
      />
    </>
  );
}
