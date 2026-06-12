
import React, { useState, useEffect } from 'react';
import { X, UserX, Clock, UserCheck, UserPlus, AlertTriangle, Search, CheckCircle, User, BellRing, FastForward } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, Timestamp, updateDoc, doc, addDoc, serverTimestamp, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { stampEmpresaId } from '@/lib/multiempresa';

const cleanPayload = (data: any) => {
    const cleaned = { ...data };
    const uiFields = ['id', 'shiftDateObj', 'endDateObj', 'visualEndDateObj', 'hasPendingIssue', 'isSlaGap', 'isUnassigned', 'statusText', 'isLate', 'isCriticallyLate', 'isAbsent', 'isFuture', 'isRetention', 'isReported', 'isCompleted', 'isPresent', 'formattedActor', 'fullDetail', 'time', 'isPending'];
    uiFields.forEach(f => delete cleaned[f]);
    Object.keys(cleaned).forEach(key => { if (cleaned[key] === undefined) delete cleaned[key]; });
    return cleaned;
};

const EmployeeCard = ({ data, actionLabel, onAction, colorClass, type }: any) => {
    const name = data.employeeName || `${data.lastName||''} ${data.firstName||''}` || 'Guardia';
    return (
        <div className={`flex flex-col p-3 border rounded-xl bg-white hover:shadow-md transition-all group ${colorClass.border} border-l-4`}>
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`p-2 rounded-lg ${colorClass.bg} ${colorClass.text}`}> <User size={18}/> </div>
                    <div className="min-w-0"><p className="font-bold text-sm text-slate-800 truncate">{name}</p></div>
                </div>
                {onAction && (<button onClick={() => onAction(data)} className={`px-3 py-1 text-[10px] font-bold uppercase rounded-lg border transition-all ${colorClass.text} border-current hover:bg-slate-50`}>{actionLabel}</button>)}
            </div>
        </div>
    );
};

export default function AbsenceResolutionModal({ isOpen, onClose, absenceShift, onResolve }: any) {
    const { empresaId } = useEmpresa();
    const [phase, setPhase] = useState('DIAGNOSIS');
    const [method, setMethod] = useState<any>(null);
    const [isUnassigned, setIsUnassigned] = useState(false);
    const [activeGuards, setActiveGuards] = useState<any[]>([]);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && absenceShift) {
            setPhase('DIAGNOSIS'); setMethod(null); setCandidates([]); setSelectedCandidate(null); setActiveGuards([]);
            const isGap = absenceShift.id?.startsWith('SLA_GAP');
            setIsUnassigned(!absenceShift.employeeId || absenceShift.employeeId === 'VACANTE' || isGap);
            if (!isGap) checkActiveGuards();
        }
    }, [isOpen, absenceShift]);

    const checkActiveGuards = async () => {
        try {
            const now = new Date();
            const q = query(collection(db, 'turnos'), where('objectiveId', '==', absenceShift.objectiveId), where('status', '==', 'PRESENT'));
            const snap = await getDocs(q);
            setActiveGuards(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        } catch (e) { console.error('[ops] checkActiveGuards error:', e); }
    };

    const materializeShiftIfNeeded = async () => {
        if (absenceShift.id.startsWith('SLA_GAP')) {
            const startTs = absenceShift.shiftDateObj ? Timestamp.fromDate(absenceShift.shiftDateObj) : Timestamp.now();
            const endTs = absenceShift.endDateObj ? Timestamp.fromDate(absenceShift.endDateObj) : Timestamp.now();
            const cleanData = stampEmpresaId(cleanPayload({ ...absenceShift, startTime: startTs, endTime: endTs, status: 'PENDING', employeeId: 'VACANTE', employeeName: 'VACANTE', createdAt: serverTimestamp() }), String(absenceShift.empresaId || empresaId || '').trim());
            const newDoc = await addDoc(collection(db, 'turnos'), cleanData);
            return newDoc.id;
        }
        return absenceShift.id;
    };

    // 🛑 FIX: CARGA EN MEMORIA (EVITA ERROR INDICES DE FIREBASE)
    const loadCandidates = async (strategy: string) => {
        setLoading(true); setMethod(strategy);
        try {
            // 1. Obtener empleados activos
            const qEmp = query(collection(db, 'empleados'), where('status', 'in', ['activo', 'active', 'ACTIVO']), limit(50));
            const empSnap = await getDocs(qEmp);
            const allEmps = empSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

            if (allEmps.length === 0) { toast.error("Sin personal activo"); setLoading(false); return; }

            // 2. Definir ventana de tiempo de la vacante
            const start = absenceShift.shiftDateObj ? new Date(absenceShift.shiftDateObj) : new Date();
            const end = absenceShift.endDateObj ? new Date(absenceShift.endDateObj) : new Date(start.getTime() + 8*3600000);

            // 3. Buscar turnos que se solapen en este rango (QUERY SIMPLE SIN INDICES COMPUESTOS)
            // Traemos turnos que empiezan hoy y filtramos en JS
            const dayStart = new Date(start); dayStart.setHours(0,0,0,0);
            const dayEnd = new Date(start); dayEnd.setHours(23,59,59,999);
            
            const qBusy = query(collection(db, 'turnos'), where('startTime', '>=', Timestamp.fromDate(dayStart)), where('startTime', '<=', Timestamp.fromDate(dayEnd)));
            const busySnap = await getDocs(qBusy);
            
            // Set de ocupados
            const busyIds = new Set();
            busySnap.docs.forEach(doc => {
                const data = doc.data();
                const tStart = data.startTime.toDate();
                const tEnd = data.endTime ? data.endTime.toDate() : new Date(tStart.getTime() + 8*3600000);
                
                // Si se solapan, está ocupado
                if (tStart < end && tEnd > start) {
                    busyIds.add(data.employeeId);
                }
            });

            // 4. Filtrar disponibles
            const available = allEmps.filter(e => !busyIds.has(e.id) && e.id !== absenceShift.employeeId);
            
            setCandidates(available);
            setPhase('SELECTION');
        } catch (e: any) { 
            console.error(e); 
            toast.error("Error buscando: " + e.message); 
        } finally { setLoading(false); }
    };

    const handleExecute = async () => {
        if (!selectedCandidate) return; setLoading(true);
        try {
            const realId = await materializeShiftIfNeeded();
            await updateDoc(doc(db, 'turnos', realId), { resolutionStatus: 'RESOLVED', resolutionMethod: method });

            const _actor = getAuth().currentUser?.email?.split('@')[0] || 'Operador';
            const _empId = String(absenceShift.empresaId || empresaId || '').trim();
            if (method === 'EXTENSION') {
                await updateDoc(doc(db, 'turnos', selectedCandidate.id), { endTime: absenceShift.endDateObj ? Timestamp.fromDate(absenceShift.endDateObj) : Timestamp.now(), isExtraShift: true });
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'EXTENSION_TURNO', module: 'OPERACIONES',
                    actorName: _actor, timestamp: serverTimestamp(),
                    employeeId: selectedCandidate.id,
                    employeeName: `${selectedCandidate.lastName||''} ${selectedCandidate.firstName||''}`.trim(),
                    objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName,
                    details: `Turno extendido para cubrir ausencia en ${absenceShift.objectiveName || ''}.`,
                }, _empId)).catch(() => {});
            } else if (method === 'RELIEF') {
                const reliefData = {
                    employeeId: selectedCandidate.id,
                    employeeName: `${selectedCandidate.lastName||''} ${selectedCandidate.firstName||''}`.trim(),
                    clientId: absenceShift.clientId||'S/D', clientName: absenceShift.clientName||'S/D',
                    objectiveId: absenceShift.objectiveId||'S/D', objectiveName: absenceShift.objectiveName||'S/D',
                    positionName: absenceShift.positionName||'Guardia',
                    startTime: Timestamp.now(),
                    // endTime = fin real del turno ausente (NO 8h fijos — respetar SLA)
                    endTime: absenceShift.endDateObj ? Timestamp.fromDate(absenceShift.endDateObj) : Timestamp.now(),
                    status: 'PRESENT', isPresent: true, isRelief: true, comments: 'Cobertura operativa'
                };
                const reliefRef = await addDoc(collection(db, 'turnos'), cleanPayload(reliefData));
                await updateDoc(doc(db, 'turnos', realId), { status: 'COVERED_BY_RELIEF', comments: `Cubierto por ${reliefData.employeeName}` });
                addDoc(collection(db, 'audit_logs'), stampEmpresaId({
                    action: 'COBERTURA_RELEVO', module: 'OPERACIONES',
                    actorName: _actor, timestamp: serverTimestamp(),
                    employeeId: selectedCandidate.id, employeeName: reliefData.employeeName,
                    objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName,
                    shiftId: reliefRef.id,
                    details: `${reliefData.employeeName} asignado como relevo en ${absenceShift.objectiveName || ''} (${absenceShift.positionName || ''}).`,
                }, _empId)).catch(() => {});
            }
            toast.success("Resuelto"); onResolve(); onClose();
        } catch (e: any) { toast.error("Error al guardar: " + e.message); } finally { setLoading(false); }
    };

    const handleNotify = async () => {
        setLoading(true);
        try {
            const realId = await materializeShiftIfNeeded();
            await updateDoc(doc(db, 'turnos', realId), { status: 'UNCOVERED_REPORTED', isReported: true });
            await addDoc(collection(db, 'novedades'), { type: 'ERROR_PLANIFICACION', shiftId: realId, createdAt: serverTimestamp(), status: 'OPEN', details: 'Falta cobertura' });
            toast.success("Notificado"); onResolve(); onClose();
        } catch (e) { toast.error("Error al notificar"); } finally { setLoading(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border flex flex-col max-h-[90vh]">
                <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center"><h3 className="font-bold text-red-900">Resolver Incidencia</h3><button onClick={onClose}><X/></button></div>
                <div className="p-6 overflow-y-auto flex-1">
                    {phase === 'DIAGNOSIS' && (
                        <div className="space-y-3">
                            <button onClick={() => loadCandidates('RELIEF')} className="w-full p-4 border rounded-xl hover:bg-slate-50 flex items-center gap-3"><UserPlus className="text-indigo-600"/><div className="text-left"><p className="font-bold">Cubrir Operativamente</p></div></button>
                            <button onClick={handleNotify} className="w-full p-4 border rounded-xl hover:bg-slate-50 flex items-center gap-3"><BellRing className="text-red-600"/><div className="text-left"><p className="font-bold">Notificar Planificación</p></div></button>
                        </div>
                    )}
                    {phase === 'SELECTION' && (
                        <div className="space-y-2">
                            {candidates.length === 0 ? <p className="text-center text-sm">Sin personal disponible</p> : candidates.map(c => <EmployeeCard key={c.id} data={c} actionLabel="ELEGIR" colorClass={{bg:'bg-indigo-50', text:'text-indigo-600', border:'border-slate-200'}} onAction={()=>{setSelectedCandidate(c); setPhase('CONFIRM');}} />)}
                            <button onClick={()=>setPhase('DIAGNOSIS')} className="w-full pt-2 text-xs underline">Volver</button>
                        </div>
                    )}
                    {phase === 'CONFIRM' && (
                        <div className="text-center space-y-4">
                            <CheckCircle size={40} className="mx-auto text-emerald-600"/>
                            <h3>Confirmar Cobertura</h3>
                            <p>Guardia: <b>{selectedCandidate?.lastName}</b></p>
                            <button onClick={handleExecute} disabled={loading} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold">{loading?'Procesando...':'CONFIRMAR'}</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
