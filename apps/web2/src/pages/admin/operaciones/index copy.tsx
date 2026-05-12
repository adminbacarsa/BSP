
import React, { useState, useMemo } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Radio, Search, Layers, Maximize2, Minimize2, MonitorUp, Building2, Shield, Clock, Siren, CheckCircle, LogOut, AlertTriangle, ClipboardList, Printer, Phone, MessageCircle, Calendar, ChevronDown, ChevronRight, Filter, Send, PlayCircle, EyeOff, X, Briefcase, UserX, CornerUpLeft, MapPin } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, updateDoc, serverTimestamp, addDoc, collection, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AttendanceModal, HandoverModal, CoverageModal, InterruptModal, WorkedDayOffModal } from '@/components/operaciones/OperationalModals';
import { getAuth } from 'firebase/auth';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-full flex items-center justify-center text-slate-400">Cargando Mapa...</div>, ssr: false });

const formatTimeSimple = (dateObj: any) => { if (!dateObj) return '-'; try { const d = dateObj.seconds ? new Date(dateObj.seconds * 1000) : (dateObj instanceof Date ? dateObj : new Date(dateObj)); return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const formatDateShort = (dateObj: any) => { if (!dateObj) return '--/--'; try { const d = dateObj.seconds ? new Date(dateObj.seconds * 1000) : (dateObj instanceof Date ? dateObj : new Date(dateObj)); return d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Cordoba' }).toUpperCase(); } catch (e) { return '--/--'; } };
const formatTimeRange = (start: any, end: any) => { try { const s = start?.seconds ? new Date(start.seconds * 1000) : (start instanceof Date ? start : new Date()); const e = end?.seconds ? new Date(end.seconds * 1000) : (end instanceof Date ? end : new Date()); return `${s.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})} - ${e.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})}`; } catch { return '--:--'; } };

const CheckOutModal = ({ isOpen, onClose, onConfirm, employeeName }: any) => { const [novedad, setNovedad] = useState(''); if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"><h3 className="font-bold mb-4">Salida: {employeeName}</h3><button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold mb-2">Salida Normal</button><textarea className="w-full p-2 border rounded mb-2" placeholder="Novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/><button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} className="w-full py-2 bg-slate-100 font-bold rounded">Reportar y Salir</button><button onClick={onClose} className="mt-2 text-sm text-slate-400 w-full">Cancelar</button></div></div>); };
const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"><div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6"><div className="flex justify-between items-center mb-4"><h3 className="font-bold text-orange-600 flex items-center gap-2"><Clock/> Gestión de Retención</h3><button onClick={onClose}><X size={20} className="text-slate-400"/></button></div><p className="text-sm text-slate-600 mb-4">Guardia: <b>{retainedShift?.employeeName}</b></p><button onClick={onClose} className="w-full py-2 bg-slate-100 font-bold rounded text-slate-600">Cerrar</button></div></div>); };

const GuardCard = ({ shift, viewTab, onOpenCheckout, onOpenAttendance, onOpenHandover, onOpenInterrupt, onOpenCoverage, onReportPlanning, onOpenWorkedFranco, isCompact }: any) => { 
    let statusColor = 'border-l-slate-400'; let statusBg = 'bg-white';
    let iconStatus = <Shield size={10}/>;

    if (shift.isReportedToPlanning) { 
        statusColor = 'border-l-slate-500'; statusBg = 'bg-slate-100 opacity-90'; 
    } else if (shift.isResolvedByOps) {
        statusColor = 'border-l-indigo-500'; statusBg = 'bg-indigo-50';
    } else if (shift.isUnassigned) { 
        statusColor = 'border-l-rose-500'; statusBg = 'bg-rose-50/50'; 
    } else if (shift.isRetention) { 
        statusColor = 'border-l-orange-500'; statusBg = 'bg-orange-50/50'; 
    } else if (shift.isPresent) { 
        statusColor = 'border-l-emerald-500'; statusBg = 'bg-emerald-50/30'; 
    } else if (shift.isAbsent) { 
        statusColor = 'border-l-slate-700'; statusBg = 'bg-slate-100'; 
    } else if (shift.isPotentialAbsence) { 
        statusColor = 'border-l-red-600'; statusBg = 'bg-amber-50'; 
    } else if (shift.isFranco) { 
        statusColor = 'border-l-blue-500'; statusBg = 'bg-blue-50/30'; 
    }

    const handleCheckIn = () => onOpenHandover(shift);
    const handleReport = (e: any) => { e.stopPropagation(); if(confirm(`¿CONFIRMAR NOTIFICACIÓN?\nSe enviará alerta a Planificación.`)) onReportPlanning(shift); };
    const canCheckIn = shift.minutesUntilStart <= 15;

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
                        {/* 🛑 V123 FIX: OBJETIVO | PUESTO */}
                        <div className="text-xs font-bold text-slate-700 truncate flex items-center gap-1">
                            <MapPin size={10} className="text-slate-400"/> 
                            <span>{shift.objectiveName}</span>
                            <span className="text-slate-300 mx-1">|</span>
                            <span className="text-indigo-600">{shift.positionName}</span>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        {shift.isPotentialAbsence && <div className="bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded animate-pulse shadow-sm">LLEGADA TARDE</div>}
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
                    {viewTab === 'PLAN' && (<><button onClick={handleCheckIn} disabled={!canCheckIn} className={`flex-[2] py-2 rounded-lg text-[11px] font-bold uppercase shadow-sm flex items-center justify-center gap-1 transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}><PlayCircle size={14}/> DAR PRESENTE</button><button onClick={() => onOpenAttendance(shift)} className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold uppercase hover:bg-slate-50 flex items-center justify-center gap-1 shadow-sm"><AlertTriangle size={14}/> AUSENTE</button></>)}
                    {(viewTab === 'ACTIVOS' || viewTab === 'RETENIDOS') && (<><button onClick={() => onOpenCheckout(shift)} className="flex-[2] py-2 bg-purple-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-purple-700 flex items-center justify-center gap-1"><LogOut size={14}/> SALIDA</button><button onClick={() => onOpenInterrupt(shift)} className="flex-1 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[11px] font-bold uppercase hover:bg-red-100 flex items-center justify-center gap-1"><Siren size={14}/> BAJA</button></>)}
                </div>
            </div>
        </div>
    ); 
};

// ... ObjectiveGroup sin cambios ...
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
    const activeGuardsInObjective = useMemo(() => { if (!handoverData.shift) return []; return logic.processedData.filter(s => s.isPresent && s.objectiveId === handoverData.shift.objectiveId && s.id !== handoverData.shift.id); }, [handoverData.shift, logic.processedData]);
    
    // LOGICA V123: REPORTE PRECISIÓN HORARIA + BITÁCORA + OPERADOR
    const handleReportPlanning = async (shift: any) => {
        try {
            const auth = getAuth();
            const operatorName = auth.currentUser?.email?.split('@')[0].toUpperCase() || 'OPERACIONES';
            
            const empName = shift.employeeName || 'VACANTE';
            const shiftName = empName.replace('VACANTE: ', '') || 'NO ESPECIFICADO';
            
            const realStartTime = shift.shiftDateObj || new Date();
            const realEndTime = shift.endDateObj || new Date();

            const newRef = doc(collection(db, 'turnos'));
            await setDoc(newRef, {
                clientId: shift.clientId || 'UNKNOWN',
                clientName: shift.clientName || 'Cliente',
                objectiveId: shift.objectiveId || 'UNKNOWN',
                objectiveName: shift.objectiveName || 'Objetivo',
                positionName: shift.positionName || 'Guardia',
                startTime: Timestamp.fromDate(realStartTime),
                endTime: Timestamp.fromDate(realEndTime),
                employeeId: 'VACANTE',
                employeeName: `VACANTE: ${shiftName}`,
                isUnassigned: true,
                status: 'REPORTED_TO_PLANNING',
                isReported: true,
                isPayrollExcluded: true, // NO LIQUIDAR
                createdAt: serverTimestamp(),
                origin: 'OPERATIONS_REPORT',
                comments: 'Vacante reportada a planificación'
            });

            await addDoc(collection(db, 'novedades'), { 
                type: 'VACANTE_NO_CUBIERTA', 
                title: 'Urgencia Operativa', 
                description: `Operaciones devuelve vacante ${shiftName} en ${shift.objectiveName}`, 
                clientId: shift.clientId || 'UNKNOWN', 
                objectiveId: shift.objectiveId || 'UNKNOWN', 
                shiftId: newRef.id,
                priority: 'high',
                status: 'pending',
                read: false, 
                createdAt: serverTimestamp(), 
                reportedBy: operatorName 
            });

            await addDoc(collection(db, 'audit_logs'), {
                action: 'REPORT_VACANCY_TO_PLANNING',
                actorName: operatorName,
                targetEmployee: 'PLANIFICACION',
                details: `Devolución de ${shiftName} en ${shift.clientName}`,
                timestamp: serverTimestamp(),
                relatedShiftId: newRef.id,
                severity: 'HIGH'
            });
            
            toast.success('Vacante reportada y registrada en Bitácora.');
        } catch (e: any) {
            console.error("ERROR EN REPORTE:", e);
            toast.error('Error al reportar: ' + e.message);
        }
    };

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
            <Head><title>COSP V123.0</title></Head>
            <style>{POPUP_STYLES}</style>
            
            <div className="h-[calc(100vh-100px)] flex flex-col lg:flex-row gap-4 p-2 animate-in fade-in">
                {!isExternalMap && (
                    <div className="flex-1 lg:flex-[3] bg-slate-100 rounded-3xl border border-slate-200 overflow-hidden relative shadow-inner">
                        <OperacionesMap center={[-31.4201, -64.1888]} objectives={logic.filteredObjectives} processedData={logic.listData} 
                            onOpenCoverage={(s:any)=> {
                                if (s.isReportedToPlanning) { toast.info("Vacante ya devuelta."); return; }
                                setCoverageData({isOpen:true, shift:s});
                            }} 
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
                            <h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><Radio className="text-rose-600 animate-pulse" /> COSP V123.0</h2>
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
            <HandoverModal isOpen={handoverData.isOpen} onClose={()=>setHandoverData({isOpen:false, shift:null})} incomingShift={handoverData.shift} activeGuardsInObjective={activeGuardsInObjective} />
            <InterruptModal isOpen={interruptData.isOpen} onClose={()=>setInterruptData({isOpen:false, shift:null})} shift={interruptData.shift} onVacancyCreated={handleVacancyCreated} />
            <CoverageModal isOpen={coverageData.isOpen} onClose={()=>setCoverageData({isOpen:false, shift:null})} absenceShift={coverageData.shift} />
        </DashboardLayout>
    );
}
