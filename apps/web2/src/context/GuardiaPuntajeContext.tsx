import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import { collection, query, where } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import {
  GuardiaPuntajeReactContext,
  type GuardiaPuntajeCtx,
  type PuntajeDetalle,
  type PuntajeFila,
} from '@/context/guardiaPuntajeStore';

export type { PuntajeDetalle, PuntajeFila };
export { useGuardiaPuntaje, usePuntaje } from '@/context/guardiaPuntajeStore';

function rutaConPuntaje(pathname: string): boolean {
  return pathname.startsWith('/admin/operaciones')
    || pathname.startsWith('/admin/planificacion')
    || pathname.startsWith('/admin/movil/planificacion');
}

export function GuardiaPuntajeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const { empresaId } = useEmpresa();
  const [map, setMap] = useState<Map<string, PuntajeFila>>(new Map());
  const activo = rutaConPuntaje(pathname || '') && !!empresaId;

  useEffect(() => {
    if (!activo || !empresaId) {
      setMap(new Map());
      return undefined;
    }
    const q = query(collection(db, 'guardia_puntaje'), where('empresaId', '==', empresaId));
    return onSnapshotFresh(q, (snap) => {
      const next = new Map<string, PuntajeFila>();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (typeof data.total !== 'number') continue;
        const fila: PuntajeFila = {
          total: data.total,
          cumplimiento: Number(data.cumplimiento) || 0,
          disposicion: Number(data.disposicion) || 0,
          detalle: Array.isArray(data.detalle) ? data.detalle as PuntajeDetalle[] : [],
        };
        next.set(doc.id, fila);
        if (data.empleadoId) next.set(String(data.empleadoId), fila);
        if (data.bolsaCuil) next.set(String(data.bolsaCuil), fila);
      }
      setMap(next);
    }, () => setMap(new Map()));
  }, [activo, empresaId]);

  const value = useMemo<GuardiaPuntajeCtx>(() => ({
    totalDe: (id) => {
      const key = String(id || '').trim();
      return key ? map.get(key)?.total ?? null : null;
    },
    filaDe: (id) => {
      const key = String(id || '').trim();
      return key ? map.get(key) || null : null;
    },
  }), [map]);

  return <GuardiaPuntajeReactContext.Provider value={value}>{children}</GuardiaPuntajeReactContext.Provider>;
}
