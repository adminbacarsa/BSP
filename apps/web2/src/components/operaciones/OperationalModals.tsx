import React, { useState, useEffect } from 'react';
import { CheckCircle, Phone, Search, X, Briefcase as WorkIcon } from 'lucide-react';
import { doc, updateDoc, Timestamp, query, limit, getDocs, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';

const ProHeader = ({ title, subtitle, icon: Icon, colorClass, onClose }: any) => (
    <div className={`p-5 text-white flex justify-between items-start ${colorClass}`}>
        <div><h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2"><Icon className="text-white/80" size={20} /> {title}</h3><p className="text-white/80 text-xs font-bold mt-1">{subtitle}</p></div>
        <button onClick={onClose} className="bg-white/20 p-1.5 rounded-lg hover:bg-white/30 transition-colors"><X size={20} className="text-white" /></button>
    </div>
);

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
