/**
 * Consultas de disponibilidad del objetivo, en vivo, para pintar el estado por día en el modal de
 * cobertura («Consultados: 3 · esperando respuesta», «ABALLAY aceptó 10:42 → suplente»).
 * Solo lectura; las escribe el servidor.
 */
import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ConsultaResumenIn } from '@/lib/planificacion/coberturaEventualesUx';

export type ConsultaObjetivo = ConsultaResumenIn & { id: string; positionName: string | null };

export function useConsultasDisponibilidadObjetivo(empresaId: string | null | undefined, objectiveId: string | null | undefined, activo: boolean): ConsultaObjetivo[] {
  const [consultas, setConsultas] = useState<ConsultaObjetivo[]>([]);
  useEffect(() => {
    if (!activo || !empresaId || !objectiveId) { setConsultas([]); return; }
    const q = query(
      collection(db, 'consultas_disponibilidad'),
      where('empresaId', '==', empresaId),
      where('objectiveId', '==', objectiveId),
    );
    return onSnapshot(q, (snap) => {
      setConsultas(snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          status: String(data.status || ''),
          venceAtMs: Number(data.venceAtMs || 0) || null,
          jornadas: Array.isArray(data.jornadas) ? (data.jornadas as { fecha: string }[]).map((j) => ({ fecha: String(j?.fecha || '') })) : [],
          respuestas: Array.isArray(data.respuestas)
            ? (data.respuestas as { nombre?: string; estado?: string; hora?: string | null }[]).map((r) => ({ nombre: String(r?.nombre || ''), estado: String(r?.estado || ''), hora: r?.hora || null }))
            : [],
          positionName: data.positionName ? String(data.positionName) : null,
        };
      }));
    }, () => setConsultas([]));
  }, [activo, empresaId, objectiveId]);
  return consultas;
}
