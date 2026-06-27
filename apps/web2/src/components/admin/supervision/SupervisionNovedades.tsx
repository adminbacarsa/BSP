import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, RefreshCw, Bell, Camera, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { supervisionFieldService, LibroGuardiaEntry } from '@/services/supervisionFieldService';
import { fmtTs } from '@/lib/supervision/supervisionUtils';
import type { SupervisorObjective } from '@/hooks/useSupervisorScope';

const TIPOS = [
  { id: 'novedad', label: 'Novedad', etiqueta: 'HALLAZGO', gravedad: 'MEDIA' },
  { id: 'ronda', label: 'Ronda', etiqueta: 'RONDA', gravedad: 'BAJA' },
  { id: 'novedad_inc', label: 'Incidente', etiqueta: 'INCIDENTE', gravedad: 'ALTA' },
] as const;

function NovedadCard({ entry }: { entry: LibroGuardiaEntry }) {
  const isIncidente = entry.etiqueta === 'INCIDENTE' || entry.etiqueta === 'SINIESTRO' || entry.estadoIncidente;
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex flex-wrap gap-1.5">
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-teal-100 text-teal-700 border border-teal-200">
            {entry.etiqueta || entry.type}
          </span>
          {entry.gravedad && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
              {entry.gravedad}
            </span>
          )}
          {entry.estadoIncidente && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-100 text-rose-700 border border-rose-200">
              {entry.estadoIncidente}
            </span>
          )}
        </div>
        <span className="text-[9px] text-slate-400 font-mono shrink-0">{fmtTs(entry.createdAt)}</span>
      </div>
      <p className="font-black text-sm text-slate-800 dark:text-white">{entry.objetivoNombre || entry.objectiveId}</p>
      {entry.clientName && <p className="text-xs text-slate-500">{entry.clientName}</p>}
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{entry.text}</p>
      {entry.accionTomada && (
        <p className="mt-1 text-xs text-slate-500 italic">Acción: {entry.accionTomada}</p>
      )}
      {entry.imageUrl && (
        <img src={entry.imageUrl} alt="" className="mt-2 rounded-xl max-h-40 w-full object-cover border border-slate-200" />
      )}
      {(entry.supervisorNombre || entry.empleadoNombre) && (
        <p className="mt-2 text-[10px] text-slate-400">
          Por {entry.supervisorNombre || entry.empleadoNombre}
          {entry.origen === 'SUPERVISION' && ' · Supervisión'}
        </p>
      )}
      {isIncidente && entry.id && entry.estadoIncidente !== 'CERRADO' && (
        <div className="flex gap-2 mt-3">
          {entry.estadoIncidente !== 'EN_CURSO' && (
            <button
              type="button"
              onClick={() => supervisionFieldService.updateIncidenteEstado(entry.id!, 'EN_CURSO').then(() => toast.success('Incidente en curso'))}
              className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200"
            >
              En curso
            </button>
          )}
          <button
            type="button"
            onClick={() => supervisionFieldService.updateIncidenteEstado(entry.id!, 'CERRADO').then(() => toast.success('Incidente cerrado'))}
            className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

function NuevaNovedadSheet({
  objectives,
  userUid,
  userName,
  onClose,
  onSaved,
  defaultObjectiveId,
}: {
  objectives: SupervisorObjective[];
  userUid: string;
  userName: string;
  onClose: () => void;
  onSaved: () => void;
  defaultObjectiveId?: string;
}) {
  const [objectiveId, setObjectiveId] = useState(defaultObjectiveId || '');
  const [tipoIdx, setTipoIdx] = useState(0);
  const [texto, setTexto] = useState('');
  const [accion, setAccion] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const obj = objectives.find(o => o.id === objectiveId);
  const tipo = TIPOS[tipoIdx];

  const handleSave = async () => {
    if (!objectiveId || !texto.trim()) {
      toast.error('Completá objetivo y descripción');
      return;
    }
    setSaving(true);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const ts = Date.now();
        const r = ref(storage, `libro_guardia/${objectiveId}/${ts}_sup_img`);
        await uploadBytes(r, imageFile);
        imageUrl = await getDownloadURL(r);
      }
      const isIncidente = tipo.etiqueta === 'INCIDENTE';
      await supervisionFieldService.createLibroEntry({
        objectiveId,
        clientId: obj?.clientId,
        objetivoNombre: obj?.name,
        clientName: obj?.clientName,
        type: tipo.id === 'ronda' ? 'ronda' : 'novedad',
        etiqueta: tipo.etiqueta,
        gravedad: tipo.gravedad,
        text: texto.trim(),
        ...(accion.trim() && { accionTomada: accion.trim() }),
        ...(imageUrl && { imageUrl }),
        origen: 'SUPERVISION',
        supervisorUid: userUid,
        supervisorNombre: userName,
        empleadoNombre: userName,
        ...(isIncidente && { estadoIncidente: 'ABIERTO' as const }),
      });
      toast.success('Registro guardado');
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3"><div className="w-10 h-1 rounded-full bg-slate-200" /></div>
        <div className="px-5 py-3 flex items-center justify-between">
          <h3 className="font-black text-slate-900 dark:text-white">Parte de novedad</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700"><X size={16} /></button>
        </div>
        <div className="px-5 pb-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Objetivo</label>
            <select
              value={objectiveId}
              onChange={e => setObjectiveId(e.target.value)}
              className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold"
            >
              <option value="">— Seleccioná —</option>
              {objectives.map(o => (
                <option key={o.id} value={o.id}>{o.name} · {o.clientName}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTipoIdx(i)}
                className={`py-3 rounded-2xl text-[10px] font-black uppercase border transition-colors ${
                  tipoIdx === i ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-200 text-slate-500'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Descripción</label>
            <textarea
              value={texto}
              onChange={e => setTexto(e.target.value)}
              rows={4}
              placeholder="Qué pasó, dónde, hora aproximada…"
              className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm resize-none focus:outline-none focus:border-teal-400"
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Acción tomada (opcional)</label>
            <input
              value={accion}
              onChange={e => setAccion(e.target.value)}
              placeholder="Ej: aviso a cliente, policía…"
              className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm"
            />
          </div>
          <label className="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer active:bg-slate-50">
            <Camera size={18} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-500">{imageFile ? imageFile.name : 'Adjuntar foto'}</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => setImageFile(e.target.files?.[0] || null)} />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="w-full py-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-2xl font-black text-sm uppercase flex items-center justify-center gap-2 shadow-lg"
          >
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
            Guardar registro
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SupervisionNovedades({
  objectiveIds,
  objectives,
  userUid,
  userName,
}: {
  objectiveIds: string[];
  objectives: SupervisorObjective[];
  userUid: string;
  userName: string;
}) {
  const [entries, setEntries] = useState<LibroGuardiaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [filterObj, setFilterObj] = useState('');
  const [soloIncidentes, setSoloIncidentes] = useState(false);

  useEffect(() => {
    if (!objectiveIds.length) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = supervisionFieldService.subscribeLibroByObjectives(objectiveIds, items => {
      setEntries(items);
      setLoading(false);
    });
    return unsub;
  }, [objectiveIds]);

  const filtered = useMemo(() => {
    let list = entries;
    if (filterObj) list = list.filter(e => e.objectiveId === filterObj);
    if (soloIncidentes) {
      list = list.filter(e => e.etiqueta === 'INCIDENTE' || e.etiqueta === 'SINIESTRO' || e.estadoIncidente);
    }
    return list;
  }, [entries, filterObj, soloIncidentes]);

  return (
    <div className="space-y-4 pb-20">
      <div className="flex gap-2 flex-wrap">
        <select
          value={filterObj}
          onChange={e => setFilterObj(e.target.value)}
          className="flex-1 min-w-[140px] px-3 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-bold"
        >
          <option value="">Todos los objetivos</option>
          {objectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setSoloIncidentes(v => !v)}
          className={`px-3 py-2.5 rounded-2xl text-xs font-black uppercase border flex items-center gap-1 ${
            soloIncidentes ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-200 text-slate-500'
          }`}
        >
          <AlertTriangle size={12} /> Incidentes
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-slate-400" size={28} /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border p-10 text-center shadow-sm">
          <Bell size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 text-sm">Sin registros en el libro de guardia</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(e => <NovedadCard key={e.id} entry={e} />)}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowNew(true)}
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[65] w-14 h-14 rounded-full bg-teal-600 text-white shadow-lg flex items-center justify-center active:scale-95 lg:bottom-8"
        aria-label="Nueva novedad"
      >
        <Plus size={24} />
      </button>

      {showNew && (
        <NuevaNovedadSheet
          objectives={objectives}
          userUid={userUid}
          userName={userName}
          onClose={() => setShowNew(false)}
          onSaved={() => {}}
          defaultObjectiveId={filterObj || undefined}
        />
      )}
    </div>
  );
}
