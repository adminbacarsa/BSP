const fs = require('fs');
const path = require('path');

console.log(`\n🎯 INSTALANDO V7.28: CORRECCIÓN DE SINTAXIS SLA`);
console.log(`1. SINTAXIS: Ahora reconoce '24hs', '24 HS', '24Hs', etc.`);
console.log(`2. LECTURA: Apunta explícitamente al array 'positions' de la colección 'servicios_sla'.`);
console.log(`3. AUDITORÍA: Si dice Quantity: 1 y 24hs, exigirá 1 guardia en M, 1 en T y 1 en N.`);

const PATH_HOOK = path.join('apps', 'web2', 'src', 'hooks', 'useOperacionesMonitor.ts');
const PATH_PAGE = path.join('apps', 'web2', 'src', 'pages', 'admin', 'operaciones', 'index.tsx');

// =============================================================================
// 1. HOOK CORREGIDO (V7.28)
// =============================================================================
const HOOK_CONTENT = `
import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, limit, Timestamp, doc, updateDoc, serverTimestamp, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth'; 
import { toast } from 'sonner';

// --- HELPERS ---
const getSafeDate = (val: any) => {
    if (!val) return null;
    try {
        if (val.toDate && typeof val.toDate === 'function') return val.toDate();
        if (val instanceof Date) return val;
        if (val.seconds) return new Date(val.seconds * 1000);
        if (typeof val === 'string' || typeof val === 'number') return new Date(val);
    } catch (e) { console.error("Error fecha:", val); }
    return null;
};

const formatName = (input: any) => {
    if (!input) return 'Operador';
    try {
        if (typeof input === 'object') {
            if (input.displayName) return input.displayName;
            if (input.email) return input.email.split('@')[0].replace(/[0-9._-]/g, ' ').split(' ').map((n:any)=>n.charAt(0).toUpperCase()+n.slice(1).toLowerCase()).join(' ').trim();
        }
        if (typeof input === 'string' && input.includes('@')) return input.split('@')[0].replace(/[0-9._-]/g, ' ').split(' ').map((n:any)=>n.charAt(0).toUpperCase()+n.slice(1).toLowerCase()).join(' ').trim();
    } catch (e) {}
    return 'Operador';
};

export const useOperacionesMonitor = () => {
    const [now, setNow] = useState(new Date());
    const [rawShifts, setRawShifts] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [objectives, setObjectives] = useState<any[]>([]); 
    const [servicesSLA, setServicesSLA] = useState<any[]>([]); 
    const [recentLogs, setRecentLogs] = useState<any[]>([]);
    const [resolutions, setResolutions] = useState<any[]>([]);
    const [config, setConfig] = useState({ toleranceLate: 15, toleranceAbsent: 60, toleranceRetention: 15 });
    const [operatorInfo, setOperatorInfo] = useState({ name: '', startTime: new Date() });
    
    // UI
    const [viewTab, setViewTab] = useState<'PRIORIDAD' | 'RETENIDOS' | 'AUN_NO' | 'ACTIVOS' | 'AUSENTES' | 'PLANIFICADO' | 'HOY'>('PRIORIDAD');
    const [filterText, setFilterText] = useState('');
    const [isCompact, setIsCompact] = useState(false);
    const [modals, setModals] = useState({ checkout: false, novedad: false, coverage: false });
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [novedadData, setNovedadData] = useState({ tipo: 'Llegada Tarde', nota: '' });

    // EFECTOS
    useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
    useEffect(() => { const auth = getAuth(); const unsubscribe = auth.onAuthStateChanged(user => { if (user) setOperatorInfo(prev => ({ ...prev, name: formatName(user) })); }); return () => unsubscribe(); }, []);

    useEffect(() => {
        const start = new Date(); start.setHours(0,0,0,0);
        // Logs
        const unsubLogs = onSnapshot(query(collection(db, 'audit_logs'), where('timestamp', '>=', Timestamp.fromDate(start)), limit(100)), snap => {
             const logs = snap.docs.map(d => ({ 
                 id: d.id, ...d.data(), time: getSafeDate(d.data().timestamp), 
                 formattedActor: formatName(d.data().actor || d.data().actorName || 'Sistema'), 
                 fullDetail: d.data().details || d.data().notes || '-' 
             }));
             setRecentLogs(logs.sort((a: any,b: any) => b.time - a.time));
        });
        const fetchConfig = async () => { try { const snap = await getDocs(query(collection(db, 'config'), limit(1))); if (!snap.empty) setConfig({ ...config, ...snap.docs[0].data() }); } catch (e) {} }; fetchConfig();
        const unsubEmp = onSnapshot(collection(db, 'empleados'), snap => setEmployees(snap.docs.map(d => ({ id: d.id, fullName: \`\${d.data().lastName||''} \${d.data().firstName||''}\`.trim() || d.data().name || 'Sin Nombre', ...d.data() }))));
        
        // Carga Objetivos (Info Visual)
        const unsubObj = onSnapshot(collection(db, 'clients'), snap => { 
            const objs: any[] = []; 
            snap.docs.forEach(d => { 
                const data = d.data();
                if (data.objetivos) { data.objetivos.forEach((o: any) => { objs.push({ ...o, clientName: data.name, clientId: d.id }); }); } 
                else { objs.push({ id: d.id, name: data.name, clientName: data.name }); }
            }); 
            setObjectives(objs); 
        });

        // Carga Servicios SLA
        const unsubSLA = onSnapshot(query(collection(db, 'servicios_sla'), where('status', '==', 'active')), snap => {
            const services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setServicesSLA(services);
        });
        
        const unsubRes = onSnapshot(query(collection(db, 'historial_resoluciones'), where('createdAt', '>=', Timestamp.fromDate(start))), snap => setResolutions(snap.docs.map(d => d.data()) || []));
        return () => { unsubLogs(); unsubEmp(); unsubObj(); unsubSLA(); unsubRes(); };
    }, []);

    // Carga Turnos
    useEffect(() => {
        const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate() - 1); 
        const end = new Date(); end.setHours(23,59,59,999); end.setDate(end.getDate() + 1);
        return onSnapshot(query(collection(db, 'turnos'), where('startTime', '>=', Timestamp.fromDate(start)), where('startTime', '<=', Timestamp.fromDate(end))), (snap) => {
            setRawShifts(snap.docs.map(d => {
                const data = d.data();
                const startObj = getSafeDate(data.startTime);
                const endObj = getSafeDate(data.endTime) || new Date(startObj.getTime() + (8 * 3600000));
                return { id: d.id, ...data, shiftDateObj: startObj, endDateObj: endObj, visualEndDateObj: endObj };
            }));
        });
    }, []);

    // --- MOTOR V7.28 ---
    const processedData = useMemo(() => {
        // A. Turnos Reales
        const mappedShifts = rawShifts.map(shift => {
            if (!shift.shiftDateObj) return null;
            const typeUpper = (shift.type || shift.status || '').toUpperCase();
            if (['FRANCO', 'LICENCIA', 'VACACIONES', 'OFF'].includes(typeUpper)) return null;

            const startT = shift.shiftDateObj.getTime();
            const nowT = now.getTime();
            const minLate = (nowT - startT) / 60000;
            const isPresent = shift.status === 'PRESENT' || shift.status === 'CHECK_IN' || !!shift.isPresent;
            const isCompleted = shift.status === 'COMPLETED' || !!shift.isCompleted;
            const isAbsentConfirmado = shift.status === 'ABSENT' || !!shift.isAbsent;
            const isReported = shift.status === 'UNCOVERED_REPORTED' || shift.reportedToPlanning === true; 
            const isRetention = !!shift.isRetention;
            const hasNovedad = !!shift.hasNovedad;
            const isResolved = Array.isArray(resolutions) && resolutions.some((r: any) => r && r.shiftId === shift.id && r.status === 'RESOLVED');
            const empName = (shift.employeeName || '').toUpperCase();
            const isUnassigned = !shift.employeeId || shift.employeeId === 'VACANTE' || empName.includes('SIN ASIGNAR') || empName.includes('VACANTE');
            const isCriticallyLate = !isPresent && !isCompleted && !isReported && minLate > 240 && !isUnassigned; 
            
            let isLate = false;
            if (!isPresent && !isCompleted && !isAbsentConfirmado && !isUnassigned && !isReported && startT < nowT) { if (minLate > config.toleranceLate) isLate = true; }
            let isAbsentUnwarned = isLate && minLate > config.toleranceAbsent;
            let hasPendingIssue = false;
            let priorityReason = '';

            if (!isResolved && !isCompleted && !isReported && !isAbsentConfirmado) {
                 if (isRetention) { hasPendingIssue = true; priorityReason = 'RETENCIÓN'; }
                 else if (isUnassigned) { hasPendingIssue = true; priorityReason = 'VACANTE'; } 
                 else if (isAbsentUnwarned) { hasPendingIssue = true; priorityReason = 'AUSENCIA S/A'; }
                 else if (hasNovedad) { hasPendingIssue = true; priorityReason = 'NOVEDAD'; }
                 else if (isLate) { hasPendingIssue = true; priorityReason = 'TARDE'; }
                 else if (isCriticallyLate) { hasPendingIssue = true; priorityReason = 'SIN REGISTRO'; }
            }

            let statusText = 'PLANIFICADO';
            if (isReported) statusText = 'EN PLANIFICACIÓN';
            else if (isUnassigned) statusText = 'VACANTE';
            else if (isRetention) statusText = 'RETENIDO';
            else if (isAbsentConfirmado) statusText = 'AUSENTE';
            else if (isPresent) statusText = 'EN SERVICIO';
            else if (isCompleted) statusText = 'FINALIZADO';
            else if (isLate) statusText = 'TARDE';
            if (isCriticallyLate) statusText = 'SIN REGISTRO';

            const emp = employees.find(e => e.id === shift.employeeId);
            const objective = objectives.find(o => o.id === shift.objectiveId || o.name === shift.objectiveName);
            let finalPositionName = shift.positionName || shift.position || shift.role || 'Puesto General';

            return {
                ...shift,
                employeeName: emp?.fullName || shift.employeeName || 'Sin Asignar',
                clientName: objective?.clientName || shift.clientName,
                objectiveName: objective?.name || shift.objectiveName,
                positionName: finalPositionName,
                isLate, isAbsentUnwarned, isRetention, isUnassigned, isResolved, isReported,
                hasPendingIssue, priorityReason, isPresent, isCompleted, statusText, isCriticallyLate
            };
        }).filter(Boolean);

        // B. DETECTAR GAPS (SLA)
        const slaGaps: any[] = [];
        const todayStr = now.toDateString();

        servicesSLA.forEach(service => {
            const objectiveId = service.objectiveId;
            const positions = service.positions || []; // Confirmado por script espía

            const objInfo = objectives.find(o => o.id === objectiveId) || { name: service.objectiveName || 'Objetivo', clientName: service.clientName || 'Cliente' };

            const shiftsForObjective = mappedShifts.filter(s => 
                (s.objectiveId === objectiveId) && 
                s.shiftDateObj?.toDateString() === todayStr && 
                !s.isReported
            );

            positions.forEach((pos: any) => {
                const qty = parseInt(pos.quantity || '1', 10);
                // --- CORRECCIÓN V7.28: NORMALIZAR TEXTO 24HS ---
                const coverageType = (pos.coverageType || '').toLowerCase().replace(/\\s/g, ''); // Elimina espacios y hace minusculas
                const is24Hs = coverageType === '24hs' || pos.tags?.includes('24HS') || (pos.M && pos.T && pos.N);
                
                // Normalización de nombre de puesto para comparar
                const posNameUpper = (pos.name || '').toUpperCase();

                const shiftsForPos = shiftsForObjective.filter(s => 
                    s.positionId === pos.id || 
                    (s.positionName || '').toUpperCase() === posNameUpper || 
                    (s.position || '').toUpperCase() === posNameUpper
                );

                const auditSlots = [];
                if (is24Hs) {
                    auditSlots.push({ code: 'M', start: 5, end: 12, label: 'TURNO MAÑANA' });
                    auditSlots.push({ code: 'T', start: 13, end: 20, label: 'TURNO TARDE' });
                    auditSlots.push({ code: 'N', start: 21, end: 29, label: 'TURNO NOCHE' });
                } else {
                    auditSlots.push({ code: 'G', start: 0, end: 24, label: 'TURNO GENERAL' });
                }

                auditSlots.forEach(slot => {
                    const foundCount = shiftsForPos.filter(s => {
                        const h = s.shiftDateObj.getHours();
                        return h >= slot.start && h <= slot.end;
                    }).length;

                    const missing = qty - foundCount;
                    if (missing > 0) {
                         for (let i = 0; i < missing; i++) {
                            const gapDate = new Date(now);
                            // Setear hora "ideal" de inicio de turno para mostrar en la tarjeta
                            gapDate.setHours(slot.start === 0 ? 9 : (slot.start === 5 ? 7 : (slot.start === 13 ? 15 : 23)), 0, 0, 0);
                            slaGaps.push({
                                id: \`SLA_GAP_\${service.id}_\${pos.id}_\${slot.code}_\${i}\`, 
                                employeeName: \`FALTANTE \${slot.label}\`, 
                                clientName: objInfo.clientName, 
                                objectiveName: objInfo.name, 
                                positionName: pos.name || 'Guardia', 
                                shiftDateObj: gapDate, 
                                endDateObj: new Date(gapDate.getTime() + 8*3600000), 
                                hasPendingIssue: true, priorityReason: 'FALTA SLA', statusText: 'VACANTE DE CONTRATO',
                                isUnassigned: true, isSlaGap: true, objectiveId: objectiveId, positionId: pos.id
                            });
                        }
                    }
                });
            });
        });

        return [...mappedShifts, ...slaGaps].sort((a:any, b:any) => a.shiftDateObj - b.shiftDateObj);
    }, [rawShifts, now, config, employees, objectives, resolutions, servicesSLA]);

    const listData = useMemo(() => {
        let list = processedData;
        if (filterText) {
            const lower = filterText.toLowerCase();
            list = list.filter((s: any) => (s.employeeName||'').toLowerCase().includes(lower) || (s.clientName||'').toLowerCase().includes(lower));
        }
        switch (viewTab) {
            case 'PRIORIDAD': return list.filter((s:any) => (s.hasPendingIssue || s.isCriticallyLate || s.isSlaGap) && !s.isReported);
            case 'RETENIDOS': return list.filter((s:any) => s.isRetention);
            case 'AUN_NO': return list.filter((s:any) => s.isLate && !s.isPresent && !s.isAbsent && !s.isCompleted && !s.isRetention && !s.isSlaGap && !s.isReported);
            case 'ACTIVOS': return list.filter((s:any) => s.isPresent && !s.isCompleted && !s.isRetention);
            case 'AUSENTES': return list.filter((s:any) => s.isAbsent || s.isAbsentUnwarned);
            case 'PLANIFICADO': return list.filter((s:any) => s.shiftDateObj > now && !s.isUnassigned && !s.isCompleted && !s.isAbsent && !s.isSlaGap && !s.isReported);
            case 'HOY': return list.filter((s:any) => s.isCompleted || s.isReported || s.isResolved);
            default: return list;
        }
    }, [processedData, viewTab, filterText, now]);

    const stats = useMemo(() => ({
        total: processedData.filter((s:any) => s.isCompleted).length,
        prioridad: processedData.filter(s => (s.hasPendingIssue || s.isSlaGap) && !s.isReported).length,
        retenidos: processedData.filter(s => s.isRetention).length,
        aunNo: processedData.filter(s => s.isLate && !s.isPresent && !s.isAbsent && !s.isCompleted && !s.isRetention).length,
        activos: processedData.filter(s => s.isPresent && !s.isCompleted && !s.isRetention).length,
        ausentes: processedData.filter(s => s.isAbsent || s.isAbsentUnwarned).length,
        planificado: processedData.filter(s => s.shiftDateObj > now && !s.isUnassigned && !s.isCompleted && !s.isSlaGap).length
    }), [processedData, now]);

    const handleAction = async (action: string, shiftId: string, payload?: any) => {
        if (shiftId.startsWith('SLA_GAP_')) { toast.error("Para un faltante de SLA, use 'RESOLVER' o 'NOTIFICAR'."); return; }
        const shift = rawShifts.find(s => s.id === shiftId);
        if (!shift) return;
        setProcessingId(shiftId);
        const auth = getAuth(); const user = auth.currentUser; const actorName = formatName(user);
        try {
            if (action === 'CHECKIN') {
                await updateDoc(doc(db, 'turnos', shiftId), { status: 'PRESENT', isPresent: true, realStartTime: serverTimestamp(), checkInMethod: 'MANUAL_DASHBOARD' });
                await addDoc(collection(db, 'audit_logs'), { action: 'MANUAL_CHECKIN', targetShiftId: shiftId, actor: actorName, timestamp: serverTimestamp(), details: 'Ingreso manual' });
                toast.success("Ingreso registrado");
            } else if (action === 'CHECKOUT') {
                await updateDoc(doc(db, 'turnos', shiftId), { status: 'COMPLETED', isCompleted: true, isPresent: false, realEndTime: serverTimestamp(), checkoutNote: payload || null });
                await addDoc(collection(db, 'audit_logs'), { action: 'MANUAL_CHECKOUT', targetShiftId: shiftId, actor: actorName, timestamp: serverTimestamp(), details: payload ? \`Salida: \${payload}\` : 'Salida normal' });
                toast.success("Salida registrada");
            } else if (action === 'NOVEDAD') setModals(m => ({ ...m, novedad: true }));
        } catch (e) { toast.error("Error en acción"); }
        setProcessingId(null);
    };

    const confirmNovedad = async () => {
        if (!processingId) return;
        const auth = getAuth(); const user = auth.currentUser; const actorName = formatName(user);
        try {
            const isGap = processingId.startsWith('SLA_GAP_');
            if (novedadData.tipo.includes('Notificar')) {
                let targetPositionName = 'Puesto General';
                if (isGap) {
                    const gapData = processedData.find(s => s.id === processingId);
                    targetPositionName = gapData?.positionName || 'Puesto Desconocido';
                    await addDoc(collection(db, 'turnos'), {
                        objectiveId: gapData?.objectiveId, startTime: Timestamp.fromDate(new Date()), endTime: Timestamp.fromDate(gapData?.endDateObj || new Date()),
                        status: 'UNCOVERED_REPORTED', isReported: true, reportedToPlanning: true, employeeName: 'VACANTE DE CONTRATO (REPORTADA)',
                        employeeId: 'VACANTE', positionName: targetPositionName, comments: \`No se planificó turno en puesto \${targetPositionName}\`, createdAt: serverTimestamp()
                    });
                } else {
                    const shiftData = rawShifts.find(s => s.id === processingId);
                    const processedShift = processedData.find(s => s.id === processingId);
                    targetPositionName = processedShift?.positionName || shiftData?.position || 'Puesto';
                    await updateDoc(doc(db, 'turnos', processingId), { status: 'UNCOVERED_REPORTED', isReported: true, reportedToPlanning: true, comments: \`No se planificó turno en puesto \${targetPositionName}\`, reportedAt: serverTimestamp() });
                }
                await addDoc(collection(db, 'audit_logs'), { action: 'SLA_REPORT', targetShiftId: processingId, actor: actorName, timestamp: serverTimestamp(), details: \`Alerta de Planificación: No se planificó turno en puesto \${targetPositionName}\` });
                toast.success("Notificado a planificación.");
            } else {
                if (!isGap) {
                    await addDoc(collection(db, 'novedades'), { shiftId: processingId, type: novedadData.tipo, notes: novedadData.nota, createdAt: serverTimestamp(), viewed: false });
                    await updateDoc(doc(db, 'turnos', processingId), { hasNovedad: true });
                    await addDoc(collection(db, 'audit_logs'), { action: 'NOVEDAD_REPORT', targetShiftId: processingId, actor: actorName, timestamp: serverTimestamp(), details: \`\${novedadData.tipo}: \${novedadData.nota}\` });
                    toast.success("Novedad reportada");
                } else { toast.error("Acción no válida para GAP."); }
            }
            setModals(m => ({...m, novedad: false}));
        } catch (e) { toast.error("Error al guardar: " + e.message); }
    };

    return { now, processedData, listData, stats, recentLogs, objectives, servicesSLA, operatorInfo, formatName, viewTab, setViewTab, filterText, setFilterText, isCompact, setIsCompact, modals, setModals, handleAction, processingId, confirmNovedad, novedadData, setNovedadData };
};
`;

// =============================================================================
// 2. PAGE: ACTUALIZAR TITULO A V7.28
// =============================================================================
let PAGE_CONTENT = fs.readFileSync(PATH_PAGE, 'utf8');
PAGE_CONTENT = PAGE_CONTENT.replace(/COSP V\d+\.\d+/g, 'COSP V7.28');

try {
    fs.writeFileSync(PATH_HOOK, HOOK_CONTENT);
    console.log("✅ Hook V7.28 Actualizado: Lógica '24hs' normalizada.");
    fs.writeFileSync(PATH_PAGE, PAGE_CONTENT);
    console.log("✅ Página V7.28 Actualizada.");
} catch (error) {
    console.error("❌ Error escribiendo archivo:", error);
}