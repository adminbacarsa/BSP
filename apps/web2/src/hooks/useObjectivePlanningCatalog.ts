import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { ensureFirebaseEmulatorsConnected } from '@/lib/firebase';
import {
    empresaScopedQuery,
    filterRowsByEmpresa,
    filterSlaRowsByEmpresa,
    shouldScopeQueriesToEmpresa,
} from '@/lib/multiempresa';
import {
    filterSlasForPlanningContext,
    type SlaPlanningRow,
} from '@/lib/slaPlanningMatch';
import { toYyyyMmDd } from '@/lib/firestoreDates';
import type { ServiceSLA } from '@/services/slaService';

export interface PlanningCatalogObjective {
    clientId: string;
    clientName: string;
    objectiveId: string;
    objectiveName: string;
}

export interface PlanningCatalogClient {
    id: string;
    name: string;
    objetivos: Array<{ id?: string; name?: string; objectiveId?: string; active?: boolean }>;
}

function adaptSlaRow(id: string, data: Record<string, unknown>): ServiceSLA {
    return {
        id,
        ...data,
        startDate: toYyyyMmDd(data.startDate),
        endDate: toYyyyMmDd(data.endDate),
        positions: (data.positions as ServiceSLA['positions']) || [],
    } as ServiceSLA;
}

export function useObjectivePlanningCatalog(empresaId: string | undefined) {
    const { empresa, loadingEmpresa } = useEmpresa();
    const [clients, setClients] = useState<PlanningCatalogClient[]>([]);
    const [rawSlas, setRawSlas] = useState<ServiceSLA[]>([]);
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
                setClients([]);
                setRawSlas([]);
                setLoading(false);
            }
            return;
        }

        ensureFirebaseEmulatorsConnected();
        let cancelled = false;
        setLoading(true);

        const clientsQ = empresaScopedQuery('clients', tenantId, scopeEmpresa);
        const unsubClients = onSnapshotFresh(
            clientsQ,
            (snap) => {
                if (cancelled) return;
                const rows = filterRowsByEmpresa(
                    snap.docs.map((d) => {
                        const data = d.data();
                        return {
                            id: d.id,
                            name: String(data.name || data.fantasyName || d.id),
                            objetivos: Array.isArray(data.objetivos) ? data.objetivos : [],
                        };
                    }),
                    tenantId,
                    scopeEmpresa,
                    empresa?.migracionCompleta === true,
                ) as PlanningCatalogClient[];
                rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
                setClients(rows);
            },
            () => {
                if (cancelled) return;
                setClients([]);
            },
        );

        const slasQ = scopeEmpresa
            ? query(collection(db, 'servicios_sla'), where('empresaId', '==', tenantId))
            : query(collection(db, 'servicios_sla'));

        const unsubSlas = onSnapshotFresh(
            slasQ,
            (snap) => {
                if (cancelled) return;
                const rows = snap.docs.map((d) => adaptSlaRow(d.id, d.data() as Record<string, unknown>));
                setRawSlas(rows);
                setLoading(false);
            },
            () => {
                if (cancelled) return;
                setRawSlas([]);
                setLoading(false);
            },
        );

        return () => {
            cancelled = true;
            unsubClients();
            unsubSlas();
        };
    }, [tenantId, scopeEmpresa, loadingEmpresa, empresa?.migracionCompleta]);

    const slas = useMemo(() => {
        const clientIds = new Set(clients.map((c) => c.id));
        let rows = rawSlas;
        if (scopeEmpresa) {
            rows = filterSlaRowsByEmpresa(rows, tenantId, true, clientIds);
        }
        return [...rows].sort((a, b) =>
            (a.clientName || a.objectiveName || '').localeCompare(
                b.clientName || b.objectiveName || '',
                'es',
            ),
        );
    }, [rawSlas, clients, scopeEmpresa, tenantId]);

    const objectives = useMemo((): PlanningCatalogObjective[] => {
        const flat: PlanningCatalogObjective[] = [];
        for (const client of clients) {
            for (const o of client.objetivos || []) {
                if (!o || o.active === false) continue;
                const objectiveId = String(o.id || o.name || '').trim();
                if (!objectiveId) continue;
                flat.push({
                    clientId: client.id,
                    clientName: client.name,
                    objectiveId,
                    objectiveName: String(o.name || objectiveId),
                });
            }
        }
        flat.sort(
            (a, b) =>
                a.clientName.localeCompare(b.clientName, 'es') ||
                a.objectiveName.localeCompare(b.objectiveName, 'es'),
        );
        return flat;
    }, [clients]);

    const slasByObjectiveKey = useMemo(() => {
        const map = new Map<string, ServiceSLA[]>();
        for (const obj of objectives) {
            const matching = filterSlasForPlanningContext(
                slas as SlaPlanningRow[],
                obj.clientId,
                obj.objectiveId,
                clients,
            ) as ServiceSLA[];
            map.set(`${obj.clientId}::${obj.objectiveId}`, matching);
        }
        return map;
    }, [objectives, slas, clients]);

    const getSlasForObjective = (clientId: string, objectiveId: string): ServiceSLA[] => {
        return slasByObjectiveKey.get(`${clientId}::${objectiveId}`) ?? [];
    };

    const objectivesWithSla = useMemo(
        () => objectives.filter((o) => getSlasForObjective(o.clientId, o.objectiveId).length > 0).length,
        [objectives, slasByObjectiveKey],
    );

    return {
        objectives,
        clients,
        slas,
        getSlasForObjective,
        objectivesWithSla,
        loading: loading || loadingEmpresa,
    };
}
