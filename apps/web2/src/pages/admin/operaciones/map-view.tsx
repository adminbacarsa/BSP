import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import { Toaster, toast } from 'sonner';
import { doc, updateDoc, serverTimestamp, addDoc, collection, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Radio, Filter, Search, Building2, Shield, Clock, Siren, CheckCircle, LogOut, AlertTriangle, Phone, MessageCircle, Calendar, Send, PlayCircle, EyeOff, Briefcase, X, UserCheck, Navigation, ChevronUp, ChevronDown } from 'lucide-react';
import { WorkedDayOffModal as WorkedDayOffModalPro } from '@/components/operaciones/OperationalModals';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-slate-400 font-mono">CARGANDO MAPA TÁCTICO...</div>, ssr: false });

// --- HELPERS ---
const toDate = (d: any) => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const formatTimeSimple = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const isSameDay = (d1: any, d2: any) => { if (!d1 || !d2) return false; return toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA'); };
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => { if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity; const R = 6371; const dLat = (lat2 - lat1) * (Math.PI / 180); const dLon = (lon2 - lon1) * (Math.PI / 180); const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c; };
const estimateEta = (dist: number) => Math.round((dist / 30) * 60);

// --- COMPONENTE LISTA ---
const SectionList = ({ title, color, expanded, onToggle, items, onAction, onWhatsapp, onPhone, context }: any) => {
    const styles: any = { cyan: { border: 'border-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700', bg: 'bg-cyan-50', btn: 'bg-cyan-600 hover:bg-cyan-700' }, purple: { border: 'border-purple-200', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50', btn: 'bg-purple-600 hover:bg-purple-700' }, slate: { border: 'border-slate-200', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-white', btn: 'bg-slate-800 hover:bg-slate-900' } };
    const s = styles[color] || styles.slate;
    return ( <section className={`relative pl-6 border-l-2 ${s.border}`}> <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${s.dot}`}></div> <h4 className={`text-xs font-black uppercase mb-2 cursor-pointer flex items-center gap-2 ${s.text}`} onClick={onToggle}> {title} {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} </h4> {expanded && ( <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar p-1"> {items?.length > 0 ? items.map((e:any) => ( <div key={e.id} className={`flex justify-between items-center p-2 border rounded-lg shadow-sm ${s.bg}`}> <div> <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span> {context === 'INTERCAMBIO' && <span className="text-[10px] text-purple-700 block">{e.objectiveName} (Quedan: {e.remainingGuards})</span>} {Number.isFinite(e.distance) && ( <div className="flex items-center gap-2 mt-0.5"> <span className="text-[9px] bg-white border px-1.5 rounded text-slate-500 flex items-center gap-1"><Navigation size={8}/> {e.distance.toFixed(1)} km</span> <span className="text-[9px] text-slate-400">~{e.eta} min</span> </div> )} </div> <div className="flex gap-1"> <button onClick={()=>onAction(e)} className={`px-2 py-1.5 text-white text-[10px] font-bold rounded shadow-sm ${s.btn}`}> {context === 'INTERCAMBIO' ? 'MOVER' : 'ASIGNAR'} </button> </div> </div> )) : <p className="text-[10px] text-slate-400 italic">No hay candidatos.</p>} </div> )} </section> );
};

// --- MODALES (INTEGRADOS) ---
const HandoverModal = ({ isOpen, onClose, incomingShift, logic }: any) => {
    if (!isOpen || !incomingShift) return null;
    const now = new Date(); const start = toDate(incomingShift.shiftDateObj); const diffMin = (now.getTime() - start.getTime()) / 60000;
    let status = 'ON_TIME'; if (diffMin > 5) status = 'LATE';
    const activeGuards = logic.processedData.filter((s:any) => s.objectiveId === incomingShift.objectiveId && s.positionName === incomingShift.positionName && (s.isPresent || s.status === 'COMPLETED') && s.id !== incomingShift.id && toDate(s.endDateObj).getTime() <= (start.getTime() + 3600000));
    const handleConfirm = async (prevShiftId: string | null) => { try { await updateDoc(doc(db, 'turnos', incomingShift.id), { isPresent: true, status: 'PRESENT', checkInTime: serverTimestamp(), isLate: status === 'LATE' }); if (prevShiftId) { await updateDoc(doc(db, 'turnos', prevShiftId), { checkOutTime: serverTimestamp(), isCompleted: true, status: 'COMPLETED' }); } toast.success(status === 'LATE' ? 'Ingreso Tarde registrado.' : 'Ingreso Correcto.'); onClose(); } catch (e) { toast.error("Error al procesar relevo."); } };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4"> <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${status==='LATE' ? 'bg-amber-500' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"> {status==='LATE' ? <Clock size={20}/> : <UserCheck size={20}/>} {status==='LATE' ? 'Llegada Tarde' : 'Ingreso A Tiempo'} </h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <p className="text-sm text-slate-600 mb-4"> El guardia <b>{incomingShift.employeeName}</b> está listo para ingresar. {status==='LATE' && <span className="block mt-1 text-amber-600 font-bold">⚠️ Retraso de {Math.round(diffMin)} minutos.</span>} </p> {activeGuards.length > 0 ? ( <div className="space-y-2 mb-4"> <p className="text-xs font-bold text-slate-400 uppercase">Seleccione a quién relevar:</p> {activeGuards.map((s:any) => ( <button key={s.id} onClick={() => handleConfirm(s.id)} className="w-full p-3 border rounded-xl hover:bg-slate-50 flex justify-between items-center group"> <div className="text-left"> <span className="block text-xs font-bold text-slate-700">{s.employeeName}</span> <span className="block text-[10px] text-slate-400">Salida: {formatTimeSimple(s.endDateObj)}</span> </div> <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600 group-hover:bg-slate-800 group-hover:text-white transition-colors">RELEVAR</span> </button> ))} </div> ) : ( <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center mb-4"> <p className="text-xs text-slate-400 italic">No hay guardia saliente registrado.</p> </div> )} <button onClick={() => handleConfirm(null)} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors"> {activeGuards.length > 0 ? 'INGRESAR SIN RELEVAR' : 'CONFIRMAR INGRESO'} </button> </div> </div> </div> );
};

const InterruptModal = ({ isOpen, onClose, shift, logic, onVacancyCreated }: any) => {
    if (!isOpen || !shift) return null;
    const colleagues = logic.processedData.filter((s:any) => s.objectiveId === shift.objectiveId && s.id !== shift.id && (s.isPresent || s.status === 'PRESENT') && !s.isCompleted);
    const isAlone = colleagues.length === 0;
    const handleLog = async () => { await addDoc(collection(db, 'novedades'), { type: 'BAJA_CUBIERTA', shiftId: shift.id, details: 'Retiro anticipado. Puesto cubierto por dotación.' }); await updateDoc(doc(db, 'turnos', shift.id), { checkOutTime: serverTimestamp(), status: 'COMPLETED', comments: 'Baja anticipada (Cubierto)' }); toast.success("Baja registrada. Puesto cubierto."); onClose(); };
    const handleProtocol = async () => { await updateDoc(doc(db, 'turnos', shift.id), { status: 'INTERRUPTED', checkOutTime: serverTimestamp() }); const newRef = await addDoc(collection(db, 'turnos'), { ...shift, id: undefined, startTime: serverTimestamp(), employeeId: 'VACANTE', employeeName: 'VACANTE (BAJA)', isUnassigned: true, isPresent: false }); const newShift = { ...shift, id: newRef.id, isUnassigned: true }; onVacancyCreated(newShift); };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4"> <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${isAlone ? 'bg-purple-600' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"><Siren size={20}/> Baja Anticipada</h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <div className={`p-4 rounded-xl border mb-4 ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}> <h4 className={`font-bold text-sm mb-1 ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}> {isAlone ? '⚠️ GUARDIA SOLO EN EL OBJETIVO' : `✅ HAY ${colleagues.length} COMPAÑEROS`} </h4> <p className="text-xs text-slate-500"> {isAlone ? 'El puesto quedará descubierto. Se requiere activar protocolo.' : 'El puesto puede ser cubierto por la dotación actual.'} </p> </div> {isAlone ? ( <button onClick={handleProtocol} className="w-full py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 animate-pulse shadow-lg shadow-purple-200"> INICIAR PROTOCOLO DE COBERTURA </button> ) : ( <button onClick={handleLog} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200"> REGISTRAR NOVEDAD (CUBIERTO) </button> )} </div> </div> </div> );
};

const CoverageModal = ({ isOpen, onClose, absenceShift, logic }: any) => {
    const [expanded, setExpanded] = useState<number | null>(3);
    const [loading, setLoading] = useState(false);
    if (!isOpen || !absenceShift) return null;

    const shiftStart = toDate(absenceShift.shiftDateObj);
    const shiftEnd = toDate(absenceShift.endDateObj || new Date(shiftStart.getTime() + 8 * 3600000));
    const now = new Date();
    const isVirtual = !!absenceShift.isVirtual || String(absenceShift.id || '').startsWith('V124_') || String(absenceShift.id || '').startsWith('SLA_GAP');

    const objLat = absenceShift.lat || -31.4201;
    const objLng = absenceShift.lng || -64.1888;

    const presentInObjective = (logic.processedData || []).filter((s: any) => {
        if (s.objectiveId !== absenceShift.objectiveId) return false;
        if (!s.isPresent || s.isCompleted) return false;
        const sStart = toDate(s.shiftDateObj);
        const sEnd = toDate(s.endDateObj || new Date(sStart.getTime() + 8 * 3600000));
        return sStart <= now && sEnd >= now;
    });
    const presentSamePosition = presentInObjective.filter((s: any) => (s.positionName || '') === (absenceShift.positionName || ''));

    const prevShifts = (logic.processedData || []).filter((s: any) => {
        if (s.objectiveId !== absenceShift.objectiveId) return false;
        if ((s.positionName || '') !== (absenceShift.positionName || '')) return false;
        if (!(s.isPresent || s.status === 'COMPLETED')) return false;
        return toDate(s.endDateObj).getTime() <= (shiftStart.getTime() + 3600000);
    });

    const neighbors = (logic.objectives || [])
        .filter((o: any) => o.id !== absenceShift.objectiveId)
        .map((o: any) => {
            const dist = calculateDistance(objLat, objLng, o.lat || objLat, o.lng || objLng);
            const guards = (logic.processedData || []).filter((s: any) => s.objectiveId === o.id && s.isPresent).length;
            return { ...o, distance: dist, activeGuards: guards };
        })
        .filter((o: any) => o.distance <= 2 && o.activeGuards >= 2)
        .sort((a: any, b: any) => a.distance - b.distance);

    const neighborGuards = neighbors.flatMap((n: any) =>
        (logic.processedData || [])
            .filter((s: any) => s.objectiveId === n.id && s.isPresent)
            .map((s: any) => ({ ...s, distance: n.distance, eta: estimateEta(n.distance), objectiveName: n.name, remainingGuards: n.activeGuards - 1 }))
    );

    const busyIdsAnyShiftToday = new Set(
        (logic.processedData || [])
            .filter((s: any) => isSameDay(s.shiftDateObj, shiftStart) && s?.employeeId && s.employeeId !== 'VACANTE' && s.isValidEmployee)
            .map((s: any) => s.employeeId)
    );

    const libresHoy = (logic.employees || [])
        .filter((e: any) => e?.id && !busyIdsAnyShiftToday.has(e.id))
        .map((e: any) => ({ ...e, employeeName: e.fullName || `${e.lastName || ''} ${e.firstName || ''}`.trim() }))
        .slice(0, 20);

    const getLatLng = (e: any) => {
        const parse = (v: any) => {
            if (typeof v === 'number') return v;
            if (typeof v === 'string') {
                const n = parseFloat(v.replace(',', '.'));
                return Number.isFinite(n) ? n : null;
            }
            return null;
        };

        const latRaw =
            e?.coords?.lat ?? e?.coords?.latitude ??
            e?.lastLocation?.lat ?? e?.lastLocation?.latitude ??
            e?.location?.lat ?? e?.location?.latitude ??
            e?.geo?.lat ?? e?.geo?.latitude ??
            e?.geopoint?.lat ?? e?.geopoint?.latitude ??
            e?.lat ?? e?.latitude;

        const lngRaw =
            e?.coords?.lng ?? e?.coords?.lon ?? e?.coords?.longitude ??
            e?.lastLocation?.lng ?? e?.lastLocation?.longitude ??
            e?.location?.lng ?? e?.location?.longitude ??
            e?.geo?.lng ?? e?.geo?.longitude ??
            e?.geopoint?.lng ?? e?.geopoint?.longitude ??
            e?.lng ?? e?.lon ?? e?.longitude;

        const lat = parse(latRaw);
        const lng = parse(lngRaw);
        if (lat === null || lng === null) return null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
    };

    const volantes = (logic.employees || [])
        .filter((e: any) => e?.id && !busyIdsAnyShiftToday.has(e.id))
        .map((e: any) => {
            const coords = getLatLng(e);
            const dist = coords ? calculateDistance(objLat, objLng, coords.lat, coords.lng) : Infinity;
            return { ...e, employeeName: e.fullName || `${e.lastName || ''} ${e.firstName || ''}`.trim(), distance: dist, eta: Number.isFinite(dist) ? estimateEta(dist) : null };
        })
        .filter((e: any) => Number.isFinite(e.distance))
        .sort((a: any, b: any) => a.distance - b.distance)
        .slice(0, 12);

    const nextShift = (logic.processedData || [])
        .filter((s: any) => {
            if (s.objectiveId !== absenceShift.objectiveId) return false;
            if ((s.positionName || '') !== (absenceShift.positionName || '')) return false;
            if (s.isUnassigned || s.isFranco) return false;
            const sStart = toDate(s.shiftDateObj);
            return sStart > now && sStart <= shiftEnd;
        })
        .sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime())[0];

    const francosHoy = (logic.processedData || []).filter((s: any) => s.isFranco && isSameDay(s.shiftDateObj, shiftStart)).slice(0, 15);

    const ensureRealShiftId = async () => {
        if (!isVirtual) return absenceShift.id;
        const payload: any = {
            employeeId: 'VACANTE',
            employeeName: 'VACANTE',
            clientId: absenceShift.clientId || null,
            clientName: absenceShift.clientName || null,
            objectiveId: absenceShift.objectiveId || null,
            objectiveName: absenceShift.objectiveName || null,
            positionName: absenceShift.positionName || 'Cobertura',
            startTime: Timestamp.fromDate(shiftStart),
            endTime: Timestamp.fromDate(shiftEnd),
            status: 'PENDING',
            isUnassigned: true,
            createdAt: serverTimestamp(),
            origin: 'OPERATIONS_MATERIALIZE',
        };
        const ref = await addDoc(collection(db, 'turnos'), payload);
        return ref.id;
    };

    const handleAssign = async (emp: any, type: string) => {
        setLoading(true);
        try {
            const realId = await ensureRealShiftId();
            await updateDoc(doc(db, 'turnos', realId), {
                employeeId: emp.id,
                employeeName: emp.fullName || emp.employeeName,
                isUnassigned: false,
                status: 'PENDING',
                assignmentType: type,
                resolvedBy: 'OPERACIONES',
                origin: 'OPERATIONS_COVERAGE',
            });
            toast.success(`Asignado: ${emp.fullName || emp.employeeName}`);
            onClose();
        } catch (e) {
            toast.error('Error al asignar');
        } finally {
            setLoading(false);
        }
    };

    const handleEarlyStart = async () => {
        if (!nextShift?.id) return;
        setLoading(true);
        try {
            const realId = await ensureRealShiftId();
            await updateDoc(doc(db, 'turnos', nextShift.id), {
                startTime: Timestamp.fromDate(now),
                originalStartTime: nextShift.startTime || Timestamp.fromDate(toDate(nextShift.shiftDateObj)),
                isEarlyStart: true,
                comments: 'Adelanto de Ingreso (Operaciones)',
            });
            await updateDoc(doc(db, 'turnos', realId), {
                resolutionStatus: 'RESOLVED',
                resolutionMethod: 'EARLY_START',
                coveredByShiftId: nextShift.id,
                resolvedBy: 'OPERACIONES',
                origin: 'OPERATIONS_COVERAGE',
            });
            toast.success('Turno adelantado');
            onClose();
        } catch (e) {
            toast.error('Error al adelantar');
        } finally {
            setLoading(false);
        }
    };

    const handleConvocarFranco = async (francoShift: any) => {
        if (!francoShift?.id) return;
        setLoading(true);
        try {
            const realId = await ensureRealShiftId();
            await updateDoc(doc(db, 'turnos', francoShift.id), {
                isFranco: false,
                isFrancoTrabajado: true,
                code: 'FT',
                type: 'EXTRA_FRANCO',
                status: 'PLANIFICADO',
                clientId: absenceShift.clientId || null,
                clientName: absenceShift.clientName || null,
                objectiveId: absenceShift.objectiveId || null,
                objectiveName: absenceShift.objectiveName || null,
                positionName: absenceShift.positionName || 'Cobertura',
                startTime: Timestamp.fromDate(shiftStart),
                endTime: Timestamp.fromDate(shiftEnd),
                comments: `Franco Trabajado (Convocado por Operaciones) - Cubre vacante/ausencia ${absenceShift.objectiveName} (${absenceShift.positionName})`,
                resolvedBy: 'OPERACIONES',
                origin: 'OPERATIONS_COVERAGE',
                coverageSourceId: realId,
            });
            await updateDoc(doc(db, 'turnos', realId), {
                resolutionStatus: 'RESOLVED',
                resolutionMethod: 'FRANCO',
                coveredByShiftId: francoShift.id,
                resolvedBy: 'OPERACIONES',
                origin: 'OPERATIONS_COVERAGE',
            });
            toast.success('Franco convocado');
            onClose();
        } catch (e) {
            toast.error('Error al convocar franco');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-4 bg-rose-600 text-white flex justify-between items-center shrink-0">
                    <h3 className="font-black uppercase flex items-center gap-2">
                        <Siren size={20} /> Cobertura {absenceShift.isUnassigned ? 'de Vacante' : 'de Ausencia'}
                    </h3>
                    <button onClick={onClose}><X size={20} /></button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar space-y-4 flex-1">
                    <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-xs text-rose-800 font-medium">
                        Puesto descubierto en <b>{absenceShift.objectiveName}</b> ({absenceShift.positionName}). {isVirtual && <span className="ml-2 font-black">VACANTE VIRTUAL</span>}
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-700 font-medium">
                        Dotación actual: <b>{presentInObjective.length}</b> en objetivo • <b>{presentSamePosition.length}</b> en este puesto.
                    </div>

                    <section className="space-y-2">
                        <h4 className="text-xs font-black text-indigo-700 uppercase">1. Retención (Doble Turno)</h4>
                        {prevShifts.length > 0 ? (
                            prevShifts.map((s: any) => (
                                <div key={s.id} className="flex justify-between items-center p-2 bg-indigo-50 border border-indigo-100 rounded-lg">
                                    <span className="text-xs font-bold text-slate-700">{s.employeeName}</span>
                                    <button disabled={loading} onClick={() => handleAssign({ id: s.employeeId, fullName: s.employeeName }, 'RETENTION')} className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded disabled:opacity-50">
                                        DOBLAR
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="text-[10px] text-slate-400 italic">No hay candidatos para retención.</p>
                        )}
                    </section>

                    <SectionList title="2. Intercambio (Vecinos < 2km)" color="purple" expanded={expanded === 2} onToggle={() => setExpanded(expanded === 2 ? null : 2)} items={neighborGuards} onAction={(e: any) => handleAssign(e, 'SWAP')} context="INTERCAMBIO" />
                    <SectionList title="3. Sin Turno Asignado / Retenes" color="cyan" expanded={expanded === 3} onToggle={() => setExpanded(expanded === 3 ? null : 3)} items={libresHoy} onAction={(e: any) => handleAssign(e, 'LIBRE')} context="COBERTURA" />
                    <SectionList title="4. Volantes (Por Cercanía)" color="slate" expanded={expanded === 4} onToggle={() => setExpanded(expanded === 4 ? null : 4)} items={volantes} onAction={(e: any) => handleAssign(e, 'VOLANTE')} context="COBERTURA" />

                    <section className="space-y-2">
                        <h4 className="text-xs font-black text-amber-700 uppercase">5. Adelantar Turno Siguiente</h4>
                        {nextShift ? (
                            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex justify-between items-center">
                                <div>
                                    <div className="text-xs font-black text-slate-800">{nextShift.employeeName}</div>
                                    <div className="text-[10px] text-slate-500 font-bold">Ingreso: {formatTimeSimple(nextShift.shiftDateObj)} • {nextShift.positionName}</div>
                                </div>
                                <button disabled={loading} onClick={handleEarlyStart} className="px-3 py-2 bg-amber-600 text-white text-[10px] font-black rounded-lg hover:bg-amber-700 disabled:opacity-50">
                                    ADELANTAR
                                </button>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-400 italic">No hay siguiente guardia en ventana.</p>
                        )}
                    </section>

                    <section className="space-y-2">
                        <h4 className="text-xs font-black text-emerald-700 uppercase">6. Convocar Franco</h4>
                        {francosHoy.length > 0 ? (
                            francosHoy.map((s: any) => (
                                <div key={s.id} className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex justify-between items-center">
                                    <div>
                                        <div className="text-xs font-black text-slate-800">{s.employeeName}</div>
                                        <div className="text-[10px] text-slate-500 font-bold">Disponible hoy</div>
                                    </div>
                                    <button disabled={loading} onClick={() => handleConvocarFranco(s)} className="px-3 py-2 bg-emerald-600 text-white text-[10px] font-black rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                                        CONVOCAR
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="text-[10px] text-slate-400 italic">No hay francos disponibles hoy.</p>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};

const SimpleCheckOutModal = ({ isOpen, onClose, onConfirm, employeeName }: any) => { const [novedad, setNovedad] = useState(''); if (!isOpen) return null; return (<div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl p-6"><h3 className="font-bold mb-4">Salida: {employeeName}</h3><button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold mb-2">Salida Normal</button><textarea className="w-full p-2 border rounded mb-2" placeholder="Novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/><button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} className="w-full py-2 bg-slate-100 font-bold rounded">Reportar y Salir</button><button onClick={onClose} className="mt-2 text-sm text-slate-400 w-full">Cancelar</button></div></div>); };
const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => { if (!isOpen) return null; return ( <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"> <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"> <h3 className="font-bold mb-2">Retención de Guardia</h3> <p className="text-sm text-slate-500 mb-4">{retainedShift?.employeeName || 'Guardia'}</p> <button onClick={onClose} className="w-full py-2 bg-slate-100 rounded font-bold">Cerrar</button> </div> </div> ); };
const WorkedDayOffModal = (props: any) => <WorkedDayOffModalPro {...props} />;
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 text-center"><AlertTriangle size={48} className="mx-auto text-amber-500 mb-4"/><h3 className="font-bold text-lg mb-2">Confirmar Ausencia</h3><p className="text-sm text-slate-500 mb-6">¿{shift?.employeeName} no se presentó?</p><button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold mb-2">MARCAR AUSENTE</button><button onClick={onClose} className="text-sm text-slate-400">Cancelar</button></div></div>); };

export default function TacticalMapView() {
    const logic = useOperacionesMonitor();
    const [checkoutData, setCheckoutData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [attendanceData, setAttendanceData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [handoverData, setHandoverData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [interruptData, setInterruptData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [coverageData, setCoverageData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [workedFrancoData, setWorkedFrancoData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [showHelp, setShowHelp] = useState(false);

    const handleMarkAbsent = async (shift: any) => { try { await updateDoc(doc(db, 'turnos', shift.id), { status: 'ABSENT', isAbsent: true }); setAttendanceData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: shift}); } catch (e) { toast.error("Error al marcar ausencia"); } };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };
    const handleReportPlanning = async (shift: any) => { toast.info("Reportando..."); };

    // --- SYNC FILTROS ---
    useEffect(() => {
        const syncFilters = () => {
            const saved = localStorage.getItem('crono_ops_filters');
            if (saved) {
                try {
                    const { tab, client, text } = JSON.parse(saved);
                    logic.setViewTab(tab);
                    logic.setSelectedClientId(client);
                    logic.setFilterText(text);
                } catch (e) { console.error(e); }
            }
        };
        syncFilters();
        window.addEventListener('storage', (e) => { if (e.key === 'crono_ops_filters') syncFilters(); });
        return () => window.removeEventListener('storage', () => {});
    }, []);

    const tabs = [
        { id: 'PRIORIDAD', label: 'PRIO', count: logic.stats.prioridad, color: 'text-rose-600' },
        { id: 'NO_LLEGO', label: 'NO LLEGO', count: logic.stats.no_llego, color: 'text-amber-600' },
        { id: 'PLAN', label: 'PLAN', count: logic.stats.plan, color: 'text-indigo-600' },
        { id: 'ACTIVOS', label: 'ACT', count: logic.stats.activos, color: 'text-emerald-600' },
        { id: 'RETENIDOS', label: 'RET', count: logic.stats.retenidos, color: 'text-orange-600' },
        { id: 'VACANTES', label: 'VAC', count: logic.stats.vacantes, color: 'text-slate-800' },
        { id: 'AUSENTES', label: 'AUS', count: logic.stats.ausentes, color: 'text-slate-500' },
        { id: 'FRANCOS', label: 'FRAN', count: logic.stats.francos, color: 'text-blue-600' }
    ];

    // En el mapa táctico, además de colorear por categoría, ocultamos objetivos sin datos en la solapa activa
    // (excepto en "MAPA GENERAL").
    const objectivesForMap = useMemo(() => {
        if (logic.viewTab === 'TODOS') return logic.filteredObjectives;
        const ids = new Set((logic.listData || []).map((s:any) => s.objectiveId).filter(Boolean));
        return (logic.filteredObjectives || []).filter((o:any) => ids.has(o.id));
    }, [logic.filteredObjectives, logic.listData, logic.viewTab]);

    return (
        <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
            <Head><title>COSP TACTICAL V184.0</title></Head>
            <style>{POPUP_STYLES}</style>
            <Toaster position="top-center" theme="dark" />
            
            <div className="absolute top-4 left-4 right-4 z-[1000] flex gap-2 justify-between pointer-events-none">
                <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl p-2 flex items-center gap-3 border border-slate-200 pointer-events-auto">
                    <div className="flex items-center gap-2 px-3 border-r border-slate-200 pr-4"><Radio className="text-rose-600 animate-pulse" size={20} /><div><h1 className="font-black text-slate-800 text-sm leading-none">COSP TACTICAL</h1><span className="text-[10px] text-slate-500 font-bold">V184.0 LIVE</span></div></div>
                    <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200"><Filter size={14} className="text-slate-400 ml-1"/><select value={logic.selectedClientId} onChange={(e) => logic.setSelectedClientId(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-40 cursor-pointer"><option value="">TODOS LOS CLIENTES</option>{logic.uniqueClients.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                    <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-64"><Search size={14} className="text-slate-400 ml-1"/><input className="bg-transparent text-xs font-bold text-slate-700 outline-none w-full placeholder:text-slate-400" placeholder="Buscar guardia, objetivo..." value={logic.filterText} onChange={e => logic.setFilterText(e.target.value)}/></div>
                </div>
                <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl p-1.5 flex gap-1 pointer-events-auto border border-slate-200">
                    <button onClick={() => logic.setViewTab('TODOS')} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${logic.viewTab === 'TODOS' ? 'bg-slate-800 text-white shadow-md' : 'hover:bg-slate-100 text-slate-500'}`}>MAPA GENERAL</button>
                    {tabs.map(t => (<button key={t.id} onClick={() => logic.setViewTab(t.id as any)} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${logic.viewTab === t.id ? 'bg-white shadow-md ring-1 ring-slate-200 ' + t.color : 'hover:bg-slate-100 text-slate-400'}`}>{t.label} <span className="bg-slate-100 px-1.5 rounded-md ml-1 text-slate-600">{t.count}</span></button>))}
                    <button onClick={() => setShowHelp(true)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all bg-slate-900 text-white hover:bg-slate-800">Ayuda</button>
                </div>
            </div>

            <OperacionesMap 
                center={[-31.4201, -64.1888]} 
                // 🛑 CRÍTICO: PASAR "allObjectives" (Base instalada) Y "filteredShifts" (Datos)
                allObjectives={objectivesForMap} 
                filteredShifts={logic.listData} 
                
                onOpenCoverage={(s:any)=>setCoverageData({isOpen:true, shift:s})} 
                onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})} 
                onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})} 
                onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})} 
                onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})} 
                onReportPlanning={handleReportPlanning} 
            />

            {showHelp && (
                <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800">Ayuda Operaciones (Mapa)</h3>
                            <button type="button" onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-slate-700">Cerrar</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
                            <div className="bg-slate-50 border rounded-xl p-3">
                                <p className="font-black text-slate-700 mb-2">Mapa</p>
                                <p>- Colores: Verde activo, Ámbar tarde, Rojo ausencia/vacante, Azul franco.</p>
                                <p>- DESCUBIERTO parpadea en rojo.</p>
                                <p>- Click en marcador para acciones.</p>
                            </div>
                            <div className="bg-slate-50 border rounded-xl p-3">
                                <p className="font-black text-slate-700 mb-2">Filtros</p>
                                <p>- Solapas: cambian la categoría (y ocultan objetivos sin datos).</p>
                                <p>- Cliente y búsqueda aplican sobre objetivos/turnos.</p>
                            </div>
                            <div className="bg-slate-50 border rounded-xl p-3">
                                <p className="font-black text-slate-700 mb-2">Atajos</p>
                                <p>- Los atajos A/P/C/D aplican en la vista lista de Operaciones (no en el mapa).</p>
                            </div>
                            <div className="bg-slate-50 border rounded-xl p-3">
                                <p className="font-black text-slate-700 mb-2">Resolución</p>
                                <p>- Cobertura: retención, intercambio, volantes, adelanto, franco.</p>
                                <p>- Dejar descubierto marca ausencia y lo saca de prioridad.</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            <AttendanceModal isOpen={attendanceData.isOpen} onClose={()=>setAttendanceData({isOpen:false, shift:null})} shift={attendanceData.shift} onMarkAbsent={handleMarkAbsent} />
            <HandoverModal isOpen={handoverData.isOpen} onClose={()=>setHandoverData({isOpen:false, shift:null})} incomingShift={handoverData.shift} logic={logic} />
            <InterruptModal isOpen={interruptData.isOpen} onClose={()=>setInterruptData({isOpen:false, shift:null})} shift={interruptData.shift} logic={logic} onVacancyCreated={handleVacancyCreated} />
            <CoverageModal isOpen={coverageData.isOpen} onClose={()=>setCoverageData({isOpen:false, shift:null})} absenceShift={coverageData.shift} logic={logic} />
            <WorkedDayOffModal
                isOpen={workedFrancoData.isOpen}
                onClose={() => setWorkedFrancoData({ isOpen: false, shift: null })}
                shift={workedFrancoData.shift}
                availableShifts={logic.processedData}
                referenceDate={logic.now}
            />
            <SimpleCheckOutModal isOpen={checkoutData.isOpen} onClose={() => setCheckoutData({isOpen:false, shift:null})} onConfirm={(nov:string|null) => { if (checkoutData.shift?.id) logic.handleAction('CHECKOUT', checkoutData.shift.id, nov); }} employeeName={checkoutData.shift?.employeeName} />
            <RetentionModal isOpen={false} onClose={()=>{}} retainedShift={null} />
        </div>
    );
}