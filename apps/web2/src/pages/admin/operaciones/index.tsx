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
import { doc, updateDoc, serverTimestamp, addDoc, collection, setDoc, Timestamp, query, where, orderBy, limit, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';
import { WorkedDayOffModal as WorkedDayOffModalPro } from '@/components/operaciones/OperationalModals';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-full flex items-center justify-center text-slate-400">Cargando Mapa...</div>, ssr: false });

// --- HELPERS ---
const toDate = (d: any) => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const formatTimeSimple = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const formatDateShort = (dateObj: any) => { try { return toDate(dateObj).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Cordoba' }).toUpperCase(); } catch (e) { return '--/--'; } };
const formatTimeRange = (start: any, end: any) => { try { return `${toDate(start).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})} - ${toDate(end).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', timeZone: 'America/Argentina/Cordoba'})}`; } catch { return '--:--'; } };
const isSameDay = (d1: any, d2: any) => { if (!d1 || !d2) return false; return toDate(d1).toLocaleDateString('en-CA') === toDate(d2).toLocaleDateString('en-CA'); };

const registrarBitacora = async (action: string, details: string, extra?: { objectiveName?: string; clientName?: string }) => {
    try {
        const auth = getAuth();
        const operatorName = auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador';
        const data: any = {
            action,
            module: 'OPERACIONES',
            details,
            timestamp: serverTimestamp(),
            actorName: operatorName,
            actorUid: auth.currentUser?.uid || null,
        };
        if (extra?.objectiveName != null) data.objectiveName = extra.objectiveName;
        if (extra?.clientName != null) data.clientName = extra.clientName;
        await addDoc(collection(db, 'audit_logs'), data);
    } catch (e) {
        console.error('Error registrando bitácora', e);
        toast.error('No se pudo registrar en bitácora. Revisar permisos Firestore.');
    }
};
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => { if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity; const R = 6371; const dLat = (lat2 - lat1) * (Math.PI / 180); const dLon = (lon2 - lon1) * (Math.PI / 180); const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2); const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return R * c; };
const estimateEta = (dist: number) => Math.round((dist / 30) * 60);

// --- COMPONENTE LISTA ---
const SectionList = ({ title, color, expanded, onToggle, items, onAction, onWhatsapp, onPhone, context }: any) => {
    const styles: any = { cyan: { border: 'border-cyan-200', dot: 'bg-cyan-500', text: 'text-cyan-700', bg: 'bg-cyan-50', btn: 'bg-cyan-600 hover:bg-cyan-700' }, purple: { border: 'border-purple-200', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50', btn: 'bg-purple-600 hover:bg-purple-700' }, slate: { border: 'border-slate-200', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-white', btn: 'bg-slate-800 hover:bg-slate-900' } };
    const s = styles[color] || styles.slate;
    return ( <section className={`relative pl-6 border-l-2 ${s.border}`}> <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${s.dot}`}></div> <h4 className={`text-xs font-black uppercase mb-2 cursor-pointer flex items-center gap-2 ${s.text}`} onClick={onToggle}> {title} {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} </h4> {expanded && ( <div className="mt-2 space-y-2 max-h-48 overflow-y-auto custom-scrollbar p-1"> {items?.length > 0 ? items.map((e:any) => ( <div key={e.id} className={`flex justify-between items-center p-2 border rounded-lg shadow-sm ${s.bg}`}> <div> <span className="text-xs font-bold text-slate-800 block">{e.fullName || e.employeeName}</span> {context === 'INTERCAMBIO' && <span className="text-[10px] text-purple-700 block">{e.objectiveName} (Quedan: {e.remainingGuards})</span>} {Number.isFinite(e.distance) && ( <div className="flex items-center gap-2 mt-0.5"> <span className="text-[9px] bg-white border px-1.5 rounded text-slate-500 flex items-center gap-1"><Navigation size={8}/> {e.distance.toFixed(1)} km</span> <span className="text-[9px] text-slate-400">~{e.eta} min</span> </div> )} </div> <div className="flex gap-1"> <button onClick={()=>onWhatsapp(e)} className="p-1.5 bg-white text-emerald-600 border rounded hover:bg-emerald-50"><MessageCircle size={14}/></button> <button onClick={()=>onPhone(e)} className="p-1.5 bg-white text-blue-600 border rounded hover:bg-blue-50"><Phone size={14}/></button> <button onClick={()=>onAction(e)} className={`px-2 py-1.5 text-white text-[10px] font-bold rounded shadow-sm ${s.btn}`}> {context === 'INTERCAMBIO' ? 'MOVER' : 'ASIGNAR'} </button> </div> </div> )) : <p className="text-[10px] text-slate-400 italic">No hay candidatos.</p>} </div> )} </section> );
};

// --- MODALES (LÓGICA OPERATIVA) ---
const HandoverModal = ({ isOpen, onClose, incomingShift, logic, onAudit }: any) => {
    if (!isOpen || !incomingShift) return null;
    const now = new Date(); const start = toDate(incomingShift.shiftDateObj); const diffMin = (now.getTime() - start.getTime()) / 60000;
    let status = 'ON_TIME'; if (diffMin > 5) status = 'LATE';
    const activeGuards = logic.processedData.filter((s:any) => s.objectiveId === incomingShift.objectiveId && s.positionName === incomingShift.positionName && (s.isPresent || s.status === 'COMPLETED') && s.id !== incomingShift.id && toDate(s.endDateObj).getTime() <= (start.getTime() + 3600000));
    const handleConfirm = async (prevShiftId: string | null) => { try { await updateDoc(doc(db, 'turnos', incomingShift.id), { isPresent: true, status: 'PRESENT', checkInTime: serverTimestamp(), isLate: status === 'LATE' }); if (prevShiftId) { await updateDoc(doc(db, 'turnos', prevShiftId), { checkOutTime: serverTimestamp(), isCompleted: true, status: 'COMPLETED' }); } const prevGuard = activeGuards.find((s: any) => s.id === prevShiftId); const details = prevShiftId && prevGuard ? `Ingreso de ${incomingShift.employeeName} en ${incomingShift.objectiveName} (${incomingShift.positionName}), relevó a ${prevGuard.employeeName}` : `Ingreso de ${incomingShift.employeeName} en ${incomingShift.objectiveName} (${incomingShift.positionName})`; if (onAudit) onAudit(status === 'LATE' ? 'Ingreso tarde' : 'Ingreso / Presente', details, { objectiveName: incomingShift.objectiveName, clientName: incomingShift.clientName }); toast.success(status === 'LATE' ? 'Ingreso Tarde registrado.' : 'Ingreso Correcto.'); onClose(); } catch (e) { toast.error("Error al procesar relevo."); } };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in zoom-in-95"> <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${status==='LATE' ? 'bg-amber-500' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"> {status==='LATE' ? <Clock size={20}/> : <UserCheck size={20}/>} {status==='LATE' ? 'Llegada Tarde' : 'Ingreso A Tiempo'} </h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <p className="text-sm text-slate-600 mb-4"> El guardia <b>{incomingShift.employeeName}</b> está listo para ingresar. {status==='LATE' && <span className="block mt-1 text-amber-600 font-bold">⚠️ Retraso de {Math.round(diffMin)} minutos.</span>} </p> {activeGuards.length > 0 ? ( <div className="space-y-2 mb-4"> <p className="text-xs font-bold text-slate-400 uppercase">Seleccione a quién relevar:</p> {activeGuards.map((s:any) => ( <button key={s.id} onClick={() => handleConfirm(s.id)} className="w-full p-3 border rounded-xl hover:bg-slate-50 flex justify-between items-center group"> <div className="text-left"> <span className="block text-xs font-bold text-slate-700">{s.employeeName}</span> <span className="block text-[10px] text-slate-400">Salida: {formatTimeSimple(s.endDateObj)}</span> </div> <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600 group-hover:bg-slate-800 group-hover:text-white transition-colors">RELEVAR</span> </button> ))} </div> ) : ( <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center mb-4"> <p className="text-xs text-slate-400 italic">No hay guardia saliente registrado.</p> </div> )} <button onClick={() => handleConfirm(null)} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors"> {activeGuards.length > 0 ? 'INGRESAR SIN RELEVAR' : 'CONFIRMAR INGRESO'} </button> </div> </div> </div> );
};

// Opciones de resolución precargadas para alertas NVR
const NVR_RESOLUTION_OPTIONS = [
    { id: 'visto', label: 'Visto / Atendido', description: 'Operador revisó y dio por atendido' },
    { id: 'verificado_guardia', label: 'Verificado por guardia', description: 'Guardia verificó en sitio' },
    { id: 'incidente_reportado', label: 'Incidente reportado', description: 'Se registró incidente y seguimiento' },
    { id: 'en_revision', label: 'En revisión (guardia en camino)', description: 'Guardia asignado, pendiente verificación' },
    { id: 'falso_positivo', label: 'Falso positivo', description: 'Sin novedad, falsa alarma' },
    { id: 'otro', label: 'Otro', description: 'Otra resolución (indicar en notas)' },
];

// Modal de tratamiento de alerta NVR: minimizable + resoluciones precargadas
const NvrAlertTreatmentModal = ({ alert, pendingCount, objectiveName, onConfirm, onMinimize }: { alert: any; pendingCount?: number; objectiveName?: string; onConfirm: (alert: any, resolutionType: string, notes: string) => void; onMinimize?: () => void }) => {
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    if (!alert) return null;
    const formatAlertTime = (ts: any) => {
        if (!ts) return '—';
        try {
            const s = ts?.seconds ?? ts;
            return new Date(typeof s === 'number' ? s * 1000 : s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch { return '—'; }
    };
    const handleAction = async (resolutionType: string) => {
        setLoading(true);
        try {
            await onConfirm(alert, resolutionType, notes);
        } finally {
            setLoading(false);
        }
    };
    return (
        <div className="fixed inset-0 z-[9999] bg-slate-900/90 flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col">
                <div className="bg-rose-600 text-white px-6 py-4 flex items-center justify-between shrink-0">
                    <h3 className="font-black uppercase flex items-center gap-2"><Siren size={24} /> Alerta IVS {pendingCount != null && pendingCount > 1 && <span className="text-rose-200 font-bold">({pendingCount} pendientes)</span>}</h3>
                    {onMinimize && <button type="button" onClick={onMinimize} className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-bold uppercase">Minimizar</button>}
                </div>
                <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>{alert.image_url && (
                            <div className="rounded-xl overflow-hidden border-2 border-rose-200">
                                <img src={alert.image_url} alt="Alerta IVS" className="w-full h-auto max-h-[280px] object-contain bg-slate-100" />
                            </div>
                        )}</div>
                        <div className="space-y-3">
                            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                                <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Información</p>
                                <dl className="space-y-1.5 text-sm">
                                    <div><dt className="text-slate-500 inline">Cámara: </dt><dd className="font-bold text-slate-800 inline">{alert.camera_name || '—'}</dd></div>
                                    <div><dt className="text-slate-500 inline">Ruta: </dt><dd className="font-mono text-slate-700 inline">{alert.route_key || '—'}</dd></div>
                                    <div><dt className="text-slate-500 inline">Objetivo: </dt><dd className="font-bold text-slate-800 inline">{objectiveName || alert.objective_id || 'Sin asignar'}</dd></div>
                                    <div><dt className="text-slate-500 inline">Tipo evento: </dt><dd className="text-slate-700 inline">{alert.event_type || '—'}</dd></div>
                                    <div><dt className="text-slate-500 inline">Hora: </dt><dd className="text-slate-700 inline">{formatAlertTime(alert.timestamp)}</dd></div>
                                </dl>
                            </div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notas (opcional)</label>
                            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Guardia notificado..." className="w-full px-3 py-2 rounded-xl border border-slate-200 text-slate-800 text-sm" rows={2} />
                        </div>
                    </div>
                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">Acciones — elegir una</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {NVR_RESOLUTION_OPTIONS.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleAction(opt.id)}
                                disabled={loading}
                                className="py-3 px-4 rounded-xl border-2 border-slate-200 bg-white hover:border-rose-400 hover:bg-rose-50 font-bold text-sm text-slate-700 hover:text-rose-700 transition-colors disabled:opacity-50 text-center"
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Barra flotante cuando el modal está minimizado (esperando resolución del guardia)
const NvrAlertMinimizedBar = ({ pendingCount, onExpand }: { pendingCount: number; onExpand: () => void }) => (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] bg-rose-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-4 border-2 border-rose-400 animate-in slide-in-from-bottom-2">
        <Siren size={24} className="shrink-0" />
        <span className="font-bold">
            {pendingCount === 1 ? '1 alerta pendiente de tratamiento' : `${pendingCount} alertas pendientes de tratamiento`}
        </span>
        <button type="button" onClick={onExpand} className="px-4 py-2 bg-white text-rose-700 rounded-xl font-black text-sm hover:bg-rose-50">
            Abrir
        </button>
    </div>
);

const InterruptModal = ({ isOpen, onClose, shift, logic, onVacancyCreated, onAudit }: any) => {
    if (!isOpen || !shift) return null;
    const colleagues = logic.processedData.filter((s:any) => s.objectiveId === shift.objectiveId && s.id !== shift.id && (s.isPresent || s.status === 'PRESENT') && !s.isCompleted);
    const isAlone = colleagues.length === 0;
    const handleLog = async () => { await addDoc(collection(db, 'novedades'), { type: 'BAJA_CUBIERTA', shiftId: shift.id, details: 'Retiro anticipado. Puesto cubierto por dotación.' }); await updateDoc(doc(db, 'turnos', shift.id), { checkOutTime: serverTimestamp(), status: 'COMPLETED', comments: 'Baja anticipada (Cubierto)' }); if (onAudit) await onAudit('Baja anticipada (cubierto)', `${shift.employeeName} en ${shift.objectiveName} (${shift.positionName}). Puesto cubierto por dotación.`, { objectiveName: shift.objectiveName, clientName: shift.clientName }); toast.success("Baja registrada. Puesto cubierto."); onClose(); };
    const handleProtocol = async () => { await updateDoc(doc(db, 'turnos', shift.id), { status: 'INTERRUPTED', checkOutTime: serverTimestamp() }); const { id: _omitId, ...rest } = shift; const payload: any = { ...rest, startTime: serverTimestamp(), employeeId: 'VACANTE', employeeName: 'VACANTE (BAJA)', isUnassigned: true, isPresent: false }; Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; }); const newRef = await addDoc(collection(db, 'turnos'), payload); const newShift = { ...shift, id: newRef.id, isUnassigned: true }; if (onAudit) await onAudit('Baja anticipada (protocolo)', `${shift.employeeName} en ${shift.objectiveName} (${shift.positionName}). Puesto descubierto, protocolo activado.`, { objectiveName: shift.objectiveName, clientName: shift.clientName }); onVacancyCreated(newShift); };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4"> <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${isAlone ? 'bg-purple-600' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"><Siren size={20}/> Baja Anticipada</h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <div className={`p-4 rounded-xl border mb-4 ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}> <h4 className={`font-bold text-sm mb-1 ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}> {isAlone ? '⚠️ GUARDIA SOLO EN EL OBJETIVO' : `✅ HAY ${colleagues.length} COMPAÑEROS`} </h4> <p className="text-xs text-slate-500"> {isAlone ? 'El puesto quedará descubierto. Se requiere activar protocolo.' : 'El puesto puede ser cubierto por la dotación actual.'} </p> </div> {isAlone ? ( <button onClick={handleProtocol} className="w-full py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 animate-pulse shadow-lg shadow-purple-200"> INICIAR PROTOCOLO DE COBERTURA </button> ) : ( <button onClick={handleLog} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200"> REGISTRAR NOVEDAD (CUBIERTO) </button> )} </div> </div> </div> );
};

const VECINOS_LABEL = '2. Intercambio (Vecinos < 2km)';

const CoverageModal = ({ isOpen, onClose, absenceShift, logic, onAudit }: any) => {
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

    // Ocupados HOY (cualquier turno asignado, en cualquier objetivo, incluyendo FRANCOS)
    // Regla pedida: no mostrar en "libres/volantes" a nadie que tenga turno asignado ese día.
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

        // Preferimos ubicación “operativa” (la que usa para marcar), y fallback a la guardada en el legajo.
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

    const francosHoy = (logic.processedData || [])
        .filter((s: any) => s.isFranco && isSameDay(s.shiftDateObj, shiftStart))
        .slice(0, 15);

    const getPhone = (x: any) => x?.phone || x?.telefono || x?.phoneNumber || x?.mobile || x?.celular || null;
    const handleWhatsapp = (x: any) => {
        const p = getPhone(x);
        if (!p) return toast.info('Sin teléfono/WhatsApp cargado.');
        window.open(`https://wa.me/${String(p).replace(/[^0-9]/g, '')}`);
    };
    const handlePhone = (x: any) => {
        const p = getPhone(x);
        if (!p) return toast.info('Sin teléfono cargado.');
        window.open(`tel:${p}`);
    };

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
            const typeLabel = type === 'RETENTION' ? 'Retención/Doble turno' : type === 'SWAP' ? 'Intercambio' : type === 'LIBRE' ? 'Libre/Volante' : type === 'VOLANTE' ? 'Volante' : type;
            if (onAudit) onAudit('Cobertura asignada', `${emp.fullName || emp.employeeName} en ${absenceShift.objectiveName} (${absenceShift.positionName}) - ${typeLabel}`, { objectiveName: absenceShift.objectiveName, clientName: absenceShift.clientName });
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
            if (onAudit) onAudit('Adelanto de turno', `Adelantó ingreso de ${nextShift.employeeName} en ${absenceShift.objectiveName} (${absenceShift.positionName})`, { objectiveName: absenceShift.objectiveName, clientName: absenceShift.clientName });
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
            if (onAudit) onAudit('Franco convocado', `Convocó franco trabajado: ${francoShift.employeeName} en ${absenceShift.objectiveName} (${absenceShift.positionName})`, { objectiveName: absenceShift.objectiveName, clientName: absenceShift.clientName });
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
                        {presentSamePosition.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {presentSamePosition.slice(0, 5).map((s: any) => (
                                    <div key={s.id} className="flex justify-between items-center text-[11px]">
                                        <span className="font-bold">{s.employeeName}</span>
                                        <span className="text-slate-400">{formatTimeRange(s.shiftDateObj, s.endDateObj)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 1. Retención */}
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

                    {/* 2. Intercambio */}
                    <SectionList
                        title={VECINOS_LABEL}
                        color="purple"
                        expanded={expanded === 2}
                        onToggle={() => setExpanded(expanded === 2 ? null : 2)}
                        items={neighborGuards}
                        onAction={(e: any) => handleAssign(e, 'SWAP')}
                        onWhatsapp={handleWhatsapp}
                        onPhone={handlePhone}
                        context="INTERCAMBIO"
                    />

                    {/* 3. Libres hoy */}
                    <SectionList
                        title="3. Sin Turno Asignado / Retenes"
                        color="cyan"
                        expanded={expanded === 3}
                        onToggle={() => setExpanded(expanded === 3 ? null : 3)}
                        items={libresHoy}
                        onAction={(e: any) => handleAssign(e, 'LIBRE')}
                        onWhatsapp={handleWhatsapp}
                        onPhone={handlePhone}
                        context="COBERTURA"
                    />

                    {/* 4. Volantes */}
                    <SectionList
                        title="4. Volantes (Por Cercanía)"
                        color="slate"
                        expanded={expanded === 4}
                        onToggle={() => setExpanded(expanded === 4 ? null : 4)}
                        items={volantes}
                        onAction={(e: any) => handleAssign(e, 'VOLANTE')}
                        onWhatsapp={handleWhatsapp}
                        onPhone={handlePhone}
                        context="COBERTURA"
                    />

                    {/* 5. Adelantar siguiente */}
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

                    {/* 6. Franco */}
                    <section className="space-y-2">
                        <h4 className="text-xs font-black text-emerald-700 uppercase">6. Convocar Franco</h4>
                        {francosHoy.length > 0 ? (
                            francosHoy.map((s: any) => (
                                <div key={s.id} className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex justify-between items-center">
                                    <div>
                                        <div className="text-xs font-black text-slate-800">{s.employeeName}</div>
                                        <div className="text-[10px] text-slate-500 font-bold">Disponible hoy • {formatTimeRange(s.shiftDateObj, s.endDateObj)}</div>
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

const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => { if (!isOpen) return null; return ( <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"> <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"> <h3 className="font-bold mb-2">Retención de Guardia</h3> <p className="text-sm text-slate-500 mb-4">{retainedShift?.employeeName || 'Guardia'}</p> <button onClick={onClose} className="w-full py-2 bg-slate-100 rounded font-bold">Cerrar</button> </div> </div> ); };
const CheckOutModal = ({ isOpen, onClose, onConfirm, employeeName }: any) => { const [novedad, setNovedad] = useState(''); if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"><h3 className="font-bold mb-4">Salida: {employeeName}</h3><button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold mb-2">Salida Normal</button><textarea className="w-full p-2 border rounded mb-2" placeholder="Novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/><button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} className="w-full py-2 bg-slate-100 font-bold rounded">Reportar y Salir</button><button onClick={onClose} className="mt-2 text-sm text-slate-400 w-full">Cancelar</button></div></div>); };
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 text-center"><AlertTriangle size={48} className="mx-auto text-amber-500 mb-4"/><h3 className="font-bold text-lg mb-2">Confirmar Ausencia</h3><p className="text-sm text-slate-500 mb-6">¿{shift?.employeeName} no se presentó?</p><button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold mb-2">MARCAR AUSENTE</button><button onClick={onClose} className="text-sm text-slate-400">Cancelar</button></div></div>); };
const WorkedDayOffModal = (props: any) => <WorkedDayOffModalPro {...props} />;

const GuardCard = ({ shift, viewTab, onOpenCheckout, onOpenAttendance, onOpenHandover, onOpenInterrupt, onOpenCoverage, onReportPlanning, onOpenWorkedFranco, onSwitchToNoLlego, isCompact, selectedShiftId, onSelectShift }: any) => { 
    let statusColor = 'border-l-slate-400'; let statusBg = 'bg-white';
    let iconStatus = <Shield size={10}/>;

    if (shift.isReportedToPlanning) { statusColor = 'border-l-slate-500'; statusBg = 'bg-slate-100 opacity-90'; } 
    else if (shift.isResolvedByOps) { statusColor = 'border-l-indigo-500'; statusBg = 'bg-indigo-50'; } 
    else if (shift.isUnassigned) { statusColor = 'border-l-rose-500'; statusBg = 'bg-rose-50/50'; } 
    else if (shift.isRetention) { statusColor = 'border-l-orange-500'; statusBg = 'bg-orange-50/50'; } 
    else if (shift.isPresent) { statusColor = 'border-l-emerald-500'; statusBg = 'bg-emerald-50/30'; } 
    else if (shift.isAbsent) { statusColor = 'border-l-slate-700'; statusBg = 'bg-slate-100'; } 
    else if (shift.isAbsenceLike) { statusColor = 'border-l-red-600'; statusBg = 'bg-rose-50/50'; }
    else if (shift.isLateArrival) { statusColor = 'border-l-amber-500'; statusBg = 'bg-amber-50'; }
    else if (shift.isPotentialAbsence) { statusColor = 'border-l-red-600'; statusBg = 'bg-amber-50'; } 
    else if (shift.isFranco) { statusColor = 'border-l-blue-500'; statusBg = 'bg-blue-50/30'; }

    const handleCheckIn = () => onOpenHandover(shift);
    const handleReport = (e: any) => { e.stopPropagation(); if(confirm(`¿CONFIRMAR NOTIFICACIÓN?\nSe enviará alerta a Planificación.`)) onReportPlanning(shift); };
    
    // --- LÓGICA V184: -15 / +60 ---
    const now = new Date();
    const start = toDate(shift.shiftDateObj);
    const diff = (now.getTime() - start.getTime()) / 60000;
    const canCheckIn = diff >= -15 && diff <= 60 && !shift.isPresent; 
    const showResolveBadge = viewTab === 'PRIORIDAD' && (shift.isAbsenceLike || shift.isLateArrival || (shift.isUnassigned && !shift.isReportedToPlanning));

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

    const isSelected = selectedShiftId === shift.id;
    return (
        <div 
            role="button"
            tabIndex={0}
            onClick={() => onSelectShift?.(isSelected ? null : shift)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectShift?.(isSelected ? null : shift); } }}
            className={`rounded-xl border shadow-sm relative overflow-hidden group hover:shadow-md transition-all mb-2 cursor-pointer ${statusBg} ${isSelected ? 'ring-2 ring-indigo-500 border-indigo-400' : 'border-slate-200'}`}
        > 
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
                        {shift.isFranco && <div className="bg-emerald-600 text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm">FRANCO</div>}
                        {shift.isUnassigned && !shift.isReportedToPlanning && <div className="bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm animate-pulse">DESCUBIERTO</div>}
                        {shift.isAbsenceLike && viewTab === 'AUSENTES' && <div className={`text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm ${shift.isAbsent ? 'bg-rose-600' : 'bg-amber-500'}`}>{shift.isAbsent ? 'AUSENCIA' : 'AÚN NO LLEGÓ'}</div>}
                        {shift.isLateArrival && viewTab !== 'AUSENTES' && <div className="bg-amber-500 text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm">NO LLEGO</div>}
                        {shift.isAbsenceLike && viewTab !== 'AUSENTES' && !shift.isLateArrival && <div className={`text-white text-[9px] font-black px-2 py-0.5 rounded shadow-sm ${shift.isAbsent ? 'bg-rose-600' : 'bg-amber-500'}`}>{shift.isAbsent ? 'AUSENCIA' : 'AÚN NO LLEGÓ'}</div>}
                        {showResolveBadge && <div className="bg-rose-700 text-white text-[9px] font-black px-2 py-0.5 rounded animate-pulse shadow-sm">RESOLVER</div>}
                        
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
                            <button onClick={(e) => { e.stopPropagation(); window.open(`https://wa.me/${shift.phone.replace(/[^0-9]/g, '')}`); }} className="p-2 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors"><MessageCircle size={14}/></button>
                            <button onClick={(e) => { e.stopPropagation(); window.open(`tel:${shift.phone}`); }} className="p-2 bg-slate-50 text-slate-600 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"><Phone size={14}/></button>
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
                    {viewTab === 'FRANCOS' && shift.isFranco && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onOpenWorkedFranco?.(shift); }}
                            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-emerald-700 flex items-center justify-center gap-1 transition-colors"
                        >
                            <Briefcase size={14}/> CONVOCAR
                        </button>
                    )}
                    {/* Solapa NO LLEGO: Llegó (presente con llegada tarde) o Ausente (modal tratamiento). En NO_LLEGO siempre se puede dar presente para registrar horario de llegada. */}
                    {(viewTab === 'NO_LLEGO' || (viewTab === 'PRIORIDAD' && shift.isLateArrival)) && (
                        <>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (viewTab !== 'NO_LLEGO' && !canCheckIn) { toast.info('Fuera de ventana de presente.'); return; }
                                    onOpenHandover(shift);
                                }}
                                disabled={viewTab !== 'NO_LLEGO' && !canCheckIn}
                                className={`flex-[2] py-2 rounded-lg text-[11px] font-bold uppercase shadow-sm flex items-center justify-center gap-1 transition-colors ${(viewTab === 'NO_LLEGO' || canCheckIn) ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                                title={diff > 5 ? 'Registrar llegada tarde y horario de ingreso' : 'Dar presente'}
                            >
                                <PlayCircle size={14}/> {diff > 5 ? 'LLEGÓ (Llegada tarde)' : 'LLEGÓ'}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onOpenAttendance(shift); }} className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold uppercase hover:bg-slate-50 flex items-center justify-center gap-1 shadow-sm" title="Abrir modal de tratamiento de ausencias"><AlertTriangle size={14}/> AUSENTE</button>
                        </>
                    )}
                    {/* En AUSENTES/PRIO: "Aún no llegó" clickeable → pasa a solapa NO LLEGO; ahí elige Llegó o Ausente. */}
                    {(viewTab === 'AUSENTES' || (viewTab === 'PRIORIDAD' && shift.isAbsenceLike && !shift.isLateArrival)) && !shift.isUnassigned && !shift.isAbsent && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onSwitchToNoLlego?.(); }}
                            className="w-full py-2 rounded-lg text-[11px] font-bold uppercase border-2 border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 flex items-center justify-center gap-1 transition-colors"
                            title="Ir a solapa Aún no llegó para elegir Llegó o Ausente"
                        >
                            <Clock size={14}/> AÚN NO LLEGÓ — Clic para ir a resolver
                        </button>
                    )}
                    {/* Ausencia ya declarada: no mostrar CUBRIR/DEVOLVER (ya se dio solución en el modal). */}
                    {(viewTab === 'AUSENTES' || (viewTab === 'PRIORIDAD' && shift.isAbsenceLike)) && !shift.isUnassigned && shift.isAbsent && (
                        <div className="w-full py-2 text-center text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-lg">Ausencia registrada</div>
                    )}
                    {(shift.isUnassigned) && !shift.isReportedToPlanning && (viewTab === 'VACANTES' || viewTab === 'PRIORIDAD') && (
                        <><button onClick={(e) => { e.stopPropagation(); onOpenCoverage(shift); }} className="flex-[2] py-2 bg-rose-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-rose-700 flex items-center justify-center gap-1 transition-colors"><Siren size={14}/> CUBRIR</button><button onClick={(e) => { e.stopPropagation(); handleReport(e); }} className="flex-1 py-2 bg-slate-700 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-slate-800 flex items-center justify-center gap-1 transition-colors"><CornerUpLeft size={14}/> DEVOLVER</button></>
                    )}
                    {shift.isReportedToPlanning && (viewTab === 'VACANTES' || viewTab === 'PRIORIDAD') && (
                        <div className={`w-full text-center text-[10px] font-bold py-1 rounded border ${shift.planningResponse === 'RECIBIDO' || shift.planningResponse === 'RECEIVED' ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-slate-400 bg-slate-50 border-slate-100'}`}>
                            {shift.planningResponse === 'RECIBIDO' || shift.planningResponse === 'RECEIVED' ? 'RECIBIDO POR PLANIFICACIÓN' : 'ESPERANDO RESPUESTA DE PLANIFICACIÓN'}
                        </div>
                    )}
                    {viewTab === 'PLAN' && (
                        <>
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleCheckIn(); }} 
                                disabled={!canCheckIn} 
                                className={`flex-[2] py-2 rounded-lg text-[11px] font-bold uppercase shadow-sm flex items-center justify-center gap-1 transition-colors ${canCheckIn ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                            >
                                <PlayCircle size={14}/> 
                                {diff > 5 && diff <= 60 ? 'LLEGADA TARDE' : (diff > 60 ? 'AUSENCIA' : 'DAR PRESENTE')}
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onOpenAttendance(shift); }} className="flex-1 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold uppercase hover:bg-slate-50 flex items-center justify-center gap-1 shadow-sm"><AlertTriangle size={14}/> AUSENTE</button>
                        </>
                    )}
                    {(viewTab === 'ACTIVOS' || viewTab === 'RETENIDOS') && (<><button onClick={(e) => { e.stopPropagation(); onOpenCheckout(shift); }} className="flex-[2] py-2 bg-purple-600 text-white rounded-lg text-[11px] font-bold uppercase shadow-sm hover:bg-purple-700 flex items-center justify-center gap-1"><LogOut size={14}/> SALIDA</button><button onClick={(e) => { e.stopPropagation(); onOpenInterrupt(shift); }} className="flex-1 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[11px] font-bold uppercase hover:bg-red-100 flex items-center justify-center gap-1"><Siren size={14}/> BAJA</button></>)}
                </div>
            </div>
        </div>
    ); 
};

const ObjectiveGroup = ({ group, modals, isCompact, onReport, viewTab, onOpenWorkedFranco, selectedShiftId, onSelectShift }: any) => {
    const [expanded, setExpanded] = useState(true);
    return (
        <div className="bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden mb-3">
            <div className="p-2.5 bg-slate-100 border-b border-slate-200 flex justify-between items-center cursor-pointer hover:bg-slate-200" onClick={()=>setExpanded(!expanded)}>
                <div className="flex items-center gap-2"><div className="bg-slate-700 text-white w-5 h-5 rounded flex items-center justify-center text-[10px] font-black">{group.items.length}</div><h4 className="font-bold text-xs text-slate-700 uppercase truncate max-w-[200px]">{group.name}</h4></div>
                {expanded ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}
            </div>
            {expanded && (
                <div className="p-2 bg-slate-50/50 space-y-2">
                    {group.items.map((s:any) => (
                        <GuardCard key={s.id} shift={s} viewTab={viewTab} isCompact={isCompact} selectedShiftId={selectedShiftId} onSelectShift={onSelectShift} onSwitchToNoLlego={modals.setViewTab ? () => modals.setViewTab('NO_LLEGO') : undefined} onOpenCheckout={(x:any)=>modals.setCheckoutData({isOpen:true, shift:x})} onOpenAttendance={(x:any)=>modals.setAttendanceData({isOpen:true, shift:x})} onOpenHandover={(x:any)=>modals.setHandoverData({isOpen:true, shift:x})} onOpenInterrupt={(x:any)=>modals.setInterruptData({isOpen:true, shift:x})} onOpenCoverage={(x:any)=>modals.setCoverageData({isOpen:true, shift:x})} onReportPlanning={onReport} onOpenWorkedFranco={onOpenWorkedFranco}/>
                    ))}
                </div>
            )}
        </div>
    );
};

export default function OperacionesPage() {
    const logic = useOperacionesMonitor();
    // Bitácora: solo acciones del operador (módulo OPERACIONES), sin planificación ni otros módulos
    const bitacoraLogs = useMemo(() => (logic.recentLogs || []).filter((l: any) => String(l.module || '').toUpperCase() === 'OPERACIONES'), [logic.recentLogs]);
    const [isExternalMap, setIsExternalMap] = useState(false);
    const [checkoutData, setCheckoutData] = useState({isOpen: false, shift: null} as any);
    const [attendanceData, setAttendanceData] = useState({isOpen: false, shift: null} as any);
    const [handoverData, setHandoverData] = useState({isOpen: false, shift: null} as any);
    const [interruptData, setInterruptData] = useState({isOpen: false, shift: null} as any);
    const [coverageData, setCoverageData] = useState({isOpen: false, shift: null} as any);
    const [workedFrancoData, setWorkedFrancoData] = useState({isOpen: false, shift: null} as any);
    const [isGrouped, setIsGrouped] = useState(false);
    const [solicitudes, setSolicitudes] = useState([] as any[]);
    const [showHelp, setShowHelp] = useState(false);
    const [selectedShiftId, setSelectedShiftId] = useState(null as string | null);
    const [bitacoraColWidths, setBitacoraColWidths] = useState([72, 100, 100, 140, 220]);
    const [bitacoraResizing, setBitacoraResizing] = useState<number | null>(null);
    const [nvrAlerts, setNvrAlerts] = useState<any[]>([]);
    const [nvrModalMinimized, setNvrModalMinimized] = useState(false);

    const handleBitacoraResize = (colIndex: number, delta: number) => {
        setBitacoraColWidths(prev => {
            const next = [...prev];
            const w = Math.max(40, next[colIndex] + delta);
            next[colIndex] = w;
            return next;
        });
    };

    useEffect(() => {
        if (bitacoraResizing === null) return;
        const onMove = (e: MouseEvent) => handleBitacoraResize(bitacoraResizing, e.movementX);
        const onUp = () => setBitacoraResizing(null);
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [bitacoraResizing]);

    // Solicitudes de presente (CHECKIN_REQUEST, ABSENCE_ALERT) desde novedades
    useEffect(() => {
        const q = query(
            collection(db, 'novedades'),
            where('type', 'in', ['CHECKIN_REQUEST', 'ABSENCE_ALERT'])
        );
        const unsub = onSnapshot(q, (snap) => {
            const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const pending = items.filter((e: any) => {
                const st = String(e.status || '').toUpperCase();
                return !st || st === 'PENDIENTE' || st === 'PENDING';
            });
            pending.sort((a: any, b: any) => {
                const sa = (a.createdAt?.seconds ?? 0);
                const sb = (b.createdAt?.seconds ?? 0);
                return sa - sb;
            });
            setSolicitudes(pending);
        });
        return () => unsub();
    }, []);

    // Alertas NVR (IVS) pendientes: modal obligatorio hasta dar tratamiento
    useEffect(() => {
        const q = query(collection(db, 'alerts'), where('status', '==', 'pending'));
        const unsub = onSnapshot(
            q,
            (snap) => {
                const list = snap.docs.map((d) => {
                    const data = d.data();
                    const oid = data.objective_id;
                    const objective_id = typeof oid === 'string' ? oid.trim() : (oid && typeof (oid as any).id === 'string' ? (oid as any).id : String(oid ?? '')).trim();
                    return { id: d.id, ...data, objective_id };
                });
                list.sort((a: any, b: any) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));
                setNvrAlerts(list.slice(0, 50));
            },
            (err) => { console.error('alerts subscription', err); setNvrAlerts([]); }
        );
        return () => unsub();
    }, []);

    const handleNvrAlertTreatment = async (alert: any, resolutionType: string, notes: string) => {
        try {
            const status = resolutionType === 'falso_positivo' ? 'false_alarm' : 'acknowledged';
            await updateDoc(doc(db, 'alerts', alert.id), {
                status,
                resolution_type: resolutionType,
                guard_notes: notes?.trim() || '',
                acknowledged_at: serverTimestamp(),
                acknowledged_by: getAuth().currentUser?.uid ?? null,
            });
            const detalle = resolutionType === 'falso_positivo' ? 'Falso positivo' : 'Visto / Atendido';
            await registrarBitacora('Alerta NVR tratada', `Operador: ${detalle}. ${alert.camera_name || alert.id}${notes?.trim() ? '. Notas: ' + notes.trim() : ''}`, {});
            toast.success(resolutionType === 'falso_positivo' ? 'Marcada como falso positivo' : 'Alerta marcada como tratada');
        } catch (e) {
            console.error(e);
            toast.error('No se pudo guardar el tratamiento');
        }
    };

    const handleAcknowledgeAbsence = async (e: any) => {
        try {
            await updateDoc(doc(db, 'novedades', e.id), { status: 'RECEIVED', receivedAt: serverTimestamp() });
            await registrarBitacora('Novedad vista', `Marcó como visto: ${e.type || 'novedad'} ${e.description || e.id || ''}`);
            toast.success('Marcado como visto');
        } catch {
            toast.error('Error al marcar visto');
        }
    };
    const handleApproveCheckIn = async (e: any) => {
        try {
            if (!e.shiftId) { toast.error('Turno no encontrado'); return; }
            const turnoRef = doc(db, 'turnos', e.shiftId);
            const turnoSnap = await getDoc(turnoRef);
            if (!turnoSnap.exists()) { toast.error('Turno no encontrado'); return; }
            const data = turnoSnap.data();
            const startTime = data?.startTime?.toDate?.() ?? null;
            const now = new Date();
            const isLate = startTime && (now.getTime() - startTime.getTime() > 300000); // >5 min
            await updateDoc(turnoRef, {
                status: 'PRESENT',
                isPresent: true,
                isLate,
                checkInTime: serverTimestamp(),
                checkInMethod: 'OPERATOR',
                checkInOperator: getAuth().currentUser?.uid ?? null,
                checkInCoords: data?.checkInRequestedCoords ?? null,
                checkInRequestStatus: 'APPROVED'
            });
            await updateDoc(doc(db, 'novedades', e.id), {
                status: 'RESUELTO',
                resolution: 'APROBADO',
                resolvedAt: serverTimestamp(),
                resolvedBy: getAuth().currentUser?.uid ?? null
            });
            await registrarBitacora('Presente aprobado', `Aprobó ingreso/presente para turno ${e.shiftId || ''}`);
            toast.success('Presente aprobado');
        } catch (err) {
            console.error(err);
            toast.error('Error aprobando presente');
        }
    };
    const handleRejectCheckIn = async (e: any) => {
        try {
            if (e.shiftId) {
                await updateDoc(doc(db, 'turnos', e.shiftId), { checkInRequestStatus: 'REJECTED' });
            }
            await updateDoc(doc(db, 'novedades', e.id), {
                status: 'RECHAZADO',
                resolution: 'RECHAZADO',
                resolvedAt: serverTimestamp(),
                resolvedBy: getAuth().currentUser?.uid ?? null
            });
            await registrarBitacora('Solicitud rechazada', `Rechazó solicitud de presente para turno ${e.shiftId || ''}`);
            toast.success('Solicitud rechazada');
        } catch (err) {
            console.error(err);
            toast.error('Error rechazando solicitud');
        }
    };

    const handleUndockMap = () => { window.open('/admin/operaciones/map-view', 'CronoMapTactical', 'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no'); setIsExternalMap(true); };
    const generateDailyReport = () => { const doc = new jsPDF(); const dateStr = new Date().toLocaleDateString('es-AR', {timeZone: 'America/Argentina/Cordoba'}); doc.setFontSize(18); doc.text("Informe de Gestión COSP", 14, 20); doc.setFontSize(10); doc.text(`Fecha: ${new Date().toLocaleString('es-AR', {timeZone: 'America/Argentina/Cordoba'})}`, 14, 30); const validLogs = bitacoraLogs.filter((log: any) => log.formattedActor !== 'VACANTE'); const rows = validLogs.map((log: any) => [formatTimeSimple(log.time), (log.action || 'LOG').replace('MANUAL_', ''), log.formattedActor || 'Sistema', log.objectiveName || '-', log.fullDetail || log.details || '-']); autoTable(doc, { head: [["Hora", "Evento", "Operador", "Objetivo", "Detalle"]], body: rows, startY: 50, styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] } }); doc.save(`bitacora_${dateStr}.pdf`); };
    const handleMarkAbsent = async (shift: any) => { try { await updateDoc(doc(db, 'turnos', shift.id), { status: 'ABSENT', isAbsent: true }); await registrarBitacora('Marcó ausente', `${shift.employeeName} en ${shift.objectiveName || 'objetivo'} (${shift.positionName || 'puesto'}). No se presentó.`, { objectiveName: shift.objectiveName, clientName: shift.clientName }); setAttendanceData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: shift}); } catch (e) { toast.error("Error al marcar ausencia"); } };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };
    const handleReportPlanning = async (shift: any) => { 
        try { 
            const isVirtualVacancy = !!shift.isVirtual || (typeof shift.id === 'string' && (shift.id.startsWith('SLA_GAP') || shift.id.startsWith('V124_') || shift.id.startsWith('V124_GAP')));
            let targetId = shift.id;

            if (isVirtualVacancy) { 
                const newRef = doc(collection(db, 'turnos')); 
                targetId = newRef.id;
                const startDate = shift.shiftDateObj instanceof Date ? shift.shiftDateObj : (shift.startTime?.toDate ? shift.startTime.toDate() : new Date());
                const endDate = shift.endDateObj instanceof Date ? shift.endDateObj : (shift.endTime?.toDate ? shift.endTime.toDate() : new Date(startDate.getTime() + 8 * 3600000));
                const newShiftData = {
                    startTime: Timestamp.fromDate(startDate),
                    endTime: Timestamp.fromDate(endDate),
                    employeeId: 'VACANTE',
                    employeeName: shift.employeeName || 'VACANTE',
                    objectiveId: shift.objectiveId || null,
                    clientId: shift.clientId || null,
                    code: shift.code || null,
                    positionName: shift.positionName || null,
                    objectiveName: shift.objectiveName || null,
                    clientName: shift.clientName || null,
                    status: 'UNCOVERED_REPORTED',
                    isReported: true,
                    isUnassigned: true,
                    comments: 'Vacante de Contrato Reportada',
                    createdAt: serverTimestamp(),
                    origin: shift.id?.startsWith('V124_') ? 'VIRTUAL_VACANCY' : 'SLA_GAP'
                };
                await setDoc(newRef, newShiftData); 
            } else if (targetId && typeof targetId === 'string' && targetId.length > 0) { 
                await updateDoc(doc(db, 'turnos', targetId), { status: 'UNCOVERED_REPORTED', isReported: true }); 
            } else {
                toast.error('Turno sin ID válido para reportar.');
                return;
            }
            await addDoc(collection(db, 'novedades'), { type: 'VACANTE_NO_CUBIERTA', title: 'Vacante Reportada', clientId: shift.clientId, objectiveId: shift.objectiveId, shiftId: targetId, description: `Vacante no cubierta en ${shift.objectiveName || 'objetivo'} (${shift.positionName || 'puesto'})`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES', status: 'pending', priority: 'high' }); 
            const auth = getAuth();
            const operatorName = auth.currentUser?.email?.split('@')[0] || auth.currentUser?.displayName || 'Operador';
            await addDoc(collection(db, 'audit_logs'), {
                action: 'Devolución a Planificación',
                module: 'OPERACIONES',
                details: `Devolvió vacante a Planificación: ${shift.objectiveName || 'objetivo'} (${shift.positionName || 'puesto'})${shift.employeeName ? ` - ${String(shift.employeeName).replace('VACANTE: ', '')}` : ''}`,
                timestamp: serverTimestamp(),
                actorName: operatorName,
                actorUid: auth.currentUser?.uid || null
            });
            toast.success('Reporte enviado correctamente'); 
        } catch (e: any) { 
            console.error('handleReportPlanning', e);
            toast.error(e?.message || 'Error al reportar'); 
        } 
    };

    // Atajos: A = Ausente, P = Presente, C = Cubrir, D = Devolver (solo con tarjeta seleccionada en PRIO/PLAN)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
            if (!selectedShiftId) return;
            const shift = logic.listData.find((s: any) => s.id === selectedShiftId);
            if (!shift || (logic.viewTab !== 'PRIORIDAD' && logic.viewTab !== 'PLAN')) return;
            const key = e.key.toLowerCase();
            const startMs = shift.shiftDateObj ? (shift.shiftDateObj.seconds ? shift.shiftDateObj.seconds * 1000 : new Date(shift.shiftDateObj).getTime()) : 0;
            const diffMin = startMs ? (Date.now() - startMs) / 60000 : 0;
            const inWindow = diffMin >= -15 && diffMin <= 60 && !shift.isPresent;
            if (key === 'a') { e.preventDefault(); handleMarkAbsent(shift); }
            else if (key === 'p') { e.preventDefault(); if (!inWindow) { toast.info('Fuera de ventana de presente.'); return; } setHandoverData({ isOpen: true, shift }); }
            else if (key === 'c') { e.preventDefault(); if (shift.isUnassigned) setCoverageData({ isOpen: true, shift }); }
            else if (key === 'd') { e.preventDefault(); handleReportPlanning(shift); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedShiftId, logic.listData, logic.viewTab]);

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
        const groups: any = {};
        logic.listData.forEach((s: any) => { const k = s.objectiveId || 'unknown'; if (!groups[k]) groups[k] = { id: k, name: s.objectiveName || 'Sin Objetivo', client: s.clientName || 'Cliente', items: [] }; groups[k].items.push(s); });
        return Object.values(groups).sort((a:any, b:any) => (a.client || '').localeCompare(b.client || ''));
    }, [logic.listData, isGrouped]);

    const modalSetters = { setCheckoutData, setAttendanceData, setHandoverData, setInterruptData, setCoverageData, setViewTab: logic.setViewTab };
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

    // Objetivos que tienen coordenadas (para fallback del mapa)
    const objectivesWithCoords = useMemo(() => (logic.objectives || []).filter((o: any) => o != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng))), [logic.objectives]);
    // Vacantes reportadas o devueltas a planificación (mismo día) para mostrarlas en el mapa
    const reportedOrReturnedShifts = useMemo(() => {
        const now = new Date();
        const sameDay = (d: Date) => d && now.toLocaleDateString('en-CA') === d.toLocaleDateString('en-CA');
        return (logic.processedData || []).filter((s: any) => s.isUnassigned && s.isReportedToPlanning && s.shiftDateObj && sameDay(s.shiftDateObj instanceof Date ? s.shiftDateObj : new Date(s.shiftDateObj?.seconds ? s.shiftDateObj.seconds * 1000 : s.shiftDateObj)));
    }, [logic.processedData]);
    const reportedObjectiveIds = useMemo(() => new Set(reportedOrReturnedShifts.map((s: any) => s.objectiveId).filter(Boolean)), [reportedOrReturnedShifts]);
    // Shifts para el mapa: lista de la solapa + vacantes reportadas/devueltas (para que aparezcan en el mapa con su estado)
    const shiftsForMap = useMemo(() => {
        const listIds = new Set((logic.listData || []).map((s: any) => s.id));
        const reported = reportedOrReturnedShifts.filter((s: any) => !listIds.has(s.id));
        return [...(logic.listData || []), ...reported];
    }, [logic.listData, reportedOrReturnedShifts]);
    // En el mapa: objetivos de la solapa + objetivos con alertas NVR + objetivos con vacantes reportadas/devueltas
    const objectivesForMap = useMemo(() => {
        const norm = (x: any) => String(x ?? '').trim();
        const tab = logic.viewTab as any;
        const base = logic.filteredObjectives || [];
        const allObjs = logic.objectives || [];
        const alertObjIds = new Set((nvrAlerts || []).map((a: any) => norm(a.objective_id)).filter(Boolean));
        const withAlerts = allObjs.filter((o: any) => alertObjIds.has(norm(o.id)));
        if (tab === 'TODOS') return allObjs.length ? allObjs : base;
        const ids = new Set((logic.listData || []).map((s: any) => s.objectiveId).filter(Boolean));
        const fromTab = base.filter((o: any) => ids.has(o.id));
        const withReported = allObjs.filter((o: any) => reportedObjectiveIds.has(o.id));
        const combined = fromTab.length ? fromTab : base;
        const extra = withAlerts.filter((o: any) => !combined.some((c: any) => c.id === o.id));
        const extraReported = withReported.filter((o: any) => !combined.some((c: any) => c.id === o.id) && !extra.some((e: any) => e.id === o.id));
        const result = [...combined, ...extra, ...extraReported];
        const centerLat = -31.4201, centerLng = -64.1888;
        return (result.length ? result : objectivesWithCoords).map((o: any) => {
            const hasCoords = o != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng));
            if (hasCoords) return o;
            return { ...o, lat: centerLat, lng: centerLng };
        });
    }, [logic.filteredObjectives, logic.listData, logic.viewTab, nvrAlerts, logic.objectives, objectivesWithCoords, reportedObjectiveIds]);

    const firstPendingAlert = (nvrAlerts && nvrAlerts.length > 0) ? nvrAlerts[0] : null;

    const Layout = DashboardLayout;
    const layout =
        <Layout>
            <Toaster position="top-right" />
            <Head><title>COSP V184.0</title></Head>
            <style>{POPUP_STYLES}</style>

            {/* Modal de tratamiento de alerta NVR: minimizable + resoluciones precargadas */}
            {nvrModalMinimized && nvrAlerts.length > 0 && (
                <NvrAlertMinimizedBar pendingCount={nvrAlerts.length} onExpand={() => setNvrModalMinimized(false)} />
            )}
            {firstPendingAlert && !nvrModalMinimized && (
                <NvrAlertTreatmentModal alert={firstPendingAlert} pendingCount={nvrAlerts.length} objectiveName={logic.objectives?.find((o: any) => String(o?.id) === String(firstPendingAlert?.objective_id))?.name} onConfirm={handleNvrAlertTreatment} onMinimize={() => setNvrModalMinimized(true)} />
            )}

            <div className="h-[calc(100vh-100px)] flex flex-col lg:flex-row gap-4 p-2 animate-in fade-in">
                {!isExternalMap && (
                    <div className="flex-1 lg:flex-[3] bg-slate-100 rounded-3xl border border-slate-200 overflow-hidden relative shadow-inner">
                        {/* Mapa filtra por solapa: objectivesForMap = objetivos con datos en la solapa activa; key fuerza actualización al cambiar tab */}
                        <OperacionesMap 
                            key={`ops-map-${logic.viewTab}-${(objectivesForMap || []).map((o:any)=>o.id).sort().join(',').slice(0,120)}`}
                            center={[-31.4201, -64.1888]} 
                            allObjectives={(objectivesForMap || []).some((o: any) => Number.isFinite(Number(o?.lat)) && Number.isFinite(Number(o?.lng))) ? objectivesForMap : objectivesWithCoords} 
                            filteredShifts={shiftsForMap}
                            nvrAlerts={nvrAlerts}
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
                                <button onClick={() => setShowHelp(true)} className="px-3 py-1.5 bg-slate-900 text-white font-bold text-xs rounded-lg">Ayuda</button>
                                <button onClick={() => logic.setIsCompact(!logic.isCompact)} className="p-2 bg-slate-100 rounded-lg text-slate-600">{logic.isCompact ? <Maximize2 size={16}/> : <Minimize2 size={16}/>}</button>
                            </div>
                        </div>
                        <div className="mb-3 bg-amber-50 border border-amber-100 rounded-xl p-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black uppercase text-amber-700">Solicitudes de Presente ({solicitudes.length})</span>
                            </div>
                            {solicitudes.length === 0 ? (
                                <div className="text-[10px] text-slate-500">Sin solicitudes pendientes.</div>
                            ) : (
                                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                    {solicitudes.map((req: any) => {
                                        const isAbsenceAlert = String(req.type || '').toUpperCase() === 'ABSENCE_ALERT';
                                        return (
                                            <div key={req.id} className="bg-white border rounded-lg p-2 flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-bold text-slate-800 truncate flex items-center gap-2">
                                                        {req.employeeName || 'Empleado'}
                                                        {isAbsenceAlert && <span className="text-[9px] font-black text-rose-600">AUSENCIA &lt;4H</span>}
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 truncate">{req.objectiveName || 'Objetivo'} · {req.shiftId || '-'}</div>
                                                    <div className="text-[10px] text-slate-400">Solicitud: {formatTimeSimple(req.createdAt)}</div>
                                                </div>
                                                <div className="flex gap-1">
                                                    {isAbsenceAlert ? (
                                                        <button onClick={() => handleAcknowledgeAbsence(req)} className="px-2 py-1 bg-slate-800 text-white text-[10px] font-black rounded">VISTO</button>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => handleApproveCheckIn(req)} className="px-2 py-1 bg-emerald-600 text-white text-[10px] font-black rounded">APROBAR</button>
                                                            <button onClick={() => handleRejectCheckIn(req)} className="px-2 py-1 bg-rose-600 text-white text-[10px] font-black rounded">RECHAZAR</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="mb-3"><select value={logic.selectedClientId} onChange={(e) => logic.setSelectedClientId(e.target.value)} className="w-full p-2 text-xs font-bold border border-slate-300 rounded-lg bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700"><option value="">TODOS LOS CLIENTES</option>{logic.uniqueClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                        <div className="bg-slate-100 rounded-xl mb-3 p-2">
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                                {tabs.map((t) => {
                                    const isActive = logic.viewTab === t.id;
                                    const count = t.count || 0;
                                    return (
                                        <button key={t.id} onClick={() => logic.setViewTab(t.id as any)} className={`relative w-full px-2 py-2 rounded-lg transition-all border text-[10px] font-black uppercase flex items-center justify-center ${isActive ? 'bg-white shadow-sm border-slate-200 ' + t.color : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-200'}`}>
                                            <span className="truncate">{t.label}</span>
                                            {count > 0 && (
                                                <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black leading-4 text-center ${isActive ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{count}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="flex gap-2 relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16}/><input className="w-full bg-slate-50 border border-slate-200 pl-9 pr-3 py-2 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500" placeholder="BUSCAR..." value={logic.filterText} onChange={(e) => logic.setFilterText(e.target.value)} /></div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 bg-slate-50/50 space-y-2">
                        {logic.listData.length === 0 ? <div className="text-center py-10 text-slate-400 text-xs">Sin novedades en esta categoría</div> : 
                            isGrouped ? (groupedList.map((group: any) => <ObjectiveGroup key={group.id} group={group} modals={modalSetters} isCompact={logic.isCompact} onReport={handleReportPlanning} viewTab={logic.viewTab} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})} selectedShiftId={selectedShiftId} onSelectShift={(s:any)=>setSelectedShiftId(s?.id ?? null)}/>)) : 
                            (logic.listData.map((s:any) => <GuardCard key={s.id} shift={s} viewTab={logic.viewTab} isCompact={logic.isCompact} selectedShiftId={selectedShiftId} onSelectShift={(x:any)=>setSelectedShiftId(x?.id ?? null)} onSwitchToNoLlego={() => logic.setViewTab('NO_LLEGO')} onOpenCheckout={(s:any)=>setCheckoutData({isOpen:true, shift:s})} onOpenAttendance={(s:any)=>setAttendanceData({isOpen:true, shift:s})} onOpenHandover={(s:any)=>setHandoverData({isOpen:true, shift:s})} onOpenInterrupt={(s:any)=>setInterruptData({isOpen:true, shift:s})} onOpenCoverage={(s:any)=> { if (s.isReportedToPlanning) { toast.info("Vacante ya devuelta."); return; } setCoverageData({isOpen:true, shift:s}); }} onReportPlanning={handleReportPlanning} onOpenWorkedFranco={(s:any)=>setWorkedFrancoData({isOpen:true, shift:s})}/>))
                        }
                    </div>

                    <div className="h-40 border-t border-slate-200 bg-white flex flex-col"><div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={14} className="text-slate-400"/><h3 className="text-[10px] font-black uppercase text-slate-500">Bitácora</h3></div><button onClick={generateDailyReport} className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg"><Printer size={12}/></button></div><div className="flex-1 overflow-y-auto p-0">
                            <table className="w-full text-[10px] text-left" style={{ tableLayout: 'fixed' }}>
                                <colgroup>
                                    {bitacoraColWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
                                </colgroup>
                                <thead className="bg-slate-50 text-slate-400 uppercase font-bold sticky top-0">
                                    <tr>
                                        {['Hora', 'Evento', 'Actor', 'Objetivo', 'Detalle'].map((label, i) => (
                                            <th key={i} className="px-2 py-1 relative select-none" style={{ width: bitacoraColWidths[i] }}>
                                                {label}
                                                {i < 4 && (
                                                    <span
                                                        className="absolute top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-200 right-0"
                                                        onMouseDown={() => setBitacoraResizing(i)}
                                                        title="Arrastrar para redimensionar"
                                                    />
                                                )}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {bitacoraLogs.length === 0 ? (
                                        <tr><td colSpan={5} className="px-4 py-3 text-center text-slate-400 text-[10px] italic">No hay movimientos de operaciones (últimos 2 días). Las acciones que hagas aquí se verán en la bitácora.</td></tr>
                                    ) : bitacoraLogs.map((log: any) => (
                                        <tr key={log.id}>
                                            <td className="px-2 py-1 font-mono text-slate-400 truncate">{formatTimeSimple(log.time)}</td>
                                            <td className="px-2 py-1 font-bold truncate">{log.action}</td>
                                            <td className="px-2 py-1 truncate">{log.formattedActor}</td>
                                            <td className="px-2 py-1 text-slate-600 truncate" title={log.objectiveName || ''}>{log.objectiveName || '-'}</td>
                                            <td className="px-2 py-1 text-slate-500 truncate" title={log.fullDetail}>{log.fullDetail}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div></div>
                </div>
            </div>
            
            <RetentionModal isOpen={false} onClose={()=>{}} retainedShift={null} />
            <WorkedDayOffModal
                isOpen={workedFrancoData.isOpen}
                onClose={() => setWorkedFrancoData({ isOpen: false, shift: null })}
                shift={workedFrancoData.shift}
                availableShifts={logic.processedData}
                referenceDate={logic.now}
            />
            <CheckOutModal isOpen={checkoutData.isOpen} onClose={() => setCheckoutData({isOpen:false, shift:null})} onConfirm={async (nov:string|null) => { if (checkoutData.shift?.id) { await logic.handleAction('CHECKOUT', checkoutData.shift.id, nov); await registrarBitacora('Salida registrada', `Registró salida de ${checkoutData.shift?.employeeName || 'Guardia'} en ${checkoutData.shift?.objectiveName || 'objetivo'} (${checkoutData.shift?.positionName || ''})${nov ? '. Novedad: ' + nov : ''}`, { objectiveName: checkoutData.shift?.objectiveName, clientName: checkoutData.shift?.clientName }); } }} employeeName={checkoutData.shift?.employeeName} />
            <AttendanceModal isOpen={attendanceData.isOpen} onClose={()=>setAttendanceData({isOpen:false, shift:null})} shift={attendanceData.shift} onMarkAbsent={handleMarkAbsent} />
            
            <HandoverModal isOpen={handoverData.isOpen} onClose={()=>setHandoverData({isOpen:false, shift:null})} incomingShift={handoverData.shift} logic={logic} />
            <InterruptModal isOpen={interruptData.isOpen} onClose={()=>setInterruptData({isOpen:false, shift:null})} shift={interruptData.shift} logic={logic} onVacancyCreated={handleVacancyCreated} />
            <CoverageModal isOpen={coverageData.isOpen} onClose={()=>setCoverageData({isOpen:false, shift:null})} absenceShift={coverageData.shift} logic={logic} />

            {showHelp && (
                <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800">Ayuda Operaciones</h3>
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
                                <p className="font-black text-slate-700 mb-2">Barra lateral</p>
                                <p>- Prioridad: alertas críticas no resueltas.</p>
                                <p>- Vacantes: SLA no cubierto / reportadas.</p>
                                <p>- Ausentes: turnos iniciados sin presente.</p>
                            </div>
                            <div className="bg-slate-50 border rounded-xl p-3">
                                <p className="font-black text-slate-700 mb-2">Atajos</p>
                                <p>- Seleccioná una tarjeta.</p>
                                <p>- A = Ausente, P = Presente, C = Cubrir, D = Devolver.</p>
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
        </Layout>;
    return layout;
}