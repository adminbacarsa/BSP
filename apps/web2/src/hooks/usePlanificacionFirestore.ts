import { useEffect, useRef, useState } from 'react';
import {
    collection,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    where,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import {
    auditLogTimestampMs,
    belongsToEmpresaView,
    buildAuditLogsRecentQuery,
    dedupeClientsById,
    empresaCollectionQuery,
    filterRowsByEmpresa,
    sortAuditLogRows,
} from '@/lib/multiempresa';
import { buildAbsencesMapFromDocs } from '@/lib/planificacion/absenceCodes';
import { planificacionActionLabel } from '@/lib/planificacion/planificacionActionLabels';
import {
    buildPlanningMonthRfzQuery,
    buildPlanningMonthTuraQuery,
    buildPlanningMonthTurnosQuery,
} from '@/lib/planificacion/loadPlanningMonthShifts';
import {
    adjacentPlanningMonths,
    getCachedPlanningMonth,
    planningMonthCacheKey,
    setCachedPlanningMonth,
} from '@/lib/planificacion/planningMonthCache';
import { ingestPlanningTurnosSnapshot, isRetainedOpsCoverageShift } from '@/lib/planificacion/planningTurnosIngest';
import { isPlanificacionInboxNovedad } from '@/lib/planificacion/planificacionInbox';
import { getDateKey } from '@/lib/planificacion/utils';
import type { PlanificacionDotacionMap } from '@/lib/planificacion/planificacionDotacionUtils';

export type PlanificacionFirestoreParams = {
    empresaId: string | null | undefined;
    migracionCompleta: boolean;
    scopeEmpresa: boolean;
    currentDate: Date;
};

function mergeRetainOpsCoverages(
    ingested: ReturnType<typeof ingestPlanningTurnosSnapshot>,
    prevShifts: Record<string, any>,
    monthPrefix: string,
): ReturnType<typeof ingestPlanningTurnosSnapshot> {
    const shiftsMap = { ...ingested.shiftsMap };
    const cellTurnosMap = { ...ingested.cellTurnosMap };
    const allShiftIds = { ...ingested.allShiftIds };
    for (const [key, s] of Object.entries(prevShifts)) {
        if (!s || shiftsMap[key]) continue;
        if (!isRetainedOpsCoverageShift(s)) continue;
        const dateKey = key.includes('_') ? key.slice(key.indexOf('_') + 1) : '';
        if (!dateKey.startsWith(monthPrefix)) continue;
        shiftsMap[key] = s;
        if (!cellTurnosMap[key]) cellTurnosMap[key] = [s];
        if (s.id) {
            if (!allShiftIds[key]) allShiftIds[key] = [];
            if (!allShiftIds[key].includes(s.id)) allShiftIds[key].push(s.id);
        }
    }
    return { ...ingested, shiftsMap, cellTurnosMap, allShiftIds };
}

export function usePlanificacionFirestore({
    empresaId,
    migracionCompleta,
    scopeEmpresa,
    currentDate,
}: PlanificacionFirestoreParams) {
    const [isDataSyncing, setIsDataSyncing] = useState(false);
    const dataSyncRef = useRef<{ employees: boolean; clients: boolean }>({ employees: false, clients: false });

    const [employees, setEmployees] = useState<any[]>([]);
    const [slaIdToObjId, setSlaIdToObjId] = useState<Record<string, string>>({});
    const [shiftsMap, setShiftsMap] = useState<Record<string, any>>({});
    const [cellTurnosMap, setCellTurnosMap] = useState<Record<string, any[]>>({});
    const [shiftsMapLoaded, setShiftsMapLoaded] = useState(false);
    const [turaMap, setTuraMap] = useState<Record<string, any>>({});
    const [rfzVacantes, setRfzVacantes] = useState<any[]>([]);
    const [rfzTodos, setRfzTodos] = useState<any[]>([]);
    const [allShiftIds, setAllShiftIds] = useState<Record<string, string[]>>({});
    const [absencesMap, setAbsencesMap] = useState<Record<string, any>>({});
    const [clients, setClients] = useState<any[]>([]);
    const [agreements, setAgreements] = useState<any[]>([]);
    const [unifiedLogs, setUnifiedLogs] = useState<any[]>([]);
    const [notifLogs, setNotifLogs] = useState<any[]>([]);
    const [latestLog, setLatestLog] = useState<any>(null);
    const prevLatestLogId = useRef<string | null>(null);
    const latestLogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [hasUnread, setHasUnread] = useState(false);
    const [secondBlockMap, setSecondBlockMap] = useState<Record<string, { startTime: any; endTime: any }>>({});

    const clearLatestLogNotification = () => {
        setLatestLog(null);
        if (latestLogTimer.current) clearTimeout(latestLogTimer.current);
    };

    // LISTENER DE NOVEDADES Y OTROS DATOS
    useEffect(() => {
        if (!empresaId) return;

        setIsDataSyncing(true);
        dataSyncRef.current = { employees: false, clients: false };
        const checkSynced = () => {
            if (dataSyncRef.current.employees && dataSyncRef.current.clients) setIsDataSyncing(false);
        };
        const syncTimeout = setTimeout(() => setIsDataSyncing(false), 2000);

        getDocs(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa)).then(snap => {
            const m: Record<string, string> = {};
            snap.docs.forEach(d => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                if (d.data().objectiveId) m[d.id] = d.data().objectiveId;
            });
            setSlaIdToObjId(m);
        }).catch(() => {});

        const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
        const empleadosQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);

        const unsubC = onSnapshot(clientsQ, snap => {
            dataSyncRef.current.clients = true;
            checkSynced();
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setClients(dedupeClientsById(filterRowsByEmpresa(rows, empresaId, scopeEmpresa, migracionCompleta)));
        }, (e) => console.error('[plan] clients error:', e));
        const unsubAg = onSnapshot(collection(db, 'convenios_colectivos'), snap => setAgreements(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (e) => console.error('[plan] convenios error:', e));
        const unsubE = onSnapshot(empleadosQ, snap => {
            dataSyncRef.current.employees = true;
            checkSynced();
            const map = (s: typeof snap) => s.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => {
                    const data = d.data();
                    const firstName = String(data.firstName || '').trim();
                    const lastName = String(data.lastName || '').trim();
                    const composedName = `${lastName} ${firstName}`.trim() || `${firstName} ${lastName}`.trim();
                    return {
                        id: d.id,
                        name: String(data.name || '').trim() || composedName,
                        firstName,
                        lastName,
                        fileNumber: String(data.fileNumber || data.legajo || '').trim(),
                        dni: String(data.dni || '').trim(),
                        preferredObjectiveId: data.preferredObjectiveId,
                        planificacionDotacion: (data.planificacionDotacion || {}) as PlanificacionDotacionMap,
                        genero: data.genero || '',
                        experienciaObjetivos: data.experienciaObjetivos || {},
                        laborAgreement: data.laborAgreement,
                        status: data.status || 'activo',
                        lat: data.lat ?? data.latitude ?? null,
                        lng: data.lng ?? data.longitude ?? null,
                        address: data.address || '',
                        restriccionesObjetivo: data.restriccionesObjetivo || [],
                        restriccionesCliente: data.restriccionesCliente || [],
                        conflictosEmpleados: data.conflictosEmpleados || [],
                        volante: data.volante || [],
                    };
                });
            setEmployees(map(snap));
        }, (e) => console.error('[plan] empleados error:', e));

        const unsubLogs = onSnapshot(
            buildAuditLogsRecentQuery(empresaId, scopeEmpresa, { limit: 60 }),
            (snap) => {
                const rows = sortAuditLogRows(
                    snap.docs
                        .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                        .map((d) => {
                            const data: any = d.data();
                            const tsMs = auditLogTimestampMs(data) || Date.now();
                            return {
                                id: d.id,
                                timestamp: tsMs,
                                label: planificacionActionLabel(data.action),
                                detail: data.details || '',
                                objectiveName: data.objectiveName || '',
                                actorUid: data.actorUid || '',
                                actorEmail: data.actorEmail || '',
                                actorName: data.actorName || data.actor || '',
                                actor: data.actorName || data.actorEmail || data.actor || data.actorUid || '',
                                module: data.module || '',
                                action: data.action || '',
                            };
                        })
                        .filter((x) => {
                            const mod = (x.module || '').toString().toUpperCase();
                            if (mod === 'PLANIFICADOR') return true;
                            if (mod === 'OPERACIONES' && (x.action === 'Devolución a Planificación' || (x.label || '').includes('Devolución'))) return true;
                            return false;
                        }),
                    20,
                );
                setUnifiedLogs(rows);
                const newest = rows[0];
                if (newest && newest.id !== prevLatestLogId.current) {
                    if (prevLatestLogId.current !== null) {
                        if (latestLogTimer.current) clearTimeout(latestLogTimer.current);
                        setLatestLog(newest);
                        latestLogTimer.current = setTimeout(() => setLatestLog(null), 60000);
                    }
                    prevLatestLogId.current = newest.id;
                }
            },
            () => setUnifiedLogs([]),
        );

        const unsubNotifs = onSnapshot(
            scopeEmpresa && empresaId
                ? query(empresaCollectionQuery('user_notifications', empresaId, scopeEmpresa), limit(80))
                : query(collection(db, 'user_notifications'), orderBy('createdAt', 'desc'), limit(50)),
            (snap) => {
                const rows = snap.docs
                    .filter((d) => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                    .filter((d) => {
                        const t = String(d.data()?.target || '').toLowerCase();
                        return t !== 'admin' && t !== 'ops' && t !== 'operaciones';
                    })
                    .map(d => {
                        const data: any = d.data();
                        const ts = data.createdAt?.toDate ? data.createdAt.toDate()
                            : (data.createdAt?.seconds ? new Date(data.createdAt.seconds * 1000) : new Date());
                        const readTs = data.readAt?.toDate ? data.readAt.toDate()
                            : (data.readAt?.seconds ? new Date(data.readAt.seconds * 1000) : null);
                        const ackTs = data.ackedAt?.toDate ? data.ackedAt.toDate()
                            : (data.ackedAt?.seconds ? new Date(data.ackedAt.seconds * 1000) : null);
                        return {
                            id: d.id,
                            timestamp: ts.getTime(),
                            employeeId: data.employeeId || '',
                            title: data.title || '',
                            body: data.body || '',
                            type: data.type || '',
                            read: !!data.read,
                            readAt: readTs ? readTs.getTime() : null,
                            requiresAck: data.requiresAck === true,
                            ackedAt: ackTs ? ackTs.getTime() : null,
                            ackedByUid: data.ackedByUid || null,
                        };
                    })
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 50);
                setNotifLogs(rows);
            },
            () => setNotifLogs([]),
        );

        const ausenciasQ = empresaCollectionQuery('ausencias', empresaId, scopeEmpresa);
        const unsubA = onSnapshot(ausenciasQ, snap => {
            const docs = snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => ({ id: d.id, data: d.data() as Record<string, unknown> }));
            setAbsencesMap(buildAbsencesMapFromDocs(docs, getDateKey));
        }, (e) => console.error('[plan] ausencias error:', e));

        const qNovedades = scopeEmpresa
            ? query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(80))
            : query(collection(db, 'novedades'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(80));
        const unsubN = onSnapshot(qNovedades, (snap) => {
            const alerts = snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .filter(d => isPlanificacionInboxNovedad(d.data() as Record<string, unknown>))
                .map(d => {
                    const data = d.data();
                    const isAusencia = data.source === 'AUSENCIA';
                    const isVacante = data.type === 'VACANTE_A_PLANIFICACION' || data.type === 'VACANTE_NO_CUBIERTA';
                    const fallbackTitle = data.type === 'REFUERZO_CLIENTE_PENDIENTE'
                        ? `${data.tipoSolicitud || 'RFZ'} · ${data.positionName || data.objectiveName || 'Refuerzo cliente'}`
                        : isVacante
                            ? (data.title || 'Vacante → Planificación')
                            : isAusencia
                                ? (data.title || `${data.type || 'Novedad'} → Planificación`)
                                : (data.title || data.type || 'Novedad');
                    return {
                        id: d.id,
                        ...data,
                        source: data.source || 'NOVEDAD',
                        title: data.title || fallbackTitle,
                        msg: data.description || data.details || data.msg || '',
                    };
                });
            setNotifications(alerts);
            setHasUnread(alerts.length > 0);
        }, (e) => console.error('[plan] novedades error:', e));

        return () => {
            clearTimeout(syncTimeout);
            unsubC();
            unsubE();
            unsubLogs();
            unsubNotifs();
            unsubA();
            unsubAg();
            unsubN();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresaId, migracionCompleta, scopeEmpresa]);

    // Turnos del mes visible (evita escuchar toda la colección turnos)
    useEffect(() => {
        if (!empresaId) {
            setShiftsMap({});
            setCellTurnosMap({});
            setShiftsMapLoaded(false);
            return;
        }
        const viewYear = currentDate.getFullYear();
        const viewMonth = currentDate.getMonth() + 1;
        const cacheKey = planningMonthCacheKey(empresaId, viewYear, viewMonth);
        let prefetchTimer: number | undefined;

        const applyIngested = (ingested: ReturnType<typeof ingestPlanningTurnosSnapshot>) => {
            setShiftsMap(ingested.shiftsMap);
            setCellTurnosMap(ingested.cellTurnosMap);
            setAllShiftIds(ingested.allShiftIds);
            setTuraMap((prev) => ({ ...prev, ...ingested.turaMap }));
            setSecondBlockMap(ingested.secondBlockMap);
            setRfzVacantes(ingested.rfzVacantes);
            setRfzTodos(ingested.rfzTodos);
            setShiftsMapLoaded(true);
        };

        const cached = getCachedPlanningMonth(cacheKey);
        if (cached) {
            applyIngested(cached);
        } else {
            setShiftsMapLoaded(false);
            setRfzVacantes([]);
            setRfzTodos([]);
            setTuraMap({});
        }

        const mergeRfzLists = (prev: any[], extra: any[]) => {
            if (extra.length === 0) return prev;
            const byId = new Map(prev.map((r) => [r.id, r]));
            extra.forEach((r) => byId.set(r.id, r));
            return Array.from(byId.values());
        };

        const applyMainSnap = (snap: import('firebase/firestore').QuerySnapshot) => {
            // Evitar cachear el 1.er snapshot vacío fromCache (mismo problema que Análisis).
            if (snap.metadata.fromCache && snap.empty) {
                const existing = getCachedPlanningMonth(cacheKey);
                if (existing) {
                    applyIngested(existing);
                    return;
                }
            }
            const monthPrefix = `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
            const ingestedRaw = ingestPlanningTurnosSnapshot(
                snap.docs,
                empresaId,
                migracionCompleta,
                getDateKey,
            );
            setShiftsMap((prev) => {
                const ingested = mergeRetainOpsCoverages(ingestedRaw, prev, monthPrefix);
                setCachedPlanningMonth(cacheKey, ingested);
                setCellTurnosMap(ingested.cellTurnosMap);
                setAllShiftIds(ingested.allShiftIds);
                setTuraMap((tPrev) => ({ ...tPrev, ...ingested.turaMap }));
                setSecondBlockMap(ingested.secondBlockMap);
                setRfzVacantes(ingested.rfzVacantes);
                setRfzTodos(ingested.rfzTodos);
                setShiftsMapLoaded(true);
                return ingested.shiftsMap;
            });
            if (!prefetchTimer) {
                prefetchTimer = window.setTimeout(() => {
                    adjacentPlanningMonths(viewYear, viewMonth).forEach(({ year, month }) => {
                        const key = planningMonthCacheKey(empresaId, year, month);
                        if (getCachedPlanningMonth(key)) return;
                        getDocs(buildPlanningMonthTurnosQuery({ empresaId, scopeEmpresa, year, month }))
                            .then((adjSnap) => {
                                setCachedPlanningMonth(
                                    key,
                                    ingestPlanningTurnosSnapshot(adjSnap.docs, empresaId, migracionCompleta, getDateKey),
                                );
                            })
                            .catch(() => {});
                    });
                }, 600);
            }
        };

        const turnosQ = buildPlanningMonthTurnosQuery({
            empresaId,
            scopeEmpresa,
            year: viewYear,
            month: viewMonth,
        });
        const unsubS = onSnapshot(turnosQ, applyMainSnap, (e) => {
            console.error('[plan] turnos mes error:', e);
            toast.error(`Error cargando turnos: ${e.code || e.message}`);
            setShiftsMapLoaded(true);
        });

        let unsubRfz = () => {};
        let unsubTura = () => {};
        try {
            const rfzQ = buildPlanningMonthRfzQuery({
                empresaId,
                scopeEmpresa,
                year: viewYear,
                month: viewMonth,
            });
            unsubRfz = onSnapshot(rfzQ, (snap) => {
                const ingested = ingestPlanningTurnosSnapshot(
                    snap.docs,
                    empresaId,
                    migracionCompleta,
                    getDateKey,
                    { rfzOnly: true },
                );
                setRfzTodos((prev) => mergeRfzLists(prev, ingested.rfzTodos));
                setRfzVacantes((prev) => mergeRfzLists(prev, ingested.rfzVacantes));
            }, () => {
                /* sin índice compuesto: RFZ por fecha puede fallar; turnos con startTime igual cubren RFZ */
            });
        } catch {
            /* índice RFZ opcional en emulador */
        }

        try {
            const turaQ = buildPlanningMonthTuraQuery({
                empresaId,
                scopeEmpresa,
                year: viewYear,
                month: viewMonth,
            });
            unsubTura = onSnapshot(turaQ, (snap) => {
                const ingested = ingestPlanningTurnosSnapshot(
                    snap.docs,
                    empresaId,
                    migracionCompleta,
                    getDateKey,
                    { turaOnly: true },
                );
                setTuraMap((prev) => ({ ...prev, ...ingested.turaMap }));
            }, () => {
                /* índice TURA+fecha opcional en emulador */
            });
        } catch {
            /* índice TURA opcional */
        }

        return () => {
            unsubS();
            unsubRfz();
            unsubTura();
            if (prefetchTimer) window.clearTimeout(prefetchTimer);
        };
    }, [empresaId, migracionCompleta, scopeEmpresa, currentDate.getFullYear(), currentDate.getMonth()]);

    return {
        isDataSyncing,
        employees,
        slaIdToObjId,
        shiftsMap,
        setShiftsMap,
        cellTurnosMap,
        setCellTurnosMap,
        shiftsMapLoaded,
        turaMap,
        rfzVacantes,
        rfzTodos,
        allShiftIds,
        absencesMap,
        clients,
        agreements,
        unifiedLogs,
        notifLogs,
        latestLog,
        setLatestLog,
        clearLatestLogNotification,
        notifications,
        setNotifications,
        hasUnread,
        setHasUnread,
        secondBlockMap,
    };
}
