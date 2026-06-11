import React, { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useOperacionesMonitor } from '@/hooks/useOperacionesMonitor';
import { POPUP_STYLES } from '@/components/operaciones/mapStyles';
import { Toaster, toast } from 'sonner';
import { doc, updateDoc, serverTimestamp, addDoc, collection, onSnapshot, query, where, orderBy, limit, Timestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuth } from 'firebase/auth';
import { useEmpresa } from '@/context/EmpresaContext';
import { stampEmpresaId, updateDocForEmpresa, shouldScopeQueriesToEmpresa } from '@/lib/multiempresa';

const registrarBitacora = async (action: string, details: string, extra?: { objectiveName?: string; clientName?: string }) => {
    try {
        const auth = getAuth();
        const operatorName = auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Operador';
        const data: any = { action, module: 'OPERACIONES', details, timestamp: serverTimestamp(), actorName: operatorName, actorUid: auth.currentUser?.uid || null };
        if (extra?.objectiveName != null) data.objectiveName = extra.objectiveName;
        if (extra?.clientName != null) data.clientName = extra.clientName;
        await addDoc(collection(db, 'audit_logs'), data);
    } catch (e) { console.error('Error registrando bitácora', e); toast.error('No se pudo registrar en bitácora.'); }
};
import { Radio, Filter, Search, Building2, Shield, Clock, Siren, CheckCircle, LogOut, AlertTriangle, Phone, MessageCircle, Calendar, Send, PlayCircle, EyeOff, Briefcase, X, UserCheck, Navigation, ChevronUp, ChevronDown, MapPin, BellRing, UserX, Users } from 'lucide-react';
import { openWhatsApp, waMensaje } from '@/lib/whatsapp';
import { WorkedDayOffModal as WorkedDayOffModalPro } from '@/components/operaciones/OperationalModals';
import { WAComposeModal } from '@/components/common/WAComposeModal';

const OperacionesMap = dynamic(() => import('@/components/operaciones/OperacionesMap'), { loading: () => <div className="h-screen w-screen flex items-center justify-center bg-slate-900 text-slate-400 font-mono">CARGANDO MAPA TÁCTICO...</div>, ssr: false });

// --- HELPERS ---
const toDate = (d: any) => { if (!d) return new Date(); if (d instanceof Date) return d; if (d.seconds) return new Date(d.seconds * 1000); return new Date(d); };
const formatTimeSimple = (dateObj: any) => { try { return toDate(dateObj).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' }); } catch(e) { return '-'; } };
const formatDateShort = (dateObj: any) => { try { return toDate(dateObj).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Cordoba' }).toUpperCase(); } catch (e) { return '--/--'; } };
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
    // Los retenes se convocan reactivamente — no aplica tardanza basada en el inicio del slot
    let status = 'ON_TIME'; if (!incomingShift.isReten && diffMin > 5) status = 'LATE';
    const activeGuards = logic.processedData.filter((s:any) => s.objectiveId === incomingShift.objectiveId && s.positionName === incomingShift.positionName && (s.isPresent || s.status === 'COMPLETED') && s.id !== incomingShift.id && toDate(s.endDateObj).getTime() <= (start.getTime() + 3600000));
    const handleConfirm = async (prevShiftId: string | null) => {
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', incomingShift.id), { isPresent: true, status: 'PRESENT', realStartTime: serverTimestamp(), isLate: status === 'LATE' });
            if (prevShiftId) {
                batch.update(doc(db, 'turnos', prevShiftId), { realEndTime: serverTimestamp(), isCompleted: true, status: 'COMPLETED' });
            }
            await batch.commit();
            toast.success(status === 'LATE' ? 'Ingreso Tarde registrado.' : 'Ingreso Correcto.');
            onClose();
        } catch (e: any) { toast.error('Error al procesar relevo: ' + (e?.message || e?.code || String(e))); }
    };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4"> <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${status==='LATE' ? 'bg-amber-500' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"> {status==='LATE' ? <Clock size={20}/> : <UserCheck size={20}/>} {status==='LATE' ? 'Llegada Tarde' : 'Ingreso A Tiempo'} </h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 space-y-1"> <div className="flex items-center gap-2"> <MapPin size={13} className="text-indigo-500 shrink-0"/> <span className="text-xs font-black text-slate-800 truncate">{incomingShift.objectiveName || '—'}</span> {incomingShift.clientName && <span className="text-[10px] text-slate-400 truncate">· {incomingShift.clientName}</span>} </div> <div className="flex items-center gap-2 pl-5"> <span className="text-[10px] font-bold text-indigo-600">{incomingShift.positionName || '—'}</span> <span className="text-slate-300">·</span> <span className="text-[10px] font-mono text-slate-600">{formatTimeSimple(incomingShift.shiftDateObj)} - {formatTimeSimple(incomingShift.endDateObj)}</span> </div> </div> <p className="text-sm text-slate-600 mb-4"> El guardia <b>{incomingShift.employeeName}</b> está listo para ingresar. {status==='LATE' && <span className="block mt-1 text-amber-600 font-bold">⚠️ Retraso de {Math.round(diffMin)} minutos.</span>} </p> {activeGuards.length > 0 ? ( <div className="space-y-2 mb-4"> <p className="text-xs font-bold text-slate-400 uppercase">Seleccione a quién relevar:</p> {activeGuards.map((s:any) => ( <button key={s.id} onClick={() => handleConfirm(s.id)} className="w-full p-3 border rounded-xl hover:bg-slate-50 flex justify-between items-center group"> <div className="text-left"> <span className="block text-xs font-bold text-slate-700">{s.employeeName}</span> <span className="block text-[10px] text-slate-400">Salida: {formatTimeSimple(s.endDateObj)}</span> </div> <span className="text-[10px] font-bold bg-slate-100 px-2 py-1 rounded text-slate-600 group-hover:bg-slate-800 group-hover:text-white transition-colors">RELEVAR</span> </button> ))} </div> ) : ( <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-center mb-4"> <p className="text-xs text-slate-400 italic">No hay guardia saliente registrado.</p> </div> )} <button onClick={() => handleConfirm(null)} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors"> {activeGuards.length > 0 ? 'INGRESAR SIN RELEVAR' : 'CONFIRMAR INGRESO'} </button> </div> </div> </div> );
};

const InterruptModal = ({ isOpen, onClose, shift, logic, onVacancyCreated }: any) => {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    if (!isOpen || !shift) return null;
    const colleagues = logic.processedData.filter((s:any) => s.objectiveId === shift.objectiveId && s.id !== shift.id && (s.isPresent || s.status === 'PRESENT') && !s.isCompleted);
    const isAlone = colleagues.length === 0;
    const shiftEmpresaId = String(shift.empresaId || empresaId || '').trim();
    const handleLog = async () => {
        await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'BAJA_CUBIERTA', shiftId: shift.id, details: 'Retiro anticipado. Puesto cubierto por dotación.', createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, shiftEmpresaId));
        await updateDocForEmpresa('turnos', shift.id, { checkOutTime: serverTimestamp(), status: 'COMPLETED', comments: 'Baja anticipada (Cubierto)' }, empresaId, migracionCompleta);
        toast.success("Baja registrada. Puesto cubierto."); onClose();
    };
    const handleProtocol = async () => {
        await updateDocForEmpresa('turnos', shift.id, { status: 'INTERRUPTED', checkOutTime: serverTimestamp() }, empresaId, migracionCompleta);
        const newRef = await addDoc(collection(db, 'turnos'), stampEmpresaId({ clientId: shift.clientId, clientName: shift.clientName, objectiveId: shift.objectiveId, objectiveName: shift.objectiveName, positionName: shift.positionName, startTime: serverTimestamp(), employeeId: 'VACANTE', employeeName: 'VACANTE (BAJA)', isUnassigned: true, isPresent: false, origin: 'INTERRUPTION', originRef: shift.id, createdAt: serverTimestamp() }, shiftEmpresaId));
        onVacancyCreated({ ...shift, id: newRef.id, isUnassigned: true });
    };
    return ( <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4"> <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden"> <div className={`p-4 text-white flex justify-between items-center ${isAlone ? 'bg-purple-600' : 'bg-emerald-600'}`}> <h3 className="font-black uppercase flex items-center gap-2"><Siren size={20}/> Baja Anticipada</h3> <button onClick={onClose}><X size={20}/></button> </div> <div className="p-6"> <div className={`p-4 rounded-xl border mb-4 ${isAlone ? 'bg-purple-50 border-purple-100' : 'bg-emerald-50 border-emerald-100'}`}> <h4 className={`font-bold text-sm mb-1 ${isAlone ? 'text-purple-800' : 'text-emerald-800'}`}> {isAlone ? '⚠️ GUARDIA SOLO EN EL OBJETIVO' : `✅ HAY ${colleagues.length} COMPAÑEROS`} </h4> <p className="text-xs text-slate-500"> {isAlone ? 'El puesto quedará descubierto. Se requiere activar protocolo.' : 'El puesto puede ser cubierto por la dotación actual.'} </p> </div> {isAlone ? ( <button onClick={handleProtocol} className="w-full py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 animate-pulse shadow-lg shadow-purple-200"> INICIAR PROTOCOLO DE COBERTURA </button> ) : ( <button onClick={handleLog} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200"> REGISTRAR NOVEDAD (CUBIERTO) </button> )} </div> </div> </div> );
};

const CoverageSection = ({ num, title, colorClass, badgeClass, items, empty }: any) => (
    <section>
        <h4 className={`text-xs font-black uppercase flex items-center gap-1.5 mb-2 ${colorClass}`}>
            <span className={`w-5 h-5 rounded-full text-white text-[10px] flex items-center justify-center font-black shrink-0 ${badgeClass}`}>{num}</span>
            {title}
        </h4>
        {items.length > 0 ? <div className="space-y-1.5">{items}</div> : <p className="text-[10px] text-slate-400 italic pl-1">{empty}</p>}
    </section>
);

const CoverageRow = ({ item, lKey, onAction, label, color, loading, onWA }: any) => {
    const name = item.employeeName || item.fullName || '';
    const ph = item.phone || item.celular || '';
    const busy = loading === lKey;
    return (
        <div className="flex items-center justify-between p-2 bg-white border border-slate-100 rounded-lg gap-2 shadow-sm">
            <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-slate-800 block truncate">{name}</span>
                <div className="flex items-center gap-2 flex-wrap">
                    {Number.isFinite(item.distance) && item.distance > 0.05
                        ? <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Navigation size={8}/>{item.distance.toFixed(1)}km · ~{item.eta}min</span>
                        : !Number.isFinite(item.distance) && <span className="text-[10px] text-slate-300 italic">Sin ubicación</span>
                    }
                    {item.shiftDateObj && !item.isFranco && (
                        <span className="text-[10px] text-indigo-500 font-medium">
                            {formatDateShort(item.shiftDateObj)} · {formatTimeSimple(item.shiftDateObj)}–{formatTimeSimple(item.endDateObj)}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex gap-1 shrink-0">
                <button onClick={() => onWA(item)} className={`p-1.5 border rounded-lg transition-colors ${ph ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-slate-50 text-slate-300 border-slate-100 cursor-default'}`} title="WhatsApp"><MessageCircle size={13}/></button>
                <button onClick={onAction} disabled={busy} className={`px-2.5 py-1 text-white text-[10px] font-bold rounded-lg transition-colors ${color} disabled:opacity-50`}>{busy ? '...' : label}</button>
            </div>
        </div>
    );
};

const CoverageModal = ({ isOpen, onClose, absenceShift, logic, onAudit }: any) => {
    const { empresaId, empresa } = useEmpresa();
    const tenantId = (s?: any) => String(s?.empresaId || absenceShift?.empresaId || empresaId || '').trim();
    const [loading, setLoading] = useState<string | null>(null);
    const [localWa, setLocalWa] = useState<{ isOpen: boolean; ctx: any }>({ isOpen: false, ctx: { employeeName: '', phone: '' } });
    if (!isOpen || !absenceShift) return null;

    const now = new Date();
    const absenceEnd = toDate(absenceShift.endDateObj);
    const hiStart = formatTimeSimple(absenceShift.shiftDateObj);
    const hiEnd = formatTimeSimple(absenceShift.endDateObj);
    const isVirtual = !!absenceShift.isVirtual || String(absenceShift.id || '').startsWith('V124_') || String(absenceShift.id || '').startsWith('SLA_GAP');

    const objLat = absenceShift.lat || -31.4201;
    const objLng = absenceShift.lng || -64.1888;

    const retencion = logic.processedData.filter((s: any) =>
        s.isPresent && !s.isCompleted &&
        s.objectiveId === absenceShift.objectiveId &&
        s.positionName === absenceShift.positionName &&
        s.id !== absenceShift.id
    );

    const adelanto = logic.processedData.filter((s: any) =>
        !s.isPresent && !s.isCompleted && !s.isAbsent && !s.isUnassigned && !s.isFranco &&
        s.objectiveId === absenceShift.objectiveId &&
        s.positionName === absenceShift.positionName &&
        toDate(s.shiftDateObj) > now
    ).sort((a: any, b: any) => toDate(a.shiftDateObj).getTime() - toDate(b.shiftDateObj).getTime()).slice(0, 1);

    const busyIds = new Set(
        logic.processedData.filter((s: any) => isSameDay(s.shiftDateObj, now) && !s.isFranco).map((s: any) => s.employeeId)
    );
    const retenes = (logic.employees || [])
        .filter((e: any) => !busyIds.has(e.id))
        .map((e: any) => {
            const dist = calculateDistance(objLat, objLng, e.lat, e.lng);
            return { ...e, fullName: e.firstName ? `${e.firstName} ${e.lastName || ''}`.trim() : e.name || e.fullName || '', phone: e.phone || e.celular || '', distance: dist, eta: Number.isFinite(dist) ? estimateEta(dist) : null };
        })
        .sort((a: any, b: any) => a.distance - b.distance).slice(0, 8);

    const francos = logic.processedData
        .filter((s: any) => s.isFranco && isSameDay(s.shiftDateObj, now) && !s.isFrancoTrabajado)
        .map((s: any) => {
            const emp = (logic.employees || []).find((e: any) => e.id === s.employeeId);
            const dist = calculateDistance(objLat, objLng, emp?.lat, emp?.lng);
            return { ...s, fullName: s.employeeName, phone: s.phone || emp?.phone || emp?.celular || '', distance: dist, eta: Number.isFinite(dist) ? estimateEta(dist) : null };
        })
        .sort((a: any, b: any) => a.distance - b.distance).slice(0, 8);

    const openLocalWA = (item: any) => {
        const nombre = item.employeeName || item.fullName || '';
        const ph = item.phone || item.celular || '';
        setLocalWa({ isOpen: true, ctx: { employeeName: nombre, phone: ph, objectiveName: absenceShift.objectiveName, horaInicio: hiStart, horaFin: hiEnd } });
    };

    const isRealVacantShift = absenceShift.isUnassigned && absenceShift.id && !isVirtual;
    const markOriginalCovered = (batch: ReturnType<typeof writeBatch>, coverageType: string) => {
        if (isRealVacantShift) {
            batch.update(doc(db, 'turnos', absenceShift.id), { status: 'COVERED', resolvedBy: 'OPERACIONES', coverageType, coveredAt: serverTimestamp() });
        }
    };

    const handleRetener = async (s: any) => {
        setLoading('ret_' + s.id);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', s.id), { isRetention: true, retentionEndTime: Timestamp.fromDate(absenceEnd) });
            batch.set(doc(collection(db, 'user_notifications')), { userId: s.employeeId, type: 'RETENCION', title: 'Quedaste retenido', read: false, body: `Tu turno en ${absenceShift.objectiveName} se extiende hasta ${hiEnd}.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() });
            markOriginalCovered(batch, 'RETENTION');
            await batch.commit();
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'RETENCION', title: 'Retención de guardia', status: 'pending', employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, absenceShiftId: absenceShift.id, description: `${s.employeeName} retenido hasta ${hiEnd} por ausencia de ${absenceShift.employeeName || ''}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(s)));
            toast.success(`${s.employeeName} retenido hasta ${hiEnd}`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    const handleAdelantar = async (s: any) => {
        setLoading('adel_' + s.id);
        try {
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', s.id), { adjustedStartTime: serverTimestamp(), isEarlyStart: true });
            batch.set(doc(collection(db, 'user_notifications')), { userId: s.employeeId, type: 'ADELANTO', title: 'Turno adelantado', read: false, body: `Tu turno en ${absenceShift.objectiveName} fue adelantado. Confirmá llegada.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() });
            markOriginalCovered(batch, 'EARLY_START');
            await batch.commit();
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'ADELANTO_TURNO', title: 'Adelanto de turno', status: 'pending', employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, description: `Turno de ${s.employeeName} adelantado desde ${formatTimeSimple(s.shiftDateObj)}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(s)));
            toast.success(`Turno de ${s.employeeName} adelantado`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    const handleReten = async (emp: any) => {
        setLoading('reten_' + emp.id);
        try {
            // Usar el inicio del slot como startTime del turno para que checkSlotCoverage
            // vea cobertura completa (>90%) y suprima la vacante virtual
            const slotStart = toDate(absenceShift.shiftDateObj);
            const eightHoursLater = new Date(now.getTime() + 8 * 3600000);
            const endTime = eightHoursLater > absenceEnd ? eightHoursLater : absenceEnd;
            const empName = emp.fullName || emp.name || '';
            const newRef = doc(collection(db, 'turnos'));
            const batch = writeBatch(db);
            batch.set(newRef, stampEmpresaId({ employeeId: emp.id, employeeName: empName, clientId: absenceShift.clientId, clientName: absenceShift.clientName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, positionName: absenceShift.positionName, startTime: Timestamp.fromDate(slotStart), endTime: Timestamp.fromDate(endTime), status: 'PENDING', origin: 'RETEN', isReten: true, absenceShiftId: absenceShift.id, createdAt: serverTimestamp() }, tenantId(absenceShift)));
            batch.set(doc(collection(db, 'user_notifications')), { userId: emp.id, type: 'RETEN', title: 'Convocatoria de Retén', read: false, body: `Sos convocado como retén en ${absenceShift.objectiveName} (${absenceShift.positionName}).`, objectiveId: absenceShift.objectiveId, shiftId: newRef.id, createdAt: serverTimestamp() });
            markOriginalCovered(batch, 'RETEN');
            await batch.commit();
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'CONVOCATORIA_RETEN', title: 'Convocatoria retén', status: 'pending', employeeId: emp.id, employeeName: empName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: newRef.id, description: `${empName} convocado como retén en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(absenceShift)));
            toast.success(`${empName} convocado como retén`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    const handleFranco = async (s: any) => {
        setLoading('franco_' + s.id);
        try {
            const vacancyStart = absenceShift.shiftDateObj instanceof Date
                ? Timestamp.fromDate(absenceShift.shiftDateObj)
                : Timestamp.fromDate(toDate(absenceShift.shiftDateObj));
            const vacancyEnd = absenceEnd instanceof Date
                ? Timestamp.fromDate(absenceEnd)
                : Timestamp.fromDate(toDate(absenceEnd));
            const batch = writeBatch(db);
            batch.update(doc(db, 'turnos', s.id), {
                isFranco: false,
                isFrancoTrabajado: true,
                code: 'FT',
                type: 'EXTRA_FRANCO',
                startTime: vacancyStart,
                endTime: vacancyEnd,
                francoTrabajadoAt: serverTimestamp(),
                francoObjectiveId: absenceShift.objectiveId,
                francoObjectiveName: absenceShift.objectiveName,
                comments: `Franco Trabajado (Convocado) — cubre ${absenceShift.objectiveName || 'vacante'}`,
            });
            batch.set(doc(collection(db, 'user_notifications')), { userId: s.employeeId, type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', read: false, body: `Se te convoca a trabajar tu franco en ${absenceShift.objectiveName}.`, objectiveId: absenceShift.objectiveId, shiftId: s.id, createdAt: serverTimestamp() });
            markOriginalCovered(batch, 'FRANCO');
            await batch.commit();
            await addDoc(collection(db, 'novedades'), stampEmpresaId({ type: 'FRANCO_TRABAJADO', title: 'Franco trabajado', status: 'pending', employeeId: s.employeeId, employeeName: s.employeeName, objectiveId: absenceShift.objectiveId, objectiveName: absenceShift.objectiveName, shiftId: s.id, description: `${s.employeeName} trabaja su franco en ${absenceShift.objectiveName}`, createdAt: serverTimestamp(), reportedBy: 'OPERACIONES' }, tenantId(s)));
            toast.success(`${s.employeeName} convocado (Franco Trabajado)`);
            onClose();
        } catch (e: any) { toast.error('Error: ' + (e?.message || String(e))); }
        finally { setLoading(null); }
    };

    return (
        <>
            <div className="fixed inset-0 z-[9000] bg-slate-900/80 flex items-center justify-center p-4 animate-in fade-in">
                <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <div className="p-4 bg-rose-600 text-white flex justify-between items-center shrink-0">
                        <h3 className="font-black uppercase text-sm flex items-center gap-2"><Siren size={18}/> Protocolo de Cobertura</h3>
                        <button onClick={onClose} className="bg-white/20 p-1 rounded-lg hover:bg-white/30"><X size={18}/></button>
                    </div>
                    <div className="p-4 overflow-y-auto custom-scrollbar space-y-5 flex-1">
                        <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-xs">
                            <span className="font-black text-rose-800">{absenceShift.objectiveName}</span>
                            <span className="text-rose-600"> · {absenceShift.positionName} · {hiStart}–{hiEnd}</span>
                            {absenceShift.employeeName && <span className="block text-rose-500 mt-0.5">Ausente: {absenceShift.employeeName}</span>}
                        </div>
                        <CoverageSection num="1" title="Retención · Guardia presente en el objetivo" colorClass="text-orange-700" badgeClass="bg-orange-500"
                            empty="No hay guardias presentes en este objetivo."
                            items={retencion.map((s: any) => <CoverageRow key={s.id} item={s} lKey={'ret_'+s.id} onAction={()=>handleRetener(s)} label="RETENER" color="bg-orange-500 hover:bg-orange-600" loading={loading} onWA={openLocalWA}/>)}
                        />
                        <CoverageSection num="2" title="Adelanto · Próximo turno planificado" colorClass="text-indigo-700" badgeClass="bg-indigo-500"
                            empty="No hay turno próximo planificado."
                            items={adelanto.map((s: any) => <CoverageRow key={s.id} item={s} lKey={'adel_'+s.id} onAction={()=>handleAdelantar(s)} label="ADELANTAR" color="bg-indigo-600 hover:bg-indigo-700" loading={loading} onWA={openLocalWA}/>)}
                        />
                        <CoverageSection num="3" title="Retenes · Sin turno hoy" colorClass="text-slate-700" badgeClass="bg-slate-600"
                            empty="No hay retenes disponibles."
                            items={retenes.map((e: any) => <CoverageRow key={e.id} item={e} lKey={'reten_'+e.id} onAction={()=>handleReten(e)} label="CONVOCAR" color="bg-slate-700 hover:bg-slate-800" loading={loading} onWA={openLocalWA}/>)}
                        />
                        <CoverageSection num="4" title="Francos · Día libre" colorClass="text-blue-700" badgeClass="bg-blue-500"
                            empty="No hay francos disponibles hoy."
                            items={francos.map((s: any) => <CoverageRow key={s.id} item={s} lKey={'franco_'+s.id} onAction={()=>handleFranco(s)} label="CONVOCAR FT" color="bg-blue-600 hover:bg-blue-700" loading={loading} onWA={openLocalWA}/>)}
                        />
                    </div>
                </div>
            </div>
            <WAComposeModal isOpen={localWa.isOpen} onClose={() => setLocalWa((d: any) => ({...d, isOpen: false}))} ctx={localWa.ctx}/>
        </>
    );
};

const SimpleCheckOutModal = ({ isOpen, onClose, onConfirm, employeeName }: any) => { const [novedad, setNovedad] = useState(''); if (!isOpen) return null; return (<div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl p-6"><h3 className="font-bold mb-4">Salida: {employeeName}</h3><button onClick={() => { onConfirm(false); onClose(); }} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold mb-2">Salida Normal</button><textarea className="w-full p-2 border rounded mb-2" placeholder="Novedad..." value={novedad} onChange={e=>setNovedad(e.target.value)}/><button onClick={() => { onConfirm(novedad); setNovedad(''); onClose(); }} className="w-full py-2 bg-slate-100 font-bold rounded">Reportar y Salir</button><button onClick={onClose} className="mt-2 text-sm text-slate-400 w-full">Cancelar</button></div></div>); };
const RetentionModal = ({ isOpen, onClose, retainedShift }: any) => { if (!isOpen) return null; return ( <div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4 animate-in fade-in"> <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6"> <h3 className="font-bold mb-2">Retención de Guardia</h3> <p className="text-sm text-slate-500 mb-4">{retainedShift?.employeeName || 'Guardia'}</p> <button onClick={onClose} className="w-full py-2 bg-slate-100 rounded font-bold">Cerrar</button> </div> </div> ); };
const WorkedDayOffModal = (props: any) => <WorkedDayOffModalPro {...props} />;
const AttendanceModal = ({ isOpen, onClose, shift, onMarkAbsent }: any) => { if (!isOpen) return null; return (<div className="fixed inset-0 z-[9000] bg-black/60 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-6 text-center"><AlertTriangle size={48} className="mx-auto text-amber-500 mb-4"/><h3 className="font-bold text-lg mb-2">Confirmar Ausencia</h3><p className="text-sm text-slate-500 mb-6">¿{shift?.employeeName} no se presentó?</p><button onClick={() => onMarkAbsent(shift)} className="w-full py-3 bg-rose-600 text-white rounded-xl font-bold mb-2">MARCAR AUSENTE</button><button onClick={onClose} className="text-sm text-slate-400">Cancelar</button></div></div>); };

export default function TacticalMapView() {
    const { empresaId, empresa } = useEmpresa();
    const migracionCompleta = !!(empresa as any)?.migracionCompleta;
    const logic = useOperacionesMonitor();
    const [empNovedades, setEmpNovedades] = useState<any[]>([]);
    const [notifPanelOpen, setNotifPanelOpen] = useState(false);
    // Refresh key: reconecta listener al volver de background o recuperar red
    const [refreshKey, setRefreshKey] = useState(0);
    useEffect(() => {
        const bump = () => setRefreshKey(k => k + 1);
        const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', bump);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', bump);
        };
    }, []);
    const pendingNovedades = useMemo(() =>
        empNovedades.filter(n =>
            n.status !== 'ATENDIDA' && n.status !== 'atendida' &&
            n.type !== 'VACANTE_A_PLANIFICACION' &&
            !n.enGestion   // excluir las que otro operador está gestionando
        ),
    [empNovedades]);
    // Nombre del operador actual (para marcar enGestion)
    const operatorName = useMemo(() => getAuth().currentUser?.email?.split('@')[0] || 'Operador', []);
    useEffect(() => {
        const since = Timestamp.fromDate(new Date(Date.now() - 48 * 3600 * 1000));
        const scopeEmpresa = shouldScopeQueriesToEmpresa(empresaId, migracionCompleta);
        const q = scopeEmpresa
            ? query(collection(db, 'novedades'), where('empresaId', '==', empresaId), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200))
            : query(collection(db, 'novedades'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(200));
        const unsub = onSnapshot(q, snap => {
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                docs.sort((a: any, b: any) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
                setEmpNovedades(docs);
            }, err => {
                console.warn('[map-view] novedades listener error, reconectando:', err.code);
                setRefreshKey(k => k + 1);
            }
        );
        return () => unsub();
    }, [empresaId, migracionCompleta, refreshKey]);
    const prevPendingCount = useRef(0);
    useEffect(() => {
        if (pendingNovedades.length > prevPendingCount.current) setNotifPanelOpen(true);
        prevPendingCount.current = pendingNovedades.length;
    }, [pendingNovedades.length]);
    // Marcar novedad como "en gestión" para que control center no la muestre como alerta activa
    const handleTomarGestion = async (novedad: any) => {
        if (novedad.enGestion) return; // ya la tomó otro
        try {
            await updateDoc(doc(db, 'novedades', novedad.id), {
                enGestion: true,
                enGestionBy: operatorName,
                enGestionAt: serverTimestamp(),
            });
        } catch (e) { /* silencioso */ }
    };

    const handleAtenderNovedad = async (novedad: any) => {
        try {
            await updateDoc(doc(db, 'novedades', novedad.id), { status: 'ATENDIDA', atendidaAt: serverTimestamp(), enGestion: false, enGestionBy: null });
            if (novedad.type === 'VACANTE_A_PLANIFICACION') {
                toast.success('Vacante devuelta a planificación');
            } else if (novedad.type === 'VACANTE_PROTOCOLO_COBERTURA') {
                const vacShift = logic.processedData.find((s: any) =>
                    s.id === novedad.virtualVacancyId ||
                    (s.isVirtual && s.objectiveId === novedad.objectiveId && (s.positionName || '').toLowerCase() === (novedad.positionName || '').toLowerCase())
                );
                if (vacShift) {
                    if (vacShift.isVirtual || !novedad.shiftId) {
                        const newRef = doc(collection(db, 'turnos'));
                        await setDoc(newRef, stampEmpresaId({ clientId: vacShift.clientId, clientName: vacShift.clientName, objectiveId: vacShift.objectiveId, objectiveName: vacShift.objectiveName, positionName: vacShift.positionName, employeeId: 'VACANTE', employeeName: 'VACANTE', startTime: Timestamp.fromDate(vacShift.shiftDateObj), endTime: Timestamp.fromDate(vacShift.endDateObj), status: 'UNCOVERED_REPORTED', isReported: true, origin: 'SLA_VIRTUAL', createdAt: serverTimestamp() }, String(vacShift.empresaId || novedad.empresaId || empresaId || '').trim()));
                        setCoverageData({ isOpen: true, shift: { ...vacShift, id: newRef.id } });
                    } else { setCoverageData({ isOpen: true, shift: vacShift }); }
                } else { toast.info('Vacante no encontrada. Verificá en mapa.'); }
            } else if (novedad.type === 'ADELANTO_TURNO' || novedad.type === 'CONVOCATORIA_RETEN' || novedad.type === 'RETENCION' || novedad.type === 'FRANCO_TRABAJADO') {
                const targetShift = novedad.shiftId
                    ? logic.processedData.find((s: any) => s.id === novedad.shiftId)
                    : logic.processedData.find((s: any) => s.employeeId === novedad.employeeId && s.objectiveId === novedad.objectiveId && !s.isPresent && !s.isCompleted);
                if (targetShift) {
                    setHandoverData({ isOpen: true, shift: targetShift });
                    logic.setViewTab('PRIORIDAD');
                    toast.info(`Dar presente a ${targetShift.employeeName || novedad.employeeName || 'guardia'}`);
                } else {
                    logic.setViewTab('PRIORIDAD');
                    toast.info('Buscá al guardia en PRIORIDAD para dar presente.');
                }
            } else if (novedad.type === 'AUSENCIA_AUTO' || novedad.type === 'RELEVO_NO_PRESENTADO') {
                logic.setViewTab('AUSENTES'); toast.info('Gestionar desde pestaña AUSENTES');
            } else if (novedad.type === 'AUSENCIA_CORTO_PLAZO' || novedad.type === 'AVISO_AUSENCIA_ANTICIPADA') {
                const targetShift = novedad.shiftId
                    ? logic.processedData.find((s: any) => s.id === novedad.shiftId)
                    : logic.processedData.find((s: any) => s.objectiveId === novedad.objectiveId && (s.positionName || '').toLowerCase() === (novedad.positionName || '').toLowerCase() && !s.isCompleted);
                if (targetShift) { setCoverageData({ isOpen: true, shift: targetShift }); toast.info(`Cobertura abierta: ${novedad.employeeName || 'empleado'}`); }
                else { toast.info('Turno no encontrado en datos actuales.'); }
            } else { toast.success('Alerta atendida'); }
        } catch(e) { toast.error('Error al atender la alerta'); }
    };
    const [checkoutData, setCheckoutData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [attendanceData, setAttendanceData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [handoverData, setHandoverData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [interruptData, setInterruptData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [coverageData, setCoverageData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [workedFrancoData, setWorkedFrancoData] = useState<{isOpen: boolean, shift: any}>({isOpen: false, shift: null});
    const [showHelp, setShowHelp] = useState(false);
    const [showProtAlerts, setShowProtAlerts] = useState(false);

    const handleMarkAbsent = async (shift: any) => {
        try {
            await updateDocForEmpresa('turnos', shift.id, { status: 'ABSENT', isAbsent: true }, empresaId, migracionCompleta);
            setAttendanceData({isOpen:false, shift:null});
            setCoverageData({isOpen:true, shift: shift});
        } catch (e) { toast.error("Error al marcar ausencia"); }
    };
    const handleVacancyCreated = (newVacancyShift: any) => { setInterruptData({isOpen:false, shift:null}); setCoverageData({isOpen:true, shift: newVacancyShift}); };
    const handleReportPlanning = async (shift: any) => { toast.info("Reportando..."); };

    // --- SYNC FILTROS (cliente y búsqueda; la solapa NO se hereda del panel: el mapa expandido abre siempre en MAPA GENERAL) ---
    useEffect(() => {
        logic.setViewTab('TODOS');
        const syncFilters = () => {
            const saved = localStorage.getItem('crono_ops_filters');
            if (saved) {
                try {
                    const { client, text } = JSON.parse(saved);
                    logic.setSelectedClientId(client ?? '');
                    logic.setFilterText(text ?? '');
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

    const objectivesWithCoords = useMemo(() => (logic.objectives || []).filter((o: any) => o != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng))), [logic.objectives]);
    const objectivesForMap = useMemo(() => {
        const base = logic.filteredObjectives || [];
        const allObjs = logic.objectives || [];
        const centerLat = -31.4201, centerLng = -64.1888;
        const ensureCoords = (arr: any[]) => arr.map((o: any) => {
            const hasCoords = o != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng));
            return hasCoords ? o : { ...o, lat: centerLat, lng: centerLng };
        });
        if (logic.viewTab === 'TODOS') {
            const result = base.length ? base : allObjs;
            return ensureCoords(result.length ? result : objectivesWithCoords);
        }
        const ids = new Set((logic.listData || []).map((s: any) => s.objectiveId).filter(Boolean));
        const fromTab = base.filter((o: any) => ids.has(o.id));
        const combined = fromTab.length ? fromTab : base;
        return ensureCoords(combined.length ? combined : objectivesWithCoords);
    }, [logic.filteredObjectives, logic.listData, logic.viewTab, logic.objectives, objectivesWithCoords]);

    return (
        <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
            <Head><title>COSP TACTICAL V1.0 · 31b309b</title></Head>
            <style>{POPUP_STYLES}</style>
            <Toaster position="top-center" theme="dark" />
            
            <div className="absolute top-4 left-4 right-4 z-[1000] flex gap-2 justify-between pointer-events-none">
                <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl p-2 flex items-center gap-3 border border-slate-200 pointer-events-auto">
                    <div className="flex items-center gap-2 px-3 border-r border-slate-200 pr-4"><Radio className="text-rose-600 animate-pulse" size={20} /><div><h1 className="font-black text-slate-800 text-sm leading-none">COSP TACTICAL</h1><span className="text-[10px] text-slate-500 font-bold">V1.0 · <span className="font-mono">31b309b</span></span></div></div>
                    <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200"><Filter size={14} className="text-slate-400 ml-1"/><select value={logic.selectedClientId} onChange={(e) => logic.setSelectedClientId(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none w-40 cursor-pointer"><option value="">TODOS LOS CLIENTES</option>{logic.uniqueClients.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                    <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 w-64"><Search size={14} className="text-slate-400 ml-1"/><input className="bg-transparent text-xs font-bold text-slate-700 outline-none w-full placeholder:text-slate-400" placeholder="Buscar guardia, objetivo..." value={logic.filterText} onChange={e => logic.setFilterText(e.target.value)}/></div>
                </div>
                <div className="flex items-center gap-2 pointer-events-auto">
                    {/* Mini chip cobertura */}
                    {(() => {
                        const total = logic.stats.plan + logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes;
                        const cubiertos = logic.stats.activos + logic.stats.retenidos;
                        const debieronIniciar = logic.stats.activos + logic.stats.retenidos + logic.stats.vacantes + logic.stats.ausentes;
                        const pct = debieronIniciar > 0 ? Math.round((cubiertos / debieronIniciar) * 100) : null;
                        if (pct === null) return null;
                        const isCrisis = pct < 50;
                        const isWarn = pct >= 50 && pct < 80;
                        const chipBg = isCrisis ? 'bg-rose-600' : isWarn ? 'bg-amber-500' : 'bg-emerald-600';
                        return (
                            <div className={`${chipBg} text-white rounded-2xl px-3 py-2 flex items-center gap-2 shadow-2xl backdrop-blur`}>
                                <span className="text-sm font-black">{pct}%</span>
                                <div className="text-[10px] font-bold leading-tight">
                                    <div>{cubiertos} activos</div>
                                    {(logic.stats.vacantes + logic.stats.ausentes) > 0 && <div className="opacity-80">{logic.stats.vacantes}vac · {logic.stats.ausentes}aus</div>}
                                </div>
                                {logic.stats.plan > 0 && <div className="text-[9px] opacity-70">+{logic.stats.plan} plan</div>}
                            </div>
                        );
                    })()}
                    <div className="bg-white/95 backdrop-blur shadow-2xl rounded-2xl p-1.5 flex gap-1 border border-slate-200">
                        <button onClick={() => logic.setViewTab('TODOS')} className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${logic.viewTab === 'TODOS' ? 'bg-slate-800 text-white shadow-md' : 'hover:bg-slate-100 text-slate-500'}`}>MAPA GENERAL</button>
                        {tabs.map(t => {
                            const isUrgent = (t.id === 'VACANTES' || t.id === 'AUSENTES' || t.id === 'PRIORIDAD' || t.id === 'NO_LLEGO') && t.count > 0;
                            const isActive = logic.viewTab === t.id;
                            return (
                                <button key={t.id} onClick={() => logic.setViewTab(t.id as any)}
                                    className={`relative px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all
                                        ${isActive
                                            ? (isUrgent ? 'bg-rose-600 text-white shadow-md' : 'bg-white shadow-md ring-1 ring-slate-200 ' + t.color)
                                            : (isUrgent ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'hover:bg-slate-100 text-slate-400')}`}>
                                    {isUrgent && !isActive && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"/>}
                                    {t.label}
                                    <span className={`px-1.5 rounded-md ml-1 text-[9px] ${isActive && isUrgent ? 'bg-white/20 text-white' : isUrgent ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>{t.count}</span>
                                </button>
                            );
                        })}
                        <button onClick={() => setShowHelp(true)} className="px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-all bg-slate-900 text-white hover:bg-slate-800">Ayuda</button>
                    </div>
                </div>
            </div>

            <OperacionesMap
                key={`tactical-${logic.viewTab}-${(objectivesForMap || []).map((o:any)=>o.id).sort().join(',').slice(0,120)}`}
                center={[-31.4201, -64.1888]}
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
            
            {/* ── PANEL FLOTANTE DE ALERTAS — con fix ghost badge + triage urgente/PROT ── */}
            <div className="absolute bottom-8 left-8 z-[1000]">
            {(() => {
                // Ghost badge fix: mismo filtro que stats.prioridad
                const _now = new Date();
                const _hoy = logic.processedData.filter((s:any) => isSameDay(s.shiftDateObj, _now) || ((s.isPresent || s.isRetention) && !s.isCompleted));
                const priorityShiftsPanel = _hoy.filter((s:any) => (s.isImminent || s.isRetention || s.isEarlyStart || s.isAwaitingCoverageCheckIn) && !s.isFranco);

                // Triage: urgentes vs PROT (automatizados, menos urgentes)
                const urgentNovedades = pendingNovedades.filter(n =>
                    n.type === 'AUSENCIA_CORTO_PLAZO' || n.type === 'AVISO_AUSENCIA_ANTICIPADA' ||
                    n.type === 'POSICION_SIN_RELEVO' || n.type === 'RETENCION_LARGA' ||
                    n.type === 'AUSENCIA_AUTO' || n.type === 'RELEVO_NO_PRESENTADO'
                );
                const protNovedades = pendingNovedades.filter(n => n.type === 'VACANTE_PROTOCOLO_COBERTURA');
                const otherNovedades = pendingNovedades.filter(n =>
                    !urgentNovedades.includes(n) && !protNovedades.includes(n)
                );
                const totalAlerts = priorityShiftsPanel.length + urgentNovedades.length + otherNovedades.length + protNovedades.length;

                const renderNovedad = (n: any) => {
                    const ts = n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null;
                    const isAbsence = n.type === 'AUSENCIA_AUTO';
                    const isRelevo = n.type === 'RELEVO_NO_PRESENTADO' || n.type === 'POSICION_SIN_RELEVO';
                    const isProto = n.type === 'VACANTE_PROTOCOLO_COBERTURA';
                    const isRetencion = n.type === 'RETENCION_LARGA';
                    const isCortoplazo = n.type === 'AUSENCIA_CORTO_PLAZO';
                    const isAnticipada = n.type === 'AVISO_AUSENCIA_ANTICIPADA';
                    const leftBorder = isCortoplazo ? 'border-l-red-600' : isAnticipada ? 'border-l-amber-400' : isAbsence ? 'border-l-rose-500' : isRelevo ? 'border-l-amber-500' : isProto ? 'border-l-orange-400' : isRetencion ? 'border-l-orange-600' : 'border-l-slate-300';
                    const typeLabel = isCortoplazo ? 'URGENTE' : isAnticipada ? 'ANTIC.' : isProto ? 'PROT' : isAbsence ? 'AUS' : isRelevo ? 'REL' : isRetencion ? 'REC' : 'NOV';
                    const typeBg = isCortoplazo ? 'bg-red-600 text-white animate-pulse' : isAnticipada ? 'bg-amber-100 text-amber-800' : isProto ? 'bg-orange-100 text-orange-700' : isAbsence ? 'bg-rose-100 text-rose-700' : isRelevo ? 'bg-amber-100 text-amber-700' : isRetencion ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600';
                    const actionBg = isCortoplazo ? 'bg-red-600 hover:bg-red-700' : isAnticipada ? 'bg-amber-600 hover:bg-amber-700' : isProto ? 'bg-orange-500 hover:bg-orange-600' : isAbsence ? 'bg-rose-600 hover:bg-rose-700' : isRelevo ? 'bg-amber-600 hover:bg-amber-700' : isRetencion ? 'bg-orange-700 hover:bg-orange-800' : 'bg-slate-700 hover:bg-slate-800';
                    const ActionIcon = isCortoplazo ? Siren : isAnticipada ? BellRing : isProto ? Users : isAbsence ? UserX : isRelevo ? Clock : isRetencion ? Clock : CheckCircle;
                    return (
                        <div key={n.id} className={`px-3 py-1.5 flex items-center gap-2 border-l-4 ${leftBorder} border-b border-slate-50 hover:bg-slate-50/60 transition-colors`}>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded w-14 text-center shrink-0 ${typeBg}`}>{typeLabel}</span>
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
                                    {n.employeeName && n.objectiveName ? <>{n.employeeName} <span className="text-slate-400 font-normal">·</span> {n.objectiveName}</> : n.objectiveName || n.employeeName || n.type}
                                    {n.positionName && <span className="text-slate-400 font-normal text-[9px]"> · {n.positionName}</span>}
                                </p>
                                <p className="text-[9px] text-slate-400 truncate leading-tight">{n.description || '-'}</p>
                            </div>
                            <span className="text-[9px] text-slate-400 font-mono w-10 text-right shrink-0">{ts ? ts.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'}) : '--'}</span>
                            <div className="flex gap-1 shrink-0 w-14 justify-end">
                                {n.employeePhone && <button onClick={() => openWhatsApp(n.employeePhone, waMensaje.bienvenida(n.employeeName||''))} className="p-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-100"><MessageCircle size={11}/></button>}
                                <button onClick={() => handleAtenderNovedad(n)} className={`p-1.5 text-white rounded-lg transition-colors ${actionBg}`} title="Atender"><ActionIcon size={11}/></button>
                            </div>
                        </div>
                    );
                };

                return !notifPanelOpen ? (
                    <button onClick={() => setNotifPanelOpen(true)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg font-black uppercase text-sm transition-all hover:scale-105 ${totalAlerts > 0 ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-800 text-white'}`}>
                        <Siren size={15} className={totalAlerts > 0 ? 'animate-pulse' : ''}/>
                        Alertas
                        <span className={`text-xs font-black px-2 py-0.5 rounded-full ${totalAlerts > 0 ? 'bg-white text-rose-600' : 'bg-white/20 text-white'}`}>{totalAlerts}</span>
                    </button>
                ) : (
                    <div className="w-[480px] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-4 max-h-[75vh]">
                        <div className="px-3 py-2.5 bg-slate-900 rounded-t-2xl flex items-center gap-2">
                            <Siren size={14} className="text-rose-400 shrink-0"/>
                            <span className="font-black uppercase text-xs text-white flex-1">Alertas y Prioridad</span>
                            {totalAlerts > 0 && <span className="bg-rose-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">{totalAlerts}</span>}
                            <button onClick={() => setNotifPanelOpen(false)} className="p-1 hover:bg-white/10 rounded-lg transition-colors"><X size={14} className="text-slate-400"/></button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {/* Sección PRIORIDAD (turnos inminentes/retención) */}
                            {priorityShiftsPanel.length > 0 && (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1.5 bg-rose-50 flex items-center gap-1.5">
                                        <AlertTriangle size={10} className="text-rose-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-rose-700 uppercase flex-1">Acción inmediata</span>
                                        <span className="text-[9px] font-bold text-rose-500">{priorityShiftsPanel.length} turno{priorityShiftsPanel.length > 1 ? 's' : ''}</span>
                                    </div>
                                    {priorityShiftsPanel.map((s: any) => (
                                        <div key={s.id} className="px-3 py-1.5 flex items-center gap-2 border-l-4 border-l-rose-500 border-b border-slate-50 bg-white hover:bg-rose-50/30 transition-colors">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${s.isRetention ? 'bg-orange-100 text-orange-700' : s.isEarlyStart || s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>{(s.employeeName || '?')[0]}</div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-800 truncate leading-tight">
                                                    {s.employeeName || 'Desconocido'}
                                                    <span className={`ml-1.5 text-[9px] font-black px-1 rounded ${s.isRetention ? 'bg-orange-100 text-orange-700' : s.isEarlyStart ? 'bg-indigo-100 text-indigo-700' : s.isAwaitingCoverageCheckIn ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {s.isRetention ? 'RECARGO' : s.isEarlyStart ? 'ADELANTADO' : s.isAwaitingCoverageCheckIn ? 'CONVOCADO' : 'INMINENTE'}
                                                    </span>
                                                </p>
                                                <p className="text-[9px] text-slate-400 truncate">{s.objectiveName} · {s.positionName} · <span className="font-mono">{formatTimeSimple(s.shiftDateObj)}</span></p>
                                            </div>
                                            <div className="flex gap-1 shrink-0">
                                                {s.isRetention ? (<>
                                                    <button onClick={() => { setNotifPanelOpen(false); setCheckoutData({isOpen:true, shift:s}); }} className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700"><LogOut size={11}/></button>
                                                    <button onClick={() => { setNotifPanelOpen(false); setInterruptData({isOpen:true, shift:s}); }} className="p-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100"><Siren size={11}/></button>
                                                </>) : (<>
                                                    <button onClick={() => { setNotifPanelOpen(false); setHandoverData({isOpen:true, shift:s}); }} className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><PlayCircle size={11}/></button>
                                                    <button onClick={() => { setNotifPanelOpen(false); setAttendanceData({isOpen:true, shift:s}); }} className="p-1.5 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-100"><AlertTriangle size={11}/></button>
                                                </>)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Novedades urgentes (siempre visibles) */}
                            {urgentNovedades.length > 0 && (
                                <div className="border-b border-slate-200">
                                    <div className="px-3 py-1 bg-amber-50 flex items-center gap-1.5">
                                        <AlertTriangle size={10} className="text-amber-600 shrink-0"/>
                                        <span className="text-[9px] font-black text-amber-700 uppercase flex-1">Novedades urgentes</span>
                                        <span className="text-[9px] font-bold text-amber-500">{urgentNovedades.length}</span>
                                    </div>
                                    {urgentNovedades.map(renderNovedad)}
                                </div>
                            )}

                            {/* Otras novedades */}
                            {otherNovedades.length > 0 && (
                                <div className="border-b border-slate-200">
                                    {otherNovedades.map(renderNovedad)}
                                </div>
                            )}

                            {/* PROT alerts — colapsados por defecto */}
                            {protNovedades.length > 0 && (
                                <div>
                                    <button onClick={() => setShowProtAlerts(v => !v)}
                                        className="w-full px-3 py-2 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left">
                                        <span className="text-[9px] font-black text-slate-500 uppercase flex-1">
                                            Protocolos de cobertura automáticos ({protNovedades.length})
                                        </span>
                                        <span className="text-[9px] text-slate-400">{showProtAlerts ? '▲ ocultar' : '▼ ver'}</span>
                                    </button>
                                    {showProtAlerts && protNovedades.map(renderNovedad)}
                                </div>
                            )}

                            {totalAlerts === 0 && (
                                <div className="p-6 text-center">
                                    <CheckCircle size={28} className="mx-auto mb-2 text-emerald-400 opacity-50"/>
                                    <p className="text-sm font-bold text-slate-400">Sin alertas pendientes</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}
            </div>

            <AttendanceModal isOpen={attendanceData.isOpen} onClose={()=>setAttendanceData({isOpen:false, shift:null})} shift={attendanceData.shift} onMarkAbsent={handleMarkAbsent} />
            <HandoverModal isOpen={handoverData.isOpen} onClose={()=>setHandoverData({isOpen:false, shift:null})} incomingShift={handoverData.shift} logic={logic} />
            <InterruptModal isOpen={interruptData.isOpen} onClose={()=>setInterruptData({isOpen:false, shift:null})} shift={interruptData.shift} logic={logic} onVacancyCreated={handleVacancyCreated} />
            <CoverageModal isOpen={coverageData.isOpen} onClose={()=>setCoverageData({isOpen:false, shift:null})} absenceShift={coverageData.shift} logic={logic} onAudit={async (action, details, extra) => await registrarBitacora(action, details, extra)} />
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
