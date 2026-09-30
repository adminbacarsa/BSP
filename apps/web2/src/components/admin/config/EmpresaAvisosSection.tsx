import { useEffect, useState } from 'react';
import { Bell, Plus, Save, Trash2, Loader2 } from 'lucide-react';
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { TIPOS_AVISO, ROL_DESTINO_MODULO } from '@/lib/eventuales/avisos.mjs';

type Persona = { tipo: 'PERSONA'; nombre: string; uid: string; mail: string; whatsapp: string; push: boolean };
type Rol = { tipo: 'ROL'; rolDestino: string; canales: { push: boolean; mail: boolean; whatsapp: boolean } };
type Destinatario = Persona | Rol;

const ETIQUETA: Record<string, string> = {
  ARCA_ALTA_PENDIENTE: 'ARCA — alta pendiente',
  ARCA_BAJA_PENDIENTE: 'ARCA — baja pendiente',
  ARCA_ERROR: 'ARCA — error de envío',
  MARCO_POR_VENCER: 'Contrato marco — vence en 30 días',
};

const ROL_LABEL: Record<string, string> = {
  OPERADOR: 'Operador (CC)',
  PLANIFICACION: 'Planificación',
  RRHH: 'RRHH',
  SUPERVISION: 'Supervisión',
};

const vacio = (): Record<string, Destinatario[]> =>
  Object.fromEntries(TIPOS_AVISO.map((t) => [t, []]));

export default function EmpresaAvisosSection({ empresaId }: { empresaId: string }) {
  const { user, isSuperAdmin } = useAuth();
  const [avisos, setAvisos] = useState<Record<string, Destinatario[]>>(vacio);
  const [altaHora, setAltaHora] = useState('18:00');
  const [bajaHora, setBajaHora] = useState('09:00');
  const [driveEventualesFolderId, setDriveEventualesFolderId] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    getDoc(doc(db, 'empresas', empresaId)).then((snap) => {
      if (!vivo) return;
        const data = snap.data() || {};
        const guardado = (data.avisos || {}) as Record<string, Destinatario[]>;
        setAvisos({ ...vacio(), ...guardado });
        setAltaHora(String(data.arcaTandas?.altaHora || '18:00'));
        setBajaHora(String(data.arcaTandas?.bajaHora || '09:00'));
        setDriveEventualesFolderId(String(data.driveEventualesFolderId || ''));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [empresaId]);

  const setLista = (tipo: string, lista: Destinatario[]) => setAvisos((prev) => ({ ...prev, [tipo]: lista }));

  const guardar = async () => {
    setGuardando(true);
    try {
      await updateDoc(doc(db, 'empresas', empresaId), { avisos, arcaTandas: { altaHora, bajaHora }, driveEventualesFolderId });
      await addDoc(collection(db, 'audit_logs'), {
        action: 'AVISOS_EMPRESA',
        module: 'CONFIG',
        empresaId,
        actorUid: user?.uid || '',
        actorName: user?.displayName || user?.email || '',
        details: `Avisos de ${empresaId}: ${TIPOS_AVISO.map((t) => `${t} ${avisos[t]?.length || 0}`).join(', ')}`,
        timestamp: serverTimestamp(),
      });
      toast.success('Avisos guardados');
    } catch {
      toast.error(isSuperAdmin ? 'No se pudieron guardar los avisos' : 'Solo el admin de la empresa puede editar los avisos');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-indigo-500" />
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Avisos</h3>
        </div>
        <button type="button" onClick={guardar} disabled={guardando}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-60">
          {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar avisos
        </button>
      </div>
      <div className="flex gap-3 text-xs">
        <label className="flex items-center gap-2">Lote de altas <input type="time" value={altaHora} onChange={(e) => setAltaHora(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1" /></label>
        <label className="flex items-center gap-2">Lote de bajas <input type="time" value={bajaHora} onChange={(e) => setBajaHora(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1" /></label>
        <label className="flex items-center gap-2">Carpeta Drive eventuales <input value={driveEventualesFolderId} onChange={(e) => setDriveEventualesFolderId(e.target.value)} placeholder="driveEventualesFolderId" className="rounded-lg border border-slate-200 px-2 py-1 w-56" /></label>
      </div>
      <p className="text-xs text-slate-500">
        Por tipo de aviso. Una persona o un rol. Si el rol todavía no tiene usuarios, el envío sigue y esa lista queda vacía.
        Quien no tenga la app recibe mail o WhatsApp.
      </p>
      {TIPOS_AVISO.map((tipo) => (
        <div key={tipo} className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-700">{ETIQUETA[tipo]}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setLista(tipo, [...avisos[tipo], { tipo: 'PERSONA', nombre: '', uid: '', mail: '', whatsapp: '', push: true }])}
                className="text-[11px] font-bold text-indigo-600 flex items-center gap-1"><Plus size={12} /> Persona</button>
              <button type="button" onClick={() => setLista(tipo, [...avisos[tipo], { tipo: 'ROL', rolDestino: 'RRHH', canales: { push: true, mail: true, whatsapp: false } }])}
                className="text-[11px] font-bold text-indigo-600 flex items-center gap-1"><Plus size={12} /> Rol</button>
            </div>
          </div>
          {(avisos[tipo] || []).map((dest, i) => (
            <div key={`${tipo}-${i}`} className="flex flex-wrap items-center gap-2 bg-white rounded-xl px-3 py-2 shadow-sm">
              {dest.tipo === 'ROL' ? (
                <>
                  <select value={dest.rolDestino} onChange={(e) => {
                    const lista = [...avisos[tipo]];
                    lista[i] = { ...dest, rolDestino: e.target.value };
                    setLista(tipo, lista);
                  }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
                    {Object.keys(ROL_DESTINO_MODULO).map((rol) => <option key={rol} value={rol}>{ROL_LABEL[rol]}</option>)}
                  </select>
                  <span className="text-[11px] text-slate-400">push y mail</span>
                </>
              ) : (
                <>
                  <input value={dest.nombre} placeholder="Nombre" onChange={(e) => {
                    const lista = [...avisos[tipo]] as Destinatario[];
                    lista[i] = { ...dest, nombre: e.target.value };
                    setLista(tipo, lista);
                  }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs w-28" />
                  <input value={dest.mail} placeholder="Mail" onChange={(e) => {
                    const lista = [...avisos[tipo]] as Destinatario[];
                    lista[i] = { ...dest, mail: e.target.value };
                    setLista(tipo, lista);
                  }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs w-40" />
                  <input value={dest.whatsapp} placeholder="WhatsApp" onChange={(e) => {
                    const lista = [...avisos[tipo]] as Destinatario[];
                    lista[i] = { ...dest, whatsapp: e.target.value };
                    setLista(tipo, lista);
                  }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs w-28" />
                </>
              )}
              <button type="button" onClick={() => setLista(tipo, avisos[tipo].filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
