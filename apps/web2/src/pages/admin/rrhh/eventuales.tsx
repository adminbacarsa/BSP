import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowLeft, Users } from 'lucide-react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { GRUPO_EVENTUALES_ID } from '@/lib/eventuales/grupo.mjs';

type Ficha = { id: string; nombre: string; disponibilidad: string; legajoPlanilla: string; empresasHabilitadas: string[] };
type Contrato = { id: string; empresaId: string; estado: string; fechaAlta: string; fechaBaja: string };

const fmt = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export default function EventualesPage() {
  const [filtro, setFiltro] = useState<'DISPONIBLE' | 'TODOS'>('DISPONIBLE');
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [elegida, setElegida] = useState<Ficha | null>(null);
  const [contratos, setContratos] = useState<Contrato[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'eventuales_bolsa'), where('grupoId', '==', GRUPO_EVENTUALES_ID));
    return onSnapshot(q, (snap) => {
      setFichas(snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          nombre: String(data.nombre || ''),
          disponibilidad: String(data.disponibilidad || ''),
          legajoPlanilla: String(data.legajoPlanilla || ''),
          empresasHabilitadas: Array.isArray(data.empresasHabilitadas) ? data.empresasHabilitadas.map(String) : [],
        };
      }));
    });
  }, []);

  useEffect(() => {
    if (!elegida) return;
    const q = query(collection(db, 'contratos_eventuales'), where('bolsaCuil', '==', elegida.id));
    return onSnapshot(q, (snap) => {
      setContratos(snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          empresaId: String(data.empresaId || ''),
          estado: String(data.estado || ''),
          fechaAlta: String(data.fechaAlta || ''),
          fechaBaja: String(data.fechaBaja || ''),
        };
      }));
    });
  }, [elegida]);

  const visibles = filtro === 'DISPONIBLE' ? fichas.filter((f) => f.disponibilidad === 'DISPONIBLE') : fichas;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-indigo-500" />
          <h1 className="text-lg font-black text-slate-800">Eventuales</h1>
        </div>
        <Link href="/admin/rrhh" className="text-xs font-bold text-slate-500 flex items-center gap-1"><ArrowLeft size={13} /> RRHH</Link>
      </div>
      <div className="flex gap-2">
        {(['DISPONIBLE', 'TODOS'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold ${filtro === f ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}>
            {f === 'DISPONIBLE' ? 'Disponibles' : 'Todos'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50">
          {visibles.map((f) => (
            <button key={f.id} type="button" onClick={() => setElegida(f)}
              className="w-full text-left px-4 py-3 hover:bg-slate-50">
              <p className="text-sm font-bold text-slate-800">{f.nombre}</p>
              <p className="text-[11px] text-slate-400">{f.disponibilidad} · legajo {f.legajoPlanilla || '—'}</p>
            </button>
          ))}
          {!visibles.length && <p className="p-4 text-sm text-slate-400">No hay eventuales en este filtro.</p>}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
          {!elegida && <p className="text-sm text-slate-400">Elegí una ficha para ver sus contratos.</p>}
          {elegida && (
            <>
              <p className="font-black text-slate-800">{elegida.nombre}</p>
              <p className="text-[11px] text-slate-500 mb-3">Puede trabajar en: {elegida.empresasHabilitadas.join(', ') || 'ninguna empresa'}</p>
              <p className="text-[11px] text-slate-400 mb-3">Historial de contratos</p>
              <div className="space-y-2">
                {contratos.map((c) => (
                  <div key={c.id} className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                    <p className="font-bold text-slate-700">{c.empresaId} · {c.estado}</p>
                    <p className="text-slate-500">{fmt(c.fechaAlta)} → {fmt(c.fechaBaja)}</p>
                  </div>
                ))}
                {!contratos.length && <p className="text-sm text-slate-400">Sin contratos todavía.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
