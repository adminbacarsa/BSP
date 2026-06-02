import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { collection, onSnapshot } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import {
    belongsToEmpresaView,
    dedupeClientsById,
    empresaCollectionQuery,
    filterRowsByEmpresa,
    shouldScopeQueriesToEmpresa,
} from '@/lib/multiempresa';
import { buildAbsencesMapFromDocs } from '@/lib/planificacion/absenceCodes';
import { cronoCompareDateKey, dateFromMonthParam, monthParamFromDate } from '@/lib/planificacion/cronoCompareUtils';
import { CronoComparePanel } from '@/components/planificacion/CronoComparePanel';

export default function CronoPopoutPage() {
    const router = useRouter();
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = (empresa as any)?.migracionCompleta === true;
    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

    const [clients, setClients] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [shiftsMap, setShiftsMap] = useState<Record<string, any>>({});
    const [absencesMap, setAbsencesMap] = useState<Record<string, any>>({});
    const [slaIdToObjId, setSlaIdToObjId] = useState<Record<string, string>>({});
    const [ready, setReady] = useState(false);

    const queryClient = typeof router.query.client === 'string' ? router.query.client : '';
    const queryObjective = typeof router.query.objective === 'string' ? router.query.objective : '';
    const queryMonth = typeof router.query.month === 'string' ? router.query.month : monthParamFromDate(new Date());
    const queryMain = typeof router.query.main === 'string' ? router.query.main : '';

    const [clientId, setClientId] = useState('');
    const [objectiveId, setObjectiveId] = useState('');
    const [monthDate, setMonthDate] = useState(() => dateFromMonthParam(queryMonth));

    useEffect(() => {
        if (!router.isReady) return;
        setClientId(queryClient);
        setObjectiveId(queryObjective);
        setMonthDate(dateFromMonthParam(queryMonth));
        setReady(true);
    }, [router.isReady, queryClient, queryObjective, queryMonth]);

    const syncUrl = (next: { client?: string; objective?: string; month?: Date }) => {
        const c = next.client ?? clientId;
        const o = next.objective ?? objectiveId;
        const m = monthParamFromDate(next.month ?? monthDate);
        const q: Record<string, string> = { client: c, objective: o, month: m };
        if (queryMain) q.main = queryMain;
        router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true });
    };

    useEffect(() => {
        if (!empresaId) return;

        const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
        const empleadosQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);
        const turnosQ = empresaCollectionQuery('turnos', empresaId, scopeEmpresa);
        const ausenciasQ = empresaCollectionQuery('ausencias', empresaId, scopeEmpresa);
        const slaQ = empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa);

        const unsubC = onSnapshot(clientsQ, (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setClients(dedupeClientsById(filterRowsByEmpresa(rows, empresaId, scopeEmpresa, migracionCompleta)));
        });

        const unsubE = onSnapshot(empleadosQ, (snap) => {
            setEmployees(
                snap.docs
                    .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                    .map((d) => {
                        const data = d.data();
                        return {
                            id: d.id,
                            name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim(),
                            preferredObjectiveId: data.preferredObjectiveId,
                            status: data.status || 'activo',
                        };
                    }),
            );
        });

        const unsubS = onSnapshot(turnosQ, (snap) => {
            const map: Record<string, any> = {};
            snap.docs.forEach((d) => {
                const data = d.data();
                if (!belongsToEmpresaView(data, empresaId, migracionCompleta)) return;
                if (data.startTime?.seconds) {
                    const dateKey = cronoCompareDateKey(data.startTime);
                    const key = `${data.employeeId}_${dateKey}`;
                    map[key] = {
                        id: d.id,
                        ...data,
                        code: data.code || data.type,
                        objectiveId: data.objectiveId,
                        isFrancoTrabajado: data.isFrancoTrabajado || false,
                        isFrancoCompensatorio: data.isFrancoCompensatorio || false,
                    };
                }
            });
            setShiftsMap(map);
        });

        const unsubA = onSnapshot(ausenciasQ, (snap) => {
            const docs = snap.docs
                .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
            setAbsencesMap(buildAbsencesMapFromDocs(docs, cronoCompareDateKey));
        });

        const unsubSla = onSnapshot(slaQ, (snap) => {
            const m: Record<string, string> = {};
            snap.docs.forEach((d) => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                if (d.data().objectiveId) m[d.id] = d.data().objectiveId;
            });
            setSlaIdToObjId(m);
        });

        return () => {
            unsubC();
            unsubE();
            unsubS();
            unsubA();
            unsubSla();
        };
    }, [empresaId, migracionCompleta, scopeEmpresa]);

    const objectiveLabel = useMemo(() => {
        const client = clients.find((c) => c.id === clientId);
        const obj = (client?.objetivos || []).find((o: any) => (o.id || o.name) === objectiveId);
        return obj?.name || 'Crono';
    }, [clients, clientId, objectiveId]);

    if (!ready) {
        return (
            <div className="h-screen flex items-center justify-center bg-slate-900 text-slate-300">
                <Loader2 className="animate-spin mr-2" size={24} />
                Cargando crono…
            </div>
        );
    }

    return (
        <>
            <Head>
                <title>{objectiveLabel} · Crono extra</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <div className="h-[100dvh] w-screen overflow-hidden bg-white dark:bg-slate-950">
                <CronoComparePanel
                    clients={clients}
                    employees={employees}
                    shiftsMap={shiftsMap}
                    absencesMap={absencesMap}
                    slaIdToObjId={slaIdToObjId}
                    clientId={clientId}
                    objectiveId={objectiveId}
                    monthDate={monthDate}
                    mainObjectiveId={queryMain}
                    mode="popout"
                    onClientChange={(c) => {
                        setClientId(c);
                        setObjectiveId('');
                        syncUrl({ client: c, objective: '' });
                    }}
                    onObjectiveChange={(o) => {
                        setObjectiveId(o);
                        syncUrl({ objective: o });
                    }}
                    onMonthChange={(d) => {
                        setMonthDate(d);
                        syncUrl({ month: d });
                    }}
                    onClose={() => window.close()}
                />
            </div>
        </>
    );
}
