import { useEffect, useState } from 'react';
import { getDocs } from 'firebase/firestore';
import { empresaCollectionQuery } from '@/lib/multiempresa';
import { mergeEncargadoIntoAssignments } from '@/lib/servicios/encargadoPosition';
import {
    buildPlanningPositionStructure,
    DEFAULT_PLANNING_SHIFTS,
    filterSlasForPlanningContext,
    filterSlasForPlanningTenant,
    formatSlaRangeHint,
    pickSlaForPlanningMonth,
    planningMonthHasActiveSla,
    resolvePlanningMonthSlaHours,
    slaBelongsToPlanningClient,
    type SlaPlanningRow,
} from '@/lib/slaPlanningMatch';
import type { PositionAssignment, ServiceRotation, ServiceRule } from '@/services/slaService';

export type PlanificacionObjectiveSlaParams = {
    selectedClient: string;
    selectedObjective: string;
    currentDate: Date;
    empresaId: string | null | undefined;
    migracionCompleta: boolean;
    scopeEmpresa: boolean;
    clients: any[];
    tenantClientIds: Set<string>;
    slaIdToObjId: Record<string, string>;
    dataRefreshNonce: number;
};

export function usePlanificacionObjectiveSla({
    selectedClient,
    selectedObjective,
    currentDate,
    empresaId,
    migracionCompleta,
    scopeEmpresa,
    clients,
    tenantClientIds,
    slaIdToObjId,
    dataRefreshNonce,
}: PlanificacionObjectiveSlaParams) {
    const [positionStructure, setPositionStructure] = useState<any[]>([]);
    const [activePlanningSlaRow, setActivePlanningSlaRow] = useState<SlaPlanningRow | null>(null);
    const [slaVendidas, setSlaVendidas] = useState<number>(0);
    const [hasActiveSLA, setHasActiveSLA] = useState<boolean>(true);
    const [slaPlanningHint, setSlaPlanningHint] = useState('');
    const [activeSlaPositionAssignments, setActiveSlaPositionAssignments] = useState<PositionAssignment[] | null>(null);
    const [activeSlaServiceRules, setActiveSlaServiceRules] = useState<ServiceRule[] | null>(null);
    const [activeSlaServiceRotations, setActiveSlaServiceRotations] = useState<ServiceRotation[] | null>(null);

    useEffect(() => {
        if (!selectedClient || !selectedObjective) {
            setPositionStructure([]);
            setActivePlanningSlaRow(null);
            setHasActiveSLA(true);
            setSlaVendidas(0);
            setSlaPlanningHint('');
            setActiveSlaPositionAssignments(null);
            setActiveSlaServiceRules(null);
            setActiveSlaServiceRotations(null);
            return;
        }
        const fetchSLA = async () => {
            try {
                const snap = await getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa));
                const allDocs = filterSlasForPlanningTenant(
                    snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
                    empresaId,
                    scopeEmpresa,
                    tenantClientIds,
                );
                const clientDocs = allDocs.filter((d) =>
                    slaBelongsToPlanningClient(d, selectedClient, clients),
                );
                const matching = filterSlasForPlanningContext(
                    allDocs,
                    selectedClient,
                    selectedObjective,
                    clients,
                    slaIdToObjId,
                );

                const viewYear = currentDate.getFullYear();
                const viewMonth = currentDate.getMonth();
                const { vigente: srv, hasExactMatch, fallback } = pickSlaForPlanningMonth(matching, viewYear, viewMonth);
                const srvForStructure = srv ?? fallback;
                const monthHasSla = planningMonthHasActiveSla(matching, viewYear, viewMonth);

                if (!monthHasSla) {
                    if (matching.length > 0) {
                        setSlaPlanningHint(`contratos del objetivo: ${formatSlaRangeHint(matching)}`);
                    } else if (clientDocs.length > 0) {
                        setSlaPlanningHint(`${clientDocs.length} contrato(s) del cliente no vinculan a este objetivo — revisá Servicios`);
                    } else if (allDocs.length > 0) {
                        setSlaPlanningHint(`${allDocs.length} contrato(s) en Servicios no coinciden con este cliente (revisá clientId tras restore)`);
                    } else {
                        setSlaPlanningHint('sin contratos en Servicios para este cliente');
                    }
                } else {
                    setSlaPlanningHint('');
                }

                const { structure, usedSlaFallback } = buildPlanningPositionStructure(srvForStructure, {
                    monthHasSla,
                    hasExactMatch,
                });
                if (structure.length === 0) {
                    console.warn('CRONO: Sin contrato SLA para este mes; estructura mínima de respaldo.');
                    structure.push({
                        positionName: 'General',
                        shifts: DEFAULT_PLANNING_SHIFTS.map((s) => ({ ...s })),
                        qty: 1,
                        activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
                        coverageType: '24hs',
                    });
                } else if (usedSlaFallback) {
                    console.info('CRONO: Contrato SLA vigente sin puestos/turnos configurados; usando M/T/N por defecto.');
                }
                setHasActiveSLA(monthHasSla);
                setPositionStructure(structure);
                setActivePlanningSlaRow(srvForStructure ?? null);
                setActiveSlaPositionAssignments(mergeEncargadoIntoAssignments({
                    positionAssignments: srvForStructure?.positionAssignments,
                    encargadoEmployeeId: typeof srvForStructure?.encargadoEmployeeId === 'string' ? srvForStructure.encargadoEmployeeId : undefined,
                    encargadoEmployeeName: typeof srvForStructure?.encargadoEmployeeName === 'string' ? srvForStructure.encargadoEmployeeName : undefined,
                    positions: srvForStructure?.positions,
                }) ?? null);
                setActiveSlaServiceRules(srvForStructure?.serviceRules ?? null);
                const loadedRot = srvForStructure?.serviceRotations ?? null;
                console.log('[CRONO rot] slaId:', srvForStructure?.id, '| serviceRotations:', loadedRot?.length ?? 'null', loadedRot?.map((r: any) => ({ id: r.id, mode: r.cycleMode, entries: r.periods?.[0]?.entries?.map((e: any) => ({ eid: e.employeeId, sc: e.shiftCode })) })));
                setActiveSlaServiceRotations(loadedRot);
                setSlaVendidas(
                    monthHasSla && srvForStructure
                        ? resolvePlanningMonthSlaHours(srvForStructure, viewYear, viewMonth)
                        : 0,
                );
            } catch (e) {
                console.error('CRONO SLA ERROR:', e);
                setPositionStructure([{ positionName: 'ERROR', shifts: [], qty: 1 }]);
                setActivePlanningSlaRow(null);
                setHasActiveSLA(false);
                setSlaVendidas(0);
                setSlaPlanningHint('error al cargar contratos');
                setActiveSlaPositionAssignments(null);
                setActiveSlaServiceRules(null);
                setActiveSlaServiceRotations(null);
            }
        };
        void fetchSLA();
    }, [
        selectedClient,
        selectedObjective,
        currentDate,
        empresaId,
        migracionCompleta,
        scopeEmpresa,
        clients,
        tenantClientIds,
        slaIdToObjId,
        dataRefreshNonce,
    ]);

    return {
        positionStructure,
        activePlanningSlaRow,
        slaVendidas,
        hasActiveSLA,
        slaPlanningHint,
        activeSlaPositionAssignments,
        activeSlaServiceRules,
        activeSlaServiceRotations,
    };
}
