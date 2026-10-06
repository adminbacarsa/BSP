/**
 * Estado en vivo de las consultas de un hueco: «2 consultados · 1 sí (Pérez 10:42) · 1 pendiente».
 * Al expandir, la línea de tiempo de la subcolección `eventos`.
 */
import React, { useEffect, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { huecoKeyDe } from '@/lib/eventuales/consultaDisponibilidad.mjs';

type Jornada = { fecha: string; horaInicio: string; horaFin: string; code?: string };

type ConsultaVista = {
  id: string;
  resumen: string;
  status: string;
  respuestas: { cuil: string; nombre: string; estado: string; hora: string | null; orden: number | null; motivo: string | null }[];
};

type EventoVista = { id: string; tipo: string; atMs: number; detalle: string };

const ESTADO: Record<string, string> = {
  ABIERTA: 'Abierta',
  COMPLETA: 'Cubierta',
  VENCIDA: 'Vencida',
  CERRADA: 'Cerrada',
};

export function ConsultaDisponibilidadEstado({ empresaId, objectiveId, positionName, jornadas }: {
  empresaId: string;
  objectiveId?: string | null;
  positionName?: string | null;
  jornadas: Jornada[];
}) {
  const huecoKey = huecoKeyDe({ empresaId, objectiveId, positionName, jornadas });
  const [consultas, setConsultas] = useState<ConsultaVista[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventoVista[]>([]);

  useEffect(() => {
    if (!empresaId || !jornadas.length) { setConsultas([]); return; }
    const q = query(collection(db, 'consultas_disponibilidad'), where('huecoKey', '==', huecoKey));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data() as Omit<ConsultaVista, 'id'>;
        return { id: d.id, resumen: data.resumen || '', status: data.status || '', respuestas: data.respuestas || [] };
      });
      list.sort((a, b) => (a.status === 'ABIERTA' ? -1 : 1) - (b.status === 'ABIERTA' ? -1 : 1));
      setConsultas(list.slice(0, 3));
    }, () => setConsultas([]));
  }, [empresaId, huecoKey, jornadas.length]);

  const expandir = async (id: string) => {
    if (abierta === id) { setAbierta(null); return; }
    setAbierta(id);
    const snap = await getDocs(collection(db, 'consultas_disponibilidad', id, 'eventos'));
    const list = snap.docs.map((d) => {
      const data = d.data() as { tipo?: string; atMs?: number; bolsaCuil?: string; respuesta?: string; hora?: string; motivo?: string; orden?: number };
      const detalle = [data.respuesta, data.hora, data.orden ? `lugar ${data.orden}` : '', data.motivo, data.bolsaCuil].filter(Boolean).join(' · ');
      return { id: d.id, tipo: String(data.tipo || ''), atMs: Number(data.atMs || 0), detalle };
    });
    list.sort((a, b) => a.atMs - b.atMs);
    setEventos(list);
  };

  if (!consultas.length) return null;
  return (
    <div className="mx-1 mt-2 space-y-1" data-consulta-estado={consultas.length}>
      {consultas.map((c) => (
        <div key={c.id} className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-2.5 py-1.5">
          <button type="button" onClick={() => { void expandir(c.id); }} className="flex w-full items-center justify-between gap-2 text-left" data-consulta-resumen={c.id}>
            <span className="text-[10px] font-bold text-indigo-950">{c.resumen}</span>
            <span className="shrink-0 text-[9px] font-black uppercase text-indigo-700">{ESTADO[c.status] || c.status}</span>
          </button>
          {abierta === c.id && (
            <ol className="mt-1 space-y-0.5 border-t border-indigo-100 pt-1" data-consulta-timeline={c.id}>
              {eventos.map((ev) => (
                <li key={ev.id} className="text-[9px] font-semibold text-slate-600">
                  <span className="font-black text-slate-800">{ev.tipo}</span>
                  {ev.detalle ? ` · ${ev.detalle}` : ''}
                </li>
              ))}
              {eventos.length === 0 && <li className="text-[9px] text-slate-400">Sin eventos todavía.</li>}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
