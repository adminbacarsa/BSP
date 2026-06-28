import React, { useEffect, useMemo, useState } from 'react';
import { MapPin, ClipboardList, Navigation, Plus, X, RefreshCw, Trash2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import {
  supervisionFieldService,
  SupervisionVisita,
  ObjetivoConsigna,
  ConsignaLectura,
} from '@/services/supervisionFieldService';
import { fmtTs } from '@/lib/supervision/supervisionUtils';
import type { SupervisorObjective } from '@/hooks/useSupervisorScope';

type MasSection = 'VISITAS' | 'CONSIGNAS';

function VisitaSheet({
  empresaId,
  objectives,
  userUid,
  userName,
  onClose,
}: {
  empresaId: string;
  objectives: SupervisorObjective[];
  userUid: string;
  userName: string;
  onClose: () => void;
}) {
  const [objectiveId, setObjectiveId] = useState('');
  const [obs, setObs] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const captureGeo = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalización no disponible');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => toast.error('No se pudo obtener ubicación'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const save = async () => {
    const obj = objectives.find(o => o.id === objectiveId);
    if (!obj || !obs.trim()) {
      toast.error('Completá objetivo y observaciones');
      return;
    }
    setSaving(true);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const ts = Date.now();
        const r = ref(storage, `supervision_visitas/${objectiveId}/${ts}_img`);
        await uploadBytes(r, imageFile);
        imageUrl = await getDownloadURL(r);
      }
      await supervisionFieldService.createVisita({
        empresaId,
        objectiveId: obj.id,
        objectiveName: obj.name,
        clientId: obj.clientId,
        clientName: obj.clientName,
        supervisorUid: userUid,
        supervisorNombre: userName,
        observaciones: obs.trim(),
        ...(coords && { lat: coords.lat, lng: coords.lng }),
        ...(imageUrl && { imageUrl }),
      });
      toast.success('Visita registrada');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl max-h-[90dvh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-black text-slate-900 dark:text-white">Registrar visita</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl bg-slate-100"><X size={16} /></button>
        </div>
        <select value={objectiveId} onChange={e => setObjectiveId(e.target.value)} className="w-full px-3 py-3 rounded-2xl border text-sm font-bold bg-slate-50">
          <option value="">— Objetivo —</option>
          {objectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <textarea value={obs} onChange={e => setObs(e.target.value)} rows={4} placeholder="Observaciones de la ronda/visita…" className="w-full px-3 py-3 rounded-2xl border text-sm resize-none bg-slate-50" />
        <div className="flex gap-2">
          <button type="button" onClick={captureGeo} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase border flex items-center justify-center gap-1 ${coords ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
            <MapPin size={14} /> {coords ? 'GPS OK' : 'Tomar GPS'}
          </button>
          <label className="flex-1 py-3 rounded-2xl text-xs font-black uppercase border border-slate-200 text-slate-500 flex items-center justify-center gap-1 cursor-pointer">
            <Navigation size={14} /> Foto
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => setImageFile(e.target.files?.[0] || null)} />
          </label>
        </div>
        <button type="button" disabled={saving} onClick={save} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />} Guardar visita
        </button>
      </div>
    </div>
  );
}

function ConsignaSheet({
  empresaId,
  objectives,
  userUid,
  userName,
  onClose,
}: {
  empresaId: string;
  objectives: SupervisorObjective[];
  userUid: string;
  userName: string;
  onClose: () => void;
}) {
  const [objectiveId, setObjectiveId] = useState('');
  const [texto, setTexto] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const obj = objectives.find(o => o.id === objectiveId);
    if (!obj || !texto.trim()) {
      toast.error('Completá objetivo y texto de consigna');
      return;
    }
    setSaving(true);
    try {
      await supervisionFieldService.createConsigna({
        empresaId,
        objectiveId: obj.id,
        objectiveName: obj.name,
        clientId: obj.clientId,
        clientName: obj.clientName,
        texto: texto.trim(),
        creadoPorUid: userUid,
        creadoPorNombre: userName,
      });
      toast.success('Consigna publicada');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-black text-slate-900 dark:text-white">Nueva consigna</h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl bg-slate-100"><X size={16} /></button>
        </div>
        <p className="text-[10px] text-violet-700 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 font-bold">
          Orden permanente visible para guardias del objetivo
        </p>
        <select value={objectiveId} onChange={e => setObjectiveId(e.target.value)} className="w-full px-3 py-3 rounded-2xl border text-sm font-bold bg-slate-50">
          <option value="">— Objetivo —</option>
          {objectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={4} placeholder="Ej: Portón norte cerrado con llave 24hs…" className="w-full px-3 py-3 rounded-2xl border text-sm resize-none bg-slate-50" />
        <button type="button" disabled={saving} onClick={save} className="w-full py-4 bg-violet-600 text-white rounded-2xl font-black text-sm uppercase disabled:opacity-50">
          Publicar consigna
        </button>
      </div>
    </div>
  );
}

export default function SupervisionMas({
  empresaId,
  objectiveIds,
  objectives,
  userUid,
  userName,
  isSuperAdmin,
  canViewAllObjectives,
}: {
  empresaId: string;
  objectiveIds: string[];
  objectives: SupervisorObjective[];
  userUid: string;
  userName: string;
  isSuperAdmin: boolean;
  canViewAllObjectives: boolean;
}) {
  const [section, setSection] = useState<MasSection>('VISITAS');
  const [visitas, setVisitas] = useState<SupervisionVisita[]>([]);
  const [consignas, setConsignas] = useState<ObjetivoConsigna[]>([]);
  const [lecturas, setLecturas] = useState<ConsignaLectura[]>([]);
  const [showVisita, setShowVisita] = useState(false);
  const [showConsigna, setShowConsigna] = useState(false);
  const [expandedConsigna, setExpandedConsigna] = useState<string | null>(null);

  useEffect(() => {
    if (!empresaId) return;
    const ids = objectiveIds.length ? objectiveIds : (canViewAllObjectives ? null : []);
    const u1 = supervisionFieldService.subscribeVisitas(empresaId, ids, setVisitas);
    const u2 = supervisionFieldService.subscribeConsignas(empresaId, ids, setConsignas);
    const u3 = supervisionFieldService.subscribeConsignaLecturas(ids, setLecturas);
    return () => { u1(); u2(); u3(); };
  }, [empresaId, objectiveIds, canViewAllObjectives]);

  const lecturasPorConsigna = useMemo(() => {
    const map = new Map<string, ConsignaLectura[]>();
    lecturas.forEach(l => {
      const arr = map.get(l.consignaId) || [];
      arr.push(l);
      map.set(l.consignaId, arr);
    });
    return map;
  }, [lecturas]);

  const visitasDelMes = visitas.filter(v => {
    const d = v.createdAt?.toDate?.();
    if (!d) return false;
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const visitasMes = visitasDelMes.length;
  const objetivosVisitadosMes = new Set(visitasDelMes.map(v => v.objectiveId)).size;

  return (
    <div className="space-y-4 pb-20">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-indigo-600">Visitas este mes</p>
          <p className="text-2xl font-black text-indigo-800">{visitasMes}</p>
        </div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-violet-600">Objetivos visitados</p>
          <p className="text-2xl font-black text-violet-800">{objetivosVisitadosMes}/{objectives.length || '—'}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {(['VISITAS', 'CONSIGNAS'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase border transition-colors ${
              section === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'
            }`}
          >
            {s === 'VISITAS' ? 'Rondas / Visitas' : 'Consignas'}
          </button>
        ))}
      </div>

      {section === 'VISITAS' && (
        <>
          <button type="button" onClick={() => setShowVisita(true)} className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-sm">
            <Plus size={14} /> Nueva visita
          </button>
          <div className="space-y-2">
            {visitas.length === 0 ? (
              <p className="text-center text-slate-500 text-sm py-8">Sin visitas registradas</p>
            ) : visitas.map(v => (
              <div key={v.id} className="bg-white rounded-2xl border p-4 shadow-sm">
                <div className="flex justify-between gap-2 mb-1">
                  <p className="font-black text-sm text-slate-800">{v.objectiveName}</p>
                  <span className="text-[9px] text-slate-400 font-mono">{fmtTs(v.createdAt)}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">{v.clientName}</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{v.observaciones}</p>
                {v.lat != null && v.lng != null && (
                  <p className="text-[10px] text-indigo-600 mt-2 flex items-center gap-1"><MapPin size={10} /> GPS registrado</p>
                )}
                {v.imageUrl && <img src={v.imageUrl} alt="" className="mt-2 rounded-xl max-h-32 w-full object-cover" />}
              </div>
            ))}
          </div>
        </>
      )}

      {section === 'CONSIGNAS' && (
        <>
          <button type="button" onClick={() => setShowConsigna(true)} className="w-full py-3 bg-violet-600 text-white rounded-2xl font-black text-xs uppercase flex items-center justify-center gap-2 shadow-sm">
            <ClipboardList size={14} /> Nueva consigna
          </button>
          <div className="space-y-2">
            {consignas.length === 0 ? (
              <p className="text-center text-slate-500 text-sm py-8">Sin consignas activas</p>
            ) : consignas.map(c => {
              const lect = c.id ? (lecturasPorConsigna.get(c.id) || []) : [];
              const open = expandedConsigna === c.id;
              return (
              <div key={c.id} className="bg-white rounded-2xl border p-4 shadow-sm">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-sm text-slate-800">{c.objectiveName}</p>
                    <p className="text-xs text-slate-500">{c.clientName}</p>
                    <p className="mt-2 text-sm text-slate-700">{c.texto}</p>
                    <p className="text-[10px] text-slate-400 mt-2">{c.creadoPorNombre} · {fmtTs(c.createdAt)}</p>
                  </div>
                  {c.id && (
                    <button
                      type="button"
                      onClick={() => supervisionFieldService.deactivateConsigna(c.id!).then(() => toast.success('Consigna archivada'))}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl shrink-0"
                      title="Archivar"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={lect.length === 0}
                  onClick={() => setExpandedConsigna(open ? null : (c.id || null))}
                  className={`mt-3 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[11px] font-bold border transition-colors ${
                    lect.length > 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={13} />
                    {lect.length > 0 ? `Leída por ${lect.length} guardia${lect.length !== 1 ? 's' : ''}` : 'Sin lecturas registradas'}
                  </span>
                  {lect.length > 0 && (open ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                </button>
                {open && lect.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {lect
                      .slice()
                      .sort((a, b) => (b.readAt?.toMillis?.() ?? 0) - (a.readAt?.toMillis?.() ?? 0))
                      .map(l => (
                        <div key={l.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-bold text-slate-700 truncate">{l.userName}</span>
                          <span className="text-slate-400 font-mono shrink-0">{fmtTs(l.readAt)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </>
      )}

      {showVisita && (
        <VisitaSheet empresaId={empresaId} objectives={objectives} userUid={userUid} userName={userName} onClose={() => setShowVisita(false)} />
      )}
      {showConsigna && (
        <ConsignaSheet empresaId={empresaId} objectives={objectives} userUid={userUid} userName={userName} onClose={() => setShowConsigna(false)} />
      )}
    </div>
  );
}
