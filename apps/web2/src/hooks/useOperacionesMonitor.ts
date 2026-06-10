
import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp, doc, serverTimestamp, addDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';
import { useEmpresa } from '@/context/EmpresaContext';
import { shouldScopeQueriesToEmpresa, belongsToEmpresaView, updateDocForEmpresa, stampEmpresaId, planificacionPublishLookupKey, parsePlanificacionEstadoDocId, empresaCollectionQuery } from '@/lib/multiempresa';

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

const normPosName = (n: unknown) => String(n ?? '').trim().toLowerCase();

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
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);

    useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

    // SUSCRIPCIONES
    useEffect(() => {
        const auth = getAuth();
        if (auth.currentUser) setOperatorInfo({ name: auth.currentUser.email?.split('@')[0] || 'Op', startTime: new Date() });
        const unsubs: Function[] = [];

        const mapEmps = (docs: any[]) => docs.map(d => ({ id: d.id, fullName: `${d.data().lastName} ${d.data().firstName}`, ...d.data() }));
        const empQ = empresaCollectionQuery('empleados', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(empQ, snap => {
            const docs = snap.docs.filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta));
            setEmployees(mapEmps(docs));
        }));

        const buildObjectives = (docs: any[]) => { const objs: any[] = []; docs.forEach(d => { const data = d.data(); if (data.objetivos) data.objetivos.forEach((o: any) => objs.push({ ...o, clientName: data.name, clientId: d.id })); else objs.push({ id: d.id, name: data.name, clientName: data.name, clientId: d.id }); }); return objs; };
        const clientsQ = empresaCollectionQuery('clients', empresaId, scopeEmpresa);
        unsubs.push(onSnapshot(clientsQ, snap => {
            const docs = snap.docs.filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta));
            setObjectives(buildObjectives(docs));
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
        unsubs.push(onSnapshot(query(collection(db, 'audit_logs'), where('timestamp', '>=', Timestamp.fromDate(startLog)), orderBy('timestamp', 'desc'), limit(50)), (snap) => {
            setRecentLogs(snap.docs
                .filter(d => belongsToEmpresaView(d.data(), empresaId, migracionCompleta))
                .map(d => ({ id: d.id, ...d.data(), formattedActor: d.data().actorName, time: getSafeDate(d.data().timestamp), fullDetail: d.data().details })));
        }));
        return () => { unsubs.forEach(u => u()); };
    }, [empresaId, migracionCompleta, scopeEmpresa]);

    useEffect(() => {
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
        });
        return () => unsub();
    }, [empresaId, migracionCompleta, scopeEmpresa]);

    const uniqueClients = useMemo(() => { const map = new Map(); objectives.forEach(obj => map.set(obj.clientId, obj.clientName)); return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [objectives]);
    const filteredObjectives = useMemo(() => selectedClientId ? objectives.filter(o => o.clientId === selectedClientId) : objectives, [objectives, selectedClientId]);

    const processedData = useMemo(() => {
        const currentTime = new Date(now.getTime());
        const yearMonth = `${now.getFullYear()}_${now.getMonth() + 1}`;
        const empMap = new Map(); employees.forEach(e => empMap.set(e.id, e.fullName));
        const empPhoneMap = new Map(); employees.forEach(e => empPhoneMap.set(e.id, e.phone || e.celular || ''));
        const objMap = new Map(); objectives.forEach(o => objMap.set(o.id, { clientName: o.clientName, name: o.name, clientId: o.clientId }));
        const activeSlaMap = new Set(servicesSLA.map(s => s.objectiveId));

        const realShifts = rawShifts.map(shift => {
            if (!shift.shiftDateObj) return null;
            if (shift.draft === true) return null;
            // COVERED: solo descartar si es una vacante real (employeeId=VACANTE)
            // Si es una ausencia, mantener en processedData para tracking RRHH
            if (shift.status === 'COVERED' && !shift.isAbsent && (!shift.employeeId || shift.employeeId === 'VACANTE')) return null;
            const rawPos = (shift.positionName || '').trim();
            if (!rawPos || rawPos === 'Sin Puesto' || rawPos === 'General') return null;

            // Solo mostrar turnos de planificación publicada. Los turnos operativos
            // (retén, cobertura, auto-reportados) y los ya procesados (presentes/ausentes)
            // siempre se muestran sin importar el estado de publicación.
            const isOperationalOrigin = shift.origin === 'RETEN' || shift.origin === 'OPERATIONS_COVERAGE' || shift.origin === 'SLA_VIRTUAL' || !!shift.isReten || shift.resolvedBy === 'OPERACIONES';
            const isAlreadyProcessed = !!shift.isPresent || shift.status === 'PRESENT' || shift.status === 'COMPLETED' || !!shift.isReportedToPlanning || !!shift.isReported;
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
            if (shift.employeeId && shift.employeeId !== 'VACANTE') {
                const foundName = empMap.get(shift.employeeId);
                if (foundName) finalEmpName = foundName;
                isValidEmployee = true; 
            } else { finalEmpName = 'VACANTE'; }

            const hasActiveSLA = activeSlaMap.has(shift.objectiveId);
            const isAbsent = !!shift.isAbsent;
            // isPresent solo si el turno arranca dentro de los próximos 60 min O ya inició
            // Evita el bug de turnos con isPresent=true que en realidad no empiezan en horas
            const isEarlyStartShift = shift.isEarlyStart === true || shift.isReten === true
                || shift.origin === 'RETEN' || shift.origin === 'OPERATIONS_COVERAGE';
            const shiftStartMs = shift.shiftDateObj ? shift.shiftDateObj.getTime() : 0;
            const withinWindow = !shiftStartMs || isEarlyStartShift
                || (currentTime.getTime() + 60 * 60 * 1000) >= shiftStartMs; // dentro de 60 min o ya inició
            const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent && withinWindow;
            const isCompleted = !!shift.isCompleted;
            
            const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
            const isResolvedByOps = shift.origin === 'OPERATIONS_COVERAGE' || shift.resolvedBy === 'OPERACIONES';
            // Un ausente NO cubre el puesto — el slot queda descubierto y genera vacante
            const countsForCoverage = (isValidEmployee && !isAbsent) || isReportedToPlanning;

            const isUnassigned = !isValidEmployee;
            const isOperationalVacancy = isUnassigned && !isReportedToPlanning;
            const isFranco = !!shift.isFranco || shift.objectiveName === 'FRANCO';
            
            if (isUnassigned && !isReportedToPlanning) return null; 

            const isEarlyStartScheduled = !!shift.isEarlyStart;
            const isEarlyStart = isEarlyStartScheduled && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco;
            const isConvocado = !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco &&
                (isEarlyStart || shift.origin === 'RETEN' || !!shift.isReten || shift.origin === 'OPERATIONS_COVERAGE');

            let minutesUntilStart = (shift.shiftDateObj.getTime() - currentTime.getTime()) / 60000;
            // CONVOCADO: solo es accionable (PRIORIDAD) cuando está a ≤15 min o ya inició.
            // Si falta más tiempo, va a PLAN como cualquier turno futuro.
            const isAwaitingCoverageCheckIn = isConvocado && minutesUntilStart <= 15;
            if (isAwaitingCoverageCheckIn) minutesUntilStart = Math.min(minutesUntilStart, 0);
            let retentionMinutes = 0;
            // isRetention: por tiempo (pasó el horario) O por campo Firestore (retenido manualmente/automáticamente)
            const isRetentionByTime  = isPresent && !isCompleted && shift.endDateObj && currentTime > shift.endDateObj;
            const isRetentionByField = isPresent && !isCompleted && shift.isRetention === true;
            const isRetention = isRetentionByTime || isRetentionByField;
            if (isRetentionByTime) {
                retentionMinutes = Math.floor((currentTime.getTime() - shift.endDateObj.getTime()) / 60000);
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
            
            const isImminent = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && minutesUntilStart <= 15 && minutesUntilStart > -5;
            const isFuture = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && minutesUntilStart > 15;
            const minutesPastStart = -minutesUntilStart;
            // Guardia tardanza: ventana T+5 → T+30
            const isLateNotified = !!(shift.lateArrivalAt) && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && minutesPastStart > 5 && minutesPastStart <= 60;
            const isLateUnnotified = !shift.lateArrivalAt && !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && minutesPastStart > 5 && minutesPastStart <= 60;
            const minutesRemainingLate = isLateNotified ? Math.max(0, Math.round(60 - minutesPastStart)) : null;
            // Potencial ausencia: T+30 sin confirmar presencia
            const isPotentialAbsence = !isPresent && !isCompleted && !isAbsent && !isUnassigned && !isFranco && minutesPastStart > 60;

            const phone = empPhoneMap.get(shift.employeeId) || shift.phone || shift.celular || '';

            return {
                ...shift, employeeName: finalEmpName, clientName: finalClient, objectiveName: finalObj, positionName: rawPos,
                phone,
                isValidEmployee, isUnassigned, isPresent, isCompleted, isAbsent, isPotentialAbsence,
                isLateNotified, isLateUnnotified, minutesRemainingLate,
                isReportedToPlanning, isOperationalVacancy, isResolvedByOps, isRetention, isFranco, isImminent, isFuture,
                isEarlyStart, isAwaitingCoverageCheckIn, isConvocado,
                minutesUntilStart, minutesPastStart, retentionMinutes, totalMinutesWorked, activeStartTime, hasActiveSLA, duration: getDuration(shift.shiftDateObj, shift.endDateObj), countsForCoverage
            };
        }).filter(Boolean);

        const virtualVacancies: any[] = [];
        const dayCode = getDayCode(now);

        servicesSLA.forEach(sla => {
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
            const hasRawShiftTodayForObjective = rawShifts.some((s: any) => {
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
                const targetPosName = (pos.name || '').trim().toLowerCase();
                const posShifts = objShifts.filter(s => {
                    const sPos = (s.positionName || '').trim().toLowerCase();
                    return (sPos === targetPosName || (sPos === 'general' && targetPosName === 'guardia')) && s.countsForCoverage;
                });

                // Detectar ciclo 12h
                const has12hShifts = posShifts.some(s => s.duration > 10);
                
                let relevantDefinitions = allowedShifts;
                // Si hay turnos definidos, los usamos
                // Si no, fallback a gap
                
                if (has12hShifts && allowedShifts.length > 0) {
                    relevantDefinitions = allowedShifts.filter((d:any) => (d.hours || 8) > 10);
                } else if (allowedShifts.length > 0) {
                    // Si no hay 12hs activas, asumimos 8hs
                    relevantDefinitions = allowedShifts.filter((d:any) => (d.hours || 8) < 10);
                }

                // 🛑 UNIFICACIÓN V124:
                // Si 'relevantDefinitions' TIENE DATOS, usamos lógica de SLOT (Checklist) incluso para 24HS.
                // Esto evita el problema de los huecos partidos.
                
                if (relevantDefinitions.length > 0) {
                    relevantDefinitions.forEach((slot: any) => {
                        const start = createDateFromTime(slot.startTime, now);
                        let end = createDateFromTime(slot.endTime, now);
                        
                        if (start && end) {
                            if (end <= start) end = new Date(end.getTime() + 86400000);
                            
                            // CHECKEO: ¿Está cubierto ESTE turno específico?
                            // Esto unifica "Noche" en una sola tarjeta porque checkea el rango completo 19:00 -> 07:00
                            const isCovered = checkSlotCoverage(start, end, posShifts);
                            
                            if (!isCovered) {
                                virtualVacancies.push({
                                    id: `V124_${sla.objectiveId}_${pos.name}_${slot.code}`,
                                    isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                    clientName: objInfo.clientName, clientId: objInfo.clientId,
                                    objectiveName: objInfo.name, objectiveId: sla.objectiveId,
                                    positionName: pos.name,
                                    employeeName: `VACANTE: ${(slot.name || slot.code).toUpperCase()}`,
                                    code: slot.code,
                                    shiftDateObj: start, endDateObj: end,
                                    minutesUntilStart: 0, isValidEmployee: false
                                });
                            }
                        }
                    });
                } 
                // SOLO si no hay definiciones de turnos, usamos Gaps (Fallback para objetivos legacy)
                else {
                    const targetHours = (pos.quantity || 1) * 24;
                    const coveredHours = posShifts.reduce((acc, s) => acc + s.duration, 0);
                    
                    if (coveredHours < targetHours) {
                        const gaps = findTimeGaps(posShifts, now);
                        gaps.forEach(gap => {
                            const h = gap.start.getHours();
                            let bestName = "COBERTURA";
                            if (h>=6 && h<14) bestName = "MAÑANA"; else if (h>=14 && h<22) bestName = "TARDE"; else bestName = "NOCHE";
                            
                            virtualVacancies.push({
                                id: `V124_GAP_${sla.objectiveId}_${pos.name}_${gap.start.getTime()}`,
                                isUnassigned: true, isVirtual: true, isOperationalVacancy: true,
                                clientName: objInfo.clientName, clientId: objInfo.clientId,
                                objectiveName: objInfo.name, objectiveId: sla.objectiveId, positionName: pos.name,
                                employeeName: `VACANTE: ${bestName}`,
                                shiftDateObj: gap.start, endDateObj: gap.end,
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

        // ── Suprimir vacantes virtuales solo si están CUBIERTAS (no suprimir por ausencias)
        // Un ausente sigue generando una vacante — la posición necesita cobertura
        const filteredVirtualVacancies = virtualVacancies.filter(v => {
            if (!v.shiftDateObj || !v.endDateObj) return true;
            const sameSlot = (s: any) =>
                s.objectiveId === v.objectiveId &&
                normPosName(s.positionName) === normPosName(v.positionName) &&
                checkSlotCoverage(v.shiftDateObj, v.endDateObj, [s]);
            // NO suprimir si hay ausente — mostrar como vacante para que el operador la cubra
            // (quitado: if absentSlots.some(a => sameSlot(a)) return false)
            if (dedupedRealShifts.some(s => s.isUnassigned && s.isReportedToPlanning && sameSlot(s))) return false;
            if (dedupedRealShifts.some(s => s.isOperationalVacancy && sameSlot(s))) return false;
            const cap = getPositionCapacity(servicesSLA, v.objectiveId, v.positionName);
            if (countPresentOnSlot(dedupedRealShifts, v.objectiveId, v.positionName, v.shiftDateObj, v.endDateObj) >= cap) {
                return false;
            }
            // Si el slot ya inició y hay un guardia PRESENTE ahora en esa posición
            // (llegó tarde pero ya está cubriendo), suprimir la vacante.
            // La ausencia del tramo inicial ya quedó capturada como AUSENCIA del guardia ausente.
            const slotAlreadyStarted = v.shiftDateObj && v.shiftDateObj.getTime() <= now.getTime();
            if (slotAlreadyStarted) {
                const hasCurrentGuard = dedupedRealShifts.some((s: any) =>
                    s.isPresent && !s.isCompleted &&
                    s.objectiveId === v.objectiveId &&
                    normPosName(s.positionName) === normPosName(v.positionName)
                );
                if (hasCurrentGuard) return false;
            }
            return true;
        });

        return [...dedupedRealShifts, ...filteredVirtualVacancies].sort((a:any, b:any) => a.shiftDateObj - b.shiftDateObj);
    }, [rawShifts, now, employees, objectives, servicesSLA, publishStatusMap]);

    // ... Resto del hook igual ...
    const listData = useMemo(() => {
        let list = processedData;
        if (selectedClientId) list = list.filter((s:any) => s.clientId === selectedClientId);
        if (filterText) { const lower = filterText.toLowerCase(); list = list.filter((s: any) => (s.employeeName||'').toLowerCase().includes(lower) || (s.clientName||'').toLowerCase().includes(lower)); }
        // Base: solo turnos de hoy — OR turno activo/retenido que arrancó en el nocturno de ayer
        const hoy = list.filter((s:any) => {
            if (s.isCompleted && !s.isRetention) return false;
            if (s.isVirtual && s.endDateObj && s.endDateObj.getTime() < now.getTime()) return false;
            return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
        });
        switch (viewTab) {
            case 'TODOS':      return hoy.filter((s:any) => !s.isFranco);
            case 'PRIORIDAD':  return hoy.filter((s:any) => (s.isImminent || s.isRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn) && !s.isFranco);
            case 'NO_LLEGO':   return hoy.filter((s:any) => (s.isLateNotified || s.isLateUnnotified || s.isPotentialAbsence) && !s.isFranco && !s.isAbsent && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn);
            case 'PLAN':       return hoy.filter((s:any) => s.isFuture && !s.isFranco && !s.isUnassigned && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn);
            case 'ACTIVOS':    return hoy.filter((s:any) => s.isPresent && !s.isCompleted && !s.isRetention);
            case 'RETENIDOS':  return hoy.filter((s:any) => s.isRetention);
            case 'VACANTES':   return hoy.filter((s:any) => s.isOperationalVacancy); // Fix 3: sync con stats.vacantes (excluye devueltas)
            case 'AUSENTES':   return hoy.filter((s:any) => s.isAbsent || s.isPotentialAbsence);
            case 'FRANCOS':    return hoy.filter((s:any) => s.isFranco);
            default:           return hoy;
        }
    }, [processedData, viewTab, filterText, selectedClientId, now]);
    const stats = useMemo(() => { const hoy = processedData.filter(s => {
            if (s.isCompleted && !s.isRetention) return false;
            if (s.isVirtual && s.endDateObj && s.endDateObj.getTime() < now.getTime()) return false;
            return isSameDay(s.shiftDateObj, now) || ((s.isPresent || s.isRetention) && !s.isCompleted);
        }); return { prioridad: hoy.filter(s => (s.isImminent || s.isRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn) && !s.isFranco).length, no_llego: hoy.filter(s => (s.isLateNotified || s.isLateUnnotified || s.isPotentialAbsence) && !s.isFranco && !s.isAbsent && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn).length, plan: hoy.filter(s => s.isFuture && !s.isFranco && !s.isUnassigned && !s.isEarlyStart && !s.isAwaitingCoverageCheckIn).length, activos: hoy.filter(s => s.isPresent && !s.isCompleted).length, retenidos: hoy.filter(s => s.isRetention).length, vacantes: hoy.filter(s => s.isOperationalVacancy).length, devueltas: hoy.filter(s => s.isUnassigned && s.isReportedToPlanning).length, ausentes: hoy.filter(s => s.isAbsent || s.isPotentialAbsence).length, francos: hoy.filter(s => s.isFranco).length, total: hoy.length }; }, [processedData, now]);
    const handleAction = async (action: string, shiftId: string, payload?: any) => {
        try {
            if (action === 'CHECKOUT') {
                await updateDocForEmpresa('turnos', shiftId, {
                    status: 'COMPLETED', isCompleted: true, isPresent: false,
                    realEndTime: serverTimestamp(), checkoutNote: payload || null,
                }, empresaId, migracionCompleta);
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
            const autoKey = `${v.id}_VACANTE_A_PLANIFICACION`;
            if (!alertedVacancyIds.current.has(autoKey)) {
                alertedVacancyIds.current.add(autoKey);
                getDocs(query(collection(db, 'novedades'), where('virtualVacancyId', '==', v.id), where('type', '==', 'VACANTE_A_PLANIFICACION'), limit(1)))
                    .then(async snap => {
                        if (!snap.empty) return; // ya fue procesada antes
                        const newRef = doc(collection(db, 'turnos'));
                        const shiftEmpresaId = String(v.empresaId || empresaId || '').trim();
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
                        await addDoc(collection(db, 'novedades'), stampEmpresaId({
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

            // ── PASO 2: alerta PROTOCOLO para el operador (solo ≤60 min) ────
            // Una vez que el turno está próximo a iniciarse (o ya inició), se crea
            // una alerta visible para que el operador tome acción de CUBRIR.
            if (minutesUntil > 60) continue;
            const protKey = `${v.id}_VACANTE_PROTOCOLO_COBERTURA`;
            if (alertedVacancyIds.current.has(protKey)) continue;
            alertedVacancyIds.current.add(protKey);
            getDocs(query(collection(db, 'novedades'), where('virtualVacancyId', '==', v.id), where('type', '==', 'VACANTE_PROTOCOLO_COBERTURA'), limit(1)))
                .then(async snap => {
                    if (!snap.empty) return;
                    const desc = minutesUntil <= 0
                        ? `⚠️ PROTOCOLO: Puesto ${v.positionName} en ${v.objectiveName} sin cobertura. Turno inició hace ${Math.round(Math.abs(minutesUntil))} min. Requiere CUBRIR inmediato.`
                        : `⚠️ PROTOCOLO: Puesto ${v.positionName} en ${v.objectiveName} sin cubrir. Faltan ${Math.round(minutesUntil)} min. Cubrir manualmente.`;
                    const shiftEmpresaId = String(v.empresaId || empresaId || '').trim();
                    await addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'VACANTE_PROTOCOLO_COBERTURA', status: 'PENDIENTE',
                        virtualVacancyId: v.id,
                        objectiveId: v.objectiveId, objectiveName: v.objectiveName || '',
                        clientId: v.clientId || null, positionName: v.positionName || '',
                        description: desc,
                        minutesUntilStart: Math.round(minutesUntil),
                        createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                    }, shiftEmpresaId));
                })
                .catch(e => console.warn('[autoAlertVacante:prot]', e));
        }

        // ── RETENCIÓN LARGA (>2h retenido) ──────────────────────────────
        const retainedShifts = processedData.filter((s: any) => s.isRetention && !s.isCompleted);
        for (const s of retainedShifts) {
            const endMs = s.endDateObj?.getTime?.() ?? 0;
            if (!endMs) continue;
            const minutesOvertime = (nowMs - endMs) / 60000;
            if (minutesOvertime < 120) continue;
            const alertKey = `${s.id}_RETENCION_LARGA`;
            if (alertedVacancyIds.current.has(alertKey)) continue;
            alertedVacancyIds.current.add(alertKey);
            getDocs(query(collection(db, 'novedades'), where('shiftId', '==', s.id), where('type', '==', 'RETENCION_LARGA'), limit(1)))
                .then(async snap => {
                    if (!snap.empty) return;
                    const shiftEmpresaId = String(s.empresaId || empresaId || '').trim();
                    await addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'RETENCION_LARGA', status: 'PENDIENTE',
                        shiftId: s.id, objectiveId: s.objectiveId, objectiveName: s.objectiveName || '',
                        clientId: s.clientId || null, positionName: s.positionName || '',
                        employeeId: s.employeeId, employeeName: s.employeeName || '',
                        description: `${s.employeeName || 'Guardia'} lleva ${Math.round(minutesOvertime)} min de retención en ${s.objectiveName}. Requiere autorización o reemplazo.`,
                        minutesOvertime: Math.round(minutesOvertime),
                        createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                    }, shiftEmpresaId));
                }).catch(e => console.warn('[autoAlertRetencion]', e));
        }

        // ── POSICIÓN SIN RELEVO (<30 min para fin, sin entrante) ─────────
        const expiringShifts = processedData.filter((s: any) => s.isPresent && !s.isCompleted && !s.isRetention);
        for (const s of expiringShifts) {
            const endMs = s.endDateObj?.getTime?.() ?? 0;
            if (!endMs) continue;
            const minutesUntilEnd = (endMs - nowMs) / 60000;
            if (minutesUntilEnd > 30 || minutesUntilEnd < -5) continue;
            const hasRelevo = processedData.some((other: any) =>
                other.id !== s.id &&
                other.objectiveId === s.objectiveId &&
                other.positionName === s.positionName &&
                !other.isPresent && !other.isCompleted && !other.isUnassigned &&
                Math.abs((other.shiftDateObj?.getTime?.() ?? 0) - endMs) < 90 * 60000
            );
            if (hasRelevo) continue;
            const alertKey = `${s.id}_POSICION_SIN_RELEVO`;
            if (alertedVacancyIds.current.has(alertKey)) continue;
            alertedVacancyIds.current.add(alertKey);
            getDocs(query(collection(db, 'novedades'), where('shiftId', '==', s.id), where('type', '==', 'POSICION_SIN_RELEVO'), limit(1)))
                .then(async snap => {
                    if (!snap.empty) return;
                    const shiftEmpresaId = String(s.empresaId || empresaId || '').trim();
                    await addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'POSICION_SIN_RELEVO', status: 'PENDIENTE',
                        shiftId: s.id, objectiveId: s.objectiveId, objectiveName: s.objectiveName || '',
                        clientId: s.clientId || null, positionName: s.positionName || '',
                        employeeId: s.employeeId, employeeName: s.employeeName || '',
                        description: `${s.employeeName || 'Guardia'} termina en ${Math.round(minutesUntilEnd)} min sin relevo planificado en ${s.objectiveName} — ${s.positionName}.`,
                        minutesUntilEnd: Math.round(minutesUntilEnd),
                        createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                    }, shiftEmpresaId));
                }).catch(e => console.warn('[autoAlertRelevo]', e));
        }

        // ── RECARGO 12H / 16H ──────────────────────────────────────────────
        // Cualquier guardia presente con 12+ horas activas: alerta para decidir.
        // Con 16+ horas (dos turnos completos): recargo máximo, reemplazo requerido.
        const recargoShifts = processedData.filter((s: any) =>
            s.isPresent && !s.isCompleted && s.activeStartTime
        );
        for (const s of recargoShifts) {
            const startMs = (s.activeStartTime as Date).getTime();
            const horasActivas = (nowMs - startMs) / 3600000;

            if (horasActivas >= 12) {
                const key12 = `${s.id}_RECARGO_12H`;
                if (!alertedVacancyIds.current.has(key12)) {
                    alertedVacancyIds.current.add(key12);
                    getDocs(query(collection(db, 'novedades'), where('shiftId', '==', s.id), where('type', '==', 'RECARGO_12H'), limit(1)))
                        .then(async snap => {
                            if (!snap.empty) return;
                            const shiftEmpresaId = String(s.empresaId || empresaId || '').trim();
                            await addDoc(collection(db, 'novedades'), stampEmpresaId({
                                type: 'RECARGO_12H', status: 'PENDIENTE',
                                shiftId: s.id, objectiveId: s.objectiveId, objectiveName: s.objectiveName || '',
                                clientId: s.clientId || null, positionName: s.positionName || '',
                                employeeId: s.employeeId, employeeName: s.employeeName || '',
                                description: `${s.employeeName || 'Guardia'} lleva 12hs de recargo activo en ${s.objectiveName} (${s.positionName}). ¿Continúa el recargo?`,
                                horasActivas: Math.round(horasActivas * 10) / 10,
                                createdAt: serverTimestamp(), source: 'SYSTEM_SCHEDULER',
                            }, shiftEmpresaId));
                            toast.warning(`⏱ 12hs recargo: ${s.employeeName || 'Guardia'} — ${s.objectiveName}`);
                        }).catch(e => console.warn('[autoAlertRecargo12]', e));
                }
            }

            if (horasActivas >= 16) {
                const key16 = `${s.id}_RECARGO_MAXIMO`;
                if (!alertedVacancyIds.current.has(key16)) {
                    alertedVacancyIds.current.add(key16);
                    getDocs(query(collection(db, 'novedades'), where('shiftId', '==', s.id), where('type', '==', 'RECARGO_MAXIMO'), limit(1)))
                        .then(async snap => {
                            if (!snap.empty) return;
                            const shiftEmpresaId = String(s.empresaId || empresaId || '').trim();
                    await addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'RECARGO_MAXIMO', title: 'Recargo máximo (16h+)', status: 'PENDIENTE',
                        source: 'SYSTEM_SCHEDULER',
                        employeeId: s.employeeId, employeeName: s.employeeName,
                        clientId: s.clientId || null,
                        objectiveId: s.objectiveId || null, objectiveName: s.objectiveName || '',
                        positionName: s.positionName || '', shiftId: s.id,
                        description: `🚨 RECARGO MÁXIMO: ${s.employeeName} lleva ${Math.round(horasActivas)}h en ${s.objectiveName}. Relevar URGENTE.`,
                        createdAt: serverTimestamp(), reportedBy: 'SYSTEM_AUTO',
                    }, shiftEmpresaId));
                        }).catch(e => console.warn('[recargo16h]', e));
                }
            }
        }
    }, [processedData, now, empresaId]);

    // ── AUTO-AUSENCIA T+30 ──────────────────────────────────────────────
    useEffect(() => {
        const toAbsent = processedData.filter((s: any) => {
            if (!s.isPotentialAbsence || s.lateArrivalAt || !s.id || s.id.startsWith('SLA_GAP') || s.id.startsWith('V124_') || s.isVirtual) return false;
            // Retenes NO se auto-ausentan — son convocados urgentes, el CF ya los saltea igual
            const isFullyOp = s.origin === 'RETEN' || s.origin === 'OPERATIONS_COVERAGE' || !!s.isReten || s.resolvedBy === 'OPERACIONES';
            if (isFullyOp) return false;
            if (!(s.shiftDateObj instanceof Date)) return false;
            const pubKey = planificacionPublishLookupKey(
                s.objectiveId,
                s.shiftDateObj.getFullYear(),
                s.shiftDateObj.getMonth() + 1,
            );
            return !!publishStatusMap[pubKey];
        });
        if (!toAbsent.length) return;

        for (const s of toAbsent) {
            if (autoAbsentedIds.current.has(s.id)) continue;
            autoAbsentedIds.current.add(s.id);

            const shiftDate = s.shiftDateObj instanceof Date ? s.shiftDateObj : new Date(s.shiftDateObj);
            const dayStart = new Date(shiftDate); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(shiftDate); dayEnd.setHours(23, 59, 59, 999);

            getDocs(query(collection(db, 'ausencias'), where('shiftId', '==', s.id), where('absenceType', '==', 'AA'), limit(1)))
                .then(async snap => {
                    if (!snap.empty) return;
                    const shiftEmpresaId = String(s.empresaId || empresaId || '').trim();
                    await updateDocForEmpresa('turnos', s.id, {
                        status: 'ABSENT', isAbsent: true, absenceType: 'AA',
                        absenceRegisteredAt: serverTimestamp(),
                    }, empresaId, migracionCompleta);
                    await addDoc(collection(db, 'ausencias'), stampEmpresaId({
                        employeeId: s.employeeId, employeeName: s.employeeName,
                        clientId: s.clientId || null, type: 'No Presentacion', absenceType: 'AA',
                        startDate: Timestamp.fromDate(dayStart), endDate: Timestamp.fromDate(dayEnd),
                        status: 'Confirmada',
                        shiftCode: (s.code || '').toUpperCase() || null,
                        reason: `No presentacion al turno ${shiftDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} - ${s.objectiveName} (${s.positionName})`,
                        hasCertificate: false, createdAt: serverTimestamp(), origin: 'AUTO_T30', shiftId: s.id,
                    }, shiftEmpresaId));
                    await addDoc(collection(db, 'novedades'), stampEmpresaId({
                        type: 'AUSENCIA_AUTO', title: 'Ausencia Automática (AA)', status: 'PENDIENTE',
                        source: 'SYSTEM_SCHEDULER',
                        employeeId: s.employeeId, employeeName: s.employeeName,
                        clientId: s.clientId || null,
                        objectiveId: s.objectiveId || null, objectiveName: s.objectiveName || '',
                        positionName: s.positionName || '', shiftId: s.id,
                        description: `[AA] ${s.employeeName} no se presentó al turno en ${s.objectiveName} (${s.positionName}) — ${shiftDate.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'})}`,
                        createdAt: serverTimestamp(), reportedBy: 'SYSTEM_AUTO',
                    }, shiftEmpresaId));
                    toast.warning(`[AA] Ausencia automática: ${s.employeeName} — ${s.objectiveName}`);
                })
                .catch(e => console.warn('[autoAbsent]', e));
        }
    }, [processedData]);

    const isClientLocked = !!forcedClientId;
    const handleSetSelectedClientId = (id: string) => { if (!isClientLocked) setSelectedClientId(id); };
    return {
        employees, now, processedData, listData, stats, recentLogs, objectives, servicesSLA,
        viewTab, setViewTab, filterText, setFilterText, isCompact, setIsCompact, operatorInfo,
        selectedClientId, setSelectedClientId: handleSetSelectedClientId,
        uniqueClients, filteredObjectives, handleAction, isClientLocked, publishStatusMap,
    };
};
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  