import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { useEmpresa } from '@/context/EmpresaContext';
import { ensureFirebaseEmulatorsConnected } from '@/lib/firebase';
import {
  empresaScopedQuery,
  filterRowsByEmpresa,
  shouldScopeQueriesToEmpresa,
} from '@/lib/multiempresa';

export interface VplanLabObjective {
  clientId: string;
  clientName: string;
  objectiveId: string;
  objectiveName: string;
}

export function useVplanLabObjectives(empresaId: string | undefined) {
  const { empresa, loadingEmpresa } = useEmpresa();
  const [objectives, setObjectives] = useState<VplanLabObjective[]>([]);
  const [loading, setLoading] = useState(true);

  const tenantId = String(empresaId ?? '').trim();
  const scopeEmpresa = shouldScopeQueriesToEmpresa(
    tenantId,
    empresa?.migracionCompleta === true,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (loadingEmpresa || !tenantId) {
      if (!loadingEmpresa && !tenantId) {
        setObjectives([]);
        setLoading(false);
      }
      return;
    }

    ensureFirebaseEmulatorsConnected();

    let cancelled = false;
    setLoading(true);

    const q = empresaScopedQuery('clients', tenantId, scopeEmpresa);
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const rows = filterRowsByEmpresa(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          tenantId,
          scopeEmpresa,
          empresa?.migracionCompleta === true,
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
        if (cancelled) return;
        setObjectives([]);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [tenantId, scopeEmpresa, loadingEmpresa, empresa?.migracionCompleta]);

  const byClient = useMemo(() => {
    const map = new Map<string, { clientName: string; items: VplanLabObjective[] }>();
    for (const o of objectives) {
      if (!map.has(o.clientId)) map.set(o.clientId, { clientName: o.clientName, items: [] });
      map.get(o.clientId)!.items.push(o);
    }
    return map;
  }, [objectives]);

  return { objectives, byClient, loading: loading || loadingEmpresa };
}
