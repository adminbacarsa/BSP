import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { empresaScopedQuery, filterRowsByEmpresa } from '@/lib/multiempresa';

export interface VplanLabObjective {
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
}

export function useVplanLabObjectives(empresaId: string | undefined) {
  const [objectives, setObjectives] = useState<VplanLabObjective[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaId) {
      setObjectives([]);
      setLoading(false);
      return;
    }

    const q = empresaScopedQuery(collection(db, 'clients'), empresaId);
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = filterRowsByEmpresa(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          empresaId,
        );
        const flat: VplanLabObjective[] = [];
        for (const client of rows) {
          const clientName = String(client.name || client.razonSocial || client.id);
          const objs = Array.isArray(client.objetivos) ? client.objetivos : [];
          for (const o of objs) {
            if (!o || o.active === false) continue;
            const objectiveId = String(o.id || o.name || '');
            if (!objectiveId) continue;
            flat.push({
              clientId: client.id,
              clientName,
              objectiveId,
              objectiveName: String(o.name || objectiveId),
            });
          }
        }
        flat.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.objectiveName.localeCompare(b.objectiveName));
        setObjectives(flat);
        setLoading(false);
      },
      () => {
        setObjectives([]);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [empresaId]);

  const byClient = useMemo(() => {
    const map = new Map<string, { clientName: string; items: VplanLabObjective[] }>();
    for (const o of objectives) {
      if (!map.has(o.clientId)) map.set(o.clientId, { clientName: o.clientName, items: [] });
      map.get(o.clientId)!.items.push(o);
    }
    return map;
  }, [objectives]);

  return { objectives, byClient, loading };
}
