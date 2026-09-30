import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  clasificarContratoEventual,
  todayKeyAr,
  type ContratoEventualPortal,
  type EventualLegajo,
} from '@cosp/portal-core';
import { getPortalFirebase } from '../lib/portal';
import { usePortalAuth } from '../context/PortalAuthContext';

/**
 * Contratos del eventual (`contratos_eventuales`) — una suscripción por legajo:
 * la regla permite leer solo los docs cuyo `employeeId` es un legajo atado al uid.
 */
export function useContratosEventuales(legajos: EventualLegajo[]) {
  const { db } = getPortalFirebase();
  const { deviceVerified } = usePortalAuth();
  const [byLegajo, setByLegajo] = useState<Record<string, ContratoEventualPortal[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const legajosKey = legajos.map((l) => l.employeeId).join('|');

  useEffect(() => {
    const ids = legajosKey.split('|').map((s) => s.trim()).filter(Boolean);
    if (deviceVerified !== true || ids.length === 0) {
      setByLegajo({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const pending = new Set(ids);
    const unsubs = ids.map((employeeId) =>
      onSnapshot(
        query(collection(db, 'contratos_eventuales'), where('employeeId', '==', employeeId)),
        (snap) => {
          setByLegajo((prev) => ({
            ...prev,
            [employeeId]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as ContratoEventualPortal),
          }));
          pending.delete(employeeId);
          if (pending.size === 0) setLoading(false);
        },
        (err) => {
          setError(err instanceof Error ? err.message : 'No se pudieron leer los contratos.');
          pending.delete(employeeId);
          if (pending.size === 0) setLoading(false);
        },
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [db, legajosKey, deviceVerified]);

  const contratos = useMemo(() => {
    const seen = new Set<string>();
    const all: ContratoEventualPortal[] = [];
    for (const list of Object.values(byLegajo)) {
      for (const c of list) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        all.push(c);
      }
    }
    return all.sort((a, b) => String(b.fechaAlta || '').localeCompare(String(a.fechaAlta || '')));
  }, [byLegajo]);

  const hoyKey = todayKeyAr();
  const vigentes = useMemo(
    () => contratos.filter((c) => clasificarContratoEventual(c, hoyKey) !== 'PASADO'),
    [contratos, hoyKey],
  );
  const pasados = useMemo(
    () => contratos.filter((c) => clasificarContratoEventual(c, hoyKey) === 'PASADO'),
    [contratos, hoyKey],
  );

  return { contratos, vigentes, pasados, loading, error, hoyKey };
}
