
import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp, doc, serverTimestamp, addDoc, setDoc, getDocs, runTransaction, getDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';
import { useEmpresa } from '@/context/EmpresaContext';
import { shouldScopeQueriesToEmpresa, belongsToEmpresaView, updateDocForEmpresa, stampEmpresaId, planificacionPublishLookupKey, parsePlanificacionEstadoDocId, empresaCollectionQuery, filterSlaRowsByEmpresa, buildAuditLogsRecentQuery, auditLogTimestampMs, sortAuditLogRows } from '@/lib/multiempresa';
import { combinedContiguousRangeLabel, isTuraContiguousToParent, findParentShiftForTura } from '@/lib/refuerzo/turaContiguity';

const registerPublishedState = (
    map: Record<string, boolean>,
    objectiveId: string,
    year: number,
    month: number,
) => {
    const oid = String(objectiveId ?? '').trim();
    if (!oid || !Number.isFinite(year) || !Number.isFinite(month)) return;
    map[planificacionPublishLookupKey(oid, year, month)] = true;
};

const getSafeDate = (val: any) => { if (!val) return null; try { if (val.toDate) return val.toDate(); if (val.seconds) return new Date(val.seconds * 1000); return new Date(val); } catch (e) { return null; } };
const isSameDay = (d1: Date, d2: Date) => d1 && d2 && d1.toLocaleDateString('en-CA') === d2.toLocaleDateString('en-CA');
const getDuration = (start: Date, end: Date) => { if (!start || !end) return 0; let diff = (end.getTime() - start.getTime()) / 3600000; if (diff < 0) diff += 24; return diff; };
const createDateFromTime = (timeStr: string, baseDate: Date) => { if (!timeStr) return null; const [hours, minutes] = timeStr.split(':').map(Number); const d = new Date(baseDate); d.setHours(hours, minutes, 0, 0); return d; };
const getDayCode = (date: Date) => ['D', 'L', 'M', 'X', 'J', 'V', 'S'][date.getDay()];

// HELPER: GAPS (SOLO FALLBACK)
const findTimeGaps = (shifts: any[], baseDate: Date) => {
    const timeline = new Int8Array(1440).fill(0); 
    shifts.forEach(s => {
        const start = s.shiftDateObj;
        const end = s.endDateObj;
        let sMin = start.getHours() * 60 + start.getMinutes();
        let eMin = end.getHours() * 60 + end.getMinutes();
        if (isSameDay(start, baseDate)) { if (!isSameDay(end, baseDate)) eMin = 1440; } 
        else if (isSameDay(end, baseDate)) { sMin = 0; } 
        else { if (start < baseDate && end > new Date(baseDate.getTime() + 86400000)) { sMin = 0; eMin = 1440; } else return; }
        if (eMin < sMin) eMin = 1440;
        for (let i = sMin; i < eMin; i++) if (i >= 0 && i < 1440) timeline[i] = 1;
    });
    const gaps = [];
    let inGap = false, gapStart = 0;
    for (let i = 0; i < 1440; i++) {
        if (timeline[i] === 0) { if (!inGap) { inGap = true; gapStart = i; } }
        else { if (inGap) { inGap = false; if (i - gapStart > 60) gaps.push({ start: gapStart, end: i }); } }
    }
    if (inGap && (1440 - gapStart > 60)) gaps.push({ start: gapStart, end: 1440 });
    return gaps.map(g => {
        const s = new Date(baseDate); s.setHours(Math.floor(g.start/60), g.start%60, 0, 0);
        const e = new Date(baseDate); e.setHours(Math.floor(g.end/60), g.end%60, 0, 0);
        if (g.end === 1440) e.setMinutes(59); 
        return { start: s, end: e, duration: (g.end - g.start)/60 };
    });
};

// HELPER: SLOT COVERAGE (EL VERDADERO MOTOR V124)
const checkSlotCoverage = (slotStart: Date, slotEnd: Date, shifts: any[]) => {
    let tStart = slotStart.getTime(); let tEnd = slotEnd.getTime();
    if (tEnd <= tStart) tEnd += 86400000;
    const duration = tEnd - tStart; let covered = 0;
    shifts.forEach(s => {
        let sStart = s.shiftDateObj.getTime(); let sEnd = s.endDateObj.getTime();
        if (sEnd <= sStart) sEnd += 86400000;
        
        // Alineación inteligente: Si el turno cubre el rango, suma.
        // No forzamos dias, solo superposición de timestamps.
        const overlapStart = Math.max(tStart, sStart); 
        const overlapEnd = Math.min(tEnd, sEnd);
        
        if (overlapEnd > overlapStart) covered += (overlapEnd - overlapStart);
    });
    // Tolerancia 90% cubierto
    return (covered / duration) > 0.90;
};

/** Ventana efectiva para cobertura split planificada (ext/adel con tramo horario). */
const getSegmentCoverageWindow = (s: any, baseDate: Date): { start: Date; end: Date } | null => {
    const from = s.segmentFromTime;
    const to = s.segmentToTime;
    if (typeof from === 'string' && typeof to === 'string' && /^\d{1,2}:\d{2}$/.test(from) && /^\d{1,2}:\d{2}$/.test(to)) {
        const start = createDateFromTime(from, baseDate);
        let end = createDateFromTime(to, baseDate);
        if (start && end) {
            if (end <= start) end = new Date(end.getTime() + 86400000);
            return { start, end };
        }
    }
    return null;
};

const shiftMatchesVacancyPosition = (s: any, vacancyPos: string) => {
    const vPos = normalizePosMatch(vacancyPos);
    if (normalizePosMatch(s.positionName) === vPos) return true;
    if (s.coversPositionName && normalizePosMatch(s.coversPositionName) === vPos) return true;
    return false;
};

/** Cobertura de slot considerando ext/adel planificados en otro puesto/tramo. */
const shiftCoversVacancySlot = (s: any, slotStart: Date, slotEnd: Date, vacancyPos: string) => {
    if (!shiftMatchesVacancyPosition(s, vacancyPos)) return false;
    if (s.isAbsent || s.isPotentialAbsence || s.isFranco || s.isUnassigned) return false;
    const seg = getSegmentCoverageWindow(s, slotStart);
    const proxy = seg ? { shiftDateObj: seg.start, endDateObj: seg.end } : s;
    return checkSlotCoverage(slotStart, slotEnd, [proxy]);
};

const assessPlannedPackageStatus = (rows: any[]): 'COVERED' | 'PARTIAL' | 'NONE' => {
    if (!rows.length) return 'NONE';
    const hasExt = rows.some(r => r.coverageSegmentRole === 'EXTENSION');
    const hasAdel = rows.some(r => r.coverageSegmentRole === 'EARLY_START');
    if (!hasExt || !hasAdel) return 'PARTIAL';
    const explicit = rows.find(r => r.coverageStatus === 'COVERED' || r.coverageStatus === 'PARTIAL')?.coverageStatus;
    if (explicit === 'COVERED') return 'COVERED';
    if (explicit === 'PARTIAL') return 'PARTIAL';
    return 'COVERED';
};

const normPosName = (n: unknown) => String(n ?? '').trim().toLowerCase();

// Normalización agresiva para matching entre SLA y turnos:
// elimina acentos (á→a, é→e, í→i, ó→o, ú→u) y prefijo "Puesto " para que
// "Puesto Rondin" matchee "Rondín", "Puesto 1" matchee "1", etc.
const normalizePosMatch = (n: unknown): string => {
    let s = String(n ?? '').trim().toLowerCase();
    // eslint-disable-next-line no-misleading-character-class
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip diacríticos
    s = s.replace(/^puesto\s+/, '');                         // strip prefijo "puesto "
    return s;
};

/**
 * Auto-cierre atómico via Firestore transaction.
 * Si otro browser ya completó el turno, cancela silenciosamente (devuelve false).
 */
const autoCloseShiftTx = async (
    shiftId: string,
    fields: Record<string, unknown>,
    empresaId: string,
): Promise<boolean> => {
    const ref = doc(db, 'turnos', shiftId);
    let didWrite = false;
    await runTransaction(db, async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists() || snap.data()?.isCompleted === true) return; // ya cerrado
        t.update(ref, { ...fields, empresaId: empresaId || undefined });
        didWrite = true;
    });
    return didWrite;
};

const getPositionCapacity = (servicesSLA: any[], objectiveId: string, positionName: string): number => {
    const sla = servicesSLA.find((s: any) => s.objectiveId === objectiveId);
    const pos = sla?.positions?.find((p: any) => normPosName(p.name) === normPosName(positionName));
    return Math.max(1, Number(pos?.quantity) || 1);
};

const countPresentOnSlot = (
    shifts: any[],
    objectiveId: string,
    positionName: string,
    slotStart: Date,
    slotEnd: Date,
) => shifts.filter(s =>
    s.isPresent && !s.isCompleted &&
    s.objectiveId === objectiveId &&
    normPosName(s.positionName) === normPosName(positionName) &&
    checkSlotCoverage(slotStart, slotEnd, [s]),
).length;

export const useOperacionesMonitor = (forcedClientId?: string | null) => {
    const [now, setNow] = useState(new Date());
    const [rawShifts, setRawShifts] = useState<any[]>([]);
    // RFZ/TURA se guardan con startTime/endTime como string ISO (no Timestamp), por lo que el
    // listener principal de `turnos` (que filtra por rango Timestamp) NO los devuelve. Se traen
    // en un listener aparte filtrando por `code` y se mergean en mergedRawShifts.
    const [rawRefuerzos, setRawRefuerzos] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [objectives, setObjectives] = useState<any[]>([]);
    const [servicesSLA, setServicesSLA] = useState<any[]>([]);
    const [recentLogs, setRecentLogs] = useState<any[]>([]);
    const [viewTab, setViewTab] = useState<'PRIORIDAD' | 'NO_LLEGO' | 'PLAN' | 'ACTIVOS' | 'RETENIDOS' | 'VACANTES' | 'AUSENTES' | 'FRANCOS' | 'TODOS'>('PRIORIDAD');
    const [selectedClientId, setSelectedClientId] = useState<string>(forcedClientId || '');
    const [filterText, setFilterText] = useState('');
    const [isCompact, setIsCompact] = useState(false);
    const [operatorInfo, setOperatorInfo] = useState<{ name: string; startTime: Date | null }>({ name: 'Operador', startTime: null });
    const [publishStatusMap, setPublishStatusMap] = useState<Record<string, boolean>>({});
    // isReady: true cuando los 3 listeners críticos (turnos, empleados, objetivos) recibieron su primer snapshot
    // isStable: true cuando processedData no cambió por 700ms después de isReady (evita ver actualizaciones intermedias)
    const [isReady, setIsReady] = useState(false);
    const [isStable, setIsStable] = useState(false);
    const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readyFlags = useRef({ shifts: false, employees: false, objectives: false });
    const checkReady = () => {
        if (readyFlags.current.shifts && readyFlags.current.employees && readyFlags.current.objectives) {
            setIsReady(true);
        }
    };
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

    // Fuerza re-suscripción de listeners al volver de background o reconectar red.
    // El intervalo periódico fue eliminado: Firestore gestiona la reconexión internamente
    // y el onError del listener de turnos ya llama setRefreshKey ante fallos de red.
    const [refreshKey, setRefreshKey] = useState(0);
    useEffect(() => {
        const bump = () => setRefreshKey(k => k + 1);
        const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', bump);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', bump);
        };
    }, []);

    useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

    // SUSCRIPCIONES
    useEffect(() => {
        if (!empresaId || empresa === null) return; // esperar a que cargue el doc de empresa (migracionCompleta puede cambiar)
        const auth = getAuth();
        if (auth.currentUser) setOperatorInfo({ name: auth.currentUser.email?.split('@')[0] || 'Op', startTime: new Date() });
        const unsubs: Function[] = [];

        const mapEmps = (docs: any[]) => docs.map(d => ({ id: d.id, fullName: `${d.data().lastName} ${d.data().firstName}`, ...d.data() }));
        const empQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(empQ, snap => {
            const docs = snap.docs.filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta));
            setEmployees(mapEmps(docs));
            readyFlags.current.employees = true; checkReady();
        }));

        const buildObjectives = (docs: any[]) => { const objs: any[] = []; docs.forEach(d => { const data = d.data(); if (data.objetivos) data.objetivos.forEach((o: any) => objs.push({ ...o, clientName: data.name, clientId: d.id })); else objs.push({ id: d.id, name: data.name, clientName: data.name, clientId: d.id }); }); return objs; };
        const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(clientsQ, snap => {
            const docs = snap.docs.filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta));
            setObjectives(buildObjectives(docs));
            readyFlags.current.objectives = true; checkReady();
        }));

        const svcQ = query(empresaCollectionQuery('servicios_sla', empresaId, scopeEmpresa), where('status', '==', 'active'));
        unsubs.push(onSnapshot(svcQ, snap => {
            const rows = snap.docs
                .map(d => ({ id: d.id, ...d.data() } as { id: string; empresaId?: unknown }))
                .filter(r => belongsToEmpresaView(r, empresaId, migracionCompleta));
            setServicesSLA(rows);
        }));
        const planifQ = empresaCollectionQuery('planificacion_estados', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(planifQ, snap => {
            const map: Record<string, boolean> = {};
            snap.docs.forEach(d => {
                if (!belongsToEmpresaView(d.data(), empresaId, migracionCompleta)) return;
                const data = d.data() as Record<string, unknown>;
                const parsed = parsePlanificacionEstadoDocId(d.id);
                if (parsed) {
                    registerPublishedState(map, parsed.objectiveId, parsed.year, parsed.month);
                }
                const objId = String(data.objectiveId ?? data.objetivoId ?? parsed?.objectiveId ?? '').trim();
                const y = Number(data.year ?? data.año ?? parsed?.year);
                const m = Number(data.month ?? data.mes ?? parsed?.month);
                if (objId) registerPublishedState(map, objId, y, m);
            });
            setPublishStatusMap(map);
        }));
        const startLog = new Date(); startLog.setDate(startLog.getDate() - 2);
        unsubs.push(onSnapshot(buildAuditLogsRecentQuery(empresaId, scopeEmpresa, { since: startLog, limit: 120 }), (snap) => {
            setRecentLogs(sortAuditLogRows(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        ...data,
                        timestamp: auditLogTimestampMs(data) || Date.now(),
                        formattedActor: data.actorName,
                        time: getSafeDate(data.timestamp),
                        fullDetail: data.details,
                        objectiveId: data.objectiveId || '',
                        objectiveName: data.objectiveName || '',
                        employeeId: data.employeeId || '',
                        employeeName: data.employeeName || '',
                        shiftId: data.shiftId || '',
                        module: data.module || 'OPERACIONES',
                        actorUid: data.actorUid || data.uid || '',
                    };
                }), 200));
        }));
        return () => { unsubs.forEach(u => u()); };
    }, [empresaId, empresa, migracionCompleta, scopeEmpresa, refreshKey]);

    useEffect(() => {
        if (!empresaId || empresa === null) return; // esperar a que cargue el doc de empresa
        const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(12,0,0,0); // ayer al mediodía — cubre turnos nocturnos que arrancan a las 22-23hs
        const end = new Date(); end.setDate(end.getDate() + 1); end.setHours(23,59,59,999);   // mañana al final — cubre planificación del día siguiente
        const turnosBase = query(
            empresaCollectionQuery('turnos', empresaId, scopeEmpresa),
            where('startTime', '>=', Timestamp.fromDate(start)),
            where('startTime', '<=', Timestamp.fromDate(end)),
        );
        const unsub = onSnapshot(turnosBase, (snap) => {
            setRawShifts(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => ({ id: d.id, ...d.data(), shiftDateObj: getSafeDate(d.data().startTime), endDateObj: getSafeDate(d.data().endTime) })));
            readyFlags.current.shifts = true; checkReady();
        }, (err) => {
            console.warn('[useOperacionesMonitor] turnos listener error, forzando reconexión:', err.code);
            setRefreshKey(k => k + 1);
        });

        // Refuerzos (RFZ) y turnos agregados (TURA): startTime/endTime son string ISO, así que el
        // rango Timestamp del listener principal los excluye. Listener aparte por `code`.
        // Con scopeEmpresa=true agrega empresaId para reducir lecturas (requiere índice compuesto
        // en Firestore: empresaId ASC, code ASC — crear desde la consola si aparece el error de índice).
        const startMs = start.getTime();
        const endMs = end.getTime();
        const refuerzosQ = scopeEmpresa
            ? query(empresaCollectionQuery('turnos', empresaId, true), where('code', 'in', ['RFZ', 'TURA']))
            : query(collection(db, 'turnos'), where('code', 'in', ['RFZ', 'TURA']));
        const unsubRfz = onSnapshot(refuerzosQ, (snap) => {
            setRawRefuerzos(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .filter(d => d.data().isDeleted !== true)
                .map(d => ({ id: d.id, ...d.data(), shiftDateObj: getSafeDate(d.data().startTime), endDateObj: getSafeDate(d.data().endTime) }))
                .filter((s: any) => {
                    const t = s.shiftDateObj instanceof Date ? s.shiftDateObj.getTime() : NaN;
                    return !isNaN(t) && t >= startMs && t <= endMs;
                }));
        }, (err) => {
            console.warn('[useOperacionesMonitor] refuerzos listener error:', err.code);
        });

        return () => { unsub(); unsubRfz(); };
    }, [empresaId, empresa, migracionCompleta, scopeEmpresa, refreshKey]);

    // Unifica turnos regulares (Timestamp) + refuerzos RFZ/TURA (string ISO). Dedup por id.
    const mergedRawShifts = useMemo(() => {
        const map = new Map<string, any>();
        rawShifts.forEach(s => map.set(s.id, s));
        rawRefuerzos.forEach(s => { if (!map.has(s.id)) map.set(s.id, s); });
        return Array.from(map.values()).filter((s) => s.isDeleted !== true);
    }, [rawShifts, rawRefuerzos]);

    const uniqueClients = useMemo(() => { const map = new Map(); objectives.forEach(obj => map.set(obj.clientId, obj.clientName)); return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [objectives]);
    const foldSearch = (value: unknown) => String(value ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const processedData = useMemo(() => {
        const currentTime = new Date(now.getTime());
        const yearMonth = `${now.getFullYear()}_${now.getMonth() + 1}`;
        const empMap = new Map(); employees.forEach(e => empMap.set(e.id, e.fullName));
        const empPhoneMap = new Map(); employees.forEach(e => empPhoneMap.set(e.id, e.phone || e.celular || ''));
        // Los objetivos usan "objectiveId" como ID, no "id" — mapear ambos para compatibilidad
        const objMap = new Map();
        objectives.forEach(o => {
            const key = o.id || o.objectiveId;
            if (key) objMap.set(key, { clientName: o.clientName, name: o.name, clientId: o.clientId });
        });
        // Filtrar SLAs por empresa usando clientId como fallback para docs legacy sin empresaId
        const clientIds = new Set(objectives.map((o: any) => o.clientId).filter(Boolean));
        const filteredSLA = filterSlaRowsByEmpresa(servicesSLA, empresaId, scopeEmpresa, clientIds);
        const activeSlaMap = new Set(filteredSLA.map((s: any) => s.objectiveId));

        const suppressedTuraIds = new Set<string>();
        const parentTuraExt = new Map<string, { turaId: string; endDateObj: Date; tura: any }>();
        mergedRawShifts.forEach((row) => {
            const code = String(row.code || row.type || '').toUpperCase();
            if (code !== 'TURA') return;
            const parent = findParentShiftForTura(row, mergedRawShifts);
            if (!parent?.id) return;
            const parentKey = String(parent.id);
            const contiguous = row.turaContiguous === true
                || (row.turaContiguous !== false && isTuraContiguousToParent(parent, row));
            if (contiguous && row.endDateObj instanceof Date) {
                suppressedTuraIds.add(row.id);
                parentTuraExt.set(parentKey, { turaId: row.id, endDateObj: row.endDateObj, tura: row });
            }
        });

        const realShifts = mergedRawShifts.map(shift => {
            if (!shift.shiftDateObj) return null;
            if (shift.draft === true) return null;
            if (suppressedTuraIds.has(shift.id)) return null;
            // COVERED: solo descartar si es una vacante real (employeeId=VACANTE)
            // Si es una ausencia, mantener en processedData para tracking RRHH
            if (shift.status === 'COVERED' && !shift.isAbsent && (!shift.employeeId || shift.employeeId === 'VACANTE')) return null;
            const rawPos = (shift.positionName || '').trim();
            if (!rawPos || rawPos === 'Sin Puesto' || rawPos === 'General') return null;

            // Solo mostrar turnos de planificación publicada. Los turnos operativos
            // (retén, cobertura, auto-reportados) y los ya procesados (presentes/ausentes)
            // siempre se muestran sin importar el estado de publicación.
            const shiftCodeUpper = String(shift.code || shift.type || '').toUpperCase();
            const isClientRefuerzoPlanificado = shift.origin === 'CLIENT_REQUEST'
                && (shiftCodeUpper === 'RFZ' || shiftCodeUpper === 'TURA');
            const isOperationalOrigin = shift.origin === 'RETEN' || shift.origin === 'OPERATIONS_COVERAGE' || shift.origin === 'SLA_VIRTUAL' || (shift.origin === 'CLIENT_REQUEST' && !isClientRefuerzoPlanificado) || shift.origin === 'EVENTO' || !!shift.isReten || shift.resolvedBy === 'OPERACIONES';
            // isAbsent incluido: un turno ausente de planificación no publicada igual debe mostrarse
            // para que PATH-B detecte la vacante. Sin esto, allPosShifts queda vacío → sin vacante.
            const isAlreadyProcessed = !!shift.isPresent || shift.status === 'PRESENT' || shift.status === 'COMPLETED' || !!shift.isReportedToPlanning || !!shift.isReported || !!shift.isAbsent;
            if (!isOperationalOrigin && !isAlreadyProcessed) {
                const shiftDate = shift.shiftDateObj!;
                const pubKey = planificacionPublishLookupKey(
                    shift.objectiveId,
                    shiftDate.getFullYear(),
                    shiftDate.getMonth() + 1,
                );
                if (!publishStatusMap[pubKey]) return null;
            }

            let info = objMap.get(shift.objectiveId);
            let finalClient = (info?.clientName) || shift.clientName || '';
            let finalObj = (info?.name) || shift.objectiveName || '';
            let finalEmpName = shift.employeeName;
            
            let isValidEmployee = false;
            const parentEmpleadoId = String(shift.parentEmpleadoId || '').trim();
            const effectiveEmployeeId = (shift.employeeId && shift.employeeId !== 'VACANTE')
                ? shift.employeeId
                : (parentEmpleadoId || null);

            if (effectiveEmployeeId && effectiveEmployeeId !== 'VACANTE') {
                const foundName = empMap.get(effectiveEmployeeId);
                if (foundName) finalEmpName = foundName;
                else if (shift.parentEmpleadoName && parentEmpleadoId) finalEmpName = shift.parentEmpleadoName;
                isValidEmployee = true; 
            } else { finalEmpName = 'VACANTE'; }

            const hasActiveSLA = activeSlaMap.has(shift.objectiveId);
            // isCustomPost: puesto custom (no 24h) → se auto-cierra al fin del turno sin retención
            const slaRowForPos = filteredSLA.find((sv: any) => sv.objectiveId === shift.objectiveId);
            const posRowForPos = slaRowForPos?.positions?.find((p: any) => normPosName(p.name) === normPosName(rawPos));
            const _posCV = String(posRowForPos?.coverageType || '').toLowerCase();
            const isCustomPost = !!_posCV && _posCV !== '24hs' && _posCV !== '24' && _posCV !== '24h';
            const isAbsent = !!shift.isAbsent;
            // isPresent solo si el turno arranca dentro de los próximos 60 min O ya inició
            // Evita el bug de turnos con isPresent=true que en realidad no empiezan en horas
            const isEarlyStartShift = shift.isEarlyStart === true || shift.isReten === true
                || shift.origin === 'RETEN' || shift.origin === 'OPERATIONS_COVERAGE';
            const shiftStartMs = shift.shiftDateObj ? shift.shiftDateObj.getTime() : 0;
            // withinWindow: extendido a 4h para no ocultar guardias que marcan entrada anticipada.
            // Antes era 60 min y causaba que guardias presentes "desaparecieran" al refrescar.
            // Solo oculta isPresent=true si el turno empieza en más de 4h (claramente dato incorrecto).
            const withinWindow = !shiftStartMs || isEarlyStartShift
                || (currentTime.getTime() + 4 * 60 * 60 * 1000) >= shiftStartMs;
            const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent && withinWindow;
            const isCompleted = !!shift.isCompleted;
            
            const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
            const isResolvedByOps = shift.origin === 'OPERATIONS_COVERAGE' || shift.resolvedBy === 'OPERACIONES';
            // countsForCoverage se calcula después de isPotentialAbsence (línea ~332)
            // para excluir guardias que no llegaron aunque isAbsent=false en Firestore

            const isUnassigned = !isValidEmployee;
            const shiftCode = String(shift.code || shift.type || '').toUpperCase();
            // RFZ publicado sin guardia = refuerzo por ausencia pendiente de asignar en Planificación
            const isRfzVacante = shiftCode === 'RFZ' && isUnassigned;
            const isTuraVacante = shiftCode === 'TURA' && isUnassigned && !parentEmpleadoId;
            if (isRfzVacante) finalEmpName = 'VACANTE: RFZ';
            if (isTuraVacante) {
                finalEmpName = shift.parentEmpleadoName
                    ? `TURA · ${shift.parentEmpleadoName}`
                    : 'VACANTE: TURA';
            }
            // isOperationalVacancy: usado para la generación de vacantes virtuales y deduplicación.
            // Para el DISPLAY (contador OBJ, stats, tab VACANTES) se usa isUnassigned directamente
            // para incluir también las devueltas — ambas representan puestos sin cobertura real.
            const isOperationalVacancy = isUnassigned && !isReportedToPlanning;
            const isFranco = !!shift.isFranco || shift.objectiveName === 'FRANCO';
            
            const isSinCobertura = !!shift.isSinCobertura;
            // Descartar docs reales vacantes no-devueltos EXCEPTO autosinc_ SIN COBERTURA, RFZ y TURA (2º tramo cortado)
            if (isUnassigned && !isReportedToPlanning && !isSinCobertura && !isRfzVacante && !isTuraVacante) return null;

            const turaExt = parentTuraExt.get(shift.id);
            const effectiveEndDateObj = (turaExt?.endDateObj instanceof Date ? turaExt.endDateObj : shift.endDateObj) as Date | undefined;

            const isEarlyStartScheduled = !!shift.isEarlyStart;
            const isPlannedSplitSegment = !!shift.coveragePackageId && (shift.coverageSegmentRole === 'EXTENSION' || shift.coverageSegmentRole === 'EARLY_START');
            const isPlannedLiberationRet = String(shift.code || '').toUpperCase() === 'RET'
                && (shift.coverageSegmentRole === 'LIBERATED' || !!shift.liberationReason);
            const plannedOperativelyCovered = !!shift.operacionallyCovered
                || (shift.coverageStatus === 'COVERED' && (shift.coverageSegmentRole === 'TARGET' || isAbsent))
                || (!!shift.coveredBy && shift.coverageStatus === 'COVERED' && (isAbsent || shift.coverageSegmentRole === 'TARGET'));
            const isEarlyStart = isEarlyStartScheduled && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco;
            const isConvocado = !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco &&
                (isEarlyStart || isPlannedLiberationRet || shift.origin === 'RETEN' || !!shift.isReten || shift.origin === 'OPERATIONS_COVERAGE');
            const extSegStart = (shift.coverageSegmentRole === 'EXTENSION' && shift.segmentFromTime)
                ? createDateFromTime(shift.segmentFromTime, shift.shiftDateObj)
                : null;
            const isPlannedExtensionImminent = !!shift.isExtended && shift.coverageSegmentRole === 'EXTENSION'
                && extSegStart && ((extSegStart.getTime() - currentTime.getTime()) / 60000) <= 15;

            let minutesUntilStart = (shift.shiftDateObj.getTime() - currentTime.getTime()) / 60000;
            // CONVOCADO: solo es accionable (PRIORIDAD) cuando está a ≤15 min o ya inició.
            // Si falta más tiempo, va a PLAN como cualquier turno futuro.
            const isAwaitingCoverageCheckIn = isConvocado && minutesUntilStart <= 15;
            if (isAwaitingCoverageCheckIn) minutesUntilStart = Math.min(minutesUntilStart, 0);
            let retentionMinutes = 0;
            // isRetention: por tiempo (pasó el horario) O por campo Firestore (retenido manualmente/automáticamente)
            const isRetentionByTime  = isPresent && !isCompleted && effectiveEndDateObj && currentTime > effectiveEndDateObj;
            // isRetentionByField: solo mostrar RECARGO si el turno ya terminó O si el operador
            // lo retuvo manualmente Y el turno ya pasó. Si el turno aún está vigente, el badge
            // se mostrará como "ATENCIÓN" pero no como retención activa hasta que pase el endTime.
            const shiftEnded = effectiveEndDateObj ? currentTime > effectiveEndDateObj : false;
            const isRetentionByField = isPresent && !isCompleted && shift.isRetention === true && shiftEnded;
            const isPendingRetention = isPresent && !isCompleted && shift.isRetention === true && !shiftEnded;
            const isRetention = isRetentionByTime || isRetentionByField;
            if (isRetentionByTime && effectiveEndDateObj) {
                retentionMinutes = Math.floor((currentTime.getTime() - effectiveEndDateObj.getTime()) / 60000);
            } else if (isRetentionByField && shift.autoRetentionAt?.seconds) {
                retentionMinutes = Math.floor((currentTime.getTime() - shift.autoRetentionAt.seconds * 1000) / 60000);
            }
            // totalMinutesWorked: para ordenar por FIFO quién lleva más tiempo en el puesto
            const checkInMs = shift.realStartTime?.seconds
                ? shift.realStartTime.seconds * 1000
                : shift.checkInTime?.seconds
                    ? shift.checkInTime.seconds * 1000
                    : (shift.shiftDateObj?.getTime?.() ?? 0);
            const totalMinutesWorked = checkInMs > 0 ? Math.floor((currentTime.getTime() - checkInMs) / 60000) : 0;
            const activeStartTime: Date | null = isPresent
                ? (shift.realStartTime?.seconds ? new Date(shift.realStartTime.seconds * 1000) : shift.shiftDateObj)
                : null;
            
            // ── Novedad RRHH: turno marcado por replicarAusenciaEnPlanificador ─────
            // absenceCreatedAt es ISO string guardado en el turno original al momento de
            // cargar la novedad en RRHH. Calculamos la anticipación respecto al inicio del turno.
            const hasRRHHNovedad = !!shift.hasNovedad && !!shift.absenceId && !shift.isFranco && shift.type !== 'NOVEDAD';
            const rrhhAnticipacionMinutes: number | null = (() => {
                if (!hasRRHHNovedad || !shift.absenceCreatedAt || !shift.shiftDateObj) return null;
                const createdAt = new Date(shift.absenceCreatedAt).getTime();
                return Math.round((shift.shiftDateObj.getTime() - createdAt) / 60000);
            })();
            // ≥720 min (12hs) → Planning puede actuar; <720 → Operaciones debe resolver
            const isRRHHPlanned = hasRRHHNovedad && rrhhAnticipacionMinutes !== null && rrhhAnticipacionMinutes >= 720;
            const isRRHHUrgent  = hasRRHHNovedad && rrhhAnticipacionMinutes !== null && rrhhAnticipacionMinutes < 720;

            const isImminent = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && !hasRRHHNovedad && minutesUntilStart <= 15 && minutesUntilStart > -5;
            const isFuture = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && !hasRRHHNovedad && minutesUntilStart > 15;
            const minutesPastStart = -minutesUntilStart;
            // Guardia tardanza: ventana T+5 → T+60 (sin novedad RRHH)
            const isLateNotified = !!(shift.lateArrivalAt) && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && !hasRRHHNovedad && minutesPastStart > 5 && minutesPastStart <= 60;
            const isLateUnnotified = !shift.lateArrivalAt && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && !hasRRHHNovedad && minutesPastStart > 5 && minutesPastStart <= 60;
            const minutesRemainingLate = isLateNotified ? Math.max(0, Math.round(60 - minutesPastStart)) : null;
            // Potencial ausencia: T+60 sin confirmar presencia (fallback administrativo)
            const isPotentialAbsence = !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && !hasRRHHNovedad && minutesPastStart > 60;

            // Un ausente (confirmado o potencial) NO cubre el puesto — el slot queda descubierto y genera vacante
            // ⚠️ DEBE ir después de isPotentialAbsence para poder usarlo en la condición
            // isReportedToPlanning solo cuenta como cobertura cuando el turno es VACANTE NO-ASIGNADO reportado
            // MANUALMENTE por el operador (no si fue auto-notificación del sistema).
            // Los turnos origin==='SLA_VIRTUAL' son solo notificaciones hacia planificación:
            // el puesto sigue descubierto y NO cuentan como cobertura real.
            const isAutoNotification = shift.origin === 'SLA_VIRTUAL';
            // isSinCobertura NO cuenta como cobertura: la vacante debe seguir visible en
            // el tab VACANTES y en el PDF. Solo suprimimos el duplicado virtual en el dedup.
            const countsForCoverage = !isAutoNotification && (
                (isValidEmployee && !isAbsent && !isPotentialAbsence && !hasRRHHNovedad) ||
                (isReportedToPlanning && !isValidEmployee) ||
                (isPlannedSplitSegment && !isAbsent && !isPotentialAbsence)
            );

            const phone = empPhoneMap.get(effectiveEmployeeId || shift.employeeId) || shift.phone || shift.celular || '';

            const isTuraCutSegment = shiftCode === 'TURA' && !suppressedTuraIds.has(shift.id)
                && (!!shift.parentShiftId || !!parentEmpleadoId);

            return {
                ...shift, employeeName: finalEmpName, clientName: finalClient, objectiveName: finalObj, positionName: rawPos,
                phone,
                employeeId: effectiveEmployeeId || shift.employeeId,
                isValidEmployee, isUnassigned, isPresent, isCompleted, isAbsent, isPotentialAbsence,
                isLateNotified, isLateUnnotified, minutesRemainingLate,
                isReportedToPlanning, isOperationalVacancy, isResolvedByOps, isRetention, isPendingRetention, isFranco, isImminent, isFuture,
                isEarlyStart, isAwaitingCoverageCheckIn, isConvocado,
                isPlannedSplitSegment, isPlannedLiberationRet, isPlannedExtensionImminent, plannedOperativelyCovered,
                hasRRHHNovedad, isRRHHPlanned, isRRHHUrgent, rrhhAnticipacionMinutes,
                minutesUntilStart, minutesPastStart, retentionMinutes, totalMinutesWorked, activeStartTime, hasActiveSLA, isCustomPost,
                duration: getDuration(shift.shiftDateObj, effectiveEndDateObj),
                endDateObj: effectiveEndDateObj || shift.endDateObj,
                countsForCoverage, isRetentionByField, isSinCobertura,
                isRfzVacante, isTuraVacante, isTuraCutSegment,
                turaRequiresSeparateCheckIn: isTuraCutSegment,
                isRefuerzoCliente: shiftCode === 'RFZ' || shiftCode === 'TURA',
                ...(turaExt ? {
                    linkedTuraId: turaExt.turaId,
                    turaContiguous: true,
                    turaImputationPos: turaExt.tura.positionName,
                    turaExtensionRange: combinedContiguousRangeLabel(shift, turaExt.tura),
                } : {}),
                vacancyOrigin: isRfzVacante ? 'ABSENCE' : shift.vacancyOrigin,
                operacionallyCovered: plannedOperativelyCovered || !!shift.operacionallyCovered,
            };
        }).filter(Boolean);

        const virtualVacancies: any[] = [];
        const dayCode = getDayCode(now);

        filteredSLA.forEach(sla => {
            const objInfo = objMap.get(sla.objectiveId);
            if (!objInfo || !sla.positions) return;

            // Respetar rango de fechas del servicio: no generar vacantes antes de startDate ni después de endDate
            if (sla.startDate) {
                const serviceStart = new Date(sla.startDate + 'T00:00:00');
                if (now < serviceStart) return;
            }
            if (sla.endDate) {
                const serviceEnd = new Date(sla.endDate + 'T23:59:59');
                if (now > serviceEnd) return;
            }

            // Vacantes "virtuales" = huecos del SLA vs turnos reales. Si no hay ningún documento
            // en `turnos` para este objetivo hoy (p. ej. base vaciada o aún sin planificar),
            // no generar tarjetas fantasma: el contador de vacantes reflejaba solo SLA activo.
            const hasRawShiftTodayForObjective = mergedRawShifts.some((s: any) => {
                if (!s.objectiveId || s.objectiveId !== sla.objectiveId) return false;
                const d = s.shiftDateObj || getSafeDate(s.startTime);
                return d && isSameDay(d, now);
            });
            if (!hasRawShiftTodayForObjective) return;

            const objShifts = realShifts.filter(s => {
                if (!isSameDay(s.shiftDateObj, now)) return false;
                if (s.objectiveId !== sla.objectiveId) return false;
                if (s.isFranco) return false;
                return true;
            });

            sla.positions.forEach((pos: any) => {
                if (pos.activeDays && Array.isArray(pos.activeDays) && pos.activeDays.length > 0) {
                    if (!pos.activeDays.includes(dayCode)) return;
                }

                const allowedShifts = pos.allowedShiftTypes || [];
                const targetPosName = normalizePosMatch(pos.name);
                // TODOS los turnos del puesto (incluye ausentes) — para saber si "opera hoy"
                const allPosShifts = objShifts.filter((s: any) => {
                    const sPos = normalizePosMatch(s.positionName);
                    return sPos === targetPosName || (sPos === 'general' && targetPosName === 'guardia');
                });
                // Solo los que cuentan como cobertura real (excluye ausentes)
                const posShifts = allPosShifts.filter((s: any) => s.countsForCoverage);

                // Detectar ciclo 12h usando TODOS los turnos (no solo activos)
                // Si todos están ausentes, posShifts=[] y no detectaríamos el ciclo 12h
                const has12hShifts = allPosShifts.some((s: any) => s.duration > 10);
                let relevantDefinitions = allowedShifts;
                // Si hay turnos definidos, los usamos
                // Si no, fallback a gap
                
                if (has12hShifts && allowedShifts.length > 0) {
                    relevantDefinitions = allowedShifts.filter((d:any) => (d.hours || 8) > 10);
                } else if (allowedShifts.length > 0) {
                    // Si no hay 12hs activas: incluir slots de hasta 11h (cubre 8h, 9h, 10h)
                    relevantDefinitions = allowedShifts.filter((d:any) => (d.hours || 8) < 12);
                }

                // 🛑 UNIFICACIÓN V124:
                // Si 'relevantDefinitions' TIENE DATOS, usamos lógica de SLOT (Checklist) incluso para 24HS.
                // Esto evita el problema de los huecos partidos.
                
                if (relevantDefinitions.length > 0) {
                    // Gap 5: origen de la vacante por slot
                    const slotVacancyOrigin = allPosShifts.some((s: any) => s.hasRRHHNovedad)
                        ? 'RRHH_NOVEDAD'
                        : allPosShifts.some((s: any) => s.isAbsent || s.isPotentialAbsence)
                            ? 'ABSENCE'
                            : 'NO_PLANNING';
                    relevantDefinitions.forEach((slot: any) => {
                        // Respetar dias habilitados del turno (ej: RONDIN solo L-V)
                        if (slot.days && Array.isArray(slot.days) && slot.days.length > 0) {
                            if (!slot.days.includes(dayCode)) return;
                        }
                        const start = createDateFromTime(slot.startTime, now);
                        let end = createDateFromTime(slot.endTime, now);

                        if (start && end) {
                            if (end <= start) end = new Date(end.getTime() + 86400000);

                            // Contar cuántos turnos realmente cubren este slot (≥90% overlap)
                            const coveredCount = posShifts.filter((s: any) => shiftCoversVacancySlot(s, start, end, pos.name)).length;
                            // Capacidad requerida según SLA (quantity del puesto)
                            const requiredCount = pos.quantity || 1;
                            const missing = Math.max(0, requiredCount - coveredCount);

                            // Generar una tarjeta de vacante por cada puesto faltante
                            for (let i = 0; i < missing; i++) {
                                virtualVacancies.push({
                                    id: `V124_${sla.objectiveId}_${pos.name}_${slot.code}_${i}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    vacancyOrigin: slotVacancyOrigin,
                                    vacancyBand: (slot.name || slot.code).toUpperCase(),
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId,
                                    positionName: pos.name,
                                    employeeName: 'VACANTE',
                                    code: slot.code,
                                    shiftDateObj: start, endDateObj: end,
                                    minutesUntilStart: 0, isValidEmployee: false
                                });
                            }
                        }
                    });
                } 
                // SOLO si no hay definiciones de turnos, usamos Gaps (Fallback para objetivos legacy)
                // ⚠️  Discriminamos según tipo de turno:
                //   - 24h (3×8h o 2×12h): findTimeGaps sobre la jornada completa
                //   - Custom (franjas parciales, ej. Rondín 08-18): verificar turno por turno
                else {
                    // Turnos de franco del puesto: también necesitan reemplazo.
                    // objShifts excluye franco, los buscamos directamente en realShifts.
                    const posFrancoShifts = realShifts.filter((s: any) => {
                        if (!isSameDay(s.shiftDateObj, now)) return false;
                        if (s.objectiveId !== sla.objectiveId) return false;
                        if (!s.isFranco) return false;
                        const sPos = normalizePosMatch(s.positionName);
                        return sPos === targetPosName || (sPos === 'general' && targetPosName === 'guardia');
                    });

                    // Sin turnos NI francos → el puesto realmente no opera hoy
                    if (allPosShifts.length === 0 && posFrancoShifts.length === 0) return;

                    const guardQty = pos.quantity || 1;

                    // ─── MODO 24H: usa coverageType del SLA (Gap 4) ───────────────────────
                    if (pos.coverageType === '24hs') {
                        // Detectar brechas en la jornada completa (comportamiento original correcto)
                        const coveringShifts = posShifts.filter((s: any) => s.countsForCoverage);
                        const coveredHours = coveringShifts.reduce((acc: number, s: any) => acc + s.duration, 0);
                        const targetHours = guardQty * 24;

                        if (coveredHours < targetHours) {
                            const gaps = findTimeGaps(posShifts, now);
                            gaps.forEach(gap => {
                                const h = gap.start.getHours();
                                let bestName = "COBERTURA";
                                if (h>=6 && h<14) bestName = "MAÑANA"; else if (h>=14 && h<22) bestName = "TARDE"; else bestName = "NOCHE";

                                const gap24Origin = allPosShifts.some((s: any) => s.hasRRHHNovedad) ? 'RRHH_NOVEDAD'
                                    : allPosShifts.some((s: any) => s.isAbsent || s.isPotentialAbsence) ? 'ABSENCE' : 'NO_PLANNING';
                                virtualVacancies.push({
                                    id: `V124_GAP_${sla.objectiveId}_${pos.name}_${gap.start.getTime()}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    vacancyOrigin: gap24Origin,
                                    vacancyBand: bestName,
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                    employeeName: 'VACANTE',
                                    shiftDateObj: gap.start, endDateObj: gap.end,
                                    minutesUntilStart: 0, isValidEmployee: false
                                });
                            });
                        }
                    }
                    // ─── MODO CUSTOM (franjas parciales, ej. Rondín 08-18) ────────────────
                    else {
                        // Generar vacante por déficit de cobertura en cada slot:
                        //   • Agrupar ausentes por slot temporal (mismo start+end)
                        //   • Para cada slot: max(0, guardQty - coveredOnSlot) vacantes
                        //     → respeta quantity del puesto (ej: 9 activos + 8 ausentes
                        //       con guardQty=17 → 8 vacantes; con guardQty=9 → 0 vacantes)
                        //   • Para no-asignados (isUnassigned): siempre generan vacante
                        const unassignedShifts = allPosShifts.filter((s: any) => s.isUnassigned);

                        // Agrupar ausentes Y francos por slot (mismo start+end) para calcular déficit real
                        // Franco = el puesto opera pero la persona descansa → necesita reemplazo
                        const absentSlotMap = new Map<string, any>();
                        [...allPosShifts, ...posFrancoShifts]
                            .filter((s: any) => (s.isAbsent || s.isPotentialAbsence || s.isFranco) && !s.isCompleted)
                            .forEach((s: any) => {
                                const key = `${s.shiftDateObj?.getTime?.() ?? 0}_${s.endDateObj?.getTime?.() ?? 0}`;
                                if (!absentSlotMap.has(key)) absentSlotMap.set(key, s);
                            });

                        // Para cada slot con ausentes: generar tantas vacantes como el déficit
                        absentSlotMap.forEach((refShift: any) => {
                            if (refShift.plannedOperativelyCovered || refShift.coverageStatus === 'COVERED') return;
                            const coveredOnSlot = posShifts.filter((cover: any) =>
                                shiftCoversVacancySlot(cover, refShift.shiftDateObj, refShift.endDateObj, pos.name)
                            ).length;
                            const deficit = Math.max(0, guardQty - coveredOnSlot);
                            const pkgStatus = refShift.coveragePackageId
                                ? assessPlannedPackageStatus(allPosShifts.filter((s: any) => s.coveragePackageId === refShift.coveragePackageId))
                                : 'NONE';
                            if (pkgStatus === 'COVERED') return;
                            for (let i = 0; i < deficit; i++) {
                                const startMs = refShift.shiftDateObj instanceof Date ? refShift.shiftDateObj.getTime() : Date.now();
                                const shiftId = refShift.id || `${startMs}`;
                                const custOrigin = refShift.hasRRHHNovedad ? 'RRHH_NOVEDAD' : 'ABSENCE';
                                const isPartial = pkgStatus === 'PARTIAL' || refShift.coverageStatus === 'PARTIAL';
                                virtualVacancies.push({
                                    id: `V124_CUST_${sla.objectiveId}_${pos.name}_${shiftId}_${i}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    isPartialPlannedCoverage: isPartial,
                                    vacancyOrigin: custOrigin,
                                    vacancyBand: (pos.name || 'PUESTO').toUpperCase(),
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                    employeeName: 'VACANTE',
                                    shiftDateObj: refShift.shiftDateObj, endDateObj: refShift.endDateObj,
                                    minutesUntilStart: 0, isValidEmployee: false,
                                    relatedCoveragePackageId: refShift.coveragePackageId || null,
                                });
                            }
                        });

                        // No-asignados: siempre generan vacante independientemente del quantity
                        unassignedShifts.forEach((shift: any) => {
                            const startMs = shift.shiftDateObj instanceof Date ? shift.shiftDateObj.getTime() : Date.now();
                            const shiftId = shift.id || `${startMs}`;
                            virtualVacancies.push({
                                id: `V124_CUST_${sla.objectiveId}_${pos.name}_${shiftId}`,
                                isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                vacancyOrigin: 'NO_PLANNING',
                                vacancyBand: (pos.name || 'PUESTO').toUpperCase(),
                                clientName: objInfo.clientName, clientId: objInfo.clientId,
                                objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                employeeName: 'VACANTE',
                                shiftDateObj: shift.shiftDateObj, endDateObj: shift.endDateObj,
                                minutesUntilStart: 0, isValidEmployee: false
                            });
                        });
                    }
                }
            });
        });

        // ── Deduplicar realShifts por id (evita que un doc duplicado en Firestore se muestre dos veces)
        const seenIds = new Set<string>();
        const dedupedRealShifts = realShifts.filter(s => {
            if (seenIds.has(s.id)) return false;
            seenIds.add(s.id);
            return true;
        });

        // ── Suprimir DEVUELTO/SLA_VIRTUAL del display cuando ya no son accionables:
        //    a) el slot ya terminó (vacante pasada)
        //    b) hay guardias plan/presentes suficientes para cubrir el slot
        //       → planning ya asignó alguien; la vacante está resuelta aunque el guardia no llegó
        const suppressedDevuelto = new Set<string>();
        dedupedRealShifts.forEach(s => {
            if (!s.isUnassigned || !s.isReportedToPlanning || !s.shiftDateObj || !s.endDateObj) return;
            // a) Slot ya terminó
            if (s.endDateObj.getTime() < now.getTime()) {
                suppressedDevuelto.add(s.id);
                return;
            }
            // b) Cobertura (plan + presentes) suficiente
            const cap = getPositionCapacity(filteredSLA, s.objectiveId, s.positionName);
            if (cap <= 0) return;
            const coveringCount = dedupedRealShifts.filter(cover =>
                !cover.isUnassigned && !cover.isAbsent && !cover.isPotentialAbsence && !cover.isCompleted &&
                !cover.isFranco &&
                cover.objectiveId === s.objectiveId &&
                shiftCoversVacancySlot(cover, s.shiftDateObj, s.endDateObj, s.positionName)
            ).length;
            if (coveringCount >= cap) suppressedDevuelto.add(s.id);
        });
        const visibleRealShifts = dedupedRealShifts.filter(s => !suppressedDevuelto.has(s.id));

        // ── Suprimir vacantes virtuales solo si están CUBIERTAS (no suprimir por ausencias)
        // Un ausente sigue generando una vacante — la posición necesita cobertura
        const filteredVirtualVacancies = virtualVacancies.filter(v => {
            if (!v.shiftDateObj || !v.endDateObj) return true;
            // Auto-expirar: slot de un día anterior que ya terminó → no mostrar
            const vacancyIsToday = isSameDay(v.shiftDateObj, now);
            if (!vacancyIsToday && v.endDateObj.getTime() < now.getTime()) return false;
            // normalizePosMatch para que "Puesto Rondín" === "Rondín" (sin prefijo ni acentos)
            const sameSlot = (s: any) =>
                s.objectiveId === v.objectiveId &&
                shiftMatchesVacancyPosition(s, v.positionName) &&
                shiftCoversVacancySlot(s, v.shiftDateObj, v.endDateObj, v.positionName);
            // Suprimir si ya hay un DEVUELTO real para este slot (el doc ya representa la vacante)
            // Solo suprimir si el doc tiene startTime cercano al slot virtual (±2h) Y aún no expiró,
            // para evitar que docs expirados o con timestamps erróneos supriman slots correctos
            if (dedupedRealShifts.some(s => s.isUnassigned && s.isReportedToPlanning &&
                s.endDateObj && s.endDateObj.getTime() > now.getTime() &&
                Math.abs((s.shiftDateObj?.getTime() || 0) - (v.shiftDateObj?.getTime() || 0)) < 7200000 &&
                sameSlot(s))) return false;
            // Suprimir si ya existe el doc autosinc_ SIN COBERTURA para este slot
            // El doc real reemplaza la vacante virtual — queda visible en VACANTES con badge SIN COB.
            if (dedupedRealShifts.some(s => s.isSinCobertura && sameSlot(s))) return false;
            if (dedupedRealShifts.some(s => s.isOperationalVacancy && sameSlot(s))) return false;
            // Suprimir si hay guardias plan O presentes suficientes para el slot
            // (mejora: un guardia en PLAN ya resuelve la vacante aunque no haya hecho check-in)
            const cap = getPositionCapacity(filteredSLA, v.objectiveId, v.positionName);
            const coveringCount = dedupedRealShifts.filter((cover: any) =>
                !cover.isUnassigned && !cover.isAbsent && !cover.isPotentialAbsence && !cover.isCompleted &&
                !cover.isFranco &&
                cover.objectiveId === v.objectiveId &&
                shiftCoversVacancySlot(cover, v.shiftDateObj, v.endDateObj, v.positionName)
            ).length;
            if (coveringCount >= cap) return false;
            return true;
        });

        return [...visibleRealShifts, ...filteredVirtualVacancies].sort((a:any, b:any) => a.shiftDateObj - b.shiftDateObj);
    }, [mergedRawShifts, now, employees, objectives, servicesSLA, publishStatusMap]);

    const filteredObjectives = useMemo(() => {
        let list = selectedClientId ? objectives.filter((o: any) => o.clientId === selectedClientId) : objectives;
        const q = foldSearch(filterText);
        if (!q) return list;
        const idsFromShifts = new Set(
            processedData
                .filter((s: any) =>
                    foldSearch(s.objectiveName).includes(q) ||
                    foldSearch(s.positionName).includes(q) ||
                    foldSearch(s.employeeName).includes(q)
                )
                .flatMap((s: any) => [String(s.objectiveId || ''), String(s.objectiveName || '')])
        );
        return list.filter((o: any) => {
            const id = String(o.id || o.objectiveId || '');
            return foldSearch(o.name).includes(q) ||
                foldSearch(o.nombre).includes(q) ||
                foldSearch(o.objectiveName).includes(q) ||
                foldSearch(o.address).includes(q) ||
                foldSearch(o.direccion).includes(q) ||
                idsFromShifts.has(id) ||
                idsFromShifts.has(String(o.name || ''));
        });
    }, [objectives, selectedClientId, filterText, processedData]);

    // ... Resto del hook igual ...
    const listData = useMemo(() => {
        let list = processedData;
        if (selectedClientId) list = list.filter((s:any) => s.clientId === selectedClientId);
        if (filterText) {
            const q = foldSearch(filterText);
            list = list.filter((s: any) =>
                foldSearch(s.employeeName).includes(q) ||
                foldSearch(s.clientName).includes(q) ||
                foldSearch(s.objectiveName).includes(q) ||
                foldSearch(s.positionName).includes(q)
            );
        }
        // Base: solo turnos de hoy — OR turno activo/retenido que arrancó en el nocturno de ayer
        const hoy = list.filter((s:any) => {
            if (s.isCompleted && !s.isRetention) return false;
            if (s.isVirtual && s.endDateObj && !isSameDay(s.shiftDateObj, now) && s.endDateObj.getTime() < now.getTime()) return false;
            return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
        });
        switch (viewTab) {
            case 'TODOS':      return hoy.filter((s:any) => !s.isFranco);
            case 'PRIORIDAD':  return hoy.filter((s:any) => (s.isImminent || s.isRetention || s.isPendingRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn || s.isPlannedExtensionImminent || s.isPlannedLiberationRet || s.isRRHHUrgent) && !s.isFranco);
            case 'NO_LLEGO':   return hoy.filter((s:any) => (s.isLateNotified || s.isLateUnnotified || s.isPotentialAbsence) && !s.isFranco && !s.isAbsent && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn && !s.hasRRHHNovedad);
            case 'PLAN':       return hoy.filter((s:any) => (s.isFuture || s.isRRHHPlanned) && !s.isFranco && !s.isUnassigned && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn && !s.isPlannedLiberationRet);
            case 'ACTIVOS':    return hoy.filter((s:any) => s.isPresent && !s.isCompleted && !s.isRetention && !s.isPendingRetention);
            case 'RETENIDOS':  return hoy.filter((s:any) => s.isRetention); // isPendingRetention va en PRIORIDAD, no aquí
            case 'VACANTES':   return hoy.filter((s:any) => s.isUnassigned); // incluye devueltas — un puesto sin guardia presente ES una vacante
            case 'AUSENTES':   return hoy.filter((s:any) => s.isAbsent || s.isPotentialAbsence);
            case 'FRANCOS':    return hoy.filter((s:any) => s.isFranco);
            default:           return hoy;
        }
    }, [processedData, viewTab, filterText, selectedClientId, now]);
    const stats = useMemo(() => { const hoy = processedData.filter(s => {
            if (s.isCompleted && !s.isRetention) return false;
            if (s.isVirtual && s.endDateObj && !isSameDay(s.shiftDateObj, now) && s.endDateObj.getTime() < now.getTime()) return false;
            return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
        }); return { prioridad: hoy.filter(s => (s.isImminent || s.isRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn || s.isPlannedExtensionImminent || s.isPlannedLiberationRet || s.isRRHHUrgent) && !s.isFranco).length, no_llego: hoy.filter(s => (s.isLateNotified || s.isLateUnnotified || s.isPotentialAbsence) && !s.isFranco && !s.isAbsent && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn && !s.hasRRHHNovedad).length, plan: hoy.filter(s => (s.isFuture || s.isRRHHPlanned) && !s.isFranco && !s.isUnassigned && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn && !s.isPlannedLiberationRet).length, activos: hoy.filter(s => s.isPresent && !s.isCompleted).length, retenidos: hoy.filter(s => s.isRetention).length, vacantes: hoy.filter(s => s.isUnassigned).length, devueltas: hoy.filter(s => s.isUnassigned && s.isReportedToPlanning).length, ausentes: hoy.filter(s => s.isAbsent || s.isPotentialAbsence).length, francos: hoy.filter(s => s.isFranco).length, rrhh_urgente: hoy.filter(s => s.isRRHHUrgent && !s.isFranco).length, rrhh_planificado: hoy.filter(s => s.isRRHHPlanned && !s.isFranco).length, total: hoy.length }; }, [processedData, now]);
    const handleAction = async (action: string, shiftId: string, payload?: any) => {
        try {
            if (action === 'CHECKOUT') {
                const shift = processedData.find((s: any) => s.id === shiftId);
                await updateDocForEmpresa('turnos', shiftId, {
                    status: 'COMPLETED', isCompleted: true, isPresent: false,
                    realEndTime: serverTimestamp(), checkoutNote: payload || null,
                }, empresaId, migracionCompleta);
                // Bitácora
                const actor = getAuth().currentUser?.displayName || getAuth().currentUser?.email?.split('@')[0] || 'Operador';
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'CHECKOUT',
                    module: 'OPERACIONES',
                    actorName: actor,
                    timestamp: serverTimestamp(),
                    employeeId: shift?.employeeId,
                    employeeName: shift?.employeeName,
                    objectiveId: shift?.objectiveId,
                    objectiveName: shift?.objectiveName,
                    shiftId,
                    details: `${shift?.employeeName || 'Guardia'} finalizó turno en ${shift?.objectiveName || ''}${payload ? ` — ${payload}` : ''}.`,
                }, String(shift?.empresaId || empresaId || '').trim())).catch(() => {});
                // Auto-descartar novedades de retención/recargo del turno finalizado
                getDocs(query(
                    collection(db, 'novedades'),
                    where('shiftId', '==', shiftId),
                    where('status', '==', 'pending'),
                    limit(20)
                )).then(snap => {
                    if (snap.empty) return;
                    const AUTO_DISMISS_TYPES = ['RETENCION_LARGA', 'RECARGO_12H', 'RETENCION_DETECTADA'];
                    const toUpdate = snap.docs.filter(d => AUTO_DISMISS_TYPES.includes(d.data().type));
                    if (!toUpdate.length) return;
                    const batch = writeBatch(db);
                    toUpdate.forEach(d => batch.update(d.ref, {
                        status: 'ATENDIDA',
                        atendidaAt: serverTimestamp(),
                        atendidaPor: 'AUTO_CHECKOUT',
                    }));
                    batch.commit().catch(() => {});
                }).catch(() => {});
            }
        } catch (e: any) { toast.error('Error: ' + e.message); }
    };
    // Auto-gestión de vacantes virtuales:
    //   > 4h:  auto-devolver a planificación (crear turno real + novedad)
    //   < 4h y > 0: alerta PROTOCOLO para que el operador use CUBRIR
    //   ya iniciada: alerta PROTOCOLO escalada
    const alertedVacancyIds = useRef<Set<string>>(new Set());
    const autoAbsentedIds = useRef<Set<string>>(new Set());
    useEffect(() => {
        const virtualVacs = processedData.filter((s: any) => s.isVirtual && isSameDay(s.shiftDateObj, now));
        if (!virtualVacs.length) return;
        const nowMs = now.getTime();
        for (const v of virtualVacs) {
            const startMs = v.shiftDateObj?.getTime?.() ?? 0;
            if (!startMs) continue;
            const minutesUntil = (startMs - nowMs) / 60000;

            // ── PASO 1: auto-envío a planificación ──────────────────────────
            // Se dispara para TODAS las vacantes del día apenas son detectadas,
            // sin importar si el turno ya empezó. El dedup de Firestore evita duplicados.
            // Esto garantiza que planificación sea notificada aunque el operador abra
            // la app tarde o no haya estado abierta durante la ventana 1-4h.
            // Vacantes por AUSENCIA NO se auto-devuelven a planificacion:
            // ya habia un empleado planificado que fue ausente, planificacion ya lo sabe.
            // Auto-devolverlas genera estado DEVUELTA incorrecto en el mapa.
            const autoKey = `${v.id}_VACANTE_A_PLANIFICACION`;
            if (v.vacancyOrigin !== 'ABSENCE' && !alertedVacancyIds.current.has(autoKey)) {
                alertedVacancyIds.current.add(autoKey);
                getDocs(query(collection(db, 'novedades'), where('virtualVacancyId', '==', v.id), where('type', '==', 'VACANTE_A_PLANIFICACION'), limit(1)))
                    .then(async snap => {
                        if (!snap.empty) return; // ya fue procesada antes
                        const shiftEmpresaId = String(v.empresaId || empresaId || '').trim();
                        // ID determinístico: si dos PCs corren simultáneamente, setDoc con el mismo ID
                        // es idempotente — el segundo setDoc sobreescribe con los mismos datos,
                        // evitando duplicados en Firestore.
                        const safeId = v.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
                        const newRef = doc(db, 'turnos', `autodev_${safeId}`);
                        await setDoc(newRef, stampEmpresaId({
                            clientId: v.clientId, clientName: v.clientName,
                            objectiveId: v.objectiveId, objectiveName: v.objectiveName,
                            positionName: v.positionName,
                            employeeId: 'VACANTE', employeeName: 'VACANTE',
                            startTime: Timestamp.fromDate(v.shiftDateObj),
                            endTime: Timestamp.fromDate(v.endDateObj),
                            status: 'REPORTED_TO_PLANNING', isReported: true,
                            isReportedToPlanning: true, reportedBy: 'SYSTEM_AUTO',
                            reportedAt: serverTimestamp(), origin: 'SLA_VIRTUAL',
                            createdAt: serverTimestamp(),
                        }, shiftEmpresaId));
                        const cuando = minutesUntil > 0
                            ? `Faltan ${Math.round(minutesUntil)} min.`
                            : `Turno inició hace ${Math.round(Math.abs(minutesUntil))} min (sin cobertura).`;
                        // Novedad con ID determinístico para el mismo motivo
                        const novedadRef = doc(db, 'novedades', `autodev_nov_${safeId}`);
                        await setDoc(novedadRef, stampEmpresaId({
                            type: 'VACANTE_A_PLANIFICACION', status: 'ATENDIDA',
                            autoProcessed: true,
                            virtualVacancyId: v.id, shiftId: newRef.id,
                            objectiveId: v.objectiveId, objectiveName: v.objectiveName || '',
                            clientId: v.clientId || null, positionName: v.positionName || '',
                            description: `[AUTO] Vacante sin cubrir devuelta a Planificación: ${v.positionName} en ${v.objectiveName}. ${cuando}`,
                            minutesUntilStart: Math.round(minutesUntil),
                            createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                        }, shiftEmpresaId));
                    })
                    .catch(e => console.warn('[autoAlertVacante:plan]', e));
            }

            // ── PASO 3: T+120 → auto-declarar SIN COBERTURA ─────────────────
            // Si pasaron 2h desde el inicio del turno y sigue sin cobertura,
            // se crea un doc "autosinc_*" en turnos con isSinCobertura:true.
            // Ese doc cuenta como cobertura en el SLA (suprime la vacante virtual)
            // y deshabilita las acciones CUBRIR. Motivo: ausencia o falta de planificacion.
            if (minutesUntil <= -120) {
                const sinCobKey = `${v.id}_SIN_COBERTURA_FINAL`;
                if (!alertedVacancyIds.current.has(sinCobKey)) {
                    alertedVacancyIds.current.add(sinCobKey);
                    const sinCobSafeId = v.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
                    const sinCobRef = doc(db, 'turnos', `autosinc_${sinCobSafeId}`);
                    const sinCobEmpresaId = String(v.empresaId || empresaId || '').trim();
                    getDoc(sinCobRef).then(snap => {
                        if (snap.exists()) return; // ya declarado
                        const motivo = v.vacancyOrigin === 'ABSENCE'
                            ? `Ausencia sin cobertura — ${v.positionName} en ${v.objectiveName}`
                            : `Falta de planificacion — ${v.positionName} en ${v.objectiveName}`;
                        setDoc(sinCobRef, stampEmpresaId({
                            clientId: v.clientId, clientName: v.clientName,
                            objectiveId: v.objectiveId, objectiveName: v.objectiveName,
                            positionName: v.positionName,
                            employeeId: 'SIN_COBERTURA', employeeName: 'SIN COBERTURA',
                            startTime: Timestamp.fromDate(v.shiftDateObj),
                            endTime: Timestamp.fromDate(v.endDateObj),
                            status: 'SIN_COBERTURA', isSinCobertura: true,
                            vacancyOrigin: v.vacancyOrigin || 'NO_PLANNING',
                            motivo,
                            createdAt: serverTimestamp(),
                        }, sinCobEmpresaId))
                        .then(() => toast.info(`Sin cobertura: ${v.positionName} en ${v.objectiveName}`))
                        .catch(e => {
                            alertedVacancyIds.current.delete(sinCobKey);
                            console.warn('[autoSinCobertura]', e);
                        });
                    }).catch(() => alertedVacancyIds.current.delete(sinCobKey));
                }
                continue; // no generar alerta PROTOCOLO para vacantes ya vencidas
            }

            // ── PASO 2: alerta PROTOCOLO para el operador (solo ≤60 min) ────
            // Solo cuando el turno ya inició o está por iniciar (minutesUntil <= 0 = ya empezó).
            // Se crea UNA SOLA alerta con ID determinístico. Después de T+120 se auto-cierra.
            if (minutesUntil > 60) continue;
            const protKey = `${v.id}_VACANTE_PROTOCOLO_COBERTURA`;
            if (alertedVacancyIds.current.has(protKey)) continue;
            alertedVacancyIds.current.add(protKey); // marcar para no re-procesar en esta sesión

            const protSafeId = v.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
            const protRef = doc(db, 'novedades', `autodev_prot_${protSafeId}`);
            const shiftEmpresaId = String(v.empresaId || empresaId || '').trim();

            // Verificar si ya existe y fue ATENDIDA — no recrear (fix: setDoc con merge:true overwriteaba status)
            getDoc(protRef).then(snap => {
                if (snap.exists() && (snap.data()?.status === 'ATENDIDA' || snap.data()?.status === 'atendida')) {
                    return; // ya fue atendida, no sobreescribir
                }
                const desc = minutesUntil <= 0
                    ? `⚠️ PROTOCOLO: Puesto ${v.positionName} en ${v.objectiveName} sin cobertura. Turno inició hace ${Math.round(Math.abs(minutesUntil))} min. Requiere CUBRIR inmediato.`
                    : `⚠️ PROTOCOLO: Puesto ${v.positionName} en ${v.objectiveName} sin cubrir. Faltan ${Math.round(minutesUntil)} min. Cubrir manualmente.`;
                const shiftStart = v.shiftDateObj instanceof Date ? Timestamp.fromDate(v.shiftDateObj) : null;
                setDoc(protRef, stampEmpresaId({
                    type: 'VACANTE_PROTOCOLO_COBERTURA', status: 'PENDIENTE',
                    virtualVacancyId: v.id,
                    objectiveId: v.objectiveId, objectiveName: v.objectiveName || '',
                    clientId: v.clientId || null, positionName: v.positionName || '',
                    ...(shiftStart ? { shiftStart } : {}),
                    description: desc,
                    minutesUntilStart: Math.round(minutesUntil),
                    createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                }, shiftEmpresaId), { merge: false })
                    .catch(e => console.warn('[autoAlertVacante:prot]', e));
            }).catch(() => {
                // Si falla getDoc, no crear para evitar recrear novedades atendidas
                alertedVacancyIds.current.delete(protKey);
            });
        }

        // ── RETENCIÓN LARGA (>2h retenido) ──────────────────────────────
        const retainedShifts = processedData.filter((s: any) => s.isRetention && !s.isCompleted);
        for (const s of retainedShifts) {
            const endMs = s.endDateObj?.getTime?.() ?? 0;

            // ── PUESTO CUSTOM: cerrar inmediatamente al terminar (sin relevo ni espera) ──
            // Solo si NO hay retención manual del operador (manualRetentionType está seteado)
            const isOperatorRetention = s.isRetentionByField && !!s.manualRetentionType;
            if (s.isCustomPost && !isOperatorRetention) {
                const autoCustomKey = `${s.id}_AUTO_END_CUSTOM_POST`;
                if (!alertedVacancyIds.current.has(autoCustomKey)) {
                    alertedVacancyIds.current.add(autoCustomKey);
                    autoCloseShiftTx(s.id, {
                        status: 'COMPLETED', isCompleted: true, isPresent: false,
                        completedAt: serverTimestamp(), completedBy: 'Sistema',
                        completionReason: 'AUTO_SHIFT_END_CUSTOM',
                    }, empresaId).then(ok => {
                        if (ok) toast.success(`Turno finalizado: ${s.employeeName || 'Guardia'}`);
                    }).catch(e => {
                        alertedVacancyIds.current.delete(autoCustomKey);
                        console.warn('[autoEndCustomPost]', e);
                    });
                }
                continue;
            }

            // ── RELEVO CON TARDANZA REGISTRADA (lateETA): respetar hora acordada ──────────────
            // Si hay un turno de relevo en el mismo puesto con lateETA registrado,
            // el sistema NO auto-cierra al retenido hasta pasado el ETA + buffer.
            // A T-5min del ETA lanza alerta "relevo inminente — preparar handover".
            if (!isOperatorRetention) {
                const relevoShift = processedData.find((other: any) => {
                    if (other.id === s.id || other.isPresent || other.isCompleted) return false;
                    if (other.objectiveId !== s.objectiveId) return false;
                    if (normPosName(other.positionName) !== normPosName(s.positionName)) return false;
                    if (!other.lateETA) return false;
                    const otherStart = other.shiftDateObj?.getTime?.() ?? 0;
                    return otherStart >= endMs - 30 * 60000 && otherStart <= endMs + 4 * 60 * 60000;
                });

                if (relevoShift?.lateETA) {
                    // Parsear "HH:MM" al timestamp de hoy (usando la fecha del endDateObj del retenido)
                    const [etaH, etaM] = (relevoShift.lateETA as string).split(':').map(Number);
                    const base = s.endDateObj instanceof Date ? s.endDateObj : new Date(endMs);
                    const etaDate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), etaH, etaM, 0);
                    // Si la hora ETA es anterior a endTime (ej: turno nocturno cruzando medianoche) sumar 1 día
                    if (etaDate.getTime() < endMs - 30 * 60000) etaDate.setDate(etaDate.getDate() + 1);
                    const etaMs = etaDate.getTime();
                    const minsToEta = (etaMs - nowMs) / 60000;

                    // Alerta 5 min antes del ETA
                    const etaAlertKey = `${s.id}_ETA_RELEVO_ALERT`;
                    if (minsToEta <= 5 && minsToEta > -10 && !alertedVacancyIds.current.has(etaAlertKey)) {
                        alertedVacancyIds.current.add(etaAlertKey);
                        const etaLabel = `${String(etaH).padStart(2,'0')}:${String(etaM).padStart(2,'0')}`;
                        toast.warning(`⏰ Relevo inminente: ${relevoShift.employeeName || 'Guardia'} llega a las ${etaLabel} — relevar a ${s.employeeName}`, { duration: 30000 });
                        addDoc(collection(db, 'novedades'), stampEmpresaId({
                            type: 'RELEVO_INMINENTE',
                            shiftId: s.id,
                            relevoShiftId: relevoShift.id,
                            employeeId: s.employeeId,
                            employeeName: s.employeeName,
                            relevorName: relevoShift.employeeName || '',
                            objectiveId: s.objectiveId,
                            objectiveName: s.objectiveName || '',
                            clientId: s.clientId || null,
                            positionName: s.positionName || '',
                            eta: relevoShift.lateETA,
                            status: 'pending',
                            title: 'Relevo inminente',
                            description: `${relevoShift.employeeName || 'Relevo'} llega a las ${etaLabel}. Relevar a ${s.employeeName} en ${s.objectiveName || s.positionName}.`,
                            createdAt: serverTimestamp(),
                            source: 'SYSTEM_SCHEDULER',
                        }, String(s.empresaId || empresaId || '').trim())).catch(e => console.warn('[relevodInminente]', e));
                    }

                    // Mientras el ETA + 15 min no haya pasado: no auto-cerrar (esperar al relevo)
                    const etaGraceMs = etaMs + 15 * 60000;
                    if (nowMs < etaGraceMs) continue;
                    // Si ya pasó el grace y el relevo no llegó → cae al bloque shouldAutoClose normal
                }
            }

            // ── AUTO-FIN RETENCIÓN: puesto cubierto por turnos regulares ──
            const autoEndKey = `${s.id}_AUTO_END_RETENTION`;
            if (!alertedVacancyIds.current.has(autoEndKey)) {
                const capacity = getPositionCapacity(servicesSLA, s.objectiveId, s.positionName);
                const coverageCount = processedData.filter((other: any) =>
                    other.id !== s.id &&
                    other.isPresent && !other.isCompleted && !other.isRetention &&
                    other.objectiveId === s.objectiveId &&
                    normPosName(other.positionName) === normPosName(s.positionName)
                ).length;
                if (coverageCount >= capacity) {
                    alertedVacancyIds.current.add(autoEndKey);
                    autoCloseShiftTx(s.id, {
                        status: 'COMPLETED', isCompleted: true, isPresent: false,
                        completedAt: serverTimestamp(), completedBy: 'Sistema',
                        completionReason: 'AUTO_COVERAGE_COMPLETE',
                    }, empresaId).then(ok => {
                        if (ok) toast.success(`✅ Recarga finalizada: ${s.employeeName || 'Guardia'} — puesto cubierto`);
                    }).catch(e => {
                        alertedVacancyIds.current.delete(autoEndKey);
                        console.warn('[autoEndRetention]', e);
                    });
                    continue; // no generar alerta de retención larga para este turno
                }
            }

            if (!endMs) continue;
            const minutesOvertime = (nowMs - endMs) / 60000;

            // ── AUTO-FIN TURNO ─────────────────────────────────────────────────────
            // Dos caminos:
            // 1. isRetentionByField=false (solo por tiempo): esperar relevo 60 min → cerrar
            // 2. isRetentionByField=true por CF (autoRetentionAt existe): cerrar a los 60 min
            //    Si la retención fue puesta por operador (sin autoRetentionAt) → NO tocar
            const autoShiftEndKey = `${s.id}_AUTO_END_SHIFT`;
            // isCFRetention: retenido por la CF (autoRetentionAt existe → retentionMinutes > 0)
            // vs retención manual del operador (isRetentionByField pero retentionMinutes == 0)
            const isCFRetention = s.isRetentionByField && (s.retentionMinutes ?? 0) > 0;
            const shouldAutoClose =
                (!s.isRetentionByField && minutesOvertime >= 1 && minutesOvertime < 720) ||
                (isCFRetention && (s.retentionMinutes ?? 0) >= 60 && (s.retentionMinutes ?? 0) < 720);

            if (shouldAutoClose && !alertedVacancyIds.current.has(autoShiftEndKey)) {
                // Hay relevo planificado que todavía no llegó? (solo aplica en los primeros 60 min)
                const hasScheduledRelevo = !isCFRetention && minutesOvertime < 60 && processedData.some((other: any) => {
                    const otherStart = other.shiftDateObj?.getTime?.() ?? 0;
                    return (
                        other.id !== s.id &&
                        other.objectiveId === s.objectiveId &&
                        normPosName(other.positionName) === normPosName(s.positionName) &&
                        !other.isPresent && !other.isCompleted && !other.isUnassigned &&
                        !other.isAbsent && !other.isPotentialAbsence &&
                        otherStart >= endMs - 15 * 60000 &&
                        otherStart <= endMs + 90 * 60000
                    );
                });
                if (!hasScheduledRelevo) {
                    alertedVacancyIds.current.add(autoShiftEndKey);
                    autoCloseShiftTx(s.id, {
                        status: 'COMPLETED', isCompleted: true, isPresent: false,
                        completedAt: serverTimestamp(), completedBy: 'Sistema',
                        completionReason: isCFRetention ? 'AUTO_END_CF_RETENTION_TIMEOUT' : 'AUTO_SHIFT_END',
                    }, empresaId).then(ok => {
                        if (ok) toast.success(`Turno finalizado: ${s.employeeName || 'Guardia'}`);
                    }).catch(e => {
                        alertedVacancyIds.current.delete(autoShiftEndKey);
                        console.warn('[autoEndShift]', e);
                    });
                    continue;
                }
            }

            // ── AUTO-FIN POR TIEMPO EXCESIVO (>6h sin relevo) ─────────────────────
            // Cubre el caso en que nadie tuvo la plataforma abierta durante la noche
            // y los turnos del día anterior quedaron en isRetention sin auto-completarse.
            // Si el turno lleva >6h de retención, se cierra automáticamente.
            const autoTimeKey = `${s.id}_AUTO_END_OVERTIME`;
            if (minutesOvertime > 360 && !alertedVacancyIds.current.has(autoTimeKey)) {
                alertedVacancyIds.current.add(autoTimeKey);
                autoCloseShiftTx(s.id, {
                    status: 'COMPLETED', isCompleted: true, isPresent: false,
                    completedAt: serverTimestamp(), completedBy: 'Sistema',
                    completionReason: 'AUTO_OVERTIME_LIMIT',
                }, empresaId).then(ok => {
                    if (ok) toast.info(`ℹ️ Turno cerrado: ${s.employeeName || 'Guardia'} — retención > 6h`);
                }).catch(e => {
                    alertedVacancyIds.current.delete(autoTimeKey);
                    console.warn('[autoEndRetentionTime]', e);
                });
                continue;
            }

            if (minutesOvertime < 120) continue;
            const alertKey = `${s.id}_RETENCION_LARGA`;
            if (alertedVacancyIds.current.has(alertKey)) continue;
            alertedVacancyIds.current.add(alertKey);
            getDocs(query(collection(db, 'novedades'), where('shiftId', '==', s.id), where('type', '==', 'RETENCION_LARGA'), limit(1)))
                .then(snap => {
                    if (!snap.empty) return;
                    addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'RETENCION_LARGA',
                        shiftId: s.id,
                        employeeId: s.employeeId,
                        employeeName: s.employeeName,
                        objectiveId: s.objectiveId,
                        objectiveName: s.objectiveName,
                        positionName: s.positionName,
                        minutesOvertime,
                        status: 'pending',
                        title: 'Retención prolongada',
                        description: `${s.employeeName || 'Guardia'} lleva ${Math.round(minutesOvertime)} min retenido en ${s.objectiveName || 'su puesto'}.`,
                        createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                    }, String(s.empresaId || empresaId || '').trim()))
                    .catch(e => console.warn('[retentionLarga]', e));
                })
                .catch(e => console.warn('[retentionLarga:check]', e));
        }
    }, [processedData, empresaId]);

    // isStable: se activa una sola vez cuando processedData se estabiliza después de isReady.
    // NO vuelve a false — evita que updates de Firestore muestren la pantalla de carga repetidamente.
    useEffect(() => {
        if (!isReady) return;
        if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
        stableTimerRef.current = setTimeout(() => setIsStable(true), 700);
        return () => { if (stableTimerRef.current) clearTimeout(stableTimerRef.current); };
    }, [processedData, isReady]);

    // Fallback: fuerza isStable(true) si despues de 3 seg el monitor no se inicio.
    useEffect(() => {
        const t = setTimeout(() => setIsStable(true), 3000);
        return () => clearTimeout(t);
    }, []);

    return {
        processedData, publishStatusMap,
        recentLogs, isReady, isStable,
        filterText, setFilterText, isCompact, setIsCompact,
        handleAction,
        viewTab, setViewTab,
        stats, listData,
        uniqueClients, selectedClientId, setSelectedClientId,
        filteredObjectives,
        employees,
        servicesSLA,
        rawShifts: mergedRawShifts,
        objectives,
        now,
    };
}
            