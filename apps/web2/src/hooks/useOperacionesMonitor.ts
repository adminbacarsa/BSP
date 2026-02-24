
import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit, Timestamp, updateDoc, doc, serverTimestamp, addDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';
import { getAuth } from 'firebase/auth';

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

export const useOperacionesMonitor = () => {
    const [now, setNow] = useState(new Date());
    const [rawShifts, setRawShifts] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [objectives, setObjectives] = useState<any[]>([]); 
    const [servicesSLA, setServicesSLA] = useState<any[]>([]); 
    const [recentLogs, setRecentLogs] = useState<any[]>([]);
    const [viewTab, setViewTab] = useState<'PRIORIDAD' | 'NO_LLEGO' | 'PLAN' | 'ACTIVOS' | 'RETENIDOS' | 'VACANTES' | 'AUSENTES' | 'FRANCOS' | 'TODOS'>('PRIORIDAD');
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [filterText, setFilterText] = useState('');
    const [isCompact, setIsCompact] = useState(false);
    const [operatorInfo, setOperatorInfo] = useState<{ name: string; startTime: Date | null }>({ name: 'Operador', startTime: null });
    const nameByEmailRef = useRef<Record<string, string>>({});
    const autoAbsentAppliedRef = useRef<Set<string>>(new Set());

    useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

    // Ausente automático: tras 60 min de tolerancia sin presente, marcar turno como ABSENT
    useEffect(() => {
        const nowMs = Date.now();
        rawShifts.forEach((s: any) => {
            if (!s.id || autoAbsentAppliedRef.current.has(s.id)) return;
            const start = getSafeDate(s.startTime || s.shiftDateObj);
            if (!start) return;
            const diffMin = (nowMs - start.getTime()) / 60000;
            if (diffMin < 60) return;
            if (s.isPresent || s.isAbsent) return;
            if (s.employeeId === 'VACANTE' || !s.employeeId) return;
            autoAbsentAppliedRef.current.add(s.id);
            updateDoc(doc(db, 'turnos', s.id), { status: 'ABSENT', isAbsent: true }).catch(() => { autoAbsentAppliedRef.current.delete(s.id); });
        });
    }, [rawShifts]);

    // SUSCRIPCIONES
    useEffect(() => {
        const auth = getAuth();
        if (auth.currentUser) setOperatorInfo({ name: auth.currentUser.email?.split('@')[0] || 'Op', startTime: new Date() });
        const unsubs: Function[] = [];
        unsubs.push(onSnapshot(collection(db, 'empleados'), snap => setEmployees(snap.docs.map(d => ({ id: d.id, fullName: `${d.data().lastName} ${d.data().firstName}`, ...d.data() })))));
        const parseCoord = (v: any): number | null => { if (v == null) return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
        const normLatLng = (o: any) => { const lat = parseCoord(o.lat ?? o.latitude ?? o.coords?.lat ?? o.coords?.latitude ?? o.location?.lat ?? o.geo?.lat ?? o.geopoint?.latitude); const lng = parseCoord(o.lng ?? o.longitude ?? o.coords?.lng ?? o.coords?.longitude ?? o.location?.lng ?? o.geo?.lng ?? o.geopoint?.longitude); return { lat: lat ?? undefined, lng: lng ?? undefined }; };
        unsubs.push(onSnapshot(collection(db, 'clients'), snap => {
            const objs: any[] = [];
            snap.docs.forEach(d => {
                const data = d.data();
                if (data.objetivos && Array.isArray(data.objetivos)) {
                    data.objetivos.forEach((o: any, idx: number) => {
                        const { lat, lng } = normLatLng(o);
                        const objectiveId = o.id || o.name || `obj_${d.id}_${idx}`;
                        objs.push({ ...o, id: objectiveId, name: o.name || o.id || 'Objetivo', clientName: data.name, clientId: d.id, lat, lng });
                    });
                } else {
                    objs.push({ id: d.id, name: data.name, clientName: data.name || data.fantasyName, clientId: d.id });
                }
            });
            setObjectives(objs);
        }));
        unsubs.push(onSnapshot(query(collection(db, 'servicios_sla'), where('status', '==', 'active')), snap => setServicesSLA(snap.docs.map(d => ({ id: d.id, ...d.data() })))));
        // Bitácora: suscribirse siempre (no depender de system_users). Mapa de nombres se llena en paralelo.
        getDocs(collection(db, 'system_users')).then((userSnap) => {
            const map: Record<string, string> = {};
            userSnap.docs.forEach(d => {
                const u = d.data();
                const displayName = (u.firstName && u.lastName) ? `${u.lastName} ${u.firstName}`.trim() : (u.name || u.email || '');
                if (u.email) map[u.email] = displayName || u.email;
                if (d.id) map[d.id] = displayName || u.email || d.id;
            });
            nameByEmailRef.current = map;
        }).catch(() => {});
        // Bitácora: consulta simple (solo orderBy + limit) para evitar índices compuestos; filtramos por fecha en cliente
        const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2); twoDaysAgo.setHours(0, 0, 0, 0);
        const unsubAudit = onSnapshot(
            query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(500)),
            (snap) => {
                const nameByEmail = nameByEmailRef.current;
                const twoDaysAgoMs = twoDaysAgo.getTime();
                const list = snap.docs
                    .map(d => {
                        const data = d.data();
                        const actorName = data.actorName || data.actor || '';
                        const resolvedName = nameByEmail[data.actorEmail] || nameByEmail[data.actorUid] || nameByEmail[actorName] || actorName;
                        const time = getSafeDate(data.timestamp);
                        return { id: d.id, ...data, formattedActor: resolvedName || actorName || 'Sistema', time, fullDetail: data.details };
                    })
                    .filter((row: any) => row.time && row.time.getTime() >= twoDaysAgoMs);
                setRecentLogs(list);
            },
            (err) => { console.error('audit_logs subscription error', err); setRecentLogs([]); }
        );
        unsubs.push(unsubAudit);
        return () => { unsubs.forEach(u => u()); };
    }, []);

    useEffect(() => {
        const start = new Date(); start.setDate(start.getDate() - 5); start.setHours(0,0,0,0);
        const end = new Date(); end.setDate(end.getDate() + 5); end.setHours(23,59,59,999);
        const unsub = onSnapshot(query(collection(db, 'turnos'), where('startTime', '>=', Timestamp.fromDate(start)), where('startTime', '<=', Timestamp.fromDate(end))), (snap) => { setRawShifts(snap.docs.map(d => ({ id: d.id, ...d.data(), shiftDateObj: getSafeDate(d.data().startTime), endDateObj: getSafeDate(d.data().endTime) }))); });
        return () => unsub();
    }, []);

    const uniqueClients = useMemo(() => { const map = new Map(); objectives.forEach(obj => map.set(obj.clientId, obj.clientName)); return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); }, [objectives]);
    const filteredObjectives = useMemo(() => selectedClientId ? objectives.filter(o => o.clientId === selectedClientId) : objectives, [objectives, selectedClientId]);

    const processedData = useMemo(() => {
        const currentTime = new Date(now.getTime());
        const empMap = new Map(); employees.forEach(e => empMap.set(e.id, e.fullName));
        const objMap = new Map(); objectives.forEach(o => objMap.set(o.id, { clientName: o.clientName, name: o.name, clientId: o.clientId }));
        const activeSlaMap = new Set(servicesSLA.map(s => s.objectiveId));

        const realShifts = rawShifts.map(shift => {
            if (!shift.shiftDateObj) return null;
            const rawCode = String(shift.code || shift.shiftCode || '').toUpperCase();
            const rawType = String(shift.type || shift.shiftType || '').toUpperCase();
            const isFrancoCandidate = !!shift.isFranco || !!shift.isFrancoTrabajado || rawCode === 'F' || rawCode === 'FT' || rawType === 'FRANCO' || String(shift.objectiveName || '').toUpperCase() === 'FRANCO';

            const rawPos = (shift.positionName || '').trim();
            // En general filtramos "General/Sin Puesto", pero los FRANCOS pueden venir así y deben verse.
            if (!isFrancoCandidate && (!rawPos || rawPos === 'Sin Puesto' || rawPos === 'General')) return null;

            let info = objMap.get(shift.objectiveId);
            let finalClient = info ? info.clientName : shift.clientName;
            let finalObj = info ? info.name : shift.objectiveName;
            let finalEmpName = shift.employeeName;
            
            let isValidEmployee = false;
            if (shift.employeeId && shift.employeeId !== 'VACANTE') {
                const foundName = empMap.get(shift.employeeId);
                if (foundName) finalEmpName = foundName;
                isValidEmployee = true; 
            } else { finalEmpName = 'VACANTE'; }

            const hasActiveSLA = activeSlaMap.has(shift.objectiveId);
            const isPresent = !!shift.isPresent && isValidEmployee;
            const isCompleted = !!shift.isCompleted;
            const isAbsent = !!shift.isAbsent;
            
            const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
            const isResolvedByOps = shift.origin === 'OPERATIONS_COVERAGE' || shift.resolvedBy === 'OPERACIONES';
            const countsForCoverage = isValidEmployee || isReportedToPlanning; 

            const isUnassigned = !isValidEmployee;
            // Franco puede venir como flag, como FT (franco trabajado) o como código.
            const isFranco = isFrancoCandidate;
            
            // Mostrar vacantes aunque no estén "reportadas a planificación"
            // (necesario para que PRIORIDAD pueda incluir vacantes críticas)

            const minutesUntilStart = (shift.shiftDateObj.getTime() - currentTime.getTime()) / 60000;
            let retentionMinutes = 0;
            const isRetention = isPresent && !isCompleted && shift.endDateObj && currentTime > shift.endDateObj;
            if (isRetention) retentionMinutes = Math.floor((currentTime.getTime() - shift.endDateObj.getTime()) / 60000);
            
            const isImminent = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && minutesUntilStart <= 15 && minutesUntilStart > -5; 
            const isFuture = !isPresent && !isCompleted && !isUnassigned && !isAbsent && !isFranco && minutesUntilStart > 15;
            const isPotentialAbsence = !isPresent && !isCompleted && isValidEmployee && !isFranco && minutesUntilStart <= -5;
            const isLateArrival = isPotentialAbsence && minutesUntilStart > -60;
            const isAbsenceLike = !!isAbsent || (isPotentialAbsence && minutesUntilStart <= -60);

            return {
                ...shift, employeeName: finalEmpName, clientName: finalClient, objectiveName: finalObj, positionName: rawPos,
                isValidEmployee, isUnassigned, isPresent, isCompleted, isAbsent, isReportedToPlanning, isResolvedByOps, isRetention, isFranco, isImminent, isFuture,
                isPotentialAbsence, isLateArrival, isAbsenceLike,
                minutesUntilStart, retentionMinutes, hasActiveSLA, duration: getDuration(shift.shiftDateObj, shift.endDateObj), countsForCoverage
            };
        }).filter(Boolean);

        const virtualVacancies: any[] = [];
        const dayCode = getDayCode(now);

        servicesSLA.forEach(sla => {
            const objInfo = objMap.get(sla.objectiveId);
            if (!objInfo || !sla.positions) return;

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
                                    isUnassigned: true, isVirtual: true,
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
                                isUnassigned: true, isVirtual: true,
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

        return [...realShifts, ...virtualVacancies].sort((a:any, b:any) => a.shiftDateObj - b.shiftDateObj);
    }, [rawShifts, now, employees, objectives, servicesSLA]);

    // ... Resto del hook igual ...
    const listData = useMemo(() => {
        let list = processedData;
        if (selectedClientId) list = list.filter((s:any) => s.clientId === selectedClientId);
        if (filterText) {
            const lower = filterText.toLowerCase();
            list = list.filter((s: any) =>
                (s.employeeName||'').toLowerCase().includes(lower) ||
                (s.clientName||'').toLowerCase().includes(lower) ||
                (s.objectiveName||'').toLowerCase().includes(lower)
            );
        }

        const isPriority = (s: any) => {
            if (s.isFranco) return false;
            if (s.isResolvedByOps) return false;
            if (s.isPresent || s.isCompleted) return false;
            // Ausencia ya declarada: va a AUSENTES, no sigue en prioridad
            if (s.isAbsent) return false;
            // Vacantes del día (excluir las ya devueltas a planificación)
            if (s.isUnassigned && !s.isReportedToPlanning && isSameDay(s.shiftDateObj, now)) return true;
            // Ausencias / no llegó del día aún no operados (alertas críticas)
            if ((s.isAbsenceLike || s.isLateArrival) && isSameDay(s.shiftDateObj, now)) return true;
            // Presentes por confirmar / retenciones
            if (s.isImminent || s.isRetention) return true;
            return false;
        };

        switch (viewTab) {
            case 'TODOS':
                return list.filter((s:any) => !s.isFranco && isSameDay(s.shiftDateObj, now));
            case 'PRIORIDAD':
                return list.filter(isPriority);
            case 'NO_LLEGO':
                return list.filter((s:any) => (s.isLateArrival || (s.isAbsenceLike && !s.isAbsent)) && isSameDay(s.shiftDateObj, now));
            case 'PLAN':
                return list.filter((s:any) => s.isFuture && !s.isFranco && !s.isUnassigned && isSameDay(s.shiftDateObj, now));
            case 'ACTIVOS':
                return list.filter((s:any) => s.isPresent && !s.isCompleted && !s.isRetention);
            case 'RETENIDOS':
                return list.filter((s:any) => s.isRetention);
            case 'VACANTES':
                return list.filter((s:any) => s.isUnassigned && isSameDay(s.shiftDateObj, now));
            case 'AUSENTES':
                return list.filter((s:any) => s.isAbsenceLike && isSameDay(s.shiftDateObj, now));
            case 'FRANCOS':
                return list.filter((s:any) => s.isFranco && isSameDay(s.shiftDateObj, now));
            default:
                return list;
        }
    }, [processedData, viewTab, filterText, selectedClientId, now]);
    const stats = useMemo(() => {
        const prioridad = processedData.filter((s:any) => {
            if (s.isFranco) return false;
            if (s.isResolvedByOps) return false;
            if (s.isPresent || s.isCompleted) return false;
            if (s.isAbsent) return false;
            if (s.isUnassigned && !s.isReportedToPlanning && isSameDay(s.shiftDateObj, now)) return true;
            if ((s.isAbsenceLike || s.isLateArrival) && isSameDay(s.shiftDateObj, now)) return true;
            if (s.isImminent || s.isRetention) return true;
            return false;
        }).length;

        return {
            prioridad,
            no_llego: processedData.filter(s => (s.isLateArrival || (s.isAbsenceLike && !s.isAbsent)) && isSameDay(s.shiftDateObj, now)).length,
            plan: processedData.filter(s => s.isFuture && !s.isFranco && !s.isUnassigned && isSameDay(s.shiftDateObj, now)).length,
            activos: processedData.filter(s => s.isPresent && !s.isCompleted).length,
            retenidos: processedData.filter(s => s.isRetention).length,
            vacantes: processedData.filter(s => s.isUnassigned && isSameDay(s.shiftDateObj, now)).length,
            ausentes: processedData.filter(s => s.isAbsenceLike && isSameDay(s.shiftDateObj, now)).length,
            francos: processedData.filter(s => s.isFranco && isSameDay(s.shiftDateObj, now)).length,
            total: processedData.length
        };
    }, [processedData, now]);
    const handleAction = async (action: string, shiftId: string, payload?: any) => { try { const docRef = doc(db, 'turnos', shiftId); if (action === 'CHECKOUT') await updateDoc(docRef, { status: 'COMPLETED', isCompleted: true, isPresent: false, realEndTime: serverTimestamp(), checkoutNote: payload || null }); } catch (e:any) { toast.error("Error: " + e.message); } };
    return { employees, now, processedData, listData, stats, recentLogs, objectives, servicesSLA, viewTab, setViewTab, filterText, setFilterText, isCompact, setIsCompact, operatorInfo, selectedClientId, setSelectedClientId, uniqueClients, filteredObjectives, handleAction };
};
