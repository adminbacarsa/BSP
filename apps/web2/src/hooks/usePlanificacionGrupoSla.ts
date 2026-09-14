import { useEffect, useState } from 'react';
import { getDocs } from 'firebase/firestore';
import { empresaCollectionQuery } from '@/lib/multiempresa';
import {
    buildPlanningPositionStructure,
    DEFAULT_PLANNING_SHIFTS,
    filterSlasForPlanningContext,
    filterSlasForPlanningTenant,
    pickSlaForPlanningMonth,
    planningMonthHasActiveSla,
    resolvePlanningMonthSlaHours,
} from '@/lib/slaPlanningMatch';
import type { GrupoObjetivos } from '@/services/gruposService';

export type PlanificacionGrupoSlaParams = {
    selectedGrupo: GrupoObjetivos | null;
    grupoUnifiedMode: boolean;
    selectedClient: string;
    currentDate: Date;
    empresaId: string | null | undefined;
    scopeEmpresa: boolean;
    clients: any[];
    tenantClientIds: Set<string>;
    slaIdToObjId: Record<string, string>;
};

export function usePlanificacionGrupoSla({
    selectedGrupo,
    grupoUnifiedMode,
    selectedClient,
    currentDate,
    empresaId,
    scopeEmpresa,
    clients,
    tenantClientIds,
    slaIdToObjId,
}: PlanificacionGrupoSlaParams) {
    const [grupoSlaMap, setGrupoSlaMap] = useState<Record<string, any[]>>({});
    const [grupoTotalVendidas, setGrupoTotalVendidas] = useState(0);
    const [grupoVendidasByObjective, setGrupoVendidasByObjective] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!selectedGrupo || !grupoUnifiedMode || !selectedClient) {
            setGrupoSlaMap({});
            setGrupoTotalVendidas(0);
            setGrupoVendidasByObjective({});
            return;
        }
        const fetchGroupSlas = async () => {
            try {
                const snap = await getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa));
                const allDocs = filterSlasForPlanningTenant(
                    snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
                    empresaId,
                    scopeEmpresa,
                    tenantClientIds,
                );
                const viewYear = currentDate.getFullYear();
                const viewMonth = currentDate.getMonth();
                const result: Record<string, any[]> = {};
                const vendidasByObj: Record<string, number> = {};
                let totalVendidas = 0;
                for (const objId of selectedGrupo.objectiveIds) {
                    const matching = filterSlasForPlanningContext(allDocs, selectedClient, objId, clients, slaIdToObjId);
                    const { vigente: srv, hasExactMatch, fallback } = pickSlaForPlanningMonth(matching, viewYear, viewMonth);
                    const srvForStructure = srv ?? fallback;
                    const monthHasSla = planningMonthHasActiveSla(matching, viewYear, viewMonth);
                    if (monthHasSla && srvForStructure) {
                        const objVend = resolvePlanningMonthSlaHours(srvForStructure, viewYear, viewMonth);
                        vendidasByObj[objId] = objVend;
                        totalVendidas += objVend;
                    } else {
                        vendidasByObj[objId] = 0;
                    }
                    const { structure } = buildPlanningPositionStructure(srvForStructure, { monthHasSla, hasExactMatch: !!hasExactMatch });
                    result[objId] = structure.length > 0 ? structure : [{
                        positionName: 'General',
                        shifts: DEFAULT_PLANNING_SHIFTS.map((s: any) => ({ ...s })),
                        qty: 1,
                        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
                        coverageType: '24hs',
                    }];
                }
                setGrupoSlaMap(result);
                setGrupoTotalVendidas(totalVendidas);
                setGrupoVendidasByObjective(vendidasByObj);
            } catch (e) {
                console.error('GRUPO SLA ERROR:', e);
                setGrupoSlaMap({});
                setGrupoTotalVendidas(0);
                setGrupoVendidasByObjective({});
            }
        };
        void fetchGroupSlas();
    }, [selectedGrupo, grupoUnifiedMode, selectedClient, currentDate, empresaId, scopeEmpresa, clients, tenantClientIds, slaIdToObjId]);

    return {
        grupoSlaMap,
        grupoTotalVendidas,
        grupoVendidasByObjective,
    };
}
