
import React, { useState, useEffect } from 'react';
import { Clock, UserX, UserCheck, AlertTriangle, ArrowRight, Shield, CheckCircle, Search, DollarSign, Siren, LogOut, Briefcase, ArrowLeft, MapPin, Phone, MessageCircle, X, Briefcase as WorkIcon } from 'lucide-react';
import { doc, updateDoc, serverTimestamp, addDoc, collection, Timestamp, query, where, getDocs, limit, orderBy, writeBatch } from 'firebase/firestore';
import { applyCoverage, syncAusenciaCoberturaGestionada } from '@/lib/operaciones/syncAusenciaCobertura';
import { app, db } from '@/lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { toast } from 'sonner';
import { useEmpresa } from '@/context/EmpresaContext';
import { stampEmpresaId } from '@/lib/multiempresa';

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
export const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => {
    const [loading, setLoading] = useState(false);
    if (!isOpen || !shift) return null;

    const handleLate = async (minutes: number) => {
        if (minutes >= 120) {
            if (confirm('Retraso mayor a 2 h se trata como ausencia. ¿Confirmar?')) onMarkAbsent(shift);
            return;
        }
        setLoading(true);
        try {
            const fn = httpsCallable(getFunctions(app, 'us-central1'), 'notificarLlegadaTarde');
            await fn({ shiftId: shift.id, etaMinutes: minutes });
            toast.success(`Llegada tarde registrada (+${minutes} min)`);
            onClose();
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Error al registrar llegada tarde');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9000] bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in zoom-in-95 duration-200">
            <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
                <ProHeader title="Control de Asistencia" subtitle={shift.employeeName} icon={Clock} colorClass="bg-gradient-to-br from-amber-500 to-orange-600" onClose={onClose}/>
                <div className="p-6 space-y-4">
                    <p className="text-xs text-slate-500">Aviso de llegada tarde (no modifica el horario planificado).</p>
                    <div className="grid grid-cols-2 gap-3">
                        {[15, 30, 60].map((m) => (
                            <button key={m} type="button" disabled={loading} onClick={() => handleLate(m)} className="p-3 border border-slate-200 rounded-2xl hover:bg-amber-50 hover:border-amber-300 text-xs font-bold text-slate-600 flex flex-col items-center gap-1 disabled:opacity-50">
                                <Clock size={18} className="text-slate-300"/> +{m} MIN
                            </button>
                        ))}
                        <button type="button" disabled={loading} onClick={() => handleLate(120)} className="p-3 border border-red-100 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100 text-xs font-bold flex flex-col items-center gap-1 col-span-2 disabled:opacity-50">
                            <AlertTriangle size={18}/> +2 HS (AUSENTE)
                        </button>
                    </div>
                    <button type="button" onClick={() => onMarkAbsent(shift)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2">
                        <UserX size={18}/> CONFIRMAR AUSENCIA
                    </button>
                </div>
            </div>
        </div>
    );
};
export const WorkedDayOffModal = ({ isOpen, onClose, shift, availableShifts, referenceDate, onAudit }: any) => {
    const { empresaId } = useEmpresa();
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
            const tid = String(shift.empresaId || empresaId || '').trim();
            const empId = String(shift.employeeId || '').trim();
            const empName = String(shift.employeeName || '').trim();
            if (!selectedCoverage?.id) {
                toast.error('Seleccioná la vacante/ausencia a cubrir');
                return;
            }
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', shift.id), {
                isFranco: false,
                isFrancoTrabajado: true,
                code: 'FT',
                comments: `Franco Trabajado (Convocado por Operaciones) - Cubre: ${coverageLabel}`,
                coverageSourceId: selectedCoverage.id,
            });
            const startTs = startForSave ? Timestamp.fromDate(startForSave) : null;
            const endTs = endForSave ? Timestamp.fromDate(endForSave) : null;
            const coverDocId = await applyCoverage(db, batch, {
                titularShiftId: String(selectedCoverage.id),
                titularShift: { ...selectedCoverage, id: String(selectedCoverage.id) },
                candidateEmployeeId: empId,
                candidateEmployeeName: empName,
                sourceShiftId: shift.id,
                coverageType: 'FT',
                resolvedBy: 'OPERACIONES',
                empresaId: tid,
                startTime: startTs,
                endTime: endTs,
                code: 'FT',
                objectiveId,
                objectiveName,
                clientId,
                clientName,
                positionName: posName,
            });
            await syncAusenciaCoberturaGestionada(
                db,
                {
                    shiftId: String(selectedCoverage.id),
                    coveredByEmployeeId: empId,
                    coveredByEmployeeName: empName,
                    coverageType: 'FT',
                    empresaId: tid || null,
                    resolvedBy: 'OPERACIONES',
                },
                batch,
            );
            await batch.commit();
            if (onAudit) {
                await onAudit(
                    'Franco convocado (doble turno)',
                    `Convocó franco trabajado: ${empName} cubre ${objectiveName} (${posName}) → ${coverDocId}`,
                    { objectiveName, clientName },
                );
            }
            toast.success('Cobertura FT aplicada');
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
