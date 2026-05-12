
import React, { useState, useEffect } from 'react';
import { Clock, UserX, UserCheck, AlertTriangle, ArrowRight, Shield, CheckCircle, Search, DollarSign, Siren, LogOut, Briefcase, ArrowLeft, MapPin, Phone, MessageCircle, X, Briefcase as WorkIcon } from 'lucide-react';
import { doc, updateDoc, serverTimestamp, addDoc, collection, Timestamp, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';

const ProHeader = ({ title, subtitle, icon: Icon, colorClass, onClose }: any) => (
    <div className={`p-5 text-white flex justify-between items-start ${colorClass}`}>
        <div><h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2"><Icon className="text-white/80" size={20} /> {title}</h3><p className="text-white/80 text-xs font-bold mt-1">{subtitle}</p></div>
        <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 transition-colors"><X size={20} className="text-white" /></button>
    </div>
);

// --- MODAL RELEVO INTELIGENTE V74 ---
export const HandoverModal = ({ isOpen, onClose, incomingShift, activeGuardsInObjective }: any) => {
    const [selectedOutgoing, setSelectedOutgoing] = useState<any>(null);
    const [novedad, setNovedad] = useState('');
    const [hasNovedad, setHasNovedad] = useState(false);
    const [loading, setLoading] = useState(false);
    
    // 🛑 FILTRO DE PUESTO: Solo mostramos candidatos del mismo puesto
    const matchingGuards = activeGuardsInObjective.filter((g: any) => {
        // Coincidencia laxa: ID de puesto igual O Nombre de puesto igual
        const samePosId = g.positionId && incomingShift.positionId && g.positionId === incomingShift.positionId;
        const samePosName = g.positionName === incomingShift.positionName;
        return samePosId || samePosName;
    });

    useEffect(() => { 
        // Auto-seleccionar si solo hay uno del mismo puesto
        if (isOpen && matchingGuards.length === 1) setSelectedOutgoing(matchingGuards[0]); 
        else setSelectedOutgoing(null);
    }, [isOpen, matchingGuards.length]);

    if (!isOpen || !incomingShift) return null;

    const handleExecuteRelevo = async () => {
        setLoading(true);
        try {
            await updateDoc(doc(db, 'turnos', incomingShift.id), { status: 'PRESENT', isPresent: true, realStartTime: serverTimestamp(), isLate: false });
            if (selectedOutgoing) {
                await updateDoc(doc(db, 'turnos', selectedOutgoing.id), { status: 'COMPLETED', isCompleted: true, isPresent: false, realEndTime: serverTimestamp(), checkoutNote: hasNovedad ? novedad : 'Sin Novedad (Relevo)', hasNovedad: hasNovedad });
            }
            toast.success(selectedOutgoing ? "Relevo confirmado" : "Ingreso registrado (Sin relevo)"); onClose();
        } catch (e) { toast.error("Error en relevo"); } finally { setLoading(false); }
    };

    return (
        <div className="fixed inset-0 z-[9000] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-200">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
                <ProHeader title="Procedimiento de Ingreso" subtitle={incomingShift.clientName} icon={UserCheck} colorClass="bg-gradient-to-br from-indigo-600 to-violet-700" onClose={onClose}/>
                <div className="p-6">
                    <div className="bg-indigo-50 p-4 rounded-xl mb-6 border border-indigo-100 flex items-center gap-3">
                        <div className="bg-white p-2 rounded-full shadow-sm text-indigo-600 font-bold"><Shield size={20}/></div>
                        <div>
                            <p className="text-[10px] uppercase text-indigo-400 font-bold">PUESTO A CUBRIR</p>
                            <p className="text-sm font-black text-indigo-900">{incomingShift.positionName || 'Guardia General'}</p>
                        </div>
                    </div>

                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block tracking-wider">¿A QUIÉN RELEVA EN ESTE PUESTO?</label>
                    {matchingGuards.length === 0 ? (
                        <div className="p-4 bg-slate-50 rounded-2xl text-xs text-slate-500 italic text-center border border-dashed border-slate-300">
                            No hay guardias activos en el puesto <b>{incomingShift.positionName}</b>.<br/>
                            Se registrará como <b>Apertura de Puesto</b>.
                        </div>
                    ) : (
                        <div className="space-y-2 mb-6">
                            {matchingGuards.map((g:any) => (
                                <div key={g.id} onClick={() => setSelectedOutgoing(selectedOutgoing?.id === g.id ? null : g)} className={`p-4 rounded-2xl border cursor-pointer flex justify-between items-center transition-all ${selectedOutgoing?.id === g.id ? 'border-indigo-500 bg-indigo-50 shadow-md transform scale-[1.02]' : 'border-slate-200 hover:bg-slate-50'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className="bg-white p-2 rounded-full border border-slate-100"><LogOut size={16} className="text-slate-400"/></div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">{g.employeeName}</p>
                                            <p className="text-[10px] text-slate-500">En turno desde {g.shiftDateObj?.toLocaleTimeString().substring(0,5)}</p>
                                        </div>
                                    </div>
                                    {selectedOutgoing?.id === g.id && <CheckCircle size={20} className="text-indigo-600"/>}
                                </div>
                            ))}
                        </div>
                    )}

                    {selectedOutgoing && (
                        <div className="mb-6 animate-in slide-in-from-bottom-2 fade-in">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 mb-2 cursor-pointer">
                                <input type="checkbox" checked={hasNovedad} onChange={e => setHasNovedad(e.target.checked)} className="rounded text-indigo-600 w-4 h-4"/> 
                                ¿Hay novedad en la salida?
                            </label>
                            {hasNovedad && <textarea className="w-full p-3 border border-indigo-200 bg-indigo-50/30 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Describa la novedad..." value={novedad} onChange={e => setNovedad(e.target.value)} rows={2}/>}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button onClick={onClose} className="flex-1 py-4 text-slate-500 font-bold hover:bg-slate-50 rounded-2xl">CANCELAR</button>
                        <button onClick={handleExecuteRelevo} disabled={loading} className="flex-[2] py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-xl disabled:opacity-50 transition-all active:scale-95">
                            {loading ? 'PROCESANDO...' : selectedOutgoing ? 'CONFIRMAR RELEVO' : 'DAR INGRESO'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ... Resto de modales sin cambios (Attendance, Interrupt, Coverage, WorkedDayOff) ...
export const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { const [loading, setLoading] = useState(false); if (!isOpen || !shift) return null; const handleLate = async (minutes: number) => { if (minutes >= 120) { if(confirm("Retraso > 2 horas es AUSENCIA. ¿Confirmar?")) onMarkAbsent(shift); return; } setLoading(true); try { const originalStart = shift.shiftDateObj; const newStart = new Date(originalStart.getTime() + minutes * 60000); const docRef = doc(db, 'turnos', shift.id); await updateDoc(docRef, { startTime: Timestamp.fromDate(newStart), originalStartTime: Timestamp.fromDate(originalStart), isLate: true, lateMinutes: minutes, comments: `Ingreso demorado ${minutes} min` }); toast.success(`Ajustado: +${minutes} min`); onClose(); } catch (e) { toast.error("Error"); } finally { setLoading(false); } }; return ( <div className="fixed inset-0 z-[9000] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-200"> <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200"> <ProHeader title="Control de Asistencia" subtitle={shift.employeeName} icon={Clock} colorClass="bg-gradient-to-br from-amber-500 to-orange-600" onClose={onClose}/> <div className="p-6 space-y-4"> <div className="grid grid-cols-2 gap-3"> {[15, 30, 60].map(m => ( <button key={m} onClick={() => handleLate(m)} className="p-3 border border-slate-200 rounded-2xl hover:bg-amber-50 hover:border-amber-300 text-xs font-bold text-slate-600 flex flex-col items-center gap-1"> <Clock size={18} className="text-slate-300"/> +{m} MINUTOS </button> ))} <button onClick={() => handleLate(120)} className="p-3 border border-red-100 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100 text-xs font-bold flex flex-col items-center gap-1"><AlertTriangle size={18}/> +2 HS (AUSENTE)</button> </div> <button onClick={() => onMarkAbsent(shift)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"><UserX size={18}/> CONFIRMAR AUSENCIA</button> </div> </div> </div> ); };
export const InterruptModal = ({ isOpen, onClose, shift, onVacancyCreated }: any) => { const [reason, setReason] = useState('ENFERMEDAD'); const [loading, setLoading] = useState(false); if (!isOpen || !shift) return null; const handleInterrupt = async () => { setLoading(true); try { const now = new Date(); await updateDoc(doc(db, 'turnos', shift.id), { status: 'COMPLETED', isCompleted: true, isPresent: false, realEndTime: serverTimestamp(), interrupted: true, interruptionReason: reason, endTime: Timestamp.fromDate(now) }); const originalEnd = shift.endDateObj; if (originalEnd > now) { const vacancyData = { ...shift, id: undefined, employeeId: 'VACANTE', employeeName: 'VACANTE (REMANENTE)', startTime: Timestamp.fromDate(now), endTime: Timestamp.fromDate(originalEnd), status: 'UNCOVERED_REPORTED', isReported: true, isUnassigned: true, isPresent: false, isCompleted: false, origin: 'INTERRUPTION', originRef: shift.id }; delete vacancyData.id; const docRef = await addDoc(collection(db, 'turnos'), vacancyData); onVacancyCreated({ ...vacancyData, id: docRef.id }); } toast.success("Baja procesada"); onClose(); } catch (e) { toast.error("Error"); } finally { setLoading(false); } }; return ( <div className="fixed inset-0 z-[9000] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-200"> <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-red-200 overflow-hidden"> <ProHeader title="Baja de Servicio" subtitle="Interrupción Operativa" icon={Siren} colorClass="bg-gradient-to-br from-red-600 to-rose-700" onClose={onClose}/> <div className="p-6"> <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Motivo</label> <select className="w-full p-4 border rounded-2xl mb-6 text-sm font-bold text-slate-700 outline-none" value={reason} onChange={e=>setReason(e.target.value)}><option value="ENFERMEDAD">🚑 Enfermedad</option><option value="ABANDONO">🏃 Abandono</option><option value="FAMILIAR">🏠 Emergencia</option><option value="OPERATIVO">👮 Operativo</option></select> <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-3 mb-6"><AlertTriangle className="text-red-500 shrink-0" size={24}/><p className="text-xs text-red-800">Se dará salida al guardia y <b>se creará una VACANTE</b> por el resto del turno.</p></div> <button onClick={handleInterrupt} disabled={loading} className="w-full py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 shadow-xl">{loading ? 'PROCESANDO...' : 'CONFIRMAR BAJA'}</button> </div> </div> </div> ); };
export const CoverageModal = ({ isOpen, onClose, absenceShift }: any) => { const [activeTab, setActiveTab] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL'); const [candidates, setCandidates] = useState<any[]>([]); const [nextShift, setNextShift] = useState<any>(null); const [filter, setFilter] = useState(''); const [isGentileza, setIsGentileza] = useState(true); const [loading, setLoading] = useState(false); useEffect(() => { if (isOpen && absenceShift) { if (!absenceShift.objectiveId) { setActiveTab('EXTERNAL'); return; } const q = query(collection(db, 'empleados'), where('status', 'in', ['activo','active']), limit(50)); getDocs(q).then(snap => setCandidates(snap.docs.map(d => ({id: d.id, ...d.data()})))); try { const qNext = query(collection(db, 'turnos'), where('objectiveId', '==', absenceShift.objectiveId), where('startTime', '>=', absenceShift.endTime || absenceShift.startTime), orderBy('startTime', 'asc'), limit(1)); getDocs(qNext).then(snap => { if (!snap.empty) { const data = snap.docs[0].data(); setNextShift({ id: snap.docs[0].id, ...data, shiftDateObj: data.startTime.toDate() }); } else { setNextShift(null); setActiveTab('EXTERNAL'); } }).catch(() => setActiveTab('EXTERNAL')); } catch (e) { setActiveTab('EXTERNAL'); } } }, [isOpen, absenceShift]); const handleEarlyStart = async () => { if (!nextShift) return; setLoading(true); try { const now = new Date(); await updateDoc(doc(db, 'turnos', nextShift.id), { startTime: Timestamp.fromDate(now), originalStartTime: nextShift.startTime, isEarlyStart: true, comments: 'Adelanto de Ingreso' }); await updateDoc(doc(db, 'turnos', absenceShift.id), { resolutionStatus: 'RESOLVED', resolutionMethod: 'EARLY_START', coveredByShiftId: nextShift.id }); toast.success("Turno adelantado"); onClose(); } catch(e) { toast.error("Error"); } finally { setLoading(false); } }; const handleAssignExternal = async (employee: any) => { setLoading(true); try { const now = new Date(); const originalEnd = absenceShift.endDateObj ? new Date(absenceShift.endDateObj) : new Date(now.getTime() + 8*3600000); const newShift = { employeeId: employee.id, employeeName: `${employee.lastName} ${employee.firstName}`, clientId: absenceShift.clientId, clientName: absenceShift.clientName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, positionName: absenceShift.positionName || 'Cobertura', startTime: Timestamp.fromDate(now), endTime: Timestamp.fromDate(originalEnd), status: 'PRESENT', isPresent: true, isRelief: true, isFullPayCoverage: isGentileza, payComments: isGentileza ? 'PAGO COMPLETO (GENTILEZA)' : 'PAGO PROPORCIONAL' }; await addDoc(collection(db, 'turnos'), newShift); await updateDoc(doc(db, 'turnos', absenceShift.id), { resolutionStatus: 'RESOLVED', resolutionMethod: 'EXTERNAL_COVERAGE' }); toast.success("Cobertura asignada"); onClose(); } catch(e) { toast.error("Error"); } finally { setLoading(false); } }; if (!isOpen) return null; return ( <div className="fixed inset-0 z-[9000] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-200"> <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[85vh]"> <ProHeader title="Mesa de Cobertura" subtitle={absenceShift?.objectiveName || 'Sin Datos'} icon={Shield} colorClass="bg-slate-800" onClose={onClose}/> <div className="flex bg-slate-100 p-2 gap-2 border-b border-slate-200"> <button onClick={() => setActiveTab('INTERNAL')} disabled={!nextShift} className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all ${activeTab === 'INTERNAL' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:bg-white/50 disabled:opacity-50'}`}>RECURSOS INTERNOS</button> <button onClick={() => setActiveTab('EXTERNAL')} className={`flex-1 py-3 text-xs font-bold rounded-xl transition-all ${activeTab === 'EXTERNAL' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:bg-white/50'}`}>BÚSQUEDA EXTERNA</button> </div> <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50"> {activeTab === 'INTERNAL' && nextShift ? ( <div className="bg-white border border-indigo-100 rounded-2xl p-6 shadow-sm"> <h4 className="font-bold text-indigo-900 mb-4 flex items-center gap-2"><Briefcase size={18}/> Siguiente Guardia</h4> <div className="p-4 bg-indigo-50 rounded-xl mb-4 border border-indigo-100"> <p className="font-black text-xl text-slate-800">{nextShift.employeeName}</p> <p className="text-xs text-slate-500 font-bold mt-1">Ingreso: {nextShift.shiftDateObj?.toLocaleTimeString()} • {nextShift.positionName}</p> </div> <button onClick={handleEarlyStart} disabled={loading} className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all"> <ArrowLeft size={20}/> ADELANTAR INGRESO </button> </div> ) : ( <div className="space-y-3"> <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm focus-within:ring-2 focus-within:ring-slate-400 sticky top-0 z-10"> <Search className="text-slate-400 ml-2"/> <input className="flex-1 outline-none text-sm font-medium" placeholder="Buscar guardia..." value={filter} onChange={e=>setFilter(e.target.value)}/> </div> <div className="space-y-2 pb-4"> {candidates.filter(c => JSON.stringify(c).toLowerCase().includes(filter.toLowerCase())).map(c => ( <div key={c.id} className="p-3 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 shadow-sm flex justify-between items-center group"> <div className="flex-1 min-w-0"> <p className="font-bold text-slate-800 text-sm truncate">{c.lastName} {c.firstName}</p> <div className="flex items-center gap-2 mt-1"> <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">DNI: {c.dni || '--'}</span> <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1"><Phone size={10}/> {c.phone || 'S/N'}</span> </div> </div> <div className="flex gap-2 items-center pl-2 border-l border-slate-100"> {c.phone && (<> <button onClick={() => window.open(`https://wa.me/${c.phone.replace(/[^0-9]/g, '')}`)} className="p-2 bg-emerald-100 text-emerald-600 rounded-xl hover:bg-emerald-200 transition-colors" title="WhatsApp"><MessageCircle size={18}/></button> <button onClick={() => window.open(`tel:${c.phone}`)} className="p-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors" title="Llamar"><Phone size={18}/></button> </>)} <button onClick={() => handleAssignExternal(c)} className="px-4 py-2 bg-slate-800 text-white font-bold rounded-xl text-xs hover:bg-black transition-colors shadow-lg ml-1">ASIGNAR</button> </div> </div> ))} </div> <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 sticky bottom-0 z-10 shadow-inner"> <label className="flex items-center gap-3 cursor-pointer"> <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${isGentileza ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 bg-white'}`}>{isGentileza && <CheckCircle size={14}/>}</div> <input type="checkbox" checked={isGentileza} onChange={e=>setIsGentileza(e.target.checked)} className="hidden"/> <div className="flex-1"><p className="font-bold text-sm text-slate-800 flex items-center gap-2"><DollarSign size={16} className="text-emerald-600"/> Pagar Turno Completo (Gentileza)</p><p className="text-[10px] text-emerald-700">Se abonarán las horas completas del turno original.</p></div> </label> </div> </div> )} </div> </div> </div> ); };
export const WorkedDayOffModal = ({ isOpen, onClose, shift, availableShifts, referenceDate, onAudit }: any) => {
    const [loading, setLoading] = useState(false);
    const [targetObjective, setTargetObjective] = useState('');
    const [targetPositionName, setTargetPositionName] = useState('');
    const [targetStart, setTargetStart] = useState<Date | null>(null);
    const [targetEnd, setTargetEnd] = useState<Date | null>(null);
    const [coverageId, setCoverageId] = useState('');
    const [objectives, setObjectives] = useState<any[]>([]);

    const toDateSafe = (v: any): Date | null => {
        if (!v) return null;
        if (v instanceof Date) return v;
        if (typeof v?.toDate === 'function') return v.toDate();
        if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000);
        return null;
    };

    const isSameDay = (a: Date | null, b: Date | null) => {
        if (!a || !b) return false;
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    };

    const formatRange = (start: Date | null, end: Date | null) => {
        const fmt = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        if (start && end) return `${fmt(start)}–${fmt(end)}`;
        if (start) return fmt(start);
        return '--:--';
    };

    useEffect(() => {
        if (!isOpen) return;
        setCoverageId('');
        setTargetObjective('');
        setTargetPositionName('');
        setTargetStart(null);
        setTargetEnd(null);

        getDocs(query(collection(db, 'clients'), limit(50))).then((snap) => {
            const objs: any[] = [];
            snap.docs.forEach((d) => {
                const data = d.data();
                if (data.objetivos) data.objetivos.forEach((o: any) => objs.push({ ...o, clientName: data.name, clientId: d.id }));
            });
            setObjectives(objs);
        });
    }, [isOpen]);

    if (!isOpen || !shift) return null;

    const baseDay = toDateSafe(referenceDate) || new Date();

    const dayCoverageOptions = (Array.isArray(availableShifts) ? availableShifts : [])
        .map((s: any) => {
            const start = s.shiftDateObj || toDateSafe(s.startTime);
            const end = s.endDateObj || toDateSafe(s.endTime);
            return { ...s, _start: start, _end: end };
        })
        .filter((s: any) => {
            if (!isSameDay(s._start, baseDay)) return false;
            if (s.isFranco) return false;
            return !!(s.isUnassigned || s.isAbsenceLike || s.isLateArrival);
        })
        .sort((a: any, b: any) => (a._start?.getTime?.() ?? 0) - (b._start?.getTime?.() ?? 0));

    const selectedCoverage = dayCoverageOptions.find((s: any) => s.id === coverageId);

    const handlePickCoverage = (id: string) => {
        setCoverageId(id);
        const picked = dayCoverageOptions.find((s: any) => s.id === id);
        if (!picked) return;
        if (picked.objectiveId) setTargetObjective(picked.objectiveId);
        setTargetPositionName(picked.positionName || '');
        setTargetStart(picked._start || null);
        setTargetEnd(picked._end || null);
    };

    const handleConvert = async () => {
        const objectiveId = selectedCoverage?.objectiveId || targetObjective;
        if (!objectiveId) return toast.error('Seleccione una vacante/ausencia o un objetivo destino');

        const objFromCatalog = objectives.find((o) => o.id === objectiveId);
        const objectiveName = selectedCoverage?.objectiveName || objFromCatalog?.name || '';
        const clientName = selectedCoverage?.clientName || objFromCatalog?.clientName || '';
        const clientId = selectedCoverage?.clientId || objFromCatalog?.clientId || shift.clientId || undefined;

        if (!objectiveName || !clientName) return toast.error('No pude determinar el objetivo destino');

        const posName = targetPositionName || selectedCoverage?.positionName || shift.positionName || 'Cobertura';

        const startForSave = targetStart || selectedCoverage?._start || toDateSafe(shift.startTime) || null;
        const endForSave = targetEnd || selectedCoverage?._end || toDateSafe(shift.endTime) || null;

        const kind = selectedCoverage?.isUnassigned ? 'VACANTE' : selectedCoverage?.isLateArrival ? 'NO LLEGÓ' : selectedCoverage?.isAbsenceLike ? 'AUSENCIA' : 'EVENTO';
        const coverageLabel = selectedCoverage ? `${kind} ${clientName} - ${objectiveName} • ${posName} • ${formatRange(startForSave, endForSave)}` : `${clientName} - ${objectiveName}`;

        setLoading(true);
        try {
            const payload: any = {
                isFranco: false,
                isFrancoTrabajado: true,
                code: 'FT',
                status: 'PLANIFICADO',
                type: 'EXTRA_FRANCO',
                clientId,
                clientName,
                objectiveId,
                objectiveName,
                positionName: posName,
                comments: `Franco Trabajado (Convocado por Operaciones) - Cubre: ${coverageLabel}`,
                coverageSourceId: selectedCoverage?.id || null,
            };
            if (startForSave) payload.startTime = Timestamp.fromDate(startForSave);
            if (endForSave) payload.endTime = Timestamp.fromDate(endForSave);

            await updateDoc(doc(db, 'turnos', shift.id), payload);
            if (selectedCoverage?.id) {
                await updateDoc(doc(db, 'turnos', selectedCoverage.id), {
                    resolutionStatus: 'RESOLVED',
                    resolutionMethod: 'FRANCO_TRABAJADO',
                    coveredByShiftId: shift.id,
                    resolvedBy: 'OPERACIONES',
                    origin: 'OPERATIONS_COVERAGE',
                });
                if (onAudit) {
                    await onAudit('Franco convocado (doble turno)', `Convocó franco trabajado: ${shift.employeeName} cubre ${objectiveName} (${posName})`, { objectiveName, clientName });
                }
            }
            toast.success('Convocatoria confirmada');
            onClose();
        } catch (e) {
            toast.error('Error al asignar');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9000] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95">
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
                <ProHeader title="Convocar Franco" subtitle={shift.employeeName} icon={WorkIcon} colorClass="bg-gradient-to-br from-emerald-600 to-teal-700" onClose={onClose} />
                <div className="p-6 space-y-4">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                        <p className="text-xs text-emerald-900 font-bold">Elegí qué evento del día va a cubrir para completar automáticamente objetivo, puesto y horario.</p>
                    </div>

                    <label className="text-xs font-bold text-slate-500 uppercase block">Cubrir hoy (Vacantes / Ausencias / No llegó)</label>
                    <select className="w-full p-3 border rounded-xl text-sm bg-slate-50" value={coverageId} onChange={(e) => handlePickCoverage(e.target.value)}>
                        <option value="">Seleccionar...</option>
                        {dayCoverageOptions.map((s: any) => {
                            const kind = s.isUnassigned ? 'VACANTE' : s.isLateArrival ? 'NO LLEGÓ' : s.isAbsenceLike ? 'AUSENCIA' : 'EVENTO';
                            const label = `[${kind}] ${s.clientName || '--'} - ${s.objectiveName || '--'} • ${(s.positionName || 'Cobertura')} • ${formatRange(s._start, s._end)}`;
                            return (
                                <option key={s.id} value={s.id}>
                                    {label}
                                </option>
                            );
                        })}
                    </select>

                    {!selectedCoverage && (
                        <>
                            <div className="text-[11px] text-slate-500 font-medium">Si no elegís un evento, podés seleccionar el objetivo manualmente.</div>
                            <label className="text-xs font-bold text-slate-500 uppercase block">Objetivo de Destino</label>
                            <select className="w-full p-3 border rounded-xl text-sm bg-slate-50" value={targetObjective} onChange={(e) => setTargetObjective(e.target.value)}>
                                <option value="">Seleccionar Objetivo...</option>
                                {objectives.map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.clientName} - {o.name}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}

                    {(selectedCoverage || targetObjective) && (
                        <div className="p-4 bg-white border border-slate-200 rounded-2xl">
                            <p className="text-[10px] uppercase text-slate-400 font-black">Destino</p>
                            <p className="text-sm font-black text-slate-800">{selectedCoverage?.clientName || objectives.find((o) => o.id === targetObjective)?.clientName || '--'} - {selectedCoverage?.objectiveName || objectives.find((o) => o.id === targetObjective)?.name || '--'}</p>
                            <p className="text-xs text-slate-500 font-bold mt-1">{(targetPositionName || selectedCoverage?.positionName || shift.positionName || 'Cobertura')} • {formatRange(targetStart || selectedCoverage?._start || null, targetEnd || selectedCoverage?._end || null)}</p>
                        </div>
                    )}

                    <button onClick={handleConvert} disabled={loading} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg">
                        {loading ? 'Procesando...' : 'CONFIRMAR CONVOCATORIA'}
                    </button>
                </div>
            </div>
        </div>
    );
};
