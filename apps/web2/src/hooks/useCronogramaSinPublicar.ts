import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import {
  CRONOGRAMA_SIN_PUBLICAR,
  agruparCronogramaPlanificacion,
  idsPendientesCronograma,
  resumenCronogramaOperacion,
  vistaPatch,
  type CronogramaGrupo,
  type CronogramaNovedad,
} from '@/lib/movil/cronogramaAlertas';

/**
 * Novedades CRONOGRAMA_SIN_PUBLICAR de la empresa (una por objetivo-mes). Consulta solo por
 * igualdad (`empresaId` + `type`): no necesita índice compuesto. El status se filtra en memoria,
 * así la misma novedad actualizada cada tarde sigue visible aunque tenga más de 48 h.
 */
export function useCronogramaSinPublicar(empresaId: string | null | undefined, enabled = true) {
  const [novedades, setNovedades] = useState<CronogramaNovedad[]>([]);

  useEffect(() => {
    if (!empresaId || !enabled) {
      setNovedades([]);
      return;
    }
    const q = query(
      collection(db, 'novedades'),
      where('empresaId', '==', empresaId),
      where('type', '==', CRONOGRAMA_SIN_PUBLICAR),
    );
    return onSnapshot(q, (snap) => {
      setNovedades(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CronogramaNovedad, 'id'>) })));
    }, () => setNovedades([]));
  }, [empresaId, enabled]);

  const resumenOperacion = useMemo(() => resumenCronogramaOperacion(novedades), [novedades]);
  const gruposPlanificacion = useMemo<CronogramaGrupo[]>(() => agruparCronogramaPlanificacion(novedades), [novedades]);
  const idsPendientes = useMemo(() => idsPendientesCronograma(novedades), [novedades]);

  const marcarVista = useCallback(async (ids: readonly string[] | 'todas', modulo: 'OPERACIONES' | 'PLANIFICACION' = 'PLANIFICACION') => {
    const target = ids === 'todas' ? idsPendientes : [...ids];
    if (target.length === 0) return 0;
    const auth = getAuth();
    const actor = {
      actorName: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador',
      uid: auth.currentUser?.uid || null,
    };
    for (let i = 0; i < target.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of target.slice(i, i + 400)) batch.update(doc(db, 'novedades', id), vistaPatch(actor, serverTimestamp()));
      await batch.commit();
    }
    addDoc(collection(db, 'audit_logs'), stampEmpresaId({
      action: target.length === 1 ? 'ATENDER_NOVEDAD' : 'DESCARTAR_NOVEDADES_TIPO',
      module: modulo,
      actorName: actor.actorName,
      timestamp: serverTimestamp(),
      details: target.length === 1
        ? `Marcó como vista la novedad ${CRONOGRAMA_SIN_PUBLICAR} (${target[0]}).`
        : `Marcó como vistas ${target.length} novedades tipo ${CRONOGRAMA_SIN_PUBLICAR}.`,
    }, String(empresaId || ''))).catch(() => {});
    return target.length;
  }, [empresaId, idsPendientes]);

  return { novedades, resumenOperacion, gruposPlanificacion, idsPendientes, marcarVista };
}
