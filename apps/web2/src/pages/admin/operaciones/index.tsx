import React, { useState, useMemo, useEffect } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { 
    Radio, Search, Layers, Maximize2, Minimize2, MonitorUp, Building2, Shield, 
    Clock, Siren, CheckCircle, LogOut, AlertTriangle, ClipboardList, Printer, 
    Phone, MessageCircle, Calendar, ChevronDown, ChevronRight, ChevronUp, 
    Filter, Send, PlayCircle, EyeOff, X, Briefcase, UserX, CornerUpLeft, 
    MapPin, UserCheck, Navigation, Users, ArrowLeftRight 
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, updateDoc, serverTimestamp, addDoc, collection, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-full flex items-center justify-center text-slate-400">Cargando Mapa...</div>, ssr: false });

// --- HELPERS ---
const toDate = (d: any) => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const formatTimeSimple = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const formatDateShort = (dateObj: any) => { try { return toDate(dateObj).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Cordoba' }).toUpperCase(); } catch (e) { return '--/--'; } };
const formatTimeRange = (start: any, end: any) => { try { return `${toDate(start).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})} - ${toDate(end).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})}`; } catch { return '--:--'; } };
const isSameDay = (d1: any, d2: any) => { if (!d1 || !d2) return false; return toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA'); };
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => { if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity; const R = 6371; const dLat = (lat2 - lat1) * (Math.PI / 180); const dLon = (lon2 - lon1) * (Math.PI / 180); const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c; };
const estimateEta = (dist: number) => Math.round((dist / 30) * 60);

// --- COMPONENTE LISTA ---
const SectionList = ({ title, color, expanded, onToggle, items, onAction, onWhatsapp, onPhone, context }: any) => {
    const styles: any = { cyan: { border: 'border-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700', bg: 'bg-cyan-50', btn: 'bg-cyan-600 hover:bg-cyan-700' }, purple: { border: 'border-purple-200', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50', btn: 'bg-purple-600 hover:bg-purple-700' }, slate: { border: 'border-slate-200', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-white', btn: 'bg-slate-800 hover:bg-slate-900' } };
    const s = styles[color] || styles.slate;
    return ( <section className={`relative pl-6 border-l-2 ${s.border}`}> <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${s.dot}`}></div> <h4 className={`text-xs font-black uppercase mb-2 cursor-pointer flex items-center gap-2 ${s.text}`} onClick={onToggle}> {title} {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} </h4> {expanded && ( <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar p-1"> {items?.length > 0 ? items.map((e:any) => ( <div key={e.id} className={`flex justify-between items-center p-2 border rounded-lg shadow-sm ${s.bg}`}> <div> <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span> {context === 'INTERCAMBIO' && <span className="text-[10px] text-purple-700 block">{e.objectiveName} (Quedan: {e.remainingGuards})</span>} {e.distance !== undefined && e.distance < 1000 && ( <div className="flex items-center gap-2 mt-0.5"> <span className="text-[9px] bg-white border px-1.5 rounded text-slate-500 flex items-center gap-1"><Navigation size={8}/> {e.distance.toFixed(1)} km</span> <span className="text-[9px] text-slate-400">~{e.eta} min</span> </div> )} </div> <div className="flex gap-1"> <button onClick={()=>onWhatsapp(e)} className="p-1.5 bg-white text-emerald-600 border rounded hover:bg-emerald-50"><MessageCircle size={14}/></button> <button onClick={()=>onPhone(e)} className="p-1.5 bg-white text-blue-600 border rounded hover:bg-blue-50"><Phone size={14}/></button> <button onClick={()=>onAction(e)} className={`px-2 py-1.5 text-white text-[10px] font-bold rounded shadow-sm ${s.btn}`}> {context === 'INTERCAMBIO' ? 'MOVER' : 'ASIGNAR'} </button> </div> </div> )) : <p className="text-[10px] text-slate-400 italic">No hay candidatos.</p>} </div> )} </section> );
};

// --- MODALES (LÓGICA OPERATIVA) ---
const HandoverModal = ({ isOpen, onClose, incomingShift, logic }: any) => {
    if (!isOpen || !incomingShift) return null;
    const now = new Date(); const start = toDate(incomingShift.shiftDateObj); const diffMin = (now.getTime() - start.getTime()) / 60000;
    let status = 'ON_TIME'; if (diffMin > 5) status = 'LATE';
    const activeGuards = logic.processedData.filter((s:any) => s.objectiveId === incomingShift.objectiveId && s.positionName === incomingShift.positionName && (s.isPresent || s.status === 'COMPLETED') && s.id !== incomingShift.id && toDate(s.endDateObj).getTime() <= (start.getTime() + 3600000));
    const handleConfirm = async (prevShiftId: string | null) => { try { await updateDoc(doc(db, 'turnos', incomingShift.id), { isPresent: true, status: 'PRESENT', checkInTime: serverTimestamp(), isLate: status === 'LATE' }); if (prevShiftId) { await updateDoc(doc(db, 'turnos', prevShiftId), { checkOutTime: serverTimestamp(), isCompleted: true, status: 'COMPLETED' }); } toast.success(status === 'LATE' ? 'Ingreso Tarde registrado.' : 'Ingreso Correcto.'); onClose(); } catch (e) { toast.error("Error al procesar relevo."); } };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in zoom-in-95"> <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${status==='LATE' ? 'bg-amber-500' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"> {status==='LATE' ? <Clock size={20}/> : <UserCheck size={20}/>} {status==='LATE' ? 'Llegada Tarde' : 'Ingreso A Tiempo'} </h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <p className="text-sm text-slate-600 mb-4"> El guardia <b>{incomingShift.employeeName}</b> está listo para ingresar. {status==='LATE' && <span className="block mt-1 text-amber-600 font-bold">⚠️ Retraso de {Math.round(diffMin)} minutos.</span>} </p> {activeGuards.length > 0 ? ( <div className="space-y-2 mb-4"> <p className="text-xs font-bold text-slate-400 uppercase">Seleccione a quién relevar:</p> {activeGuards.map((s:any) => ( <button key={s.id} onClick={() => handleConfirm(s.id)} className="w-full p-3 border rounded-xl hover:bg-slate-50 flex justify-between items-center group"> <div className="text-left"> <span className="block text-xs font-bold text-slate-700">{s.employeeName}</span> <span className="block text-[10px] text-slate-400">Salida: {formatTimeSimple(s.endDateObj)}</span> </div> <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600 group-hover:bg-slate-800 group-hover:text-white transition-colors">RELEVAR</span> </button> ))} </div> ) : ( <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center mb-4"> <p className="text-xs text-slate-400 italic">No hay guardia saliente registrado.</p> </div> )} <button onClick={() => handleConfirm(null)} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors"> {activeGuards.length > 0 ? 'INGRESAR SIN RELEVAR' : 'CONFIRMAR INGRESO'} </button> </div> </div> </div> );
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
    const [expanded, setExpanded] = useState<number | null>(null); if (!isOpen || !absenceShift) return null;
    const objLat = absenceShift.lat || -31.4201; const objLng = absenceShift.lng || -64.1888;
    const prevShifts = logic.processedData.filter((s:any) => s.objectiveId === absenceShift.objectiveId && s.positionName === absenceShift.positionName && (s.isPresent || s.status === 'COMPLETED') && toDate(s.endDateObj).getTime() <= (toDate(absenceShift.shiftDateObj).getTime() + 3600000));
    const neighbors = logic.objectives.filter((o:any) => o.id !== absenceShift.objectiveId).map((o:any) => { const dist = calculateDistance(objLat, objLng, o.lat||objLat, o.lng||objLng); const guards = logic.processedData.filter((s:any) => s.objectiveId === o.id && s.isPresent).length; return { ...o, distance: dist, activeGuards: guards }; }).filter((o:any) => o.distance <= 2 && o.activeGuards >= 2).sort((a:any,b:any) => a.distance - b.distance);
    const neighborGuards = neighbors.flatMap((n:any) => logic.processedData.filter((s:any) => s.objectiveId === n.id && s.isPresent).map((s:any) => ({ ...s, distance: n.distance, eta: estimateEta(n.distance), objectiveName: n.name, remainingGuards: n.activeGuards - 1 })));
    const busyIds = new Set(logic.processedData.filter((s:any) => isSameDay(s.shiftDateObj, toDate(absenceShift.shiftDateObj))).map((s:any) => s.employeeId));
    const volantes = logic.employees.filter((e:any) => !busyIds.has(e.id)).map((e:any) => { const dist = calculateDistance(objLat, objLng, e.lat||objLat, e.lng||objLng); return { ...e, distance: dist, eta: estimateEta(dist) }; }).sort((a:any,b:any) => a.distance - b.distance).slice(0, 10);
    const handleAssign = async (emp: any, type: string) => { try { await updateDoc(doc(db, 'turnos', absenceShift.id), { employeeId: emp.id, employeeName: emp.fullName || emp.employeeName, isUnassigned: false, status: 'PENDING', assignmentType: type }); toast.success(`Asignado: ${emp.fullName || emp.employeeName}`); onClose(); } catch (e) { toast.error('Error al asignar'); } };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in"> <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"> <div className="p-4 bg-rose-600 text-white flex justify-between items-center shrink-0"> <h3 className="font-black uppercase flex items-center gap-2"><Siren size={20}/> Cobertura de Vacante</h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6 overflow-y-auto custom-scrollbar space-y-4 flex-1"> <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-xs text-rose-800 font-medium"> Puesto descubierto en <b>{absenceShift.objectiveName}</b> ({absenceShift.positionName}). </div> {prevShifts.length > 0 && ( <div className="space-y-2"> <h4 className="text-xs font-black text-indigo-700 uppercase">1. Retención (Doble Turno)</h4> {prevShifts.map((s:any) => ( <div key={s.id} className="flex justify-between items-center p-2 bg-indigo-50 border border-indigo-100 rounded-lg"> <span className="text-xs font-bold text-slate-700">{s.employeeName}</span> <button onClick={() => handleAssign({id: s.employeeId, fullName: s.employeeName}, 'RETENTION')} className="px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded">DOBLAR</button> </div> ))} </div> )} {neighborGuards.length > 0 && ( <SectionList title="2. Intercambio (Vecinos < 2km)" color="purple" index={2} expanded={expanded===2} onToggle={()=>setExpanded(expanded===2?null:2)} items={neighborGuards} onAction={(e:any)=>handleAssign(e, 'SWAP')} context="INTERCAMBIO"/> )} <SectionList title="3. Volantes (Por Cercanía)" color="slate" index={3} expanded={expanded===3} onToggle={()=>setExpanded(expanded===3?null:3)} items={volantes} onAction={(e:any)=>handleAssign(e, 'VOLANTE')} context="COBERTURA"/> </div> </div> </div> );
};

const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => { if (!isOpen) return null; return ( <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"> <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"> <h3 className="font-bold mb-2">Retención de Guardia</h3> <p className="text-sm text-slate-500 mb-4">{retainedShift?.employeeName || 'Guardia'}</p> <button onClick={onClose} className="w-full py-2 bg-slate-100 rounded font-bold">Cerrar</button> </div> </div> ); };
const CheckOutModal = ({ isOpen, onClose, onConfirm, employeeName }: any) => { const [novedad, setNovedad] = useState(''); if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"><h3 className="font-bold mb-4">Salida: {employeeName}</h3><button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold mb-2">Salida Normal</button><textarea className="w-full p-2 border rounded mb-2" placeholder="Novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/><button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} className="w-full py-2 bg-slate-100 font-bold rounded">Reportar y Salir</button><button onClick={onClose} className="mt-2 text-sm text-slate-400 w-full">Cancelar</button></div></div>); };
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 text-center"><AlertTriangle size={48} className="mx-auto text-amber-500 mb-4"/><h3 className="font-bold text-lg mb-2">Confirmar Ausencia</h3><p className="text-sm text-slate-500 mb-6">¿{shift?.employeeName} no se presentó?</p><button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold mb-2">MARCAR AUSENTE</button><button onClick={onClose} className="text-sm text-slate-400">Cancelar</button></div></div>); };
const WorkedDayOffModal = ({ isOpen, onClose, shift }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"><h3 className="font-bold">Franco Trabajado</h3><button onClick={onClose} className="w-full mt-4 py-2 bg-slate-100 rounded">Cerrar</button></div></div>); };

const GuardCard = ({ shift, viewTab, onOpenCheckout, onOpenAttendance, onOpenHandover, onOpenInterrupt, onOpenCoverage, onReportPlanning, onOpenWorkedFranco, isCompact }: any) => { 
    let statusColor = 'border-l-slate-400'; let statusBg = 'bg-white';
    let iconStatus = <Shield size={10}/>;

    if (shift.isReportedToPlanning) { statusColor = 'border-l-slate-500'; statusBg = 'bg-slate-100 opacity-90'; } 
    else if (shift.isResolvedByOps) { statusColor = 'border-l-indigo-500'; statusBg = 'bg-indigo-50'; } 
    else if (shift.isUnassigned) { statusColor = 'border-l-rose-500'; statusBg = 'bg-rose-50/50'; } 
    else if (shift.isRetention) { statusColor = 'border-l-orange-500'; statusBg = 'bg-orange-50/50'; } 
    else if (shift.isPresent) { statusColor = 'border-l-emerald-500'; statusBg = 'bg-emerald-50/30'; } 
    else if (shift.isAbsent) { statusColor = 'border-l-slate-700'; statusBg = 'bg-slate-100'; } 
    else if (shift.isPotentialAbsence) { statusColor = 'border-l-red-600'; statusBg = 'bg-amber-50'; } 
    else if (shift.isFranco) { statusColor = 'border-l-blue-500'; statusBg = 'bg-blue-50/30'; }

    const handleCheckIn = () => onOpenHandover(shift);
    const handleReport = (e: any) => { e.stopPropagation(); if(confirm(`¿CONFIRMAR NOTIFICACIÓN?\nSe enviará alerta a Planificación.`)) onReportPlanning(shift); };
    
    // --- LÓGICA V184: -15 / +60 ---
    const now = new Date();
    const start = toDate(shift.shiftDateObj);
    const diff = (now.getTime() - start.getTime()) / 60000;
    const canCheckIn = diff >= -15 && diff <= 60 && !shift.isPresent; 

    let title = shift.employeeName || 'Desconocido';
    let subtitle = shift.positionName || 'Guardia';
    
    if (shift.isReportedToPlanning) {
        title = "DEVUELTO A PLANIFICACIÓN";
        subtitle = (shift.employeeName || '').replace('VACANTE: ', '') || "Vacante Reportada";
    } else if (shift.isResolvedByOps) {
        subtitle = "RESUELTO POR OPERACIONES";
    } else if (shift.isUnassigned) {
        title = shift.employeeName || 'VACANTE';
        subtitle = "COBERTURA PENDIENTE";
    }

    return (
        <div className={`rounded-xl border border-slate-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all mb-2 ${statusBg}`}> 
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${statusColor.replace('border-l-', 'bg-')}`}></div> 
            <div className="pl-4 p-3">
                <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0 pr-2">
                        <div className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-wider truncate"><Building2 size={10}/> {shift.clientName}</div>
                        <div className="text-xs font-bold text-slate-700 truncate flex items-center gap-1">
                            <MapPin size={10} className="text-slate-400"/> 
                            <span>{shift.objectiveName}</span>
                            <span className="text-slate-300 mx-1">|</span>
                            <span className="text-indigo-600">{shift.positionName}</span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        {diff > 60 && !shift.isPresent && !shift.isAbsent && <div className="bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded animate-pulse shadow-sm">AUSENCIA</div>}
                        {shift.isPotentialAbsence && diff <= 60 && <div className="bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm">LLEGADA TARDE</div>}
                        
                        {shift.isReportedToPlanning && <div className="bg-slate-600 text-white text-[9px] font-black px-2 py-0.5 rounded flex items-center gap-1 shadow-sm"><CornerUpLeft size={10}/> DEVUELTO</div>}
                        {shift.isResolvedByOps && <div className="bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded flex items-center gap-1 shadow-sm"><CheckCircle size={10}/> OPERACIONES</div>}
                        {shift.isRetention && <div className="bg-orange-600 text-white text-[9px] font-black px-2 py-0.5 rounded animate-pulse">RECARGO</div>}
                    </div>
                </div>
                <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shadow-sm ${shift.isUnassigned && !shift.isReportedToPlanning ? 'bg-rose-100 text-rose-600' : 'bg-slate-200 text-slate-600'}`}>{shift.isUnassigned && !shift.isReportedToPlanning ? '!' : (title[0] || 'U')}</div>
                    <div className="flex-1 min-w-0">
                        <h4 className={`font-black text-sm truncate leading-tight ${shift.isUnassigned && !shift.isReportedToPlanning ? 'text-rose-600' : 'text-slate-800'}`}>{title}</h4>
                        <div className="text-[11px] text-slate-500 font-medium flex items-center gap-1 mt-0.5">{iconStatus} {subtitle}</div>
                    </div>
                    {!shift.isUnassigned && shift.phone && !isCompact && (
                        <div className="flex gap-1">
                            <button onClick={() => window.open(`https://wa.me/${shift.phone.replace(/[^0-9]/g, '')}`)} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors"><MessageCircle size={14}/></button>
                            <button onClick={() => window.open(`tel:${shift.phone}`)} className="p-2 bg-slate-50 text-slate-600 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"><Phone size={14}/></button>
                        </div>
                    )}
                </div>
                {!isCompact && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-600 bg-white/80 p-2 rounded-lg border border-slate-100 mb-3 shadow-sm">
                        <div className="flex items-center gap-1 font-mono font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-700"><Clock size={12}/> {formatTimeRange(shift.shiftDateObj, shift.endDateObj)}</div>
                        <div className="flex items-center gap-1 border-l border-slate-300 pl-2"><Calendar size={12}/> {formatDateShort(shift.shiftDateObj)}</div>
                    </div>
                )}
                <div className={`flex gap-2 ${isCompact ? 'mt-1' : 'mt-0'}`}>
                    {(shift.isUnassigned) && !shift.isReportedToPlanning && viewTab === 'VACANTES' && (
                        <><button onClick={() => onOpenCoverage(shift)} className="flex-[2] py-2 bg-rose-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-rose-700 flex items-center justify-center gap-1 transition-colors"><Siren size={14}/> CUBRIR</button><button onClick={handleReport} className="flex-1 py-2 bg-slate-700 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-slate-800 flex items-center justify-center gap-1 transition-colors"><CornerUpLeft size={14}/> DEVOLVER</button></>
                    )}
                    {shift.isReportedToPlanning && viewTab === 'VACANTES' && (
                        <div className="w-full text-center text-[10px] font-bold text-slate-400 py-1 bg-slate-50 rounded border border-slate-100">ESPERANDO RESPUESTA DE PLANIFICACIÓN</div>
                    )}
                    {viewTab === 'PLAN' && (
                        <>
                            <button 
                                onClick={handleCheckIn} 
                                disabled={!canCheckIn} 
                                className={`flex-[2] py-2 rounded-lg text-[11px] font-bold uppercase shadow-sm flex items-center justify-center gap-1 transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                <PlayCircle size={14}/> 
                                {diff > 5 && diff <= 60 ? 'LLEGADA TARDE' : (diff > 60 ? 'AUSENCIA' : 'DAR PRESENTE')}
                            </button>
                            <button onClick={() => onOpenAttendance(shift)} className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold uppercase hover:bg-slate-50 flex items-center justify-center gap-1 shadow-sm"><AlertTriangle size={14}/> AUSENTE</button>
                        </>
                    )}
                    {(viewTab === 'ACTIVOS' || viewTab === 'RETENIDOS') && (<><button onClick={() => onOpenCheckout(shift)} className="flex-[2] py-2 bg-purple-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-purple-700 flex items-center justify-center gap-1"><LogOut size={14}/> SALIDA</button><button onClick={() => onOpenInterrupt(shift)} className="flex-1 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[11px] font-bold uppercase hover:bg-red-100 flex items-center justify-center gap-1"><Siren size={14}/> BAJA</button></>)}
                </div>
            </div>
        </div>
    ); 
};

const ObjectiveGroup = ({ group, modals, isCompact, onReport, viewTab, onOpenWorkedFranco }: any) => { const [expanded, setExpanded] = useState(true); return ( <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden mb-3"> <div className="p-2.5 bg-slate-100 border-b border-slate-200 flex justify-between items-center cursor-pointer hover:bg-slate-200" onClick={()=>setExpanded(!expanded)}> <div className="flex items-center gap-2"><div className="bg-slate-700 text-white w-5 h-5 rounded flex items-center justify-center text-[10px] font-black">{group.items.length}</div><h4 className="font-bold text-xs text-slate-700 uppercase truncate max-w-[200px]">{group.name}</h4></div> {expanded ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>} </div> {expanded && <div className="p-2 bg-slate-50/50 space-y-2">{group.items.map((s:any) => (<GuardCard key={s.id} shift={s} viewTab={viewTab} isCompact={isCompact} onOpenCheckout={(s:any)=>modals.setCheckoutData({isOpen:true, shift:s})} onOpenAttendance={(s:any)=>modals.setAttendanceData({isOpen:true, shift:s})} onOpenHandover={(s:any)=>modals.setHandoverData({isOpen:true, shift:s})} onOpenInterrupt={(s:any)=>modals.setInterruptData({isOpen:true, shift:s})} onOpenCoverage={(s:any)=>modals.setCoverageData({isOpen:true, shift:s})} onReportPlanning={onReport} onOpenWorkedFranco={onOpenWorkedFranco}/>))}</div>} </div> ); };

export default function OperacionesPage() {
    const logic = useOperacionesMonitor();
    const [isExternalMap, setIsExternalMap] = useState(false);
    const [checkoutData, setCheckoutData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [attendanceData, setAttendanceData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [handoverData, setHandoverData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [interruptData, setInterruptData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [coverageData, setCoverageData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [workedFrancoData, setWorkedFrancoData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [isGrouped, setIsGrouped] = useState(false);

    const handleUndockMap = () => { window.open('/admin/operaciones/map-view', 'CronoMapTactical', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no'); setIsExternalMap(true); };
    const generateDailyReport = () => { const doc = new jsPDF(); const dateStr = new Date().toLocaleDateString('es-AR', {timeZone: 'America/Argentina/Cordoba'}); doc.setFontSize(18); doc.text("Informe de Gestión COSP", 14, 20); doc.setFontSize(10); doc.text(`Fecha: ${new Date().toLocaleString('es-AR', {timeZone: 'America/Argentina/Cordoba'})}`, 14, 30); const validLogs = logic.recentLogs.filter((log: any) => log.formattedActor !== 'VACANTE'); const rows = validLogs.map((log: any) => [formatTimeSimple(log.time), (log.action || 'LOG').replace('MANUAL_', ''), log.formattedActor || 'Sistema', log.targetEmployee || '-', log.fullDetail || log.details || '-']); autoTable(doc, { head: [["Hora", "Evento", "Operador", "Objetivo", "Detalle"]], body: rows, startY: 50, styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] } }); doc.save(`bitacora_${dateStr}.pdf`); };
    const handleMarkAbsent = async (shift: any) => { try { await updateDoc(doc(db, 'turnos', shift.id), { status: 'ABSENT', isAbsent: true }); setAttendanceData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: shift}); } catch (e) { toast.error("Error al marcar ausencia"); } };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };
    const handleReportPlanning = async (shift: any) => { 
        try { 
            let targetId = shift.id; 
            if (shift.id.startsWith('SLA_GAP')) { 
                const newRef = doc(collection(db, 'turnos')); 
                targetId = newRef.id; 
                const newShiftData = { ...shift, id: targetId, status: 'UNCOVERED_REPORTED', isReported: true, comments: 'Vacante de Contrato Reportada', createdAt: serverTimestamp(), isSlaGap: false, origin: 'SLA_GAP' }; 
                await setDoc(newRef, newShiftData); 
            } else { 
                await updateDoc(doc(db, 'turnos', targetId), { status: 'UNCOVERED_REPORTED', isReported: true }); 
            } 
            await addDoc(collection(db, 'novedades'), { type: 'VACANTE_NO_CUBIERTA', title: 'Vacante Reportada', clientId: shift.clientId, objectiveId: shift.objectiveId, shiftId: targetId, description: `Vacante no cubierta en ${shift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }); 
            toast.success('Reporte enviado correctamente'); 
        } catch (e: any) { 
            toast.error('Error al reportar'); 
        } 
    };

    // --- SYNC FILTROS ---
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('crono_ops_filters', JSON.stringify({
                tab: logic.viewTab,
                client: logic.selectedClientId,
                text: logic.filterText
            }));
        }
    }, [logic.viewTab, logic.selectedClientId, logic.filterText]);

    const groupedList = useMemo(() => {
        if (!isGrouped) return [];
        const groups: Record<string, any> = {};
        logic.listData.forEach((s: any) => { const k = s.objectiveId || 'unknown'; if (!groups[k]) groups[k] = { id: k, name: s.objectiveName || 'Sin Objetivo', client: s.clientName || 'Cliente', items: [] }; groups[k].items.push(s); });
        return Object.values(groups).sort((a:any, b:any) => (a.client || '').localeCompare(b.client || ''));
    }, [logic.listData, isGrouped]);

    const modalSetters = { setCheckoutData, setAttendanceData, setHandoverData, setInterruptData, setCoverageData };
    const tabs = [
        { id: 'PRIORIDAD', label: 'PRIORIDAD', count: logic.stats.prioridad, color: 'text-rose-600' },
        { id: 'PLAN', label: 'PLAN', count: logic.stats.plan, color: 'text-indigo-600' },
        { id: 'ACTIVOS', label: 'ACTIVOS', count: logic.stats.activos, color: 'text-emerald-600' },
        { id: 'RETENIDOS', label: 'RETENIDOS', count: logic.stats.retenidos, color: 'text-orange-600' },
        { id: 'VACANTES', label: 'VACANTES', count: logic.stats.vacantes, color: 'text-slate-800' },
        { id: 'AUSENTES', label: 'AUSENTES', count: 0, color: 'text-slate-500' },
        { id: 'FRANCOS', label: 'FRANCOS', count: logic.stats.francos, color: 'text-blue-600' }
    ];

    return (
        <DashboardLayout>
            <Toaster position="top-right" />
            <Head><title>COSP V184.0</title></Head>
            <style>{POPUP_STYLES}</style>
            
            <div className="h-[calc(100vh-100px)] flex flex-col lg:flex-row gap-4 p-2 animate-in fade-in">
                {!isExternalMap && (
                    <div className="flex-1 lg:flex-[3] bg-slate-100 rounded-3xl border border-slate-200 overflow-hidden relative shadow-inner">
                        {/* 🛑 V184 FIX: MAPA CON ALL OBJECTIVES FILTRADOS */}
                        <OperacionesMap 
                            center={[-31.4201, -64.1888]} 
                            allObjectives={logic.filteredObjectives} 
                            filteredShifts={logic.listData} 
                            onOpenCoverage={(s:any)=> { if (s.isReportedToPlanning) { toast.info("Vacante ya devuelta."); return; } setCoverageData({isOpen:true, shift:s}); }} 
                            onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})} 
                            onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})} 
                            onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})} 
                            onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})} 
                            onReportPlanning={handleReportPlanning} 
                        />
                        <button onClick={handleUndockMap} className="absolute top-4 right-4 z-[1000] bg-white p-2 rounded-lg shadow hover:bg-slate-100"><MonitorUp size={20} className="text-indigo-600"/></button>
                    </div>
                )}

                <div className={`bg-white rounded-3xl border border-slate-200 flex flex-col shadow-xl ${isExternalMap ? 'w-full' : 'flex-1 lg:flex-[2]'}`}>
                    <div className="p-4 border-b">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><Radio className="text-rose-600 animate-pulse" /> COSP V184.0</h2>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setIsGrouped(!isGrouped)} className={`px-3 py-1.5 font-bold text-xs rounded-lg border flex items-center gap-2 transition-all ${isGrouped ? 'bg-indigo-600 text-white border-indigo-700 shadow-md' : 'bg-white text-slate-600 hover:bg-slate-50'}`}><Layers size={14}/> {isGrouped ? 'AGRUPADO' : 'LISTA'}</button>
                                {isExternalMap && <button onClick={() => setIsExternalMap(false)} className="px-3 py-1 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-lg border">Restaurar Mapa</button>}
                                <button onClick={() => logic.setIsCompact(!logic.isCompact)} className="p-2 bg-slate-100 rounded-lg text-slate-600">{logic.isCompact ? <Maximize2 size={16}/> : <Minimize2 size={16}/>}</button>
                            </div>
                        </div>
                        <div className="mb-3"><select value={logic.selectedClientId} onChange={(e) => logic.setSelectedClientId(e.target.value)} className="w-full p-2 text-xs font-bold border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700"><option value="">TODOS LOS CLIENTES</option>{logic.uniqueClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                        <div className="flex p-1 bg-slate-100 rounded-xl mb-3 gap-1 overflow-x-auto">{tabs.map(t => (<button key={t.id} onClick={() => logic.setViewTab(t.id as any)} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${logic.viewTab === t.id ? 'bg-white shadow-md scale-[1.02] ' + t.color : 'text-slate-400 hover:bg-slate-200'}`}>{t.label} ({t.count || 0})</button>))}</div>
                        <div className="flex gap-2 relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16}/><input className="w-full bg-slate-50 border border-slate-200 pl-9 pr-3 py-2 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500" placeholder="BUSCAR..." value={logic.filterText} onChange={(e) => logic.setFilterText(e.target.value)} /></div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 bg-slate-50/50 space-y-2">
                        {logic.listData.length === 0 ? <div className="text-center py-10 text-slate-400 text-xs">Sin novedades en esta categoría</div> : 
                            isGrouped ? (groupedList.map((group: any) => <ObjectiveGroup key={group.id} group={group} modals={modalSetters} isCompact={logic.isCompact} onReport={handleReportPlanning} viewTab={logic.viewTab} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})}/>)) : 
                            (logic.listData.map((s:any) => <GuardCard key={s.id} shift={s} viewTab={logic.viewTab} isCompact={logic.isCompact} onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})} onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})} onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})} onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})} onOpenCoverage={(s:any)=> { if (s.isReportedToPlanning) { toast.info("Vacante ya devuelta."); return; } setCoverageData({isOpen:true, shift:s}); }} onReportPlanning={handleReportPlanning} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})}/>))
                        }
                    </div>

                    <div className="h-40 border-t border-slate-200 bg-white flex flex-col"><div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={14} className="text-slate-400"/><h3 className="text-[10px] font-black uppercase text-slate-500">Bitácora</h3></div><button onClick={generateDailyReport} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg"><Printer size={12}/></button></div><div className="flex-1 overflow-y-auto p-0"><table className="w-full text-[10px] text-left"><thead className="bg-slate-50 text-slate-400 uppercase font-bold sticky top-0"><tr><th className="px-4 py-1">Hora</th><th className="px-2 py-1">Evento</th><th className="px-2 py-1">Actor</th><th className="px-2 py-1">Detalle</th></tr></thead><tbody className="divide-y divide-slate-50">{logic.recentLogs.map((log:any) => (<tr key={log.id}><td className="px-4 py-1 font-mono text-slate-400">{formatTimeSimple(log.time)}</td><td className="px-2 py-1 font-bold">{log.action}</td><td className="px-2 py-1">{log.formattedActor}</td><td className="px-2 py-1 text-slate-500 truncate max-w-[150px]">{log.fullDetail}</td></tr>))}</tbody></table></div></div>
                </div>
            </div>
            
            <RetentionModal isOpen={false} onClose={()=>{}} retainedShift={null} />
            <WorkedDayOffModal isOpen={workedFrancoData.isOpen} onClose={()=>setWorkedFrancoData({isOpen:false, shift:null})} shift={workedFrancoData.shift} />
            <CheckOutModal isOpen={checkoutData.isOpen} onClose={() => setCheckoutData({isOpen:false, shift:null})} onConfirm={(nov:string|null) => { if (checkoutData.shift?.id) logic.handleAction('CHECKOUT', checkoutData.shift.id, nov); }} employeeName={checkoutData.shift?.employeeName} />
            <AttendanceModal isOpen={attendanceData.isOpen} onClose={()=>setAttendanceData({isOpen:false, shift:null})} shift={attendanceData.shift} onMarkAbsent={handleMarkAbsent} />
            
            <HandoverModal isOpen={handoverData.isOpen} onClose={()=>setHandoverData({isOpen:false, shift:null})} incomingShift={handoverData.shift} logic={logic} />
            <InterruptModal isOpen={interruptData.isOpen} onClose={()=>setInterruptData({isOpen:false, shift:null})} shift={interruptData.shift} logic={logic} onVacancyCreated={handleVacancyCreated} />
            <CoverageModal isOpen={coverageData.isOpen} onClose={()=>setCoverageData({isOpen:false, shift:null})} absenceShift={coverageData.shift} logic={logic} />
        </DashboardLayout>
    );
}