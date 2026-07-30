import { useEffect, useMemo, useState } from 'react';
import { collection, query } from 'firebase/firestore';
import { db, onSnapshotFresh } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { ensureFirebaseEmulatorsConnected } from '@/lib/firebase';
import {
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
    /** Objetivo inferido solo desde servicios_sla (sin fila en client.objetivos). */
    fromSlaOnly?: boolean;
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

function mapClientSnapshotDoc(
    id: string,
    data: Record<string, unknown>,
): PlanningCatalogClient {
    const rawGoals = data.objetivos ?? data.objectives;
    return {
        id,
        name: String(data.name || data.fantasyName || id),
        objetivos: Array.isArray(rawGoals) ? rawGoals : [],
    };
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
    const migracionCompleta = empresa?.migracionCompleta === true;

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

        const clientsQ = query(collection(db, 'clients'));
        const unsubClients = onSnapshotFresh(
            clientsQ,
            (snap) => {
                if (cancelled) return;
                const rows = filterRowsByEmpresa(
                    snap.docs.map((d) => mapClientSnapshotDoc(d.id, d.data() as Record<string, unknown>)),
                    tenantId,
                    scopeEmpresa,
                    migracionCompleta,
                ) as PlanningCatalogClient[];
                rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
                setClients(rows);
            },
            () => {
                if (cancelled) return;
                setClients([]);
            },
        );

        const slasQ = query(collection(db, 'servicios_sla'));
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
    }, [tenantId, scopeEmpresa, loadingEmpresa, migracionCompleta]);

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

    const catalogClients = useMemo((): PlanningCatalogClient[] => {
        const byId = new Map(clients.map((c) => [c.id, { ...c, objetivos: [...(c.objetivos || [])] }]));
        for (const sla of slas) {
            const cid = String(sla.clientId || '').trim();
            if (!cid) continue;
            if (!byId.has(cid)) {
                byId.set(cid, {
                    id: cid,
                    name: String(sla.clientName || cid),
                    objetivos: [],
                });
            }
            const objectiveId = String(sla.objectiveId || '').trim();
            const objectiveName = String(sla.objectiveName || objectiveId).trim();
            if (!objectiveId) continue;
            const row = byId.get(cid)!;
            const exists = row.objetivos.some((o) => {
                const oid = String(o.id || o.objectiveId || o.name || '').trim();
                return oid === objectiveId || oid === objectiveName;
            });
            if (!exists) {
                row.objetivos.push({
                    id: objectiveId,
                    name: objectiveName || objectiveId,
                    active: true,
                });
            }
        }
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }, [clients, slas]);

    const objectives = useMemo((): PlanningCatalogObjective[] => {
        const seen = new Set<string>();
        const flat: PlanningCatalogObjective[] = [];
        const push = (row: PlanningCatalogObjective) => {
            const key = `${row.clientId}::${row.objectiveId}`;
            if (seen.has(key)) return;
            seen.add(key);
            flat.push(row);
        };

        const clientObjKeys = new Set<string>();
        for (const client of catalogClients) {
            for (const o of client.objetivos || []) {
                if (!o || o.active === false) continue;
                const objectiveId = String(o.id || o.objectiveId || o.name || '').trim();
                if (!objectiveId) continue;
                clientObjKeys.add(`${client.id}::${objectiveId}`);
                push({
                    clientId: client.id,
                    clientName: client.name,
                    objectiveId,
                    objectiveName: String(o.name || objectiveId),
                    fromSlaOnly: false,
                });
            }
        }

        for (const sla of slas) {
            const clientId = String(sla.clientId || '').trim();
            const objectiveId = String(sla.objectiveId || '').trim();
            if (!clientId || !objectiveId) continue;
            const key = `${clientId}::${objectiveId}`;
            if (seen.has(key)) continue;
            const client = catalogClients.find((c) => c.id === clientId);
            push({
                clientId,
                clientName: client?.name || String(sla.clientName || clientId),
                objectiveId,
                objectiveName: String(sla.objectiveName || objectiveId),
                fromSlaOnly: !clientObjKeys.has(key),
            });
        }

        flat.sort(
            (a, b) =>
                a.clientName.localeCompare(b.clientName, 'es') ||
                a.objectiveName.localeCompare(b.objectiveName, 'es'),
        );
        return flat;
    }, [catalogClients, slas]);

    const slasByObjectiveKey = useMemo(() => {
        const map = new Map<string, ServiceSLA[]>();
        for (const obj of objectives) {
            const matching = filterSlasForPlanningContext(
                slas as SlaPlanningRow[],
                obj.clientId,
                obj.objectiveId,
                catalogClients,
            ) as ServiceSLA[];
            map.set(`${obj.clientId}::${obj.objectiveId}`, matching);
        }
        return map;
    }, [objectives, slas, catalogClients]);

    const getSlasForObjective = (clientId: string, objectiveId: string): ServiceSLA[] => {
        return slasByObjectiveKey.get(`${clientId}::${objectiveId}`) ?? [];
    };

    const objectivesWithSla = useMemo(
        () => objectives.filter((o) => getSlasForObjective(o.clientId, o.objectiveId).length > 0).length,
        [objectives, slasByObjectiveKey],
    );

    return {
        objectives,
        clients: catalogClients,
        slas,
        getSlasForObjective,
        objectivesWithSla,
        tenantClientCount: clients.length,
        loading: loading || loadingEmpresa,
    };
}
