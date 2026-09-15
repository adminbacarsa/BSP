import { getDocs } from 'firebase/firestore';
import { toast } from 'sonner';
import { empresaCollectionQuery } from '@/lib/multiempresa';
import {
    filterSlasForPlanningContext,
    filterSlasForPlanningTenant,
    pickSlaForPlanningMonth,
} from '@/lib/slaPlanningMatch';

export type FetchPlanificacionSlaDebugParams = {
    selectedClient: string;
    selectedObjective: string;
    empresaId: string | undefined | null;
    scopeEmpresa: boolean;
    tenantClientIds: Set<string>;
    clients: any[];
    slaIdToObjId: Record<string, string>;
    currentDate: Date;
    setSlaDebugLoading: (value: boolean) => void;
    setSlaDebug: (value: { id: string; data: any } | null) => void;
};

export async function fetchPlanificacionSlaDebug({
    selectedClient,
    selectedObjective,
    empresaId,
    scopeEmpresa,
    tenantClientIds,
    clients,
    slaIdToObjId,
    currentDate,
    setSlaDebugLoading,
    setSlaDebug,
}: FetchPlanificacionSlaDebugParams): Promise<void> {
    if (!selectedClient || !selectedObjective) {
        toast.error('Seleccioná cliente y objetivo');
        return;
    }
    setSlaDebugLoading(true);
    try {
        const snap = await getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa));
        const allDocs = filterSlasForPlanningTenant(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
            empresaId,
            scopeEmpresa,
            tenantClientIds,
        );
        const matching = filterSlasForPlanningContext(
            allDocs,
            selectedClient,
            selectedObjective,
            clients,
            slaIdToObjId,
        );
        const y = currentDate.getFullYear(), m = currentDate.getMonth();
        const { vigente, fallback } = pickSlaForPlanningMonth(matching, y, m);
        const srv = vigente ?? fallback;
        if (!srv) {
            toast.error('No se encontró ningún servicios_sla para este objetivo');
            return;
        }
        const { id, ...rest } = srv;
        setSlaDebug({ id, data: rest });
    } catch (e) {
        toast.error('Error trayendo SLA');
        console.error('[slaDebug]', e);
    } finally {
        setSlaDebugLoading(false);
    }
}
